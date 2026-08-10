# AlkenFinishes API — v1

Base URL: `/api/v1`. All endpoints require `Authorization: Bearer <accessToken>`
unless noted. Errors: `{ "error": string, "details"?: object }` with proper
HTTP status codes. Validation is Zod-based; invalid input returns 400 with
field-level details.

Roles:

- **A** — SUPERADMIN only.
- **P** — project-scoped: the supervisor must be the project's assigned
  supervisor; superadmin always allowed.
- **A+P** — both: superadmin, and only for that project.

Money is **A** throughout — invoices, payments, payables, tax, payroll and
per-project financials. A supervisor submits an expense; the office decides
what is owed on it.

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{accessToken, refreshToken, user}` |
| POST | `/auth/refresh` | Rotates refresh token |
| POST | `/auth/logout` | Revokes refresh token |
| GET | `/auth/me` | Current user |

## Users (A)
`GET/POST /users`, `PATCH /users/:id` (`{active}`, `{password}`),
`DELETE /users/:id`.

## Clients, leads, quotations, contracts (A)

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/clients`, `/clients/:id` | `PUT`, `DELETE` |
| GET/POST | `/leads`, `/leads/:id` | `PUT`, `DELETE` |
| GET | `/leads/pipeline` | Stage counts and values |
| POST | `/leads/:id/stage` | `{stage, lostReason?}` |
| GET/POST | `/quotations`, `/quotations/:id` | `PUT`, `DELETE` |
| POST | `/quotations/:id/send` | Marks as sent to the client |
| POST | `/quotations/:id/decision` | `{outcome: ACCEPTED\|REJECTED, reason?}` |
| GET/POST | `/quotations/:id/pdf` | `POST` regenerates |
| GET/POST | `/contracts`, `/contracts/:id` | `PUT`, `DELETE` |
| POST | `/contracts/from-quotation/:quotationId` | Carries the priced schedule across |
| POST | `/contracts/:id/issue` | |
| POST | `/contracts/:id/sign` | multipart, optional signed copy |
| POST | `/contracts/:id/status` | |
| POST | `/contracts/:id/attachments` | multipart `boq`, `specs` |
| DELETE | `/contracts/:id/attachments/:field` | |
| POST | `/contracts/:id/convert-to-project` | Creates the site from the contract |
| GET | `/contracts/:id/attachable-projects` | Existing sites with no contract |
| POST/DELETE | `/contracts/:id/attach-project` | Links or unlinks an existing site |
| POST | `/contracts/:id/variations` | multipart |
| POST | `/contracts/:id/variations/:variationId/decision` | `{outcome, reason?}` |
| DELETE | `/contracts/:id/variations/:variationId` | |
| GET/POST | `/contracts/:id/pdf` | |

A site created directly is not a dead end: `attach-project` gives it a contract
later, which is what makes progress claims possible on it.

## Projects
| Method | Path | Role |
|---|---|---|
| GET | `/projects` | scoped list |
| POST | `/projects` | A |
| GET | `/projects/:projectId` | P |
| PATCH / DELETE | `/projects/:projectId` | A+P |
| GET | `/projects/:projectId/budget` | P |
| PUT | `/projects/:projectId/budget` | A+P — `{lines:[{category, allocated}]}` |
| GET | `/projects/:projectId/financials` | P |
| GET | `/projects/:projectId/command-centre` | P — one call for the whole site view; financial sections are omitted for supervisors |

## Invoices and claims (A+P)
Mounted at `/projects/:projectId/invoices`.

| Method | Path | Notes |
|---|---|---|
| GET | `/` | |
| GET | `/summary` | Receivables position for the site |
| POST | `/` | Draft |
| GET | `/claim-schedule` | The priced schedule with what each line has already claimed |
| POST | `/claim` | Raises a progress claim from cumulative percentages |
| GET/PUT | `/:id` | Drafts only |
| POST | `/:id/issue` | Allocates the number; no longer editable |
| POST | `/:id/void` | `{reason}` — never deletes an issued document |
| DELETE | `/:id` | Drafts only |
| GET/POST | `/:id/pdf` | |

`GET /invoices/receivables` (A) is the cross-project A/R register.

## Payments — money in (A+P)
Mounted at `/projects/:projectId/payments`.

`GET /`, `GET /summary`, `POST /` (multipart, optional proof),
`PUT /due-date`, `GET|POST /:id/receipt`, `POST /:id/void` `{reason}`,
`DELETE /:id`.

A payment carries `amount`, `whtAmount` and `whtVatAmount`. **Tax the client
withheld settles the invoice exactly as cash does** — they paid it to KRA on
our behalf — so the settled figure is the sum of all three. Counting only cash
leaves an invoice permanently short and chases the client for money already
surrendered.

