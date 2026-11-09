import { describe, expect, it } from 'vitest';
import { decodeJwtPayload } from './jwt-manager';

const token = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

describe('decodeJwtPayload (Djinn)', () => {
  it('читает кириллицу в base64url, на которой `atob` падал', () => {
    const name = 'Спайк Админ ё?>~';
    const encoded = token({ firstName: name });

    expect(encoded).toMatch(/[-_]/);
    expect(decodeJwtPayload<{ firstName: string }>(encoded).firstName).toBe(name);
  });
});
