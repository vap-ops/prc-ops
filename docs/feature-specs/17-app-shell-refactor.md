# Spec 17 — App-shell structural refactor (iteration 4)

**Status:** Locked 2026-06-11 by the operator's chat brief ("work on
refactoring code base while I'm away" — autonomous block, no questions).
Scope = the shared app-header refactor deferred by specs 14 and 15 (the
"three-pattern split" audit item), extended to the other copy-pasted
shell primitives found in the 2026-06-11 inventory. **Behavior-preserving:
zero visual, copy, route, query, or DB change.** Class-attribute ORDER may
change where `cn()` merges (no rendered difference).

## Problem

Six pages hand-roll the same hub header in three drifted variants; the
status-pill `<span>` is copy-pasted at nine sites; the error strip and
empty-state notice at ~11 sites; `pm/requests` and the PM WP review page
carry byte-identical admin-client name-resolution helpers; and two pill
class maps (approval decisions, report statuses) live outside
`status-colors.ts`, the declared home. Every future screen pays the
copy-paste tax and risks further drift.

## Scope

### A. `AppHeader` — `src/components/features/app-header.tsx`

Server component. Props: `kicker: string`, `fullName?: string | null`
(greeting variant: `สวัสดี คุณ{name}` / fallback `สวัสดี`),
`title?: string` (fixed-title variant — overrides the greeting),
`maxWidthClass: "max-w-2xl" | "max-w-3xl"` (literal class, preserving
each page's current width), `showProfileLink?: boolean` (default true;
the โปรไฟล์ link + `LogoutButton` block). Renders the exact current
header markup.

Consumers (6): `/sa` (2xl, หน้างาน), `/pm` (3xl, ผู้จัดการโครงการ),
`/pm/requests` (3xl, คำขอซื้อ), `/requests` (3xl, คำขอซื้อ),
`/pm/projects` (2xl, ผู้จัดการโครงการ, `showProfileLink={false}` —
preserving today's no-profile-link state), reports page (2xl,
ผู้จัดการโครงการ, `title="รายงาน"`, `showProfileLink={false}`).
Detail-page breadcrumb headers and the bespoke
landing/login/profile/coming-soon layouts are NOT consumers.

### B. `StatusPill` — `src/components/features/status-pill.tsx`

`<span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium", pillClasses, className)}>`.
Consumers (10): sa project list, pm queue, pm/projects list, /requests
pill, **SA WP photo-screen header pill** (`className="mt-1"` — a 10th
site the original nine-site inventory missed; enumeration gap recorded
per the spec-14 "12th page title" precedent, not silently absorbed),
PM WP header pill (`className="mt-1"`), PM WP decision-history pill,
reports-list pill, WP-list row pill, WP-list group-header pill. Note:
the group-header pill gains `shrink-0` (no visual effect in its
flex-col context — recorded).

### C. `ErrorNotice` / `EmptyNotice` — `src/components/features/notices.tsx`

The standard red error strip
(`rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200`)
and zinc empty notice
(`rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-400`,
`className` override for the `text-zinc-500` call sites). Consumers:
every standard-size occurrence (sa, pm, pm/projects, pm/requests,
reports page + list, /requests ×2, WP list, PM WP page ×3,
phase-uploader empty state). The two small-size error variants
(phase-uploader alert `px-3 py-2 text-xs`, download-button error
`px-2 py-1 text-xs`) stay local — different geometry, one site each.

### D. Pill maps complete their move to `status-colors.ts`

- `approvalDecisionPillClasses(decision: ApprovalDecision | null)` —
  approved→emerald, rejected→red, needs_revision→amber, null→zinc.
  Replaces pm/page's local `decisionPillClasses` and the PM WP page's
  `DECISION_CLASSES`. Recorded normalization: pm/page's local map
  returned zinc for `approved`, a state that cannot appear on the queue
  (approved WPs leave `pending_approval`); the shared helper returns
  emerald, matching the decision-history map. No reachable difference.
- `reportStatusPillClasses(status: ReportStatus)` — requested→zinc,
  processing→amber, complete→emerald, failed→red. Replaces
  reports-list's `STATUS_PILL_CLASSES`. (Labels stay in
  `reports/predicates.ts` — established home.)

### E. `fetchDisplayNames` — `src/lib/users/display-names.ts`

`server-only`. Consolidates `fetchRequesterNames` (pm/requests) and
`fetchDeciderNames` (PM WP page): admin-client `users` lookup returning
`Map<id, full_name>`, skipping null names, returning an empty map (and
`console.error` with a caller-supplied log tag) on error. Call-site
shapes unchanged.

## Out of scope (recorded candidates, NOT this unit)

Nav-strip extraction (the strips genuinely differ per page); row-link
card extraction (3 near-identical sites + 1 variant); normalizing the
header inconsistencies the refactor now makes visible as props —
whether `/pm/projects` + reports should gain the โปรไฟล์ link and
whether widths should unify is an **operator question for iteration 5**;
any copy/route/query change; spec-16 implementation.

## Tests (failing first)

- `tests/unit/status-colors.test.ts` — extend:
  `approvalDecisionPillClasses` exhaustive over
  `Constants.public.Enums.approval_decision` + null + palette pins;
  `reportStatusPillClasses` exhaustive over `report_status` + fallback +
  palette pins.
- NEW `tests/unit/display-names.test.ts` — mocks `server-only` +
  `@/lib/db/admin`: empty input → empty map with no client call; maps
  names; skips null `full_name`; query error → empty map + tagged
  `console.error`.
- NEW `tests/unit/app-shell-primitives.test.tsx` — `AppHeader`: kicker
  renders; greeting with/without `fullName`; `title` overrides
  greeting; profile link present (href `/profile`) and absent per
  `showProfileLink`. `StatusPill`: label + merged classes. `ErrorNotice`
  / `EmptyNotice`: base classes; `EmptyNotice` className override wins
  (tailwind-merge).

Page wiring is presentational substitution verified by
lint/typecheck/build/e2e + the checklist (spec-15 posture).

## Verification checklist

- [ ] New tests RED before the modules exist, GREEN after.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] `pnpm build` passes; route count unchanged.
- [ ] `pnpm test:e2e` passes (no asserted copy touched).
- [ ] Behavior-preservation review: every replaced site renders the
      same copy and visual classes. The complete recorded-delta list:
      (1) class order via cn(); (2) group-header pill `shrink-0`;
      (3) unreachable `approved` color on the pm queue zinc→emerald;
      (4) `/pm/projects` + reports-page logout button now wrapped in
      the shared single-child flex div (no visual change); (5) the
      consolidated helper's `console.error` body unified to
      "failed to read display names" (tags preserved; server-log text
      only, never rendered).
- [ ] No diff under `supabase/`, `worker/`; no enum/route/redirect/
      query change.
- [ ] Locked behaviors intact: spec-10/11/12 semantics (grouping,
      progress-from-unfiltered, back-nav), spec-14 glossary, spec-15
      fact lines.
