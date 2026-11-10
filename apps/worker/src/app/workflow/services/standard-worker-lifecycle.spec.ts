import { EventEmitter } from 'node:events';
import {
  DelayedError,
  IStandardDataDto,
  Job,
  Processor,
  StandardWorkerService,
  WorkerBaseService,
} from '@novu/application-generic';
import { expect } from 'chai';
import sinon from 'sinon';
import { StandardWorker } from './standard.worker';

type StandardJob = Job<IStandardDataDto, unknown, string>;
type WorkerInternals = {
  getWorkerProcessor: () => Processor;
  wrapForSqs: (processor: Processor) => (data: IStandardDataDto, meta: { receiveCount: number }) => Promise<void>;
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });

  return { promise, release };
}

describe('Запись исхода StandardWorker до освобождения Bull job (Djinn)', () => {
  afterEach(() => sinon.restore());

  function harness(operation: Processor, backoff = false) {
    let process!: Processor;
    const events = new EventEmitter();
    const writes: string[] = [];
    const completion = deferred();
    const failure = deferred();
    const completedStarted = deferred();
    const failedStarted = deferred();
    sinon.stub(StandardWorkerService.prototype, 'createWorker').callsFake((processor) => { process = processor as Processor; });
    sinon.stub(WorkerBaseService.prototype, 'bullMqWorker').get(() => events);
    sinon.stub(StandardWorker.prototype as unknown as WorkerInternals, 'getWorkerProcessor').returns(operation);

    const worker = new StandardWorker(
      { execute: async () => { failedStarted.release(); await failure.promise; writes.push('last-failure'); } } as never,
      { shouldBackoff: () => backoff } as never,
      { execute: async () => { writes.push('failed'); } } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findOne: async () => ({ step: {} }),
        updateOne: async () => { completedStarted.release(); await completion.promise; writes.push('completed'); },
      } as never,
      { isConfigured: () => false } as never,
      { setContext: () => {} } as never,
      {} as never
    );
    const job = {
      id: 'job-id',
      data: { _id: 'job-id', _environmentId: 'environment-id', _organizationId: 'organization-id', _userId: 'user-id' },
      attemptsMade: 0,
      opts: { attempts: 3 },
      timestamp: Date.now(),
      moveToDelayed: sinon.stub().resolves(),
    } as unknown as StandardJob;

    return { worker, process: (input = job) => process(input, 'token'), job, events, writes, completion, failure, completedStarted, failedStarted };
  }

  it('не заканчивает обработку до записи успешного исхода', async () => {
    const state = harness(async () => undefined);
    let settled = false;
    const result = state.process().then(() => { settled = true; });
    // До исправления запись начиналась лишь после completed, за пределами процессора.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).to.equal(false);
    expect(state.writes).to.deep.equal([]);
    state.completion.release();
    await result;
    state.events.emit('completed', state.job);
    await Promise.resolve();
    expect(state.writes).to.deep.equal(['completed']);
  });

  it('ждёт последнюю попытку до отказа и не повторяет запись по failed event', async () => {
    const error = new Error('temporary-provider-failure');
    const state = harness(async () => { throw error; }, true);
    state.job.attemptsMade = 2;
    let settled = false;
    const result = state.process().catch((caught: unknown) => { settled = true; return caught; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).to.equal(false);
    state.failure.release();
    expect(await result).to.equal(error);
    state.job.attemptsMade++;
    state.events.emit('failed', state.job, error);
    await Promise.resolve();
    expect(state.writes).to.deep.equal(['failed', 'last-failure']);
  });

  for (const attemptsMade of [0, 1]) {
    it(`оставляет повторяемую попытку ${attemptsMade + 1} без конечного исхода`, async () => {
      const error = new Error('temporary-provider-failure');
      const state = harness(async () => { throw error; }, true);
      state.job.attemptsMade = attemptsMade;
      expect(await state.process().catch((caught: unknown) => caught)).to.equal(error);
      state.job.attemptsMade++;
      state.events.emit('failed', state.job, error);
      await Promise.resolve();
      expect(state.writes).to.deep.equal([]);
    });
  }

  it('записывает неповторяемую ошибку один раз', async () => {
    const error = new Error('permanent-provider-failure');
    const state = harness(async () => { throw error; });
    expect(await state.process().catch((caught: unknown) => caught)).to.equal(error);
    state.job.attemptsMade++;
    state.events.emit('failed', state.job, error);
    await Promise.resolve();
    expect(state.writes).to.deep.equal(['failed']);
  });

  it('возвращает сбой MongoDB в delayed без записи окончательной ошибки', async () => {
    const outage = Object.assign(new Error('connect ECONNREFUSED'), { name: 'MongoServerSelectionError' });
    const state = harness(async () => { throw outage; });
    const outcome = await state.process().catch((caught: unknown) => caught);
    expect(outcome).to.be.instanceOf(DelayedError);
    expect((state.job.moveToDelayed as sinon.SinonStub).callCount).to.equal(1);
    expect(state.writes).to.deep.equal([]);
  });

  it('не превращает уже отложенный шаг в ошибку', async () => {
    const delayed = new DelayedError();
    const state = harness(async () => { throw delayed; });
    expect(await state.process().catch((caught: unknown) => caught)).to.equal(delayed);
    expect(state.writes).to.deep.equal([]);
  });

  it('сохраняет исход exhausted-stalled без завершившегося процессора', async () => {
    const state = harness(async () => undefined);
    state.events.emit('failed', state.job, new Error('job stalled more than allowable limit'));
    for (let index = 0; index < 10; index++) await Promise.resolve();
    expect(state.writes).to.deep.equal(['failed']);
  });

  it('SQS записывает успех один раз через свой callback', async () => {
    const state = harness(async () => undefined);
    state.completion.release();
    const sqs = (state.worker as unknown as WorkerInternals).wrapForSqs(async () => undefined);
    await sqs(state.job.data, { receiveCount: 1 });
    expect(state.writes).to.deep.equal(['completed']);
  });

  it('SQS повторяет первую ошибку и завершает третью ровно один раз', async () => {
    const error = new Error('temporary-provider-failure');
    const state = harness(async () => undefined, true);
    state.failure.release();
    const sqs = (state.worker as unknown as WorkerInternals).wrapForSqs(async () => { throw error; });
    expect(await sqs(state.job.data, { receiveCount: 1 }).catch((caught: unknown) => caught)).to.equal(error);
    expect(state.writes).to.deep.equal([]);
    await sqs(state.job.data, { receiveCount: 3 });
    expect(state.writes).to.deep.equal(['failed', 'last-failure']);
  });
});
