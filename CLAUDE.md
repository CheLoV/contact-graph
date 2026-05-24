# Contact Graph

## О проекте

Личная адресная книга и граф связей. Объединяет контакты из vCard, Telegram, WhatsApp, LinkedIn, Facebook в единую модель `Contact` + `ContactIdentity`. Разработка идёт через серию подробных промптов от пользователя по плану «День 1 — День 15».

## Главные продуктовые решения и почему они приняты

«Конституция» проекта. Эти решения сделаны осознанно и не должны пересматриваться без явного обсуждения с пользователем. Если кажется, что один из этих принципов мешает — это сигнал, что задача поставлена неправильно, а не что принцип устарел.

1. **Contact ≠ ContactIdentity.** Один реальный человек = одна запись `Contact`, к которой привязаны N `ContactIdentity` (по одной на каждый источник/сеть). Слияние идёт по совпадению `PhoneNumber.number`, `Email.address`, либо пары `(ContactIdentity.source, sourceId)`. **Никогда не создавать второй `Contact` для того же человека.** Если в коде появляется такая ветка — это баг логики слияния, а не нормальный случай.

2. **`ContactIdentity.confidence` различает источник информации.** `'imported'` — реальный импорт из этой сети (vCard-файл целиком, Telegram-дамп). `'self_reported'` — ссылка на профиль, вписанная юзером в другом источнике (`X-SOCIALPROFILE` в vCard). При коллизии `(source, sourceId)`: `'imported'` побеждает `'self_reported'` — `confidence` обновляется, `rawData` обогащается реальными данными. Это даёт корректное поведение, когда сначала импортировали vCard со ссылкой `t.me/ivan`, а потом — реальный Telegram-дамп с тем же id.

3. **Импорт всегда идемпотентен.** Повторный импорт того же файла должен давать **0 изменений** (created=0, updated=0 либо updated=N с теми же значениями). Гарантируется уникальными индексами на уровне схемы: `@@unique([source, sourceId])` для `ContactIdentity`, `@@unique([chatId, sourceMessageId])` для `Message`. Это не «application-level convention» — это инвариант БД, и нарушить его нельзя случайно.

4. **Хэш-фолбэк для UID, когда в источнике нет уникальных id.** Расширенный хэш строится из всех ключевых полей (см. формулу в разделе про vCard ниже). Это намеренно: при изменении любого ключевого поля получается новая identity — что лучше, чем тихое слияние двух разных людей с одинаковым именем. Цена — при правке существующего контакта в источнике он будет восприниматься как новая identity; это решается на уровне UX merge-flow (День 9), а не подкручиванием хэша.

5. **Fire-and-forget импорт привязан к single-process Node.** Работает в `next dev` и классическом `next start`. При переходе на Vercel/serverless — нужна очередь (Inngest / Trigger.dev / BullMQ + Redis, либо своя через cron + БД). Альтернативные архитектуры (синхронный импорт, websockets, server-sent events) уже отвергнуты — прогресс-бар через polling даёт нужный UX без новых зависимостей.

6. **Schema-first.** Любые изменения БД — только через `prisma migrate dev --name <descriptive>`. **Никогда** ручной SQL по живой БД. **Никогда** `prisma migrate reset` без явного запроса пользователя — это удалит все локальные данные. Если миграция ломается — фиксить миграцию, а не БД руками.

7. **Запрет на удаление пользовательских данных без явного подтверждения.** `deleteMany({})`, `db.contact.deleteMany`, любые wipe-операции — требуют явного запроса юзера в текущем сообщении. Двойная защита: даже при явном запросе показывать что именно удалится (count + примеры) и ждать ещё одно подтверждение. Импорт **никогда** не удаляет — только создаёт и мерджит (см. п.3 + memory `[[pattern_idempotent_reimport]]`).

