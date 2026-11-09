import { SubscriberSourceEnum } from '@novu/shared';
import { mapSubscribersToJobs } from './subscribers.utils';

describe('mapSubscribersToJobs (Djinn)', () => {
  it('имя задачи не содержит subscriberId: оно попадает в поток событий BullMQ', () => {
    const [job] = mapSubscribersToJobs(
      SubscriberSourceEnum.SINGLE,
      [{ subscriberId: 'spike-sub' }],
      { transactionId: 'txn-1', template: { _id: 'tpl' } } as never
    );

    expect(job.name).toBe('txn-1');
    expect(job.data.subscriber.subscriberId).toBe('spike-sub');
  });
});
