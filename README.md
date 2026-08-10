# AlkenFinishes

Internal management platform for a finishing construction company. It follows
the work end to end: a lead becomes a quotation, an accepted quotation becomes
a contract, a signed contract becomes a site, the site is run and costed, and
what was built gets claimed for, invoiced, received and taxed.

Two roles: **Superadmin** (the office — everything, including money) and **Site
Supervisor** (mobile-first, restricted to assigned sites, and shown no money at
all — not company figures, and not what a fundi is paid).

## Stack

React + TypeScript + Vite + Tailwind (PWA) · Node.js + Express + TypeScript ·
PostgreSQL + Prisma · Docker Compose + Nginx.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/API.md`](docs/API.md).

## What it does

**Winning work** — clients, a lead pipeline, priced quotations, contracts with
variations and a signature record. A quotation converts to a contract, and a
contract adopts or creates the site, carrying the priced schedule with it.

**On site** — the programme (phases and tasks), biometric attendance, daily and
weekly reports, snags with photographs, safety incidents, material requests,
site stock, a tool register with transfers, and a document repository.

**Money** — progress claims measured against the contract schedule, invoices
with VAT and retention, client receipts, supplier bills with part-payments,
payables ageing, payroll from recorded attendance, and a VAT and withholding
position for the month. Money is superadmin-only, enforced at the route.

**Assistance** — optional, and off unless a key is configured: reading figures
off a photographed receipt, drafting the evening site diary from what the day
already recorded, and answering questions about the business. Every one of
these produces a draft or an answer that shows its workings; none of them
writes anything on its own.

## Production deployment

```bash
cp .env.example .env        # set POSTGRES_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, seed admin
docker compose up -d --build
docker compose exec api npx prisma db seed   # first boot only: creates superadmin
```

Open `http://<host>/` and sign in with the seeded admin credentials
(`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`). Change the password immediately
via Team → your user.

Set `APP_TIMEZONE` to the zone the business actually runs in. It pins both the
container clock and the zone the code reasons in; leaving the container on UTC
while working three hours ahead of it files late-evening work against the wrong
day.

## Local development

```bash
npm install
# Postgres: any local instance; set apps/api/.env from apps/api/.env.example
cd apps/api && npx prisma migrate dev && npx prisma db seed && cd ../..
npm run dev:api     # http://localhost:4000
npm run dev:web     # http://localhost:5173 (proxies /api)
```

## Switching on the AI features

Entirely optional. Without a key they are absent from the UI and every form
works by hand.

The key goes in the `.env` beside `docker-compose.yml`, which is the file
compose reads. `apps/api/.env` is the separate one used by `npm run dev:api`
outside Docker; a key there has no effect on the containers.

```bash
echo "GEMINI_API_KEY=..." >> .env
docker compose up -d --force-recreate api   # restart alone keeps the old env
```

Get the key from [aistudio.google.com](https://aistudio.google.com). Newer keys
start with `AQ.` and older ones with `AIza`; both work.

If a feature answers *"the configured AI model is no longer available"*, Google
has retired the pinned model. It stays in Google's own model listing after
withdrawal, so this surfaces the first time somebody presses the button rather
than at start-up. Set `RECEIPT_MODEL` to a current model and recreate the
container — no code change, no redeploy.

One key powers all three features, which therefore share one daily allowance.
The assistant is much the hungriest of them, so it yields: it stops at a
reserve kept for receipts and reports, and says so rather than failing
silently. Size the reserve under **Settings → Assistant**, where today's usage
is shown beside it.

Nothing the model produces is trusted. Extracted receipt figures are checked
against arithmetic it cannot influence, the diary's counts come from the
database rather than the model, and the assistant answers only from a fixed set
of lookups that call the same code the screens call — so an answer cannot
disagree with the page it came from.

## Attendance devices

Two ways a fingerprint terminal gets attendance into the system, depending on
what it speaks — register either under **Settings → Attendance**.

**ZKTeco / ADMS push terminals.** Registering one issues a one-time API key.
Point the terminal's server address at this app; it pushes to `/iclock`
automatically, or a custom bridge can `POST /api/v1/attendance/device-sync`
with the `X-Device-Key` header. Batches are idempotent — offline devices can
safely re-upload after reconnecting.

**Suprema (BioLite Net, BioEntry W, and other BioStar 2 terminals).** These
don't push to a URL — they report into a BioStar 2 server on the site LAN, and
this app polls that server's REST API for new events every 2 minutes (or on
demand via **Sync now**). Registering one needs the BioStar 2 server's own
address and a login (a read-only BioStar 2 operator account is recommended
over sharing the admin login) — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#attendance-device-integration)
for the full setup and the event-code caveat.

Either way, enroll each worker's device-side ID (ZKTeco PIN, or the BioStar 2
User ID) in **Workers → Biometric ID** — that's the field both integrations
match punches against.

## Quality gates

```bash
npm run typecheck   # strict TS across both apps
npm run test        # node:test across both apps
npm run build
```
