# Форк Novu для Djinn

Ветка `djinn/v3.19.0` от тега `v3.19.0` (`fe53c481a`). Решение: ADR-0083 в репозитории Djinn. Правки держим маленькими: смысл форка в том, что подтягивать апстрим дёшево.

Обновление: новая ветка от нового тега, `git rebase --onto` этих коммитов, разрешение конфликтов, повтор отказных прогонов (`docs/experiments/2026-11-09-novu-spike.md` в Djinn), новые отпечатки образов на стенде.

## Правки

| Что | Где |
|---|---|
| Клейма нет в письме и в ленте | `get-organization-settings.usecase.ts` всегда отвечает `removeNovuBranding: true` |
| Вход SMTP | `smtp-login-gate.service.ts`: неизвестное или закрытое состояние проверяет одно письмо, `EAUTH` закрывает вход на растущую паузу, шаг откладывается. `SMTP_LOGIN_PAUSES_SECONDS`, по умолчанию `900,1800,3600` |
| Общие соединения SMTP | `nodemailer.provider.ts`: соединения общие на настройки целиком с закреплённым адресом, новое открывается, когда предыдущее вошло. `SMTP_POOL_MAX_CONNECTIONS`, по умолчанию 5 |
| Срок хранения | TTL на `notifications`, `jobs`, `messages`, `executiondetails`, `subscribertombstones`. `NOTIFICATION_RETENTION_DAYS`, по умолчанию и не больше 30. Применяет каждый из `api`, `worker`, `ws` при старте, побеждает запущенный последним: задавать всем трём. Не применился — процесс не стартует |
| Удаление подписчика | `purge-subscriber-data.ts`: след в MongoDB, затем очистка, подписчик последним. След нельзя записать — отказ. Повтор отвечает 200 и чистит записанное после первого вызова. Второй проход запускает сага удаления Djinn |
| Запуск после удаления | `SubscriberTombstoneRepository`: воркер пропускает запуск, сессия отвечает 404. `subscriberId` после удаления не использовать повторно |
| Очистка по запуску | `DELETE /v1/events/trigger/:transactionId/data`: строки всех коллекций, вложения, запуски в очереди. Можно повторять |
| Адрес Telegram | `TELEGRAM_API_BASE_URL` обязателен: без него отправка отказывает, чужого адреса по умолчанию нет |
| Внешние обращения | модуля телеметрии воркера нет; агент New Relic выключен в коде; панель без внешних шрифтов и шаблонов, без `VITE_API_HOSTNAME` не стартует; `.env.production` без адресов novu.co; `mongosh` в compose без сниппетов и телеметрии |
| Что осталось за переменными и не задаётся | Sentry, OTEL, Segment, Mixpanel, GTM, Plain, LaunchDarkly, Customer.io, HubSpot, Stripe. Клиентская `@novu/js` держит `api.novu.co` и `ws.novu.co` по умолчанию: срез 4 задаёт адреса явно |
| Профиль из браузера | `/v1/inbox/session` и `/v1/widgets/session/initialize` передают только `subscriberId`, `allowUpdate: false`; токен подписчика без адреса и имён |
| Вход и регистрация | HMAC обязателен всегда; регистрация закрыта, пока не задано `DISABLE_USER_REGISTRATION=false` |
| Секреты | `refuseShippedSecrets`: пустой секрет и значение из репозитория останавливают запуск. Примеров окружения в образе нет |
| Завершение контейнера | `node` под `dumb-init`: иначе PID 1 не умирает от повторённого SIGTERM |
| Запуск воркера | воркер создаётся на паузе, снимает её `startAppInfra`: иначе задачи из очереди падают до готовности приложения и теряются |
| Рестарт API | шаг при сетевой ошибке моста ждёт 15-30 с, до 40 раз |
| Сбой MongoDB | `isStoreOutage`: задача возвращается в очередь через 65 с, не расходуя попытки, до часа. Цепочка поднимает следующий шаг при повторе |
| Журнал запуска | только идентификаторы вместо всей команды |
| Образы | `.github/workflows/publish-djinn-images.yml`: `ghcr.io/gotovchenkoai/novu-{api,worker,ws,dashboard}`, amd64 и arm64, тег `sha-<коммит>`, отпечаток в сводке запуска |

## Ядро: 74 файлов, +899 / -369 строк

