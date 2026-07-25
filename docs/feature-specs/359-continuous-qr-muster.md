# Spec 359 — Continuous QR sweep + camera-first muster add sheet

Operator ask, 2026-07-26: _"Redesign the SA's attendance page. We want to influence them to
check in via QR, rather than SA manually checking them in."_

Status: design agreed in chat 2026-07-26. Two units, **code-only, no schema, no migration.**

## Origin

QR check-in was built in spec 306 (U1 printed badges, U3 camera, U3b iOS jsQR fallback) and
re-homed into a per-team add sheet in spec 357 U-D. It is not being used. The operator's first
instinct was to reward workers with Nova coins for scanning — an incentive aimed at the wrong
actor, for reasons the grounded facts below make plain. After that was surfaced the operator
chose **speed** as the goal: the SA is the bottleneck at the morning gate.

## Grounded facts (live DB + code at `origin/main`, 2026-07-26)

**Adoption, excluding the 2026-07-25 paper backfill (which was written by an admin script,
not by an SA):**

|            | Real SA-generated                                     |
| ---------- | ----------------------------------------------------- |
| Check-ins  | **36** — 22 on 07-24 (13 regular + 9 OT), 14 on 07-25 |
| …by QR     | **1**                                                 |
| Check-outs | **14**                                                |
| …by QR     | **0**                                                 |

The single QR scan: 2026-07-25 07:57:42, จันทร์ เงางาม, scanned by Wutpong. It was his _second_
action of the morning; his next three check-ins were all manual. **One trial, then abandonment,
inside one session.**

> ⚠️ **Reproducing these numbers.** The 2026-07-25 paper backfill (`../attendance-import/`, applied
> 2026-07-26) inserted 3 worker rows + 14 OT rows AND wrote `out_at` onto rows whose `scanned_by`
> is the original SA. So filtering on `scanned_by` alone does **not** isolate SA-generated
> check-outs — the naive query returns 27. The 14 above is: 13 (07-24 regular, untouched) + 1
> (07-25, from the pre-backfill snapshot `pre-state-20260725.json`). Check-INS are unaffected by
> the backfill's `out_at` writes, so the 36/1 split reproduces directly.

**A worker cannot check themselves in — by QR or at all.** `muster_scan_in` raises `42501` for
any role outside `site_admin | super_admin | procurement_manager`. The badge payload is an opaque
`workers.id`; `src/lib/muster/badge-qr.ts` states it directly — a scan "authenticates nobody".
QR-vs-manual is therefore **entirely the SA's choice of input method**, made on the SA's device.
No worker behaviour is involved, which is why a worker-facing reward cannot move this number.

**The add sheet penalises the path we want.** `muster-add-sheet.tsx`:

> "A successful SCAN closes the sheet (one-shot…); the sheet stays open across taps so the SA can
> add a whole lineup in a row. **Continuous multi-scan is deferred until the #745 decode loop has
> on-device proof.**"

So for a 14-person team: **tap = 1 door-open + 14 taps; scan = 14 door-opens + 14 camera
acquisitions.** Scanning is structurally slower than tapping. That asymmetry is the whole of the
1-in-36.

