import { JobStatusEnum } from '@novu/dal';
import { expect } from 'chai';
import { GetTransactionStatus } from './get-transaction-status.usecase';

describe('Наблюдение окончания transaction перед очисткой (Djinn)', () => {
  function harness() {
    const order: string[] = [];
    const queues: Record<string, unknown[]> = { workflow: [], subscriber: [], standard: [] };
    const stored = [{ _id: 'job-id', status: JobStatusEnum.COMPLETED }];
    let configuredSqs = false;
    let storeFailed = false;
    let unavailableQueue: string | undefined;
    const queue = (name: string) => ({
      queue: {
        getJobs: async (states: string[], start: number, end: number) => {
          order.push(name);
          if (unavailableQueue === name) throw new Error('queue-unavailable');
          return queues[name].filter((entry) => !entry || states.includes((entry as { state?: string }).state ?? 'active')).slice(start, end + 1);
        },
      },
    });
    const repository = {
      find: async (filter: { _environmentId: string; transactionId: string }) => {
        order.push('mongo');
        if (storeFailed) throw new Error('store-unavailable');
        return filter._environmentId === 'environment-id' && filter.transactionId === 'transaction-id' ? stored : [];
      },
    };
    const usecase = new GetTransactionStatus(
      repository as never,
      queue('workflow') as never,
      queue('subscriber') as never,
      queue('standard') as never,
      { isConfigured: () => configuredSqs } as never
    );
    const execute = () => usecase.execute({ environmentId: 'environment-id', transactionId: 'transaction-id' } as never);

    return { execute, queues, stored, order, configureSqs: () => { configuredSqs = true; }, failStore: () => { storeFailed = true; }, failQueue: (name: string) => { unavailableQueue = name; } };
  }

  it('даёт разрешение для известной закрытой цепочки после чтения производителей и очереди шагов', async () => {
    const state = harness();
    state.stored.push(...[JobStatusEnum.FAILED, JobStatusEnum.CANCELED, JobStatusEnum.SKIPPED].map((status) => ({ _id: status, status })));
    expect(await state.execute()).to.deep.equal({ transactionId: 'transaction-id', terminal: true });
    expect(state.order).to.deep.equal(['workflow', 'subscriber', 'mongo', 'standard']);
  });

  it('не считает отсутствующие Mongo jobs завершением', async () => {
    const state = harness();
    state.stored.length = 0;
    expect((await state.execute()).terminal).to.equal(false);
  });

  for (const status of [JobStatusEnum.PENDING, JobStatusEnum.QUEUED, JobStatusEnum.RUNNING, JobStatusEnum.DELAYED, JobStatusEnum.MERGED]) {
    it(`не закрывает цепочку в состоянии ${status}`, async () => {
      const state = harness();
      state.stored[0].status = status;
      expect((await state.execute()).terminal).to.equal(false);
    });
  }

  for (const stage of ['workflow', 'subscriber', 'standard']) {
    it(`видит взятый шаг ${stage}, включая старое schedule extension`, async () => {
      const state = harness();
      state.queues[stage] = stage === 'standard'
        ? [{ id: 'job-id-ext1', name: 'job-id', data: { _environmentId: 'environment-id', _id: 'job-id' } }]
        : [{ name: 'transaction-id', data: { environmentId: 'environment-id' } }];
      expect((await state.execute()).terminal).to.equal(false);
    });

    it(`не выдаёт разрешение при насыщении ограниченной выборки ${stage}`, async () => {
      const state = harness();
      state.queues[stage] = Array.from({ length: 1001 }, (_, index) => ({ name: `other-${index}`, data: {} }));
      expect((await state.execute()).terminal).to.equal(false);
    });
  }

  for (const queuedState of ['waiting', 'active', 'delayed', 'paused', 'prioritized', 'waiting-children']) {
    it(`ожидает задачу в состоянии ${queuedState}`, async () => {
      const state = harness();
      state.queues.workflow = [{ name: 'transaction-id', state: queuedState, data: { environmentId: 'environment-id' } }];
      expect((await state.execute()).terminal).to.equal(false);
    });
  }

  it('не закрывает усечённую Mongo-цепочку', async () => {
    const state = harness();
    state.stored.push(...Array.from({ length: 1000 }, (_, index) => ({ _id: `job-${index}`, status: JobStatusEnum.COMPLETED })));
    expect((await state.execute()).terminal).to.equal(false);
  });

  it('изолирует одинаковый transaction другого окружения', async () => {
    const state = harness();
    state.queues.workflow = [{ name: 'transaction-id', data: { environmentId: 'other-environment' } }];
    state.queues.subscriber = [{ name: 'transaction-id', data: { environmentId: 'other-environment' } }];
    state.queues.standard = [{ name: 'job-id', data: { _environmentId: 'other-environment', _id: 'job-id' } }];
    expect((await state.execute()).terminal).to.equal(true);
  });

  it('считает исчезнувший при чтении entry неопределённостью', async () => {
    const state = harness();
    state.queues.standard = [null];
    expect((await state.execute()).terminal).to.equal(false);
  });

  it('не угадывает окружение записи с подходящим transaction', async () => {
    const state = harness();
    state.queues.workflow = [{ name: 'transaction-id', data: {} }];
    expect((await state.execute()).terminal).to.equal(false);
  });

  it('при недоступности Mongo оставляет очистку повторяемой', async () => {
    const state = harness();
    state.failStore();
    expect(await state.execute()).to.deep.equal({ transactionId: 'transaction-id', terminal: false });
  });

  it('не объявляет дренирование для очередей SQS', async () => {
    const state = harness();
    state.configureSqs();
    expect((await state.execute()).terminal).to.equal(false);
  });

  it('при недоступности Redis оставляет очистку повторяемой', async () => {
    const state = harness();
    state.failQueue('standard');
    expect((await state.execute()).terminal).to.equal(false);
  });
});
