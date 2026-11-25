# SecondBrain — E2E Test Infrastructure & Strategy (`TEST_INFRA.md`)

## 1. Test Philosophy (Opaque-Box, Requirement-Driven)
SecondBrain's E2E test suite (`tests/e2e/`) is designed as an **opaque-box, requirement-driven verification suite** derived exclusively from `ORIGINAL_REQUEST.md` and `PROJECT.md` (Feature Inventory & Interface Contracts).

- **Zero Implementation Coupling**: E2E tests interact solely through public HTTP API contracts (`/api/*`), browser navigation & DOM interactions (`@playwright/test`), and PWA endpoints (`/manifest.webmanifest`, `/sw.js`, `/offline`, `/icons/*`). They never import internal domain services from `src/modules/**`.
- **Genuine, Non-Tautological Assertions**: Every test verifies real behavioral invariants — exact `Decimal(19,4)` arithmetic strings, signed-balance Net Worth conservation (`BANK` + `CASH` + negative `CREDIT_CARD`), HTTP status codes & canonical error envelopes (`{ ok: false, error: { code, message } }`), database persistence across reloads, computed CSS luminance for dark/light themes, PNG magic bytes for PWA icons, and real `context.setOffline(true)` service worker fallback.
- **Bilingual & Copy-Resilient UI Locators**: Because the app serves Spanish-first UX (`<html lang="es">`) with English/Spanish financial domain terminology, browser tests use semantic ARIA roles, `href`-based navigation locators, bilingual regexes, and API-backed verification rather than brittle exact text snapshots.
- **Deterministic Test Isolation**: Playwright runs serially (`workers: 1`, `fullyParallel: false`) against the dedicated `secondbrain_test` PostgreSQL database. Each test resets the database cleanly via `tests/helpers/db-reset.ts` (which enforces a `_test` URL safety guard) and mints real BetterAuth sessions via `tests/helpers/test-auth.ts`.

---

## 2. Test Architecture (4-Tier Suite)

```text
tests/e2e/
├── fixtures.ts                 # Shared E2E fixtures (dotenv bootstrap, owner/unauth/forbidden sessions, PDF generator, luminance & envelope assertions)
├── tier1-features.spec.ts      # Tier 1: Isolated happy-path coverage across every user-facing feature area
├── tier2-boundaries.spec.ts    # Tier 2: Boundary values, Decimal(19,4) edge cases, negative & error-handling contracts
├── tier3-cross-feature.spec.ts # Tier 3: Cross-feature pairwise interactions & multi-module invariants
└── tier4-scenarios.spec.ts     # Tier 4: 6 realistic end-to-end user workflows (Browser + API + PWA + Security)
```

### Runtime & Environment Alignment
- **Playwright Version**: `@playwright/test@1.65.1` (matching pre-installed `/opt/ms-playwright` Chromium).
- **Config**: `playwright.config.ts` (`testDir: "./tests/e2e"`, `baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"`, `workers: 1`).
- **Env Invariant**: Both Playwright and the Next.js server MUST share the same `DATABASE_URL` (pointing to `secondbrain_test`), `BETTER_AUTH_SECRET`, and `ALLOWED_EMAIL` so cookies minted by `tests/helpers/test-auth.ts` pass signature verification on the live server.

---

## 3. Feature Inventory Coverage Matrix (`PROJECT.md § Feature Inventory`)

All 37 features from `PROJECT.md` are accounted for below (**28 directly E2E-verifiable**, **1 test-support harness**, **3 infra-indirect**, and **5 infra-only**):

