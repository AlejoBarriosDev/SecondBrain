# Project: SecondBrain — Personal Life OS MVP (Module 1: Personal Finances)

## Architecture
SecondBrain is a modular personal Life OS web application built as an installable PWA with **Next.js 15 (App Router)**, **TypeScript 5.8**, **Tailwind CSS v4**, **PostgreSQL 16 (Docker Compose)**, **Prisma ORM 6.19.3**, and **BetterAuth 1.7.x + `@better-auth/passkey`**.

- **Shared Core Layer (`src/lib/`, `src/modules/core/`)**: Identity & session management (BetterAuth Google OAuth restricted by `ALLOWED_EMAIL` + Passkeys/WebAuthn), user preferences (`UserSettings`), module registry (`ModuleConfig`), cross-module tags (`Tag`, `EntityTag`), polymorphic attachments (`Attachment`), polymorphic graph links (`EntityLink`), and append-only audit trail (`AuditLog`). Every domain table is scoped with `userId` for future multi-user readiness.
- **Finance Engine (`src/modules/finances/`)**: Strictly `Decimal(19,4)` zero-float arithmetic via `Prisma.Decimal`, uniform signed-balance accounting (`BANK`/`CASH` positive assets, `CREDIT_CARD` negative liabilities, `Net Worth = SUM(balance)`), paired `OUT`/`IN` transfer legs (`transferGroupId`), deadlock-free PostgreSQL `SELECT ... FOR UPDATE ORDER BY id ASC` locking on all balance mutations, hierarchical categories, monthly budgets, recurring rules, and CSV/JSON export.
- **Gmail & Hybrid Parser Pipeline (`src/lib/integrations/`, `src/modules/finances/gmail-*`, `src/modules/finances/inbox-*`)**: Reuses BetterAuth's Google OAuth `Account` tokens (`gmail.readonly` scope) via a thin REST `IGmailClient`, tracks incremental cursors in `EmailSyncState` (`historyId` with 404 fallback), extracts PDF text via `unpdf` (`IPdfTextExtractor`), runs deterministic bilingual EN/ES `RuleBasedParser` first and falls back to Zod-validated provider-agnostic `ILlmParserClient` (gracefully degrading when `LLM_API_KEY` is absent). Sync **never** mutates account balances; all items land in `/inbox` (`EmailImportItem`) until explicitly Confirmed (atomic `FOR UPDATE`) or Rejected.
- **Command Center UI & PWA (`src/app/`, `src/components/`, `public/sw.js`)**: Dark-mode-by-default zero-FOUC theme with light toggle, responsive 12-column Bento Grid dashboard, desktop sidebar + mobile fixed bottom navigation bar, 11 routes, native `src/app/manifest.ts`, security-first `public/sw.js` (Network-Only `/api/*`, Network-First navigations with `/offline` fallback), and standalone public `/offline` route.
- **Deployment Duality**: Local Docker Compose (`postgres:16-alpine` with `secondbrain` + `secondbrain_test`), Vercel + Neon/Supabase (`DATABASE_URL` + `DIRECT_URL`), and VPS Docker (`output: "standalone"`, multi-stage `Dockerfile`, `docker-compose.prod.yml`).

### Pinned Dependency Versions (Critical Compatibility Constraints)
- `next@15.5.29`, `react@^19`, `react-dom@^19`, `typescript@^5.8.3`, `tailwindcss@^4`
- `prisma@6.19.3`, `@prisma/client@6.19.3` (MUST pin 6.19.3 — `prisma@latest` is 8.0.0-rc.35 which breaks BetterAuth adapter)
- `better-auth@1.7.28`, `@better-auth/passkey@1.7.28`
- `zod`, `lucide-react`, `unpdf`
- `vitest`, `@playwright/test@1.65.1` (matches pre-installed `/opt/ms-playwright` browsers)
- Package manager: `pnpm`

