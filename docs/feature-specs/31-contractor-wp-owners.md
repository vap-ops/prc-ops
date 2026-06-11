# Spec 31 — Contractor WP owners (replaces spec-28 user-owner UI)

**Origin:** operator chat 2026-06-11 — "มอบหมายงาน is supposed to be WP
Owners (either outsiders or treated as outsiders), I think we need a new
db for this" + "Replace" decision. ADR 0033.

## DB

Migration `20260614140000_contractors_wp_owner.sql`: contractors table
(name non-blank CHECK, phone, created_by/at) + RLS (staff read, PM/super
insert with created_by pin + update, NO delete) + revoke-all-first +
`work_packages.contractor_id` FK. pgTAP file 24.

## App

- Actions (`assignment-actions.ts` reworked): `createContractor({name,
phone})` → `{ok, id}` (validates non-blank name ≤200, phone ≤50);
  `setWorkPackageContractor({projectId, workPackageId, contractorId |
null})` via existing WP UPDATE policy.
- `WpAssignmentPanel` reworked: contractor select (— ไม่ระบุ — +
  existing contractors) + เพิ่มผู้รับเหมาใหม่ details row (ชื่อ + เบอร์โทร
  inputs, สร้างและมอบหมาย button creates then assigns). Owner/member
  controls removed.
- WP header: ผู้รับผิดชอบ line becomes ผู้รับเหมา {name}{ · phone}; team
  line removed. Page drops memberRows/staff queries.
- Thai: ผู้รับเหมา / เพิ่มผู้รับเหมาใหม่ / ชื่อผู้รับเหมา / เบอร์โทร (ไม่บังคับ) /
  สร้างและมอบหมาย / — ไม่ระบุ — / errors: ชื่อผู้รับเหมาต้องไม่ว่าง,
  บันทึกผู้รับเหมาไม่สำเร็จ กรุณาลองใหม่อีกครั้ง.

## Out of scope

Dropping owner_id/work_package_members (dormant, ADR 0033), contractor
pages/dedup, AppSheet exposure.

## Verification

- [ ] pgTAP 24 green post-push; suite green; types regenerated.
- [ ] lint/typecheck/unit green.
- [ ] Manual: PM creates contractor inline, assigns, header shows
      ผู้รับเหมา; SA sees read-only; SA cannot create (RLS).
