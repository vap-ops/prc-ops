# Feature Spec 10: WP-centric purchase requests, mobile form fix, phase relabel

## Status

Locked — 2026-06-11. Operator brief (chat, this session). Three items, all
UI-layer. No schema, RLS, action, or enum changes.

Operator framing: **"WP is the main place we deal with things."**

## Items

### 1. Fix — Unit field exceeds the screen on mobile

`src/components/features/purchase-request-form.tsx` lays Quantity and Unit
side by side in a `flex gap-3` row of two `flex-1` columns. Text inputs have
an intrinsic minimum width (the browser default `size`), and neither the
columns (`min-w-0`) nor the inputs (`w-full`) are allowed to shrink below it
— at phone widths the Unit input overflows the viewport.

Fix: add `min-w-0` to both flex children and `w-full min-w-0` to both
inputs. No layout redesign.

### 2. Requests are raised FROM a work package

Today: `/requests` shows a form with a WP `<select>` — request "outside",
then pick the WP. Users want the opposite: open the WP, raise the request
there, WP already set.

- **WP screens get the entry point.** The SA photo screen
  (`/sa/projects/[projectId]/work-packages/[workPackageId]`) and the PM WP
  review screen (`/pm/work-packages/[workPackageId]`) each add a
  `Raise purchase request →` link in the header column pointing to
  `/requests?wp=<wp.id>`.
- **`/requests` accepts an optional `wp` searchParam.**
  - Param present, valid UUID shape (reuse `isValidUuid` from
    `@/lib/photos/path` — already pure + unit-tested), and the WP is
    readable under the caller's RLS → render the form **pinned** to that WP:
    a static `code · name` context line, no picker.
  - Param present but invalid / not readable → no form; show a
    "Work package not found." strip above the guidance card.
  - No param → no form; show a guidance card: requests are raised from a
    work package (open the WP, tap "Raise purchase request").
  - The "My requests" list renders unchanged in all three modes.
- **`PurchaseRequestForm` prop change.**
  `workPackages: ReadonlyArray<…>` → `workPackage: { id, code, name }`.
  The `<select>` and the `workPackageId` state are removed; the submit path
  uses the pinned id. Validation, server action, RLS: unchanged.
- **Entry-link relabels** (the old links pointed at the picker form):
  - `/sa` nav: `Raise a request →` → `My requests →` (href unchanged).
  - `/pm` nav: `Raise a request →` → `My requests →` (href unchanged).
  - OperatorHub (`coming-soon/page.tsx` `HUB_LINKS`): `/requests` entry
    label `Raise a request` → `My requests`; hint updated to say new
    requests start from a work package.

### 3. Phase label "Before" → "Preparation"

Display-only. The operator's mental model: the first phase is equipment and
raw-material staging, not a "before" snapshot.

- The two `PHASES` arrays — SA photo screen and PM WP page — change
  `label: "Before"` to `label: "Preparation"`. The label prop already flows
  into `PhaseUploader` / `PhaseGallery`, so empty states and headings follow.
- The `photo_phase` DB enum (`before/during/after`) is **untouched** — no
  migration, no ADR. Column values are storage keys; the label is
  presentation.
- The PDF worker is untouched (v1 reports render After photos only).

## Tests (TDD posture)

No new pure helper emerges: the UUID shape check reuses the already-tested
`isValidUuid`; everything else is Server Component wiring, `"use client"`
form state, and Tailwind classes — surfaces this repo deliberately does not
component-test yet (CLAUDE.md scope discipline; P1b precedent). Therefore
this unit ships **no new unit test**; the existing Vitest suite (152) must
stay green, and lint + typecheck must pass. Post-deploy, the operator
eyeballs the form at phone width (the original bug report's surface).

## Verification checklist

- [ ] `pnpm lint` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` — 152/152 unchanged
- [ ] `/requests?wp=<valid readable id>` → pinned form, no picker
- [ ] `/requests` (no param) → guidance card + My requests, no form
- [ ] `/requests?wp=<garbage>` → "Work package not found." + guidance card
- [ ] SA photo screen and PM WP screen both link to the pinned form
- [ ] Quantity/Unit row cannot overflow (`min-w-0` + `w-full` present)
- [ ] "Preparation" appears where "Before" did on both WP screens
- [ ] No diff under `supabase/`, `src/app/requests/actions.ts`, or
      `src/lib/purchasing/`

## Scope — out (record; do not build)

- Renaming the `photo_phase` enum value (needs ADR + migration; not wanted).
- Removing `/requests` entirely or moving "My requests" into WP screens.
- Embedding the request form inline on the WP screens (link-out chosen:
  one form, one route, no duplicated submit surface).
- Audit-on-create, AppSheet-originated requests, `users.email` bridge.
