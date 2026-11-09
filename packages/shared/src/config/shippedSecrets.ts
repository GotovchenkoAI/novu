/**
 * Djinn: значения из репозитория и примеров окружения — публичные константы. С таким секретом любой
 * подпишет токен подписчика и прочтёт ленту, поэтому процесс на них не стартует.
 */
const SHIPPED_SECRETS = new Set([
  'LOCAL_ONLY_CHANGE_ME',
  'TEST_CHANGE9s',
  'ASD#asda23DFEFSFHG%fg',
  '<ENCRYPTION_KEY_MUST_BE_32_LONG>',
  'NOVU_SECRET_KEY',
  'NOVU_API_KEY',
]);

/** `required` не может быть пустым; `optional` может отсутствовать, но не значением из репозитория. */
export function refuseShippedSecrets(
  env: Record<string, string | undefined>,
  required: string[],
  optional: string[] = []
): void {
  if (env.NODE_ENV === 'test') return;

  for (const name of [...required, ...optional]) {
    const value = env[name]?.trim();

    if (!value && required.includes(name)) throw new Error(`${name} is not set`);
    if (value && SHIPPED_SECRETS.has(value)) throw new Error(`${name} holds a value published in the repository`);
  }
}
