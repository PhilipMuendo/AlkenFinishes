# AlkenFinishes — Architecture

## Overview

Monorepo (npm workspaces) with two deployable services behind Nginx:

```
┌──────────┐     ┌───────────────┐     ┌──────────────┐
│ Browser  │──▶──│ Nginx (web)   │──▶──│ API (Express)│──▶ PostgreSQL
│ (PWA)    │     │ SPA + proxy   │     │ Prisma ORM   │
└──────────┘     └───────────────┘     └──────┬───────┘
                                              │
      ZKTeco terminals ──push──▶ /iclock, /attendance/device-sync (API key)
      Suprema terminals ◀──poll── BioStar 2 REST API, every 2 min
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
- **Attendance is device-first, from either vendor.** Idempotency is scoped
  per device — unique `(deviceId, externalId)` — so offline ZKTeco devices
  re-upload safely but cannot overwrite each other's records; Suprema/BioStar 2
  ingestion uses a persisted event-ID cursor for the same reason. Devices can
  be bound to one site (records for other sites are rejected), sync is
  rate-limited, and batches are processed with grouped queries instead of
  per-record round trips. `(workerId, projectId, date)` is unique — one record
  per worker per site per day.
- **A supervisor cannot write attendance directly at all.** The only manual
  path is `AttendanceOverrideRequest`: a supervisor files a request (GPS
  captured client-side at submission), and only a superadmin's decision
  creates the actual `AttendanceRecord` (`method: MANUAL_OVERRIDE`). Approving
  and closing an open check-in (`POST /:id/checkout`) are both
  `requireSuperadmin` — "supervisors can't edit hours" means the write path
  itself, not just a UI restriction. A project's optional geofence
  (`geofenceLat/Lng/RadiusM`) is checked against the submitted coordinates and
  shown to the approver as `withinGeofence` — a signal to weigh, not an
  automatic gate, since client-reported GPS can be spoofed.
- **Overtime is computed where labour cost is written**
  (`services/attendanceIngest.ts`), not derived later in a report: hours past
  `STANDARD_SHIFT_HOURS` (8) are paid at `OVERTIME_MULTIPLIER` (1.5×), for
  every ingestion path — ZKTeco push, Suprema poll, and approved manual
  overrides all go through the same `computeCost()`.
- **Labour cost is materialized at check-out or event ingestion**
  (`hours × hourlyRate`, overtime-adjusted, at that time). Check-out uses the
  server clock only, closed records cannot be re-checked-out, and shift length
  is capped (`MAX_SHIFT_HOURS`, default 14) on every path, so timestamps
  cannot inflate labour cost. To avoid double-counting wages, the owner picks
  the LABOUR source in Settings: attendance-accrued cost, labour expenses, or
  both (conservative default).
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

Two integrations exist because the two vendors have fundamentally different
connection models — one is push, the other is poll — and that shape is
reflected in the code (`modules/iclock.ts` / `modules/attendance.ts`'s
`deviceRouter` for ZKTeco, `services/biostar.ts` for Suprema) rather than
forced into one interface. Both funnel into the same
`services/attendanceIngest.ts` core (`ingestPunches`, `computeCost`), so a
worker's attendance record looks identical regardless of which vendor produced
it.

### ZKTeco / ADMS (push)

A ZKTeco terminal is configured with this server's address and pushes its own
protocol to `/iclock` (`GET /cdata` for handshake/config, `POST /cdata` for
the attendance log upload — see `modules/iclock.ts`), authenticating by serial
number. A custom bridge can instead `POST` JSON batches:

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

### Suprema / BioStar 2 (poll)

A Suprema terminal (BioLite Net, BioEntry W, and others) doesn't push to a URL
at all — it's designed to report into **BioStar 2**, Suprema's own access
control server, running on the site LAN. There is no way for a BioLite Net to
call this app directly without Suprema's proprietary device SDK (a much
heavier integration than a documented REST API affords). So instead,
`services/biostar.ts` logs into that BioStar 2 server's REST API and polls it:

```
POST {biostarBaseUrl}/api/login            -> bs-session-id header
POST {biostarBaseUrl}/api/events/search    -> events since the stored cursor
```

- One `AttendanceDevice` row is one **BioStar 2 server**, not one physical
  terminal — `biostarDeviceId` optionally narrows polling to a single terminal
  when more than one reports to the same BioStar 2 instance.
- A worker's `biometricId` is matched against the BioStar 2 **User ID**
  (`user_id` on the event), the same convention as a ZKTeco PIN.
- The cursor is the highest BioStar 2 event ID already ingested
  (`biostarLastEventId`), not a timestamp — immune to clock drift between this
  server and the BioStar 2 box.
- The credentials needed are a BioStar 2 login, not a device-side secret — the
  password is encrypted at rest (`services/crypto.ts`, AES-256-GCM,
  `ENCRYPTION_KEY`) and never returned by the API after creation. A read-only
  BioStar 2 operator account is recommended over sharing the admin login.
- Polling runs every 2 minutes (`server.ts`); `POST /api/v1/devices/:id/sync`
  triggers an immediate one-off pull, used by the Settings page's "Sync now".
- **Event-type codes may need tuning per deployment.** `SUCCESS_EVENT_TYPES`
  in `services/biostar.ts` defaults to BioStar 2's standard "Verify Success"
  (4864) and "Identify Success" (4865) codes — the same two authentication
  modes a BioLite Net supports (1:1 with a card/PIN, or fingerprint alone). If
  events aren't showing up, check that BioStar 2 install's Monitoring > Event
  log for the exact `event_type_id` a successful match logs, the same way
  `iclock.ts` flags that ZKTeco firmware handshake details vary by model.
- BioStar 2's cert is commonly self-signed on a LAN appliance;
  `biostarInsecureTls` skips verification for that one device only (never a
  process-wide setting — see the `undici` per-request dispatcher in
  `services/biostar.ts`), and is off by default.

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