8. **Запрет на `any` в TypeScript.** Для неизвестных данных (внешний JSON, ответы парсеров, content from disk) — `unknown` + либо защитные проверки типа (`typeof`, `Array.isArray`, in-checks), либо Zod-схема в `src/lib/validators/`. Цена `any` — тихие баги в продакшене; цена `unknown` + парсинг — несколько строк кода. Это compile-time правило, оно ловится ESLint'ом.

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

Тип `ParsedVCard` — см. `src/lib/parsers/vcard.ts`. Поля: `uid, displayName, nickname?, phones[], emails[], urls[], socialProfiles[], addresses[], categories[], attributes[], unknownProperties[], org?, title?, note?, birthday?, rawData`.

#### Полное покрытие свойств vCard

| Источник | Куда пишется |
|---|---|
| `N`, `FN`, `NICKNAME` | `Contact.displayName`, `.nickname` |
| `ORG`, `TITLE`, `NOTE`, `BDAY` | `Contact.organization`, `.title`, `.notes`, `.birthday` |
| `TEL` | `PhoneNumber` |
| `EMAIL` | `Email` |
| `URL`, `item*.URL` | `ContactUrl` |
| `ADR` (+ `GEO` если рядом) | `ContactAddress` (структурированно: street/city/region/postalCode/country + formatted + lat/lng) |
| `CATEGORIES` | `Tag` + `ContactTag` (upsert по имени) |
| `X-SOCIALPROFILE`, `IMPP`, `FBURL`, `X-AIM/X-SKYPE/X-MSN/X-JABBER/X-ICQ/X-YAHOO/X-GTALK/X-GADUGADU` | `ContactIdentity` с `source=<сервис>`, `confidence='self_reported'` |
| `ROLE`, `GENDER`, `LANG`, `TZ`, `X-PHONETIC-FIRST-NAME`, `X-PHONETIC-LAST-NAME`, `X-MAIDENNAME`, `X-ABSHOWAS`, `X-ABRELATEDNAMES`, `X-ABDATE` | `ContactAttribute` (универсальный k/v: key + value + label?) |
| `BEGIN/END/VERSION/PRODID/REV/UID` | служебное, не пишется |
| `PHOTO/LOGO/SOUND/KEY/AGENT/CLASS/SOURCE/NAME/MAILER/LABEL` | игнор по дизайну |
| `X-IMAGETYPE/X-IMAGEHASH/X-SHARED-PHOTO-DISPLAY-PREF/VND-63-SENSITIVE-CONTENT-CONFIG/X-ADDRESSING-GRAMMAR` | Apple-внутренняя мета, игнор |
| **всё прочее** | **попадает в `ParsedVCard.unknownProperties[]`** и агрегируется в `ImportResult.unknownProperties` |

#### Универсальный карман: ContactAttribute

`ContactAttribute { key, value, label? }` хранит редкие/единичные поля vCard, которые не оправдывают отдельной колонки или таблицы. Список ожидаемых `key`-значений зафиксирован выше; новые имена добавляются по мере появления в реальных импортах.

#### Гарантия «ничего не теряется молча»

Импортер агрегирует `ParsedVCard.unknownProperties[]` за весь импорт и кладёт в `ImportResult.unknownProperties = { blocksAffected, counts: { <PROPERTY>: <count> } }`. Это сигнал: «в этом файле есть N контактов с неизвестным полем X — стоит ли расширять покрытие». Сами unknown-строки в БД не пишутся (чтобы не плодить мусор) — но полный raw vCard сохранён в `ContactIdentity.rawData`, и любое поле можно достать постфактум без нового импорта.