## Code Layout
```text
/home/antigravity/AlejoBarriosDev/SecondBrain/
├── .gitignore                        # MUST ignore .agents/, .env*, !.env.example, .next/, node_modules/, coverage/, playwright-report/, test-results/
├── .env.example                      # Documented env vars (never commit real secrets — repo is PUBLIC)
├── docker-compose.yml                # Local Postgres 16 (secondbrain + secondbrain_test)
├── docker-compose.prod.yml           # VPS production stack (app + postgres)
├── Dockerfile                        # Multi-stage standalone Next.js + Prisma build
├── docker/postgres/init.sql          # Creates secondbrain_test DB
├── next.config.ts                    # output: "standalone", SW Cache-Control headers
├── package.json                      # Pinned versions + scripts (dev, build, start, typecheck, lint, test, test:unit, test:integration, test:e2e)
├── vitest.config.ts                  # Unit & integration test projects
├── playwright.config.ts              # E2E config using /opt/ms-playwright
├── prisma/
│   ├── schema.prisma                 # 20 models (12 Shared Core + 8 Finance), Decimal(19,4), userId-scoped
│   ├── migrations/                   # SQL migrations
│   └── seed.ts                       # Idempotent starter categories/settings seed
├── public/
│   ├── sw.js                         # Security-first service worker (Network-Only /api/*, /offline fallback)
│   └── icons/                        # icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
├── src/
│   ├── middleware.ts                 # Optimistic session cookie redirect (excludes /login, /offline, /api/auth/*, /api/health, /manifest.webmanifest, /sw.js, /icons/*)
│   ├── lib/
│   │   ├── env.ts                    # Zod runtime env validator
│   │   ├── db/                       # prisma.ts, decimal.ts, locks.ts (SELECT ... FOR UPDATE ORDER BY id ASC)
│   │   ├── auth/                     # auth.ts (BetterAuth + ALLOWED_EMAIL + passkey), auth-client.ts, session.ts
│   │   └── integrations/             # gmail-client.ts (IGmailClient), llm-client.ts (ILlmParserClient), pdf-extractor.ts (IPdfTextExtractor)
│   ├── modules/
│   │   ├── core/                     # settings, modules, tags, entity-links, attachments, audit-log services & Zod schemas
│   │   └── finances/                 # accounts, categories, budgets, transactions, transfers, recurring, dashboard, export, rule-parser, hybrid-parser, gmail-sync, inbox services & Zod schemas
│   ├── components/
│   │   ├── layout/                   # AppShell, DesktopSidebar, Topbar, MobileBottomNav, ThemeProvider, ThemeToggle, PwaRegister
│   │   ├── dashboard/                # Bento Grid cards (NetWorthHero, InboxWidget, AccountsBento, BudgetsBento, RecentTxBento, RecurringBento)
│   │   ├── finances/                 # Feature UIs for accounts, transactions, transfers, budgets, categories, recurring, inbox
│   │   ├── settings/                 # Profile, PasskeysManager, Theme/Currency, GmailSyncSettings, ModuleConfigPanel
│   │   └── ui/                       # Reusable primitives (Card, Button, Badge, Input, Select, Dialog/Drawer, Toast)
│   └── app/
│       ├── layout.tsx                # Zero-FOUC dark-first script + ThemeProvider + PwaRegister
│       ├── globals.css               # Tailwind v4 + dark/light CSS variables + tabular-nums
│       ├── manifest.ts               # Native Next.js MetadataRoute.Manifest
│       ├── page.tsx                  # Command Center Bento Grid Dashboard (/)
│       ├── login/page.tsx            # Google OAuth + Passkey sign-in
│       ├── offline/page.tsx          # Public zero-DB offline fallback
│       ├── accounts/page.tsx
│       ├── transactions/page.tsx
│       ├── transfers/page.tsx
│       ├── budgets/page.tsx
│       ├── categories/page.tsx
│       ├── recurring/page.tsx
│       ├── inbox/page.tsx
│       ├── settings/page.tsx
│       ├── actions/                  # Server Actions
│       └── api/
│           ├── health/route.ts
│           ├── auth/[...all]/route.ts
│           ├── settings/route.ts
│           ├── modules/route.ts
│           ├── tags/route.ts
│           ├── entity-links/route.ts
│           ├── audit-logs/route.ts
│           ├── finances/
│           │   ├── dashboard/route.ts
│           │   ├── accounts/route.ts & [id]/route.ts
│           │   ├── categories/route.ts & [id]/route.ts
│           │   ├── transactions/route.ts & [id]/route.ts
│           │   ├── transfers/route.ts & [transferGroupId]/route.ts
│           │   ├── budgets/route.ts & [id]/route.ts
│           │   ├── recurring/route.ts & [id]/route.ts & run/route.ts
│           │   └── export/route.ts
│           └── inbox/
│               ├── route.ts          # GET list, POST ingest/test-sync helper
│               ├── sync/route.ts     # POST trigger Gmail sync
│               └── [id]/
│                   ├── route.ts      # GET/PATCH item
│                   ├── confirm/route.ts
│                   └── reject/route.ts
├── tests/
│   ├── helpers/                      # test-auth.ts (isolated BetterAuth testUtils()), db-reset.ts
│   ├── unit/                         # Vitest unit tests (owned by Implementation Track)
│   ├── integration/                  # Vitest real-Postgres integration tests (owned by Implementation Track)
│   └── e2e/                          # Playwright + API opaque-box E2E tests (owned by E2E Testing Track)
└── .github/workflows/ci.yml          # CI pipeline
```

