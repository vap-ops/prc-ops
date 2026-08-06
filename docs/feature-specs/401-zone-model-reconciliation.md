# 401 — Zone model reconciliation (366 ⇄ 392)

**Status:** SPEC — operator-decided 2026-08-06, not yet built.
**Supersedes the MODEL of:** [366](366-wp-zones.md) (never built) and the WP↔zone half of [392](392-project-zone-maps.md).
**Owner:** CC · **Created:** 2026-08-06

> ⚠️ **Ref discipline.** Every "shipped" statement below is relative to `origin/main` at **`751d612f` (release 0.345.4)**. Spec 392's **U2b (the Konva editor) is NOT on main** — it is [PR #995](https://github.com/vap-ops/prc-ops/pull/995), open and held on the danger-path guard for its `package.json` dependency add. So `canvas-geometry.ts`, `canvas-state.ts` and the canvas components **do not exist on main today**, and neither does `konva` in `package.json`. This spec is written to be built AFTER #995 lands; where that matters it says so.

---

## 1. Why this spec exists

Two specs describe zones. Neither is wrong; they answer different questions, and **392 never referenced 366** — zero occurrences of `366`, `wp_zones` or `project_drawings` anywhere in it (verified by grep). Worse, 392 U1 shipped a table that takes 366's name (`project_zones`), so the collision is now in the database.

|              | **366** — _"photos that know where they were taken"_                | **392** — as shipped                                       |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Drawing      | `project_drawings` + a private bucket                               | `project_zone_maps.background_path` (bucket never created) |
| Shape        | `polygon` jsonb                                                     | `shape` enum + `geometry` jsonb — a **superset**           |
| WP ↔ zone    | **`wp_zones` M:N** — a WP references the zones it covers            | `work_packages.zone_id` — **one zone per WP**              |
| Photo ↔ zone | **`photo_logs.zone_id`**, set at capture, sticky per session        | none                                                       |
| Purpose      | **evidence** — prove a `หลัง` photo is the same place as its `ก่อน` | **tracking** — rollup and filter                           |

The operator re-raised 366's model on 2026-08-06, unprompted, while 392 U2b was in review: _"zones must be clickable, assisting SA in uploading during and after images in the respected zones"_, and when asked where a zone tap should land, _"zones live under WPs"_.

**The collision has to be resolved either way.** Two models cannot both own `project_zones`; the only question was which relationship survives.

### 1.1 The case, measured 2026-08-06 — and one claim retired

⚠️ **A draft of this spec argued that `mismatch` rejections had "tripled, 4 → 14" and that this proved the problem was getting worse. That is FALSE and is recorded here so it is not re-derived.** The fact-check refuted it:

```
mismatch rejections by day:  2026-07-27 → 7 · 2026-07-28 → 6 · 2026-08-03 → 1
```

Thirteen of the fourteen landed in **one 48-hour review burst** in late July; **one** has occurred in the nine days since. 366's "4" was a mid-day read of a day that ended at 7 — so the two figures were never comparable, and the rate is **flat-to-falling, not rising**. Compounding it, `revision_reason` only began accruing when spec 355 shipped on 07-24, so setting a 3-day-old counter against an all-time photo count manufactures a trend out of two different accrual windows.

**What the evidence actually supports** (live, 2026-08-06):

|                                              |                                                             |
| -------------------------------------------- | ----------------------------------------------------------- |
| `photo_logs`                                 | **2,960**, of which **2,225 in the last 30 days**           |
| WPs carrying photos                          | **269** — averaging **11.0** photos each, **max 86**        |
| `needs_revision` total / of which `mismatch` | **68 / 14** — real, demonstrated, bursty, currently quiet   |
| `project_zones` / `project_zone_maps`        | **0 / 1** — one map created by the operator, no zones drawn |
| `work_packages.zone_id` filled               | **0 of 1,307**                                              |

The honest argument is **organisational, not remedial**: an 86-photo work package holds roughly twenty `ระหว่างทำ` shots on a single axis (`phase` + rework round) with no way to say which part of the work each one shows. `mismatch` proves the failure mode is **real and can spike 13 times in two days** — it does not prove a rising trend, and this spec does not claim one. The 40%-fill acceptance bar in §6 is what will decide whether the fix is worth its authoring cost.