**Cost per action, measured from `in_at` gaps** (`in_at` is stamped `now()` at scan time, so
consecutive gaps are the SA's real rhythm):

| Action                                    | Observed                        |
| ----------------------------------------- | ------------------------------- |
| Next person, same team (sheet open)       | 1s, 4s, 4s, 6s                  |
| Switch team (close → other card → reopen) | 22s with people already waiting |

**Badge coverage is not a blocker.** 28 active workers on PRC-2026-004; 13 have app accounts, 15
do not. `/team/badges` prints a QR card for **every active worker** regardless of account, so the
15 are reachable on paper. Distribution is an ops task.

**Decode paths.** `muster-camera.tsx` runs native `BarcodeDetector` where present, else a jsQR
canvas fallback throttled to one decode per 180ms over a frame downscaled to ≤480px.

**Metric needs no new telemetry.** `interaction_events` carries only generic
`route_view`/`heartbeat`/`session_*` — there is no scan event. But `muster_attendance.in_method`
is the outcome itself, already recorded. That is the measure.

## Root cause

Not worker motivation. Not SA reluctance. **The scan path costs more taps than the path it
competes with**, and the SA correctly picks the cheaper one.

## Design

### U1 — continuous sweep (code-only)

The SA walks to a team's line, opens that team's sheet **once**, sweeps the camera down the line,
closes it, moves to the next team. Camera opens ~4–5 times a day instead of once per worker.

**The sheet stops closing on a successful decode.** That is the core change; everything else
exists to make an eyes-off sweep safe, because the SA is watching the line, not the screen.

**Non-visual feedback per outcome.** A short distinct beep plus `navigator.vibrate` — one cue for
added, another for already-in, a buzz for rejected. Without this the SA must look down after every
worker and the friction has merely moved.

**Running tally**, newest first, above the fold: `เพิ่มแล้ว N คน` with the most recent name largest.

**Per-badge cooldown, client-side.** The decode loop fires every 180ms and a badge stays in frame
while the SA moves on, so one badge would otherwise fire ~5 scans/second. Ignore a repeat of the
_same payload_ for ~3s. `muster_scan_in` is idempotent so there is no data damage, but the tally
would flood and it burns network on a site connection.

**Six outcomes. None tears down the camera.**

| Outcome                                    | Source                     | Response                                                                                                              |
| ------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Added, same team as last muster            | new row                    | success cue, name → tally                                                                                             |
| Added, **different team from last muster** | new row + prior-day lookup | success cue + amber `เมื่อวานอยู่ทีม X`                                                                               |
| Added, first ever muster                   | new row + prior-day lookup | success cue + neutral `ครั้งแรก`                                                                                      |
| Already in this team today                 | RPC returns existing id    | soft cue, `อยู่ในทีมแล้ว` chip                                                                                        |
| In **another team** today                  | `P0001`                    | warn cue, amber row naming the other team; `ย้ายมาทีมนี้` offered **after** the sweep (existing `move_muster_worker`) |
| Unknown / non-badge QR                     | `P0001`                    | warn cue, `ไม่รู้จักบัตรนี้`                                                                                          |

The "another team today" case is today a hard error that dumps the SA out of the sheet. Mid-sweep
it must be a line in the tally, not a modal in front of a queue of eight people.

**Team-change warning** compares against the worker's **last mustered day**, not calendar
yesterday — otherwise every worker warns after a weekend or a rain day. It **warns, never blocks**:
day-to-day team switching is normal and expected (operator, 2026-07-26). The prior-day lookup runs
**once when the sheet opens**, for the whole team roster; a per-scan query would stall the loop.

✅ **Gate-checked 2026-07-26 (live `pg_policies`):** the prior-day read needs no new DB object. Both
SELECT policies are project-scoped with **no date predicate** —
`muster_teams`: `can_see_project(project_id)`;
`muster_attendance`: `EXISTS (… muster_teams t WHERE t.id = team_id AND can_see_project(t.project_id))`.
The cockpit's today-lock is a UI constraint, not an RLS one, so `load-muster.ts` can fetch an
earlier date under the SA's own session. **U1 therefore stays code-only** — no DEFINER RPC, no
migration, no danger-path guard.

**Pinned action header**, always visible, never scrolls, stating the verb rather than a toggle
state:

```
กำลังเช็คเข้า · ทีมลุงนัน · งานปกติ
```

This is load-bearing beyond team identity. The cockpit carries เข้า/ออก and งานปกติ/OT toggles and
`scanFromCamera` dispatches on whichever is active. One-shot scanning makes a wrong mode
self-limiting; **a continuous sweep in ออก mode would check an entire team out in fifteen seconds,
silently.** The header must make the active action readable at a glance without hunting for a
highlighted button. Opening a different team re-states it on entry.

### U2 — camera-first default (code-only)

When `hasScannerSupport()` is true the sheet opens straight into the viewfinder. The tap list moves
behind a `ไม่มีบัตร / หาไม่เจอ` disclosure — always one tap away, its sheet-stays-open behaviour
untouched, because it is the lost-badge and phoneless safety net (spec 357 U-D's signal-removal
rule).

Devices without a camera are **unchanged**: tap list open, exactly as today.

## Sequencing

U1 → measure `in_method` for several mornings → U2 only if the QR share actually moves.

Shipping U2 first would hide the SA's only working path behind a disclosure in favour of one that
might stall. U2 is a legitimate nudge once scanning genuinely wins and a dark pattern before that.

⚠️ **On-device proof is still a single scan.** The gate on the deferral is field proof of the #745
decode loop, and the evidence on record is one successful decode whose device and decode path were
never recorded. Before U2, run one validation morning on the real pilot phone. If the jsQR loop
stalls there, U1 degrades to **continuous on native `BarcodeDetector`, one-shot on jsQR devices**,
and U2 does not ship.

## Testing

The camera loop itself stays untested (no `getUserMedia`/`BarcodeDetector`/video in jsdom), exactly
as today; the existing `tests/unit/muster-jsqr-decode` round-trip stays the decode proof.

Everything added here is deliberately kept **outside** the camera component so it is testable — a
pure reducer over `(scan event, roster, prior-day map) → tally state + cue`:

- outcome classification for all six rows above, RED-first
- per-badge cooldown suppresses a repeat inside the window and admits it after
- team-change warn fires on a differing prior team, stays silent on a matching one, and yields
  `ครั้งแรก` on no prior muster
- prior-day lookup resolves **last mustered day**, not calendar yesterday (pin a weekend gap)
- header renders the active mode verb; a mode change re-renders it
- RTL: tally order newest-first, warn rows render amber, sheet does **not** unmount on any outcome

Real-flow verification per unit gate 4: drive the sheet in a browser, then confirm on the live row
that `in_method='qr'` was written.

## Non-goals / deferred

- **Nova coins / attendance streak.** Separate concern with a separate actor. `coin_postings` is
  already `worker_id`-keyed with a ledger, dials and a shop, so a streak earn-rule is buildable —
  but it rewards _attendance_, not _scanning_, and must not be justified by this spec's metric.
- **SA / office self-check-in.** `muster_attendance.worker_id` is an FK to `workers`; office staff
  have no `workers` row, which is why วุฒิพงศ์ จันทร and อนัญญา ทวีบุตร could not be recorded on
  07-25. A genuinely new data domain — own spec.
- **Team-agnostic scanner.** Considered and **rejected by the operator**: the observed
  arrival-order working pattern is a practice being replaced, not a constraint. Teams line up
  separately each morning and the SA will scan each line in turn, so team-per-sheet is correct.
- **"Same as yesterday" bulk prefill.** Fastest possible morning, consciously rejected: it turns
  attendance into a copy of yesterday, the exact integrity failure that makes a scan worth having.
- **QR check-out.** `close_muster_day` already auto-outs every open regular session at 17:00
  Bangkok, so scanning people out may be work with no payoff. Open decision below.
- **Worker-facing anything.** No worker holds a device in this flow.

## Open decisions (operator, non-blocking for U1)

1. **Does check-out need the sweep too?** Real check-outs are 0-of-14 on QR, but the 17:00
   auto-out may already be good enough. Real out-times would only matter if pay or OT keyed off
   them — today nothing does (`labor_logs` is empty project-wide; 0 of 28 workers are
   cost-confirmed).
2. **Does the OT evening session get the sweep**, or regular-only? OT lines up differently (spec
   351 made it a separate session).
