import { BadRequestException } from '@nestjs/common';
import { expect } from 'chai';
import { UserRegister } from './user-register.usecase';

describe('UserRegister (Djinn)', () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.DISABLE_USER_REGISTRATION;

  afterEach(() => {
    env.DISABLE_USER_REGISTRATION = previous;
  });

  it('закрыта, если её не открыли явно', async () => {
    delete env.DISABLE_USER_REGISTRATION;
    const usecase = new UserRegister(undefined as never, undefined as never, undefined as never, undefined as never);

    try {
      await usecase.execute({ email: 'x@example.com', password: 'x', firstName: 'x' } as never);
      throw new Error('должна была отказать');
    } catch (error) {
      expect(error).to.be.instanceOf(BadRequestException);
    }
  });
});