**Zero adoption of 392's axis is what makes the model change free**, not a verdict on 392: `work_packages.zone_id` is 0 of 1,307, and the editor that would let anyone fill it is still unmerged.

### 1.2 What is NOT in question

392's geometry work stands and is reused: `project_zone_maps`, `project_zones` (whose `shape` + `geometry` + `parent_zone_id` are a strict superset of 366's `polygon`), the `[0,1]` normalisation, the zone list, and — once #995 lands — the Konva editor. **This spec changes what a zone BINDS TO, and nothing about what a zone IS.**

Of 392's five DEFINER RPCs, **four are untouched** (`save_project_zone_map`, `upsert_project_zone`, `delete_project_zone`, `clone_project_zones`). The fifth, `set_wp_zone`, writes the column being dropped and is retired in U2 — see §4.

---

## 2. The decision

**A work package covers many zones. `wp_zones` is the single source of truth. `work_packages.zone_id` is dropped.**

Operator-decided 2026-08-06 from three options. The rejected alternative worth recording: keep `zone_id` as the WP's "primary zone" and add `wp_zones` alongside. It preserves every shipped surface and keeps the rollup arithmetic simpler — but **งานพื้นลาน spanning four yards has no non-arbitrary main zone**, and a field someone must fill arbitrarily will be filled arbitrarily. Two sources of truth for one relationship is the more expensive mistake.

Dropping costs **nothing in data** (0 of 1,307 rows). Everything it costs is code, paid once, before anyone authors a zone.

### 2.1 The rollup arithmetic — stated precisely

`src/lib/zones/zone-rollup.ts` states two rules in its header: **only leaves count**, and **the remainder is reported** (`unzoned`). ⚠️ It does **not** state a `zoned + unzoned = total` equation, and an earlier draft of this spec wrongly quoted one.

Two things are nonetheless true and must be handled:

1. **M:N makes cells overlap.** A WP bound to two zones counts in both, so per-cell sums exceed the project's leaf count. Same class as the dashboard returns double-count (`prc-ops-dashboard-spend-model`).
2. **The grid is already not a clean partition.** `zone-rollup.ts:100` filters out leaves whose `zoneId` names a zone the reader cannot see, so an RLS-invisible zone silently removes its work from the grid **today**. The fix must not be sold as "restoring" a cleanliness that never existed.

**Therefore:** cells count **work packages that touch this zone**, the column header says so, and the grid reports **`overlap`** (WPs bound to 2+ zones) and **`hidden`** (leaves whose zones the reader cannot see) as their own figures beside `unzoned`. Only `distinct(zoned) + unzoned + hidden = total` holds, and the surface states it rather than implying a partition. A zone map is about areas, and real work spans areas.

---

## 3. Model

All additive except the one drop.

```
project_zone_maps          project_zones                     wp_zones
──────────────────         ─────────────────────             ─────────────────
id                         id                                work_package_id ─┐
project_id ──┐             map_id ────────────┐              zone_id ─────────┼─→ project_zones
name         │             project_id         │              (composite PK)   │
background_path            code · name        │                               │
sheet_code   │             shape · geometry   │              photo_logs.zone_id
sheet_rev    │             parent_zone_id     │                nullable FK ────┘
sort_order   │             sort_order
             └─→ projects

                           work_packages.zone_id  ⛔ DROPPED (U3)
```

**`wp_zones`** — `work_package_id` → `work_packages` · `zone_id` → `project_zones` · composite PK · `created_by` · `created_at`.

⚠️ **Group WPs: a deliberate change, not an oversight.** `photo_logs_reject_group_wp` means a photo can never bind to a งาน (group) row, so a zone on a group can never be reached by a photo — 366 §3 open question 5 defaulted to leaf-only for that reason. **But `set_wp_zone` has no group check today and `work-packages/[workPackageId]/page.tsx` renders the zone chip on the group detail**, whose own comment says a group's zone would otherwise be "written and never readable". Making `wp_zones` leaf-only therefore **removes a shipped affordance**: a group WP goes permanently chip-less. U4 must either (a) accept that and say so at the group surface, or (b) allow group bindings as a pure resolution rule for children. **Recommendation: (a)** — the evidence axis is leaf-grained because photos are, and a group chip that no photo can ever use is decoration. Recorded so the U4 author decides it rather than discovers it.

