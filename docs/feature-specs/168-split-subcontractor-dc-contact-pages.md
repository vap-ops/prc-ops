# Spec 168 — Split the subcontractor and DC contact pages

## Problem

The operator (2026-06-21): _"Setting page of sub contractor should not be in the
same page as DC."_

Spec 99 grouped the five contact types into three group screens, and put
**ผู้รับเหมาช่วง (subcontractor)** and **DC** together on one page —
`/contacts/crews` (titled "ผู้รับเหมาช่วงและทีม DC"), reached from a single
`ตั้งค่า` door labelled `ผู้รับเหมาช่วง / DC`. The two are switched by a tab chip
row on that page.

They are genuinely different relationships (per the pay model): a **subcontractor**
(`contractor_category='contractor'`) is a firm PRC hires that pays its **own** crew;
a **DC** (`contractor_category='dc'`) is paid **directly** by PRC. Bundling their
management on one page blurs that line and adds a tab hop. The operator wants them
as **separate pages**.

## Decision

Split the `crews` group into **two single-type groups**, each its own page:

- **`/contacts/subcontractors`** — ผู้รับเหมาช่วง (group `subcontractors`, the one
  `contractors` tab).
- **`/contacts/dc`** — DC (group `dc`, the one `dc` tab).

`/contacts/crews` is **removed** (it was only reached from the `ตั้งค่า` door, which
this unit replaces). The `ตั้งค่า` master-data section gets **two doors** in place of
the merged one. Each new page is a single-type group, so `ContactsTabs` renders **no
tab chip row** (its existing `tabs.length > 1` guard) — just the list + Add.

Same `contractors` table, same `ContactsTabs` component, same detail route
(`/contacts/contractors/[id]` still serves both categories). This is a **pure IA
split** — no DB, no schema, no new component, no change to create/edit behaviour.

## Scope (exactly this)

1. **`lib/contacts/groups.ts`** — `ContactGroup` becomes
   `"customers" | "vendors" | "subcontractors" | "dc" | "suppliers"` (drop
   `"crews"`). `CONTACT_GROUP_TABS` drops `crews` and adds
   `subcontractors: ["contractors"]` and `dc: ["dc"]`. `STATUS_TABS` unchanged
   (`contractors`/`dc`/`service` still statused).

2. **`/contacts/subcontractors/page.tsx`** (+ `loading.tsx`) — PM/super, fetches
   `contractors` where `contractor_category='contractor'`, `DetailHeader` back to
   `/settings`, title `SUBCONTRACTOR_LABEL`, renders
   `<ContactsTabs group="subcontractors" contractors={…} />`.

3. **`/contacts/dc/page.tsx`** (+ `loading.tsx`) — PM/super, fetches `contractors`
   where `contractor_category='dc'`, `DetailHeader` back to `/settings`, title
   `ทีม DC`, renders `<ContactsTabs group="dc" dc={…} />`.

4. **Remove `/contacts/crews/`** (`page.tsx` + `loading.tsx`).

5. **`/settings`** — replace the single `ผู้รับเหมาช่วง / DC` door with two:
   `SUBCONTRACTOR_LABEL` → `/contacts/subcontractors` (icon `Hammer`) and `DC` →
   `/contacts/dc` (icon `Contact`, hint `DC ประจำ/ชั่วคราว/บริษัท`). The `/workers`
   roster door (ทะเบียนทีมงาน DC) is unchanged — it is the DC _worker_ roster +
   day rates, a different surface from the DC _contact_ records.

6. **Tests:**
   - `contacts-groups.test.ts` (path b) — assert the new map (`subcontractors`/`dc`,
     no `crews`); the coverage union spreads the two new groups.
   - `contact-subcontractor-label.test.ts` — swap the `crews/page.tsx` SSOT surface
     for `subcontractors/page.tsx`.
   - `nav-back-affordance.test.ts` — `STATIC_DETAIL` drops `contacts/crews`, adds
     `contacts/subcontractors` + `contacts/dc` (both drill-downs with `DetailHeader`).

## Out of scope / preserved

- The contact **detail** route (`/contacts/contractors/[id]`) serves both categories
  — untouched.
- **`/workers`** (DC worker roster + day rates) — untouched; distinct from the DC
  contact list.
- No DB / schema / RPC / create-edit-behaviour change; `ContactsTabs`,
  `RecordManager`, and the field sets are unchanged.
- No redirect kept for `/contacts/crews` — it was an internal `ตั้งค่า`-only door
  (pre-beta); the door is replaced in the same unit.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] `pnpm build` green.
- [ ] `ตั้งค่า` shows two master-data doors: ผู้รับเหมาช่วง and DC, going to separate
      pages.
- [ ] `/contacts/subcontractors` lists only subcontractors (no DC tab); `/contacts/dc`
      lists only DC (no subcontractor tab); neither shows a tab chip row.
- [ ] Add / edit still work on each page.
- [ ] Acceptance = operator phone (PM/SA-gated routes; preview env only renders /login).
