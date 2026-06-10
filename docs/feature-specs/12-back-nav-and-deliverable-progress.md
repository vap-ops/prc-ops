# Feature Spec 12: /requests back navigation + deliverable progress + ui-ux-pro-max pass

## Status

Locked — 2026-06-11. Operator brief (chat), three items:

1. "Once entered purchase request form, there is no going back"
2. "Deliverables must also have progress status, computed from WPs inside"
3. "Have you heard of ux ui pro max? Apply"

Item 3 is the installed `ui-ux-pro-max` skill. Its database was queried
for this product context; the **applied rules** are listed below. The
application is **bounded to the two surfaces this unit touches**
(`/requests` page, deliverable-grouped WP list) — a whole-app restyle is
a separate unit if ever wanted.

## Item 1 — Back navigation on /requests

`/requests` renders no in-app back affordance; in the LINE in-app
browser users feel trapped (skill rule: Navigation/Back Button, High).

- Add the app's established **sub-nav strip** (same pattern as
  `/pm/requests`: bordered row under the header) carrying one link:
  - **Pinned mode** (`?wp=` resolved): `← Back to work package` →
    `/sa/projects/{project_id}/work-packages/{wp_id}`. The WP lookup
    gains `project_id`. The SA WP screen admits sa/pm/super (verified),
    so the target is valid for every role that can reach the form.
  - **Bare mode**: `← Back` → `roleHome(ctx.role)` (sa → /sa, pm → /pm,
    super → /coming-soon hub). Reuses the single source of truth in
    `src/lib/auth/role-home.ts`.
- Link is an `inline-flex items-center gap-1.5 min-h-10` target with a
  lucide `ArrowLeft` icon (skill: 44px-class touch targets, consistent
  icon set, no emoji icons).

## Item 2 — Deliverable progress, computed from member WPs

- **Pure helper** `src/lib/deliverables/derive-progress.ts` (TDD —
  failing test first):
  `deriveDeliverableProgress(statuses) → { status, completeCount,
totalCount, percent }` where `status` is:
  - `complete` — every WP `complete` (and at least one WP);
  - `not_started` — every WP `not_started` (or zero WPs, degenerate);
  - `in_progress` — anything else (mixes, on_hold, pending_approval).
    `percent = round(100 × completeCount / totalCount)` (0 when empty).
- **Computed from the FULL deliverable membership** — the unfiltered WP
  list — so the header shows true progress even while the text filter
  or "Hide completed" is active.
- **Header rendering** (grouped mode only; flat/degraded mode
  unchanged):
  - Right side: status pill reusing `workPackageStatusPillClasses` +
    the existing WP status labels ("Not started" / "In progress" /
    "Complete") — same visual language as WP rows — plus a small
    `k/n` count line.
  - A thin progress strip across the bottom of the header button:
    zinc-800 track, emerald fill at `percent%`, `role="progressbar"`
    with `aria-valuenow/min/max` and an `aria-label` naming the
    deliverable. The `k/n` text keeps color from being the only
    indicator (skill: Accessibility, High).

## Item 3 — ui-ux-pro-max rules applied (bounded)

From the skill's database, applied to these surfaces:

- **Back Button / predictable history** (Navigation, High) → item 1.
- **Progress Indicators** (Feedback, Medium) → item 2.
- **Touch Target ≥44px** (Touch, High) → back link `min-h-10` hit area;
  group headers already `min-h-12`.
- **Reduced motion** (Animation/Accessibility, High) → chevron rotation
  and header transitions gain `motion-reduce:transition-none`.
- **Cursor pointer on interactive elements** (skill common rules) →
  explicit `cursor-pointer` on the group-header button (Tailwind v4
  preflight no longer sets it on buttons).
- **Visible focus states** (Focus, High) → retained `focus-visible`
  rings on all new elements.
- **Consistent icon set / no emoji icons** → lucide `ArrowLeft` joins
  the existing lucide usage.
- Form input conventions (h-9, focus rings, disabled styles,
  placeholder contrast) — already consistent app-wide; left as-is
  deliberately (consistency outranks the skill's h-10 sample).

## TDD plan (test first — state "Writing failing test first")

`tests/unit/derive-deliverable-progress.test.ts`:

- zero WPs → `not_started`, 0/0, percent 0;
- all complete → `complete`, percent 100;
- all not_started → `not_started`, percent 0;
- mixed statuses → `in_progress` with exact counts and rounded percent
  (e.g. 1/3 → 33);
- `on_hold` / `pending_approval` mixes → `in_progress`;
- all-complete single WP → `complete` 1/1.

Component/page wiring is `"use client"` / Server Component — not
component-tested (P1b posture).

## Verification checklist

- [ ] New unit test fails before the helper exists, passes after.
- [ ] `pnpm lint` / `pnpm typecheck` clean; full `pnpm test` green.
- [ ] `/requests?wp=…` shows "← Back to work package" to the right WP;
      bare `/requests` shows "← Back" to the caller's role home.
- [ ] Group headers show pill + `k/n` + progress strip; values reflect
      the FULL group even while filters are active.
- [ ] `motion-reduce` guards and `cursor-pointer` present on headers.
- [ ] No diff under `supabase/`.

## Scope — out (record; do not build)

- Whole-app restyle from the skill's design-system output.
- Persisting collapse state; expand/collapse-all (carried from spec 11).
- Deliverable progress anywhere else (PM screens, PDFs) — Phase 3
  territory.