**`photo_logs.zone_id`** — nullable FK, **set at capture and never updated**. Verified live 2026-08-06: `photo_logs_block_update` and `photo_logs_block_delete` both fire `photo_logs_block_write()`, so a correction goes through the existing supersede path (a new row pointing at the old via `superseded_by`), never an UPDATE.

ⓘ **`photo_logs_spec248_guard` is NOT a hazard here** — checked, not assumed. Its body branches only on `new.answers_photo_id is not null` and `new.superseded_by is not null`, so adding `zone_id` to the insert payload cannot trip it. (An earlier draft warned that it could; that warning was hypothetical and is withdrawn.)

**Drawings bucket** — still does not exist (`storage.buckets` has 13, none of them drawings). 392 declared `project_zone_maps.background_path` and never created one; its fill is **0**. One private bucket, its `storage.objects` policies written and pgTAP-pinned in the same unit, delegating to the same role helper rather than restating its members (the `catalog-images` lesson, #823). Thai zone names need the ASCII key sanitiser (`supabase-storage-key-ascii`).

### 3.0 🔔 Nesting × M:N — THREE OPERATOR QUESTIONS, owed before U4

**Nesting and the junction are each specced; their INTERACTION is not.** Both halves are live-verified 2026-08-06 and the whole area is latent — `project_zones` holds **2 rows, 0 of them nested**, and `work_packages.zone_id` is **0 of 1,307**. Recorded here so U1/U4 meet a decision instead of discovering one.

**What nesting already has:** `parent_zone_id uuid NULL` → `project_zones(id) ON DELETE SET NULL` · CHECK `project_zones_no_self_parent` (blocks `parent = id` only) · `upsert_project_zone`'s `p_parent_zone_id` · a read side that is genuinely careful — `zone-list.ts` indents by depth, degrades a parent it cannot resolve to top level (RLS may hide it; absence ≠ deletion), and an `emitted` set makes the walk terminate on a cycle · `zone-rollup-grid.tsx` indents children and prints an own-work-only note **only when nesting exists**, so today's flat case carries no copy.

**What it does not have:** no way to NEST (zero `parent` matches in the zones UI — RPC-only) · no way to UN-NEST (#988 coalesces `parent_zone_id`, so null means _leave alone_) · **no cycle guard anywhere** — verified absent in constraints, triggers AND the RPC, so `A → B → A` is reachable · no ruling on aggregation. ⓘ A cross-map parent is NOT a hole: `authenticated` holds neither INSERT nor UPDATE on the table, so `upsert_project_zone` is the only writer and its body checks the parent against `map_id`.

| Q      | Question                                                               | Today                                                                                                    | Whose call                                                  |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **N1** | A WP bound to child `A1` — does it appear under parent `อาคาร A`?      | **No.** A parent's numbers are its OWN directly-placed work (`zone-rollup-grid.tsx` says so and defers). | U4 — but it changes the zone LIST too                       |
| **N2** | May a WP bind to BOTH a parent and its descendant?                     | Nothing stops it once `wp_zones` exists; any subtree rollup would then **count it twice**.               | ruling needed                                               |
| **N3** | Should `add_wp_zone` REJECT an ancestor+descendant pair at write time? | n/a — the RPC does not exist yet.                                                                        | **U1 if N2 is "no"** — cheap now, expensive once rows exist |

⭐ **The prior question, and it collapses all three: is nesting REAL?** The operator's stated need — zones clickable, the SA uploading ก่อน/หลัง photos into the right zone — is served completely by FLAT zones. Nesting today is speculative capability with no UI, no un-nest and no cycle guard, and it is the sole reason N1–N3 are hard. **If the answer is "no nesting", U4 simplifies, the rollup stays a clean grid, and N3 costs nothing.** If it is "yes", **N3 must be answered in U1**, because the first ancestor+descendant pair a user creates is data someone has to clean up. ⚠️ Do not let U1 silently settle this by omission — an unconstrained `add_wp_zone` IS the answer "yes, both, double-counted".

### 3.1 Gates — and a correction to 392

Writes delegate to `is_manager(current_user_role())` (live membership: `project_manager`, `super_admin`, `project_director`, coalesce-hardened) plus `can_see_project`, both raising `42501`. The role array is never restated.

⚠️ **`can_see_project`'s live arms**, read 2026-08-06:

| arm  | roles                                                                           | result                 |
| ---- | ------------------------------------------------------------------------------- | ---------------------- |
| 1    | `super_admin`, `project_coordinator`, `project_director`, `procurement_manager` | true outright          |
| 2    | `project_manager`, **`site_admin`**, `site_owner`, `auditor`                    | membership / lead test |
| else | everything else, **including `technician`**                                     | false                  |

**This corrects 392 §4.1**, which claims "the field roles that already open a WP can see its zone without a new door". That is true for `site_admin` — arm 2, and 5 of 6 SAs hold a `project_members` row, so **the SA's zone picker can read through table RLS**. It is **false for `technician`**: 14 users, 1 with a membership row, and no arm admits the role, so ช่าง reach WP surfaces through DEFINER RPCs only. ⚠️ An earlier draft of this spec conflated the two and claimed the SA needed an RPC; it does not.

**Binding rule for U5/U6:** any zone surface shown to `technician` goes through a DEFINER RPC. A zone surface for `site_admin` may use table RLS. ✅ 392 §4.1 was corrected in-repo 2026-08-06 (#995 having landed); it now carries this correction and points back here.

---

## 4. What this changes in already-shipped code

Every path below is on `origin/main` today. §4's earlier draft said "four read surfaces"; the real inventory is **five reader modules, two page call sites, and six test files**.

| Path                                                                  | Today                                                                      | After                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| `src/lib/projects/load-detail.ts` (4 refs)                            | selects `zone_id`                                                          | joins `wp_zones`                           |
| `src/app/projects/[projectId]/page.tsx` (2 call sites)                | passes `zoneId` to the rollup                                              | passes zone id **sets**                    |
| `src/app/projects/[projectId]/work-package-list.tsx`                  | `zone_id` filter                                                           | `exists (… wp_zones …)`                    |
| `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx` | embeds `project_zones ( code, name )`; **renders on the group branch too** | 0..n chips; group branch per §3            |
| `src/components/features/zones/wp-zone-chip.tsx`                      | one zone                                                                   | 0..n                                       |
| `src/components/features/zones/zone-rollup-grid.tsx`                  | cells + `unzoned`                                                          | + `overlap`, + `hidden` (§2.1)             |
| `src/lib/zones/zone-rollup.ts` · `zone-filter.ts`                     | keyed on `zoneId`                                                          | keyed on the junction                      |
| `set_wp_zone` RPC                                                     | writes the column                                                          | retired → `add_wp_zone` / `remove_wp_zone` |

**Tests that must move in the same units** (none of them optional — U3's drop reds CI otherwise): `zone-read-surfaces.test.ts`, `zone-rollup.test.ts`, `zone-rollup-grid.test.tsx`, `zone-filter.test.ts`, `wp-zone-chip.test.tsx`, `work-package-list-zone-filter.test.tsx`, plus the pgTAP suite `supabase/tests/database/392-project-zone-maps.test.sql` and the generated `src/lib/db/database.types.ts`.

🚨 **CORRECTED 2026-08-06 — this section previously said "two assertions" in that pgTAP file. Counted directly, it is TEN, plus `select plan(37)` itself:** `has_column` for `zone_id` · two `has_column_privilege` pins (SELECT allowed, UPDATE denied) · **two `set_wp_zone` membership assertions inside the five-RPC arrays, one of them a `count(*) = 5`** · `has_function_privilege('anon', 'set_wp_zone(uuid, uuid)')` · and four behavioural blocks that call `set_wp_zone` or read `zone_id` back off `work_packages`. ⚠️ **`has_column_privilege` / `has_function_privilege` against a dropped object ERRORS rather than returning false**, so U3 cannot just watch these turn red — they must be removed as part of the drop. ⭐ The wrong figure came from re-running an inherited count instead of re-deriving it, which is the same trap §1.1 records.

Untouched: `validate-zone.ts`, `zone-list.ts`, the four surviving RPCs, and — once #995 lands — `canvas-geometry.ts`, `canvas-state.ts` and the canvas components. None of them knows what a zone binds to.

---

## 5. Units

| U      | Ships                                                                                                                                                                     | Schema?                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **U1** | `wp_zones` + `photo_logs.zone_id` + RLS + `add_wp_zone`/`remove_wp_zone` + pgTAP (gate refusals with a positive control; the leaf-only rule; the append-only interaction) | **yes** — schema lane   |
| **U2** | Move every reader in §4 onto the junction; `overlap` + `hidden` in the rollup; retire `set_wp_zone` and **all ten** of its pgTAP assertions (§4)                          | no                      |
| **U3** | ⛔ **DROP `work_packages.zone_id`** + regenerate `database.types.ts` — destructive, `break-glass.md` Procedure B, operator-held                                           | **yes** — only after U2 |
| **U4** | PM binds zones to WPs (366 U2's authoring surface) + the group-WP ruling from §3                                                                                          | no                      |
| **U5** | SA capture: sticky zone chips above the shutter, always optional (366 D4/D5)                                                                                              | no                      |
| **U6** | Gallery grouped by zone + tap-a-polygon-to-filter — **the payoff**                                                                                                        | no                      |
| **U7** | The `project-drawings` bucket + background image on the map (392's deferred U2c)                                                                                          | **yes**                 |

**Order: U1 → U2 → U3 → U4 → U5 → U6.** U3 after U2 or the shipped surfaces break; U5 is worthless before U4 (nothing to pick); U6 before U5 (nothing bound).

⚠️ **U1 depends on #995 only for the editor**, not for the schema — U1 can start as soon as the schema lane is free. ⚠️ **U5 must not touch the shutter path's latency or layout**: 2,225 photos rode it in the last 30 days, the app's single most-used interaction.

---

## 6. Acceptance

Measured two weeks after U5 reaches the field. **Re-measure; every figure in this spec is live as of 2026-08-06 and drifts within the day.**

```sql
-- the bar: zone fill on new photos, by project, since U5
select p.code, count(*) photos, count(pl.zone_id) with_zone,
       round(100.0 * count(pl.zone_id) / nullif(count(*),0), 1) pct
  from public.photo_logs pl
  join public.work_packages wp on wp.id = pl.work_package_id
  join public.projects p       on p.id  = wp.project_id
 where pl.created_at > '<U5 deploy date>'
   and exists (select 1 from public.wp_zones z where z.work_package_id = wp.id)
 group by p.code order by pct;

-- the outcome, by DAY (never as a cumulative count — see §1.1)
select decided_at::date, count(*) from public.approvals
 where decision = 'needs_revision' and revision_reason = 'mismatch'
 group by 1 order by 1;
```

- **`photo_logs.zone_id` fill ≥ 40%** on WPs that have zones. Below that, D4's "always optional" loses to the "required where zones exist" option 366 declined — with evidence rather than opinion.
- **No `mismatch` burst of the 07-27/28 shape recurs** once zones are bound. ⚠️ Stated as _absence of a spike_, not as a falling trend: the base rate is roughly one event per nine days, far too sparse for a trend claim in either direction.
- **Zones authored on more than one project.** If only the pilot ever gets zones, this has repeated spec 248's fate — `answers_photo_id` holds **0 of 2,960** photos — and U4 should not be extended.

---

## 7. Risks

- **The authoring act is the whole bet.** 366 §1.1 named this: spec 248 built photo pairing and holds 0 rows because it needed a curatorial act nobody performed. Zones need a PM to draw AND bind. `clone_project_zones` exists and makes the geometry of project #2 nearly free — **but binding is per-WP and does not clone.** U4 must be measured, not assumed.
- **392 U2b will ship an editor whose output nothing reads.** That is spec 377's exact failure shape (0 briefs, 0 attachments, 0 route views with the authoring UI live). U6 discharges it; until then the canvas is a cost.
- **The rollup's honesty is a design risk.** A grid whose cells do not sum to the total reads as broken to someone who does not read the header. §2.1 is the mitigation; if the field finds it confusing the answer is a clearer surface, never a quieter number.
- **This spec's own first draft carried three false claims** (a tripled trend, a shipped editor, an SA that needs an RPC), each caught by fact-check against the live DB and `origin/main`. Anything here quoted downstream should be re-verified, not inherited.

---

## 8. Sibling

[392](392-project-zone-maps.md) — the geometry, the editor, the map; its §4.1 carries the §3.1 correction as of 2026-08-06. [366](366-wp-zones.md) — the origin of the evidence axis; keep its D1–D7 decisions and its argument, treat its §3 model and §9 appendix as superseded.
