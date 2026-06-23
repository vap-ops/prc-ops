# Spec 183 — Approvals are awareness, not a tab (PM)

## Origin

Operator, 2026-06-23:

> I feel like รอตรวจ menu should not be the main menu, but rather notification
> of how many Approvals are pending.

Design challenge ("don't just agree blindly"). Discussed and refined with the
operator before writing:

- **Count scope** — operator: "All approvals need noti, but you can design them
  separately as you see fit." So: build a reusable awareness pattern; **v1 = the
  work-package approval queue** (today's รอตรวจ). Purchase-request and
  bank-change / consent approvals get their own awareness in LATER units — not
  this spec.
- **Queue home** — operator: "design with ux in mind" (delegated). Chosen:
  the queue relocates under ภาพรวม (the dashboard) as a prominent card; the
  count rides the ภาพรวม nav as a badge. A header notification bell is
  deferred until the unified-approvals work, when it pays for itself.

## Problem

`รอตรวจ` (the `/review` work-package approval queue) is the **first PM bottom
tab and first hub-nav item**, and the PM/super/director login home
(`roleHome`). But:

1. A bottom tab is meant to be a **place** (a section). The review queue is a
   **transient worklist that is frequently empty** — when empty the tab is a
   dead end ("ไม่มีรายการรอตรวจ"), wasting one of only ~5 tab slots (the app's
   most valuable real estate).
2. What the PM actually needs at a glance is **"how many are waiting?"** — an
   awareness/count job, not a navigation-destination job. A static tab label
   carries no count and no urgency.

## Design (the two jobs)

`รอตรวจ` tangles two distinct jobs. Split them:

- **Awareness** — "do I have approvals waiting, how many, how old?" → a **count**
  (a number on the ภาพรวม nav + a dashboard card). This is the operator's
  "notification of how many approvals are pending."
- **Doing the work** — "show me the queue, let me grind through it." → a real,
  always-reachable **list surface**. A badge cannot do this. `/review` stays a
  live route, reached from the dashboard card (just not a top-level tab).

Approving IS the PM's primary daily function, so we do **not** demote the queue
to a badge-only. We demote the _tab-as-urgency-signal_; the _queue-as-a-place_
moves to a stronger home (the dashboard, which becomes the PM login home).

Out of scope (later units / specs): purchase-request approval awareness,
bank-change / consent approval awareness, a unified approvals inbox, a header
notification bell.

## Units

### U1 — Pending-approvals count + ภาพรวม hero card

- Add `countPendingApprovals(supabase)` in `src/lib/approvals/` — returns the
  number of `work_packages` with `status = 'pending_approval'` visible to the
  caller (RLS-scoped, user-session client). Matches what `/review` lists so the
  count never disagrees with the queue. (`/review` lists ALL pending WPs
  regardless of project status, so this counts the same — a dedicated query, NOT
  derived from the dashboard's live-projects-only WP fetch.)
- On `/dashboard`, for PM tier (`isManager`) only, render a **รอตรวจ hero card**
  at the top of the section (above งบประมาณรวม): the count, the oldest-waiting
  WP summary (project code · WP code, how long it has waited), and a link →
  `/review`. site_admin (also on the dashboard) sees no card — it does not
  approve.
- Empty state is calm, not alarming: "ไม่มีงานรอตรวจ" with no danger styling.
  A pending count > 0 uses the attention/danger treatment.
- Additive only. The รอตรวจ tab, hub item, and `roleHome` are UNCHANGED in U1.
- Test-first: `countPendingApprovals` returns the RLS count; the dashboard
  renders the card with the count + oldest summary for PM, and omits it for
  site_admin.

### U2 — Reframe the nav: drop the tab, reroute the home

- Remove `รอตรวจ` from `PM_TABS` (`bottom-tab-bar.tsx`) and `รายการรอตรวจ` from
  `PM_HUB_NAV` (`hub-nav.tsx`).
- Reroute `roleHome` for the PM tier (`isManagerRole`) → `/dashboard` (was
  `/review`). PM/super/director now land on the dashboard, where the U1 card
  shows the pending count immediately.
- `/review` stays a live route (the full queue list), reached from the dashboard
  card. The bottom-tab active-light logic for `/review/*` is removed with the
  tab.
- Update every pinned test: `bottom-tab-bar.test.tsx` (PM_TABS pin + the
  รอตรวจ-lighting cases), `hub-nav.test.tsx` (PM_ITEMS pin), `role-home.test.ts`
  (PM/super/director → `/dashboard`), `role-sets.test.ts` (PM roles land on
  `/dashboard`), `require-role.test.ts` (not-allowed redirect target).
- Test-first: the PM tab/hub sets no longer contain รอตรวจ; `roleHome` returns
  `/dashboard` for the PM tier.

### U3 — Count badge on the ภาพรวม nav (awareness while elsewhere)

- A self-contained client badge on the ภาพรวม bottom tab + hub item showing the
  pending-approval count (so awareness persists while the PM is on other tabs,
  not only on the dashboard). Self-fetching via the browser client (anon key,
  RLS-scoped) so it does not require threading a count through every page's
  PageShell. Hidden when the count is 0.
- Test-first: the badge renders the count for the PM tier and nothing at 0.

## Acceptance

- A PM logging in lands on ภาพรวม and immediately sees how many approvals are
  pending (card) — no dedicated รอตรวจ tab.
- The full review queue is still one tap away (dashboard card → `/review`); the
  `/review` route and its detail screens are unchanged.
- The ภาพรวม nav carries the pending count while the PM is anywhere in the app
  (U3).
- site_admin, procurement, coordinator, accounting nav sets are untouched.
- `pnpm lint && pnpm typecheck && pnpm test` green; no orphaned pin asserting
  the old รอตรวจ tab / `/review` home.

## Notes / decisions

- Only PM/super/director ever had the รอตรวจ tab, so this change is PM-surface
  only — bounded.
- The other `รอตรวจ` usage (the action-band filter label inside the project WP
  list, `work-package-list.tsx`) is a different concept and is NOT touched.
- Making the dashboard the PM home does not expand what a PM can see: the
  dashboard already shows PM-tier money (budget vs spend); PM could already
  navigate there.
