# AlkenFinishes

Internal management platform for a finishing construction company: projects,
budgets & profitability, biometric attendance, site stock, expenses with
receipts, progress tasks, documents, and daily site reports.

Two roles: **Superadmin** (owner — full visibility, financial dashboards) and
**Site Supervisor** (mobile-first, restricted to assigned sites, no financial
overview).

## Stack

React + TypeScript + Vite + Tailwind (PWA) · Node.js + Express + TypeScript ·
PostgreSQL + Prisma · Docker Compose + Nginx.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/API.md`](docs/API.md), and
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for naming and UI conventions.

## Production deployment

```bash
cp .env.example .env        # set strong POSTGRES_PASSWORD, JWT_SECRET, seed admin
docker compose up -d --build
docker compose exec api npx prisma db seed   # first boot only: creates superadmin
```

Open `http://<host>/` and sign in with the seeded admin credentials
(`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`). Change the password immediately
via Team → your user.

## Local development

```bash
npm install
# Postgres: any local instance; set apps/api/.env from apps/api/.env.example
cd apps/api && npx prisma migrate dev && npx prisma db seed && cd ../..
npm run dev:api     # http://localhost:4000
npm run dev:web     # http://localhost:5173 (proxies /api)
```

## Attendance devices

Two ways a fingerprint terminal gets attendance into the system, depending on
what it speaks — register either under **Settings → Fingerprint attendance
devices**.

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
npm run lint        # eslint: correctness, react-hooks, jsx-a11y
npm run format      # prettier (CI runs format:check)
npm test -w @alken/api
npm run build
```

The API tests read `DATABASE_URL` and `JWT_SECRET` from the environment — any
syntactically valid values will do, nothing connects to a database.
