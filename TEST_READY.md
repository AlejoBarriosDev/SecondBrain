# SecondBrain — E2E Test Suite Ready (`TEST_READY.md`)

**Status**: **READY FOR M6 EXECUTION** (E2E Testing Track Gate: **PASS** — Iteration 2)  
**Suite Architecture**: Opaque-Box, Requirement-Driven 4-Tier Playwright Suite (`@playwright/test@1.65.1`)  
**Total Discovered Tests**: **33 tests** across **4 spec files** (+ shared `tests/e2e/fixtures.ts`)

---

## 1. Exact Runner Commands

> **CRITICAL Environment Alignment**: Both Playwright (`tests/helpers/test-auth.ts`, `tests/helpers/db-reset.ts`) and the Next.js server MUST share the same `DATABASE_URL` (containing `_test`, pointing to `secondbrain_test`), `BETTER_AUTH_SECRET`, and `ALLOWED_EMAIL`.

### Run Full E2E Suite (All 4 Tiers)
```bash
DATABASE_URL="$DATABASE_URL_TEST" DIRECT_URL="$DATABASE_URL_TEST" pnpm test:e2e
```

### Run Per-Tier Commands
```bash
# Tier 1 — Isolated Happy-Path Feature Coverage (11 tests)
DATABASE_URL="$DATABASE_URL_TEST" DIRECT_URL="$DATABASE_URL_TEST" pnpm exec playwright test tests/e2e/tier1-features.spec.ts

# Tier 2 — Boundary Values, Corner Cases & Error Contracts (10 tests)
DATABASE_URL="$DATABASE_URL_TEST" DIRECT_URL="$DATABASE_URL_TEST" pnpm exec playwright test tests/e2e/tier2-boundaries.spec.ts

# Tier 3 — Cross-Feature Pairwise Combinations (6 tests)
DATABASE_URL="$DATABASE_URL_TEST" DIRECT_URL="$DATABASE_URL_TEST" pnpm exec playwright test tests/e2e/tier3-cross-feature.spec.ts

# Tier 4 — End-to-End Real-World Application Scenarios (6 tests)
DATABASE_URL="$DATABASE_URL_TEST" DIRECT_URL="$DATABASE_URL_TEST" pnpm exec playwright test tests/e2e/tier4-scenarios.spec.ts
```

### Static & Discovery Verification Commands
```bash
pnpm typecheck
pnpm exec eslint tests/e2e
pnpm exec playwright test --list
```

---

## 2. Coverage Summary Table

| Tier | Spec File | Tests | Focus |
|------|-----------|:-----:|-------|
| Shared Fixtures | `tests/e2e/fixtures.ts` | — | `dotenv` + `DATABASE_URL_TEST` bootstrap, owner/unauth/forbidden sessions (`test-auth.ts` + `db-reset.ts`), typed envelope assertions, genuine minimal PDF-1.4 generator, canvas-based Tailwind v4 `oklch`/`srgb` effective luminance measurement, PNG magic-byte validator, strict recurring run count extractor |
| **Tier 1** | `tests/e2e/tier1-features.spec.ts` | **11** | Health, Auth & `ALLOWED_EMAIL`, Shared Core APIs, Accounts CRUD, Categories & Budgets, Transactions CRUD + CSV/JSON Export, Transfers, Recurring Rules & Runner, Hybrid Parser + Review Inbox, Command Center UI & 10 Routes, PWA Manifest/Icons/SW/`/offline` |
| **Tier 2** | `tests/e2e/tier2-boundaries.spec.ts` | **10** | `Decimal(19,4)` exact precision & zero float drift, zero/negative/>4-decimal/non-numeric/malformed JSON rejection, self-transfer & archived account guards, self-link & duplicate tag guards, Auth `401`/`403`/redirect boundaries, `400 VALIDATION_ERROR` & `404 NOT_FOUND`, double-confirm `409` + concurrent races (`Promise.all`), missing `LLM_API_KEY` + corrupt PDF + deduplication, budget 80%/100% alert thresholds, month-end recurring clamping (`dayOfMonth: 31`) |
| **Tier 3** | `tests/e2e/tier3-cross-feature.spec.ts` | **6** | Inbox Confirm → Balance + Transaction + Budget + Dashboard Net Worth + AuditLog; `BANK` → `CREDIT_CARD` Transfer Net Worth conservation & Budget exclusion; Recurring Run → Transaction → CSV/JSON Export; Tags & Polymorphic `EntityLink` attached to Transactions & Accounts; UI Theme toggle persisted to `localStorage` + `/api/settings` across `page.reload()`; `ModuleConfig` toggle + `AuditLog` |
| **Tier 4** | `tests/e2e/tier4-scenarios.spec.ts` | **6** | (1) Full Monthly Personal Finance Lifecycle + Bento Grid, (2) Gmail/Hybrid Parser Review Inbox Workflow (EN/ES + PDF), (3) Subscription & Recurring Billing Cycle + Export, (4) Responsive Command Center UX (`1280×800` vs `390×844` mobile bottom nav) & Dark/Light Theme Persistence, (5) PWA Installability & Real Offline Resilience (`setOffline(true)` + Network-Only `/api/*`), (6) Security & Access Control Audit (`401`/`403`, redirects, Passkey UI) |
| **Total** | **4 spec files + fixtures** | **33** | **100% of E2E-verifiable features (28/28 directly verified + 3/3 infra-indirect + 1/1 test support)** |