#### Особенности vCard, которые покрывает парсер
- Свёрнутые строки (continuation lines): склеиваются перед разбором.
- `ENCODING=QUOTED-PRINTABLE`: декодируется в UTF-8.
- Apple-группы свойств `item1.TEL` + `item1.X-ABLabel:_$!<Mobile>!$_`: лейбл из X-ABLabel перебивает TYPE.
- `UID` может отсутствовать (в наших iCloud-экспортах его нет ни у одного контакта) — фолбэк = `sha256(displayName + все телефоны (sorted) + все emails (sorted, lowercased) + organization + title + birthday + первый адрес)`. Все опциональные поля используют пустую строку при отсутствии. Расширенная формула исключает ложные слияния разных людей с одинаковым именем; идентичные дубликаты vCard-блоков (например, синхрон iCloud между устройствами) корректно схлопываются в одну запись.
- Телефоны нормализуются через `libphonenumber-js` к E.164 с дефолтным регионом `RU` (переопределяется через `DEFAULT_PHONE_REGION`); если не парсится — сохраняется сырое значение.
- **Внутри одного блока** дедупликация phones/emails/urls/socialProfiles перед возвратом — у Apple часто все TEL/EMAIL продублированы.
- Значения параметров (`x-user=Gluk_70`) НЕ нижнерегистрятся — нужны оригинальные username'ы. Регистр сравнивается только там, где это явно нужно (TYPE).
- `PHOTO` игнорируется. `BDAY` принимается только если год ≥ 1900 (отсекает Apple-плейсхолдеры `1604-…`).

### Соц.профили = ContactIdentity (не отдельная таблица)

`X-SOCIALPROFILE` мапится напрямую в `ContactIdentity`. Это даёт автоматическое слияние с будущими реальными импортами: vk identity, созданная из vCard, склеится с identity из реального VK-импорта по совпадению `(source='vk', sourceId)`.

Поле `ContactIdentity.confidence`:
- `'imported'` — реальный импорт из источника (vCard как таковой, Telegram dump и т.п.). Богатый `rawData`.
- `'self_reported'` — записанная пользователем в vCard ссылка через `X-SOCIALPROFILE`. Короткий `rawData` вида `{"url": "...", "originalLabel": "..."}`.

Извлечение `sourceId` по сервисам:
- `vk` — `x-userid` (числовой, стабильный) > `x-user` > URL.
- `telegram` — `x-user` > URL `t.me/<name>`.
- `facebook` — `x-user` > URL `facebook.com/<name>`.
- `twitter` — `x-user` > URL `twitter|x.com/<name>`.
- `whatsapp` — **пропускается**: Apple записывает x-user как `x-apple:%...:%...` с двоеточием внутри значения, что ломает vCard-парсинг. WhatsApp всё равно слипнется с реальным импортом через PhoneNumber matching.

### Дедупликация при повторном импорте

Идентификатор связи vCard ↔ БД — пара `(ContactIdentity.source='vcard', sourceId=UID)`. При повторном импорте того же файла:
- существующая identity — обновляется `displayName`, `rawData`, плюс на Contact'е обновляются `organization/title/birthday/notes`; **добавляются недостающие** телефоны/email/urls (старые не трогаются).
- новой identity нет — создаются `Contact + ContactIdentity + PhoneNumber[] + Email[] + ContactUrl[]` плюс по `ContactIdentity` на каждый социал-профиль.
- если social `(source, sourceId)` уже привязан к **другому** Contact'у — записывается warning в `errors`, identity не перепривязывается (это сигнал для будущего ручного merge на Дне 9).

## Известные ограничения архитектуры

### Fire-and-forget импорты

POST `/api/import/<source>` стартует импорт в фоне (внутри того же Node-процесса) и сразу возвращает `jobId`. Клиент опрашивает прогресс через GET. Это даёт реальный прогресс-бар и не требует очереди, но имеет ограничения:

- **Работает только на single-process Node** (`next dev`, классический `next start` за reverse-proxy на одной машине).
- **Не работает на serverless** (Vercel и т.п.): фоновый промис будет убит после возврата HTTP-ответа. Когда дойдём до prod — нужно переписать на очередь: отдельный воркер читает `ImportJob` со `status='pending'`. Кандидаты: Inngest, Trigger.dev, BullMQ + Redis, либо своя минимальная реализация через cron + БД.
- **Hot-reload в dev обрывает текущий импорт.** Это норма для разработки.
- **Защита от сирот:** перед стартом каждого нового импорта `reapOrphanedJobs()` помечает все `ImportJob` со `status='running'` старше 5 минут как `failed`. Это очищает зависшие задачи после краша процесса или hot-reload.

