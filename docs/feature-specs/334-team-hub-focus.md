# Spec 334 — /team hub focus (ทีมงาน: วันนี้ ก่อน)

Status: approved (operator, 2026-07-21 in chat — "SA don't know where to focus on
Team page, too much information on the same page"; design + before/after mockup
presented and approved. Two forks answered explicitly: page purpose = **วันนี้ /
who is on site today** · check-in **stays in the project cockpit**, the hub only
gets a bigger door).

## Why

`/team` (spec 313 U1) absorbed five surfaces at once — the muster CTA, the add-ช่าง
sheet, badge printing, the staged onboarding roster, and the site team board — and
stacked them on one page. For a `site_admin` on prod that renders roughly thirty
rows, of which **three** are things the SA can act on.

Telemetry, `interaction_events` route_view, 21 days to 2026-07-21:

| path                     |   n |
| ------------------------ | --: |
| `/sa` → `/team` → `/sa`  |  32 |
| `/team` → end of session |  22 |
| `/team` → `/projects`    |   7 |
| `/team` → muster cockpit |   4 |
| `/team` → `/team/badges` |   2 |

~90 site_admin visits; ~54 bounce back to the role home or end the session. The
page's own primary CTA converts at about 5%. The operator's report is the measured
behaviour, not an impression.

Three causes, in order of size:

1. **The biggest block is not the SA's job.** `CrewProgressRoster`'s รอยืนยัน gate
   renders every active worker whose `cost_confirmed_at` is null under the hint
   "รอ PM ยืนยันค่าแรง/ระดับ". On prod that is **26 of 26** active workers
   (`ready = 0`), so the largest thing on the page is a 26-name list waiting on a
   PM, with no SA affordance attached.
2. **The same people render twice.** `CrewProgressRoster` lists them by onboarding
   gate; `SiteTeamBoard` lists them again by crew (plus ยังไม่ได้จัดทีม). Two
   components, one population.
3. **The one action that matters is a flat text button** competing with four
   other flat text buttons, and it leads to a cockpit four steps from a first scan.

That third point is load-bearing: `muster_attendance` holds **0 rows all-time**
(1 team ever opened, on 2026-07-15, the pilot-kit day; 1 day closure; zero scans).
`labor_logs` is likewise 0 all-time. Attendance is the firm's one adoption bet —
payroll, the ADR 0060 profit-sharing model and spec 271 incentives all need it — so
the hub's job is to make starting it the obvious thing, and to look correct while
the number is still zero.

## Decisions (locked in the 2026-07-21 design chat)

| #   | Decision                                                            | Consequence                                                                     |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| D1  | The hub's subject is **วันนี้** — who is on site today              | The attendance state, not the roster, is the top of the page                    |
| D2  | Check-in **stays** at `/projects/:id/muster`                        | One write path; the hub is read-only over the muster tables                     |
| D3  | Every remaining destination is an **icon tile with a count bubble** | Doors are scannable at a glance instead of read line by line                    |
| D4  | The bubble colour encodes **ownership**, not severity               | danger = SA must act · warning = SA may act · neutral = reference · none = tool |
| D5  | รอยืนยัน leaves the hub entirely                                    | It becomes a per-name chip on the roster page                                   |
| D6  | The roster gets **its own route** `/team/roster`                    | Hub stays short; one more tap for reference data                                |
| D7  | เพิ่มช่าง and QR สมัคร are **two tiles** over one sheet             | Surfaces the spec-328 pilot path without a second sheet                         |

## Not in scope (recorded so nobody re-adds them)

