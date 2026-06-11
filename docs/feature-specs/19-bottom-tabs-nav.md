# Spec 19 — Bottom tab bar + purchasing-surface consolidation (iteration 6 nav)

**Status:** DRAFT 2026-06-11 — responds to the operator's "navigating
between pages is still confusing" (after spec 18's HubNav). The bottom
tab bar (§1–§3) is locked by that brief; the purchasing-surface merge
(§4) is **recommended but operator-vetoable** (it removes a route).
One question gates §4 only; §1–§3 can ship without it.

## Why the top strip wasn't enough

Spec 18 made the destinations consistent, but they remain small text
links at the TOP of the screen — the hardest thumb zone on a phone, in
the same visual band as the header, with no icons. Construction staff
on phones (soon in a standalone PWA with no browser chrome at all)
expect app navigation where every phone app puts it: a fixed bar at the
bottom with icons. Secondary confusion: PMs see TWO purchasing entries
(คำขอซื้อ = approve queue; คำขอซื้อของฉัน = own list) whose difference
is invisible from the labels — and the spec-16 addendum (site-wide
visibility) makes the "ของฉัน" split obsolete anyway.

## 1. `BottomTabBar` — the primary nav on phones

New `src/components/features/bottom-tab-bar.tsx` (`'use client'`:
`usePathname` for the active tab). Fixed bottom, `sm:hidden`;
`h-16` + `pb-[env(safe-area-inset-bottom)]` (PWA standalone on iPhone);
zinc-950/95 backdrop-blur ground, top border zinc-800. Each tab: lucide
icon (size-5) over an 11px Thai label, min 64px wide touch area; active
tab text-zinc-100 + emerald icon accent, inactive zinc-500.

**Active-tab rule (adversarial-pass major fix): longest matching prefix
wins — exactly ONE active tab, ever.** Naive `startsWith` would light
both รอตรวจ (`/pm`) and โครงการ (`/pm/projects`) on every
`/pm/projects/*` page. The matcher picks the single tab whose href is
the longest prefix of the pathname; the test asserts exactly one
`aria-current="page"` at `pathname=/pm/projects/x`. Cross-surface
pages match no tab and that is accepted and stated: a PM on the
spec-12-locked back-target `/sa/projects/...`, or (without §4) a PM on
`/requests`, sees no active tab — the bar still renders for
navigation; in-page back links remain the way "up" works.

Role-aware sets (constants beside the component, test-pinned like
`PM_HUB_NAV`):

- **SA:** โครงการ (`/sa`, FolderKanban) · คำขอซื้อ (`/requests`,
  ShoppingCart) · โปรไฟล์ (`/profile`, CircleUserRound)
- **PM (with §4):** รอตรวจ (`/pm`, ClipboardCheck) · โครงการ
  (`/pm/projects`, FolderKanban) · คำขอซื้อ (`/requests`,
  ShoppingCart) · โปรไฟล์ (`/profile`, CircleUserRound)
- **PM (without §4):** as above plus the approve queue stays at
  `/pm/requests` and คำขอซื้อ points there; `/requests` reachable from
  within the purchasing page (a link, not a tab — no active tab while
  there, per the rule above), keeping 4 tabs either way.
- **super_admin:** uses the PM set (it is admitted on every PM surface
  today; the operator hub remains its landing page).

The tab bar renders on every authenticated page of the role's surface
(hubs AND detail screens — apps don't hide their tab bar on detail
views). Pages gain `pb-20 sm:pb-0` on the main container so content
clears the bar. Mounting is **per-page** (mirrors AppHeader — the role
comes from the page's existing `requireRole` context; a layout-group
wrapper cannot receive it without an extra fetch).

## 2. Top `HubNav` strip becomes desktop-only

`hidden sm:block` on the HubNav strip (hubs keep it for desktop PM
work); phones rely on the bottom bar. AppHeader (kicker/greeting/
โปรไฟล์/logout) stays on all viewports, but โปรไฟล์ link hides on
phones (`hidden sm:inline-flex`) once the tab bar carries it —
one โปรไฟล์ affordance per viewport.

## 3. Tests (failing first)

- NEW `tests/unit/bottom-tab-bar.test.tsx` — renders the role set;
  longest-prefix matching (mock `next/navigation` `usePathname`):
  **exactly one `aria-current="page"` at `/pm/projects/x`**, zero on a
  cross-surface path; inactive tabs are links; safe-area class present;
  canonical set constants pinned.
- Page wiring verified by build/e2e + checklist (spec-15 posture).

## 4. Purchasing-surface consolidation (RECOMMENDED — operator veto point)

Merge `/pm/requests` into `/requests`: ONE purchasing page for every
role.

- `/requests` (already becoming the site-wide list per the spec-16
  addendum): for PM/super, rows with `status='requested'` additionally
  render the inline `PurchaseRequestDecision` controls (the same
  component the queue uses today), pending rows sorted first
  (priority band → requested_at asc per the addendum), decided rows
  below in requested_at desc. **This supersedes the addendum's
  whole-page `requested_at desc` ordering for every viewer** (SAs see
  the same pending-first shape, without decision controls).
- `/pm/requests` becomes `permanentRedirect("/requests")` (308 — say
  permanent and mean it; bookmarks/LINE links survive). Behavior delta
  recorded: an SA hitting `/pm/requests` today is bounced to `/sa` by
  requireRole/roleHome; afterwards they land on `/requests` (which
  admits sa — no widening). The dead
  `revalidatePath("/pm/requests")` in `requests/actions.ts` is
  removed. **Amends spec 18 §B:** `PM_HUB_NAV` shrinks to three items
  (+ this spec's tab sets); the `toEqual` pins in
  `tests/unit/hub-nav.test.tsx` break first — named UPDATE-test.
- PM nav drops from 5 destinations to 4 tabs with exactly one
  purchasing entry — the labeled-twins confusion dies.
- Metadata/copy: `/requests` title คำขอซื้อ; the PM-specific guidance
  line (rejection-needs-comment) renders only for pm/super.

Why veto-able: it removes a screen PMs may have bookmarked into muscle
memory and mixes decision controls into a shared page. If vetoed,
§1–§3 ship standalone and `/pm/requests` stays.

## Out of scope

Palette/outdoor theme; progressive disclosure inside the decision
cards; skeleton-width follow-up (separate one-liner); LINE notification
deep links; any DB change (the visibility/priority changes are spec-16
addendum scope, not this spec).

## Verification checklist

- [ ] New tab-bar tests RED→GREEN; `pnpm lint && typecheck && test`.
- [ ] Build + e2e green; unauthenticated pages unaffected (tab bar is
      authenticated-surface only).
- [ ] Phone-width manual pass: bar clears iOS safe area; content never
      hides behind it; active states correct on detail pages.
- [ ] Locked behaviors intact: spec-12 back-nav on /requests, spec-10
      pinned-form, spec-11 grouping; if §4 ships — the redirect
      preserves every old entry path.
