import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ChannelEndpointRepository,
  DalService,
  ExecutionDetailsRepository,
  JobRepository,
  MessageRepository,
  NotificationRepository,
  SubscriberRepository,
  SubscriberTombstoneRepository,
} from '@novu/dal';
import { SubscribersService, UserSession } from '@novu/testing';
import { expect } from 'chai';
import { SharedModule } from '../../../shared/shared.module';
import { SubscribersV1Module } from '../../subscribersV1.module';
import { RemoveSubscriberCommand } from './remove-subscriber.command';
import { RemoveSubscriber } from './remove-subscriber.usecase';

describe('Remove Subscriber', () => {
  let useCase: RemoveSubscriber;
  let session: UserSession;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SharedModule, SubscribersV1Module],
      providers: [],
    }).compile();

    session = new UserSession();
    await session.initialize();

    useCase = moduleRef.get<RemoveSubscriber>(RemoveSubscriber);
  });

  it('should remove a subscriber', async () => {
    const subscriberService = new SubscribersService(session.organization._id, session.environment._id);
    const subscriber = await subscriberService.createSubscriber();

    const res = await useCase.execute(
      RemoveSubscriberCommand.create({
        subscriberId: subscriber.subscriberId,
        environmentId: session.environment._id,
        organizationId: session.organization._id,
      })
    );

    expect(res).to.eql({ acknowledged: true, status: 'deleted' });
  });

  it('забирает адрес, имя и данные вызова из всех коллекций (Djinn)', async () => {
    const subscriberService = new SubscribersService(session.organization._id, session.environment._id);
    const subscriber = await subscriberService.createSubscriber();
    const _environmentId = session.environment._id;
    const owned = {
      _environmentId,
      _organizationId: session.organization._id,
      _subscriberId: subscriber._id,
    };
    const marker = { to: { email: 'marker@example.com' }, payload: { caseTitle: 'marker' } };
    const notificationRepository = new NotificationRepository();
    const jobRepository = new JobRepository();
    const executionDetailsRepository = new ExecutionDetailsRepository();
    const messageRepository = new MessageRepository();
    const channelEndpointRepository = new ChannelEndpointRepository();

    await notificationRepository._model.create({ ...owned, ...marker });
    await jobRepository._model.create({ ...owned, ...marker, overrides: { email: { html: 'marker' } } });
    await executionDetailsRepository._model.create({ ...owned, raw: 'marker' });
    await messageRepository._model.create({ ...owned, email: 'marker@example.com' });
    await channelEndpointRepository._model.create({
      _environmentId,
      _organizationId: session.organization._id,
      subscriberId: subscriber.subscriberId,
      identifier: 'marker',
      channel: 'chat',
      providerId: 'telegram',
      integrationIdentifier: 'telegram',
      type: 'telegram_chat',
      endpoint: { chatId: 'marker' },
    } as never);

    await useCase.execute(
      RemoveSubscriberCommand.create({
        subscriberId: subscriber.subscriberId,
        environmentId: _environmentId,
        organizationId: session.organization._id,
      })
    );

    const filter = { _environmentId, _subscriberId: subscriber._id };
    expect(await notificationRepository._model.countDocuments(filter)).to.equal(0);
    expect(await jobRepository._model.countDocuments(filter)).to.equal(0);
    expect(await executionDetailsRepository._model.countDocuments(filter)).to.equal(0);
    expect(await messageRepository._model.countDocuments(filter)).to.equal(0);
    expect(
      await channelEndpointRepository._model.countDocuments({
        _environmentId,
        subscriberId: subscriber.subscriberId,
      })
    ).to.equal(0);
  });

  it('сбой посреди очистки: повтор доводит удаление до конца (Djinn)', async () => {
    const subscriberService = new SubscribersService(session.organization._id, session.environment._id);
    const subscriber = await subscriberService.createSubscriber();
    const _environmentId = session.environment._id;
    const owned = { _environmentId, _organizationId: session.organization._id, _subscriberId: subscriber._id };
    const notificationRepository = new NotificationRepository();
    const jobRepository = new JobRepository();
    const executionDetailsRepository = new ExecutionDetailsRepository();
    await notificationRepository._model.create({ ...owned, payload: { caseTitle: 'marker' } });
    await jobRepository._model.create({ ...owned, payload: { caseTitle: 'marker' } });
    await executionDetailsRepository._model.create({ ...owned, raw: 'marker' });
    const command = RemoveSubscriberCommand.create({
      subscriberId: subscriber.subscriberId,
      environmentId: _environmentId,
      organizationId: session.organization._id,
    });
    const purge = (useCase as unknown as { purgeSubscriberData: { executionDetailsRepository: { delete: unknown } } })
      .purgeSubscriberData.executionDetailsRepository;
    const realDelete = purge.delete;
    purge.delete = async () => {
      purge.delete = realDelete;
      throw new Error('сбой посреди очистки');
    };

    let failure: Error | undefined;
    await useCase.execute(command).catch((error: Error) => {
      failure = error;
    });
    expect(failure?.message).to.equal('сбой посреди очистки');

    expect(await useCase.execute(command)).to.eql({ acknowledged: true, status: 'deleted' });

    const filter = { _environmentId, _subscriberId: subscriber._id };
    expect(await notificationRepository._model.countDocuments(filter)).to.equal(0);
    expect(await jobRepository._model.countDocuments(filter)).to.equal(0);
    expect(await executionDetailsRepository._model.countDocuments(filter)).to.equal(0);
  });

  it('данные вызова получают TTL 30 суток, а настройка меняет срок на действующей базе (Djinn)', async () => {
    const dal = new DalService();
    await dal.connect(process.env.MONGO_URL as string);
    const ttlOf = async (collection: string) =>
      (await dal.connection.collection(collection).indexes()).find((index) => index.name === 'createdAt_1')
        ?.expireAfterSeconds;

    for (const collection of ['notifications', 'jobs', 'messages', 'executiondetails', 'subscribertombstones']) {
      expect(await ttlOf(collection)).to.equal(30 * 24 * 60 * 60);
    }

    process.env.NOTIFICATION_RETENTION_DAYS = '7';
    await dal.connect(process.env.MONGO_URL as string);
    delete process.env.NOTIFICATION_RETENTION_DAYS;
    expect(await ttlOf('notifications')).to.equal(7 * 24 * 60 * 60);

    await dal.connect(process.env.MONGO_URL as string);
  });

  it('след ставится и для ещё не заведённого подписчика, ответ при этом 404 (Djinn)', async () => {
    const command = RemoveSubscriberCommand.create({
      subscriberId: 'queued-subscriber',
      environmentId: session.environment._id,
      organizationId: session.organization._id,
    });

    let failure: unknown;
    await useCase.execute(command).catch((error) => {
      failure = error;
    });

    expect(failure).to.be.instanceOf(NotFoundException);
    expect(await new SubscriberTombstoneRepository().exists(session.environment._id, 'queued-subscriber')).to.equal(true);
    expect(await useCase.execute(command)).to.eql({ acknowledged: true, status: 'deleted' });
  });

  it('повтор чистит записанное после первого вызова: прежний и заведённый заново _subscriberId (Djinn)', async () => {
    const subscriberService = new SubscribersService(session.organization._id, session.environment._id);
    const subscriber = await subscriberService.createSubscriber();
    const _environmentId = session.environment._id;
    const command = RemoveSubscriberCommand.create({
      subscriberId: subscriber.subscriberId,
      environmentId: _environmentId,
      organizationId: session.organization._id,
    });
    const notifications = new NotificationRepository();
    const messages = new MessageRepository();
    const subscribers = new SubscriberRepository();
    const owned = { _environmentId, _organizationId: session.organization._id };

    await useCase.execute(command);

    // шаг, взятый до удаления, дописал строки под прежним id, а запуск из очереди завёл подписчика заново
    await messages._model.create({ ...owned, _subscriberId: subscriber._id, subject: 'marker' });
    const recreated = await subscribers._model.create({ ...owned, subscriberId: subscriber.subscriberId });
    await notifications._model.create({ ...owned, _subscriberId: recreated._id, payload: { caseTitle: 'marker' } });

    expect(await useCase.execute(command)).to.eql({ acknowledged: true, status: 'deleted' });

    expect(await messages._model.countDocuments({ _environmentId, _subscriberId: subscriber._id })).to.equal(0);
    expect(await notifications._model.countDocuments({ _environmentId, _subscriberId: recreated._id })).to.equal(0);
    expect(await subscribers._model.countDocuments({ _environmentId, subscriberId: subscriber.subscriberId })).to.equal(0);
  });

  it('след нельзя записать: удаление отказывает и ничего не трогает (Djinn)', async () => {
    const subscriberService = new SubscribersService(session.organization._id, session.environment._id);
    const subscriber = await subscriberService.createSubscriber();
    const command = RemoveSubscriberCommand.create({
      subscriberId: subscriber.subscriberId,
      environmentId: session.environment._id,
      organizationId: session.organization._id,
    });
    const tombstones = (useCase as unknown as { purgeSubscriberData: { subscriberTombstoneRepository: { mark: unknown } } })
      .purgeSubscriberData.subscriberTombstoneRepository;
    const realMark = tombstones.mark;
    tombstones.mark = async () => {
      throw new Error('база недоступна');
    };

    let failure: Error | undefined;
    await useCase.execute(command).catch((error: Error) => {
      failure = error;
    });
    tombstones.mark = realMark;

    expect(failure?.message).to.equal('база недоступна');
    expect(
      await new SubscriberRepository()._model.countDocuments({
        _environmentId: session.environment._id,
        subscriberId: subscriber.subscriberId,
      })
    ).to.equal(1);
  });

  it('should throw a not found exception if subscriber to remove does not exist', async () => {
    try {
      await useCase.execute(
        RemoveSubscriberCommand.create({
          subscriberId: 'invalid-subscriber-id',
          environmentId: session.environment._id,
          organizationId: session.organization._id,
        })
      );
      expect(true, 'Should never reach this statement').to.be.false;
    } catch (e) {
      expect(e).to.be.instanceOf(NotFoundException);
    }
  });
});
