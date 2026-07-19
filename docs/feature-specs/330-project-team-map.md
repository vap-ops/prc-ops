# Spec 330 — Per-project team map (ทีมงานโครงการ)

- **Status:** DESIGN APPROVED (operator, in-chat 2026-07-19, via interactive
  phone + tablet prototypes) — U1 build authorized same session
- **Date:** 2026-07-19
- **Depends on:** spec 80 (project_members block), spec 292 U4 (primary SA),
  spec 279 (crews/crew_members schema — dormant), spec 328 (contractor firm
  teams + money wall), spec 306 (muster teams — adjacent, NOT managed here)
- **Related:** ADR 0080 (4-axis org model; Position axis P2 pending), spec 272
  (`projects.ht_worker_id` — grain superseded by this spec's per-team leads),
  nav doctrine (`docs/nav-coherence-audit-2026-07.md`)

## 0. Problem + users

Operator (super_admin): "I cannot manage teams in each project." Ground truth:
per-project people management is fragmented and partly invisible —

- **Staff membership** (`project_members`) is buried inside
  `/projects/:id/settings` behind the gear chip (spec 80 block), picker limited
  to `SITE_STAFF_ROLES`.
- **Crew workers** exist only on the global `/workers` roster; no per-project
  grouped view.
- **Contractor firm teams** (spec 328) are invisible per-project.
- **Persistent crew teams** don't exist in any UI at all — the spec-279
  `crews`/`crew_members` tables have 0 rows and no surface.

**Users:** PM-tier (`PM_ROLES`: project_manager, super_admin,
project_director) manage; the surface is their per-project people cockpit.

**Operator model correction (locked, 2026-07-19):** PRC crew can form
**multiple teams per project**, and **หัวหน้าช่าง (HT) is per team, not per
project**. `projects.ht_worker_id` (spec 272, single HT per project) is the
wrong grain going forward — see §6.

## 1. The map (core design)

One page `/projects/[projectId]/team` renders the project's people as a
**tiered org map**, top-down:

1. **ผู้บริหารโครงการ** — project lead (★ หัวหน้าโครงการ badge from
   `projects.project_lead_id`) + PM/PD members.
2. **หน้างาน** — site_admins (★ หลัก badge from `project_members.is_primary`),
   site_owner, auditor members.
3. **ทีมช่าง** — team cards, one per team, plus an unassigned pool:
   - **PRC teams** — one card per `crews` row (project-scoped). Card =
     team name, member count, collapsible member chips. **First chip = the
     team's lead** (★ หัวหน้าทีม, from `crews.lead_worker_id`).
   - **Firm teams (ผู้รับเหมา)** — one card per contractor having members on
     the project (`workers.contractor_id` grouping). Same card shape; subtitle
     carries the pay-exempt hint (เบิกจ่ายผ่านหัวหน้าทีม — spec 328 §2.4
     truth). Firm team lead v1 = none (contractor contact is the anchor).
   - **ยังไม่จัดทีม** — dashed card: project workers in no active crew and no
     firm.

Thin vertical connector lines join the tiers (pure CSS, no chart library).

**Crew show/hide (operator requirement):** every team card's member list is
collapsible (แสดง/ซ่อน per card) and a master toggle collapses/expands all.
**Counts stay visible when collapsed** — per-card member count and the tier
summary line (ทีมช่าง · รวม N คน · M ทีม) never hide.

**Position badges** render from live facts only: หัวหน้าโครงการ
(project_lead_id) · หลัก (is_primary) · หัวหน้าทีม (crews.lead_worker_id).
When the ADR 0080 P2 Position axis lands, badges re-source from it — the map's
shape doesn't change.

## 2. Responsive views (both approved via prototype)

One DOM, CSS breakpoints — no separate tablet page, no canvas/chart lib:

- **Phone (default):** tiers stack vertically, single column; team cards
  full-width; member chips wrap.
- **Tablet+ (`sm:`/`lg:`):** tiers become centered horizontal rows of cards;
  the ทีมช่าง tier becomes a responsive grid
  (`repeat(auto-fit, minmax(~300px, 1fr))`) of team cards side by side.

Field-first design system throughout (globals.css tokens, 44px tap floor,
`[touch-action:pan-x_pinch-zoom]` only if a row scrolls horizontally — none
planned).

## 3. Manage actions (tap → bottom sheet)

Form-placement doctrine: bottom sheet is the default. Tap any card/chip →
sheet with actions scoped to the node type:

| Node                   | Actions (v1)                                                                                      | Backing                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Staff member           | ถอดออกจากทีมโครงการ (last-member block + self-remove confirm via `evaluateMemberRemoval`)         | existing `removeProjectMember`                                                             |
| SA member              | + ตั้งเป็น SA หลัก                                                                                | existing `setPrimaryProjectFor`                                                            |
| PRC worker chip        | ตั้งเป็นหัวหน้าทีม · ย้ายทีม · ย้ายโครงการ · ดูข้อมูลช่าง (→ /workers)                            | U2 RPCs (`set_crew_lead`, `move/remove crew member`) + existing `assign_worker_to_project` |
| Firm worker chip       | ย้ายทีมผู้รับเหมา (→ /workers edit flow) · ดูข้อมูลช่าง                                           | existing #642 firm picker (link out v1)                                                    |
| Team card              | เปลี่ยนชื่อทีม · ยุบทีม (members → ยังไม่จัดทีม)                                                  | U2 RPCs                                                                                    |
| เพิ่มสมาชิก (page CTA) | เพิ่มพนักงาน (staff picker) · เพิ่มช่างเข้าโครงการ · ~~ตั้งทีม~~ · เปิด QR สมัครเข้าทีม (→ /team) | existing `addProjectMember`, `assignWorkerToProject`                                       |

**U5 amendment (operator, in-chat 2026-07-19 evening): ตั้งทีมใหม่ must NOT
hide behind เพิ่มสมาชิก.** It moves out of the add sheet to a visible action
button in the ทีมช่าง tier header (see §11). The add sheet keeps the staff
picker only. Per-tier header actions replace the single page-bottom CTA:
each staff tier header carries its own เพิ่มสมาชิก, the ทีมช่าง header
carries ตั้งทีมใหม่.

**Staff add picker widened** (from `SITE_STAFF_ROLES`) to the
membership-driven roles: project_manager, site_admin, **site_owner, auditor**
(+ PD/super as today). Live `can_see_project` runs on `project_members` for
exactly PM/SA/site_owner/auditor — adding one grants project visibility, which
is the feature, not a leak. Other roles (procurement, accounting, …) stay out:
membership is a no-op for them (their access is per-table role arms).

## 4. Access model

- **Page gate:** `requireRole(PM_ROLES)` — settings-page precedent. PM sees
  own projects (RLS scoping), super/PD all.
- **Reads:** session client for `project_members`, `workers`, `crews`,
  `crew_members` (RLS `can_see_project` arms; workers PII wall untouched —
  map uses only open columns: name/level/pay_type/contractor_id/project_id).
  Admin client seam ONLY for `users` names/roles of member ids (ADR 0011
  read-self; identical seam to the settings page today).
- **Writes:** existing server actions + U2 DEFINER RPCs (revoke-anon,
  fail-closed `is distinct from` per house pattern).
- **No money surface.** Crew chips are not payout pickers; the spec-328 §2.4
  money wall is untouched (firm workers stay pay-exempt everywhere).

## 5. Data model

**U1 = ZERO schema.** All reads on existing tables:
`project_members(user_id, project_id, is_primary, added_by, added_at)` ·
`workers` (open cols) · `crews(id, project_id, name, kind, lead_worker_id,
active, default_day_rate, created_by, created_at)` ·
`crew_members(id, crew_id, worker_id, added_by, added_at, removed_at)`.

**U2 = one additive migration** (schema lane; claim AFTER 329's `075816`):

- `add_worker_to_crew(p_crew, p_worker)` — insert crew_members; re-add after
  soft-remove = new row; a worker is in ≤1 active crew per project (enforced:
  adding moves them — closes the old membership with `removed_at`).
- `remove_worker_from_crew(p_crew, p_worker)` — set `removed_at` (soft,
  history preserved; NOT delete).
- `move_worker_between_crews(p_from, p_to, p_worker)` — compose of the above,
  single txn (this is the spec-279 U5 `move_crew_member` finally built).
- `set_crew_lead(p_crew, p_worker)` — lead must be an active member; also
  covers "change lead".
- `rename_crew(p_crew, p_name)` / `dissolve_crew(p_crew)` — dissolve sets
  `active=false` + closes memberships.
- All PM-tier gated (caller role checked in-RPC, fail-closed), `revoke ...
from anon` inline, pgTAP RED-first.

⚠ **Verified-live gotcha:** the existing `add_crew_member` RPC is a
DIFFERENT DOMAIN (subcontract member intake — `p_subcontract`, national-id
args). It does NOT write `crew_members`. U2 names avoid the collision
(`add_worker_to_crew`). `create_crew(p_project, p_name, p_lead_worker,
p_kind, p_default_day_rate)` IS the right RPC and is reused as-is (U2 must
verify its caller gate + anon lock before wiring).

## 6. `projects.ht_worker_id` interplay (grain superseded)

Spec 272's single project-HT field remains live (promote flow on /workers,
หัวหน้าช่างของโครงการนี้ block). This spec's model makes HT **per team**
(`crews.lead_worker_id`). v1 posture:

- The map does NOT render `ht_worker_id` as a tier node; team leads are the
  truth it shows.
- The field, its promote flow, and any consumers stay untouched in v1.
- **Operator decision deferred:** retire `ht_worker_id` (migrate to a
  one-team-per-project lead), or keep as "chief HT" display. Parked with the
  ADR 0080 P2 Position-axis spec, which planned to generalize this exact
  field.

## 7. Muster synergy (later, not v1)

Persistent teams are the natural pre-fill for the spec-306 morning muster
team forming (its deferred plan-pre-fill item): open-team defaults = active
crews + leads. Deliberately NOT in this spec's units — muster stays
scan-is-truth. Noted so U2's RPC shapes don't preclude it (they don't:
muster reads crews at open time, no FK needed).

## 8. Nav

- **Door:** ทีมงาน on the project cockpit — 📍 project-scope door class
  (ต้นทุนโครงการ #618 precedent).
- **Back:** DetailHeader → project cockpit; `?from` threading honored
  (multi-parent doctrine #610) — /team hub row (U4) links with
  `from=/team`.
- **Settings ทีมงาน block:** stays in place during U1 (dual surface);
  **U4 retires it** from `/projects/:id/settings` once the map's staff manage
  is proven (settings keeps the 4 config blocks; the placement guard pins only
  those, verified).
- `/team` hub gains a per-project ทีมงานโครงการ row (U4).

## 9. Units

| Unit | Scope                                                                                                                                                 | Lane                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| U1   | Map page (all tiers READ, toggles + sums) + staff manage sheet (add/remove/set-primary over existing actions, widened picker) + cockpit door + guards | code-only, auto-merge          |
| U2   | Crew RPC migration (§5) + pgTAP                                                                                                                       | additive mig, self-merge grant |
| U3   | Crew manage UI: ตั้งทีม, membership add/move/remove, set lead, rename/dissolve — wires U2                                                             | code-only                      |
| U4   | Firms polish (firm cards link-outs), /team hub row, settings-block retire, `?from` threading sweep                                                    | code-only                      |
| U5   | Map-look redesign (§11): tier containers + connectors + role icons + ⓘ role explainers + per-tier header actions (ตั้งทีมใหม่ un-buried)              | code-only, auto-merge          |
| U6   | WP↔team assignment (§12): crewless-WP tray + tap-tap placing + per-chip ย้าย/เอาออก + วันนี้/พรุ่งนี้ toggle, over EXISTING daily-plan RPCs           | code-only, auto-merge          |

**U4 is PARKED pending the pilot (operator, 2026-07-19).** U5/U6 were
approved via three in-chat interactive mockups the same evening and slot
ahead of it.

Each unit shippable alone; map degrades gracefully (no crews → workers all in
ยังไม่จัดทีม pool; that IS the current prod truth: crews has 0 rows).

## 10. Tests + guards (pre-empt the trip map)

- Pure builder `buildProjectTeamMap(members, users, workers, crews,
crewMembers, project)` → tier/team/pool structure — unit-tested RED-first
  (org-chart.ts precedent).
- RTL: toggle behavior (collapse keeps counts), sheet actions per node type,
  staff picker role filter.
- Guard updates expected: `feature-components-structure` allowlist
  (+`team-map`), nav-back auto-classify (dynamic segment → DetailHeader
  detail), site-map doc, settings-sections untouched, config-placement
  untouched (verified — pins only the 4 config blocks).
- SSR probe as super_admin + view-as PM on the live project before ship
  (dev-preview login recipe).

## 11. U5 — map-look redesign (approved via mockups, 2026-07-19 evening)

Operator: "map is still not perceived as map." The tiers must read as an org
chart at a glance — containers, structure lines, faces — not stacked lists.

- **Tier containers.** Each tier renders inside a bordered, rounded container
  (`border-edge` + `bg-sunk`-family tokens ONLY — the design-doctrine guard
  bans raw Tailwind palette, so the mockups' purple/teal tints land as
  border/weight/icon hierarchy, not color ramps). Container header row =
  tier icon + label + counts + ⓘ + the tier's own action button.
- **Per-tier header actions.** ผู้บริหารโครงการ and หน้างาน headers each get
  เพิ่มสมาชิก (opens the existing add-staff sheet); ทีมช่าง header gets
  **ตั้งทีมใหม่** (opens the existing createCrew sheet). The page-bottom
  เพิ่มสมาชิก CTA is removed. All new header buttons are SIBLINGS in the
  header flex row — never wrapping the existing master toggle.
- **Connectors.** A centered vertical trunk between tier containers on `sm:`
  (today's `border-l` stub, strengthened), plus a horizontal rail with two
  drops above the ทีมช่าง grid. Pure CSS.
- **Role icons.** Staff rows gain a leading avatar circle with a lucide icon
  per role: star (project lead), briefcase (PM/PD), settings (super_admin),
  clipboard-list (site_admin), key-round (site_owner), eye (auditor). Icon map
  lives beside the view (presentational, exhaustive over the tier buckets).
- **ⓘ role explainers.** Each tier header's ⓘ opens a BottomSheet (new
  `info` member of the SheetState union) with short Thai explanations of the
  tier's roles. Copy lives in `src/lib/help/team-map-roles.ts` (spec-314
  PayModelExplainer precedent — help content stays out of money/label SSOTs).
- **HT affordance.** A crew card whose lead is unset renders a dashed
  "ยังไม่ตั้งหัวหน้าทีม — แตะเพื่อเลือก" row; tapping it expands the member
  list (the lead is then set by tapping a member chip, exactly the existing
  flow). A set lead renders as the existing ★ first chip, restyled as an
  emphasized band.
- One DOM, `sm:` only (no new breakpoints); phone keeps the vertical stack
  inside the same containers.

## 12. U6 — WP↔team assignment (approved via interactive mockup, 2026-07-19)

The map shows and edits **which team works which WP on a day**, at team
grain, over the EXISTING daily-plan machinery (ADR 0076 seed-only per-item
worker rows; no team FK, NO schema change).

- **Data.** For the selected date: `daily_work_plans(project, date)` →
  `daily_work_plan_items`(WP) → `daily_work_plan_crew`(workers). All three
  are RLS-readable via `can_see_project`. A NEW read-only loader
  (`src/lib/work-plans/day-assignments.ts` + page.tsx wiring) assembles:
  - **tray** = items with ZERO crew rows (planned-but-unassigned), and
  - **per-team chips** = items whose crew overlaps the team's active members.
    `build-team-map.ts` / `load-team-map.ts` are NOT touched (danger-held).
- **Date toggle.** วันนี้ / พรุ่งนี้ (`bangkokTodayIso` / `addDaysIso`),
  default วันนี้. Assignment writes target the selected day's board.
- **Assign (tap-tap, not drag).** Tap a tray chip → placing mode: `kind:
"crew"` cards ONLY light up as dashed targets (firm/pool are NEVER targets
  — spec 328 §2.4; crews are contractor-free by mig 075818, and the
  expansion filters `contractorId === null` belt-and-braces). Tap a team →
  `setDailyPlanItemCrew(item, team's member workerIds, lead = the isTeamLead
member ?? null)`. Teams without a lead accept work.
- **Modify.** Tap an assigned chip → sheet: ย้ายไปทีมอื่น (re-place; full
  replace with the target team's set) · เอาออกจากทีม (crew := empty; item
  returns to the tray, WP stays on the board) · เปิดหน้างาน (→ WP detail).
  **Mixed-item lockout:** if the item's current crew is NOT a subset of the
  card's team members (an SA hand-tuned a per-worker set on /sa/plan), the
  sheet offers NO team-grain writes — only "งานนี้จัดคนรายบุคคลไว้ —
  แก้ที่แผนงาน" with a link. The map must never clobber worker-grain edits.
- **Add to plan.** เพิ่มงานเข้าแผน opens a picker (leaf WPs only,
  `is_group=false`, status ≠ complete — `add_daily_plan_item` hard-rejects
  groups) → `addDailyPlanItem` → the item lands in the tray.
- **Writes reuse `src/app/sa/plan/actions.ts` verbatim** — zero new
  write-path code. Their hardcoded `revalidatePath("/sa/plan")` is fine: the
  map routes every write through `run()`, whose `router.refresh()` re-renders
  the team page. Non-atomic add→assign (two RPCs) is acceptable: add is
  idempotent, a mid-sequence failure leaves a crewless tray item (retry-safe).
- **Grain contract.** Map = team-grain; /sa/plan = worker-grain; same truth
  (`daily_work_plan_crew`), last writer wins, and the mixed-item lockout
  keeps the map from overwriting finer-grained knowledge. Muster remains the
  attendance truth; the plan is intent.
