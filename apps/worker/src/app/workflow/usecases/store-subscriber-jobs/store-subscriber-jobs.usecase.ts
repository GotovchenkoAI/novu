import { Injectable, Logger } from '@nestjs/common';
import {
  buildStepRunTraceFromJob,
  BulkCreateExecutionDetails,
  InstrumentUsecase,
  mapEventTypeToTitle,
  StepRunRepository,
  TraceLogRepository,
} from '@novu/application-generic';
import { DalException, JobEntity, JobRepository, JobStatusEnum } from '@novu/dal';
import { StepTypeEnum } from '@novu/shared';
import { PlatformException } from '../../../shared/utils';
import { AddJob } from '../add-job';
import { StoreSubscriberJobsCommand } from './store-subscriber-jobs.command';

@Injectable()
export class StoreSubscriberJobs {
  constructor(
    private addJob: AddJob,
    private jobRepository: JobRepository,
    protected bulkCreateExecutionDetails: BulkCreateExecutionDetails,
    private stepRunRepository: StepRunRepository,
    private traceLogRepository: TraceLogRepository
  ) {}

  /**
   * Djinn: задача вернулась в очередь после сбоя MongoDB, а шаги этого запуска уже записаны. Вторая
   * запись дала бы второе письмо. Если первый шаг не успел в очередь, ставим его.
   */
  async resumeStored(environmentId: string, transactionId: string, subscriberInternalId: string): Promise<boolean> {
    const first = await this.jobRepository.findOne({
      _environmentId: environmentId,
      transactionId,
      _subscriberId: subscriberInternalId,
      type: StepTypeEnum.TRIGGER,
    });

    if (!first) return false;

    if (first.status === JobStatusEnum.PENDING) {
      await this.addJob.execute({
        userId: first._userId,
        environmentId: first._environmentId,
        organizationId: first._organizationId,
        jobId: first._id,
        job: first,
      });
    }

    return true;
  }

  @InstrumentUsecase()
  async execute(command: StoreSubscriberJobsCommand) {
    let storedJobs;
    try {
      storedJobs = await this.jobRepository.storeJobs(command.jobs);
    } catch (e) {
      if (e instanceof DalException) {
        throw new PlatformException(e.message);
      }
      throw e;
    }

    await this.stepRunRepository.createMany(storedJobs, { status: JobStatusEnum.QUEUED });

    await this.emitStepCreatedTraces(storedJobs);

    const firstJob = storedJobs[0];

    const addJobCommand = {
      userId: firstJob._userId,
      environmentId: firstJob._environmentId,
      organizationId: firstJob._organizationId,
      jobId: firstJob._id,
      job: firstJob,
      bridge: firstJob.bridge,
      controlVariables: firstJob.controlVariables,
    };

    await this.addJob.execute(addJobCommand);
  }

  private async emitStepCreatedTraces(storedJobs: JobEntity[]): Promise<void> {
    if (storedJobs.length === 0) {
      return;
    }

    try {
      await this.traceLogRepository.createStepRun(
        storedJobs.map((job) =>
          buildStepRunTraceFromJob(job, {
            event_type: 'step_created',
            title: mapEventTypeToTitle('step_created'),
            status: 'success',
          })
        )
      );
    } catch (error) {
      Logger.error(
        { err: error, jobIds: storedJobs.map((job) => job._id) },
        'Failed to emit step_created traces'
      );
    }
  }
}
