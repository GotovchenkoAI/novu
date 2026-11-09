import { createHash } from 'node:crypto';
import { CacheService } from './cache.service';

/**
 * Djinn: запуск мог стоять в очереди, пока подписчика удаляли: воркер завёл бы его заново и записал
 * данные вызова уже после очистки. Сутки на такой хвост; `subscriberId` в продукте не используется повторно.
 */
const TOMBSTONE_TTL_SECONDS = 24 * 60 * 60;

const tombstoneKey = (environmentId: string, subscriberId: string) =>
  `subscriber-deleted:${environmentId}:${createHash('sha256').update(subscriberId).digest('hex').slice(0, 32)}`;

export async function markSubscriberDeleted(cache: CacheService, environmentId: string, subscriberId: string) {
  if (cache.cacheEnabled()) await cache.client?.set(tombstoneKey(environmentId, subscriberId), '1', 'EX', TOMBSTONE_TTL_SECONDS);
}

export async function isSubscriberDeleted(cache: CacheService | undefined, environmentId: string, subscriberId: string) {
  return !!cache?.cacheEnabled() && !!(await cache.client?.get(tombstoneKey(environmentId, subscriberId)));
}
