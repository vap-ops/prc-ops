# Spec 94 — Detail info sheet: slim the headers, move context into an ⓘ bottom sheet

## Problem

The operator (2026-06-15): _"general information section is too large, can we put it
on information page? like project info, wp info."_

The sticky detail headers carry a **context-metadata block** below the nameplate:

- **Project page** (`/projects/[projectId]`) — a `<dl>` of up to five rows:
  ลูกค้า (client) · ผู้รับผิดชอบ (lead) · ทีมงาน (team) · ประเภท (type) · ที่ตั้ง (site
  address). On a real project that is a tall block, and the header is `sticky`
  (spec 62/64) — so it eats vertical space _on every scroll position_, pushing
  รายการงาน down.
- **WP page** (`/projects/[projectId]/work-packages/[workPackageId]`) — the
  ผู้รับเหมา (contractor) line + the reassign trigger.

The fix the operator chose (AskUserQuestion, 2026-06-15): a **bottom sheet** (the
most native option; reuses the spec-78 `BottomSheet` primitive) opened by an **ⓘ
chip** in the header. Applies to **both** the project and WP detail headers.

## Decision

Slim each detail header to **identity only**, and move the context metadata into a
bottom sheet behind an ⓘ chip in the header `actions` slot.

- **Project header** keeps: code line + name (`h1`). Sheet **ข้อมูลโครงการ** carries
  the five-row `<dl>`.
- **WP header** keeps: code line + name (`DETAIL_TITLE`, never truncate — WP-centric
  principle) + status pill. Sheet **ข้อมูลงาน** carries the contractor block
  (ผู้รับเหมา display + the reassign panel) and the read-only รายละเอียดงาน
  (description), relocated from the body's ข้อมูลงาน zone.

This is a **pure UI relocation** — no DB change, no schema, no new route. The
header chrome (`DetailHeader`, spec 63) is untouched; the new info button rides its
existing `actions` slot.

## Scope (exactly this)

1. **`ProjectInfoButton`** — new client component
   (`src/components/features/project-info-button.tsx`). Renders an ⓘ
   `ICON_CHIP_MUTED` chip; on tap opens a `BottomSheet` titled **ข้อมูลโครงการ**
   containing the `<dl>` (client / lead / team / type / site), each row rendered
   only when its value is present. Props are plain serializable data:
   `clientName`, `leadName`, `memberNames: string[]`, `typeLabel`, `siteAddress`
   (all nullable except the array). Owns its own open state (the `BottomSheet`
   caller-owns-state contract).

2. **`WorkPackageInfoButton`** — new client component
   (`src/components/features/work-package-info-button.tsx`). Renders an ⓘ
   `ICON_CHIP_MUTED` chip; on tap opens a `BottomSheet` titled **ข้อมูลงาน**
   containing:
   - the contractor block: ผู้รับเหมา name + a `tel:` phone link when present;
     when `isAssigner` and a contractor is assigned, the existing
     `WpAssignmentPanel` (reassign) renders inside the sheet (its own มอบหมายงาน
     trigger opens a nested sheet — accepted; both close on `router.refresh`).
   - รายละเอียดงาน (description) when present, `whitespace-pre-wrap`.

   Props: `contractor: { name, phone } | null`, `description: string | null`,
   `isAssigner: boolean`, and the `WpAssignmentPanel` props
   (`projectId`, `workPackageId`, `contractors`, `contractorId`).

3. **Project page** (`src/app/projects/[projectId]/page.tsx`) — remove the `<dl>`
   from the `DetailHeader` children (header now = code + `h1` only); prepend a
   `<ProjectInfoButton …>` to the `actions` slot, **before** the schedule chip,
   visible to all staff. Render the chip only when at least one of the five values
   is present (mirrors the old `<dl>` render guard).

4. **WP page** (`…/work-packages/[workPackageId]/page.tsx`) — remove the
   contractor block from the `DetailHeader` children (header now = code +
   `DETAIL_TITLE` + status pill); pass `actions={<WorkPackageInfoButton …>}`.
   Remove the body's `รายละเอียดงาน` `<details>` (now in the sheet). Render the
   chip only when a contractor is assigned **or** a description exists.

5. **Tests (path b — relocation, behaviour-pinned):**
   - `tests/unit/project-info-button.test.tsx` — ⓘ trigger present; the `<dl>`
     values are NOT in the document before open; clicking the chip reveals
     client/lead/team/type/site.
   - `tests/unit/work-package-info-button.test.tsx` — ⓘ trigger present; before
     open the contractor name / description are absent; after open they show, and
     the reassign trigger (มอบหมายงาน) is present when `isAssigner` + assigned.

## Out of scope / preserved

- The **unassigned** amber `AttentionCard` (ต้องมอบหมายผู้รับเหมา…) with its own
  assign panel **stays in the body** — the "must assign before work" prompt must
  not be buried behind a tap.
- WP **notes** (the editable backup-capture field, notes-everywhere program) stay
  in the body's ข้อมูลงาน zone — frequently used, not buried.
- The **PM review** WP page (`/review/work-packages/[workPackageId]`) is a separate
  surface — **recorded seam**, not touched this unit. If the operator wants the
  same treatment there, it's a one-component follow-up.
- No status-icon work, no DB, no route.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; both new tests pass.
- [ ] `pnpm build` green.
- [ ] Project header: code + name only; ⓘ chip opens ข้อมูลโครงการ with the five rows.
- [ ] WP header: code + name + status pill only; ⓘ chip opens ข้อมูลงาน with
      contractor + description; reassign works from inside the sheet.
- [ ] Unassigned WP still shows the amber assign prompt in the body.
- [ ] Acceptance = operator phone (PM/SA-gated routes; preview env only renders /login).
