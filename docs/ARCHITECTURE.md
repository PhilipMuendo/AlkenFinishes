# AlkenFinishes — Architecture

## Overview

Monorepo (npm workspaces) with two deployable services behind Nginx:

```
┌──────────┐     ┌───────────────┐     ┌──────────────┐
│ Browser  │──▶──│ Nginx (web)   │──▶──│ API (Express)│──▶ PostgreSQL
│ (PWA)    │     │ SPA + proxy   │     │ Prisma ORM   │
└──────────┘     └───────────────┘     └──────┬───────┘
                                              │
   Fingerprint devices ──▶ /attendance/device-sync (API key)
```

- `apps/api` — Node.js 22, Express 4, TypeScript (strict), Prisma, Zod, Pino
- `apps/web` — React 18, Vite, TypeScript, Tailwind CSS, shadcn-style components,
  Recharts, TanStack Query, PWA (vite-plugin-pwa)

## Authentication & RBAC

- JWT access tokens (15 min) + rotating refresh tokens (SHA-256 hashed at rest,
  revocable, 30-day TTL). Reuse of a rotated refresh token is treated as theft:
  the whole token family is revoked and an audit event raised. Expired/revoked
  tokens are pruned daily.
- `requireAuth` does a live PK lookup on every request, so deactivation and
  role changes take effect immediately, not at token expiry.
- Login is rate-limited (10 attempts / 15 min per IP+email), failed attempts
  are audit-logged, and unknown emails burn a dummy bcrypt compare so response
  timing does not enumerate accounts. Hashing uses native `bcrypt` (threadpool,
  non-blocking).
- Two roles: `SUPERADMIN` and `SUPERVISOR`.
- Site scoping is enforced server-side in two layers:
  - `requireProjectAccess` middleware — any `/projects/:projectId/...` route
    verifies the supervisor is the project's assigned supervisor.
  - `projectScope()` — list queries filter by `supervisorId` for supervisors.
- Admin-only routes (`/users`, `/devices`, `/settings`, `/analytics/company`,
  project/budget mutations) use `requireSuperadmin`.
- Attendance devices authenticate with a per-device API key (hashed at rest),
  entirely separate from user auth.

## Domain model (key decisions)

- **Project = construction site.** Budget lines are one row per category with a
  unique `(projectId, category)` constraint.
- **Worker identity is separate from assignment.** `WorkerAssignment` rows have
  `endDate = null` for the current site; reassignment closes the old row in the
  same transaction, preserving history.
- **Attendance is device-first.** Idempotency is scoped per device — unique
  `(deviceId, externalId)` — so offline devices re-upload safely but cannot
  overwrite each other's records. Devices can be bound to one site (records for
  other sites are rejected), sync is rate-limited, and batches are processed
  with three grouped queries instead of per-record round trips. Manual entry
  exists only as `MANUAL_OVERRIDE`: restricted to workers currently assigned to
  the site, attributed, audit-logged, and surfaced on the owner's dashboard
  (override count per project, last 30 days). `(workerId, projectId, date)` is
  unique — one record per worker per site per day.
- **Labour cost is materialized at check-out** (`hours × hourlyRate` at that
  time). Check-out uses the server clock only, closed records cannot be
  re-checked-out, and shift length is capped (`MAX_SHIFT_HOURS`, default 14) on
  every path, so timestamps cannot inflate labour cost. To avoid
  double-counting wages, the owner picks the LABOUR source in Settings:
  attendance-accrued cost, labour expenses, or both (conservative default).
- **Stock is append-only.** Item quantity is only changed through
  `StockMovement` rows (IN / OUT / ADJUSTMENT) carrying user, date, quantity,
  reason; the movement and the quantity update commit in one transaction and
  overdraws are rejected.
- **Project progress** is derived: mean of task `completionPct`, recomputed on
  every task write.
- **Financial formulas** live in one service (`services/finance.ts`):
  `estimatedProfit = contractValue − totalActual`. Health color per category:
  GREEN below `yellowPct`, YELLOW from `yellowPct`, RED from `redPct`
  (thresholds configurable in Settings, stored in the `Setting` table).
- **Audit log** — every mutation writes a fire-and-forget `AuditLog` row
  (user, action, entity, metadata, IP).

## Attendance device integration

Portable fingerprint devices (or a bridge app on the supervisor's phone) push
batches:

```
POST /api/v1/attendance/device-sync
X-Device-Key: <per-device api key>
{ "deviceId": "ZK-01", "records": [
    { "biometricId": "FP-001", "date": "2026-07-15",
      "checkIn": "...", "checkOut": "...", "externalId": "ZK-01-0001" } ] }
```

- Workers are matched by `biometricId`; the site defaults to the worker's
  current assignment.
- Per-record status is returned (`ok`, `unknown_worker`, `no_assignment`,
  `duplicate_day`) so the bridge can surface enrolment problems.
- Re-sending a batch is safe (upsert on `externalId`) — supports offline
  devices that sync when connectivity returns.

## Frontend UX

- **Superadmin**: desktop-first sidebar shell → company dashboard (portfolio
  totals, spend trend, progress-vs-cost, per-project comparison with health
  chips), project workspace with tabs (financials, budget, tasks, expenses,
  attendance, stock, documents, daily reports), workers, team, settings.
- **Supervisor**: mobile-first shell (bottom nav, large touch targets). A site
  opens into five big action tiles — Attendance, Stock, Expenses, Tasks, Daily
  report. No financial data is shown or served to supervisors.
- Feature panels are shared components (`src/features/*`) mounted by both
  shells, so behavior stays consistent and code isn't duplicated.
- Charts follow a validated colorblind-safe palette; budget health is never
  conveyed by color alone (icon + label + percentage).

## Operations

- `docker-compose.yml`: `db` (Postgres 16 + healthcheck), `api` (runs
  `prisma migrate deploy` on boot), `web` (Nginx serving the SPA, proxying
  `/api` and `/uploads`). Named volumes for pgdata and uploads.
- Configuration is environment-only (validated with Zod at boot; the API
  refuses to start with an invalid config or a placeholder JWT secret in
  production, and the seed refuses default admin passwords in production).
- **Uploads are private.** Content is verified against magic bytes (client
  MIME is never trusted), files are served only through HMAC-signed expiring
  links with `nosniff`, and files are unlinked from disk when their records
  are deleted. Swap `middleware/upload.ts` for S3-compatible storage to scale
  horizontally.
- **Analytics are aggregated in SQL** (timezone-aware via `APP_TIMEZONE`,
  default `Africa/Nairobi`): dashboards cost a fixed number of grouped
  queries regardless of data volume.
- Nginx ships security headers + CSP; `nginx/nginx-ssl.conf.example` is the
  TLS/HSTS variant — production must terminate TLS.
- The frontend code-splits per route (supervisors never download the admin/
  charts bundle) and the PWA runtime-caches GET responses (network-first) so
  the app shows last-known data on poor site connectivity.
