# Spec 313 — Holistic nav-map redesign (domain hubs + /team)

**Status:** Design approved by operator 2026-07-13 (chat session). Implementation not started.
**Origin:** Operator directive 2026-07-13 — "I propose เช็คชื่อ be in ทีมงาน. Bottom-nav โครงการ shows WP list without having to pick a project, since SA can only belong to one project at a time. While we are working on the navigation, let's redesign nav map in a new session." Operator subsequently chose the **full restructure** over consolidate-in-place, design-first.
**Approach:** Full restructure of internal nav chrome around five domains, including the `/team` hub merge. External islands untouched.

---

## 1. Context and evidence

A full parallel audit of the current nav (2026-07-13, main `5f910d7a`/0.68.0, 101 routes, all 17 roles) found:

1. **เช็คชื่อ buried.** The scan-muster cockpit (`/projects/[projectId]/muster`, spec 306 U3) has exactly one navigational entry: a CTA on the project cockpit (`src/app/projects/[projectId]/page.tsx`). No entry from the SA home, tiles, or any team surface — despite attendance being the adoption bet.
2. **Wasted tap for the SA.** โครงการ tab → `/projects` hub → tap the only project → WP list. The spec-292 current-project resolver (`src/lib/sa/current-project.server.ts`: query → override cookie → pinned primary → newest membership) already computes the target.
3. **ทีมงาน label collision.** Three destinations share the label: `/workers` (PM/procurement roster + wages), `/sa/crew` (SA crew), and the WP labor-log tab/chip (`#wp-labor`). Violates nav law rule 7 (one term per concept).
4. **Two unmerged attendance flows.** Plan-based mark-present (MusterStrip on `/sa`, `log_labor_day` — feeds wages today) vs the spec-306 scan cockpit (muster\_\* tables — money derivation waits on 306 U5). The SA help card documents only the old plan flow.
5. **Functional dead ends.** `site_owner` and `auditor` are in `OFFICE_EXPENSE_ROLES` (spec 310) but land on the static `/coming-soon` wall with no tabs — they cannot reach `/expenses` at all.
6. **Pseudo-homes.** `/accounting` and `/legal` are role homes that render `DetailHeader` with a back chip → `/settings` — a "home" with a back button to a place the user never came from.
7. **Guard coverage holes.** `LEGAL_TABS`, `LEGAL_HUB_NAV`, and `COORDINATOR_HUB_NAV` item sets are not pinned by any test.
8. **Tab-ceiling breach.** `PROCUREMENT_MANAGER_TABS` has 7 items; nav law rule 1 set the ceiling at 6.