## Expenses and supplier payments (P, money parts A)
Mounted at `/projects/:projectId/expenses`.

| Method | Path | Role |
|---|---|---|
| GET | `/` | A — full list with payables position |
| GET | `/mine` | P — the supervisor's own submissions, no position, no payment history |
| POST | `/` | P — multipart, optional receipt |
| POST | `/:id/approve`, `/:id/reject` | A |
| DELETE | `/:id` | A |
| POST | `/scan-receipt` | A — multipart; reads a photographed receipt, writes nothing |
| GET | `/:id/payment-suggestion` | A — what would settle the bill, with withholding worked out |
| POST | `/:id/payments` | A — multipart; part-payments supported |
| DELETE | `/:id/payments/:paymentId` | A |

## Suppliers and payables (A)
`GET/POST /suppliers`, `GET/PUT/DELETE /suppliers/:id` (delete retires;
history and balances are kept). `GET /suppliers?includeInactive=true` includes
retired ones. `GET /suppliers/payables` is the company position — who is owed
what, aged, biggest debt first.

## Tax (A)
`GET /tax/position?from&to` — VAT charged out, VAT reclaimable, tax withheld
from suppliers, tax clients withheld from us. The four are never netted into
one number.
`GET /tax/certificates-outstanding`, `POST /tax/payments/:id/certificate`
`{whtCertNo}`, `POST /tax/supplier-payments/:id/remitted`.

## Payroll (A)
`POST /payroll/preview`, `GET/POST /payroll`, `GET /payroll/:id`,
`POST /payroll/:id/finalise`, `DELETE /payroll/:id` (drafts only). Gross comes
from attendance already recorded. Deduction order is NSSF, then PAYE on the
bands, then relief off the tax, then SHIF and the housing levy on gross.

## Tasks, snags, safety, materials, stock, documents (P)
- `GET/POST /projects/:projectId/tasks`, `PATCH /:id`, `POST /:id/photos`,
  `DELETE /:id` (A). Project `progressPct` recomputes on every write.
- `GET/POST /projects/:projectId/snags`, `PUT /:id`, `POST /:id/status`
  (multipart), `/:id/verify`, `/:id/reject`, `/:id/reopen`, `DELETE /:id`.
- `GET/POST /projects/:projectId/safety-incidents`, `DELETE /:id`.
- `GET/POST /projects/:projectId/material-requests`, `/:id/approve` (A),
  `/:id/reject` (A), `/:id/fulfil` (A), `DELETE /:id`.
- `GET/POST /projects/:projectId/stock`, `GET/POST /:itemId/movements`
  (`{type: IN|OUT|ADJUSTMENT, quantity, reason}`) — quantity changes only via
  movements; overdraw rejected.
- `GET/POST /projects/:projectId/documents`, `DELETE /:id` (A).

## Reports (P)
- `GET/POST /projects/:projectId/daily-reports` — multipart, up to 6 photos.
  One per project per day (upsert).
- `POST /projects/:projectId/daily-reports/draft` — `{date}`. Drafts the diary
  from the day's own records. Writes nothing, refuses a day with nothing
  recorded, and returns `{draft, workersPresent, facts, summary}`; the counts
  come from the database, never the model.
- `GET/POST /projects/:projectId/weekly-reports` — multipart.
- `GET /projects/:projectId/business-reports/:type` (A+P) — generated PDFs:
  `financial-summary`, `progress`, `attendance`, `expenses`, `client-statement`,
  `receivables`, `variations`, `site-diary`.
- `GET /reports` (A) — cross-project register.

## Attendance
A supervisor cannot write an `AttendanceRecord` directly at all — only file a
request; a superadmin's decision is what creates one.

| Method | Path | Auth |
|---|---|---|
| POST | `/attendance/device-sync` | `X-Device-Key` header — idempotent batch upsert (ZKTeco/bridge) |
| GET | `/iclock/cdata`, `POST /iclock/cdata` | Device (SN-authenticated) — ZKTeco ADMS push |
| GET | `/projects/:projectId/attendance?from&to` | P |
| POST | `/projects/:projectId/attendance/override-requests` | P |
| GET | `/projects/:projectId/attendance/override-requests?status=` | P |
| POST | `.../override-requests/:id/decision` | A — `{outcome: APPROVED\|REJECTED, reason?}`; APPROVED creates the record |
| POST | `/projects/:projectId/attendance/:id/checkout` | A |