## Feature Inventory
Every Survey feature from `explorer_survey_1`, `explorer_survey_2`, and `explorer_survey_3` is assigned a milestone (none unassigned):

| # | Feature ID | Feature | Description | Milestone | Source |
|---|------------|---------|-------------|-----------|--------|
| 1 | `INFRA-01` | Git Branch & `.gitignore` | Widen fetch refspec, checkout `develop` tracking `origin/develop`, create `.gitignore` excluding `.agents/` & `.env*` | M1 | survey_1 |
| 2 | `INFRA-02` | Next.js + TS + Tailwind Scaffold | Next.js 15 App Router, TypeScript 5.8, Tailwind CSS v4, ESLint, `@/*` alias, `output: "standalone"` | M1 | survey_1 |
| 3 | `INFRA-03` | Local Docker PostgreSQL | `docker-compose.yml` (`postgres:16-alpine`), healthcheck, init SQL creating `secondbrain` & `secondbrain_test` | M1 | survey_1 |
| 4 | `INFRA-04` | Prisma ORM Setup (20 Models) | Pinned `prisma@6.19.3` & `@prisma/client@6.19.3`, `DATABASE_URL` + `DIRECT_URL`, full 20-model schema, migrations, seed, `src/lib/db/` | M1 | survey_1, survey_2 |
| 5 | `INFRA-05` | Env Config & Validation | `.env.example` + Zod runtime validator (`src/lib/env.ts`) | M1 | survey_1 |
| 6 | `INFRA-08` | Health Check Endpoint | `GET /api/health` verifying app + PostgreSQL connectivity | M1 | survey_1 |
| 7 | `INFRA-09` | Automated Test Harness | Vitest config (unit + integration) & Playwright config (`@playwright/test@1.65.1` using `/opt/ms-playwright`) | M1 | survey_1 |
| 8 | `F-AUTH-01` | BetterAuth + Prisma Core | `/api/auth/[...all]`, `nextCookies()`, `requireSession()`, optimistic `middleware.ts` | M1 | survey_2 |
| 9 | `F-AUTH-02` | Google OAuth + `ALLOWED_EMAIL` | Fail-closed `ALLOWED_EMAIL` check in both `user.create.before` and `session.create.before`, offline refresh token capture | M1 | survey_2 |
| 10 | `F-AUTH-03` | Passkeys / WebAuthn Backend | `@better-auth/passkey` server & client plugin integration (`rpID`, `rpName`, `origin`, `Passkey` model) | M1 | survey_2 |
| 11 | `F-AUTH-04` | Isolated Test Auth Harness | `tests/helpers/test-auth.ts` using BetterAuth `testUtils()` (never imported in `src/`) | M1 | survey_2 |
| 12 | `F-CORE-01` | Shared Core Module Services & API | `UserSettings`, `ModuleConfig`, `Tag`, `EntityTag`, `Attachment`, `EntityLink`, `AuditLog` services + APIs + first-login seeding | M1 | survey_2 |
| 13 | `F-FIN-01` | Financial Accounts CRUD | `BANK`, `CASH`, `CREDIT_CARD` accounts with `Decimal(19,4)`, credit limits, closing/due days, archive | M2 | survey_2 |
| 14 | `F-FIN-02` | Concurrency-Safe Transfers | Paired `OUT`/`IN` transfer legs (`transferGroupId`) with PostgreSQL `SELECT ... FOR UPDATE ORDER BY id ASC` | M2 | survey_2 |
| 15 | `F-FIN-03` | Transactions Ledger & Export | `INCOME`/`EXPENSE`/`TRANSFER` CRUD, atomic balance updates, tags, filtering, pagination, CSV/JSON export | M2 | survey_2 |
| 16 | `F-FIN-04` | Categories & Monthly Budgets | Hierarchical categories CRUD + monthly budgets with real-time spent vs limit aggregation & alert thresholds | M2 | survey_2 |
| 17 | `F-FIN-05` | Recurring Rules & Runner | Subscriptions/recurring CRUD + idempotent due-rule runner (`POST /api/finances/recurring/run`) | M2 | survey_2 |
| 18 | `GMAIL-01` | Gmail OAuth Scope & Token Refresh | `gmail.readonly` scope check + automatic refresh via BetterAuth `Account` | M3 | survey_3 |
| 19 | `GMAIL-02` | `EmailSyncState` Incremental Sync | `historyId` incremental sync with 404 expired-cursor fallback & concurrency lock | M3 | survey_3 |
| 20 | `GMAIL-03` | Message + PDF Attachment Deduplication | MIME traversal, PDF fetch (10MB cap), `Attachment` metadata, `externalMessageId` idempotency | M3 | survey_3 |
| 21 | `PARSE-01` | PDF Text Extraction | `IPdfTextExtractor` (`unpdf`) with size/page/timeout guards | M3 | survey_3 |
| 22 | `PARSE-02` | Deterministic Rule-Based Parser | Bilingual EN/ES bank/card/transfer regex + PDF statement rows + `Decimal(19,4)` normalization + confidence score | M3 | survey_3 |
| 23 | `PARSE-03` | AI/LLM Fallback Parser | Provider-agnostic `ILlmParserClient` + Zod validation + graceful degradation when `LLM_API_KEY` is absent | M3 | survey_3 |
| 24 | `F-FIN-06` | Inbox Staging Isolation | `EmailImportItem` staging invariant — sync never touches `FinancialAccount.balance` | M3 | survey_2, survey_3 |
| 25 | `INBOX-01` | Review Inbox API | List/filter/inspect/edit `EmailImportItem` (`PENDING`/`CONFIRMED`/`REJECTED`) + sync trigger | M3 | survey_3 |
| 26 | `INBOX-02` | Atomic Inbox Confirm | `POST /api/inbox/[id]/confirm` with `FOR UPDATE` item + account locks, `409` double-confirm guard, `Transaction` + `AuditLog` | M3 | survey_3 |
| 27 | `INBOX-03` | Inbox Reject / Dismiss | `POST /api/inbox/[id]/reject` with `AuditLog` and zero balance side effects | M3 | survey_3 |
| 28 | `UI-01` | Dark-First Zero-FOUC Theme System | Default dark mode, inline pre-paint script, light toggle persisted to `localStorage` + `UserSettings` | M4 | survey_3 |
| 29 | `UI-02` | Responsive Command Center Shell | Desktop sidebar + topbar; mobile fixed bottom navigation bar (5 slots + More drawer) | M4 | survey_3 |
| 30 | `UI-03` | Command Center Bento Grid Dashboard | 12-col responsive Bento Grid (`/`): Net Worth hero, Inbox widget, Accounts, Budgets, Recent Tx, Recurring | M4 | survey_3 |
| 31 | `UI-04` | Core Finance, Inbox, Auth & Settings Pages | `/login`, `/accounts`, `/transactions`, `/transfers`, `/budgets`, `/categories`, `/recurring`, `/inbox`, `/settings` (incl. Passkey device mgmt & Gmail sync config) | M4 | survey_3 |
| 32 | `PWA-01` | Web App Manifest & Icons | `src/app/manifest.ts` (`/manifest.webmanifest`) + valid PNG icons in `public/icons/` | M5 | survey_3 |
| 33 | `PWA-02` | Service Worker & Registration | `public/sw.js` (Network-Only `/api/*`, Network-First HTML → `/offline`, Cache-First static) + `PwaRegister` + SW headers | M5 | survey_3 |
| 34 | `PWA-03` | Standalone Offline Fallback Page | Public zero-DB `/offline` route precached by SW | M5 | survey_3 |
| 35 | `INFRA-06` | PWA Build & Header Verification | Turbopack/Next 15 compatible PWA headers & installability checks | M5 | survey_1, survey_3 |
| 36 | `INFRA-07` | Production Deployment Packaging | Multi-stage `Dockerfile`, `docker-compose.prod.yml`, Vercel + Neon/Supabase readiness (`postinstall` prisma generate, `README.md`) | M5 | survey_1 |
| 37 | `INFRA-10` | CI Workflow | `.github/workflows/ci.yml` (typecheck, lint, unit + Postgres integration tests, build) | M5 | survey_1 |

