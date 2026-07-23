# Separate OT muster session — Implementation Plan (spec 351)

> **For agentic workers:** each unit ships through the repo's `ship-unit` skill (lane claim → dependency gate-check → RED-first → real-flow verify → fresh-eyes → gated ship). Reworks **live** muster RPCs — U1 is schema/operator-merged. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Track a technician's normal hours and OT as two separate muster sessions (`regular` 08:00–17:00, `ot` 17:30–whenever) instead of deriving OT from one evening scan against a 17:00 threshold.

**Architecture:** Add a `session` enum column to `muster_attendance` (composite unique per worker/day/session); the scan RPCs gain a `p_session`; `ot_hours` becomes the OT session's real span; `close_muster_day` auto-outs only `regular`. The cockpit gains an evening OT scan flow; the loader folds both sessions per worker. Money (306 U5) is untouched.

**Tech Stack:** Postgres/Supabase plpgsql DEFINER RPCs, pgTAP; Next.js Server Actions + a `'use client'` cockpit; Vitest.

## Global Constraints (verbatim from spec 351 + repo rules)

- **Forward-only, zero backfill** — `muster_attendance` is 0 rows live (verified 2026-07-24). No data migration.
- **Money out of scope** — no `labor_logs`, no OT rate, no 17:30 pay-clamp. `session` + `ot_hours` are handed to 306 U5 (held).
- **Source every reworked DEFINER body from the LIVE function** (`pg_get_functiondef(...)` at build time), graft the documented delta, ship as a NEW migration file — never hand-edit an applied migration (silently no-ops) and never trust the `075750` text as current.
- **Preserve the existing cross-team conflict messages verbatim** — `src/lib/muster/actions.ts` `scanErrorToThai` matches on `already in team of` / `mustered elsewhere` / `no attendance`.
- `regular` session behaviour is unchanged except that regular scan-out no longer writes `ot_hours`.
- Grants on every reworked RPC: `revoke all … from public; revoke execute … from anon; grant execute … to authenticated`.
- TDD RED-first; Conventional Commits.

## Dependency gate-check (RE-RUN at build time — main has advanced)

- `muster_attendance` still `unique (worker_id, work_date)`, 0 rows; confirm the constraint's live name (`\d muster_attendance`; default `muster_attendance_worker_id_work_date_key`).
- Capture the LIVE bodies of `muster_scan_in(uuid,uuid,muster_method)`, `muster_scan_out(uuid,uuid,muster_method)`, `close_muster_day(uuid,date)`, `move_muster_worker(uuid,date,uuid)` via `pg_get_functiondef`.
- Confirm the schema lane is FREE (was held by lane 348 U3 `075843`); claim the next timestamp. Re-read `../LANES.md`.
- `306-muster.test.sql` — locate the assertion(s) that check `ot_hours` after a **regular** scan-out (they move to the `ot` session in this rework).

## File map

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_spec351u1_ot_session.sql` | create | enum + column + composite unique + reworked scan/close/move RPCs |
| `supabase/tests/database/351-ot-session.test.sql` | create | pgTAP for the two-session flow |
| `supabase/tests/database/306-muster.test.sql` | modify | move the regular-scan-out OT assertion to the `ot` session |
| `src/lib/muster/actions.ts:76-100, 24-47` | modify | `session` arg on `musterScan`; OT-guard error → Thai |
| `src/lib/muster/load-muster.ts` | modify | fetch `session`; fold `regular` + `ot` per worker |
| `tests/unit/muster-board.test.ts` (existing) + `tests/unit/muster-scan-action.test.ts` | modify/create | two-session fold; session passthrough + error map |
| `src/components/features/muster/muster-cockpit.tsx` | modify | session toggle, OT scan controls, OT-span display, open-OT flag |

---

## Task U1 — session-aware muster schema + RPCs (schema; operator-merged)

**Files:** create `…_spec351u1_ot_session.sql`, `351-ot-session.test.sql`; modify `306-muster.test.sql`.

**Interfaces — Produces:**
- `muster_attendance.session public.muster_session` (`'regular' | 'ot'`), `unique (worker_id, work_date, session)`.
- `muster_scan_in(p_team uuid, p_worker uuid, p_method muster_method, p_session muster_session default 'regular') returns uuid`
- `muster_scan_out(p_team uuid, p_worker uuid, p_method muster_method, p_session muster_session default 'regular') returns uuid`
- `close_muster_day(uuid, date)` — signature unchanged; behaviour: auto-out `regular` only.
- `move_muster_worker(uuid, date, uuid)` — signature unchanged; moves **all** of the worker's sessions that day.

- [ ] **Step 1 — pgTAP RED first** (`351-ot-session.test.sql`, standard `begin; select plan(N); …; finish(); rollback;`, JWT-as-site_admin harness mirroring `306-muster.test.sql`):
  1. `muster_scan_in(t,w,'manual','regular')` → one row, `session='regular'`; `muster_scan_out(t,w,'manual','regular')` → `out_at` set, **`ot_hours` IS NULL**.
  2. `muster_scan_in(t,w,'manual','ot')` **before** any regular row → raises `P0001`.
  3. after a regular row on team `t`, `muster_scan_in(t2,w,'manual','ot')` where `t2 != t` → raises `P0001` (OT must be same team).
  4. after regular on `t`: `muster_scan_in(t,w,'manual','ot')` → 2nd row `session='ot'`; then `muster_scan_out(t,w,'manual','ot')` → `ot_hours = floor(span*2)/2` (seed `in_at` back e.g. 90 min → `1.5`).
  5. composite unique: a 2nd `regular` (and a 2nd `ot`) `scan_in` for the same worker/date is the idempotent no-op / conflict, not a new row.
  6. `close_muster_day` with an open `regular` (no out) and an open `ot` → the `regular` gets `out_at = 17:00`, `out_auto=true`; the `ot` row stays `out_at IS NULL`.
  7. `move_muster_worker` with both a `regular` and an `ot` row → **both** rows' `team_id` updated.
  8. grants: `has_function_privilege('anon', 'public.muster_scan_in(uuid,uuid,public.muster_method,public.muster_session)', 'execute')` false; `'authenticated'` true.

- [ ] **Step 2 — run, verify RED.** `pnpm db:test` — 351 file fails (function arity / column absent).

- [ ] **Step 3 — write the migration.** Schema first:
```sql
create type public.muster_session as enum ('regular', 'ot');
alter table public.muster_attendance
  add column session public.muster_session not null default 'regular';
