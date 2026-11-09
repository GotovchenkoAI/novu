import { IntegrationEntity } from '@novu/dal';
import { expect } from 'chai';
import { isSmtpLoginRefused, SmtpLoginGate, smtpConnectionLostRetryInMs } from './smtp-login-gate.service';

class FakeRedis {
  store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, ...args: unknown[]) {
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);

    return 'OK';
  }
  async del(key: string) {
    return this.store.delete(key) ? 1 : 0;
  }
}

const integration = (password = 'bad') => ({ _id: 'smtp', credentials: { password } }) as unknown as IntegrationEntity;

describe('SmtpLoginGate (Djinn)', () => {
  let gate: SmtpLoginGate;
  const pauses = process.env.SMTP_LOGIN_PAUSES_SECONDS;

  beforeEach(() => {
    process.env.SMTP_LOGIN_PAUSES_SECONDS = '60,120';
    gate = new SmtpLoginGate({ cacheEnabled: () => true, client: new FakeRedis() } as never);
  });

  afterEach(() => {
    process.env.SMTP_LOGIN_PAUSES_SECONDS = pauses;
  });

  it('20 одновременных шагов получают один вход, отказ закрывает вход остальным', async () => {
    const passes = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const pass = await gate.enter(integration());
        if (pass.allowed) {
          await gate.refused(integration());
          await gate.leave(pass);
        }

        return pass;
      })
    );

    expect(passes.filter((pass) => pass.allowed)).to.have.length(1);
    expect(await gate.closedFor(integration())).to.be.greaterThan(55_000);
  }).timeout(20_000);

  it('пауза растёт от отказа к отказу и останавливается на последней ступени', async () => {
    const delays = [await gate.refused(integration()), await gate.refused(integration()), await gate.refused(integration())];

    expect(delays[0]).to.be.within(60_000, 90_000);
    expect(delays[1]).to.be.within(120_000, 150_000);
    expect(delays[2]).to.be.within(120_000, 150_000);
  });

  it('принятый вход снимает паузу, новый пароль открывает вход сразу', async () => {
    await gate.refused(integration());
    expect(await gate.closedFor(integration('fixed'))).to.equal(null);

    await gate.accepted(integration());
    expect(await gate.closedFor(integration())).to.equal(null);
  });

  it('известный вход пускает письма параллельно, отказ возвращает к одной пробе', async () => {
    const enterAll = () => Promise.all(Array.from({ length: 20 }, () => gate.enter(integration())));

    const probe = await gate.enter(integration());
    await gate.accepted(integration());
    await gate.leave(probe);
    const parallel = await enterAll();
    expect(parallel.filter((pass) => pass.allowed)).to.have.length(20);
    expect(parallel.some((pass) => pass.allowed && pass.slotKey)).to.equal(false);

    await gate.refused(integration());
    const afterRefusal = await enterAll();
    expect(afterRefusal.filter((pass) => pass.allowed)).to.have.length(0);
  }).timeout(20_000);

  it('пропавшее соединение откладывает шаг, ожидание ограничено, отказ сервера идёт обычным путём', () => {
    expect(smtpConnectionLostRetryInMs({ code: 'ECONNECTION' })).to.be.within(5_000, 15_000);
    expect(smtpConnectionLostRetryInMs(new Error('Connection pool was closed'))).to.be.within(5_000, 15_000);
    expect(smtpConnectionLostRetryInMs({ code: 'ECONNECTION' }, 40)).to.equal(null);
    expect(smtpConnectionLostRetryInMs({ code: 'EENVELOPE' })).to.equal(null);
    expect(smtpConnectionLostRetryInMs(new Error('boom'))).to.equal(null);
  });

  it('узнаёт отказ во входе только по коду EAUTH', () => {
    expect(isSmtpLoginRefused({ code: 'EAUTH' })).to.equal(true);
    expect(isSmtpLoginRefused({ code: 'ESOCKET' })).to.equal(false);
  });
});
