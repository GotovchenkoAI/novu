import { expect } from 'chai';
import { buildTelegramBotApiUrl, resolveTelegramApiBaseUrl } from './telegram-webhook.utils';

describe('Адрес Telegram (Djinn)', () => {
  const saved = process.env.TELEGRAM_API_BASE_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.TELEGRAM_API_BASE_URL;
    else process.env.TELEGRAM_API_BASE_URL = saved;
  });

  it('без переменной отказывает: чужого адреса по умолчанию нет', () => {
    delete process.env.TELEGRAM_API_BASE_URL;

    expect(() => resolveTelegramApiBaseUrl()).to.throw('TELEGRAM_API_BASE_URL is not set');
    expect(() => buildTelegramBotApiUrl('t', 'getMe')).to.throw('TELEGRAM_API_BASE_URL is not set');
  });

  it('с переменной идёт по заданному маршруту', () => {
    process.env.TELEGRAM_API_BASE_URL = 'https://bridge.example/telegram/';

    expect(buildTelegramBotApiUrl('t', 'getMe')).to.equal('https://bridge.example/telegram/bott/getMe');
  });
});
