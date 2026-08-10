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
      Language model   ◀──────── optional, opt-in by configuration
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
- Money is `requireSuperadmin` throughout: invoices, payments, payables,
  suppliers, tax, payroll, and per-project financials. **The boundary holds at
  the route, never in the UI.** `/analytics/projects/:id` is superadmin-only
  even though it is project-scoped, because it returns contract value, actual
  spend and estimated profit — the exact data the supervisor shell exists to
  withhold. A screen that merely declines to render something is not a control.
- Where a route is open to both roles, the handler narrows what each gets
  rather than the route being duplicated: `/expenses/mine` strips the payables
  position and payment history, `command-centre` omits its financial sections,
  and workers use a narrower field schema for supervisors.
- **Pay rates are the office's**, and the rule covers the derived figure too.
  `services/payVisibility.ts` strips `hourlyRate` from workers and `labourCost`
  from attendance records for anyone who is not the office — cost divided by
  hours is the rate, so removing the input while leaving the cost on screen
  would look like a boundary and not be one. A fundi added from a site screen
  starts at zero and is flagged on the Workers screen until the office sets a
  rate; a supervisor's guess reaching budget numbers would be worse than a
  visible gap.
- Attendance devices authenticate with a per-device API key (hashed at rest),
  entirely separate from user auth.

## Money

The rules below are the ones the system is actually built on. Most of the money
bugs this codebase has had were violations of one of them.

- **Integers, in cents.** `services/money.ts` is the only place money
  arithmetic happens: `toCents` / `fromCents` at the persistence boundary,
  `kes` for JSON, `sumCents`, `pctOfCents`, `lineTotalCents`. Nothing adds
  floats.
- **Derive, never store.** Previously-claimed amounts, payable balances and
  payroll totals are computed on demand. A stored copy is a second source of
  truth, and the two drift.
- **Void, never delete.** Numbered documents — invoices, receipts — are voided
  with a reason and keep their number. Every money aggregate filters
  `voidedAt: null`; a query that forgets to is a silent overstatement.
- **Withheld tax settles a debt exactly as cash does.** A client who withholds
  150,000 and pays 850,000 against a million-shilling invoice has settled it in
  full — they paid the rest to KRA on our behalf. Counting only cash leaves the
  invoice permanently short, marks it overdue, and chases the client for money
  they have already surrendered. The same is true in the other direction for
  supplier bills. `paymentSettledCents` is the shared answer, and anything
  presenting a balance must go through it.
- **Numbering is a counter row**, allocated inside the transaction that issues
  the document (`services/numbering.ts`), formatted `ALK-2026-000245`. The year
  comes from `APP_TIMEZONE`, not the process clock.
- **The four tax positions are never netted into one.** VAT charged out, VAT
  charged to us, tax we hold for KRA and tax already paid on our behalf are
  shown side by side, because netting is wrong in both directions: money owed
  is not reduced by credits that cannot yet be claimed, and a credit in hand is
  not cancelled by a liability falling due on another date.
- **Financial formulas live in one service** (`services/finance.ts`):
  `estimatedProfit = contractValue − totalActual`. Health colour per category:
  GREEN below `yellowPct`, YELLOW from `yellowPct`, RED from `redPct`
  (configurable in Settings, stored in the `Setting` table).

### The commercial chain

```
Lead → Quotation → Contract → Project (site) → Progress claim → Invoice → Receipt
                       │                                            │
                       └── variations change the contract sum        └── withholding
```

A quotation's priced schedule survives the whole way down: converting it to a
contract carries the lines, and the contract carries them to the site, where
`claim-schedule` measures progress against them. A claim states one thing per
line — percentage complete **to date** — and everything else is arithmetic:
what that is worth, what earlier claims already took, what this claim bills.

A site created directly rather than from a contract is not a dead end;
`attach-project` links one later, which is what makes claims possible on it.

## Domain model (other key decisions)

- **Project = construction site.** Budget lines are one row per category with a
  unique `(projectId, category)` constraint.
- **Worker identity is separate from assignment.** `WorkerAssignment` rows have
  `endDate = null` for the current site; reassignment closes the old row in the
  same transaction, preserving history.
- **Attendance is device-first, from either vendor.** Idempotency is scoped
  per device — unique `(deviceId, externalId)` — so offline ZKTeco devices
  re-upload safely but cannot overwrite each other's records; Suprema/BioStar 2
  ingestion uses a persisted event-ID cursor for the same reason. Devices can
  be bound to one site, sync is rate-limited, and batches are processed with
  grouped queries. `(workerId, projectId, date)` is unique.