## Milestones
| # | Name | Scope | Dependencies | Status | Sub-Orch Conv ID |
|---|------|-------|--------------|--------|------------------|
| M1 | Foundation, Schema, Auth & Core | `INFRA-01..05,08,09`, `F-AUTH-01..04`, `F-CORE-01` + git `develop` init commit & push | none | IN_PROGRESS | `88ea6a72f2090fc970a03b34e6cabec6` |
| M2 | Core Finance Engine & Ledger API | `F-FIN-01..05` + real-Postgres unit/integration tests + commit & push to `develop` | M1 | PLANNED | - |
| M3 | Gmail, Hybrid Parser & Review Inbox API | `GMAIL-01..03`, `PARSE-01..03`, `F-FIN-06`, `INBOX-01..03` + unit/integration tests + commit & push to `develop` | M2 | PLANNED | - |
| M4 | Command Center UI/UX & All App Pages | `UI-01..04` (all interactive pages, dark-first Bento Grid, mobile bottom nav, Passkey & Inbox UI) + commit & push to `develop` | M3 | PLANNED | - |
| M5 | PWA & Production Deployment Packaging | `PWA-01..03`, `INFRA-06,07,10` (`manifest.ts`, `sw.js`, `/offline`, icons, Dockerfile, `docker-compose.prod.yml`, CI, README) + commit & push to `develop` | M4 | PLANNED | - |
| E2E | E2E Testing Track (Parallel) | Opaque-box 4-tier E2E test suite (`TEST_INFRA.md` → `tests/e2e/` → `TEST_READY.md`) | M1 (scaffold) | PLANNED | - |
| M6 | Final Milestone: E2E Pass (Tiers 1–4) & Tier 5 Adversarial | Phase 1: 100% pass Tiers 1–4; Phase 2: Tier 5 white-box adversarial hardening + final push to `develop` | M5, E2E | PLANNED | - |

