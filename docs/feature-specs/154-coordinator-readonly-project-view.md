# Spec 154 — Coordinator read-only project view (stop dead links into SITE_STAFF surfaces)

## Locked design (operator, 2026-06-20)

Origin: spec 143 / ADR 0056 (membership-scoped visibility). `project_coordinator`
is in `PROJECT_VIEW_ROLES` (reads `/projects` + `/projects/[id]`) but NOT in
`SITE_STAFF_ROLES`. On `/projects/[id]` it falls through to the SA/PM/director
main branch, which renders (a) every WP row as a `<Link>` to the WP detail and
(b) a calendar/schedule chip. Both targets gate `requireRole(SITE_STAFF_ROLES)`,
which denies coordinator → `redirect(roleHome)` → `/projects`. Net: a coordinator
tapping any WP or the calendar is bounced back to the hub — dead links.

ADR 0056 KEEPS the capture-heavy WP detail + schedule **SITE_STAFF-only**. So the
fix is to stop rendering links a coordinator can't follow — NOT to widen any gate.
Procurement already avoids this via its own read-only early-return branch (spec
102); coordinator never got the equivalent. We do NOT route coordinator into the
procurement branch (different role, different intent — site-map says keep them
separate). Coordinator KEEPS the manager-grade WP list (priority/deliverable lens,
grouping), just non-clickable.

**Decision:**

- One predicate gates "can this viewer reach SITE_STAFF surfaces from the project
  page": `const canOpenWp = SITE_STAFF_ROLES.includes(ctx.role);`. In the main
  branch the only non-SITE_STAFF role is `project_coordinator`, so this cleanly
  selects it — and any future read-only browse role added to `PROJECT_VIEW_ROLES`
  (but not `SITE_STAFF_ROLES`) is covered automatically.
- `WorklistRow` gains an OPTIONAL `canOpen?: boolean` (default `true` → existing
  call sites unchanged). When `false`: render the SAME content in a
  non-interactive container — no `<Link>`, no `href`, no hover/press/active
  states, no focus ring, no chevron/tap affordance. The list-enter animation
  (layout, not interaction) is preserved. When `true`/absent: unchanged.
- `WorkPackageList` gains `canOpen?: boolean` (default `true`), passed straight
  through to every `WorklistRow`.
- `project/[id]` main branch: pass `canOpen={canOpenWp}` to `WorkPackageList`;
  render the calendar/schedule chip ONLY when `canOpenWp` (it links to the
  SITE_STAFF `/schedule`), and fix the now-stale "all staff" comment. Reports +
  gear chips already gate on `isManagerRole` — leave them.

## Scope — IN

1. `worklist-row.tsx` — add `canOpen` (default true) + non-interactive render path.
2. `work-package-list.tsx` — add `canOpen` (default true), pass through.
3. `project/[id]/page.tsx` — compute `canOpenWp`, pass it, gate the calendar chip
   on it, fix the chip comment.
4. The two TDD tests.
5. `docs/site-map.md` — record that a coordinator's `/projects/[id]` view is
   read-only (non-link WP rows, no calendar chip). Doc edit only where touched.

## TDD

Failing tests first.

1. `WorklistRow` (`tests/unit/worklist-row.test.tsx`): with `canOpen={false}`,
   `queryByRole('link')` is null AND the name/status still render; with
   `canOpen={true}` and with the prop omitted, exactly one link to the WP-detail
   href. Fails until the prop + non-interactive path exist.
2. `WorkPackageList` (`tests/unit/work-package-list.test.tsx`): render with
   `canOpen={false}` → zero row links; omitted/default → links. (Minimal row data.)

## Scope — OUT (open questions, do NOT build)

- Fix B (coordinator read-only WP DETAIL / schedule) — contradicts ADR 0056,
  needs an ADR amendment first.
- Any change to the WP-detail or schedule `requireRole` gates (coordinator stays
  excluded — that is correct).
- The procurement branch; the `/projects` hub.
- Read-only row styling beyond removing the tap affordance.
- Any RLS / migration / schema / server-action / routing change (this touches
  none). `WorklistRow` / `WorkPackageList` are already client components; no new
  `'use client'`.

## Verify

- `pnpm lint && pnpm typecheck && pnpm test` — all green; both new tests pass.
- Live (operator): as a coordinator, open a project → WP rows are not tappable,
  no calendar chip, list still shows names/status/priority, and you can no longer
  be bounced from `/projects/[id]`. As a PM/SA → rows still open the WP detail and
  the calendar chip is present.
