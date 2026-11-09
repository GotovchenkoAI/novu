import { expect } from 'chai';
import { SubscriberJobBound } from './subscriber-job-bound.usecase';

describe('След удалённого подписчика в воркере (Djinn)', () => {
  const usecaseWith = (exists: boolean | Error) => {
    const usecase = Object.create(SubscriberJobBound.prototype);
    const touched = { workflow: false };
    usecase.logger = { assign: () => undefined };
    usecase.subscriberTombstoneRepository = {
      exists: async () => {
        if (exists instanceof Error) throw exists;

        return exists;
      },
    };
    usecase.getWorkflow = async () => {
      touched.workflow = true;

      return null;
    };

    return { usecase, touched };
  };
  const job = { environmentId: 'env-1', subscriber: { subscriberId: 'spike-sub' }, payload: {} };

  it('запуск из очереди для удалённого подписчика ничего не создаёт', async () => {
    const { usecase, touched } = usecaseWith(true);

    expect(await usecase.execute(job)).to.equal(undefined);
    expect(touched.workflow).to.equal(false);
  });

  it('след нельзя прочитать: запуск падает, а не идёт дальше', async () => {
    const { usecase, touched } = usecaseWith(new Error('база недоступна'));
    let failure: Error | undefined;

    await usecase.execute(job).catch((error: Error) => {
      failure = error;
    });

    expect(failure?.message).to.equal('база недоступна');
    expect(touched.workflow).to.equal(false);
  });

  it('следа нет: запуск идёт дальше', async () => {
    const { usecase, touched } = usecaseWith(false);

    await usecase.execute(job).catch(() => undefined);

    expect(touched.workflow).to.equal(true);
  });
});