Devices (A): `GET/POST /devices` (`{name, vendor: ZKTECO\|SUPREMA, ...}` —
ZKTeco takes `serialNumber`; Suprema takes `biostarBaseUrl, biostarLoginId,
biostarPassword, biostarDeviceId?, biostarInsecureTls?`; POST returns
plaintext `apiKey` once, unused by Suprema), `PATCH /devices/:id`,
`POST /devices/:id/sync` (Suprema only), `GET /devices/issues`,
`POST /devices/issues/:id/resolve`, `POST /devices/issues/:id/link`.
`biostarPasswordEnc` is never returned by any of these.

## Workers and tools
`GET/POST /workers`, `PATCH /workers/:id`, `DELETE /workers/:id` (A),
`POST /workers/import` (A), `POST /workers/:id/assign`,
`POST /workers/:id/unassign`, `GET /workers/:id/history` (A).

Supervisors may add and manage fundis on their own sites only — enforced inside
the handlers (`assertOwnProject` / `assertOwnWorker`) with a narrower field
schema than the office gets (no status, biometric ID or date of birth).
`DELETE` is admin-only and permanent, because attendance cascades from a worker
and that is labour-cost history.

**Pay is the office's.** `hourlyRate` is not in the supervisor's schema and is
stripped from every worker the API returns to one; `labourCost` is stripped
from attendance records for the same reason, since cost over hours is the rate.
A fundi a supervisor adds starts at a rate of zero, and the Workers screen
shows **Set rate** against them until the office fills it in — their hours
accrue no cost until it does. The rule is one module, `services/payVisibility.ts`,
so it cannot hold on one route and not another.

`GET/POST /tools`, `PATCH /tools/:id` (A), `POST /tools/:id/transfer` (A,
multipart), `GET /tools/:id/transfers` (A). Supervisors see tools currently on
their sites.

## Analytics
| Method | Path | Role |
|---|---|---|
| GET | `/analytics/projects/:projectId` | **A+P** — financials, spend series, estimated profit |
| GET | `/analytics/company` | A — portfolio totals, comparison, spend trend |
| GET | `/analytics/attention` | A — what needs a decision today |
| GET | `/analytics/pipeline` | A — leads, quotes and contracts by stage |

`/analytics/projects/:projectId` is superadmin-only despite being
project-scoped: it returns contract value, actual spend and estimated profit,
which is exactly what the supervisor shell exists to withhold.

## Assistant
| Method | Path | Role |
|---|---|---|
| GET | `/chat/status` | Whether it is configured, and whether it can answer right now |
| POST | `/chat/ask` | `{question, projectId?}` → `{answer, used, facts, sources}` |

Open to supervisors as well as the office, because the boundary is enforced in
the retrieval layer rather than at the door: a supervisor gets answers about
their own sites and is refused company money, exactly as on the screens. Writes
nothing. Every answer returns the `facts` it was written from.

`403`-equivalent refusals come back as `400` with `details.reason`:
`QUOTA_DAILY` (nothing left today), `RESERVED_FOR_WORK` (the assistant's share
is spent; receipts and reports still work), or `MODEL_UNAVAILABLE` (the pinned
model has been retired — set `RECEIPT_MODEL` and restart; see the README).

`used` names the lookups that ran. If an answer says something "is not
stated", the lookup that would have held it is missing from
`services/chatRetrieval.ts` — adding a feature means adding its lookup in the
same change. See docs/ARCHITECTURE.md, "Adding a feature means adding a
lookup".

## Settings (A)
`GET/PUT` pairs for `/settings/thresholds`, `/settings/labour-source`,
`/settings/company` (+ `POST /settings/company/logo`), `/settings/invoicing`,
`/settings/payroll`, `/settings/purchase-tax`, `/settings/pipeline`,
`/settings/ai`. Plus `GET /settings/finance`,
`GET /settings/quotation-defaults`, `GET /settings/audit-log?page=`.

`GET /settings/ai` returns the daily budget, today's usage split by feature,
and whether the assistant may still ask.

## Files
Upload responses and list endpoints return **HMAC-signed expiring URLs**
(`/uploads/<name>?exp=…&sig=…`, TTL `FILE_URL_TTL_SECONDS`, default 1h).
Unsigned or expired links return 401 — re-fetch the parent resource for a
fresh link. Upload content is validated against magic bytes; a mismatch with
the declared MIME type is rejected with 400.

## Abuse controls
`POST /auth/login`: 10 attempts / 15 min per IP+email → 429.
`POST /attendance/device-sync`: 30 requests / min per device key → 429.
Attendance hours are capped at `MAX_SHIFT_HOURS` (default 14) on all paths;
check-out uses the server clock and closed records return 409.
