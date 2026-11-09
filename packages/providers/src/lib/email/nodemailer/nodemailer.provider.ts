import { createHash } from 'node:crypto';
import { EmailProviderIdEnum } from '@novu/shared';
import { resolveSafeSmtpPinnedTarget, SmtpOutboundTlsOptions } from '@novu/shared/utils/validate-smtp-outbound-target';
import {
  ChannelTypeEnum,
  CheckIntegrationResponseEnum,
  ICheckIntegrationResponse,
  IEmailOptions,
  IEmailProvider,
  ISendMessageSuccessResponse,
} from '@novu/stateless';
import nodemailer, { SendMailOptions, Transporter } from 'nodemailer';
import DKIM from 'nodemailer/lib/dkim';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { ConnectionOptions } from 'tls';
import { BaseProvider, CasingEnum } from '../../../base.provider';
import { WithPassthrough } from '../../../utils/types';

interface INodemailerConfig {
  from: string;
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  password?: string;
  dkim?: DKIM.SingleKeyOptions;
  ignoreTls?: boolean;
  requireTls?: boolean;
  tlsOptions?: ConnectionOptions;
  senderName?: string;
}

/**
 * Djinn: апстрим входит в SMTP на каждое письмо, поэтому письма идут по общим соединениям.
 * Ключ — настройки целиком, с закреплённым адресом: смена пароля или адреса даёт новые соединения.
 * Новое соединение открывается, только когда предыдущее уже вошло: при смене пароля отказ один.
 */
const SMTP_POOL_MAX_CONNECTIONS = Number(process.env.SMTP_POOL_MAX_CONNECTIONS) || 5;
const SMTP_POOLS_KEPT = 16;
/** Письма, уже прошедшие проверку паузы, пока отказ доезжает до Redis: новых входов им нет. */
const SMTP_REFUSED_QUARANTINE_MS = 5_000;

type SmtpPoolInternals = {
  options: { maxConnections: number };
  _connections: { _connected?: boolean }[];
  _processMessages: () => void;
};
type SmtpPool = { transport: Transporter; internals: SmtpPoolInternals; refusedUntil?: number };

const smtpPools = new Map<string, SmtpPool>();

function openSmtpPool(options: SMTPTransport.Options): SmtpPool {
  const transport = nodemailer.createTransport({ ...options, pool: true, maxRequeues: 0 } as SMTPTransport.Options);
  const internals = transport.transporter as unknown as SmtpPoolInternals;

  Object.defineProperty(internals.options, 'maxConnections', {
    get: () => (internals._connections.some((connection) => !connection._connected) ? 0 : SMTP_POOL_MAX_CONNECTIONS),
  });

  return { transport, internals };
}

function sharedSmtpPool(options: SMTPTransport.Options): SmtpPool {
  const key = createHash('sha256').update(JSON.stringify(options)).digest('hex');
  const known = smtpPools.get(key);

  if (known && (!known.refusedUntil || known.refusedUntil > Date.now())) return known;

  const pool = openSmtpPool(options);
  smtpPools.delete(key);
  smtpPools.set(key, pool);

  if (smtpPools.size > SMTP_POOLS_KEPT) {
    const [oldestKey, oldest] = smtpPools.entries().next().value as [string, SmtpPool];
    smtpPools.delete(oldestKey);
    oldest.transport.close();
  }

  return pool;
}

export class NodemailerProvider extends BaseProvider implements IEmailProvider {
  id = EmailProviderIdEnum.CustomSMTP; // nodemailer
  protected casing: CasingEnum = CasingEnum.CAMEL_CASE;

  channelType = ChannelTypeEnum.EMAIL as ChannelTypeEnum.EMAIL;

  constructor(private config: INodemailerConfig) {
    super();
  }

  private getTlsConfig(servername: string): ConnectionOptions {
    return {
      ...(this.getTlsOptions() ?? {}),
      servername,
    };
  }

  private buildTransportOptions(connectionHost: string, port: number, tlsServername: string): SMTPTransport.Options {
    let { dkim } = this.config;

    if (!dkim?.domainName || !dkim?.privateKey || !dkim?.keySelector) {
      dkim = undefined;
    }

    const authEnabled = this.config.user && this.config.password;
    const tls = this.getTlsConfig(tlsServername);

    return {
      name: tlsServername,
      host: connectionHost,
      port,
      secure: this.config.secure,
      connectionTimeout: 10000,
      socketTimeout: 10000,
      auth: authEnabled
        ? {
            user: this.config.user,
            pass: this.config.password,
          }
        : undefined,
      dkim,
      ignoreTLS: this.config.ignoreTls,
      requireTLS: this.config.requireTls,
      tls,
    };
  }

