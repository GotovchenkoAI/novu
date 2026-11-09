import { HttpException } from '@nestjs/common';
import { JobEntity } from '@novu/dal';
import { expect } from 'chai';
import { bridgeRetryInMs } from './run-job.usecase';

const bridgeError = (code: string) => new HttpException({ message: 'Unable to reach Bridge Endpoint', code }, 400);
const job = (scheduleExtensionsCount?: number) => ({ scheduleExtensionsCount }) as unknown as JobEntity;

describe('bridgeRetryInMs (Djinn)', () => {
  it('API перезапускается: шаг ждёт', () => {
    const retryInMs = bridgeRetryInMs(bridgeError('ECONNREFUSED'), job());

    expect(retryInMs).to.be.within(15_000, 30_000);
  });

  it('прочие ошибки идут обычным отказом', () => {
    expect(bridgeRetryInMs(bridgeError('BRIDGE_UNEXPECTED_RESPONSE'), job())).to.equal(null);
    expect(bridgeRetryInMs(new Error('boom'), job())).to.equal(null);
  });

  it('ожидание ограничено', () => {
    expect(bridgeRetryInMs(bridgeError('ECONNREFUSED'), job(39))).to.not.equal(null);
    expect(bridgeRetryInMs(bridgeError('ECONNREFUSED'), job(40))).to.equal(null);
  });
});
