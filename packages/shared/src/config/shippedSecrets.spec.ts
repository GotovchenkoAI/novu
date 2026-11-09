import { describe, expect, it } from 'vitest';
import { refuseShippedSecrets } from './shippedSecrets';

describe('refuseShippedSecrets (Djinn)', () => {
  const real = 'd41d8cd98f00b204e9800998ecf8427e';

  it('пускает настоящий секрет, не требует необязательный', () => {
    expect(() => refuseShippedSecrets({ JWT_SECRET: real }, ['JWT_SECRET'], ['NOVU_API_KEY'])).not.toThrow();
  });

  it.each([undefined, '', '   '])('не пускает пустой обязательный: %s', (value) => {
    expect(() => refuseShippedSecrets({ JWT_SECRET: value }, ['JWT_SECRET'])).toThrow('JWT_SECRET is not set');
  });

  it.each(['LOCAL_ONLY_CHANGE_ME', 'TEST_CHANGE9s', '<ENCRYPTION_KEY_MUST_BE_32_LONG>', 'NOVU_SECRET_KEY'])(
    'не пускает значение из репозитория и не печатает его: %s',
    (value) => {
      const run = () => refuseShippedSecrets({ STORE_ENCRYPTION_KEY: value }, ['STORE_ENCRYPTION_KEY']);

      expect(run).toThrow('STORE_ENCRYPTION_KEY holds a value published in the repository');
      expect(run).not.toThrow(value);
    }
  );

  it('необязательный ключ тоже не может быть значением из репозитория', () => {
    expect(() => refuseShippedSecrets({ NOVU_API_KEY: 'NOVU_API_KEY' }, [], ['NOVU_API_KEY'])).toThrow('NOVU_API_KEY');
  });
});
