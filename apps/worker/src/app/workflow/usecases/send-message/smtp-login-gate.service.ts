import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CacheService } from '@novu/application-generic';
import { IntegrationEntity } from '@novu/dal';

/** Как у доставщика Djinn (login_hold.py): 15 минут, 30 минут, час. Настройка — для проверок. */
const DEFAULT_PAUSES_SECONDS = [900, 1800, 3600];
const HOLD_TTL_SECONDS = 30 * 24 * 3600;
/** Дольше соединения и отправки nodemailer: упавший воркер не держит вход дольше этого срока. */
const SLOT_TTL_MS = 60_000;
const SLOT_WAIT_MS = 5_000;
const SLOT_POLL_MS = 50;
/** Сколько помним принятый вход: пока письма идут, он обновляется; дальше снова одна проба. */
const LOGIN_KNOWN_GOOD_SECONDS = 60;
/** Соединение пропало, письмо не принято: шаг ждёт и повторяется. Около 7 минут, дальше обычный отказ. */
const CONNECTION_LOST_MAX_DEFERRALS = 40;

type Hold = { failures: number; until: number };
export type SmtpLoginPass = { allowed: true; slotKey?: string; token?: string } | { allowed: false; retryInMs: number };

const jitter = (maxMs: number) => Math.floor(Math.random() * maxMs);

/** Вход в SMTP закрыт: шаг не упал, а ждёт паузу. Ловит RunJob. */
export class SmtpLoginDeferred extends Error {
  constructor(readonly retryInMs: number) {
    super('SMTP login is closed for a pause');
  }
}

export const isSmtpLoginRefused = (error: unknown) => (error as { code?: string })?.code === 'EAUTH';

/** Соединение пропало или очередь закрыта отказом соседа: письмо не принято, шаг можно повторить. */
export function smtpConnectionLostRetryInMs(error: unknown, extensions = 0): number | null {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  const lost = ['ECONNECTION', 'ESOCKET', 'ETIMEDOUT'].includes(code ?? '') || message === 'Connection pool was closed';

  return lost && extensions < CONNECTION_LOST_MAX_DEFERRALS ? 5_000 + jitter(10_000) : null;
}

/**
 * Учётка почты общая с кодами входа, поэтому неверный пароль не должен повторяться: неизвестное
 * состояние проверяет одно письмо, отказ закрывает вход на растущую паузу. Правка учётных данных
 * открывает вход сразу: ключ зависит от них. Шаг на это время откладывается, а не падает.
 */
@Injectable()
export class SmtpLoginGate {
  constructor(private cacheService: CacheService) {}

  private get client() {
    return this.cacheService.client as NonNullable<CacheService['client']>;
  }

  /** Сколько ждать до конца паузы; `null` — вход открыт. */
  async closedFor(integration: IntegrationEntity): Promise<number | null> {
    if (!this.cacheService.cacheEnabled()) return null;
    const raw = await this.client.get(this.holdKey(integration));
    const hold: Hold | null = raw ? JSON.parse(raw) : null;
    const left = hold ? hold.until - Date.now() : 0;

    return left > 0 ? left + jitter(30_000) : null;
  }

  /** Вход известен как рабочий — письма идут параллельно. Неизвестен или закрыт — одна проба на все воркеры. */
  async enter(integration: IntegrationEntity): Promise<SmtpLoginPass> {
    if (!this.cacheService.cacheEnabled()) return { allowed: true };
    const slotKey = `${this.keyOf(integration)}:slot`;
    const token = randomUUID();
    const deadline = Date.now() + SLOT_WAIT_MS;

    for (;;) {
      const retryInMs = await this.closedFor(integration);
      if (retryInMs !== null) return { allowed: false, retryInMs };
      if (await this.client.get(this.goodKey(integration))) return { allowed: true };

      if (await this.client.set(slotKey, token, 'PX', SLOT_TTL_MS, 'NX')) {
        const closed = await this.closedFor(integration);
        if (closed === null) return { allowed: true, slotKey, token };
        await this.leave({ allowed: true, slotKey, token });

        return { allowed: false, retryInMs: closed };
      }

      if (Date.now() >= deadline) return { allowed: false, retryInMs: 2_000 + jitter(3_000) };
      await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_MS + jitter(SLOT_POLL_MS)));
    }
  }

  async accepted(integration: IntegrationEntity): Promise<void> {
    if (!this.cacheService.cacheEnabled()) return;
    await this.client.set(this.goodKey(integration), '1', 'EX', LOGIN_KNOWN_GOOD_SECONDS);
    await this.client.del(this.holdKey(integration));
  }

  /** Отказ во входе: следующая ступень паузы. Возвращает, через сколько повторить шаг. */
  async refused(integration: IntegrationEntity): Promise<number> {
    const raw = this.cacheService.cacheEnabled() ? await this.client.get(this.holdKey(integration)) : null;
    const failures = (raw ? (JSON.parse(raw) as Hold).failures : 0) + 1;
    const pauses = this.pausesSeconds();
    const pauseMs = pauses[Math.min(failures, pauses.length) - 1] * 1000;
    const hold: Hold = { failures, until: Date.now() + pauseMs };

    if (this.cacheService.cacheEnabled()) {
      await this.client.set(this.holdKey(integration), JSON.stringify(hold), 'EX', HOLD_TTL_SECONDS);
      await this.client.del(this.goodKey(integration));
    }

    return pauseMs + jitter(30_000);
  }

  async leave(pass: SmtpLoginPass | undefined): Promise<void> {
    if (!pass?.allowed || !pass.slotKey || !this.cacheService.cacheEnabled()) return;
    if ((await this.client.get(pass.slotKey)) === pass.token) {
      await this.client.del(pass.slotKey);
    }
  }

  private keyOf(integration: IntegrationEntity): string {
    const credentials = createHash('sha256').update(JSON.stringify(integration.credentials ?? {})).digest('hex');

    return `smtp-login:${integration._id}:${credentials.slice(0, 16)}`;
  }

  private goodKey(integration: IntegrationEntity): string {
    return `${this.keyOf(integration)}:good`;
  }

  private holdKey(integration: IntegrationEntity): string {
    return `${this.keyOf(integration)}:hold`;
  }

  private pausesSeconds(): number[] {
    const configured = (process.env.SMTP_LOGIN_PAUSES_SECONDS ?? '').split(',').map(Number).filter((n) => n > 0);

    return configured.length ? configured : DEFAULT_PAUSES_SECONDS;
  }
}
