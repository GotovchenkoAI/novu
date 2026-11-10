import { expect } from 'chai';
import { getRetentionIndexOptions } from './ttl';

describe('Верхняя граница TTL данных вызова (Djinn)', () => {
  const maximumSeconds = 30 * 24 * 60 * 60;
  let previousRetention: string | undefined;

  beforeEach(() => {
    previousRetention = process.env.NOTIFICATION_RETENTION_DAYS;
  });

  afterEach(() => {
    if (previousRetention === undefined) {
      delete process.env.NOTIFICATION_RETENTION_DAYS;
    } else {
      process.env.NOTIFICATION_RETENTION_DAYS = previousRetention;
    }
  });

  for (const input of [undefined, '', '0', '-1', 'not-a-number', '31', 'Infinity']) {
    it(`ограничивает срок при значении ${input === undefined ? 'отсутствует' : JSON.stringify(input)}`, () => {
      if (input === undefined) {
        delete process.env.NOTIFICATION_RETENTION_DAYS;
      } else {
        process.env.NOTIFICATION_RETENTION_DAYS = input;
      }

      const { expireAfterSeconds } = getRetentionIndexOptions();

      expect(Number.isFinite(expireAfterSeconds)).to.equal(true);
      expect(expireAfterSeconds).to.be.greaterThan(0).and.at.most(maximumSeconds);
    });
  }

  for (const days of [1, 7.5, 30]) {
    it(`сохраняет разрешённый срок ${days} суток`, () => {
      process.env.NOTIFICATION_RETENTION_DAYS = String(days);

      expect(getRetentionIndexOptions()).to.deep.equal({ expireAfterSeconds: days * 24 * 60 * 60 });
    });
  }
});