## Telegram — текущий статус

Telegram-импорт разбит на две фазы:

- **День 3-А (планируется):** MTProto API через GramJS — выкачка всех контактов с полными профилями (`user_id`, `username`, `phone`, `bio`). Слияние с vCard по нормализованному `phone`. Главный источник identity для Telegram.
- **День 3-Б (после 3-А):** JSON-экспорт как источник **сообщений**. Парсер ещё не написан (на День 3 успели только инфраструктуру: миграция `Chat.messageCount/lastMessageAt`, `ImportJob.currentPhase`, FTS5-индекс `messages_fts` над `Message`). Импортёр будет полагаться на identity, уже созданные в Дне 3-А, и просто привязывать сообщения по `from_id` к существующим.

**Текущий статус:** ничего из Telegram в БД ещё не импортировано. Единственная identity с `source='telegram'` в БД — `confidence='self_reported'`, она пришла из vCard (`X-SOCIALPROFILE`), не из самого Telegram.

**Почему развернулись с JSON-only:** в JSON-экспорте Telegram Desktop отсутствует `user_id` собеседников в `contacts.list`, нет `@username` ни у кого кроме меня, нет `phone` собеседников. `chat.id` для `personal_chat` совпадает с user_id собеседника, но bridge `phone ↔ user_id` через ФИО даёт всего ~40% match'а (1015 из 2523 именованных чатов). Это политика приватности Telegram Desktop. Для полных профилей нужен MTProto API.

**Артефакты, оставшиеся в репо от незакрытого Дня 3:**
- `prisma/migrations/20260524111925_day3_telegram_cache/` — поля `Chat.messageCount`, `Chat.lastMessageAt`, `ImportJob.currentPhase`. Полезны для будущего.
- `prisma/migrations/20260524111942_day3_messages_fts/` — пустая no-op миграция (артефакт первой попытки `--create-only`). Не трогать.
- `prisma/migrations/20260524112056_day3_messages_fts_setup/` — настоящий FTS5 (`CREATE VIRTUAL TABLE messages_fts` + 3 триггера). Полезен для будущего полнотекстового поиска.

**Подводный камень с Prisma + FTS5:** Prisma не знает о виртуальных таблицах. При следующем `prisma migrate dev` или `migrate reset` он может предложить дропнуть `messages_fts_config`/`messages_fts_data` («drift detected»). **Отвечать «No»** — это служебные таблицы FTS5 которые ведёт SQLite сам. Альтернатива — `prisma db push --skip-generate` для не-FTS изменений.

## Известные особенности окружения

- shadcn/ui новой версии использует `@base-ui/react`, `asChild` не работает — для `Link` используй `buttonVariants()`, для Triggers `render={<Button />}`.
- Next 16 убрал `next lint`, используется `eslint`.
- SQLite `contains` case-sensitive — это учитываем при поиске.
- Prisma залочена на v6 (v7 ломает поток).
- `@tanstack/react-table` установлен в deps, но не используется — оставлен на случай будущих потребностей в виртуализации/server-side операциях. Generic `DataTable` (`src/components/data-table/`) написан без него.
- React 19 правило `react-hooks/set-state-in-effect` запрещает `setState` синхронно внутри `useEffect`. Для SSR-safe hydration из localStorage используем обёртку через `queueMicrotask` — см. `src/components/data-table/use-table-state.ts`.

## Правила работы со мной

- Перед началом каждой нетривиальной задачи показывай план.
- Не отступай от спецификации в промпте без согласования.
- Коммить после каждой подзадачи, не накапливай большие коммиты.
- В конце каждой сессии — короткий отчёт: что сделано, что НЕ сделано / на что обратить внимание, объяснение для не-разработчика.