  private getSmtpTlsOptions(): SmtpOutboundTlsOptions {
    return {
      secure: this.config.secure,
      requireTls: this.config.requireTls,
      ignoreTls: this.config.ignoreTls,
    };
  }

  private async withPinnedTransport<T>(operation: (transport: Transporter) => Promise<T>): Promise<T> {
    const pinned = await resolveSafeSmtpPinnedTarget(this.config.host, this.config.port, this.getSmtpTlsOptions());
    const transport = nodemailer.createTransport(
      this.buildTransportOptions(pinned.address, pinned.port, pinned.hostname)
    );

    try {
      return await operation(transport);
    } finally {
      transport.close();
    }
  }

  getTlsOptions(): ConnectionOptions | undefined {
    /**
     * Only render TLS options if secure is enabled to true.
     * Reference: https://nodemailer.com/smtp/#tls-options
     *
     */
    if (this.config.secure && !!this.config.tlsOptions) {
      this.validateTlsOptions();

      return this.config.tlsOptions;
    }

    return undefined;
  }

  validateTlsOptions(): void {
    try {
      JSON.parse(JSON.stringify(this.config.tlsOptions));
    } catch {
      throw new Error('TLS options is not a valid JSON. Check again the value set for NODEMAILER_TLS_OPTIONS');
    }
  }

  async sendMessage(
    options: IEmailOptions,
    bridgeProviderData: WithPassthrough<Record<string, unknown>> = {}
  ): Promise<ISendMessageSuccessResponse> {
    const mailData = this.createMailData(options);
    const merged = this.transform(bridgeProviderData, mailData);
    const info = await this.sendOverSharedConnection(merged.body);

    return {
      id: info?.messageId,
      date: new Date().toISOString(),
    };
  }

  private async sendOverSharedConnection(mail: SendMailOptions) {
    const pinned = await resolveSafeSmtpPinnedTarget(this.config.host, this.config.port, this.getSmtpTlsOptions());
    const pool = sharedSmtpPool(this.buildTransportOptions(pinned.address, pinned.port, pinned.hostname));

    if (pool.refusedUntil) throw new Error('Connection pool was closed');

    try {
      const info = await pool.transport.sendMail(mail);
      // Очередь могла накопиться, пока вход был один: письмо прошло, можно открыть следующее соединение.
      setImmediate(() => pool.internals._processMessages());

      return info;
    } catch (error) {
      // Отказ во входе: письма из очереди получат «pool was closed», новых входов не будет.
      if ((error as { code?: string })?.code === 'EAUTH' && !pool.refusedUntil) {
        pool.refusedUntil = Date.now() + SMTP_REFUSED_QUARANTINE_MS;
        pool.transport.close();
      }

      throw error;
    }
  }

  async checkIntegration(options: IEmailOptions): Promise<ICheckIntegrationResponse> {
    try {
      const mailData = this.createMailData(options);
      await this.withPinnedTransport((transport) => transport.sendMail(mailData));

      return {
        success: true,
        message: 'Integrated successfully!',
        code: CheckIntegrationResponseEnum.SUCCESS,
      };
    } catch (error) {
      return {
        success: false,
        message: error?.message,
        // nodemailer does not provide a way to distinguish errors
        code: CheckIntegrationResponseEnum.FAILED,
      };
    }
  }

  private createMailData(options: IEmailOptions): SendMailOptions {
    const sendMailOptions: SendMailOptions = {
      from: {
        address: options.from || this.config.from,
        name: options.senderName || this.config.senderName || '',
      },
      to: resolveNodemailerTo(options),
      subject: options.subject,
      html: options.html,
      text: options.text,
      ...(options.alternatives?.length ? { alternatives: options.alternatives } : {}),
      cc: options.cc,
      attachments: options.attachments?.map((attachment) => ({
        filename: attachment?.name,
        content: attachment.file,
        contentType: attachment.mime,
        cid: attachment.cid,
        contentDisposition:
          (attachment.disposition as 'inline' | 'attachment') ?? (attachment.cid ? 'inline' : undefined),
      })),
      bcc: options.bcc,
    };

    if (options.replyTo) {
      sendMailOptions.replyTo = options.replyTo;
    }

    if (options.headers && Object.keys(options.headers).length > 0) {
      sendMailOptions.headers = options.headers;
    }

    return sendMailOptions;
  }
}

const UNDISCLOSED_RECIPIENTS = 'undisclosed-recipients:;';

function resolveNodemailerTo(options: Pick<IEmailOptions, 'to' | 'cc' | 'bcc'>): string | string[] {
  if (options.to.length > 0) {
    return options.to;
  }

  const hasCcOrBcc = Boolean(options.cc?.length) || Boolean(options.bcc?.length);

  if (!hasCcOrBcc) {
    return options.to;
  }

  return UNDISCLOSED_RECIPIENTS;
}
