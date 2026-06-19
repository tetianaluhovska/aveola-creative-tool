# CLAUDE.md — Project Knowledge Base

> Джерело правди для Claude Code. Його читає головний агент **і субагенти**
> (окремий контекст, не бачать чат — лише файли). Тримай правила тут, не в розмові.

## 🎯 Що будуємо

Веб-інструмент, що автоматизує рутинну задачу. Патерн: **ввід → AI → результат + історія
запусків**. Судять за живим демо (2–3 хв) і голосуванням. **Робоче демо важливіше за ідеальний код.**

### Наша ідея
- Одним реченням: інструмент бере креатив конкурента і генерує варіації під запуск,
  спираючись на наші ефективні креативи.
- AI-фіча: на вхід — креатив конкурента (Hook / Body / CTA / візуали / AI Description) +
  приклади наших виграшних як контекст; на вихід — N варіацій-брифів (hook + script +
  візуальний опис + rationale).
- Ввід → вивід: обираєш креатив конкурента → app повертає варіації → зберігаються в історію.

## ✅ Definition of Done (критерії оцінки)
1. **Задеплоєно й доступно по мережі** (Vercel, не localhost).
2. **UI** — робоча область (ввід / результат / історія).
3. **Auth + БД** — вхід (Google через Auth.js), дані юзера в Postgres (Prisma),
   відновлюються після логауту/повторного входу.
4. **AI-фіча** — мінімум одна, виклик на сервері.
5. **Демо** end-to-end на проді.

## 🧱 Стек
- **Next.js 16 (App Router)** + **React 19** + **TypeScript (strict)**
- **Auth.js v5** (next-auth@beta) + **Google provider**
- **Prisma 6** → **Postgres** (Prisma Postgres з console.prisma.io, або Neon)
- **AI**: server-side fetch до Claude (claude-sonnet-4-6). Ключі Claude + Gemini надані на воркшоп.
- **Deploy**: GitHub → Vercel (авто-деплой на push)

## 🔐 Незмінні правила
- **Ключі/секрети — лише в `.env.local`** і в Vercel Env Variables. Ніколи у фронтенд,
  ніколи в git. `.env*` уже в `.gitignore`.
- **AI-виклики — лише через серверний роут** `app/api/ai/route.ts` (`lib/ai.ts`). Ключ у фронтенді = публічний.
- Не over-engineer. Без тестів. Ціль — робоче демо.

## 🗄️ База (Prisma + Postgres)
`prisma/schema.prisma` datasource:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```
- **Prisma Postgres:** `DATABASE_URL` і `DIRECT_URL` можуть бути однаковими.
- **Neon:** `DATABASE_URL` = pooled, `DIRECT_URL` = unpooled. Якщо на pooled
  `prepared statement already exists` — додай `?pgbouncer=true` до `DATABASE_URL`.
- Створення таблиць: `npx prisma db push`.

## 🔑 Auth (Auth.js v5, НЕ v4)
- `auth.ts` (корінь) → `{ handlers, auth, signIn, signOut }`, Google **без** явних
  clientId/secret (читаються з `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`). `session.strategy = "jwt"`.
  Callback `session` прокидає `user.id` (= `token.sub`).
- **Сервер** (роути/RSC): `const session = await auth();` → 401 якщо немає.
- **Клієнт** ("use client"): `next-auth/react` — `<SessionProvider>` (app/providers.tsx),
  `useSession()`, `signIn("google")` / `signOut()`. НЕ імпортуй серверний signIn у клієнт.
- Redirect URI у Google: `.../api/auth/callback/google` (окремо localhost і прод).

## 🗂️ Структура
```
CLAUDE.md
auth.ts                          { handlers, auth, signIn, signOut }
lib/prisma.ts                    singleton PrismaClient
lib/ai.ts                        runAI(prompt, system?) → Claude, server-only
app/
  layout.tsx                     <Providers> навколо children
  providers.tsx                  "use client" <SessionProvider>
  page.tsx                       UI (на базі WorkspaceSkeleton), "use client"
  api/
    auth/[...nextauth]/route.ts  реекспорт GET, POST з handlers
    ai/route.ts                  POST { input } → auth() → runAI → save Entry → return
    entries/route.ts             GET → запуски юзера
prisma/schema.prisma             User, Account, Session, VerificationToken + Entry
```

## 🧩 Дані
- Auth.js моделі: User, Account, Session, VerificationToken.
- Entry — один запуск AI: id, userId, input, output, meta (Json), createdAt.

## 🗃️ Джерела для AI-фічі (Notion — на воркшопі)
Дві бази, **ідентичні за текстовими полями** (AI Description, Hook, Hook Visual, Body Visual,
CTA, CTA Visual, Transcript):
- 👀 **Competitor Creatives** — DB `2c8612cc6f8347f88d650beeb6c333e9`. Поля: + Competitor, Source.
- **Aveola Creatives AI Analysis** — DB `3830ba564a35807087d1eb34e23f824c`. Поля: + Product,
  **📈 Creo Result** (Okay/Good/Super). «Ефективні» = `📈 Creo Result` не порожнє.

env: `NOTION_TOKEN`, `NOTION_DB_COMPETITORS`, `NOTION_DB_OURS`.
Логіка `/api/ai`: тягнемо креатив конкурента + топ наших виграшних → промт → Claude → варіації.

## 🤖 AI — патерн (server-only, lib/ai.ts)
`fetch("https://api.anthropic.com/v1/messages")`, хедери `x-api-key: ANTHROPIC_API_KEY`,
`anthropic-version: 2023-06-01`; body `{ model:"claude-sonnet-4-6", max_tokens, system, messages }`.
Відповідь: зібрати текст із `data.content[].text`. У роуті: спершу `auth()`, потім `runAI`, потім `prisma.entry.create`.

## 🐛 Часті пастки
- 500 у проді, локально ок → env vars не додані у Vercel.
- AI 401 → не залогінений (роут вимагає сесію).
- Claude API 401/403 → битий ANTHROPIC_API_KEY.
- redirect_uri_mismatch → URI в Google != `.../api/auth/callback/google`.
- table does not exist → забув `npx prisma db push`.

## 🎬 Демо-чеклист
- [ ] Відкрити прод-URL.
- [ ] Вхід через Google → запуск AI → показати результат.
- [ ] Логаут → логін → історія на місці (доказ БД).