| Файл | Добавлено | Удалено |
|---|---|---|
| `apps/api/Dockerfile` | +5 | -1 |
| `apps/api/src/.env.production` | +1 | -10 |
| `apps/api/src/.example.env` | +1 | -1 |
| `apps/api/src/app/auth/services/community.auth.service.ts` | +1 | -3 |
| `apps/api/src/app/auth/usecases/register/user-register.usecase.ts` | +2 | -1 |
| `apps/api/src/app/events/events.controller.ts` | +19 | -0 |
| `apps/api/src/app/events/usecases/index.ts` | +2 | -1 |
| `apps/api/src/app/events/usecases/parse-event-request/parse-event-request.usecase.ts` | +8 | -1 |
| `apps/api/src/app/events/usecases/purge-transaction/purge-transaction.command.ts` | +8 | -0 |
| `apps/api/src/app/events/usecases/purge-transaction/purge-transaction.usecase.ts` | +71 | -0 |
| `apps/api/src/app/inbox/e2e/session.e2e.ts` | +8 | -2 |
| `apps/api/src/app/inbox/usecases/session/session.usecase.ts` | +22 | -28 |
| `apps/api/src/app/integrations/usecases/consume-integration-store-telegram-mobile-link/consume-integration-store-telegram-mobile-link.usecase.ts` | +2 | -1 |
| `apps/api/src/app/organization/usecases/get-organization-settings/get-organization-settings.usecase.ts` | +2 | -1 |
| `apps/api/src/app/shared/shared.module.ts` | +3 | -0 |
| `apps/api/src/app/subscribers-v2/subscribers.module.ts` | +2 | -1 |
| `apps/api/src/app/subscribers-v2/usecases/remove-subscriber/purge-subscriber-data.ts` | +89 | -0 |
| `apps/api/src/app/subscribers-v2/usecases/remove-subscriber/remove-subscriber.usecase.ts` | +22 | -21 |
| `apps/api/src/app/subscribers/subscribersV1.module.ts` | +2 | -0 |
| `apps/api/src/app/subscribers/usecases/remove-subscriber/remove-subscriber.usecase.ts` | +22 | -21 |
| `apps/api/src/app/telegram-linking/telegram-webhook.utils.ts` | +7 | -3 |
| `apps/api/src/app/widgets/usecases/initialize-session/initialize-session.usecase.ts` | +11 | -13 |
| `apps/api/src/config/env.validators.ts` | +4 | -2 |
| `apps/api/src/instrument.ts` | +2 | -2 |
| `apps/dashboard/index.html` | +0 | -18 |
| `apps/dashboard/src/components/template-store/workflow-template-modal.tsx` | +4 | -1 |
| `apps/dashboard/src/config/index.ts` | +1 | -1 |
| `apps/dashboard/src/hooks/use-template-store.ts` | +2 | -1 |
| `apps/dashboard/src/utils/api-hostname-manager.ts` | +4 | -3 |
| `apps/dashboard/src/utils/self-hosted/auth.resource.tsx` | +2 | -2 |
| `apps/dashboard/src/utils/self-hosted/jwt-manager.tsx` | +9 | -1 |
| `apps/dashboard/src/utils/self-hosted/user.resource.tsx` | +2 | -1 |
| `apps/worker/Dockerfile` | +5 | -2 |
| `apps/worker/src/.env.production` | +0 | -1 |
| `apps/worker/src/.example.env` | +1 | -0 |
| `apps/worker/src/app.module.ts` | +0 | -2 |
| `apps/worker/src/app/shared/shared.module.ts` | +2 | -0 |
| `apps/worker/src/app/telemetry/telemetry.module.ts` | +0 | -35 |
| `apps/worker/src/app/telemetry/usecases/machineInfoService.usecase.ts` | +0 | -36 |
| `apps/worker/src/app/telemetry/usecases/userInfoService.usecase.ts` | +0 | -64 |
| `apps/worker/src/app/telemetry/utils/machine.utils.ts` | +0 | -45 |
| `apps/worker/src/app/telemetry/utils/sendDataToNovuTrace.utils.ts` | +0 | -19 |
| `apps/worker/src/app/workflow/usecases/add-job/add-job.usecase.ts` | +1 | -1 |
| `apps/worker/src/app/workflow/usecases/run-job/run-job.usecase.ts` | +37 | -0 |
| `apps/worker/src/app/workflow/usecases/send-message/send-message-email.usecase.ts` | +46 | -1 |
| `apps/worker/src/app/workflow/usecases/send-message/smtp-login-gate.service.ts` | +158 | -0 |
| `apps/worker/src/app/workflow/usecases/store-subscriber-jobs/store-subscriber-jobs.usecase.ts` | +28 | -0 |
| `apps/worker/src/app/workflow/usecases/subscriber-job-bound/subscriber-job-bound.usecase.ts` | +8 | -1 |
| `apps/worker/src/app/workflow/workflow.module.ts` | +2 | -1 |
| `apps/worker/src/config/env.validators.ts` | +3 | -1 |
| `apps/worker/src/instrument.ts` | +2 | -2 |
| `apps/ws/Dockerfile` | +5 | -1 |
| `apps/ws/src/.env.production` | +0 | -3 |
| `apps/ws/src/config/env.validators.ts` | +3 | -1 |
| `apps/ws/src/instrument.ts` | +2 | -2 |
| `docker/community/docker-compose.yml` | +16 | -0 |
| `libs/application-generic/src/services/bull-mq/bull-mq.service.ts` | +2 | -0 |
| `libs/application-generic/src/services/queues/queue-base.service.ts` | +3 | -0 |
| `libs/application-generic/src/services/workers/index.ts` | +1 | -0 |
| `libs/application-generic/src/services/workers/worker-base.service.ts` | +37 | -3 |
| `libs/application-generic/src/utils/subscribers.utils.ts` | +2 | -1 |
| `libs/dal/src/dal.service.ts` | +17 | -0 |
| `libs/dal/src/repositories/execution-details/execution-details.schema.ts` | +2 | -1 |
| `libs/dal/src/repositories/job/job.schema.ts` | +2 | -1 |
| `libs/dal/src/repositories/message/message.schema.ts` | +2 | -1 |
| `libs/dal/src/repositories/notification/notification.schema.ts` | +2 | -1 |
| `libs/dal/src/repositories/subscriber/index.ts` | +1 | -0 |
| `libs/dal/src/repositories/subscriber/subscriber-tombstone.repository.ts` | +46 | -0 |
| `libs/dal/src/shared/consts/ttl.ts` | +13 | -0 |
| `libs/testing/src/user.session.ts` | +2 | -0 |
| `packages/providers/src/lib/chat/telegram/telegram.provider.ts` | +5 | -1 |
| `packages/providers/src/lib/email/nodemailer/nodemailer.provider.ts` | +74 | -1 |
| `packages/shared/src/config/index.ts` | +1 | -0 |
| `packages/shared/src/config/shippedSecrets.ts` | +28 | -0 |

