import nodemailer from 'nodemailer';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { NodemailerProvider } from './nodemailer.provider';

type FakeTransport = {
  sendMail: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  transporter: { options: { maxConnections: number }; _connections: { _connected?: boolean }[]; _processMessages: () => void };
};
const created: FakeTransport[] = [];

vi.mock(import('nodemailer'), async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    default: {
      ...actual.default,
      createTransport: vi.fn().mockImplementation(() => {
        const transport = {
          sendMail: vi.fn().mockResolvedValue({ messageId: 'id' }),
          close: vi.fn(),
          transporter: { options: { maxConnections: 5 }, _connections: [], _processMessages: vi.fn() },
        };
        created.push(transport);

        return transport;
      }),
    },
  };
});

vi.mock(import('@novu/shared/utils/validate-smtp-outbound-target'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveSafeSmtpPinnedTarget: vi.fn().mockImplementation(async (host: string, port: number) => ({ address: `addr-of-${host}`, port, hostname: host })),
}));

const provider = (password = 'good', host = 'smtp.example.com') =>
  new NodemailerProvider({ from: 'a@example.com', host, port: 465, secure: true, user: 'sender', password });
const letter = { to: ['b@example.com'], subject: 's', html: '<p>x</p>', from: 'a@example.com' };
const refused = Object.assign(new Error('Invalid login'), { code: 'EAUTH' });

describe('Общие соединения SMTP (Djinn)', () => {
  afterEach(() => {
    created.length = 0;
    vi.mocked(nodemailer.createTransport).mockClear();
  });

  test('те же настройки — одно соединение на письма, пароль и адрес дают новое', async () => {
    await provider('p1').sendMessage(letter);
    await provider('p1').sendMessage(letter);
    expect(created).toHaveLength(1);
    expect(created[0].sendMail).toHaveBeenCalledTimes(2);

    await provider('p2').sendMessage(letter);
    expect(created).toHaveLength(2);
    await provider('p2', 'other.example.com').sendMessage(letter);
    expect(created).toHaveLength(3);
    expect(vi.mocked(nodemailer.createTransport).mock.calls[0][0]).toMatchObject({ pool: true, host: 'addr-of-smtp.example.com', maxRequeues: 0 });
  });

  test('отказ во входе закрывает соединения и не даёт новых входов, пока он доезжает до паузы', async () => {
    await provider('p3').sendMessage(letter);
    created[0].sendMail.mockRejectedValueOnce(refused);

    await expect(provider('p3').sendMessage(letter)).rejects.toThrow('Invalid login');
    expect(created[0].close).toHaveBeenCalledTimes(1);

    await expect(provider('p3').sendMessage(letter)).rejects.toThrow('Connection pool was closed');
    expect(created).toHaveLength(1);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6_000 });
    await provider('p3').sendMessage(letter);
    vi.useRealTimers();
    expect(created).toHaveLength(2);
  });

  test('новое соединение открывается, только когда предыдущее вошло', async () => {
    await provider('p4').sendMessage(letter);
    const { options, _connections } = created[0].transporter;

    expect(options.maxConnections).toBe(5);
    _connections.push({ _connected: true });
    expect(options.maxConnections).toBe(5);
    _connections.push({ _connected: false });
    expect(options.maxConnections).toBe(0);
  });

  test('внутренности nodemailer, на которые опирается предел, на месте', async () => {
    const actual = (await vi.importActual('nodemailer')) as { default: typeof nodemailer };
    const pool = actual.default.createTransport({ pool: true, host: 'smtp.example.com' })
      .transporter as unknown as FakeTransport['transporter'];

    expect(Array.isArray(pool._connections)).toBe(true);
    expect(typeof pool._processMessages).toBe('function');
    expect(pool.options.maxConnections).toBeGreaterThan(0);
  });
});
