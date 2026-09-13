# Alken Decor — project notes for Claude

## UI/UX rules (from the 2026-09 design audit)

These came out of a live Principal-Designer-style audit of the admin Command
Centre and Overview pages. Apply them to any future UI work in this repo,
not just the screens that prompted them.

- **Accent orange (`accent-*`) is for the one or two things that matter most
  on a screen, not for every link.** If a page has more than ~3 orange
  elements, that's a signal it's being used as a generic "this is
  clickable" color again instead of "pay attention here." Prefer a neutral
  `text-fg-subtle` link (with a chevron, not an arrow glyph) for routine
  drill-down links on repeated card grids; reserve accent for the one hero
  metric, the one primary action, and selected/active states.
- **Don't force a fixed aspect ratio (e.g. `aspect-video`) onto
  user-uploaded photos.** Real site photos come in arbitrary shapes
  (portrait document shots, snag close-ups, etc.); a wide forced ratio with
  `object-cover` crops content unpredictably and can make a card far taller
  than the rest of the page. Use a capped, responsive fixed height instead
  (e.g. `h-56 sm:h-72`) so any photo shape degrades gracefully.
- **One-time walkthrough affordances (numbered badges, "new" tags, tour
  hints) should actually go away after the first visit**, not stay on
  screen forever. Gate them behind a `localStorage` flag rather than
  showing them unconditionally on every load.
- **Warning banners should escalate with real state, not stay static.** A
  "missing setup" notice (e.g. "no contract linked") is informational while
  a project is still being set up, but becomes a real risk once the project
  is active with money or schedule already committed — bump its `Notice`
  tone (`warn` → `danger`) accordingly rather than using one fixed tone
  regardless of context.
- **Don't show near-duplicate insights/warnings as separate items** when
  they stem from the same underlying cause (e.g. "behind schedule" and
  "over budget for the work done" on a slipping project). Prefer merging
  them into one clear statement at the presentation layer over letting a
  rules engine's independent outputs visually repeat each other — but keep
  the underlying rules themselves independent and testable; only merge how
  they're *displayed*.
- **Avoid reusing the same icon for two conceptually different metrics** on
  the same screen (e.g. a trending-up arrow for both "schedule progress"
  and "profit") — it weakens icon-based scanning.
- When auditing a live page in this app, **remember the PWA service worker
  caches the previous build** — after a redeploy, the browser will keep
  showing the old bundle until "Update now" is clicked (or the SW is
  otherwise bypassed). Don't mistake a stale cached bundle for a failed
  deploy.

## Environment notes

- No separate `main` branch — `claude/alken-finishes-system-1ccsg2` is the
  only branch and is used directly for PRs.
- Local dev stack runs via `docker compose up -d --build --force-recreate
  <service>` (foreground; backgrounded runs get killed in some
  environments — prefer running it directly and waiting).
- This environment's `resize_window` browser-automation tool does not
  actually change the rendered viewport — responsive/breakpoint claims
  should be verified via Tailwind breakpoint code review, and that
  limitation should be disclosed rather than implied as a real device test.
- Prisma schema/migrations are hand-written (no `prisma migrate dev`
  codegen loop) — write the migration SQL directly alongside the schema
  change.
