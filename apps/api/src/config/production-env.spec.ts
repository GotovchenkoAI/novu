import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'chai';

const file = (app: string) => readFileSync(join(__dirname, '..', '..', '..', app, 'src', '.env.production'), 'utf8');

describe('.env.production в образе (Djinn)', () => {
  for (const app of ['api', 'worker', 'ws']) {
    it(`${app}: нет чужих адресов, агента New Relic и значений чужих сервисов`, () => {
      const values = file(app)
        .split('\n')
        .filter((line) => line && !line.startsWith('#'));

      expect(values.filter((line) => line.includes('novu.co'))).to.eql([]);
      expect(values.filter((line) => line.startsWith('NEW_RELIC'))).to.eql([]);
      expect(values.filter((line) => line.startsWith('PLAIN_'))).to.eql([]);
    });
  }
});
