# Spec 406 — ผังทักษะรายสายงาน (skill map per trade) — S1: designer, worker view, baseline

**Status:** 2026-08-08 — DRAFT, awaiting operator review. No units started. Lane `skillmap`
(docs-only for this spec PR). **U1 will need the schema lane + a danger-path migration PR** —
claim at build time, re-query the migration head at apply time. **U2 touches
`src/lib/auth/role-home.ts` (a shared SSOT) ⇒ that unit cannot run in a parallel code-only lane.**

**Operator ask (2026-08-08, verbatim):**

> We need to enable pd users to design skill map, per trait. grill me, tablet first, consult
> claude design. visualize

Follow-ups in the same exchange: _"we will track their learning materials, tests, working
hours"_ · _"all three, materials can be embedded from other sources like youtube"_ ·
_"per-trade, pay also per trade. working on trades that user is not an expert in will not be
paid an expert level"_ · _"we plan to conduct tests 3 times a year, but maybe more or less"_ ·
_"test rounds also has MCQ, not just practical"_ · _"some trades will have more levels than
others, PD needs CRUD for that too"_ · _"look up curriculums in Thailand"_. "trait" was a
mistype for **trade**.

End-state walkthrough (four surfaces + the loop, reviewed by the operator):
<https://claude.ai/code/artifact/37341d81-b5f6-4f39-9348-95a3a2b443bd>

---

## 1. Why — both existing skill axes are dead, and the trade axis this needs does not exist yet

Measured live 2026-08-08, this session, and re-verified by the fact-checker:

| Probe                                                | Result                      |
| ---------------------------------------------------- | --------------------------- |
| `users` with role `project_director`                 | **3**                       |
| Active `workers` (`workers.active`, not `is_active`) | **51** (53 total)           |
| Active workers with `workers.level` set              | **0**                       |
| `worker_trades` rows                                 | **0** today                 |
| Active workers portal-bound (`user_id` not null)     | 13 — all role `technician`  |
| `users` with role `technician`                       | 14                          |
| Active workers `pay_type = 'daily'`                  | 50 · ฿412–670, avg **฿481** |
| `labor_logs`                                         | **0** rows org-wide         |

⚠️ **`worker_trades` was not untouched — it was smoke-tested and cleared.** `audit_log` holds 4
`trades_change` events on 2026-07-21 (`{"primary":"W05","categories":["W01","W05"]}` cleared 51
seconds later; `{"primary":"W02",…}` cleared 1 second later), both by `super_admin`. So the
honest statement is _written twice in testing and cleared, never adopted_ — the dead-axis
conclusion holds, the word "ever" does not.

Why the axes died: `workers.level` is `set_worker_level`-only (super_admin, `42501` otherwise;
`workers` carries **no UPDATE policy at all**, so there is no direct write path) with **no
defined criteria** — nobody could defend กลาง vs ต้น, so nobody assessed. And `worker_trades`
asked a ช่าง to tag himself with a **construction phase**, which is not how a craftsman
identifies (§2).

Amortisation check (the spec-392 lesson): a rubric is org-level and serves every project
forever, so the dead neighbours' zeros measured acts with no reuse and do not veto this. The
risk that DOES carry is spec 377's — an authoring editor whose readers never shipped
(`wp_briefs` 0, `wp_brief_versions` 0, **and zero matching `audit_log` events**, i.e. genuinely
never used). Mitigation is structural: **the worker-facing read surface is U3 of this same
spec, not a follow-up.**

## 2. The trade axis — `work_categories` is a WBS taxonomy and cannot serve

The first draft of this spec ruled "trade = `work_categories` W01–W11, no new taxonomy." The
fact-checker refuted it and the live rows settle it:

- `work_categories` holds **54 active rows** — 11 with `char_length(code) = 3` plus 43
  sub-rows. There is **no `parent_id`**; top-level is identified only by code length, a
  convention `set_worker_trades` hardcodes (its own comment says "W01–W09", already stale).
- The 11 top-level rows are **construction phases**: งานเตรียมการ & รื้อถอน · งานโครงสร้าง ·
  งานสถาปัตยกรรม · งานระบบประปา & สุขาภิบาล · งานระบบไฟฟ้า & สื่อสาร · งานระบบปรับอากาศ &
  ระบายอากาศ · งานป้าย · งานภายนอก & ผังบริเวณ · งานครุภัณฑ์ & งานเพิ่มเติม · งานอื่นๆ ·
  งานระบบความปลอดภัย.
