# Spec 137 — Action-state bands + view filter on the site /requests worklist

- Status: Draft (2026-06-17). Operator: site people need more than ทั้งหมด/ของฉัน, and
  "how they are sorted is not intuitive" + "at the very least be able to filter out items
  received." Aligns with the locked SA action-state lens ([[worklist-priority-alignment]]).

## Problem

The non-procurement `/requests` view (site_admin / project_manager / super_admin) is a
FLAT list — pending requests by priority, then everything else newest-first — with only
a ทั้งหมด/ของฉัน toggle. No way to focus (e.g. hide received), and the flat priority-then-
date order reads as a jumble. (Procurement already has its spec-104 pipeline bands +
spec-110 filters; this brings the same clarity to the site view.)

## Change (app-only, no schema)

- **Action-state bands.** Group the rows by what's happening, most-actionable first:
  `รออนุมัติ` (requested) → `อนุมัติแล้ว รอสั่งซื้อ` (approved) → `กำลังจัดส่ง` (purchased/
  on_route) → `เสร็จแล้ว` (delivered/site_purchased) → `ไม่อนุมัติ / ยกเลิก` (rejected/
  cancelled). Within an active band: priority then oldest (`comparePendingRequests`);
  within done/closed: newest-first. Empty bands are omitted.
- **View filter** (segmented, mirrors the spec-56 WP-list 4-view): **กำลังดำเนินการ**
  (default — shows the three active bands, HIDES received/closed = the operator's minimum)
  · **เสร็จแล้ว** · **ทั้งหมด**. Driven by `?view=active|done|all` (default active).
- **ของฉัน** stays an orthogonal toggle (`?mine=1`), preserved across view changes.
- Pure helpers `requestBand` + `groupRequestsByBand(rows, view)` (unit-tested, TDD);
  no new query (the page already fetches pending + decided). Procurement view unchanged.

## Out of scope / seams

Project / supplier / overdue filters for site (procurement-style); keyset paging of the
done band; per-band collapse. Cross-instance.

## Verification

lint · typecheck · test (incl. the new band helper tests) green. App-only → no db:push.
UI auth-gated → verified-by-checklist; operator device pass is acceptance.
