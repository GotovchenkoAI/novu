import { Injectable } from '@nestjs/common';
import {
  buildFeedKey,
  buildMessageCountKey,
  InvalidateCacheService,
  StandardQueueService,
  StorageService,
  SubscriberProcessQueueService,
  WorkflowQueueService,
} from '@novu/application-generic';
import { ExecutionDetailsRepository, JobRepository, MessageRepository, NotificationRepository } from '@novu/dal';
import { deleteAttachmentsOf } from '../../../subscribers-v2/usecases/remove-subscriber/purge-subscriber-data';
import { PurgeTransactionCommand } from './purge-transaction.command';

type NamedQueue = { getJobs: (states: string[]) => Promise<{ name: string; remove: () => Promise<void> }[]> };

/**
 * Djinn: удаление дела при живом аккаунте. Название дела лежит в `notifications.payload`,
 * `jobs.payload`, `jobs.overrides`, `messages`; строка ленты остаётся видна. Вызов можно повторять:
 * повтор после горизонта убирает то, что шаг в работе дописал после первого вызова.
 */
@Injectable()
export class PurgeTransaction {
  constructor(
    private notificationRepository: NotificationRepository,
    private jobRepository: JobRepository,
    private messageRepository: MessageRepository,
    private executionDetailsRepository: ExecutionDetailsRepository,
    private workflowQueueService: WorkflowQueueService,
    private subscriberProcessQueueService: SubscriberProcessQueueService,
    private standardQueueService: StandardQueueService,
    private storageService: StorageService,
    private invalidateCache: InvalidateCacheService
  ) {}

  async execute({ environmentId, transactionId }: PurgeTransactionCommand): Promise<{ acknowledged: boolean }> {
    const filter = { _environmentId: environmentId, transactionId } as never;
    const jobs = await this.jobRepository.find(filter, '_id subscriberId scheduleExtensionsCount');

    await this.removeQueued(this.workflowQueueService.queue, transactionId);
    await this.removeQueued(this.subscriberProcessQueueService.queue, transactionId);
    for (const job of jobs) {
      for (const id of [job._id, `${job._id}-ext${job.scheduleExtensionsCount ?? 0}`]) {
        await (await this.standardQueueService.queue.getJob(id))?.remove().catch(() => undefined);
      }
    }

    await deleteAttachmentsOf(this.notificationRepository, filter, this.storageService);
    await this.jobRepository.delete(filter);
    await this.notificationRepository.delete(filter);
    await this.executionDetailsRepository.delete(filter);
    await this.messageRepository.delete(filter);

    for (const subscriberId of new Set(jobs.map((job) => job.subscriberId))) {
      const key = { subscriberId, _environmentId: environmentId };
      await this.invalidateCache.invalidateQuery({ key: buildFeedKey().invalidate(key) });
      await this.invalidateCache.invalidateQuery({ key: buildMessageCountKey().invalidate(key) });
    }

    return { acknowledged: true };
  }

  /** Запуск ещё в очереди: в его данных лежат `payload` и `overrides`. Взятый воркером не снимается. */
  private async removeQueued(queue: unknown, transactionId: string): Promise<void> {
    // BullMQ 3.10.4: состояния `prioritized` нет (оно появилось в 4.0) — задачи с приоритетом лежат
    // в списке ожидания и попадают сюда через `waiting`.
    const waiting = await (queue as NamedQueue).getJobs(['waiting', 'delayed', 'paused']);

    await Promise.all(
      waiting.filter((job) => job?.name === transactionId).map((job) => job.remove().catch(() => undefined))
    );
  }
}