(Adversarial review 2026-07-13 confirmed all of the above against live code; a suspected `/coming-soon` stale-bounce item was refuted — already fixed by the 2026-07-11 site-map re-audit #444, `coming-soon-router.test.ts` pins it. `docs/site-map.md` still carries the stale self-note; the §8 re-audit clears it.)

## 2. Operator decisions (2026-07-13, all locked)

| #   | Question          | Decision                                                                                                                                                                                                        |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Scope             | Internal chrome + dead-end fixes. External islands (portal / client / technician) untouched.                                                                                                                    |
| D2  | ทีมงาน prominence | First-class SA bottom tab; เช็คชื่อ is its top CTA.                                                                                                                                                             |
| D3  | โครงการ tab (SA)  | Always lands on the current project's WP list when the resolver yields a project (even with 2+ visible; primary/override wins). Zero projects → `/projects` hub.                                                |
| D4  | Label split       | ทีมงาน = crew/team surface only. `/workers` nav items → **รายชื่อช่าง**. WP labor tab + home chip → **แรงงาน**.                                                                                                 |
| D5  | Approach          | Full restructure (operator overrode the consolidate-in-place recommendation), design-first. Includes the `/team` merge, คำขอสมัคร fold, and รายงาน tab demotion — approved explicitly with those flags visible. |

## 3. The model — five domains

Every internal role's nav is a selection from the same five domains; no per-role improvisation:

| Domain        | Surface                 | Contains                                                                               |
| ------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| หน้าหลัก      | role home (action feed) | today's actions, rework, issues                                                        |
| โครงการ (งาน) | `/projects` tree        | WPs, schedule, store, ของเข้า, muster cockpit                                          |
| ทีมงาน (คน)   | **`/team` — new hub**   | เช็คชื่อ, crew pipeline, badges, add-ช่าง, คำขอสมัคร queue, รายชื่อช่าง + ค่าแรง links |
| จัดซื้อ (ของ) | `/requests` tree        | PRs, POs, รายงาน, ผู้ขาย                                                               |
| ตั้งค่า       | `/settings`             | reference data + account (nav law rule 8, unchanged)                                   |

Money surfaces (ภาพรวม `/dashboard`, บัญชี `/accounting`) remain role-specific tabs — money visibility never generalizes.

## 4. Per-role map (target state)

| Role                                       | Home                 | Bottom tabs (changes in bold)                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| site_admin                                 | `/sa`                | หน้าหลัก · **โครงการ → current project** · **ทีมงาน `/team`** · จัดซื้อ · ตั้งค่า (5)                                                                                                                                                                         |
| PM / PD / super_admin                      | `/dashboard`         | โครงการ · **ทีมงาน `/team`** · จัดซื้อ · ภาพรวม · ตั้งค่า (5) — **คำขอสมัคร tab removed**; queue + count badge live as a `/team` section                                                                                                                      |
| procurement                                | `/requests`          | จัดซื้อ · โครงการ · **ทีมงาน `/team`** · ผู้ขาย · ค่าแรง · ตั้งค่า (6) — **รายงาน tab removed**; a **NEW** in-page link on `/requests` is added in the same unit (none exists today — without it `/requests/reports` + `/requests/orders` are phone-orphaned) |
| procurement_manager                        | `/requests`          | same as procurement (6) — คำขอสมัคร folds into `/team`; fixes the 7-tab ceiling breach                                                                                                                                                                        |
| project_coordinator                        | `/projects`          | โครงการ · ตั้งค่า (unchanged)                                                                                                                                                                                                                                 |
| accounting                                 | `/accounting`        | บัญชี · ตั้งค่า (tabs unchanged; home becomes a true hub — see §8)                                                                                                                                                                                            |
| legal                                      | `/legal`             | กฎหมาย · ตั้งค่า (same treatment)                                                                                                                                                                                                                             |
| **site_owner / auditor**                   | **`/expenses`**      | **ค่าใช้จ่าย · ตั้งค่า** (new 2-tab sets; unblocks their spec-310 rights)                                                                                                                                                                                     |
| hr / subcon_manager                        | `/coming-soon`       | none — no surface exists; the wall stays but its bounce is fixed (§8)                                                                                                                                                                                         |
| visitor / technician / contractor / client | unchanged (D1 scope) | —                                                                                                                                                                                                                                                             |

Hub strips (`*_HUB_NAV`) mirror every tab change (nav law rule 2 — strip ⊇ tabs). The PM strip's ทีมงาน item retargets `/workers` → `/team`; procurement strips likewise, keeping รายชื่อช่าง (`/workers`) as a strip-only superset item.

## 5. `/team` — the people hub

One content-named route (spec-82 law: the URL names what is shown, never the role). Role-aware sections, top to bottom:

1. **เช็คชื่อ CTA** — site_admin + super_admin, targets `musterHref(currentProject)`. The cockpit itself **stays at `/projects/[projectId]/muster`** (its data grain is the project); `/team` is its front door. The project cockpit keeps a secondary เช็คชื่อ chip (duplication is legal, nav law rule 4).
2. **Crew pipeline** (รอตรวจ → รอยืนยัน → พร้อม), **ทีมหน้างาน board**, **เพิ่มช่างใหม่ sheet**, **พิมพ์บัตรช่าง (QR)** — absorbed from `/sa/crew`. `/sa/crew` and `/sa/crew/badges` become redirects to `/team` and `/team/badges` (kept ≥ 1 release). The ทีมงาน tile leaves `SaTools` (the tab supersedes it; no orphan — rule 4 satisfied by the tab).
3. **คำขอสมัคร queue section + count nudge** — `STAFF_APPROVAL_ROLES` only (site_admin is NOT a member — the approver queue section is hidden from it). The SA's read-only `/sa/registrations` nudge **stays on the `/sa` home**; it does not migrate — the SA's pending registrations already surface on `/team` via the crew pipeline's รอตรวจ bucket, so no orphan (rule 4). Route `/registrations` survives unchanged as the approver drill-down.
4. **รายชื่อช่าง** (`/workers`) and **ค่าแรง** (`/payroll`) — drill-down links for back-office roles. URLs, gates, RLS, and money posture all unchanged.

Access: union of today's audiences — site_admin (crew sections) + `WORKER_ROSTER_ROLES` (roster/onboarding sections) + `STAFF_APPROVAL_ROLES` (queue section). Section visibility is role-gated inside the page; the page gate is the union. Whether the union becomes a named set in `role-home.ts` (danger-path, held PR) or a call-site composition of the existing exported sets (auto-mergeable) is a plan decision — the membership is identical either way. No new RLS: `/team` reads only what its embedded sections already read today.

## 6. โครงการ direct landing (SA)

The SA's โครงการ tab keeps its static `/projects` href; the **`/projects` page itself server-redirects** (RSC `redirect()`, no client hop) when ALL of: caller is site_admin, the spec-292 resolver yields a current project, and no explicit hub request (`?view=all`) is present. Zero visible projects → hub with empty state. PM, procurement, and coordinator never redirect. One touch point; the alternative (per-render resolved tab href) was rejected — the tab bar renders on every page, so it would prop-drill the resolver through ~100 routes.

**Loop-proofing (adversarial-review finding):** every SA path back INTO the hub must carry `view=all`, or the redirect re-fires and the SA can never see the project list:

- The cockpit back-chip fallback changes from bare `/projects` to `/projects?view=all` (`safeBackHref` fallback in `src/app/projects/[projectId]/page.tsx`).
- The hub's own filter/search links (`projectListHref`) must preserve `view=all`, otherwise the first filter tap re-redirects.
- Any other hard-coded `/projects` link an SA can reach gets the same treatment (sweep in the unit).

## 7. Attendance unification (phased — honest about the money gate)

Target: the scan cockpit is THE attendance surface. **The plan-based MusterStrip / มาทำ flow retires only when 306 U5 (derive → labor_logs, money, operator-held) ships.** Until then both flows coexist untouched — MusterStrip feeds wages today and this spec does not touch any money path. In this spec: the SA help card (`src/lib/sa/help-content.ts` id `muster`) is rewritten to document both flows honestly (scan เช็คชื่อ at `/team` → cockpit; plan มาทำ on the home until U5).

## 8. Hygiene fixes (bundled deliberately — same law, same unit family)

- **Labels (D4):** hub-strip + settings items for `/workers` → รายชื่อช่าง; WP detail labor tab + SA home ActionChip → แรงงาน; ทีมงาน reserved for `/team`. All via `labels.ts` SSOT (rule 7).
- **Hub promotion:** `/accounting` and `/legal` drop `DetailHeader`, render `HubNav`, reclassify hub in the nav-back-affordance guard. Same treatment for `/expenses` (it becomes site_owner/auditor's home; PM-tier keeps reaching it from ตั้งค่า — `SETTINGS_TAB.match` gains `/expenses` for those roles).
- **`/coming-soon` bounce** delegates to `roleHome()` (kills the stale site_admin→/projects, pm→/review mapping).
- **Guard pinning:** add the missing assertions for `LEGAL_TABS`, `LEGAL_HUB_NAV`, `COORDINATOR_HUB_NAV`, and the new tab sets.
- **Docs:** full `site-map.md` re-audit (route tables, roleHome table, bottom-tab sets, Back→ columns) + `ui-conventions.md` §12 refresh — same-unit binding per those docs' contracts.

## 9. Non-goals

- No route re-homing beyond `/sa/crew*` → `/team*`. `/workers`, `/payroll`, `/registrations`, `/requests/reports`, the muster cockpit, and every project sub-route keep their URLs (zero notification-deep-link risk; the only built deep-link targets projects).
- No money-path change (MusterStrip, `log_labor_day`, payroll, GL all untouched).
- No external-island changes (portal / client / technician) — D1.
- No new homes for hr / subcon_manager (no surface exists to point at; revisit when one does).
- No settings-hub restructure (rule 8 already governs it).

## 10. Impact map (what the guards will demand)

From the guard audit — every item below is a known, deliberate update, not a surprise:

- `tests/unit/bottom-tab-bar.test.tsx` — re-pin all changed tab sets (labels, hrefs, order, lighting incl. who lights on `/requests/orders` + `/requests/reports` after the รายงาน demotion); add LEGAL_TABS + new site_owner/auditor sets.
- `tests/unit/hub-nav.test.tsx` — re-pin changed strips; add LEGAL_HUB_NAV + COORDINATOR_HUB_NAV set pins.
- `tests/unit/role-home.test.ts` — site_owner/auditor → `/expenses` in BOTH assertion blocks: the byte-identical table AND the separate "sends still-unserved roles to /coming-soon" test (they'd leave that list).
- `tests/unit/sa-tools.test.tsx` — pins the ทีมงาน tile → `/sa/crew`; update when the tile leaves SaTools.
- `tests/unit/nav-back-affordance.test.ts` — `/team` (+ `/team/badges`) classified; `/accounting`, `/legal`, `/expenses` re-bucketed detail→hub; `/sa/crew*` rows removed; HUB_STRIP_ROUTES additions.
- `src/app/projects/[projectId]/page.tsx` — back-chip fallback → `/projects?view=all` (§6 loop-proofing); `src/app/requests/page.tsx` — the NEW รายงาน in-page link + a pin for it.
- `tests/unit/settings-sections.test.ts` + `settings-hub-render.test.ts` — if any settings row moves.
- `tests/unit/feature-components-structure.test.ts` — add a `team` domain to ALLOWED_DOMAINS **only if** `src/components/features/team/` gains ≥1 real component (the test also asserts the folder is non-empty); pure composition of existing components needs no entry.
- `tests/unit/ui-class-contracts.test.tsx` — any new horizontal-scroll nav row needs the `[touch-action:pan-x_pinch-zoom]` pair.
- **Danger path:** `role-home.ts` is under `src/lib/auth/**` — those PRs are guard-HELD for operator merge by design. Plan for held PRs, never touch the deny regex.
- Preserve: PWA logout lives only on `/profile` (app-header hides logout in standalone mode) — no change to that affordance.

## 11. Phasing (unit families for the implementation plan)

- **P1 — the new map:** `/team` hub + `/sa/crew*` redirects · SA/PM/procurement tab + strip rebuilds · คำขอสมัคร fold · รายงาน demotion (in-page link) · โครงการ direct landing · D4 labels. Code-only; auto-merges except any unit that adds a named role set to role-home.ts (held).
- **P2 — homes:** site_owner/auditor → `/expenses` (roleHome change — HELD PR) · accounting/legal/expenses hub promotion · `/coming-soon` bounce fix · guard pinning · site-map + §12 re-audit.
- **P3 — attendance cutover:** blocked on 306 U5. Only the help-card honesty rewrite ships now (P1).

Detailed unit breakdown: `docs/feature-specs/313-nav-redesign-plan.md` (written next, via the planning pass).

## 12. Acceptance (spec-level)

1. SA phone bar shows 5 tabs incl. ทีมงาน; tapping ทีมงาน → `/team` with เช็คชื่อ CTA on top; tapping โครงการ lands on the current project's WP list in one tap (resolver rules of D3).
2. PM/procurement_manager reach the คำขอสมัคร queue from `/team` in ≤ 2 taps, with the pending count visible on `/team` (an improvement — today's tab carries no count badge).
3. `/sa/crew` and `/sa/crew/badges` redirect to `/team` / `/team/badges`.
4. site_owner and auditor land on `/expenses` and can record an office expense with zero URL typing.
5. `/accounting`, `/legal`, `/expenses` render hub chrome (strip, no back chip); accounting/legal users see no behavior loss.
6. No route named in §9 non-goals changes its URL; `pnpm test` green with every §10 guard updated deliberately (no guard weakened).
7. The word ทีมงาน appears in nav chrome only for `/team`; รายชื่อช่าง and แรงงาน label their respective surfaces (labels.ts single-sourced).