- The sub-rows are **project line items**, not crafts: `W0210 เหล็กโครงสร้าง ROOF GUTTER /
SIDING FRAME 1, 2`, `W0209 เหล็กโครงสร้างหลังคา ห้องโหลดสินค้า`.

So เหล็ก and แบบหล่อ — the operator's own pilot — have **no row to attach to at either level**.
A ladder for งานโครงสร้าง would blend rebar, formwork and concrete into one rung set, which is
the opposite of what per-trade pay is for.

### 2.1 Thailand's national standards supply the missing axis

Operator instruction: _"look up curriculums in Thailand."_ Two national systems exist and both
name trades as **crafts**:

**DSD — กรมพัฒนาฝีมือแรงงาน, มาตรฐานฝีมือแรงงานแห่งชาติ.** Construction trades at **ระดับ 1–3**,
with wage rates per trade per level **published by law** (ประกาศคณะกรรมการค่าจ้าง):

| สาขา                                | ระดับ 1 | ระดับ 2 | ระดับ 3 |
| ----------------------------------- | ------: | ------: | ------: |
| ช่างก่ออิฐ                          |     410 |     530 |     645 |
| ช่างฉาบปูน                          |     455 |     565 |     675 |
| ช่างไม้ก่อสร้าง                     |     445 |     595 |     685 |
| ช่างปูกระเบื้องผนังและพื้น          |     485 |     580 |     685 |
| ช่างสีอาคาร                         |     500 |     640 |       — |
| ช่างติดตั้งยิปซัม                   |     485 |     595 |       — |
| ช่างก่อและติดตั้งคอนกรีตมวลเบา      |     510 |     625 |       — |
| ช่างอะลูมิเนียมก่อสร้าง             |     435 |     545 |     650 |
| ช่างมุงหลังคากระเบื้องคอนกรีต       |     470 |     590 |     685 |
| ช่างหินขัด                          |     470 |       — |       — |
| ช่างฉาบยิปซัม                       |     470 |       — |       — |
| ช่างเขียนแบบก่อสร้างด้วยคอมพิวเตอร์ |     690 |       — |       — |

**TPQI — สถาบันคุณวุฒิวิชาชีพ.** Competency-unit based (หน่วยสมรรถนะ), ระดับ 1–8. **อาชีพ
ช่างเหล็กเสริมคอนกรีต** (the rebar pilot) exists here at ระดับ 3 and 4 — ระดับ 4 requires
ระดับ 3 **plus ≥1 year experience**, i.e. hours-as-a-floor is their pattern too.

Three things this grounding buys, none of them cosmetic:

1. **The operator's "some trades have more levels" is the national structure**, not a
   preference — ช่างหินขัด has one level, ช่างก่ออิฐ has three. Per-trade level rows (§2 ruling 3) are now externally justified.
2. **The test format was independently arrived at**: DSD ระดับ 1 = a 50-question 4-choice MCQ,
   60 minutes, **plus a practical**. Exactly rulings 5–7.
3. **S4 becomes alignment, not invention.** PRC pays ฿412–670 (avg ฿481) against a schedule
   whose ระดับ 1 floor is ~410 and ระดับ 3 reaches ~685 — the ladder maps onto money the firm
   already pays.

Sources: <https://www.dsd.go.th/standard> ·
<https://www.tpqi.go.th/qualification-and-occupation/occupational-standard/> ·
<https://www.tpqi.go.th/qualification-and-occupation/dsd-standard/> ·
wage schedule <https://www.jorporhnoy.com/6701-wageskill/>. ⚠️ These figures are the ประกาศ
edition current at the 2026-08-08 lookup — **re-check the live ประกาศ before U1 seeds them**,
and treat any seeded rate as reference data the PD may override, never as a fetched value.

## 3. Rulings — SETTLED with the operator 2026-08-08, do not re-litigate

1. **Trade = a NEW craft taxonomy** (`trades`), PD-owned master data — ช่างเหล็กเสริมคอนกรีต,
   ช่างไม้ก่อสร้าง/แบบหล่อ, ช่างก่ออิฐ, ช่างฉาบปูน, … **Seeded from the DSD/TPQI construction
   trades with their real level structure; PD adds PRC-specific trades and edits freely.**
   External anchor where one exists, no cage. `work_categories` keeps its WBS job untouched.
