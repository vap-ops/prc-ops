# Spec 159 — Subcontractor vs DC terminology consistency (U1)

Operator (2026-06-20): "DC setting is confusing — ผู้รับเหมา/DC, ทีมงาน." Root cause:
**"ผู้รับเหมา" is overloaded three ways**, conflating two distinct pay
relationships (see `prc-ops-pay-model`):

1. **General WP contractor** — a work package's assigned contractor, which may be a
   subcontractor **or** a DC crew. **Stays "ผู้รับเหมา"** (operator: leave as-is).
2. **Subcontractor** (`contractor_category = 'contractor'`) — a firm PRC hires that
   pays its **own** crew (PRC does NOT pay them). Should read **ผู้รับเหมาช่วง**.
3. **DC** (`category = 'dc'`, PRC pays directly daily) — already has a clean taxonomy
   in Contacts (DC บริษัท / DC ประจำ / DC ชั่วคราว), but several non-Contacts
   surfaces still mislabel a DC as "ผู้รับเหมา".

The taxonomy itself is already built (`contractor_category` + `contractor_subtype`
enums; Contacts tabs render DC ประจำ/ชั่วคราว/บริษัท). **No schema change.** The fix
is label consistency at the surfaces that merge the two.

## U1 — subcontractor = ผู้รับเหมาช่วง (THIS UNIT)

Rename **only the subcontractor-specific (category=contractor) surfaces** to a
single-sourced term, and de-merge the settings/contacts entry labels. Leaves the
general-WP "ผู้รับเหมา" (operator) and the DC-side mislabels (own unit, U2) alone —
doing the DC side half-way would create new drift.

- **SSOT** `SUBCONTRACTOR_LABEL = "ผู้รับเหมาช่วง"` in `src/lib/i18n/labels.ts`.
  Derived variants compose from it (`ชื่อ…`, `เพิ่ม…`, `… / DC`). (ui-term SSOT memory.)
- Sites (all category=contractor):
  - `contacts-tabs.tsx` — `TAB_LABEL.contractors`, the `CONTRACTOR_FIELDS` name label,
    the contractor-tab `addLabel`.
  - `contacts/crews/page.tsx` — page `metadata.title` + the `<h1>`.
  - `contacts/[type]/[id]/page.tsx` — `TYPE_CONFIG.contractors.label`.
  - `settings/page.tsx` — the crews door `label` (`ผู้รับเหมา/DC` → `ผู้รับเหมาช่วง / DC`,
    kills the slash-merge) + its `hint`.

## TDD

Failing test first. NOTE: "ผู้รับเหมา" is a **substring** of "ผู้รับเหมาช่วง", so
assert presence-of-ช่วง and absence-of-the-exact-old-merged-string — never
absence-of-"ผู้รับเหมา".

- **vitest** `tests/unit/contact-subcontractor-label.test.ts` (source-guard, house
  style — mirrors `nav-back-affordance.test.ts`): `SUBCONTRACTOR_LABEL === "ผู้รับเหมาช่วง"`;
  each of the four source files contains `"ผู้รับเหมาช่วง"`; `settings/page.tsx`
  no longer contains the merged `"ผู้รับเหมา/DC"`.

## Scope — IN

1. `SUBCONTRACTOR_LABEL` SSOT + the four surfaces.
2. The source-guard test.

## Scope — OUT (own units)

- **U2 — DC-side de-ผู้รับเหมา.** `labor-cost-view` (`dc: "ผู้รับเหมา"`,
  `ผู้รับเหมา (DC)`), `/payroll` ("ค่าแรงผู้รับเหมา"), the DC-worker **parent picker**
  (`worker-roster-manager`, `workers/actions`, `group-workers` UNKNOWN label), the DC
  **portal** ("พอร์ทัลผู้รับเหมา"), and the role label `contractor: "ผู้รับเหมา (DC)"`
  all still call a DC "ผู้รับเหมา". Needs the operator's chosen DC-crew word (e.g.
  "ทีม DC" / "สังกัด DC") before relabeling. Own spec.
- **General-WP "ผู้รับเหมา"** — intentionally left generic (operator).

## Verify

- `pnpm lint && pnpm typecheck && pnpm test` — green (no DB change).
- Live: /settings shows "ผู้รับเหมาช่วง / DC"; /contacts/crews tab reads
  "ผู้รับเหมาช่วง"; the DC tab + subtypes unchanged.
