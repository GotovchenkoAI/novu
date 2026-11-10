import { Injectable } from '@nestjs/common';
import {
  Job,
  SqsService,
  StandardQueueService,
  SubscriberProcessQueueService,
  WorkflowQueueService,
} from '@novu/application-generic';
import { JobRepository, JobStatusEnum } from '@novu/dal';
import { JobTopicNameEnum } from '@novu/shared';
import { GetTransactionStatusCommand } from './get-transaction-status.command';

const OBSERVATION_LIMIT = 1000;
const CLOSED_STATUSES = new Set([JobStatusEnum.COMPLETED, JobStatusEnum.FAILED, JobStatusEnum.CANCELED, JobStatusEnum.SKIPPED]);

/** Наблюдение очередей, а не запрет позднего писателя: неизвестный запуск остаётся незавершённым. */
@Injectable()
export class GetTransactionStatus {
  constructor(
    private jobRepository: JobRepository,
    private workflowQueueService: WorkflowQueueService,
    private subscriberProcessQueueService: SubscriberProcessQueueService,
    private standardQueueService: StandardQueueService,
    private sqsService: SqsService
  ) {}

  async execute(command: GetTransactionStatusCommand): Promise<{ transactionId: string; terminal: boolean }> {
    const { environmentId, transactionId } = command;

    try {
      return { transactionId, terminal: await this.observe(environmentId, transactionId) };
    } catch {
      // Недоступность хранилища или очереди не становится разрешением на удаление.
      return { transactionId, terminal: false };
    }
  }

  private async observe(environmentId: string, transactionId: string): Promise<boolean> {
    const topics = [JobTopicNameEnum.WORKFLOW, JobTopicNameEnum.PROCESS_SUBSCRIBER, JobTopicNameEnum.STANDARD];
    if (topics.some((topic) => this.sqsService.isConfigured(topic))) return false;

    const unrelatedProducer = (job: Job) =>
      job.name !== transactionId || this.otherEnvironment(job.data?.environmentId, environmentId);
    // Производитель исчезает только после постановки потребителя: порядок чтения значим.
    if (!(await this.queueIsIdle(this.workflowQueueService.queue, unrelatedProducer))) return false;
    if (!(await this.queueIsIdle(this.subscriberProcessQueueService.queue, unrelatedProducer))) return false;

    const jobs = await this.jobRepository.find(
      { _environmentId: environmentId, transactionId },
      '_id status',
      { limit: OBSERVATION_LIMIT + 1, readPreference: 'primary' }
    );
    if (jobs.length === 0 || jobs.length > OBSERVATION_LIMIT) return false;
    if (jobs.some((job) => typeof job._id !== 'string' || !CLOSED_STATUSES.has(job.status))) return false;

    const ids = new Set(jobs.map((job) => job._id));

    return this.queueIsIdle(
      this.standardQueueService.queue,
      (job) => (!ids.has(job.name) && !ids.has(job.data?._id)) || this.otherEnvironment(job.data?._environmentId, environmentId)
    );
  }

  private otherEnvironment(observed: unknown, environmentId: string): boolean {
    return typeof observed === 'string' && observed !== environmentId;
  }

  private async queueIsIdle(queue: WorkflowQueueService['queue'], unrelated: (job: Job) => boolean): Promise<boolean> {
    const jobs = await queue.getJobs(
      ['waiting', 'active', 'delayed', 'paused', 'prioritized', 'waiting-children'],
      0,
      OBSERVATION_LIMIT
    );
    if (jobs.length > OBSERVATION_LIMIT) return false;

    return jobs.every((job) => !!job && typeof job.name === 'string' && unrelated(job));
  }
}
