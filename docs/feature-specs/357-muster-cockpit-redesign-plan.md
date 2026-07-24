# Spec 357 — Muster cockpit redesign — implementation plan

> **For agentic workers:** execute unit-by-unit with the `ship-unit` skill gates (lane claim → dependency gate-check → RED-first → real-flow verify → fresh-eyes → ship-pr.sh). Each unit = its own branch off latest `origin/main`, its own PR. Sequence: **U-E → U-D → U-B → U-C → U-F**.

**Goal:** the 6 operator usability points on the muster cockpit (spec 357), shipped as 5 independently-revertable units.

**Architecture:** all UI work stays in the existing three-layer shape — `load-muster.ts` (server-only reader) → `shapeMusterBoard` (pure fold, unit-tested) → `muster-cockpit.tsx` (client). Client-safe pure helpers live in `wp-groups.ts` (the #742 build lesson: a `"use client"` file may only VALUE-import client-safe modules). U-F adds one additive migration.

## Global constraints (every unit)

- Tap targets ≥44px (`min-h-11`; icon buttons also `min-w-11`) — design-doctrine floor.
- Field-First tokens only (`bg-sunk`, `bg-fill`, `text-ink*`, `bg-brand`, …); raw Tailwind palette banned.
- New user-facing strings are single-use → local consts in the component (labels.ts only for terms used 2+ places — none here).
- `MusterCamera`'s effect/decode loop (#745) is **byte-stable** in this spec — wrapping JSX may change, the loop may not (on-device proof still owed).
- `pnpm build` mandatory before ship for U-D/U-B/U-C (client files gain `@/lib` value imports).
- Full `pnpm lint && pnpm typecheck && pnpm test` per unit; `pnpm db:test` at least once per session (known reds: 200/221 pinned only).
- Browser click-drive is wedged on this box → RTL + SSR probe substitute, disclosed in each PR.
- Progress tracker row per unit (`docs/progress-tracker.md`).
- Mutation-check every text/absence assertion (break production by hand → RED → restore). **Commit before mutation-checking.**

---

## U-E — remove ย้าย (point 4) — code-only

**Files:** modify `src/components/features/muster/muster-cockpit.tsx`; modify its test file (locate: `grep -rl "ย้าย" tests/unit/`).

**Remove:** the `move` handler + `moveMusterWorker` import; `movePickFor` state; the ย้าย button block (เข้า-mode member row); the move-picker panel (`ย้ายไปทีมของ:`); `onMove` + `otherTeams` props end-to-end (cockpit → `TeamCard`). **Keep:** `src/lib/muster/actions.ts` `moveMusterWorker` + the RPC + their tests (unused-by-UI is fine; the action module is not imported for move anymore — confirm no unused-import lint).

**RED-first:** RTL — render board with 2 teams, เข้า+regular: `queryByText("ย้าย")` null AND `queryByText(/ย้ายไปทีมของ/)` null. (Seen RED against HEAD before edits.) Delete the existing move-UI tests deliberately (list them in the PR body).

**Mutation-check:** re-add a `ย้าย` button stub → absence test REDs → revert.

**Verify:** full suite + SSR probe of `/projects/<pilot>/muster` (super_admin dev-preview session) — page 200, no ย้าย in HTML.

---

## U-D — header QR icon + add sheet (points 1+3) — code-only

**Files:** create `src/components/features/muster/muster-add-sheet.tsx` (client); modify `muster-cockpit.tsx`, `muster-camera.tsx` (render-shell only); tests: extend the cockpit test file + new `tests/unit/muster-add-sheet.test.tsx`.

**Interfaces (locked):**

```tsx
// muster-camera.tsx — new prop, effect untouched:
export function MusterCamera({
  onDetected,
  onClose,
  embedded = false,
}: {
  onDetected: (workerId: string) => void;
  onClose: () => void; // still used by the non-embedded legacy shell (kept for safety); sheet owns close when embedded
  embedded?: boolean; // true → render only <video>/<error>, no fixed wrapper, no ปิดกล้อง button
});

// muster-add-sheet.tsx — full-screen overlay (same chrome class as the old camera shell):
export function MusterAddSheet({
  leadName,
  hasCamera,
  showTapAdd,
  addable,
  message,
  pending,
  onScanDetected,
  onTapAdd,
  onClose,
}: {
  leadName: string;
  hasCamera: boolean; // hasScannerSupport() from the cockpit
  showTapAdd: boolean; // session==="regular" && mode==="in"
  addable: { id: string; name: string }[];
  message: string | null; // the cockpit's action message — page-top alert is hidden behind this z-50 overlay
  pending: boolean;
  onScanDetected: (workerId: string) => void; // cockpit closes the sheet after a scan (one-shot, today's behavior)
  onTapAdd: (workerId: string) => void; // sheet STAYS open across taps
  onClose: () => void;
});
```

**Cockpit changes:**

- `TeamCard` header row gains an icon button right of the lead name / before the count: lucide `QrCode`, `aria-label="สแกน QR / เพิ่มช่าง"`, `min-h-11 min-w-11`. Render gate: `(session === "regular" && mode === "in") || hasCamera`.
- Existing `scanTeamId` state drives the sheet (rename ok). Sheet mount at cockpit root replaces the bare `<MusterCamera>` mount; `onScanDetected` = existing `scanFromCamera(teamId, id)` then `setScanTeamId(null)`; `onTapAdd` = `scanRegular(teamId, id, "manual")` with NO close.
- Delete: the `+ เพิ่มช่าง` button + `addOpen` state + inline add panel; both body `สแกน QR` buttons (เข้า body + OT body); OT body keeps its hint line.
- `MusterCamera` error copy becomes neutral `"เปิดกล้องไม่ได้"` (the old copy names the removed เพิ่มช่าง button; when the tap list is present it sits directly below the error).

**RED-first (all seen red before code):**

1. Header icon present in เข้า+regular with `hasCamera=false` (tap-add path exists camera-less).
2. Icon absent in ออก mode with `hasCamera=false`; present with `hasCamera=true`.
3. Open sheet → addable names render; tap a name → manual scan-in called with that worker; sheet still open (name list re-queryable).
4. `+ เพิ่มช่าง` absent; no body `สแกน QR` text outside the sheet.
5. `message` prop renders inside the sheet (`role="alert"`).
6. Empty addable → `"ช่างทุกคนเข้าทีมแล้ว"` inside the sheet.

**Mutation-checks:** gate reverted to `hasCamera`-only → (1) RED; tap-list removed → (3) RED; `+ เพิ่มช่าง` re-added → (4) RED.

**Verify:** full suite; `pnpm build`; SSR probe (icon aria-label present per team; no เพิ่มช่าง).

---

## U-B — WP picker: incomplete + prior-day prefill (point 2) — code-only

**Files:** modify `src/lib/muster/wp-groups.ts`, `src/lib/muster/load-muster.ts`, `muster-cockpit.tsx`; tests: `tests/unit/muster-wp-groups.test.ts` (or sibling), the load-muster shape test, the cockpit test.

**Interfaces (locked):**

```ts
// wp-groups.ts (client-safe)
import type { Database } from "@/lib/db/database.types";           // type-only import — erased, build-safe
export type WpStatus = Database["public"]["Enums"]["work_package_status"]; // full 6-value enum, never a hand union
export interface MusterWp { id; code; name; status: WpStatus; parentId?; parentCode?; parentName? }
/** Picker options for one team: incomplete leaves, plus any ASSIGNED leaf regardless of status (#742 invariant). */
export function pickerWps(wps: MusterWp[], assignedIds: readonly string[]): MusterWp[];

// load-muster.ts
export interface MusterTeam { …existing…; wpIds: string[]; prefillWpIds: string[] }
// shapeMusterBoard input gains: priorTeamWps?: { leadWorkerId: string; wpIds: string[] }[]
// prefill fold: team.prefillWpIds = prior set for this lead ∩ (wps where status !== "complete") — [] when no prior row.
```

**Loader:** leaf select gains `status`; per today's team lead run `muster_teams` `.eq(project) .eq(lead_worker_id) .lt(work_date, date) .order(work_date desc) .limit(1)` in a `Promise.all` (≤ handful of leads), then one `muster_team_wps .in(team_id, priorIds)` — fold to `priorTeamWps`.

**Cockpit (`TeamCard`):**

- `const options = pickerWps(wps, team.wpIds); const wpGroups = groupMusterWps(options);` — chips + prune-on-save keep using the FULL `wpById` (all leaves) so an assigned-complete WP still resolves and survives save (the #742 invariant, now doubly load-bearing).
- Picker row for a `status === "complete"` option renders an `เสร็จแล้ว` meta-tag.
- `openEditor` seeds `checked` from `team.wpIds.length ? team.wpIds : team.prefillWpIds`, auto-expands groups holding any seeded id, and when seeding from prefill shows the hint line `"เลือกงานจากมัสเตอร์วันก่อนให้แล้ว — ตรวจแล้วกดบันทึก"`. Nothing persists until บันทึกงาน.

**RED-first:**

1. `pickerWps`: complete+unassigned excluded; complete+assigned included; all 5 non-complete statuses included (iterate the GENERATED enum values, not a hand list — the allowlist-test lesson).
2. Shape fold: prefill = prior ∩ incomplete; empty when the lead has no prior row; empty when prior WPs all completed.
3. RTL: completed unassigned leaf absent from an opened picker; completed assigned leaf present with เสร็จแล้ว; prefill seeds checkboxes + hint renders + บันทึกงาน calls `setMusterTeamWps` with the seeded ids; a team WITH assignments seeds from them and shows no hint.

**Mutation-checks:** drop the `|| assigned` arm → (1) RED; drop the status filter → (1) RED; seed from `[]` instead of prefill → (3) RED.

**Verify:** full suite; `pnpm build`; SSR probe.

---

## U-C — ยังไม่มา missing list (point 6) — code-only

**Files:** modify `load-muster.ts`, `muster-cockpit.tsx`; tests: shape test + cockpit test.

**Interfaces (locked):**

```ts
// load-muster.ts
export interface MusterTeam { …; missing: { id: string; name: string }[] }
// shapeMusterBoard input gains: crewRosters?: { leadWorkerId: string; workerIds: string[] }[]
// fold: expected(lead) = union of that lead's roster workerIds;
// missing = expected − (every attendance worker_id across ALL teams) ∩ workers-list (name resolvable), workers-list order.
```

**Loader:** `crews` `.eq(project_id) .in(lead_worker_id, todayLeads) .eq(active, true)` → `crew_members` `.in(crew_id, crewIds) .is(removed_at, null)` → fold per lead (a lead with several active crews unions them). RLS already admits the SA (verified live — no policy change).

**Cockpit (`TeamCard`):** under the member list, when `team.missing.length > 0`, a section:

- header `ยังไม่มา ({n})` (`text-ink-muted text-meta font-semibold`),
- one muted row per worker: name + `เช็คอิน` button (`bg-sunk`, `min-h-11`, pending-disabled) → new cockpit handler `checkInMissing(teamId, workerId)` = `musterScan({ mode: "in", method: "manual", session: "regular", … })` — **hard-coded `mode:"in"`**, never the toggle state (a late arrival is checked IN even while the SA is in ออก mode).
- Renders in every mode/session (evening: who never came is still information).

**RED-first:**

1. Fold: cross-team-mustered crew member NOT missing; unknown/inactive worker id dropped; multi-crew lead unions; empty roster → `missing: []`.
2. RTL: section renders names + count; เช็คอิน fires scan-in with `mode:"in"` while the toggle is on ออก (the load-bearing assert); no section when empty.

**Mutation-checks:** `checkInMissing` wired to the mode toggle → (2) RED; fold subtracts only same-team ids → (1) RED.

**Verify:** full suite; `pnpm build`; SSR probe on the pilot (จันทร์'s 2-member crew ⇒ expect a small/empty ยังไม่มา before check-ins; อนันต์'s 6 ⇒ nonempty until his crew checks in).

---

## U-F — workers.gender (point 5) — SCHEMA, danger-path, operator-merged, LAST

**Lane:** claim migration `20260813075852` in `../LANES.md` BEFORE writing it (hook-enforced).

**Files:** create `supabase/migrations/20260813075852_worker_gender.sql`; create `supabase/tests/database/357-worker-gender.test.sql`; modify `src/app/workers/actions.ts`, `src/components/features/labor/worker-roster-manager.tsx`, `src/lib/muster/load-muster.ts`, `muster-cockpit.tsx`, `muster-add-sheet.tsx`; regenerate `database.types.ts`.

**Gate-checks (execute before writing the migration):**

1. `pg_get_functiondef` of LIVE `create_worker` + `update_worker` (never a migration file) — graft bodies from live.
2. `grep -rn "create_worker\|update_worker" supabase/tests/` — every sig pin that must be bumped deliberately.
3. Roster form: read the add/edit form regions of `worker-roster-manager.tsx` at HEAD; find the `RadioChip` usage pattern to copy.
4. Re-confirm schema-lane STATUS in LANES (`075852` still next-free at build time; renumber if another lane claimed it — the 351 collision lesson).

**Migration (additive):**

```sql
create type public.worker_gender as enum ('male', 'female');
alter table public.workers add column gender public.worker_gender;
grant select (gender) on public.workers to authenticated;
-- DROP + CREATE create_worker / update_worker from their LIVE bodies with a trailing
--   p_gender public.worker_gender default null
-- create: writes gender; update: gender = coalesce(p_gender, gender)  (null = keep; no clear path — YAGNI).
-- Re-apply: revoke all on function … from public, anon; grant execute … to authenticated (+ service_role if the live def has it).
```

**pgTAP (`357-worker-gender.test.sql`, RED-first):** enum has exactly (male, female); `workers.gender` exists nullable; authenticated HAS the `gender` column SELECT grant, anon does NOT; `create_worker(...p_gender=>'male')` persists; `update_worker` with `p_gender=>null` keeps, with a value sets; existing sig pins updated.

**Code:** `createWorker`/`updateWorker` actions thread `gender: WorkerGender | null`; roster form gains an optional `เพศ` RadioChip pair ชาย/หญิง (both forms); `load-muster.ts` workers select += `gender`, `MusterWorker.gender`, member fold resolves gender like name; member rows + ยังไม่มา rows + add-sheet list render a `ช`/`ญ` meta-chip (neutral `bg-sunk` tokens — letter differentiates, no raw palette), null renders nothing.

**Order inside the unit:** migration → `db:push` → `db:types` → typecheck (the RPC-sig mig is typecheck-green only AFTER push+types — known quirk) → pgTAP → code + vitest.

**Verify:** pgTAP file green ×2; full suite; SSR probe; live query — set one test worker's gender via the RPC as dev-preview, confirm the chip SSRs, revert the value.

**Ship:** danger-guard HOLDS the PR by design (migration) → 🔔 operator merge. Additive-mig self-merge grant applies if the operator is away and all substantive checks are green (memory `autonomous-build-fence`).

---

## Plan self-review notes

- Spec coverage: points 1+3 → U-D · 2 → U-B · 4 → U-E · 5 → U-F · 6 → U-C. Non-goals carry the deferred items (multi-scan cooldown, OT team-change, roster union, bulk gender backfill).
- Type consistency: `MusterWp.status: WpStatus` (U-B) is required — U-F touches the same `MusterWorker` shape later; no cross-unit type renames.
- The #742 invariant is asserted in BOTH directions in U-B (option present + survives save) — the prune filter keeps using the full `wpById` map.
