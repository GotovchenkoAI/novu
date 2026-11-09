import { Injectable, Logger, Module } from '@nestjs/common';
import { StorageService } from '@novu/application-generic';
import {
  ChannelConnectionRepository,
  ChannelEndpointRepository,
  ExecutionDetailsRepository,
  JobRepository,
  MessageRepository,
  NotificationRepository,
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
    private storageService: StorageService
  ) {}

  async execute(environmentId: string, subscriberId: string, subscriberInternalIds: unknown[]): Promise<void> {
    const byInternalId = { _environmentId: environmentId, _subscriberId: { $in: subscriberInternalIds } } as never;
    const byExternalId = { _environmentId: environmentId, subscriberId } as never;

    await this.deleteAttachments(byInternalId);
    await this.jobRepository.delete(byInternalId);
    await this.notificationRepository.delete(byInternalId);
    await this.executionDetailsRepository.delete(byInternalId);
    await this.messageRepository.delete(byInternalId);
    await this.channelEndpointRepository.delete(byExternalId);
    await this.channelConnectionRepository.delete(byExternalId);
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