## Тесты: 18 файлов, +920 / -27 строк

| Файл | Добавлено | Удалено |
|---|---|---|
| `apps/api/src/app/auth/services/subscriber-token.spec.ts` | +23 | -0 |
| `apps/api/src/app/auth/usecases/register/user-register.spec.ts` | +24 | -0 |
| `apps/api/src/app/events/usecases/purge-transaction/purge-transaction.spec.ts` | +87 | -0 |
| `apps/api/src/app/inbox/usecases/session/session.spec.ts` | +91 | -5 |
| `apps/api/src/app/organization/usecases/get-organization-settings/get-organization-settings.spec.ts` | +18 | -0 |
| `apps/api/src/app/subscribers/usecases/remove-subscriber/remove-subscriber.spec.ts` | +200 | -0 |
| `apps/api/src/app/telegram-linking/telegram-webhook.utils.spec.ts` | +16 | -20 |
| `apps/api/src/config/production-env.spec.ts` | +19 | -0 |
| `apps/dashboard/src/utils/self-hosted/jwt-manager.spec.ts` | +14 | -0 |
| `apps/worker/src/app/workflow/services/store-outage-retry.spec.ts` | +52 | -0 |
| `apps/worker/src/app/workflow/usecases/run-job/bridge-retry.spec.ts` | +25 | -0 |
| `apps/worker/src/app/workflow/usecases/send-message/smtp-login-gate.spec.ts` | +110 | -0 |
| `apps/worker/src/app/workflow/usecases/store-subscriber-jobs/resume-stored.spec.ts` | +32 | -0 |
| `apps/worker/src/app/workflow/usecases/subscriber-job-bound/subscriber-tombstone.spec.ts` | +52 | -0 |
| `libs/application-generic/src/utils/subscribers.utils.spec.ts` | +15 | -0 |
| `packages/providers/src/lib/chat/telegram/telegram.provider.spec.ts` | +16 | -2 |
| `packages/providers/src/lib/email/nodemailer/nodemailer-pool.spec.ts` | +98 | -0 |
| `packages/shared/src/config/shippedSecrets.spec.ts` | +28 | -0 |

## Сборка: 1 файл, +179 / -0 строк

| Файл | Добавлено | Удалено |
|---|---|---|
| `.github/workflows/publish-djinn-images.yml` | +179 | -0 |
