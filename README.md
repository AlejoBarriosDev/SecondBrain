# SecondBrain — Personal Life OS (MVP: Personal Finances)

SecondBrain is a modular personal Life OS web application built as an installable Progressive Web App (PWA). Module 1 delivers a security-first Personal Finances Command Center with strict `Decimal(19,4)` accounting, concurrency-safe transfers, Gmail + hybrid (rules + optional LLM) statement/receipt ingestion via a Review Inbox, and Google OAuth + WebAuthn Passkeys restricted to a single personal email (`ALLOWED_EMAIL`).

## Stack

- **Framework**: Next.js 15 (App Router, `output: "standalone"`), React 19, TypeScript 5.8
- **Styling**: Tailwind CSS v4 (dark-mode-first with zero-FOUC theme toggle)
- **Database & ORM**: PostgreSQL 16 + Prisma ORM 6.19.3 (`Decimal(19,4)`)
- **Authentication**: BetterAuth 1.7.x (Google OAuth + fail-closed `ALLOWED_EMAIL` + `@better-auth/passkey` WebAuthn)
- **Gmail & Parsing**: Gmail API (`gmail.readonly`), `unpdf`, deterministic bilingual EN/ES parser + optional LLM fallback
- **Testing**: Vitest (unit + real-Postgres integration) and Playwright (E2E)

## Local Development

### Prerequisites

- Node.js 22+
- `pnpm` 10+ (`corepack enable`)
- Docker & Docker Compose (for local PostgreSQL 16)

### Setup

1. **Install dependencies** (automatically runs `prisma generate` via `postinstall`):

   ```bash
   pnpm install
   ```

2. **Configure environment variables**:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set at least `BETTER_AUTH_SECRET`, `ALLOWED_EMAIL`, and (for Google sign-in / Gmail sync) `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

3. **Start local PostgreSQL 16** (creates both `secondbrain` and `secondbrain_test` databases):

   ```bash
   docker compose up -d
   ```

4. **Run migrations & optional seed**:

   ```bash
   pnpm db:deploy
   pnpm db:seed
   ```

5. **Start the development server**:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Health check is available at `GET /api/health`.

## Verification & Testing

```bash
pnpm typecheck          # TypeScript static analysis
pnpm lint               # ESLint checks
pnpm test:unit          # Vitest unit tests (zero DB required)
pnpm test:integration   # Vitest integration tests against secondbrain_test
pnpm test               # All unit + integration tests
pnpm build              # Prisma generate + Next.js standalone production build
pnpm test:e2e           # Playwright end-to-end suite
```

## PWA & Security Architecture

- **Manifest**: Served natively at `/manifest.webmanifest` (`src/app/manifest.ts`) with `display: "standalone"`, `#09090b` dark palette, and 192×192, 512×512, maskable 512×512, and 180×180 Apple Touch icons in `public/icons/`.
- **Service Worker (`public/sw.js`)**:
  - **Strict Network-Only** for all `/api/*`, non-GET, and cross-origin requests — authenticated financial data and auth responses are **never** cached.
  - **Network-First** for page navigations with an automatic HTTP `200` fallback to the public zero-DB `/offline` page when offline (private HTML pages are never cached).
  - **Cache-First with background revalidation** for same-origin static assets (`/_next/static/*`, `/icons/*`, fonts, images).
  - Served with `Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /` via `next.config.ts`.
- **Standalone Offline Page**: `/offline` is statically rendered without database calls and excluded from auth middleware redirects.

## Deployment

### Option A: Vercel + Neon / Supabase

1. Provision a PostgreSQL 16 database on **Neon** or **Supabase**.
2. Set the following environment variables in your Vercel project:
   - `DATABASE_URL` (pooled connection string, e.g. PgBouncer)
   - `DIRECT_URL` (direct/unpooled connection string used by Prisma migrations)
   - `BETTER_AUTH_SECRET` (32+ random characters: `openssl rand -base64 32`)
   - `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` (e.g. `https://your-domain.vercel.app`)
   - `ALLOWED_EMAIL` (your personal Google email)
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   - `PASSKEY_RP_ID` (your domain hostname, e.g. `your-domain.vercel.app`), `PASSKEY_RP_NAME`, and `PASSKEY_ORIGIN` (`https://your-domain.vercel.app`)
   - Optional: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `CRON_SECRET`
3. Deploy: `package.json` includes `"postinstall": "prisma generate"` and `"build": "prisma generate && next build"`. Apply schema migrations against your production DB using:

   ```bash
   pnpm db:deploy
   ```

### Option B: VPS with Docker Compose

1. Copy `.env.example` to `.env` on your server and populate all production values (using `postgres` as the hostname in `DATABASE_URL`, e.g. `postgresql://secondbrain:<strong-password>@postgres:5432/secondbrain?schema=public`).
2. Build and launch the production stack (`app` + `postgres:16-alpine`):

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

3. Apply Prisma migrations on first deploy (and on subsequent releases):

   ```bash
   docker compose -f docker-compose.prod.yml run --rm app npx prisma migrate deploy
   ```

4. Place a TLS reverse proxy (Caddy, Traefik, or Nginx) in front of port `3000` so HTTPS is enabled (required for WebAuthn Passkeys and Service Worker installation).