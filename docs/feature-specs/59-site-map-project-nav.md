# Spec 59 — site-map audit + one project page

**Status:** complete (2026-06-13) — operator round-trip on deploy = acceptance
**Date:** 2026-06-13
**Origin:** operator 2026-06-13: "the project page is weird, entering
the project shows a page, but pressing back from WP list page takes
user to what appears to be a different page. Can you recheck all the
site map?"

## Audit findings (the full map lands in `docs/site-map.md`)

The PM project flow visits THREE different "project" surfaces:

1. โครงการ tab → `/pm/projects` (project list A, hub style).
2. Tapping a project → `/pm/projects/[id]/reports` — the REPORTS page,
   not the project. ("entering the project shows a page")
3. Its รายการงาน link → `/sa/projects/[id]` (the WP list — the real
   project page), whose back chip is HARDCODED to `/sa` — the SA home
   (project list B, different header/kicker). ("pressing back … a
   different page")

SA flow is consistent (`/sa` → project → back → `/sa`). The defect is
PM/super only: a hardcoded back target + a project row that opens
reports instead of the project.

## Fix — the WP list IS the project page (WP-centric principle)

1. `/pm/projects` rows → `/sa/projects/[id]` — both role hubs now open
   the SAME project page. Reports stop masquerading as the project.
2. WP-list back chip becomes role-aware: new
   `projectHubHref(role)` in `src/lib/auth/role-home.ts`
   (`site_admin → /sa`, `pm/super → /pm/projects`) — unit-tested; the
   page uses `ctx.role`. Round-trips now close: enter from a hub,
   back returns to THAT hub.
3. Reports stay reachable: รายงาน chip (lucide FileText, 44px chip
   style) in the project page's header row, pm/super only, →
   `/pm/projects/[id]/reports`. The reports page's existing nav row
   (รายการรอตรวจ / โครงการทั้งหมด / รายการงาน) already round-trips.
4. `docs/site-map.md` — the audited inventory: every route, its
   requireRole gate, entry edges, and back target. Future nav changes
   update this doc in the same unit (same contract as
   ui-conventions.md).

Spec-12 note: back-nav targets are locked behavior — this spec is the
operator-driven amendment for the WP-list back target; all other back
targets verified unchanged.

## Recorded seams (audit byproducts)

- `/workers` has no nav entry (known since spec 46) — unchanged here.
- `/pm/projects` and `/sa` remain two list surfaces with one behavior;
  merging them is a design-round candidate, not a nav defect.

## Tests (failing first)

- `tests/unit/role-home.test.ts` — `projectHubHref` over all roles.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. Operator (PM account): โครงการ tab → project → WP list; back returns
   to /pm/projects. As SA: same loop returns to /sa. รายงาน chip on the
   project page opens reports.