- **No schema.** Every read this spec adds is a SELECT over existing tables with
  existing RLS (verified live 2026-07-21: `muster_teams` / `muster_day_closures`
  gate on `can_see_project(project_id)`, `muster_attendance` / `muster_team_wps`
  gate through their team's project — a `site_admin` already reads all four).
- **No new write path.** The cockpit keeps `muster_scan_in` / `_out` / `open` /
  `close`. The hub never writes.
- **No change to the muster cockpit** (`/projects/:id/muster`) or to the spec-330
  project team map (`/projects/:projectId/team`, PM_ROLES-gated — a `site_admin`
  cannot reach it, so it is not an alternative home for the roster).
- **No check-in on `/projects/:id`.** Relocating attendance beside the photo loop
  (the 2026-07-08 strategy memo's option) is a larger bet; deliberately deferred.
- **No role gain or loss.** Every role that has a door on `/team` today keeps it.

## Model

No tables, no columns, no RPCs. One new pure shaper plus one light loader:

```
src/lib/muster/day-summary.ts
  export interface MusterDaySummary {
    state: "not_started" | "open" | "closed";
    present: number;   // distinct workers with in_at today
    expected: number;  // active workers on the project
    closedAt: string | null;
  }
  export function summariseMusterDay(raw): MusterDaySummary   // pure, unit-tested
  export async function loadMusterDaySummary(supabase, projectId, date)
```

Deliberately NOT `loadMusterBoard` (spec 306): that loads every team, member,
worker name and work package for the cockpit's editing surface. The hub needs
three numbers, so it gets its own narrow read — teams-today ids, a distinct
attendance count over those ids, the closure row, and the active-worker count.

`present` counts **distinct `worker_id`**, not attendance rows: a worker moved
between teams during the day has a row per team (`moveMusterWorker`, spec 306 U2),
and the headline must not double-count them.

`expected` is scoped to the **current project**, not the firm. On prod today that
is 25 (TFM โพธิ์ทอง) of 26 active workers — the 26th is a `project_id is null`
staff row. The Why section's "26 of 26" is the firm-wide figure the hub's retired
รอยืนยัน block was rendering; the hero deliberately shows the project number,
because attendance is a per-site act.

## Units

### U1 — วันนี้ hero card

`<MusterTodayCard>` replaces the flat เช็คชื่อ link at the top of `/team`, rendered
only when the SA has a resolved current project (`getSaCurrentProject`, spec 292 —
already read on this page). Shows the project name, the Bangkok date
(`bangkokTodayIso`), the headline count, and one action.

| state         | headline                                       | action                    | condition                                   |
| ------------- | ---------------------------------------------- | ------------------------- | ------------------------------------------- |
| `not_started` | `0 / 25 มาทำงาน` + `ยังไม่มีใครเช็คชื่อวันนี้` | `เริ่มเช็คชื่อ` (primary) | no `muster_teams` row for the project today |
| `open`        | `12 / 25 มาทำงาน`                              | `ไปหน้าเช็คชื่อ`          | team(s) open, no closure                    |
| `closed`      | `ปิดวันแล้ว · มาทำงาน 18 คน`                   | `ดูรายละเอียด` (quiet)    | a `muster_day_closures` row for today       |

Both actions link to `musterHref(projectId)` — the cockpit is unchanged.

**Negative cases**

| mode                                     | user sees                                                                       | recovery                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| SA has no visible project                | card not rendered (today's behaviour for the CTA)                               | nothing to do; the tiles below still render           |
| project has 0 active workers             | `ยังไม่มีช่างในโครงการนี้` in place of the count; `เริ่มเช็คชื่อ` still offered | tap เพิ่มช่าง (U3 tile)                               |
| any muster read returns an error or null | card falls back to `not_started` — **never throws, never blanks the hub**       | tap เริ่มเช็คชื่อ; the cockpit is the source of truth |
| day closed with zero attendance          | `ปิดวันแล้ว · ไม่มีคนมาทำงาน`                                                   | reopen is a cockpit concern; not offered here         |
| worker present on two teams              | counted once (distinct `worker_id`)                                             | n/a — invariant, asserted in the shaper test          |

**Strings** — `เริ่มเช็คชื่อ`, `ไปหน้าเช็คชื่อ`, `มาทำงาน`, `ยังไม่มีใครเช็คชื่อวันนี้`,
`ยังไม่มีช่างในโครงการนี้`, `ไม่มีคนมาทำงาน` are new. **`ปิดวันแล้ว` already exists as a
literal in `muster-cockpit.tsx:138`** — this card is its second surface, so it moves
to `src/lib/i18n/labels.ts` as `MUSTER_DAY_CLOSED_LABEL` and the cockpit consumes it
(UI-term SSOT rule). `MUSTER_LABEL` ("เช็คชื่อ") stays as it is.

**RED first:** `summariseMusterDay` state machine (three states + the distinct-worker
case + the zero-expected case) as pure unit tests; `<MusterTodayCard>` render per
state via RTL.

### U2 — `/team/roster`, the merged roster

New route, same role gate as `/team` (`TEAM_PAGE_ROLES`, composed at the call site —
no new auth set). One list grouped by the existing `buildSiteTeamBoard` buckets
(ทีมภายใน · ทีมภายนอก · ฝ่ายไซต์ · ยังไม่ได้จัดทีม), each name carrying the status chips
that `CrewProgressRoster` used to own as separate sections:

- `รอ PM ยืนยัน` — `cost_confirmed_at is null`
- `รอ PM กรอกบัญชี` — the existing `BANK_PENDING_CHIP_LABEL` (spec 298 U2)
- the worker level badge, when set

`CrewProgressRoster` is deleted; its รอตรวจ gate becomes the คำขอสมัคร tile's bubble
(U3) and its two remaining gates become chips here. `SiteTeamBoard` moves to this
route unchanged apart from accepting the chips. It is a detail page, so it carries
`DetailHeader` with a back chip to `/team` — not hub chrome.

**Negative cases**

| mode                                       | user sees                                                 | recovery                               |
| ------------------------------------------ | --------------------------------------------------------- | -------------------------------------- |
| no workers at all                          | `ยังไม่มีช่างในระบบ — เพิ่มช่างจากหน้าทีมงาน`             | back chip → เพิ่มช่าง tile             |
| workers exist, no crews                    | everyone under ยังไม่ได้จัดทีม; no empty buckets rendered | jump to the cockpit/plan to form teams |
| a role in the gate with no visible project | empty state, same string                                  | n/a                                    |
| direct URL by an out-of-gate role          | `requireRole` redirect, as every other route              | n/a                                    |

**RED first:** the bucket + chip mapping as a pure test over `buildSiteTeamBoard`
output; RTL for the empty state and for a member row carrying two chips at once.

### U3 — the hub recompose

`/team` becomes: hero (U1) → tile grid → nothing else.

| tile                 | icon              | bubble                            | destination                                                                                                                        |
| -------------------- | ----------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| คำขอสมัคร            | user-check        | **danger**, pending registrations | `/sa/registrations` (site_admin) or `/registrations` (approvers), referrer threaded                                                |
| ยังไม่จัดทีม         | users-plus        | **warning**, unassigned count     | `/team/roster`                                                                                                                     |
| รายชื่อทีม           | users-group       | **neutral**, active-worker count  | `/team/roster`                                                                                                                     |
| เพิ่มช่าง            | user-plus         | none                              | the existing `AddTechnicianSheet`                                                                                                  |
| บัตร QR              | id-badge          | none                              | `/team/badges`                                                                                                                     |
| QR สมัคร             | qrcode            | none                              | the same `AddTechnicianSheet`, opened pre-branched to its `has_phone` (QR) mode — one sheet, two entry points, no second component |
| รายชื่อช่าง / ค่าแรง | hard-hat / wallet | none                              | `/workers`, `/payroll` — back-office roles only, unchanged targets                                                                 |

Rules: **a zero count renders no bubble** (never a "0" chip). Tiles the role has no
door for are not rendered. `CrewProgressRoster` and the inline `SiteTeamBoard` block
both leave the hub in this unit — that is the change that takes the page from ~30
rows to ~9.

**Negative cases**

| mode                                 | user sees                                                      | recovery                                           |
| ------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------- |
| every count zero                     | tiles with no bubbles; hub still renders                       | n/a                                                |
| SA with no project                   | tile grid only (hero hidden per U1)                            | n/a                                                |
| non-crew role (procurement, PM tier) | only their own tiles; no crew reads run                        | n/a                                                |
| registrations read fails             | คำขอสมัคร tile renders bubble-less rather than the hub failing | tap through; the queue page reports the real error |

**RED first:** bubble-suppression at zero; per-role tile sets (site_admin,
super_admin, procurement, a back-office role) asserted against the role SSOTs, not
hardcoded lists; the two retired blocks asserted **absent** from the hub by their
own component names, mutation-checked in both directions.

### U4 — pins, map and help honesty

- Guard pins for the new tile SSOT + the `/team/roster` route in the nav-back
  affordance classification.
- `docs/site-map.md` rows for `/team` (changed) and `/team/roster` (new).
- `src/lib/sa/help-content.ts` — the ทีมงาน/muster cards are gate-checked against
  the components as they exist after U3 (doctrine: prose that instructs a user is a
  factual claim about affordances on screen; spec 313 U7 shipped four wrong steps
  written from memory). Any card naming a retired affordance is rewritten against
  the real labels, and pinned by an assertion on the nav/label SSOTs.

**Negative cases:** none new — this unit adds no user-facing behaviour. Its failure
mode is a stale instruction, which the pins exist to catch.

## Verification

1. `pnpm lint && pnpm typecheck && pnpm test` green per unit.
2. Real-flow browser drive as `site_admin` (dev-preview login, spec-292 current
   project = TFM โพธิ์ทอง): hub renders hero at `0 / 25`, tiles show 3 on คำขอสมัคร,
   roster opens grouped with chips, back chip returns to `/team`, zero console errors.
3. State coverage that fixtures cannot prove: open a muster team in the cockpit,
   return to `/team`, confirm the hero flips `not_started → open` with the right
   count; close the day, confirm `closed`. Clean up the test rows.
4. Post-ship, ~7 days: re-run the route-transition query in the Why section. The
   success signal is not "the page looks better" — it is `/team → muster cockpit`
   rising against `/team → /sa`, and `muster_attendance` leaving zero.

## Open questions (surfaced, not implemented)

- **`docs/feature-specs/README.md` is stale by two specs** — 332 and 333 shipped
  without index rows (verified 2026-07-21). Out of scope here; worth a one-line
  backfill by whoever touches the index next.
- **`/team`'s N×M QR generation** (projects × active contractors, rendered server-
  side per request) is already flagged in the backlog as needing memoisation before
  project #2. U3 keeps the same cards behind a tile; it neither fixes nor worsens
  this. Left for its own unit.
- **If the hero still reads `0 /` after a week of the ช่างอวย pilot**, the leak is
  not the hub and D2 should be revisited — the 2026-07-08 memo's option of putting
  check-in on `/projects/:id`, beside the photo loop, becomes the next bet.
