import { DEFAULT_NOTIFICATION_RETENTION_DAYS } from '@novu/shared';

export const TTL_EXPIRE_AFTER_AMOUNT = '48h';

export const TTL_INDEX_ENABLED = !(process.env.NOVU_MANAGED_SERVICE === 'true' || process.env.DISABLE_TTL === 'true');

export function getTTLOptions() {
  if (TTL_INDEX_ENABLED) {
    return { expires: TTL_EXPIRE_AFTER_AMOUNT };
  }
}

/** Djinn: коллекции с данными вызова. Срок задаёт NOTIFICATION_RETENTION_DAYS, по умолчанию 30 суток. */
export const RETENTION_COLLECTIONS = ['notifications', 'jobs', 'messages', 'executiondetails', 'subscribertombstones'];

export function getRetentionIndexOptions() {
  const days = Number(process.env.NOTIFICATION_RETENTION_DAYS);

  return { expireAfterSeconds: (days > 0 ? days : DEFAULT_NOTIFICATION_RETENTION_DAYS) * 24 * 60 * 60 };
}
