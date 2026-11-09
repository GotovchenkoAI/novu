import { Test } from '@nestjs/testing';
import { StandardQueueService, SubscriberProcessQueueService, WorkflowQueueService } from '@novu/application-generic';
import { ExecutionDetailsRepository, JobRepository, MessageRepository, NotificationRepository } from '@novu/dal';
import { UserSession } from '@novu/testing';
import { expect } from 'chai';
import { SharedModule } from '../../../shared/shared.module';
import { EventsModule } from '../../events.module';
import { PurgeTransactionCommand } from './purge-transaction.command';
import { PurgeTransaction } from './purge-transaction.usecase';

describe('Очистка по transactionId (Djinn)', () => {
  let useCase: PurgeTransaction;
  let session: UserSession;
  let workflowQueue: WorkflowQueueService;
  let subscriberQueue: SubscriberProcessQueueService;
  const notifications = new NotificationRepository();
  const jobs = new JobRepository();
  const messages = new MessageRepository();
  const details = new ExecutionDetailsRepository();

  const seed = async (transactionId: string) => {
    const owned = {
      _environmentId: session.environment._id,
      _organizationId: session.organization._id,
      _subscriberId: session.subscriberProfile?._id,
      transactionId,
    };
    await notifications._model.create({ ...owned, payload: { caseTitle: 'marker' } });
    await jobs._model.create({ ...owned, subscriberId: 'sub', payload: { caseTitle: 'marker' }, overrides: { email: { html: 'marker' } } });
    await messages._model.create({ ...owned, subject: 'marker', payload: { caseTitle: 'marker' } });
    await details._model.create({ ...owned, raw: 'marker' });
  };
  const left = async (transactionId: string) => {
    const filter = { _environmentId: session.environment._id, transactionId };

    return [
      await notifications._model.countDocuments(filter),
      await jobs._model.countDocuments(filter),
      await messages._model.countDocuments(filter),
      await details._model.countDocuments(filter),
    ];
  };
  const command = (transactionId: string) =>
    PurgeTransactionCommand.create({
      userId: session.user._id,
      environmentId: session.environment._id,
      organizationId: session.organization._id,
      transactionId,
    });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SharedModule, EventsModule] }).compile();
    session = new UserSession();
    await session.initialize();
    useCase = moduleRef.get(PurgeTransaction);
    workflowQueue = moduleRef.get(WorkflowQueueService);
    subscriberQueue = moduleRef.get(SubscriberProcessQueueService);
    expect(moduleRef.get(StandardQueueService)).to.be.ok;
  });

  it('убирает строки всех коллекций и запуски в очереди, чужой запуск не трогает', async () => {
    await seed('tx-gone');
    await seed('tx-kept');
    await workflowQueue.add({ name: 'tx-gone', data: { payload: { caseTitle: 'marker' } } as never });
    await subscriberQueue.add({ name: 'tx-gone', data: { payload: { caseTitle: 'marker' } } as never });
    await workflowQueue.add({ name: 'tx-kept', data: { payload: {} } as never });

    expect(await useCase.execute(command('tx-gone'))).to.eql({ acknowledged: true });

    expect(await left('tx-gone')).to.eql([0, 0, 0, 0]);
    expect(await left('tx-kept')).to.eql([1, 1, 1, 1]);
    const names = async (service: { queue: { getJobs: (s: string[]) => Promise<{ name: string }[]> } }) =>
      (await service.queue.getJobs(['waiting'])).map((job) => job.name);
    expect(await names(workflowQueue)).to.not.include('tx-gone');
    expect(await names(subscriberQueue)).to.not.include('tx-gone');
    expect(await names(workflowQueue)).to.include('tx-kept');
  });

  it('повтор убирает записанное после первого вызова и не падает на пустом', async () => {
    await useCase.execute(command('tx-late'));
    await seed('tx-late');

    expect(await useCase.execute(command('tx-late'))).to.eql({ acknowledged: true });
    expect(await left('tx-late')).to.eql([0, 0, 0, 0]);
    expect(await useCase.execute(command('tx-late'))).to.eql({ acknowledged: true });
  });
});
