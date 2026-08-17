# AlkenFinishes — naming and UI conventions

The rules the codebase already follows, written down so they stop drifting.
Where a rule is mechanically checkable it is in `eslint.config.js` or
`.prettierrc.json` rather than here.

## Vocabulary: one concept, one word per audience

Two concepts are deliberately called different things by different audiences.
That is not drift — but hedging between them is.

| Concept               | In code (models, routes, files) | Admin UI    | Supervisor UI |
| --------------------- | ------------------------------- | ----------- | ------------- |
| A construction site   | `Project` / `project`           | **Project** | **Site**      |
| A worker on the tools | `Worker` / `worker`             | **Worker**  | **Fundi**     |

Rules:

- **Code is always `project` and `worker`** — Prisma models, API routes, query
  keys, component names, props. No `site`/`fundi` identifiers.
- **Supervisor-facing copy is always "site" and "fundi."** That is what people
  say on site, and the supervisor app is used on site.
- **Admin-facing copy is always "project" and "worker."**
- **Never hedge.** `"Site / project"` and `"Fundis and site workers"` are the
  bug this table exists to prevent. Pick the one for the audience.

Other fixed terms:

- **Receivables** is the company-wide A/R view (`/admin/invoices`, nav label
  "Receivables"). **Invoices** is the per-project list on a project's Money
  tab. They are different views and keep different names; the `/invoices`
  route name is historical.
- **Snag** and **defect** both appear in the UI by design: "snag list" is the
  industry term for the artefact, "defect" is the individual item.

## Spelling

British English throughout — `Centre`, `LABOUR`, `summarise`, `organise`,
`fulfil`. The one exception is the Prisma enum `MaterialRequestStatus.FULFILLED`,
which is already in the database and not worth a migration; the route
(`/:id/fulfil`) and all copy stay British.

## React Query keys

All keys come from `apps/web/src/lib/queryKeys.ts`. Never write a key literal
at a call site — that is how four different key shapes ended up coexisting, and
how `invalidateQueries({ queryKey: ['invoice'] })` came to match nothing.

Shape is `[domain, ...scope]`:

```ts
queryKeys.invoices.all(); // ['invoices']            — invalidate everything
queryKeys.invoices.byProject(projectId); // ['invoices','by-project',id]
queryKeys.invoices.detail(invoiceId); // ['invoices','detail',id]
```

- `domain` is the plural, kebab-case name of the thing (`daily-reports`, not
  `dailyReports`).
- Every domain exposes `all()` — the prefix that invalidates the whole domain.
- Lists that take parameters carry a `'list'` segment; single records carry
  `'detail'`. That way a status filter can never collide with a record id.
- Settings all live under `['settings', …]`, so `queryKeys.settings.all()`
  genuinely means every setting.

## Component naming and layout

```
components/ui/         design-system primitives (Button, Dialog, Field…)
components/            app-wide, non-primitive (ProjectCard, ErrorBoundary…)
features/              a tab body or a self-contained editor
pages/admin/           one file per admin route, exporting `XxxPage`
pages/supervisor/      one file per supervisor route, exporting `XxxPage`
```

- Page components are named `<Thing>Page` — all of them, including dashboards.
- `features/*Panel.tsx` is a whole tab body. Do not name a small card `Panel`.
- Avoid bare generic local component names (`Row`, `Big`, `Muted`). Say what it
  is: `StatRow`, `MetricValue`, `MutedText`. If two files want the same one,
  it belongs in `components/ui/`.

## UI rules with a component behind them

Reach for the shared piece rather than re-implementing it:

| Need                                 | Use                                                          |
| ------------------------------------ | ------------------------------------------------------------ |
| A labelled form control              | `<Field label>` — wires `htmlFor`/`aria-describedby` for you |
| A failed mutation next to a form     | `<FormError error={m.error} fallback="…" />`                 |
| Confirmation that something happened | `useToast().success(…)`                                      |
| A destructive action                 | `<ConfirmDialog>` — name the record being deleted            |
| Loading / error / data for a query   | `<QueryState query={q}>{(data) => …}</QueryState>`           |
| A keyboard focus ring                | `focusRing` / `focusRingOnMuted` from `lib/utils`            |
| A status colour                      | the maps in `lib/tone.ts`                                    |
| Aligned figures                      | the `.nums` class, never `tabular-nums` directly             |
| A colour                             | a semantic token (`bg-surface`, `text-fg-muted`, `bg-scrim`) |

Two rules with no component to lean on:

- **Never `if (!data) return <Loading/>`.** That treats a failed request as a
  pending one and parks the user on a spinner forever. Use `QueryState`.
- **Anything clickable is a `<button>` or `<a>`**, never a `div` with an
  `onClick`. The lint rules enforce this.

## Derived form state

A form seeded from server data must seed in `useState`, with the component
`key`ed on the stored value:

```tsx
{summary && <DueDateForm key={summary.dueDate ?? 'unset'} initial={…} />}
```

Not an effect that copies fetched data into state — that re-renders in a
cascade and overwrites whatever the user is typing on every background
refetch. `react-hooks/set-state-in-effect` will reject it.

## Quality gates

```bash
npm run typecheck   # strict TS across both apps
npm run lint        # eslint: correctness, hooks, jsx-a11y
npm run format      # prettier (check with format:check)
npm test -w @alken/api
```

All four run in CI. The API tests need `DATABASE_URL` and `JWT_SECRET` set —
any syntactically valid values will do, nothing connects.