## Interface Contracts

### Shared HTTP API Response Envelope
- Success: `200`/`201` JSON `{ ok: true, data: T }` (or paginated `{ ok: true, data: T[], meta: { total, page, pageSize } }`).
- Error: `400`/`401`/`403`/`404`/`409`/`500` JSON `{ ok: false, error: { code: string, message: string, fieldErrors?: Record<string, string[]> } }`.
- Monetary fields: serialized as fixed-scale decimal strings (e.g. `"123.4500"`), validated on input with `/^\d+(\.\d{1,4})?$/` (or signed for initial account balances).

### Auth ↔ All Modules (`src/lib/auth/session.ts`)
- `requireSession()`: returns `{ user: { id, email, name, image }, session }` after verifying BetterAuth session AND `isAllowedEmail(email)`. Throws `UnauthorizedError` (401) in API routes or redirects to `/login` in RSC pages.
- `assertAllowedEmail(email: string)`: fail-closed against `process.env.ALLOWED_EMAIL`.

### DB & Locking ↔ Finance / Inbox (`src/lib/db/`)
- `lockFinancialAccounts(tx, userId, accountIds)`: deduplicates, sorts `accountIds` ascending, runs `SELECT id, "userId", balance, currency, "isArchived" FROM "financial_accounts" WHERE id = ANY($1::text[]) AND "userId" = $2 ORDER BY id ASC FOR UPDATE`, verifies count & ownership.
- `toDecimal(value: string | Prisma.Decimal)`: strict `Prisma.Decimal` helper (rejects `NaN`, `Infinity`, non-numeric strings).

