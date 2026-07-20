# AlkenFinishes API — v1

Base URL: `/api/v1`. All endpoints require `Authorization: Bearer <accessToken>`
unless noted. Errors: `{ "error": string, "details"?: object }` with proper
HTTP status codes. Validation is Zod-based; invalid input returns 400 with
field-level details.

Roles: **A** = SUPERADMIN only, **P** = project-scoped (supervisor must be the
project's assigned supervisor; superadmin always allowed).

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{accessToken, refreshToken, user}` |
| POST | `/auth/refresh` | Rotates refresh token |
| POST | `/auth/logout` | Revokes refresh token |
| GET | `/auth/me` | Current user |

## Users (A)
`GET/POST /users`, `PATCH /users/:id`, `DELETE /users/:id` (deactivate).

## Projects
| Method | Path | Role |
|---|---|---|
| GET | `/projects` | scoped list |
| POST | `/projects` | A |
| GET/PATCH/DELETE | `/projects/:projectId` | P / A / A |
| GET | `/projects/:projectId/budget` | P |
| PUT | `/projects/:projectId/budget` | A — `{lines:[{category, allocated}]}` |
| GET | `/projects/:projectId/financials` | P — budget vs actual, health, profit |

## Expenses (P)
`GET /projects/:projectId/expenses`; `POST` multipart (`category, amount,
description, expenseDate`, optional `receipt` file); `DELETE .../expenses/:id` (A).

## Tasks (P)
`GET/POST /projects/:projectId/tasks` (`phase, name`); `PATCH .../tasks/:id`
(`status, completionPct, notes`); `POST .../tasks/:id/photos` multipart
(`photo`); `DELETE` (A). Project `progressPct` auto-recomputes.

## Attendance
| Method | Path | Auth |
|---|---|---|
| POST | `/attendance/device-sync` | `X-Device-Key` header — idempotent batch upsert |
| GET | `/projects/:projectId/attendance?from&to` | P |
| POST | `/projects/:projectId/attendance/manual-override` | P — flagged + audited |
| POST | `/projects/:projectId/attendance/:id/checkout` | P |

Devices (A): `GET/POST /devices` (POST returns plaintext `apiKey` once),
`PATCH /devices/:id` (`{active}`).

## Stock (P)
`GET/POST /projects/:projectId/stock` (`name, unit`);
`GET/POST /projects/:projectId/stock/:itemId/movements`
(`{type: IN|OUT|ADJUSTMENT, quantity, reason}`) — quantity changes only via
movements; overdraw rejected.

## Documents (P)
`GET /projects/:projectId/documents?type=`; `POST` multipart (`file, name,
type: CONTRACT|APPROVAL|CUSTOMER|RECEIPT|COMPLETION|PHOTO|OTHER`); `DELETE` (A).

## Daily reports (P)
`GET /projects/:projectId/daily-reports`; `POST` multipart (`date,
workCompleted, workersPresent, materialsUsed?, challenges?`, up to 6 `photos`).
One report per project per day (upsert).

## Analytics
| Method | Path | Role |
|---|---|---|
| GET | `/analytics/projects/:projectId` | P — financials + monthly expense series |
| GET | `/analytics/company` | A — portfolio totals, per-project comparison, spend trend |

## Settings (A)
`GET/PUT /settings/thresholds` (`{yellowPct, redPct}`);
`GET /settings/finance` (thresholds + labour source);
`PUT /settings/labour-source` (`{labourCostSource: ATTENDANCE|EXPENSES|BOTH}`);
`GET /settings/audit-log?page=`.

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