| # | Feature ID | Feature | Classification | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|------------|---------|----------------|:------:|:------:|:------:|:------:|
| 1 | `INFRA-01` | Git Branch & `.gitignore` | Infra-Only | — | — | — | — |
| 2 | `INFRA-02` | Next.js + TS + Tailwind Scaffold | Infra (Indirect) | ✓ | — | — | ✓ |
| 3 | `INFRA-03` | Local Docker PostgreSQL | Infra (Indirect) | ✓ | — | — | ✓ |
| 4 | `INFRA-04` | Prisma ORM Setup (20 Models) | Infra (Indirect) | ✓ | ✓ | ✓ | ✓ |
| 5 | `INFRA-05` | Env Config & Validation | Infra-Only | — | — | — | — |
| 6 | `INFRA-08` | Health Check Endpoint (`GET /api/health`) | E2E-Verifiable | ✓ | — | — | — |
| 7 | `INFRA-09` | Automated Test Harness | Infra-Only | — | — | — | — |
| 8 | `F-AUTH-01` | BetterAuth + Prisma Core | E2E-Verifiable | ✓ | ✓ | — | ✓ |
| 9 | `F-AUTH-02` | Google OAuth + `ALLOWED_EMAIL` | E2E-Verifiable | ✓ | ✓ | — | ✓ |
| 10 | `F-AUTH-03` | Passkeys / WebAuthn Backend | E2E-Verifiable | — | — | — | ✓ |
| 11 | `F-AUTH-04` | Isolated Test Auth Harness | Test Support | ✓ | ✓ | ✓ | ✓ |
| 12 | `F-CORE-01` | Shared Core Services & API (`settings`, `modules`, `tags`, `entity-links`, `audit-logs`) | E2E-Verifiable | ✓ | ✓ | ✓ | ✓ |
| 13 | `F-FIN-01` | Financial Accounts CRUD (`BANK`, `CASH`, `CREDIT_CARD`, archive) | E2E-Verifiable | ✓ | ✓ | ✓ | ✓ |
| 14 | `F-FIN-02` | Concurrency-Safe Transfers (`OUT`/`IN` paired legs, `FOR UPDATE`) | E2E-Verifiable | ✓ | ✓ | ✓ | ✓ |
| 15 | `F-FIN-03` | Transactions Ledger & CSV/JSON Export | E2E-Verifiable | ✓ | ✓ | ✓ | ✓ |
| 16 | `F-FIN-04` | Categories & Monthly Budgets (thresholds & spent aggregation) | E2E-Verifiable | ✓ | ✓ | ✓ | ✓ |
| 17 | `F-FIN-05` | Recurring Rules & Idempotent Runner | E2E-Verifiable | ✓ | ✓ | ✓ | ✓ |
| 18 | `GMAIL-01` | Gmail OAuth Scope & Token Refresh (graceful degradation) | E2E-Verifiable | ✓ | — | — | — |
| 19 | `GMAIL-02` | `EmailSyncState` Incremental Sync | E2E-Verifiable | ✓ | — | — | — |
| 20 | `GMAIL-03` | Message + PDF Attachment Deduplication | E2E-Verifiable | ✓ | ✓ | — | ✓ |
| 21 | `PARSE-01` | PDF Text Extraction (`unpdf` + corrupt input guard) | E2E-Verifiable | ✓ | ✓ | — | ✓ |
| 22 | `PARSE-02` | Deterministic Bilingual EN/ES Rule-Based Parser | E2E-Verifiable | ✓ | ✓ | — | ✓ |
| 23 | `PARSE-03` | AI/LLM Fallback Parser (graceful degradation without key) | E2E-Verifiable | — | ✓ | — | — |
| 24 | `F-FIN-06` | Inbox Staging Isolation (balances untouched while `PENDING`) | E2E-Verifiable | ✓ | ✓ | ✓ | ✓ |
| 25 | `INBOX-01` | Review Inbox API (`GET`/`PATCH` & status filters) | E2E-Verifiable | ✓ | ✓ | ✓ | ✓ |
| 26 | `INBOX-02` | Atomic Inbox Confirm (`409` double-confirm guard, `AuditLog`) | E2E-Verifiable | ✓ | ✓ | ✓ | ✓ |
| 27 | `INBOX-03` | Inbox Reject / Dismiss (`AuditLog`, zero balance effect) | E2E-Verifiable | ✓ | ✓ | — | ✓ |
| 28 | `UI-01` | Dark-First Zero-FOUC Theme System & Light Toggle | E2E-Verifiable | ✓ | — | ✓ | ✓ |
| 29 | `UI-02` | Responsive Command Center Shell (Desktop Sidebar + Mobile Bottom Nav) | E2E-Verifiable | ✓ | — | — | ✓ |
| 30 | `UI-03` | Command Center Bento Grid Dashboard (`/`) | E2E-Verifiable | ✓ | — | ✓ | ✓ |
| 31 | `UI-04` | Core Finance, Inbox, Auth & Settings Pages (all 11 routes) | E2E-Verifiable | ✓ | — | ✓ | ✓ |
| 32 | `PWA-01` | Web App Manifest (`/manifest.webmanifest`) & PNG Icons | E2E-Verifiable | ✓ | — | — | ✓ |
| 33 | `PWA-02` | Service Worker (`/sw.js`, Network-Only `/api/*`, registration) | E2E-Verifiable | ✓ | — | — | ✓ |
| 34 | `PWA-03` | Standalone Public Offline Fallback Page (`/offline`) | E2E-Verifiable | ✓ | — | — | ✓ |
| 35 | `INFRA-06` | PWA Build & Header Verification (`Cache-Control`, `Content-Type`) | E2E-Verifiable | ✓ | — | — | ✓ |
| 36 | `INFRA-07` | Production Deployment Packaging (`Dockerfile`, prod compose) | Infra-Only | — | — | — | — |
| 37 | `INFRA-10` | CI Workflow (`.github/workflows/ci.yml`) | Infra-Only | — | — | — | — |