2. **Map = rubric**: skills grouped under levels, per trade.
3. **Levels are per-trade ROWS, not the `worker_level` enum** — some trades run 1 level, some 3+.
   The `worker_level` enum and its wiring (`worker_level_rates` 4 rows, `set_worker_level`,
   `labor_logs.level_snapshot`, `wp_labor_costs`, Nova dial weights in `src/lib/nova/dials.ts`)
   stays untouched legacy until S4.
4. **A level carries `reference_day_rate`** — the national figure, **display only**, shown to PD
   while designing and on the promotion board. Writes nothing to payroll before S4.
5. **Three evidence pillars**: learning materials (external embeds — YouTube etc., no hosting) ·
   tests (MCQ) · working hours in the trade.
6. **Test rounds (รอบสอบ), ~3×/year, cadence flexible** — a round is a ROW someone opens, not a
   schema constant. **The round banks BOTH kinds of evidence**: the scored MCQ (sat proctored)
   and the practical. Portal MCQ between rounds is **practice only** — shows readiness, banks
   nothing.
7. **Same question pool, random draw** — one bank per skill; the round sitting draws a random
   shuffled subset.
8. **Practical verifiers**: หัวหน้าช่าง for own crew + `site_admin` for anyone on site. Nobody
   verifies themselves — an HT's own skills go to SA or PD. Verifier recorded on every mark.
9. **Progress auto-derives → promotion is a RECOMMENDATION → PD taps confirm** (audit-logged),
   batched at rounds. That tap is the only writer of a worker's level.
10. **Level per trade AND pay per trade** — a worker doing a trade they are not expert in is not
    paid expert rate. Pay wiring is **S4, last, own ADR, operator-gated**.
11. **Cold start = PD baseline**: one-time calibration sets each worker's trades + starting level
    directly, no evidence required, audit-logged as ประเมินตั้งต้น. New hires start at the
    bottom rung and climb.
12. **Draft → publish versions**: PD edits a draft freely; workers see the last PUBLISHED
    version. Evidence is append-only — it never deletes, it may stop counting.
13. **Failed practical**: default next round; PD may open an ad-hoc re-test for named
    workers/skills (audit-logged escape valve).
14. **Everyone in `workers` climbs** — DC/subcon-linked included. Whose PAY follows level is an
    S4 ruling, not an S1 exclusion.
15. **Pilot content = ช่างเหล็กเสริมคอนกรีต (+ ช่างไม้ก่อสร้าง/แบบหล่อ)**; the designer supports
    every trade; unpublished trades show ผังกำลังออกแบบ. Baseline covers ALL trades/workers.
16. **MCQ + practical per skill**: each skill declares which it needs; hours are a floor per
    trade-level, never per skill.
17. **Tablet-first authoring**; workers consume on phone.

Agent-set defaults, operator-visible and vetoable at this review:

- A new PRC-specific trade seeds one level; a nationally-anchored trade seeds its real levels.
- A level workers hold cannot be deleted — deactivate, or re-baseline the holders first.
  Rename/reorder/insert-between always free.
- A round pins the published version at open; mid-round publishes don't shift requirements.
- Baseline grants everything below: a worker baselined ระดับ 2 shows level 1 as granted; the
  evidence machinery applies climbing UP only.
- Untagged workers surface to PD as ยังไม่ระบุสายงาน (the hire-flow trade field is a follow-up
  unit, not S1).
- Hours count all attributable recorded history, not from feature launch (S3).
- MCQ pass threshold default 80%, PD-adjustable per test; practice unlimited.
- External certificates (an actual หนังสือรับรองมาตรฐานฝีมือแรงงาน a worker already holds) are a
  FUTURE evidence kind — named non-goal, and an obvious S3+ candidate given §2.1.

## 4. Scope — S1 (this spec) vs later specs

**S1:** schema core (U1) · PD rubric designer with trade + level CRUD and draft/publish (U2) ·
worker read-only map in the technician app (U3) · baseline calibration pass (U4).

**S2:** materials completion tracking + practice MCQ (authoring, taking, instant score). Zero
evidence writes — deliberately low-risk.

**S3:** test rounds (open/close, proctored MCQ scoring, practical marks, confirm board) +
hours-per-trade derivation + notifications. Opens with the §7 gate-check. Delivery-layer health
(LINE quota, outbox failure rate) is part of that spec.

**S4 + ADR:** pay follows the trade worked that day at the worker's level in that trade,
referenced against the ประกาศคณะกรรมการค่าจ้าง schedule. Touches wage derivation and the DC
day-rate model — operator-gated, last.

