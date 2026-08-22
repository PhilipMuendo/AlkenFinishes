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

Optional and absent unless a key is configured. Three features — the
assistant, the receipt reader, report drafting — share one transport, one
trust model, and one daily allowance.

- **`services/ai.ts`** is the only place the system talks to a model: provider
  selection (Gemini or Anthropic, cheapest configured key first, with
  comma-separated fallback keys per provider for a busy day), transport,
  timeouts, and the difference between a per-minute rate limit and a spent
  daily quota — telling someone to "try again shortly" when their allowance is
  gone until midnight wastes their afternoon. It returns text and decides
  nothing; every caller treats that text as an untrusted claim.
- **Nothing a model says is trusted without a check it cannot influence.**
  Receipt figures are checked against arithmetic (does the subtotal plus VAT
  equal the printed total, is the VAT rate plausible). The diary's counts
  come from the database; the model is explicitly forbidden to state a
  number that isn't there. The assistant answers only from a fixed catalogue
  of lookups that call the same code the screens call — detailed below.
- **Nothing is written automatically.** Every feature produces a draft or an
  answer that a person edits, files or checks before it becomes a record.
- **`services/aiUsage.ts`** doles out one shared daily allowance
  (`DEFAULT_AI_BUDGET`: 200 calls, sized for Google's free Flash tier) across
  all three features. Left alone they would compete — a single conversation
  with the assistant is a dozen model calls where a receipt is one — so on a
  normal Tuesday chat would quietly exhaust the allowance and the receipt
  reader would be dead by mid-morning, with nothing to explain why. So chat
  yields: it stops once fewer than `reservedForWork` (60) calls remain for
  the day, and says so, rather than eating the budget the business actually
  depends on. The counter rolls on the provider's own midnight, kept in one
  `Setting` row — a guard rail, not an accounting record; the provider's own
  count is authoritative.

### The assistant (chat)

The most-used and most complex of the three, and the one most worth
understanding fully — a wrong number here reads as the system itself being
wrong, not as a chat feature glitching.

**Request flow.** `POST /chat/ask` (`modules/chat.ts`) → `answerQuestion()`
(`services/projectChat.ts`) → the lookup catalogue (`services/chatRetrieval.ts`).
Every route is a read; the endpoint writes nothing to the domain, only an
audit-log entry of the question asked (never the answer — what someone asked
is worth knowing if the assistant ever misleads them, and it stays true even
after the model changes).

**Two model calls, not one, and the split is the whole safety design:**

1. **Plan.** The model is shown the question, the last four turns of
   conversation, the sites this user may ask about, and the *catalogue* —
   every lookup's name, arguments and one-line description, filtered to what
   this user's role is even allowed to see. It replies with which lookup(s)
   to run (at most 4) and their arguments, or a `decline` reason if nothing
   in the catalogue answers the question. It never sees the database schema
   and cannot compose a query of its own — `parsePlan` drops anything in an
   argument that isn't a plain string or number, so a planner talked into
   passing `{"$gt": …}` gets nothing.
2. **Answer.** The chosen lookups run as plain TypeScript — normal Prisma
   reads, permission-checked in `runLookup` — and return `facts`: sentences a
   human could read and check. The model is shown *only those facts* and
   told to answer in two or three sentences, using no number that doesn't
   appear in them verbatim, and to say plainly what's missing rather than
   fill a gap.

The arithmetic therefore never passes through the model at any point. Every
figure in every answer was computed by the same service function that
computes the figure on the screen (`projectFinancials`, `taxPosition`,
`companyReceivables`, `gatherDay`, …), so the assistant cannot disagree with
the app — the worst it can do is choose the wrong lookup, which surfaces as
an answer about the wrong subject, never a wrong number about the right one.

**Permission is enforced in the retrieval layer, not the prompt.** A chat box
is a way around every RBAC boundary in the app unless the code checks the
same rules the routes do. `runLookup` re-checks on every call: a `scope:
'office'` lookup is refused outright to a supervisor (`company_financials`,
`who_we_owe`, `site_money`, …); a `scope: 'site'` lookup is refused if the
`projectId` isn't one of `allowedProjectIds`; a `scope: 'shared'` lookup must
narrow itself (`withinScope`/`scopedProjectIds` helpers). The catalogue a
supervisor is shown for planning doesn't even *name* the office-only lookups
— not decoration, a name in the prompt is something to be talked into asking
for, and there's no reason to advertise what will only be refused.

**Answers are checkable, not just trusted.** Every reply carries `used` (which
lookups ran), `facts` (their raw output) and a `source` (a link into the
screen that owns the data) alongside the prose. The widget's "Show what this
is based on" is not a debugging aid, it's the feature — the same reasoning as
the receipt reader showing its arithmetic: an answer nobody can check is worth
very little in a system that moves money.

**Follow-ups.** The client holds the conversation (nothing is stored
server-side — this is a read-only endpoint and a chat log is the one thing it
would otherwise have to write) and sends the last 4 turns back with each
question. The planner is told earlier turns exist only to resolve "it",
"there" and "what about X?" — a question that names its own subject is not a
follow-up, so an earlier site can't quietly capture a new question about a
different one.

**Context from the screen.** `Assistant.tsx` reads the site being viewed
straight from the URL (`/admin/sites/:id` or `/sites/:id` — see
`useLocation`) and sends it as `projectId`, so "what happened here today?"
resolves without the site being named. The suggested questions shown differ
by shell (`SUGGESTIONS_OFFICE` vs `SUGGESTIONS_SITE`) but are just prompts —
any question can be typed regardless of which list is showing.

**The office also gets an unprompted digest.** Opening the panel auto-asks
"What needs my attention?" once per calendar day (`AUTO_ASK_ATTENTION_ON_OPEN`,
tracked in `localStorage`) — the same `company_operations` lookup and the
same `attentionDigest()` the Overview page's cards use, so the assistant
greets the person opening it with the thing the dashboard would have told
them anyway. Supervisors never see this: the lookup is office-only, and
asking it on their behalf would just be a refusal.

**The button is absent, not disabled, when no key is configured** — a control
that cannot work is worse than no control — and the widget is a floating
panel beside the page rather than a modal `<dialog>`, deliberately: the
subject of the conversation is usually the page underneath it.

Worked example: *"Are we profitable?"* → planner picks `company_financials`
→ it calls `companyFinancials()` in `services/finance.ts` (the exact function
`GET /analytics/company` calls for the Overview dashboard) → facts include
contract value, actual spend, estimated profit and margin %, collected vs.
still-to-bill, AR outstanding/overdue, and the most/least profitable site →
the writer states the profit figure and margin, nothing more. Before this
lookup existed the question reached the model with no fact that answered it,
and the model correctly said so — see the incident log below.

### Receipt reader

`services/receiptExtraction.ts`. A supplier receipt photo goes in, a
structured draft (supplier, invoice number, date, subtotal, VAT, total) comes
back to prefill the expense form — never written directly. The valuable half
of the file is not the extraction, it's `verify()`: checking that subtotal +
VAT equals the printed total and that VAT matches the configured rate is
something arithmetic can do perfectly and a model cannot be trusted to. What
the user sees is never "the AI says 16,000" but "the AI says 16,000 and the
arithmetic agrees" — or "…and it does not, look at this one."

### Report drafting

`services/dailyReportDraft.ts` and `services/weeklyReportDraft.ts`, the same
shape twice. A daily draft is written from that day's own attendance, tasks,
deliveries and snags (`gatherDay` → `factsFor` → `draftDailyReport`); a
weekly draft is written from that week's own filed daily reports rather than
re-deriving from raw records, because the point is to save re-typing seven
diary entries into one summary. Both return the draft *and* the facts it was
built from, prefilled into an editable form — a supervisor reviews and can
change anything before it's filed. Counts (workers present, tasks done) are
always the database's; the model supplies prose only.

### Adding a feature means adding a lookup

**If you add a screen, a table or a report, add the lookup that answers
questions about it in the same change.** The assistant can only answer from
`LOOKUPS` in `services/chatRetrieval.ts`. It has no fallback, no schema access
and no ability to improvise: data that is not in the catalogue does not exist
as far as a user asking a question is concerned, and the failure is silent and
confusing — the assistant says the information "is not stated", which reads
like a broken assistant rather than a missing lookup.

This has already happened three times. The catalogue could report *how many*
sites there were but could not name them, and knew nothing about workers at
all, while both sat in the database the whole time. The third time, it could
state a site's estimated profit but had nothing at all to say about the
company's — "are we profitable?" got a correct, honest, useless "the facts
don't contain that." The screen this lookup answers for
(`/analytics/company`, the Overview dashboard) had carried the figure the
whole time; nobody had told the assistant to look. Fixed by extracting
`companyFinancials()` in `services/finance.ts` out of that route and adding
`company_financials`, exactly per the rule above.

A lookup is a name, a scope, a description and a `run` that returns prose:

```ts
{
  name: 'site_defects',
  scope: 'site',                 // 'office' | 'site' | 'shared'
  description: 'The snag list for a site: open defects, how serious…',
  args: ['from', 'to'],          // optional; projectId is implicit for 'site'
  run: async ({ projectId, user, args, allowedProjectIds }) => ({
    facts: '…plain sentences the model will quote…',
    source: { label: 'Kilimani — defects', href: '/admin/sites/x?tab=snags' },
  }),
}
```

The rules that matter, in the order they bite:

1. **Call the service function the screen calls.** Never re-derive a total in a
   lookup. If the screen uses `projectFinancials`, so does the lookup — that is
   the whole reason an answer cannot contradict the page. If no such function
   exists, extract one rather than writing the arithmetic twice. This is not
   hypothetical: `company_operations` once hand-rolled its own narrower version
   of "what needs attention" instead of calling the same digest the `/admin`
   Overview page uses, and the two quietly drifted apart — the assistant could
   say a site's defects were open while staying silent about that same site
   being over budget, because it was never told to look. Fixed by extracting
   `attentionDigest()` in `services/attention.ts` and having both the
   `/analytics/attention` route and the lookup call it.
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
