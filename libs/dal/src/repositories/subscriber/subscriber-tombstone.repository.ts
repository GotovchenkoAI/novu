import { createHash } from 'node:crypto';
import mongoose from 'mongoose';

export const SUBSCRIBER_TOMBSTONES_COLLECTION = 'subscribertombstones';

type SubscriberTombstone = {
  _id: string;
  _environmentId: string;
  _subscriberIds: unknown[];
  createdAt: Date;
};

/**
 * Djinn: след удаления в MongoDB, а не в Redis: он переживает потерю Redis, и удаление без него
 * отказывает. Хранит внутренние id, поэтому повтор DELETE находит строки, записанные после первого
 * вызова, в том числе под прежним `_subscriberId`. Вместо `subscriberId` — его хэш. Живёт срок
 * хранения данных вызова (`RETENTION_COLLECTIONS`): дольше строкам, которые он находит, не жить.
 */
export class SubscriberTombstoneRepository {
  private get collection() {
    return mongoose.connection.collection<SubscriberTombstone>(SUBSCRIBER_TOMBSTONES_COLLECTION);
  }

  private idOf(environmentId: string, subscriberId: string): string {
    return `${environmentId}:${createHash('sha256').update(subscriberId).digest('hex').slice(0, 32)}`;
  }

  async find(environmentId: string, subscriberId: string): Promise<SubscriberTombstone | null> {
    return await this.collection.findOne({ _id: this.idOf(environmentId, subscriberId) });
  }

  async exists(environmentId: string, subscriberId: string): Promise<boolean> {
    return (await this.find(environmentId, subscriberId)) !== null;
  }

  async mark(environmentId: string, subscriberId: string, subscriberInternalIds: unknown[]): Promise<void> {
    await this.collection.updateOne(
      { _id: this.idOf(environmentId, subscriberId) },
      {
        $addToSet: { _subscriberIds: { $each: subscriberInternalIds } } as never,
        $setOnInsert: { _environmentId: environmentId, createdAt: new Date() },
      },
      { upsert: true }
    );
  }
}
