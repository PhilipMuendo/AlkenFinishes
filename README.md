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

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/API.md`](docs/API.md).

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

Register a device under **Settings → Fingerprint attendance devices** to get a
one-time API key, then point the device (or its sync bridge) at
`POST /api/v1/attendance/device-sync` with the `X-Device-Key` header. Batches
are idempotent — offline devices can safely re-upload after reconnecting.
Enroll each worker's device ID in **Workers → Biometric ID**.

## Quality gates

```bash
npm run typecheck   # strict TS across both apps
npm run build
```
