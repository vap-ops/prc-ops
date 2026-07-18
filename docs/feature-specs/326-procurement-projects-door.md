# Spec 326 — Procurement โครงการ door (WP-list reachability)

- **Status:** Approved (operator, 2026-07-18 chat)
- **Owner unit:** single code-only unit
- **Amends:** spec 323 §4 (STR menu map — adds a fifth ขอบเขต door)

## Problem

Procurement is a first-class read-only viewer of the project WP list
(`/projects/[id]`, spec 173) and may open WP detail (spec 171) and the schedule,
but since the spec 323 STR nav flip (U3b, PR #584) it has **no discoverable
entry** to any `/projects` surface:

- The pre-323 `PROCUREMENT_TABS` carried a โครงการ `/projects` tab; the approved
  5-tab STR spine (หน้าหลัก · ขอบเขต · เวลา · ทรัพยากร · ตั้งค่า) dropped it.
- The `/procurement` hub's project status strip links to `/requests?project=X`
  (where the counts point), not the project page.
- Remaining paths are typed URLs or a 2-hop back-chip ride (แผนจัดหา /
  ต้นทุนโครงการ door → per-project page → กลับไปโครงการ chip).

Operator asked "where can procurement team see WP list?" (2026-07-18), was shown
the gap, and approved this fix ("yes build it").

## Decision

Add one **shared-scope door** to the ขอบเขต section of the STR menu map,
directly after จัดซื้อ:

```ts
{ key: "projects", label: "โครงการ", href: "/projects", scope: "shared" }
```

- **Why ขอบเขต:** the WP list is the project's scope of work; it sits beside the
  request queue it informs and the supply plan that consumes it.
- **Why shared scope → `/projects` (hub), not a 📍 project door → `/projects/[id]`:**
  project-scope doors hide when 2+ projects have no lens selection
  (`visibleProcurementDoors`) — the discoverability gap would persist in the
  hub's default state. The projects hub is cross-project-first, consistent with
  D3 (lens = filter; procurement is cross-project by nature), and never
  dead-ends: `PROJECT_VIEW_ROLES` admits both procurement tiers and `/projects`
  keeps a procurement chrome branch (kept URL-reachable in 323 U4 for exactly
  this reason).
- **Label:** literal `โครงการ` — matches the destination's `metadata.title`/h2
  and every other role's tab label for `/projects` (no SSOT constant exists;
  the tab sets use the literal). No door/destination label drift (#612/#622
  lesson).

### Relation to spec 323 D3 / U3b review

323 U3b fresh-eyes refuted a `/projects` door as "approved design" — the STR map
deliberately shipped without one. The operator reversed that on 2026-07-18 after
the WP-list discoverability gap surfaced in real use. D3 itself (lens = filter,
not switcher) is untouched; this door is a navigation entry, not a switcher.

## Non-goals

- No sixth bottom tab — the 5-tab STR spine stands (spec 323 decision A).
- No project-scope direct-to-WP-list door (hidden-by-default problem above).
- No chrome/behavior change on `/projects` or `/projects/[id]` — access and
  read-only gating are already live (specs 173/171, ADR 0070).

## Unit checklist

1. RED: extend `tests/unit/procurement-home.test.ts` — ขอบเขต contains the
   projects door (key/label/href/scope pinned), positioned after จัดซื้อ;
   `procurementDoorHref` leaves it untouched by an active project.
2. GREEN: add the door to `PROCUREMENT_STR_SECTIONS` scope section.
3. Docs: `docs/site-map.md` `/projects` row "Reached" gains the hub door path;
   spec index row.
4. Verify: full suite + SSR probe `/procurement/scope` as procurement (door
   renders; anchor is `/projects?from=…` — `withBackFrom` wraps every door,
   `procurementDoorHref`'s return is the bare href), zero console/server errors.
