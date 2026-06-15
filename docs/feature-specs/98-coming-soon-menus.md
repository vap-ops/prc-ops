# Spec 98 — Coming-soon menu placeholders

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = operator eyeball on the live deploy).
**Driver:** operator — "can we include all menus we will have, then grey them out if they are coming soon?"

## Why

Today the nav shows only live destinations. The operator wants the **full** menu set visible so
users see what is coming, with the not-yet-built entries greyed and non-tappable. This sets
expectations and makes the app read as intentional rather than thin.

## Decisions (this session)

- **Placement = everywhere, including the phone bottom bar** (operator call, over the
  "settings-hub only" recommendation). A coming-soon entry appears greyed in the surface where it
  will live when built.
- **Seed set (3 menus, operator call):**
  - `ภาพรวม` (Dashboard / overview + budget-vs-spend) — a **top-level** menu. Data captured specs
    79–80; no view built.
  - `Nova` (gamification / growth hub) — researched + designed, build HELD
    (memory `settings-hub-and-gamification`). Eventual home is `ตั้งค่า › บัญชี` (the settings code
    already reserves that slot). **Brand name** (operator-chosen 2026-06-15) — see Naming below.
  - `คลังเอกสาร` (central documents library) — today documents live only per-request / per-contact.
- **Naming (Nova).** The first label `ผลงานของฉัน` read like a KPI/job-evaluation and was ego-centric
  (`ของฉัน`), clashing with the private, non-competitive gamification design. The brief converged on a
  cool English brand, easy for Thai mouths, that signals the gamification transition (learning /
  growth / fun, not work). `Nova` (โนวา — a star flaring brighter = breakthrough) won on pronunciation
  - cool factor + a non-ego growth metaphor; it is elastic enough to hold streaks / quests / levels
    later with no rename. Icon `Sparkles`; row subtitle `เรียนรู้ เติบโต เลเวลอัพ`.
- The mechanism is built **once** (a `comingSoon` flag + a shared badge); the seed list is trivial to
  grow or prune later — this is the look-loop's job.
- **Operator tests on an SA account** (memory): the seed is placed so an SA sees all three —
  `ภาพรวม` on the SA bar + hub; `Nova` + `คลังเอกสาร` in the settings เร็วๆนี้ section (all roles).
- **Procurement stays lean** — its worklist-only tab set (spec 70 doctrine) gets **no** coming-soon
  tab. One-line add later if the operator asks.

## What ships

- **`src/components/features/coming-soon-badge.tsx`** — shared presentational `เร็วๆนี้` pill,
  token-only classes (`bg-sunk text-ink-secondary text-meta rounded-full`), no raw palette. Used by
  the hub strip and the settings rows (the bottom bar uses a compact corner marker instead — no
  horizontal room).
- **`bottom-tab-bar.tsx`** — `TabItem` gains `comingSoon?: boolean`. `ภาพรวม`
  (`LayoutDashboard`, href `/dashboard`, `comingSoon`) added to `SA_TABS` + `PM_TABS`, positioned as
  the last content tab before `ตั้งค่า`. A coming-soon tab renders as a **non-link `<span>`**
  (`aria-disabled`, `text-ink-muted`, a small `Clock` corner marker, `title` + an sr-only
  `(เร็วๆนี้)`), is **never** the active tab (skipped in the longest-prefix match loop). PM bar →
  5 tabs, SA → 4 (within the documented 5-tab ceiling).
- **`hub-nav.tsx`** — `HubNavItem` gains `comingSoon?: boolean`. `ภาพรวม` (href `/dashboard`,
  `comingSoon`) added to `SA_HUB_NAV` + `PM_HUB_NAV` before `ตั้งค่า`. A coming-soon item renders as a
  greyed non-link span + `ComingSoonBadge`, never the current page.
- **`settings/page.tsx`** — a new `เร็วๆนี้` section (all roles, above `เกี่ยวกับ`) with greyed
  non-link rows `Nova` (`TrendingUp`) and `คลังเอกสาร` (`Files`), each carrying a
  `ComingSoonBadge` where the chevron normally sits.

## Routes

`/dashboard` (and the future performance/documents routes) are **not built** — the href is a marker
only; coming-soon entries render as spans, so no navigation and no 404. Shipping the real menu = flip
`comingSoon` off and point the href at the new route.

## Tests

- `coming-soon-badge.test.tsx` — renders `เร็วๆนี้`, token classes, no raw palette.
- `bottom-tab-bar.test.tsx` — pins updated to include the `ภาพรวม` coming-soon tab (SA + PM, not
  procurement); coming-soon tab is a non-link span, not `aria-current`, carries the marker.
- `hub-nav.test.tsx` — pins updated; coming-soon item renders greyed/non-link with the badge and is
  never `current` even when `currentHref` matches it.
- Settings page = verified-by-checklist (async Server Component; the shared badge + nav data carry
  the unit tests, per the project convention).

## Seams (recorded)

- `/dashboard`, performance, documents routes unbuilt — flip `comingSoon` off per menu when each
  ships (and move `Nova` from the เร็วๆนี้ section to `บัญชี`, its reserved home).
- Procurement coming-soon tab — deliberately omitted (lean worklist); one-line add if wanted.
- A central nav registry (one source of truth across the three surfaces) — not built; the three
  surfaces still define their own sets, matching the existing pattern. Unify if the count grows.
