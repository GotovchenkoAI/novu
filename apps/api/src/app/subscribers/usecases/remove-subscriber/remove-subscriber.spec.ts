import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ChannelEndpointRepository,
  DalService,
  ExecutionDetailsRepository,
  JobRepository,
  MessageRepository,
  NotificationRepository,
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

  it('данные вызова получают TTL 30 суток, а настройка меняет срок на действующей базе (Djinn)', async () => {
    const dal = new DalService();
    await dal.connect(process.env.MONGO_URL as string);
    const ttlOf = async (collection: string) =>
      (await dal.connection.collection(collection).indexes()).find((index) => index.name === 'createdAt_1')
        ?.expireAfterSeconds;

    for (const collection of ['notifications', 'jobs', 'messages', 'executiondetails']) {
      expect(await ttlOf(collection)).to.equal(30 * 24 * 60 * 60);
    }

    process.env.NOTIFICATION_RETENTION_DAYS = '7';
    await dal.connect(process.env.MONGO_URL as string);
    delete process.env.NOTIFICATION_RETENTION_DAYS;
    expect(await ttlOf('notifications')).to.equal(7 * 24 * 60 * 60);

    await dal.connect(process.env.MONGO_URL as string);
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
