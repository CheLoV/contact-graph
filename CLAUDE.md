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
- `src/lib/db.ts` — БД, `src/lib/api.ts` — хелперы, `src/lib/validators/` — Zod, `src/lib/parsers/` — парсеры файлов (будут добавлены)
- `src/components/layout/` — `Sidebar`, `Header`, `PageHeader`
- `src/components/ui/` — shadcn компоненты
- `prisma/schema.prisma` — модель данных
- `sample-data/` — личные тестовые данные (в `.gitignore`)

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
