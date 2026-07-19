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
  revocable, 30-day TTL).
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
- **Attendance is device-first.** Records carry `externalId` (unique) so offline
  devices can re-upload batches idempotently. Manual entry exists only as
  `MANUAL_OVERRIDE`, is attributed (`recordedById`), flagged in the UI, and
  audit-logged. `(workerId, projectId, date)` is unique — one record per worker
  per site per day.
- **Labour cost is materialized at check-out** (`hours × hourlyRate` at that
  time) so later rate changes don't rewrite history. Financials count it under
  the LABOUR category alongside labour expenses.
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
  refuses to start with an invalid config).
- Uploads are stored on a Docker volume and served by the API; swap
  `middleware/upload.ts` for S3-compatible storage when needed.