alter table public.muster_attendance
  drop constraint muster_attendance_worker_id_work_date_key;   -- confirm live name at build
alter table public.muster_attendance
  add constraint muster_attendance_worker_date_session_key
  unique (worker_id, work_date, session);
```
Then, grafting onto each LIVE body:
- **`muster_scan_in`** — `drop function public.muster_scan_in(uuid,uuid,public.muster_method);` then recreate with the trailing `p_session public.muster_session default 'regular'`. Insert, after the worker-exists check:
```sql
  if p_session = 'ot' then
    if not exists (
      select 1 from public.muster_attendance
       where worker_id = p_worker and work_date = v_team.work_date
         and session = 'regular' and team_id = p_team) then
      raise exception 'muster_scan_in: no regular session on this team today' using errcode = 'P0001';
    end if;
  end if;
```
  and add `and session = p_session` to the existing-row `select … into v_existing`, and `session` (`= p_session`) to the `insert`. Re-grant the 4-arg signature.
- **`muster_scan_out`** — `drop function public.muster_scan_out(uuid,uuid,public.muster_method);` then recreate with `p_session … default 'regular'`. Add `and session = p_session` to the `select … into v_att`. Replace the OT block with:
```sql
  if p_session = 'ot' then
    v_ot := floor(extract(epoch from (now() - v_att.in_at)) / 3600.0 * 2) / 2;
    if v_ot <= 0 then v_ot := null; end if;
  else
    v_ot := null;   -- a regular session never carries OT
  end if;
```
  (drop the `v_day_end` 17:00 computation entirely.) Re-grant the 4-arg signature.
- **`close_muster_day`** — `create or replace` (same signature); add `and a.session = 'regular'` to the auto-out `update … set out_at = greatest(v_day_end, a.in_at) …` predicate so open `ot` rows are left untouched.
- **`move_muster_worker`** — `create or replace` (same signature); the row it moves must become **all** the worker's sessions that day: replace the single-row `update … where id = v_att.id` with `update public.muster_attendance set team_id = p_to_team where worker_id = p_worker and work_date = p_date;` (the pre-checks that read one row are fine — any session confirms membership). Keep the audit row.

- [ ] **Step 4 — fix the expected-RED in `306-muster.test.sql`.** The existing regular scan-out OT assertion now expects `ot_hours IS NULL`; the OT-hours behaviour is asserted by `351-ot-session.test.sql` on the `ot` session. Update it deliberately (do not weaken — re-point it).

- [ ] **Step 5 — push + regen + GREEN.** `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (351 passes; 306 passes with the re-pointed assertion; full suite only the tolerated known-red 221).

- [ ] **Step 6 — real-flow (no browser).** `db query --linked`: run reg-in → reg-out (assert `ot_hours` null) → ot-in → (seed `in_at` back) → ot-out (assert span) → `close_muster_day` (assert regular auto-out, ot untouched) for one seeded worker; rollback.

- [ ] **Step 7 — commit + ship** (`feat(spec351): separate OT muster session`). Danger-path → operator-merged.

---

## Task U2 — cockpit OT flow + two-session read (code-only)

