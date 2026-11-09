import { JobStatusEnum } from '@novu/dal';
import { expect } from 'chai';
import sinon from 'sinon';
import { StoreSubscriberJobs } from './store-subscriber-jobs.usecase';

describe('Повтор запуска после сбоя MongoDB (Djinn)', () => {
  const build = (first: unknown) => {
    const usecase = Object.create(StoreSubscriberJobs.prototype);
    usecase.jobRepository = { findOne: sinon.stub().resolves(first) };
    usecase.addJob = { execute: sinon.stub().resolves() };

    return usecase;
  };

  it('шаги не записаны: запуск идёт обычным путём', async () => {
    expect(await build(null).resumeStored('e', 't', 's')).to.equal(false);
  });

  it('шаги записаны и первый в очереди: второй записи нет', async () => {
    const usecase = build({ _id: 'j', status: JobStatusEnum.COMPLETED });

    expect(await usecase.resumeStored('e', 't', 's')).to.equal(true);
    expect(usecase.addJob.execute.called).to.equal(false);
  });

  it('первый шаг не успел в очередь: ставится, второй записи нет', async () => {
    const usecase = build({ _id: 'j', status: JobStatusEnum.PENDING });

    expect(await usecase.resumeStored('e', 't', 's')).to.equal(true);
    expect(usecase.addJob.execute.calledOnce).to.equal(true);
  });
});