## 5. Data model (U1)

Posture, on every new table: default privileges on this database grant `anon` **and**
`authenticated` `arwdDxtm` — **every** privilege including INSERT/UPDATE/DELETE, and functions
default-grant EXECUTE to both. So each table gets `revoke all … from public, anon,
authenticated;` **before** any grant, reads via RLS `select` grants only, **all writes through
SECURITY DEFINER RPCs** (`revoke all on function … from public, anon`) gated `project_director`

- `super_admin`. Four-posture pgTAP pins per table; enum values pinned.

* **`trades`** — the craft axis. `id`, `code text` (PRC-local), `name_th text`,
  `national_source trade_national_source null` (enum: `dsd | tpqi`), `national_name_th text
null`, `sort_order int`, `is_active bool`, timestamps, `created_by`.
* **`trade_levels`** — the ladder. `id`, `trade_id` FK → `trades`, `name_th text`, `rank int`
  (1 = bottom), `min_hours numeric not null default 0`, `reference_day_rate numeric null`
  (ruling 4), `is_active bool`, timestamps, `created_by`. Unique `(trade_id, rank)` and
  `(trade_id, name_th)` among active rows.
* **`trade_skills`** — the rubric atoms (TPQI's หน่วยสมรรถนะ in shape). `id`, `trade_id` FK,
  `trade_level_id` FK, `title_th`, `detail_th null`, `requires_mcq bool`, `requires_practical
bool`, `sort_order int`, `is_active bool`, timestamps, `created_by`.
* **`skill_materials`** — embeds. `id`, `trade_skill_id` FK, `kind skill_material_kind` (enum:
  `youtube | link`), `url text`, `title_th`, `sort_order int`, `is_active bool`.
* **`skill_map_publishes`** — version rows (the spec-377 publish pattern). `id`, `trade_id` FK,
  `version int` unique per trade, `snapshot jsonb` (the frozen read model), `published_by`,
  `published_at`. The authoring rows stay the draft SSOT; the snapshot is a read artifact.
* **`worker_trade_levels`** — append-only level history. `id`, `worker_id` FK, `trade_id` FK,
  `trade_level_id` FK, `kind worker_trade_level_kind` (enum: `baseline | promotion |
adjustment`), `note_th text null` (required for `adjustment`), `decided_by`, `created_at`.
  Current level = latest row per (worker, trade). No UPDATE/DELETE path; corrections are new
  `adjustment` rows. Every write also inserts `audit_log`.
* **Evidence tables are NOT in S1** — they arrive with the surfaces that write them (S2 is
  write-free; S3 owns every evidence write).

⚠️ **`worker_trades` is NOT reused and NOT written by this spec.** It FKs `work_categories`
(WBS) and its existing writer `set_worker_trades(p_worker, p_categories, p_primary)` is
**PM-admitted** (`project_manager`, `super_admin`, `project_director` — wider than this spec's
PD gate) and does a **full `delete … where worker_id = p_worker` then re-insert**. Routing
baseline through it would let a PM silently wipe trade assignments that `worker_trade_levels`
rows point at. The craft axis is separate data with its own table; the WBS tagging surface is
left exactly as it is.

RPCs (all DEFINER, PD-gated, audit-logged): `upsert_trade`, `retire_trade`, `upsert_trade_level`,
`retire_trade_level` (refuses while active holders exist), `reorder_trade_levels`,
`upsert_trade_skill`, `retire_trade_skill`, `upsert_skill_material`, `publish_skill_map` (stamps
version + snapshot), `set_worker_trade_level` (baseline / adjustment; `note_th` required for
adjustment).

## 6. Surfaces

- **U2 — designer** at `/skills/design` (route verified free: no `src/app/**/skill*`). Page-gated
  by a **NEW named role-set constant** in `src/lib/auth/role-home.ts` — deliberately not reusing
  `CLIENT_ISSUER_ROLES`, whose members coincide but whose meaning is client-login issuance. PD's
  home `/dashboard` (`roleHome` → `isManagerRole` → PM_ROLES, which includes `project_director`)
  gains the door in the same unit — a correct surface on a page nobody opens is unshipped.
  Tablet-first: trade rail + level columns + skill cards + `+ เพิ่มระดับ`; `@container` declared
  **on the component**, not on callers (spec 404 U2b); ฉบับร่าง chip; publish stamps the version.
- **U3 — worker view** in the **technician app** (`roleHome("technician")` → `/technician`;
  ⚠️ `/portal` is the CONTRACTOR segment and is the wrong home — all 13 portal-bound workers are
  role `technician`). Shows current level, next level's skills with requirement chips, the hour
  floor (value "—" until S3), granted-below rendering, and ผังกำลังออกแบบ for unpublished trades.
  Reads the latest publish snapshot. Phone-first.
- **U4 — baseline board**: roster × trade × starting level, PD-only, writes via
  `set_worker_trade_level`. Shows the ยังไม่ระบุสายงาน remainder until it reaches zero.

Copy rules that bind: a shared string prescribes no actor; a control names only acts its target
offers in **every** state it can be opened in; refusal copy derives from the offending value; a
Thai term used in 2+ places goes to `labels.ts`.

## 7. Non-goals (v1)

Coverage/gap views for PD · notifications (S3) · externally-held certificates as evidence · any
change to `workers.level`, `worker_level_rates`, `set_worker_level`, `labor_logs.level_snapshot`,
`wp_labor_costs`, Nova dials, `day_rate`, or wage derivation · **any write to `worker_trades`** ·
evidence writes of any kind · the hire-flow trade field · client/guest visibility.

## 8. Risks, named

1. **377 repeat** — mitigated: U3 ships in this spec; S2 and S3 each ship reader + writer
   together.
2. **Hours attribution is worse than the first draft assumed.** The daily-work-plan path is
   **dead**: `daily_work_plans` 5 rows, `daily_work_plan_crew` **0 rows**. The real path is
   `muster_attendance → muster_teams → muster_team_wps → work_packages.category_id →
project_categories.work_category_id → work_categories` — note the **two hops**
   (`work_packages.category_id` FKs `project_categories`, NOT `work_categories`). Fill rates:
   the WP→phase half is healthy (**1290/1307 = 98.7%** of WPs carry a category; 31/31
   project_categories map to a top-level work_category) but the **worker-day→WP half is 13%**
   (36/268 attendance rows; `muster_team_wps` has 5 rows against 45 `muster_teams`). **And that
   only yields a PHASE, not a craft** — so S3's gate-check has two questions, not one: can a
   worker-day reach a WP at all, and can a phase be resolved to a trade (candidate: a
   trade→phase mapping, or trade declared on the muster team). If either fails, S3 ships
   hours-less and the decision returns to the operator. The design survives it.
3. **13/51 portal-bound** — the ladder (and later pay) is the binding incentive; rounds double
   as binding drives. Technicians are already the most reachable cohort.
4. **Two level vocabularies coexist until S4** — every S1 surface must read ONLY `trade_levels` /
   `worker_trade_levels`, never `workers.level`. Pin with a source guard on the new surfaces.
5. **National figures drift** — the ประกาศ is reissued; §2.1's numbers are a 2026-08-08 lookup.
   `reference_day_rate` is PD-editable seeded data, never a live fetch, and the seed migration
   must say which edition it came from.
6. **Schema break ejects the merge queue** — U1's pgTAP asserts seeded rows by property, never a
   global count over an operator-editable table.

## 9. Verification checklist (per unit, on top of the standard gates)

- **U1:** four-posture pgTAP per table (`authenticated` may SELECT; may not INSERT/UPDATE/DELETE;
  `anon` may not SELECT) · RPC refusal probes as non-PD roles, asserting SQLSTATE **and message**
  · `retire_trade_level` refuses while a holder exists (fixture proves it) · publish snapshot
  round-trips the draft · `worker_trades` untouched (row count unchanged across the unit).
- **U2:** real browser at tablet widths, sampling **between** crossing points not at the
  comfortable ends · level CRUD + reorder + publish driven for real · draft invisible to a
  technician session · the new role-set constant pinned by an exhaustive-domain test (positive
  set EXACTLY {project_director, super_admin} over the full `user_role` enum).
- **U3:** technician login sees published maps only · granted-below rendering for a baselined
  worker · the empty state names the cause the reader can act on.
- **U4:** baseline writes the level event + `audit_log` in one transaction · adjustment requires
  a note · **acceptance = the §1 table re-run**: `worker_trade_levels` rows per worker, and the
  ยังไม่ระบุสายงาน remainder, measured after the operator's real pass. ⚠️ Roster reads filter
  `workers.active` — there is no `is_active` column (`42703`).