**Files:** modify `src/lib/muster/actions.ts`, `src/lib/muster/load-muster.ts`, `src/components/features/muster/muster-cockpit.tsx`; tests `tests/unit/muster-board.test.ts`, `tests/unit/muster-scan-action.test.ts`.

**Interfaces — Produces (loader shape):**
```ts
export interface MusterOtSession { inAt: string | null; outAt: string | null; otHours: number | null; }
export interface MusterMember {
  workerId: string; name: string;
  inAt: string | null; outAt: string | null; outAuto: boolean;   // the REGULAR session
  ot: MusterOtSession | null;                                     // the OT session, if any
}
```
**Consumes:** `musterScan({ …, session: "regular" | "ot" })` (action, below).

- [ ] **Step 1 — vitest RED (loader fold)** in `tests/unit/muster-board.test.ts`: given attendance rows `[{worker, session:'regular', in, out}, {worker, session:'ot', in, out, ot_hours:1.5}]`, `shapeMusterBoard` yields one member with the regular fields + `ot: {inAt, outAt, otHours:1.5}`; a worker with only a regular row → `ot: null`.
- [ ] **Step 2 — vitest RED (action)** in `tests/unit/muster-scan-action.test.ts`: `musterScan` passes `p_session` through to the RPC; an OT-guard error message maps to a distinct Thai string.
- [ ] **Step 3 — run, verify RED** (`pnpm exec vitest run muster-board muster-scan-action`).
- [ ] **Step 4 — loader** (`load-muster.ts`): add `session` to the `RawAttendance` type + the `.select("team_id, worker_id, in_at, out_at, ot_hours, out_auto, session")`; in `shapeMusterBoard`, for each `(team, worker)` fold the `session='regular'` row into the member base and the `session='ot'` row into `member.ot` (a worker with only an OT row is impossible by the U1 guard, but default `ot:null` / regular-nulls defensively).
- [ ] **Step 5 — action** (`actions.ts`): add `session: "regular" | "ot"` to `musterScan`'s input; pass `p_session: input.session` in the `.rpc(...)` args; add to `scanErrorToThai`: `if (message.includes("no regular session")) return "ต้องเช็คชื่อเข้างานปกติในทีมนี้ก่อนทำ OT";`.
- [ ] **Step 6 — GREEN** (`pnpm exec vitest run muster-board muster-scan-action`).
- [ ] **Step 7 — cockpit** (`muster-cockpit.tsx`):
  - Add a session toggle (`งานปกติ` / `OT`) beside the existing เข้า/ออก toggle; thread `session` into the `musterScan({ teamId, workerId, mode, method, session, revalidate })` call (line ~109).
  - Member row (line ~371-406): keep the regular window line; when `m.ot`, render an OT line — `OT {bangkokTime(m.ot.inAt)}{m.ot.outAt ? `–${bangkokTime(m.ot.outAt)} · ${m.ot.otHours} ชม.` : ""}` — and replace the current `m.otHours` reference (line ~380) with `m.ot?.otHours`.
  - OT scan controls: in `session === "ot"` mode, the per-member button is `OT เข้า` when `!m.ot`, `OT ออก` when `m.ot && !m.ot.outAt`.
  - Open-OT flag: when `m.ot && m.ot.inAt && !m.ot.outAt` (esp. after `board.closure`), render an `OT ยังไม่ปิด` chip.
- [ ] **Step 8 — real-flow (browser).** dev-preview SA in `/projects/:id/muster`: open team → เข้า (regular) → ออก (regular) → OT เข้า → OT ออก on one worker; both windows + the OT span render; skipping OT ออก then ปิดวัน shows `OT ยังไม่ปิด`; zero console errors.
- [ ] **Step 9 — commit + ship** (`feat(spec351): cockpit OT scan flow + two-session read`). Code-only → auto-merges on green.

---

## Self-review

- **Spec coverage:** enum+column+composite unique, scan_in/out `p_session` with OT guard + span `ot_hours`, close-day regular-only, cockpit evening flow + open-OT flag, two-session loader — all present. Money explicitly out (306 U5). ✓
- **Expected-RED handled:** the 306-muster regular-scan-out OT assertion is re-pointed in U1 Step 4 (not weakened) — the doctrine's "a GREEN you expected to be red is a finding" inverse.
- **Latent break caught:** `move_muster_worker`'s `select into (worker,date)` now matches 2 rows → U1 moves all sessions.
- **Placeholders:** none — schema DDL, each RPC delta, the loader shape, and every test case are concrete; reworked bodies are sourced from live per the global constraint.
- **Type consistency:** `MusterMember.ot: MusterOtSession | null` produced by the loader is consumed verbatim by the cockpit; `session: "regular" | "ot"` matches between the action input and the RPC `p_session`.
- **Open (from spec, not blocking):** OT-in during 17:00–17:30 gap (capture records actual; clamp = U5); 0.5h OT rounding; open-OT = cockpit flag only (no push).