- **A supervisor cannot write attendance directly at all.** The only manual
  path is `AttendanceOverrideRequest`: a supervisor files a request (GPS
  captured client-side at submission), and only a superadmin's decision
  creates the actual `AttendanceRecord` (`method: MANUAL_OVERRIDE`). Approving
  and closing an open check-in are both `requireSuperadmin` — "supervisors
  can't edit hours" means the write path itself, not a UI restriction. A
  project's optional geofence is checked against the submitted coordinates and
  shown to the approver as `withinGeofence` — a signal to weigh, not an
  automatic gate, since client-reported GPS can be spoofed.
- **Overtime is computed where labour cost is written**
  (`services/attendanceIngest.ts`), not derived later: hours past
  `STANDARD_SHIFT_HOURS` (8) are paid at `OVERTIME_MULTIPLIER` (1.5×) on every
  ingestion path.
- **Labour cost is materialized at check-out or event ingestion**
  (`hours × hourlyRate`, overtime-adjusted). Check-out uses the server clock
  only, closed records cannot be re-checked-out, and shift length is capped
  (`MAX_SHIFT_HOURS`, default 14). To avoid double-counting wages, the owner
  picks the LABOUR source in Settings: attendance-accrued cost, labour
  expenses, or both (conservative default).
- **Payroll order matters**: NSSF, then PAYE on the bands, then relief off the
  **tax** rather than off pay, then SHIF and the housing levy on gross. Relief
  applied to pay overcharges, because a flat credit is worth its whole value
  against tax but only its marginal-rate value against income.
- **Stock is append-only.** Item quantity changes only through `StockMovement`
  rows (IN / OUT / ADJUSTMENT); movement and quantity commit in one transaction
  and overdraws are rejected.
- **Project progress** is derived: mean of task `completionPct`, recomputed on
  every task write.
- **Audit log** — every mutation writes a fire-and-forget `AuditLog` row
  (user, action, entity, metadata, IP).

## Time

Dates are where this system has been wrong most often, because the business
runs three hours ahead of UTC and both the server and the browser will happily
answer a "what day is it" question in the wrong zone.

- `APP_TIMEZONE` (default `Africa/Nairobi`) sets **both** the container clock
  (`TZ`) and the zone the code uses where it is explicit — monthly SQL
  rollups, document-numbering years, printed dates. Compose derives both from
  one variable so they cannot drift apart.
- On the web, every `YYYY-MM-DD` sent to the API goes through
  `lib/format.ts` — `isoDate`, `todayISO`, `addDays`, `parseISODate`. These
  format and parse in **local** time. `toISOString().slice(0, 10)` is UTC: a
  Date built at local midnight is the previous evening in UTC, which defaulted
  the payroll period to the last day of the month before and the diary date to
  yesterday for the first three hours of every day. `format.test.ts` pins this
  and passes under UTC, Nairobi, New York and Auckland.

## AI features

Optional and absent unless a key is configured. Three features, one shared
transport, one shared daily allowance.

- **`services/ai.ts`** is the only place the system talks to a model: provider
  selection (Gemini or Anthropic, cheapest present first), transport, timeouts,
  and the difference between a per-minute rate limit and a spent daily quota —
  telling someone to "try again shortly" when their allowance is gone until
  midnight wastes their afternoon. It returns text and decides nothing.
- **Nothing a model says is trusted.** Receipt figures are checked against
  arithmetic the model cannot influence (does it add up, is the VAT rate
  plausible, is this a tax invoice). The diary's counts come from the database;
  the model is explicitly forbidden to state a number. The assistant answers
  only from a fixed catalogue of lookups.
- **Nothing is written automatically.** Every feature produces a draft or an
  answer that a person edits, files or checks.
- **`services/chatRetrieval.ts`** — the assistant's lookups call the *same
  service functions the screens call* (`payablePosition`, `taxPosition`,
  `projectReceivables`, `gatherDay`). The model chooses from a menu and writes
  the sentence; it never sees the schema and cannot compose an aggregate. An
  answer therefore cannot disagree with the page. Each lookup carries a `scope`
  (`office` / `site` / `shared`) checked in `runLookup` against the asking user
  — a chat box is a way around every permission boundary in the app unless
  retrieval enforces the same ones the routes do. The catalogue a supervisor is
  shown does not even name the money lookups.
