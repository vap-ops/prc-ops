# 351 — Separate OT muster session (แยกเช็คชื่อ OT)

**Class:** mixed — **U1** (muster schema rework + RPC signature change on live tables) is danger-path ⇒ operator-merged + single schema lane; **U2** (cockpit evening flow + `ot_hours` consumers) is code-only. **Reworks spec 306** — supersedes its U4 threshold-OT model; hands the two session types to 306 U5 (money, still operator-held).

**Origin:** operator direction 2026-07-23 — technicians' normal hours and OT are tracked **separately**: normal **08:00–17:00**, OT **from 17:30 till whenever**, with the 17:00–17:30 half hour an unpaid gap. Operator chose (in chat): OT is a **separate clock-in/out session**, not a threshold derived from one evening scan; and the SA physically scans **all four events** for an OT worker.

**The model:** two check-in/out pairs per worker per day.

```
in 08:00 ──work── out 17:00   │  in 17:30 ──OT── out (whenever)
   regular session            gap      ot session
```

- Non-OT worker → `regular` session only (2 scans).
- OT worker → `regular` + `ot` (4 scans: reg-in, reg-out ~17:00, OT-in 17:30, OT-out end).

## Current state (evidence)

- Muster is now in a **real pilot** (ช่างอวย @ TFM โพธิ์ทอง): `muster_attendance` = **13 rows** as of 2026-07-24 (all that single day, 13 distinct worker-days; live-verified). _[Corrected 2026-07-24 at U1 build — the spec's earlier "0 rows all-time" was written before the pilot.]_ Every existing row is a pre-rework single session: the new `session` column defaults them all to `regular`, and `ot_hours` is **already null on all 13**, so the go-forward "regular carries no OT" invariant holds for the live data with **zero backfill**. The composite unique is safe (13 distinct `(worker_id, work_date)` → 13 distinct `(worker_id, work_date, 'regular')`). Reshaping the schema now — while attendance is still tiny — is the cheap moment (retrofitting a session split onto heavily-populated attendance would be far worse).
- Today (`…075750_spec306u2_muster_schema.sql`): **one** attendance row per worker/day — `muster_attendance` with `unique (worker_id, work_date)`, columns `in_at/in_method/out_at/out_method/out_auto/ot_hours`. `muster_scan_out` computes `ot_hours` as **hours past a constant 17:00 Asia/Bangkok**, floored to 0.5h (spec 306 U4, "per-project config = YAGNI"). `close_muster_day` auto-outs un-out workers at 17:00.
- `ot_hours` is **captured + displayed only** — it pays nothing (306 U5 derive → `labor_logs` is unbuilt/operator-held; `labor_logs` = 0 rows). Consumers today: `src/components/features/muster/muster-cockpit.tsx`, `src/lib/muster/load-muster.ts`.
- Scan RPCs (all `SECURITY DEFINER`, gated `site_admin`/`super_admin`, self-tests skip money): `open_muster_team`, `muster_scan_in(team,worker,method)`, `muster_scan_out(team,worker,method)`, `set_muster_team_wps`, `move_muster_worker`, `close_muster_day(project,date)`.

## Design

### U1 — session-aware muster schema + scan RPCs (schema, operator-merged)

**Schema (forward-only, 13 live rows all default to `regular`, ot_hours already null → no backfill):**

- `create type public.muster_session as enum ('regular','ot');`
- `alter table public.muster_attendance add column session public.muster_session not null default 'regular';`
- Replace `unique (worker_id, work_date)` with **`unique (worker_id, work_date, session)`** — a worker gets at most one `regular` and one `ot` row per day.
- `ot_hours` semantics change: **null on `regular` rows**; on an `ot` row = the OT session's real span (`out_at − in_at`), floored to 0.5h at OT scan-out. The old 17:00-threshold computation is removed. (Chosen over a separate `muster_ot_sessions` table: two rows on the existing machinery is simpler and reuses every muster RPC/read.)

**RPC reworks** (signature adds `p_session public.muster_session`; app callers updated in U2):

- `muster_scan_in(p_team, p_worker, p_method, p_session)`:
  - `regular` → unchanged behaviour (create the regular row; the existing cross-team "already in another team today" conflict check applies to the regular session).
  - `ot` → **guard: the worker must already have a `regular` session that day on `p_team`** (else `P0001` "ยังไม่ได้เช็คชื่อเข้างานปกติ / ต้องทำ OT กับทีมเดิม"); then create the `ot` row on `p_team`. `unique (worker_id, work_date, session)` backstops a double OT-in.
- `muster_scan_out(p_team, p_worker, p_method, p_session)`:
  - `regular` → stamp the regular row's `out_at`; **no `ot_hours`**.
  - `ot` → stamp the `ot` row's `out_at`; `ot_hours = floor(extract(epoch from (out_at − in_at))/3600 * 2)/2` (null if ≤0). Re-scan-out recomputes (last wins), as today.
- `close_muster_day(p_project, p_date)`:
  - auto-out open **`regular`** sessions at 17:00 (`out_auto=true`), as today.
  - **leave open `ot` sessions open** — "till whenever" has no fixed end, so never auto-stamp an OT end; the cockpit surfaces them (below). Still records the closure.

### U2 — cockpit evening flow + OT display (code-only)

- `muster-cockpit.tsx`: the morning team-forming + regular in/out is unchanged. Add an **evening flow** — a `regular` check-out round, then an **OT round** (per worker: OT-in / OT-out), calling the reworked RPCs with `p_session`. An open `ot` session at/after close renders an **`OT ยังไม่ปิด`** flag (from the U1 "leave open" rule), so the SA closes it rather than the system guessing.
- `load-muster.ts`: fetch both sessions per worker; expose `regular` + `ot` (with the OT span) to the cockpit and the `/team` วันนี้ read surfaces.
- Display each worker's regular window + OT span separately (the "separately" the operator asked for).

## Non-goals / scope guards (YAGNI)

- **No OT money.** Rate (×1.5 / flat / per pay-class), WP attribution, and any "pay from 17:30 vs actual OT-in" clamp are **306 U5** — operator-held, OT-rate rule still open. This spec only makes the two sessions **capturable**.
- **No worker self-check-in** — the SA scans all four events (phoneless workers; the /technician QR is shown, not self-scanned).
- **No change to morning muster / team-forming / team↔WP announcement.**

## Handoff to spec 306 U5 (money)

When U5 is built: derive `regular` → normal-rate `labor_logs`, `ot` → OT-rate `labor_logs`. The `session` column is the discriminator; `ot_hours` on the `ot` row is the raw captured span. U5 still owns the OT rate rule and any 17:30 clamp.

## Open questions

- **OT-in during the 17:00–17:30 gap** (scanned early): capture records the actual `in_at`; whether pay clamps the start to 17:30 is a **U5** decision, not capture.
- **OT rounding** = 0.5h floor on the span (mirrors the retired convention); revisit if payroll wants finer granularity.
- **Open-OT at close**: v1 = cockpit flag only. A push to the SA is a later notification unit, not here.

## Units

| Unit | Scope                                                                                                                                | Class                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| U1   | `muster_session` enum + `session` column + composite unique + reworked `muster_scan_in`/`muster_scan_out`/`close_muster_day` + pgTAP | schema — operator-merged |
| U2   | cockpit evening/OT flow + `load-muster` two-session read + OT-span display                                                           | code-only                |

## Verification

- **pgTAP (U1):** reg-in→reg-out leaves `ot_hours` null; ot-in without a regular session errors; ot-in on a different team than the regular session errors; ot-in→ot-out sets `ot_hours` = the 0.5-floored span; the composite unique rejects a second `regular`/`ot` row; `close_muster_day` auto-outs open `regular` at 17:00 and leaves open `ot` untouched; grants unchanged (anon cannot execute).
- **Real-flow (U1, no browser):** run the four-scan sequence for one worker via `db query --linked`; confirm two rows, correct `ot_hours` span, and close-day behaviour.
- **Real-flow (U2, browser):** dev-preview SA drives reg-in → reg-out → OT-in → OT-out in the cockpit; both sessions + the OT span render; the open-OT flag appears when OT-out is skipped; zero console errors.
