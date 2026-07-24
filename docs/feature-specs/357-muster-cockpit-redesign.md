# Spec 357 — Muster cockpit redesign (6 operator usability points)

**Status:** 🎨 DESIGN (operator handed 6 points 2026-07-24 after the day-1 pilot muster; grounded against the live DB the same day).
**Type:** UX redesign of the spec-306 muster cockpit — scan-primary add, smaller WP picker with carry-over, expected-vs-present visibility, gender at a glance.
**Class:** U-E/U-D/U-B/U-C code-only (auto-merge on green); **U-F (workers.gender schema + RLS widen) is danger-path ⇒ operator-merged, built LAST.**
**Parent:** spec 306 scan-muster (cockpit U3, leaf picker #742, jsQR #745, ปิดวัน bar #746) · spec 330 project team map (crews/HT axis — the expected-roster source) · spec 346 name breakdown (sibling: prefix may later relate to gender).

## Origin (operator, 2026-07-24, after using the cockpit on day 1)

1. QR should be an icon at the TOP of each team card (today it is a button in the เข้า body).
2. The WP picker should show only incomplete WPs and default to the prior muster day's still-incomplete WPs for this team.
3. Remove `+ เพิ่มช่าง`.
4. Remove ย้าย — no intra-day team change ("team change only at OT" hints a separate future feature; not built here).
5. Show gender on member rows.
6. Show who is expected but not yet on site (ยังไม่มา).

## Grounded facts (live DB 2026-07-24)

- **Crews on pilot PRC-2026-004:** 4 active — เอกพัฒน์ (7 live members) · อนันตชัย (6) · อนันต์ แสงทอง (6) · จันทร์ เงางาม (2); 21 live of 23 seeded (2 removed). **Both day-1 muster leads are crew leads** → the point-6 join yields data. ⚠️ จันทร์'s crew holds 2 members while their day-1 team mustered 8 workers — crew rosters are partial vs reality (see Non-goals).
- **Muster history:** 3 teams ever (07-24 จันทร์ + อนันต์, 07-15 แก้ว exploration). `muster_team_wps` = 0 all-time — the point-2 prefill mechanism builds ahead of its data (leaf picker only deployed the evening of 07-24).
- **WP status over the pilot's 332 leaves:** complete 111 · not_started 113 · pending_approval 72 · in_progress 36 → the incomplete filter shrinks the picker to 221 rows (67%). Live enum = **6 values**: `not_started | in_progress | on_hold | complete | pending_approval | rework` (fact-check correction — `on_hold`/`rework` hold 0 rows DB-wide today, but `rework` is reachable via the spec-337 rejection flow). Incomplete = `status != 'complete'`, which correctly includes both. The `MusterWp.status` type must be the full generated `work_package_status` enum, never a hand-rolled 4-value union.
- **Workers PII wall = column-level GRANTs:** authenticated SELECT covers exactly `id, name, project_id, level, pay_type, employment_type, active, cost_confirmed_at, note, contractor_id, created_at, created_by, user_id`. No gender/prefix column exists anywhere (no gender-ish enum either); names are not reliably prefixed (5/25 active pilot workers start with a นาย/นาง/นางสาว prefix) ⇒ gender is **not derivable** — U-F adds the column + widens the grant.
- **crew_members RLS:** authenticated SELECT already passes for the SA (back-office ∨ own-led-crew ∨ `current_user_sa_visible_crew_ids()`) — point 6 needs **no RLS change**.
- **Worker write doors:** `create_worker` / `update_worker` DEFINER RPCs via `src/app/workers/actions.ts`, UI = `WorkerRosterManager` — U-F's data-entry surface.

## Design

### U-E — remove ย้าย (point 4)

Delete the ย้าย button, the move picker panel, `movePickFor` state, the `onMove`/`otherTeams` props and the `move` handler from `muster-cockpit.tsx`. **`moveMusterWorker` (action) and `move_muster_worker` (RPC) stay** — harmless, and the RPC remains the day-of correction tool via any future surface. The operator's "team change only at OT" is a **separate future feature** (OT on a different team — today OT is same-team-only via the scan_in guard): flagged in Non-goals, not built.

### U-D — QR icon at the header + the add sheet (points 1 + 3, coupled)

Today: `สแกน QR` renders in the เข้า-mode body (and again in the OT body), `+ เพิ่มช่าง` opens an inline tap-list. Point 3 alone would delete the phoneless / lost-badge / no-camera path — a signal removal — so the tap-add **re-homes into the scan surface** ("scan OR tap"), and the QR door moves to the card header as an icon.

- **Header:** an icon button (lucide `QrCode`, `aria-label="สแกน QR / เพิ่มช่าง"`, ≥44px tap target) on the right of the team-card header row, before the member count. One door per team.
- **The add sheet** (new `MusterAddSheet`, full-screen overlay reusing the camera overlay chrome): camera viewfinder on top **when `hasScannerSupport()`**, tap-add list below (เข้า + regular mode), ปิด button. No camera → list only. The list = the same `availableToAdd` set as today's `+ เพิ่มช่าง`; a tap fires the same manual scan-in.
- **`MusterCamera` gains an `embedded` render mode** (video + error only, no fixed wrapper/close button) so the sheet hosts it; the #745 camera **effect/loop is untouched** (on-device proof still owed — keep it byte-stable).
- **Sheet persists across taps** (today's list already does); the action `message` renders inside the sheet (the page-top alert is hidden behind the z-50 overlay).
- **Scan stays one-shot** (detect → sheet closes), exactly today's behavior. Continuous multi-scan needs a decode cooldown + in-sheet per-scan feedback inside the #745 loop — deferred until the loop has on-device proof (Non-goals).
- **Icon gating:** always rendered in regular+เข้า (sheet always has content). In regular+ออก and OT the sheet is camera-only, so the icon renders only when `hasScannerSupport()` (per-row เช็คออก / OT เข้า / OT ออก buttons already carry the manual path there). Camera dispatch by mode/session is unchanged.
- `+ เพิ่มช่าง` and both body `สแกน QR` buttons are removed. The camera-error copy ("ใช้การแตะเพิ่มช่างแทนได้") updates to point at the list below it.

_Alternative considered:_ keeping a body-level add button + a separate header icon — rejected: two doors to the same surface, and the operator explicitly asked the body button gone.

### U-B — WP picker: incomplete only + prior-day carry-over (point 2)

- **Loader** (`load-muster.ts`): leaf select gains `status`; `MusterWp` (client-safe `wp-groups.ts`) gains `status`. Board keeps ALL leaves (chips + prune-on-save still resolve completed assigned WPs — the #742 invariant).
- **Picker filter (per team):** options = leaves where `status != 'complete'` **OR** `id ∈ team.wpIds`. An assigned-but-completed WP renders with an `เสร็จแล้ว` tag so the SA sees it should be released. Groups fold over the filtered list, so fully-complete parents disappear.
- **Prior-day prefill:** loader queries, per today's team lead, the latest prior `muster_teams` row (same project + `lead_worker_id`, `work_date < today`) and its `muster_team_wps`. `team.prefillWpIds` = that set ∩ still-incomplete ∩ current leaf set. When the SA opens the picker of a team with **no** assigned WPs, the checkboxes seed from `prefillWpIds` (groups holding a seeded pick auto-expand, same as checked today) plus a one-line hint "เลือกงานจากมัสเตอร์วันก่อนให้แล้ว — ตรวจแล้วกดบันทึก". Nothing persists until บันทึกงาน — **plan = pre-fill, scan/save = truth** (the spec-306 locked rule). A team with assigned WPs seeds from them, as today.
- _Alternative considered:_ auto-persisting the prior set at `open_muster_team` (RPC change) — rejected: schema-lane danger for no gain, and it records an assignment no human confirmed.

### U-C — ยังไม่มา missing list (point 6)

- **Expected source = `crew_members`** (live rows, `removed_at IS NULL`) of the **active crews led by the team's lead** (`crews.lead_worker_id = team.leadWorkerId`, same project; a lead with several crews unions them).
- **Missing (per team)** = expected − everyone checked in today **across all teams** (a crew member mustered into another team is present, not missing) ∩ the active project roster (deactivated/foreign workers drop out; names resolve off the roster as everywhere else).
- **Render:** under the member list, a `ยังไม่มา (N)` section — muted rows, name + เช็คอิน button firing the same manual scan-in into this team. Rows are also scannable via the U-D sheet (a scan-in removes them from the list on refresh). Section renders in every mode (evening: who never came is still information); the เช็คอิน button stays active (a 16:00 late arrival is legitimate — the RPC accepts any pre-close time, and post-close scan-in plus idempotent re-close re-derives correctly).
- **Loader:** two extra RLS reads (crews for today's leads → their live crew_members); the fold stays in `shapeMusterBoard` (pure, unit-tested) as `team.missing: {id, name}[]`.

### U-F — gender on member rows (point 5, schema + RLS, danger-path, LAST)

- **Schema (claims the schema lane, `075852`):** new enum `worker_gender` (`male | female`) + nullable `workers.gender` column (null = ยังไม่ระบุ; no backfill guess — names don't carry it). `grant select (gender) on public.workers to authenticated` widens the PII wall by exactly one low-sensitivity column (same exposure class as `name`/`level`; the row wall — the workers SELECT policy — is untouched).
- **Write path:** `create_worker` + `update_worker` gain optional `p_gender` (null-keep on update, per the 321-U3a blank=keep convention). RPC-sig change ⇒ DROP+CREATE with grants re-applied (`revoke … from public, anon`), pgTAP sig pins updated deliberately.
- **Data entry:** an `เพศ` RadioChip pair (ชาย/หญิง) in `WorkerRosterManager`'s add + edit forms. Backfill = the SA/PM edits existing workers there (25 active on pilot); no bulk tool in v1.
- **Display:** `load-muster.ts` workers select += `gender`; member rows, the ยังไม่มา rows and the add-sheet list each get a small ช/ญ chip (token colors, no raw palette). Null renders nothing.
- _Alternative considered:_ riding spec 346's prefix (นาย/นางสาว → gender) — rejected for now: 346's §3 crux is answered but unbuilt, prefix is about LEGAL identity while this is a fast visual scan, and a nullable enum column composes with 346 later (prefix entry can default gender).

## Sequencing

| Unit | Points | Content                                                      | Class                        |
| ---- | ------ | ------------------------------------------------------------ | ---------------------------- |
| U-E  | 4      | Remove ย้าย UI                                               | code-only                    |
| U-D  | 1+3    | Header QR icon + add sheet (scan OR tap), remove เพิ่มช่าง   | code-only                    |
| U-B  | 2      | Picker incomplete filter + เสร็จแล้ว tag + prior-day prefill | code-only                    |
| U-C  | 6      | ยังไม่มา section + tap check-in                              | code-only                    |
| U-F  | 5      | worker_gender enum + col + grant + RPC params + form + chip  | **schema — operator-merged** |

U-E first (clears the member-row region U-D rewrites), then D → B → C (each self-contained; B and C both touch the loader — serialized in one lane), F last per the danger-path rule. Each unit shippable alone; no unit leaves a removed affordance without its replacement in the same PR (U-D carries both halves of point 3 by construction).

## Testing

- **U-E:** RTL — ย้าย button absent (bare-literal absence pin), move-UI tests deleted; action/RPC tests untouched.
- **U-D:** RTL — icon gating per mode/session/camera-support truth table; sheet opens with list; tap fires manual scan-in; sheet survives a tap; `+ เพิ่มช่าง` absent; message renders in-sheet. Mutation-check the gate both ways (icon reverted to body → RED; list removed → RED).
- **U-B:** unit tests on the pure filter/seed folds (complete hidden unless assigned; เสร็จแล้ว tag; prefill = prior ∩ incomplete ∩ leaves; seeded groups auto-expand); loader fold test for the prior-day shape.
- **U-C:** fold tests (cross-team presence excluded, removed_at excluded, inactive excluded, multi-crew union); RTL section + เช็คอิน tap.
- **U-F:** pgTAP — enum labels, column nullability, the authenticated column grant (and its absence for anon), RPC write-through + null-keep; RTL form field + chip render.
- Browser click-drive is wedged on this box (documented) → RTL + SSR probe + `pnpm build` substitute, disclosed per PR. `pnpm build` mandatory for U-D/U-B/U-C (client files gain `@/lib` value imports — the #742 lesson).

## Non-goals / deferred

- **OT-time team change** (operator's "only possible at OT") — a separate future feature; `move_muster_worker` stays as its substrate.
- **Continuous multi-scan** (cooldown + in-sheet scan feedback) — after the #745 loop has on-device proof; one-shot scan is today's behavior, not a regression.
- **Expected-roster union with prior-day attendance** — point 6 uses the operator-named `crew_members` source only. จันทร์'s 2-member crew vs 8-member team means the list undercounts until crew rosters are maintained on the spec-330 team map; if rosters stay stale, revisit with an observed-attendance union.
- **Project-level "crew with no team today" hint** — the lineup itself surfaces an absent lead; per-team sections only.
- **Gender backfill tooling / bulk edit** — roster form edits suffice at 25 workers.
- **`day_fraction_num` 3+-WP derive coverage** — unchanged from U5a; not this spec.

## Open decisions (operator, non-blocking)

1. `worker_gender` = `male | female` nullable. If a third value is ever needed (e.g. ไม่ระบุ as an explicit choice vs null), it is an additive enum change.
2. Crew rosters on the team map are the expected-list source of truth — maintaining them is now operationally meaningful (point 6 reads them every morning).
