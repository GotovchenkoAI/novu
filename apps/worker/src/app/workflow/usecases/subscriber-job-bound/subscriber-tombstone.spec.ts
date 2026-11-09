import { isSubscriberDeleted, markSubscriberDeleted } from '@novu/application-generic';
import { expect } from 'chai';
import { SubscriberJobBound } from './subscriber-job-bound.usecase';

const fakeCache = () => {
  const store = new Map<string, string>();

  return {
    store,
    cacheEnabled: () => true,
    client: {
      set: async (key: string, value: string) => store.set(key, value),
      get: async (key: string) => store.get(key) ?? null,
    },
  } as never;
};

describe('Метка удалённого подписчика (Djinn)', () => {
  it('ключ не содержит subscriberId, метка своя на окружение', async () => {
    const cache = fakeCache();
    await markSubscriberDeleted(cache, 'env-1', 'spike-sub');

    expect([...(cache as { store: Map<string, string> }).store.keys()].join()).to.not.contain('spike-sub');
    expect(await isSubscriberDeleted(cache, 'env-1', 'spike-sub')).to.equal(true);
    expect(await isSubscriberDeleted(cache, 'env-2', 'spike-sub')).to.equal(false);
    expect(await isSubscriberDeleted(cache, 'env-1', 'other')).to.equal(false);
  });

  it('запуск из очереди для удалённого подписчика ничего не создаёт', async () => {
    const cache = fakeCache();
    await markSubscriberDeleted(cache, 'env-1', 'spike-sub');

    const usecase = Object.create(SubscriberJobBound.prototype);
    let touchedWorkflow = false;
    usecase.logger = { assign: () => undefined };
    usecase.cacheService = cache;
    usecase.getWorkflow = async () => {
      touchedWorkflow = true;

      return null;
    };

    const result = await usecase.execute({ environmentId: 'env-1', subscriber: { subscriberId: 'spike-sub' }, payload: {} });

    expect(result).to.equal(undefined);
    expect(touchedWorkflow).to.equal(false);
  });
});