- **`services/aiUsage.ts`** — all three features share one key and therefore
  one cap. The assistant is much the hungriest (a conversation is a dozen calls
  where a receipt is one), so it yields: it stops at a configurable reserve
  kept for receipts and reports and says why, rather than eating the allowance
  and leaving the receipt reader dead by mid-morning. The counter rolls on the
  provider's own midnight, not the office's.

### Adding a feature means adding a lookup

**If you add a screen, a table or a report, add the lookup that answers
questions about it in the same change.** The assistant can only answer from
`LOOKUPS` in `services/chatRetrieval.ts`. It has no fallback, no schema access
and no ability to improvise: data that is not in the catalogue does not exist
as far as a user asking a question is concerned, and the failure is silent and
confusing — the assistant says the information "is not stated", which reads
like a broken assistant rather than a missing lookup.

This has already happened twice. The catalogue could report *how many* sites
there were but could not name them, and knew nothing about workers at all,
while both sat in the database the whole time.

A lookup is a name, a scope, a description and a `run` that returns prose:

```ts
{
  name: 'site_defects',
  scope: 'site',                 // 'office' | 'site' | 'shared'
  description: 'The snag list for a site: open defects, how serious…',
  args: ['from', 'to'],          // optional; projectId is implicit for 'site'
  run: async ({ projectId, user, args, allowedProjectIds }) => ({
    facts: '…plain sentences the model will quote…',
    source: { label: 'Kilimani — defects', href: '/admin/projects/x?tab=snags' },
  }),
}
```

The rules that matter, in the order they bite:

1. **Call the service function the screen calls.** Never re-derive a total in a
   lookup. If the screen uses `projectFinancials`, so does the lookup — that is
   the whole reason an answer cannot contradict the page. If no such function
   exists, extract one rather than writing the arithmetic twice.
2. **Pick the scope honestly.** `office` is superadmin-only and is enforced in
   `runLookup`. `site` requires a `projectId` and is checked against the sites
   the user may see. `shared` is checked by nobody — the `run` **must** narrow
   to `ctx.allowedProjectIds` itself (`withinScope`, `scopedProjectIds`), and
   must not report anything the office keeps to itself.
3. **Respect the pay boundary.** Rates and `labourCost` are the office's
   (`services/payVisibility.ts`). Branch on `isOffice(user.role)` inside the
   lookup; cost divided by hours is the rate, so the two travel together.
4. **Write `facts` for a reader, not a parser.** The model quotes them
   verbatim, so format money through `money()` and dates through `day()`, and
   say "no defects have been raised" rather than returning an empty string —
   the model cannot tell an empty result from a failed one.
5. **Cap long lists with `listed()`.** It says what it left out instead of
   truncating silently.
6. **Write the description as the question it answers**, not as the table it
   reads. The planner matches on it, and it is the only thing standing between
   a good question and the wrong lookup.
7. **Add the name to the coverage test** in `projectChat.test.ts`, which exists
   to catch a subject quietly going missing again.

Two things a lookup must never do: write anything, or accept a filter the model
composed. The model chooses a name and a handful of scalar arguments —
`parsePlan` drops everything that is not a string or a number, so a planner
that tries to pass `{"$gt": …}` gets nothing.

Cost is worth knowing when adding one: each question is **two** model calls
(plan, then answer) regardless of how many lookups run, since lookups are
database reads. Adding lookups makes the assistant more useful without making
it more expensive per question — but every catalogue entry lengthens the
planner prompt, so keep descriptions to one line.

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
  `duplicate_day`) so the bridge can surface enrolment problems. Unmatched
  punches also surface in the app under Settings → Attendance, where an
  unrecognised fingerprint can be linked to a worker and enrolled.
- Re-sending a batch is safe (upsert on `externalId`).

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
  terminal — `biostarDeviceId` optionally narrows polling to a single terminal.
- A worker's `biometricId` is matched against the BioStar 2 **User ID**
  (`user_id` on the event), the same convention as a ZKTeco PIN.
- The cursor is the highest BioStar 2 event ID already ingested
  (`biostarLastEventId`), not a timestamp — immune to clock drift.
- The credentials are a BioStar 2 login, not a device-side secret — the
  password is encrypted at rest (`services/crypto.ts`, AES-256-GCM,
  `ENCRYPTION_KEY`) and never returned by the API after creation. A read-only
  BioStar 2 operator account is recommended over sharing the admin login.
- Polling runs every 2 minutes (`server.ts`); `POST /api/v1/devices/:id/sync`
  triggers an immediate one-off pull.
