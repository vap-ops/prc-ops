# Spec 102 — Procurement depth, Unit 2: read-only project visibility

**Status:** COMPLETE (2026-06-15; **SCHEMA** — one RLS migration, operator-gated db:push;
acceptance = procurement-user phone pass).
**Driver:** the second half of "procurement role depth" (operator chose "both"; spec 101 was Unit 1).

## Why

Procurement processes purchases against project/WP context but couldn't browse projects at all
(`projects` SELECT excluded it; /projects + /projects/[id] gated to site staff). This gives procurement
**read-only** project visibility — the project list + each project's WP list (names + status) — without
any capture, money, or write surface.

## Decisions

- **Read-only, purpose-built.** Procurement does NOT get the SA/PM worklist (its rows are
  capture-links with SA-oriented action verbs like "take photos", and they navigate to the
  capture-heavy WP detail). Instead procurement gets a simple read-only WP list (name + code + status
  pill, no links). An **early return** in the project page renders this — the SA/PM path below is
  byte-unchanged (zero regression).
- **Capture stays out.** WP detail (`/projects/[id]/work-packages/[id]`) and the schedule stay
  `SITE_STAFF_ROLES` — procurement bounces from them. No capture, no reports/gear/schedule chips, no
  ⓘ info sheet (its data is partly money/PII-adjacent), no bank.
- **Minimal RLS.** One `ALTER POLICY` adds procurement to the `projects` SELECT policy only;
  INSERT/UPDATE stay super_admin. `work_packages` SELECT already admits procurement (spec 70).

## What ships

- **Migration `20260630000000_projects_select_procurement.sql`** — `ALTER POLICY "projects readable by
privileged roles"` adds `procurement` (keeps the policy name + the eval-once `(select …)` wrapped
  form, so policies_are + eval-once anti-drift stay green). No schema/type change → db:types unaffected.
- **pgTAP `07-projects.test.sql`** — +1 (plan 31→32): seed a procurement user, assert it now SELECTs
  projects (E.5). The visitor-sees-nothing + super/site/pm assertions are unchanged.
- **`role-home.ts`** — `PROJECT_VIEW_ROLES` = site staff + procurement (gates the project-browse
  surfaces only; members match PURCHASING_ROLES today but the meaning differs).
- **`/projects/page.tsx`** — gate → PROJECT_VIEW_ROLES; procurement gets kicker `จัดซื้อ` +
  PROCUREMENT_HUB_NAV. (Client-name fetch gracefully empty for procurement — clients SELECT excludes
  it.)
- **`/projects/[projectId]/page.tsx`** — gate → PROJECT_VIEW_ROLES; `ctx.role === "procurement"`
  early-returns a read-only WP list (slim header, back→/projects). SA/PM render untouched.
- **Nav** — `PROCUREMENT_TABS` + `PROCUREMENT_HUB_NAV` gain `โครงการ` (→ /projects). Procurement bar
  is now 4 tabs (คำขอซื้อ · โครงการ · ผู้ขาย · ตั้งค่า).

## Tests

- pgTAP 07 procurement SELECT (above) — runs under the db:push gate (db:test).
- `bottom-tab-bar.test.tsx` + `hub-nav.test.tsx` — pins updated for the โครงการ entry.
- Pages = verified-by-checklist (the RLS change is pgTAP-tested; the read-only render is presentational).

## Procurement depth — COMPLETE

Unit 1 (spec 101, suppliers + nav) + Unit 2 (this) close the "both" request. Procurement now:
worklist (process purchases) · read-only projects/WPs (context) · suppliers master · settings.

## Seams (recorded)

- Procurement read-only list is flat (no deliverable grouping / progress) — a later refinement.
- Procurement still can't open WP detail or schedule (deliberate — capture/timeline are site-staff).
- `/projects/[id]` for procurement shows no ⓘ project-info sheet (client/lead/team) — kept out to
  avoid leaking partly-sensitive context; revisit if procurement needs the client name.
