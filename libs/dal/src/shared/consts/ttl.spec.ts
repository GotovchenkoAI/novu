import { expect } from 'chai';
import { getRetentionIndexOptions } from './ttl';

// `env.d.ts` объявляет срок числом, а в окружении процесса он всегда строка — тест пишет строки.
const env = process.env as Record<string, string | undefined>;

describe('Верхняя граница TTL данных вызова (Djinn)', () => {
  const maximumSeconds = 30 * 24 * 60 * 60;
  let previousRetention: string | undefined;

  beforeEach(() => {
    previousRetention = env.NOTIFICATION_RETENTION_DAYS;
  });

  afterEach(() => {
    if (previousRetention === undefined) {
      delete env.NOTIFICATION_RETENTION_DAYS;
    } else {
      env.NOTIFICATION_RETENTION_DAYS = previousRetention;
    }
  });

  for (const input of [undefined, '', '0', '-1', 'not-a-number', '31', 'Infinity']) {
    it(`ограничивает срок при значении ${input === undefined ? 'отсутствует' : JSON.stringify(input)}`, () => {
      if (input === undefined) {
        delete env.NOTIFICATION_RETENTION_DAYS;
      } else {
        env.NOTIFICATION_RETENTION_DAYS = input;
      }

      const { expireAfterSeconds } = getRetentionIndexOptions();

      expect(Number.isFinite(expireAfterSeconds)).to.equal(true);
      expect(expireAfterSeconds).to.be.greaterThan(0).and.at.most(maximumSeconds);
    });
  }

  for (const days of [1, 7.5, 30]) {
    it(`сохраняет разрешённый срок ${days} суток`, () => {
      env.NOTIFICATION_RETENTION_DAYS = String(days);

      expect(getRetentionIndexOptions()).to.deep.equal({ expireAfterSeconds: days * 24 * 60 * 60 });
    });
  }
});
