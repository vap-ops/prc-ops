# Spec 40 — Re-skin round 2 (operator feedback on spec 38)

**Status:** shipped — 2026-06-12. Operator feedback (screenshots):
"only WP detail uses width; other pages not solved at all; blue
buttons look unprofessional; WP list dated, deliverables hard to
distinguish from WPs."

## The three fixes

1. **Desktop width everywhere.** Hub/list pages: `max-w-2xl` →
   `max-w-2xl lg:max-w-5xl` (header strip, nav strip, and content
   section move together per page). PM WP review: `max-w-3xl
lg:max-w-5xl`. WP detail: + `xl:max-w-7xl`. Card lists (/sa, /pm,
   /pm/projects, /requests) become `lg:grid-cols-2` so width buys
   density, not stretched cards. AppHeader/HubNav prop unions widened
   accordingly.
2. **Primary actions = brand dark.** `bg-blue-700` button fills →
   `bg-slate-900` (hover `slate-800`); blue-outline secondaries →
   slate outline; /requests filter chips' active state + the
   hide-completed toggle fill follow. NOT changed: links
   (`text-blue-700` stays the link convention), focus rings, the tab
   bar accent, the LINE login button, status pills, danger red.
   Contrast improves (white on slate-900 ≈ 17:1 vs 6.8:1 on blue-700).
3. **Deliverable ↔ WP hierarchy** (work-package-list): a group is ONE
   elevated white card; its header carries the brand mark
   (`border-l-4 border-amber-400`, slate-50 band, bold slate-900 name,
   mono code); WPs render as divided, contained rows inside (hover
   wash, `ring-inset` focus, 56px targets). Flat mode (no
   deliverables) keeps standalone cards.

Verification: 362 unit / 27 e2e green; reviewer pass clean (width
alignment per page, no leftover blue fills, aria/progressbar
untouched, slate-500-on-slate-50 ≈ 4.5:1 AA). Acceptance = operator's
eye on the live deploy, as with spec 38.
