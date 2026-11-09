# Форк Novu для Djinn

Ветка `djinn/v3.19.0` от тега `v3.19.0` (`fe53c481a`). Решение: ADR-0083 в репозитории Djinn. Правки держим маленькими: смысл форка в том, что подтягивать апстрим дёшево.

Обновление: новая ветка от нового тега, `git rebase --onto` этих коммитов, разрешение конфликтов, повтор отказных прогонов (`docs/experiments/2026-11-09-novu-spike.md` в Djinn), новые отпечатки образов на стенде.

## Правки

| Что | Где |
|---|---|
| Клейма нет в письме и в ленте | `get-organization-settings.usecase.ts` всегда отвечает `removeNovuBranding: true` |
| Пауза входа SMTP | `smtp-login-gate.service.ts`; вход по одному на интеграцию, `EAUTH` закрывает его на растущую паузу, шаг откладывается. `SMTP_LOGIN_PAUSES_SECONDS`, по умолчанию `900,1800,3600` |
| Срок хранения | TTL на `notifications`, `jobs`, `messages`, `executiondetails`. `NOTIFICATION_RETENTION_DAYS`, по умолчанию 30, применяется и к действующей базе при старте |
| Удаление подписчика | `purge-subscriber-data.ts`: `notifications`, `jobs`, `executiondetails`, `messages`, `channelendpoints`, `channelconnections`, файлы вложений |
| Адрес Telegram | `TELEGRAM_API_BASE_URL` теперь и для отправки |
| Внешние обращения | модуля телеметрии воркера нет; панель без внешних шрифтов и шаблонов; `mongosh` в compose без сниппетов и телеметрии |
| Профиль из браузера | `/v1/inbox/session` передаёт только `subscriberId`, `allowUpdate: false` |
| Вход и регистрация | HMAC обязателен всегда; регистрация закрыта, пока не задано `DISABLE_USER_REGISTRATION=false` |
| Завершение контейнера | `node` под `dumb-init`: иначе PID 1 не умирает от повторённого SIGTERM |
| Образы | `.github/workflows/publish-djinn-images.yml`: `ghcr.io/gotovchenkoai/novu-{api,worker,ws,dashboard}`, amd64 и arm64, тег `sha-<коммит>`, отпечаток в сводке запуска |

## Ядро: 38 файлов, +336 / -271 строк

| Файл | Добавлено | Удалено |
|---|---|---|
| `apps/api/Dockerfile` | +2 | -1 |
| `apps/api/src/.env.production` | +1 | -1 |
| `apps/api/src/.example.env` | +1 | -1 |
| `apps/api/src/app/auth/usecases/register/user-register.usecase.ts` | +2 | -1 |
| `apps/api/src/app/inbox/usecases/session/session.usecase.ts` | +14 | -27 |
| `apps/api/src/app/integrations/usecases/consume-integration-store-telegram-mobile-link/consume-integration-store-telegram-mobile-link.usecase.ts` | +2 | -1 |
| `apps/api/src/app/organization/usecases/get-organization-settings/get-organization-settings.usecase.ts` | +2 | -1 |
| `apps/api/src/app/subscribers-v2/subscribers.module.ts` | +2 | -1 |
| `apps/api/src/app/subscribers-v2/usecases/remove-subscriber/purge-subscriber-data.ts` | +63 | -0 |
| `apps/api/src/app/subscribers-v2/usecases/remove-subscriber/remove-subscriber.usecase.ts` | +5 | -1 |
| `apps/api/src/app/subscribers/subscribersV1.module.ts` | +2 | -0 |
| `apps/api/src/app/subscribers/usecases/remove-subscriber/remove-subscriber.usecase.ts` | +5 | -1 |
| `apps/api/src/app/widgets/usecases/initialize-session/initialize-session.usecase.ts` | +2 | -3 |
| `apps/api/src/config/env.validators.ts` | +1 | -1 |
| `apps/dashboard/index.html` | +0 | -18 |
| `apps/dashboard/src/hooks/use-template-store.ts` | +2 | -1 |
| `apps/worker/Dockerfile` | +2 | -2 |
| `apps/worker/src/.example.env` | +1 | -0 |
| `apps/worker/src/app.module.ts` | +0 | -2 |
| `apps/worker/src/app/telemetry/telemetry.module.ts` | +0 | -35 |
| `apps/worker/src/app/telemetry/usecases/machineInfoService.usecase.ts` | +0 | -36 |
| `apps/worker/src/app/telemetry/usecases/userInfoService.usecase.ts` | +0 | -64 |
| `apps/worker/src/app/telemetry/utils/machine.utils.ts` | +0 | -45 |
| `apps/worker/src/app/telemetry/utils/sendDataToNovuTrace.utils.ts` | +0 | -19 |
| `apps/worker/src/app/workflow/usecases/add-job/add-job.usecase.ts` | +1 | -1 |
| `apps/worker/src/app/workflow/usecases/run-job/run-job.usecase.ts` | +19 | -0 |
| `apps/worker/src/app/workflow/usecases/send-message/send-message-email.usecase.ts` | +39 | -1 |
| `apps/worker/src/app/workflow/usecases/send-message/smtp-login-gate.service.ts` | +113 | -0 |
| `apps/worker/src/app/workflow/workflow.module.ts` | +2 | -1 |
| `apps/ws/Dockerfile` | +2 | -1 |
| `docker/community/docker-compose.yml` | +11 | -0 |
| `libs/dal/src/dal.service.ts` | +19 | -0 |
| `libs/dal/src/repositories/execution-details/execution-details.schema.ts` | +2 | -1 |
| `libs/dal/src/repositories/job/job.schema.ts` | +2 | -1 |
| `libs/dal/src/repositories/message/message.schema.ts` | +2 | -1 |
| `libs/dal/src/repositories/notification/notification.schema.ts` | +2 | -1 |
| `libs/dal/src/shared/consts/ttl.ts` | +11 | -0 |
| `packages/providers/src/lib/chat/telegram/telegram.provider.ts` | +2 | -1 |

## Тесты: 6 файлов, +281 / -5 строк

| Файл | Добавлено | Удалено |
|---|---|---|
| `apps/api/src/app/auth/usecases/register/user-register.spec.ts` | +24 | -0 |
| `apps/api/src/app/inbox/usecases/session/session.spec.ts` | +65 | -5 |
| `apps/api/src/app/organization/usecases/get-organization-settings/get-organization-settings.spec.ts` | +18 | -0 |
| `apps/api/src/app/subscribers/usecases/remove-subscriber/remove-subscriber.spec.ts` | +80 | -0 |
| `apps/worker/src/app/workflow/usecases/send-message/smtp-login-gate.spec.ts` | +73 | -0 |
| `packages/providers/src/lib/chat/telegram/telegram.provider.spec.ts` | +21 | -0 |

## Сборка: 1 файл, +179 / -0 строк

| Файл | Добавлено | Удалено |
|---|---|---|
| `.github/workflows/publish-djinn-images.yml` | +179 | -0 |
