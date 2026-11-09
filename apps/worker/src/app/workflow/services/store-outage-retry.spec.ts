import { BadRequestException } from '@nestjs/common';
import { isStoreOutage, WorkerBaseService } from '@novu/application-generic';
import { JobTopicNameEnum } from '@novu/shared';
import { expect } from 'chai';
import sinon from 'sinon';

describe('Сбой хранилища не теряет задачу (Djinn)', () => {
  const mongoDown = Object.assign(new Error('connect ECONNREFUSED'), { name: 'MongoServerSelectionError' });
  const run = async (error: Error, timestamp = Date.now()) => {
    const worker = new WorkerBaseService(JobTopicNameEnum.WORKFLOW, {} as never);
    const job = { id: 'j', data: {}, timestamp, moveToDelayed: sinon.stub().resolves() };
    const wrapped = (worker as never as { wrapForBullMQ: (p: () => Promise<void>) => (j: unknown, t: string) => Promise<void> }).wrapForBullMQ(
      async () => {
        throw error;
      }
    );

    return { job, outcome: await wrapped(job, 'token').catch((e: Error) => e) };
  };

  it('сбой MongoDB возвращает задачу в очередь дольше срока захвата шага', async () => {
    const { job, outcome } = await run(mongoDown);

    expect(job.moveToDelayed.callCount).to.equal(1);
    expect(job.moveToDelayed.firstCall.args[0]).to.be.greaterThan(Date.now() + 60_000);
    expect(job.moveToDelayed.firstCall.args[1]).to.equal('token');
    expect((outcome as Error).constructor.name).to.equal('DelayedError');
  });

  it('ошибка запроса идёт прежним путём', async () => {
    const invalid = new BadRequestException('bad');
    const { job, outcome } = await run(invalid);

    expect(job.moveToDelayed.called).to.equal(false);
    expect(outcome).to.equal(invalid);
  });

  it('ожидание ограничено часом', async () => {
    const { job, outcome } = await run(mongoDown, Date.now() - 2 * 60 * 60 * 1000);

    expect(job.moveToDelayed.called).to.equal(false);
    expect(outcome).to.equal(mongoDown);
  });

  it('узнаёт сбой по имени и по сообщению', () => {
    expect(isStoreOutage(mongoDown)).to.equal(true);
    expect(isStoreOutage(new Error('Operation `jobs.findOne()` buffering timed out after 10000ms'))).to.equal(true);
    expect(isStoreOutage(new Error('Connection pool for mongodb:27017 was cleared because another operation failed with: "interrupted at shutdown"'))).to.equal(true);
    expect(isStoreOutage(new Error('getaddrinfo ENOTFOUND mongodb'))).to.equal(true);
    expect(isStoreOutage(new Error('boom'))).to.equal(false);
  });
});