---

## 4. Tier 4 Real-World Application Scenarios (`tests/e2e/tier4-scenarios.spec.ts`)
1. **Scenario 1 — Full Monthly Personal Finance Lifecycle**: Setup `BANK`, `CASH`, and `CREDIT_CARD` accounts, hierarchical categories, and monthly budgets; record salary income and daily expenses; pay down the credit card via an account-to-account transfer; verify exact Net Worth, budget spent/remaining, and Command Center Bento Grid rendering on `/`.
2. **Scenario 2 — Gmail / Hybrid Parser Review Inbox Workflow**: Ingest a bilingual EN/ES bank email alert and a PDF statement attachment via `/api/inbox/ingest`; verify all account balances remain untouched while `PENDING`; edit/categorize and confirm one item while rejecting the other; verify exact balance delta, linked `Transaction`, `AuditLog` entries, and `/inbox` UI rendering.
3. **Scenario 3 — Subscription & Recurring Billing Cycle**: Create due recurring bills (`MONTHLY` subscriptions), trigger `POST /api/finances/recurring/run` twice consecutively to prove idempotency (second run creates 0 duplicate transactions), and export the resulting ledger in both CSV and JSON formats.
4. **Scenario 4 — Responsive Command Center UX & Dark/Light Theme**: Verify desktop (`1280×800`) sidebar + Bento Grid layout vs mobile (`390×844`) fixed bottom navigation bar with zero horizontal overflow; verify zero-FOUC dark default on fresh context and light-mode toggle persistence across `localStorage`, `UserSettings`, and full page reload.
5. **Scenario 5 — PWA Installability & Offline Resilience**: Verify `/manifest.webmanifest` valid JSON + `200` PNG icons (magic-byte verified), `/sw.js` valid JS with `no-cache` headers and `/api/*` Network-Only bypass, `/offline` accessible without authentication, and real Chromium offline fallback behavior.
6. **Scenario 6 — Security & Access Control Audit**: Verify unauthenticated API `401` and page `/login` redirects, unauthorized-email `403 FORBIDDEN` rejection (fail-closed `ALLOWED_EMAIL`), and Passkey/WebAuthn device management UI rendering on `/settings` and `/login`.

---

## 5. Coverage & Quality Thresholds
- **TypeScript & Lint**: `pnpm typecheck` MUST pass with 0 errors across `tests/e2e/**`; `pnpm lint` MUST pass with 0 errors.
- **Discovery**: `pnpm exec playwright test --list` MUST discover all Tier 1–4 specs cleanly with zero syntax or import errors.
- **Feature Coverage**: 100% of E2E-verifiable features (28/28 directly verified + 3/3 infra-indirect + 1/1 test support) covered across Tiers 1–4.
- **Final Milestone Gate (M6)**: 100% pass rate across Tiers 1–4 against the live integrated Next.js + PostgreSQL application (`pnpm test:e2e`).