- **Event-type codes may need tuning per deployment.** `SUCCESS_EVENT_TYPES`
  in `services/biostar.ts` defaults to BioStar 2's standard "Verify Success"
  (4864) and "Identify Success" (4865) codes. If events aren't showing up,
  check that install's Monitoring > Event log for the exact `event_type_id` a
  successful match logs.
- BioStar 2's cert is commonly self-signed on a LAN appliance;
  `biostarInsecureTls` skips verification for that one device only (never a
  process-wide setting — see the `undici` per-request dispatcher), off by
  default.

## Frontend

### Shells

- **Superadmin**: desktop-first sidebar grouped by how work moves — winning
  work, on site, money, admin. Ctrl-K opens a command palette over sites,
  contracts, quotations, clients, workers, suppliers and every settings
  section. A project opens into grouped tabs, with the tab id in the URL so a
  Command Centre card can link straight to the panel that owns its data.
- **Supervisor**: mobile-first, bottom navigation with two entries. **Today**
  opens on the site they were last standing on, says whether the diary is in,
  and files it in one tap — that being the most-repeated action in the product.
  A site opens into large action tiles, with the open panel in the URL so the
  phone's back button closes it.
- Feature panels are shared components (`src/features/*`) mounted by both
  shells, so behaviour stays consistent and code isn't duplicated.

### Design system

- **Semantic tokens only** (`index.css` + `tailwind.config.js`):
  `surface`/`surface-muted`/`surface-sunken`, `fg`/`fg-muted`/`fg-subtle`,
  `hairline`/`hairline-strong`, `brand-*`, and status tones `warn`/`danger`/
  `good`/`info` each carrying `-surface`, `-hairline`, `-fg`. Raw palette
  colours are not used for status; `components/ui/notice.tsx` is the panel.
- **Every step of the text ramp clears WCAG AA on surface** — this is read on a
  phone in direct sun as often as at a desk.
- `darkMode: 'class'`, opt-in. There is no dark palette yet; under Tailwind's
  `media` default a stray `dark:` variant activates against the light tokens,
  which is exactly what happened to the amber warning panels. When a dark theme
  is built it is a `:root` block swap and no component changes.
- **Every mutation confirms in the user's own words.**
  `components/ui/toast.tsx` is an `aria-live` region; the message names the
  figure and the document — "Payment of KES 200,000 recorded against
  ALK-2026-000112" — because a dialog closing is what happens on success and
  on a dismissed form alike. Errors stay until dismissed.
- Money figures use `tabular-nums`; budget health is never conveyed by colour
  alone (icon + label + percentage); charts follow a colourblind-safe palette.
- The frontend code-splits per route (supervisors never download the admin or
  charts bundle) and the PWA runtime-caches GET responses (network-first) so
  the app shows last-known data on poor site connectivity.

## Operations

- `docker-compose.yml`: `db` (Postgres 16 + healthcheck), `api` (runs
  `prisma migrate deploy` on boot), `web` (Nginx serving the SPA, proxying
  `/api` and `/uploads`). Named volumes for pgdata and uploads.
- Configuration is environment-only (validated with Zod at boot; the API
  refuses to start with an invalid config or a placeholder JWT secret in
  production, and the seed refuses default admin passwords in production).
  Empty strings are treated as unset — Compose passes unset variables as `""`,
  and a bare `z.enum().optional()` rejects that and refuses to boot.
- **Uploads are private.** Content is verified against magic bytes (client
  MIME is never trusted), files are served only through HMAC-signed expiring
  links with `nosniff`, and files are unlinked from disk when their records
  are deleted. Swap `middleware/upload.ts` for S3-compatible storage to scale
  horizontally.
- **Analytics are aggregated in SQL** (timezone-aware via `APP_TIMEZONE`):
  dashboards cost a fixed number of grouped queries regardless of data volume.
- Nginx ships security headers + CSP; `nginx/nginx-ssl.conf.example` is the
  TLS/HSTS variant — production must terminate TLS.

## Tests

`npm run test` runs `node:test` across both workspaces.

The API suite covers the arithmetic and the rules, not the plumbing: money
conversion, invoice and claim totals, payables positions and ageing, payroll
bands and deduction order, insight generation, receipt verification, diary
fact-building, chat plan parsing and the assistant's permission scoping, and
the AI allowance logic. The web suite covers the date helpers, which are pure,
load-bearing, and were wrong.
