# Contact Graph

Личная адресная книга и граф связей: объединяет контакты из vCard, Telegram, WhatsApp, LinkedIn, Facebook в единую модель с визуализацией связей.

## Стек

Next.js 16 (App Router), TypeScript (strict + `noUncheckedIndexedAccess`), TailwindCSS v4, shadcn/ui, Prisma 6, SQLite, Zod, react-hook-form, next-themes, sonner.

## Большие импорты и heap

`npm run dev` явно поднимает Node heap до 4 GB через `NODE_OPTIONS='--max-old-space-size=4096'`. Это нужно для импортов вроде Telegram-экспорта: один `result.json` весит ~150 МБ на диске, но после `JSON.parse` в памяти живёт ~600 МБ (плюс Prisma-кэш, Next.js, парсер). Без поднятого лимита dev-процесс ловит OOM на середине импорта.

## Запуск локально / в Codespace

1. `npm install`
2. Скопируй `.env.example` в `.env`
3. `npm run db:migrate` — создаст SQLite-базу и применит миграции
4. `npm run dev` → открой ссылку из терминала (обычно http://localhost:3000)
5. (опционально) `npm run db:studio` — просмотр БД в браузере

## Скрипты

| Команда             | Что делает                              |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Dev-сервер с hot-reload                 |
| `npm run build`     | Продакшен-сборка                        |
| `npm run start`     | Запуск собранного приложения            |
| `npm run lint`      | ESLint                                  |
| `npm run type-check`| `tsc --noEmit`                          |
| `npm run db:migrate`| Применить/создать миграции Prisma       |
| `npm run db:reset`  | Сбросить БД и пересоздать с нуля        |
| `npm run db:studio` | Открыть Prisma Studio                   |
| `npm run db:generate`| Сгенерировать Prisma Client            |

## Структура

```
prisma/
  schema.prisma            — 11 моделей: Contact, ContactIdentity, PhoneNumber,
                             Email, Chat, ChatMember, Message, Relationship,
                             Tag, ContactTag, ImportJob
  migrations/              — история миграций
src/
  app/
    layout.tsx             — корневой layout (ThemeProvider + Sidebar + Header + Toaster)
    page.tsx               — главная (дашборд с 4 плитками)
    contacts/page.tsx      — список контактов (Server Component через db.contact)
    chats|graph|search|import|settings/page.tsx — заглушки
    api/
      contacts/
        route.ts           — GET (список с фильтрами), POST (создать)
        [id]/route.ts      — GET / PATCH / DELETE одного
  components/
    layout/
      Sidebar.tsx          — десктоп-сайдбар + контент для мобильного Sheet
      Header.tsx           — шапка с гамбургером и переключателем темы
      PageHeader.tsx       — общий заголовок страницы (title/description/action)
      ThemeToggle.tsx      — переключатель light/dark/system
      nav-items.ts         — общий список пунктов меню
    contacts/
      AddContactDialog.tsx — диалог добавления (react-hook-form + zod)
      ContactsTable.tsx    — таблица контактов
    ui/                    — shadcn (button, card, input, label, dialog, table,
                             sonner, badge, separator, sheet, skeleton, tooltip,
                             scroll-area, dropdown-menu)
    theme-provider.tsx     — обёртка next-themes
  lib/
    db.ts                  — singleton Prisma Client
    api.ts                 — единый формат ответов { ok, data } / { ok, error }
    utils.ts               — cn() и пр.
    validators/
      contact.ts           — Zod-схемы для создания/обновления/листинга
    parsers/               — парсеры файлов (vCard, Telegram, ...) — добавятся позже
sample-data/               — личные .vcf/json (в .gitignore)
scripts/                   — вспомогательные TS-скрипты (через tsx)
```

## Соглашения

- **API ответ**: `{ ok: true, data }` при успехе; `{ ok: false, error: { code, message, details? } }` при ошибке. Никаких голых объектов.
- **Валидация**: все входы API через Zod; ошибка валидации → 400 с `code: "VALIDATION_ERROR"`.
- **Доступ к БД**: только через `src/lib/db.ts`. `new PrismaClient()` напрямую — запрещено.
- **TypeScript**: `strict: true`, без `any`. Неизвестные данные — `unknown` + Zod-парсинг.
- **Серверные компоненты по умолчанию.** `'use client'` — только когда нужны hooks/интерактив/формы.