---

## 3. Feature Coverage Checklist (`PROJECT.md § Feature Inventory`)
- [x] `INFRA-08`: Health Check Endpoint (`GET /api/health`) — Tier 1
- [x] `F-AUTH-01`: BetterAuth + Prisma Core (`401`, `/login` redirect, session cookie) — Tiers 1, 2, 4
- [x] `F-AUTH-02`: Google OAuth + fail-closed `ALLOWED_EMAIL` (`403 FORBIDDEN`) — Tiers 1, 2, 4
- [x] `F-AUTH-03`: Passkeys / WebAuthn UI & endpoints (`/login`, `/settings`) — Tier 4
- [x] `F-CORE-01`: Shared Core APIs (`settings`, `modules`, `tags`, `entity-links`, `audit-logs`) — Tiers 1, 2, 3, 4
- [x] `F-FIN-01`: Financial Accounts CRUD (`BANK`, `CASH`, `CREDIT_CARD`, archive) — Tiers 1, 2, 3, 4
- [x] `F-FIN-02`: Concurrency-Safe Transfers (paired `OUT`/`IN` legs, `FOR UPDATE`, parallel races) — Tiers 1, 2, 3, 4
- [x] `F-FIN-03`: Transactions Ledger CRUD, filtering, pagination & CSV/JSON Export — Tiers 1, 2, 3, 4
- [x] `F-FIN-04`: Hierarchical Categories & Monthly Budgets (spent vs limit, 80%/100% alerts) — Tiers 1, 2, 3, 4
- [x] `F-FIN-05`: Recurring Rules CRUD, idempotent runner & month-end clamping — Tiers 1, 2, 3, 4
- [x] `GMAIL-01`, `GMAIL-02`, `GMAIL-03`: Gmail sync graceful degradation & message/PDF deduplication — Tiers 1, 2, 4
- [x] `PARSE-01`, `PARSE-02`, `PARSE-03`: PDF extraction + corrupt PDF guard, bilingual EN/ES rules, LLM fallback degradation — Tiers 1, 2, 4
- [x] `F-FIN-06`, `INBOX-01`, `INBOX-02`, `INBOX-03`: Review Inbox staging isolation, inspect/edit, atomic confirm (`409` double-confirm), reject (`AuditLog`) — Tiers 1, 2, 3, 4
- [x] `UI-01`, `UI-02`, `UI-03`, `UI-04`: Dark-first zero-FOUC theme + light toggle persistence, Desktop sidebar + Mobile `390×844` bottom nav, Bento Grid dashboard, all 11 routes — Tiers 1, 3, 4
- [x] `PWA-01`, `PWA-02`, `PWA-03`, `INFRA-06`: `/manifest.webmanifest`, valid PNG icons, `/sw.js` headers & Network-Only `/api/*`, public `/offline` fallback — Tiers 1, 4
