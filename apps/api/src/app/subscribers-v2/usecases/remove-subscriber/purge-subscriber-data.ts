import { Injectable, Logger, Module } from '@nestjs/common';
import { StorageService } from '@novu/application-generic';
import {
  ChannelConnectionRepository,
  ChannelEndpointRepository,
  ExecutionDetailsRepository,
  JobRepository,
  MessageRepository,
  NotificationRepository,
  SubscriberRepository,
  SubscriberTombstoneRepository,
} from '@novu/dal';
import { SharedModule } from '../../../shared/shared.module';

/**
 * Djinn: удаление подписчика забирает всё, где лежат адрес, имя и данные вызова. Апстрим чистил
 * только `subscribers`, а `notifications.to`, `notifications.payload`, `jobs.payload`,
 * `jobs.overrides` оставались навсегда. Срок хранения остальных записей — TTL в `@novu/dal`.
 */
@Injectable()
export class PurgeSubscriberData {
  constructor(
    private notificationRepository: NotificationRepository,
    private jobRepository: JobRepository,
    private executionDetailsRepository: ExecutionDetailsRepository,
    private messageRepository: MessageRepository,
    private channelEndpointRepository: ChannelEndpointRepository,
    private channelConnectionRepository: ChannelConnectionRepository,
    private storageService: StorageService,
    private subscriberRepository: SubscriberRepository,
    private subscriberTombstoneRepository: SubscriberTombstoneRepository
  ) {}

  /**
   * След пишется первым: если его нельзя записать, удаление отказывает. Повтор находит и прежние
   * внутренние id, и заведённого заново подписчика, поэтому чистит записанное после первого вызова.
   */
  async execute(environmentId: string, subscriberId: string): Promise<{ subscriberInternalIds: unknown[]; known: boolean }> {
    const current: unknown[] = await this.subscriberRepository._model.distinct('_id', {
      subscriberId,
      _environmentId: environmentId,
    });
    const earlier = await this.subscriberTombstoneRepository.find(environmentId, subscriberId);
    await this.subscriberTombstoneRepository.mark(environmentId, subscriberId, current);

    const subscriberInternalIds = [...current, ...(earlier?._subscriberIds ?? [])];
    const byInternalId = { _environmentId: environmentId, _subscriberId: { $in: subscriberInternalIds } } as never;
    const byExternalId = { _environmentId: environmentId, subscriberId } as never;

    await this.deleteAttachments(byInternalId);
    await this.jobRepository.delete(byInternalId);
    await this.notificationRepository.delete(byInternalId);
    await this.executionDetailsRepository.delete(byInternalId);
    await this.messageRepository.delete(byInternalId);
    await this.channelEndpointRepository.delete(byExternalId);
    await this.channelConnectionRepository.delete(byExternalId);

    return { subscriberInternalIds, known: current.length > 0 || earlier !== null };
  }

  /** Файл живёт в хранилище, пока идёт цепочка; цепочка удалённого подписчика уже не дойдёт. */
  private async deleteAttachments(filter: never): Promise<void> {
    const notifications = await this.notificationRepository.find(filter, 'payload.attachments');
    const paths = notifications.flatMap((notification) =>
      ((notification.payload?.attachments ?? []) as { storagePath?: string }[]).map((file) => file.storagePath)
    );

    for (const path of new Set(paths.filter(Boolean) as string[])) {
      await this.storageService.deleteFile(path).catch((error: Error) => {
        Logger.warn(`Attachment was not removed: ${error.name}`, PurgeSubscriberData.name);
      });
    }
  }
}

@Module({
  imports: [SharedModule],
  providers: [PurgeSubscriberData, ChannelEndpointRepository, ChannelConnectionRepository],
  exports: [PurgeSubscriberData],
})
export class PurgeSubscriberDataModule {}
