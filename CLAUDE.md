# Contact Graph

## О проекте

Личная адресная книга и граф связей. Объединяет контакты из vCard, Telegram, WhatsApp, LinkedIn, Facebook в единую модель `Contact` + `ContactIdentity`. Разработка идёт через серию подробных промптов от пользователя по плану «День 1 — День 15».

## Стек

Next.js 16 (App Router, Turbopack), TypeScript strict (`noUncheckedIndexedAccess`), TailwindCSS v4, shadcn/ui (на `@base-ui/react`), Prisma 6 + SQLite, Zod, react-hook-form, sonner, next-themes, lucide-react.

**Запрещены без согласования:** Redux/Zustand/MobX, MUI/Chakra/styled-components, Drizzle/другие ORM, Bun/Deno, MongoDB.

## Архитектурные правила

- **Формат API-ответов:** используй хелперы `ok()` и `fail()` из `src/lib/api.ts`. Всегда возвращай `{ ok: true, data }` или `{ ok: false, error: { code, message, details? } }`.
- Все API routes валидируют вход через Zod (схемы в `src/lib/validators/`).
- Доступ к БД только через `src/lib/db.ts` (singleton `PrismaClient`).
- Серверные компоненты по умолчанию, `'use client'` только когда нужно (форма / `onClick` / `useState` / hooks).
- Запрещено `any`. Если данные неизвестны — `unknown` + парсинг через Zod.
- Tailwind-классы, без inline-стилей и CSS-модулей кроме `globals.css`.

## Главная модель домена

`Contact` — реальный человек. `ContactIdentity` — его профиль в одной сети (`source: 'vcard' | 'telegram' | ...`). Слияние профилей по совпадению `PhoneNumber.number` / `Email.address` — основа всего проекта. Полная схема Prisma — в `prisma/schema.prisma`.

## Структура папок

- `src/app/` — роуты + API
- `src/lib/db.ts` — БД, `src/lib/api.ts` — хелперы, `src/lib/validators/` — Zod
- `src/lib/parsers/` — парсеры файлов (vCard, далее Telegram JSON и т.д.)
- `src/lib/importers/` — слой выше парсеров: пишут в БД, ведут ImportJob
- `src/components/layout/` — `Sidebar`, `Header`, `PageHeader`
- `src/components/import/` — карточки источников импорта (`ImportSourceCard`, `VCardImportCard`)
- `src/components/ui/` — shadcn компоненты
- `prisma/schema.prisma` — модель данных
- `sample-data/` — личные тестовые данные (в `.gitignore`)

## Парсеры и импортеры

Двухслойная архитектура для всех импортов:

1. **Парсер** (`src/lib/parsers/<source>.ts`) — чистая функция: текст файла → массив структурированных объектов. Ничего не пишет в БД, не знает о Prisma. Подходит для unit-тестирования.
2. **Импортер** (`src/lib/importers/<source>.ts`) — принимает массив от парсера и пишет в БД батчами по 100 в отдельных транзакциях, обновляя `ImportJob.processed`. Сам ничего не парсит.

API роут (`src/app/api/import/<source>/route.ts`) связывает их: парсит файлы синхронно, регистрирует `ImportJob`, запускает импортёр **fire-and-forget** и возвращает `jobId`. UI пуллит прогресс через `GET /api/import/<source>?jobId=...`.

### Контракт vCard

Тип `ParsedVCard` — см. `src/lib/parsers/vcard.ts`.

Особенности vCard, которые покрывает парсер:
- Свёрнутые строки (continuation lines): склеиваются перед разбором.
- `ENCODING=QUOTED-PRINTABLE`: декодируется в UTF-8.
- Apple-группы свойств `item1.TEL` + `item1.X-ABLabel:_$!<Mobile>!$_`: лейбл из X-ABLabel перебивает TYPE.
- `UID` может отсутствовать (в наших iCloud-экспортах его нет ни у одного контакта) — фолбэк = `sha256(displayName + первый телефон + первый email)`. Это даёт стабильный id для дедупликации между повторными импортами.
- Телефоны нормализуются через `libphonenumber-js` к E.164 с дефолтным регионом `RU` (переопределяется через `DEFAULT_PHONE_REGION`); если не парсится — сохраняется сырое значение.
- `PHOTO` игнорируется.

### Дедупликация при повторном импорте

Идентификатор связи vCard ↔ БД — пара `(ContactIdentity.source='vcard', sourceId=UID)`. При повторном импорте того же файла:
- существующая identity — обновляется `displayName`, `rawData`; **добавляются недостающие** телефоны/email (старые не трогаются, чтобы не терять данные из других источников).
- новой identity нет — создаются `Contact + ContactIdentity + PhoneNumber[] + Email[]` в одной транзакции батча.

## Известные ограничения архитектуры

### Fire-and-forget импорты

POST `/api/import/<source>` стартует импорт в фоне (внутри того же Node-процесса) и сразу возвращает `jobId`. Клиент опрашивает прогресс через GET. Это даёт реальный прогресс-бар и не требует очереди, но имеет ограничения:

- **Работает только на single-process Node** (`next dev`, классический `next start` за reverse-proxy на одной машине).
- **Не работает на serverless** (Vercel и т.п.): фоновый промис будет убит после возврата HTTP-ответа. Когда дойдём до prod — нужно переписать на очередь: отдельный воркер читает `ImportJob` со `status='pending'`. Кандидаты: Inngest, Trigger.dev, BullMQ + Redis, либо своя минимальная реализация через cron + БД.
- **Hot-reload в dev обрывает текущий импорт.** Это норма для разработки.
- **Защита от сирот:** перед стартом каждого нового импорта `reapOrphanedJobs()` помечает все `ImportJob` со `status='running'` старше 5 минут как `failed`. Это очищает зависшие задачи после краша процесса или hot-reload.

## Известные особенности окружения

- shadcn/ui новой версии использует `@base-ui/react`, `asChild` не работает — для `Link` используй `buttonVariants()`, для Triggers `render={<Button />}`.
- Next 16 убрал `next lint`, используется `eslint`.
- SQLite `contains` case-sensitive — это учитываем при поиске.
- Prisma залочена на v6 (v7 ломает поток).

## Правила работы со мной

- Перед началом каждой нетривиальной задачи показывай план.
- Не отступай от спецификации в промпте без согласования.
- Коммить после каждой подзадачи, не накапливай большие коммиты.
- В конце каждой сессии — короткий отчёт: что сделано, что НЕ сделано / на что обратить внимание, объяснение для не-разработчика.