### Core Finance API Contracts
- `GET/POST /api/finances/accounts`, `GET/PATCH/DELETE /api/finances/accounts/[id]` (DELETE archives)
- `GET/POST /api/finances/categories`, `PATCH/DELETE /api/finances/categories/[id]`
- `GET/POST /api/finances/transactions`, `GET/PATCH/DELETE /api/finances/transactions/[id]`
- `GET/POST /api/finances/transfers`, `DELETE /api/finances/transfers/[transferGroupId]`
- `GET/POST /api/finances/budgets`, `DELETE /api/finances/budgets/[id]` (query `?year=YYYY&month=M` returns spent vs limit)
- `GET/POST /api/finances/recurring`, `PATCH/DELETE /api/finances/recurring/[id]`, `POST /api/finances/recurring/run`
- `GET /api/finances/dashboard` (net worth, monthly cashflow, accounts, budgets summary, recent transactions, upcoming recurring, pending inbox count)
- `GET /api/finances/export?format=csv|json`

### Gmail / Parser / Inbox API Contracts
- `IGmailClient`, `ILlmParserClient`, `IPdfTextExtractor` in `src/lib/integrations/` (injected via constructor for zero-network unit/integration tests)
- `GET /api/inbox?status=PENDING|CONFIRMED|REJECTED`
- `POST /api/inbox/sync` (triggers `GmailSyncService`; returns `{ synced, skipped, errors, state }`)
- `POST /api/inbox/ingest` (ingests raw email text / PDF base64 through `HybridParser` into `EmailImportItem` as `PENDING` — authenticated user only, enables manual import & clean E2E testing of the hybrid parser + inbox without live Gmail OAuth)
- `GET/PATCH /api/inbox/[id]` (inspect/edit parsed fields before confirmation)
- `POST /api/inbox/[id]/confirm` (atomic `FOR UPDATE` item + accounts → `Transaction` + balance update + `AuditLog`; returns `409` if already confirmed/rejected)
- `POST /api/inbox/[id]/reject` (marks `REJECTED` + `AuditLog`, zero balance mutation)

### Core Shared API Contracts
- `GET/PATCH /api/settings` (`UserSettings`)
- `GET/PATCH /api/modules` (`ModuleConfig`)
- `GET/POST/DELETE /api/tags` (`Tag` & `EntityTag`)
- `GET/POST/DELETE /api/entity-links` (`EntityLink`)
- `GET /api/audit-logs` (`AuditLog`)
- `GET /api/health` (public, checks DB `SELECT 1`)
