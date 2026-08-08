# Spec 404 — ปฏิทินเข้างาน: โครงการรายวัน + แผงแก้ไขในหน้าเดียว

**Status:** 2026-08-08 — **U1 SHIPPED** (#1031, project honesty) · **U2 SHIPPED** (the in-page
`?fix=` panel, the two bands, the compact cell) · **U2b SHIPPED** (§4.5 — the panel fits its column,
and a blank day the project scanned becomes a door) · **U2c SHIPPED** (§4.6 — เข้า/ออก side by
side at every width) · **U3 open** (viewer-scope disclosure, §5).
**No schema in any of them.** Lanes `attncal` → `attnu1` → `attnu2`. Surface =
`/workers/[workerId]/attendance` (spec 374 U1). U2 retired the cell's door into
`/team/attendance/fix`; that route is unchanged and still serves every link minted elsewhere.

**Operator ask (2026-08-08),** on a screenshot of the August calendar for `นางสาว สายฝน เข็มวงศ์`:

> 1. A person can work in more than one project in the same month, how do we identify that?
> 2. In case of large screens, I suggest holding an edit panel on the right side opened, with
>    arrows left and right. Mobile could be a modal instead.

Two rulings were made in the same exchange and are SETTLED — do not re-litigate either:

- **Worker model = SEQUENTIAL MOVE ONLY.** One person is assigned to one project at a time; a
  MONTH may span projects, a DAY may not. This closes the ⚖️ shared-worker decision that has been
  open since the 2026-07-12 multi-project readiness audit.
- **Tablet renders as desktop.** One breakpoint at `md`, not `lg` (§4.1), at the price of a
  compact cell (§4.2).

---

## 1. Why — the split month is live, and the page already labels it wrongly

Measured live 2026-08-08, not inherited:

| Probe                                          | Result                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Active projects                                | **3** — `PRC-2026-004`, `-007`, `-008`                             |
| `worker_project_moves` rows                    | 48                                                                 |
| Workers with 2+ moves                          | **12**                                                             |
| Moves dated `2026-08-07`                       | **10**, all off `PRC-2026-004` onto `-007` / `-008`                |
| Those workers' August muster days              | 2–3 each, **all still at `PRC-2026-004`**                          |
| Muster worker-months spanning 2 projects       | 0 — because the moved workers have not yet scanned at the new site |
| `labor_logs` worker-months spanning 2 projects | 0                                                                  |

⚠️ **The two zeros are a "not yet", not a "never".** They flip the first morning a moved worker
scans at their new site. The 2026-07-12 audit assumed ONE active project; that premise is dead.

### 1.1 Three defects on the page today

The truthful grain already exists and is already loaded: `muster_teams.project_id` travels with
every attendance row, so **the DAY knows its project**. What is wrong is that the page asserts a
project at WORKER grain.

1. **The header lies after a move.** `worker.projectLabel` comes from `workers.project_id` — where
   the person is NOW. Open July for any of the 10 moved workers and the header reads
   `โครงการ PRC-2026-008` above a month worked entirely at `PRC-2026-004`.
2. **The cell badge inverts.** `worker-attendance-calendar.tsx` renders the day's project only when
   `data.projectName !== worker.projectLabel`. Before a move that is silence (correct); after a
   move every correct day is badged while the wrong header stays clean.
3. **The summary blends.** `มาทำงาน N วัน` and `ประมาณการค่าแรง` are single numbers across whatever
   projects the month contains, computed at TODAY's `day_rate` — and a move is exactly when a rate
   changes. `labor_logs.day_rate_snapshot` exists because of this.

---

## 2. The rule this spec builds to

> **The day owns the project. The worker header states an assignment, never a month's truth.**

`muster_attendance` is `UNIQUE (worker_id, work_date, session)` — firm-wide, not per project — so
two sites on one day in one session is unrepresentable at the schema level. Sequential move is
therefore not a constraint the UI must enforce; it is already the only expressible shape. What the
UI owes is honesty about which project each day belonged to.

---

## 3. U1 — project honesty (code only, no new reads)

Every fact needed is already in `loadWorkerAttendance`'s payload. This unit adds no query.

### 3.1 Header

Replace the single `โครงการ <current>` row with the month's ACTUAL composition, derived from the
month's muster rows:

- Month spans one project → `โครงการ` + that project, as today.
- Month spans 2+ → `โครงการเดือนนี้` + one line per project with its day count, ordered by days
  descending: `PRC-2026-004 · 12 วัน`.
- The person's current assignment differs from every project in the month → an extra muted line
  `ปัจจุบันอยู่ที่ <code>`. This is the only place `workers.project_id` may be shown, and it is
  labelled as an assignment rather than as the month's project.
- Month has zero muster rows → no project line at all (today's `projectLabel` fallback is dropped).

### 3.2 Cell badge

The badge condition becomes **"the month spans more than one project"**, not "this day differs from
the header". Within a split month EVERY day carrying attendance is badged; within a single-project
month none are. The comparison against `worker.projectLabel` is deleted.

The badge shows the project's **tail** (`004`), not the full code. `PRC-2026-` is constant across
all six projects and carries zero information in a 60px box (§4.2 makes that box real). The full
code stays in the header and in the fix panel.

### 3.3 Summary

`มาทำงาน` splits when the month spans 2+ projects: the total first, then one indented line per
project with its day count and its own OT subtotal. `ประมาณการค่าแรง` stays ONE number and gains
the qualifier it already deserves — it is `จำนวนวัน × ค่าแรง/วัน ปัจจุบัน`, so its label must say
`ปัจจุบัน`. It is NOT split per project (§7.1).

### 3.4 What U1 must not do

**No per-project money.** `wage_payments` has no project column (verified live 2026-08-08:
`worker_id, period_from, period_to, computed_amount, computed_days, paid_amount, paid_at, method,
reference, note, paid_by, superseded_by, correction_reason, created_at`). A per-project
`บันทึกค่าแรงแล้ว` or variance on this page would state a number `/payroll` cannot reproduce, and
the one-payment-per-`(worker, period)` shape blocks paying a split worker twice. That is the
2026-07-12 P0 and it is a schema unit, not this one. `บันทึกค่าแรงแล้ว` and `ต่างกัน` stay
month-total and unlabelled by project.

---

## 4. U2 — the inline fix panel (code only) — **SHIPPED 2026-08-08**

**Built as specified, with three decisions worth recording here rather than in the tracker alone:**

- §4.4's "the holiday name wraps or moves to the panel" resolved to a **legend under the grid**, not
  the panel: the panel is gated on `MUSTER_CORRECT_ROLES` and only renders while open, so moving the
  name there would have withheld it from exactly the readers who lost the `title` hover. The same
  legend decodes the two marker glyphs, and renders only on a month that carries them.
- §4.3's "the calendar can supply a project where an empty day has no session" is honoured **only
  when the month is unambiguous** (`fixPanelProjectId`). On an empty day of a split month there are
  two owners and no evidence, and the add arm books a wage against whichever it is handed — so it
  falls to §6 case 3 instead of guessing.
- **No independent scroller** was added, so §4.4's `touch-action` warning does not apply: the page
  scrolls and the panel column is as tall as it is.

⚠️ **§4.2's arithmetic is right and its CONCLUSION is only half true — measured, not derived.**
Driven in real Chrome with the panel open at 768 / 790 / 810 / 834 / 900 / 1024:

| what                      | result                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| marker glyphs (the ~40px) | land at **every** width                                              |
| merged `07:42–18:00` line | needs **~70px**; column is **66px usable at 834** ⇒ wraps to 2 lines |
| one line from             | **~880px** up                                                        |
| panel width to fit at 834 | would have to drop below **~190px** — cannot hold two time inputs    |

So the panel is `md:w-[280px] lg:w-[300px]`, the cell padding is `p-0.5` and the time line is
`tracking-tight` — which moves 900px from wrapping to fitting and leaves 768–880 at two lines.
**Nothing regresses**: two lines is exactly what this cell rendered before U2. The band is NOT moved
to `lg` — that is the rotation flip the operator ruled out. ⚑ If one line at 834 matters, the only
remaining levers are a narrower time format or dropping the grid to a day-list below `md` (§7.3,
open question ③).

Spec 400 U7 (#1026) already extracted `loadWorkerDayFix` + `WorkerDayFixPanel` and shipped a
URL-driven `?fix=` panel on `/team/attendance`, explicitly rejecting `<dialog>` because it pays the
same server round trip and costs the page its zero-JS property. **This unit adopts that shape on
the calendar. It invents no panel.**

- `?fix=<YYYY-MM-DD>` on the calendar's own route. Server Component, plain POST forms, redirect —
  no client JS, no hydration, shareable URL, working back button.
- Default **closed**. Opening with a panel already showing forces a default target, and "today" is
  not in the viewed month half the time — the same rule as U6a's "no time field ever has a default
  value".
- A day cell no longer navigates away, which retires the `withFrom(monthAnchor)` back-chip
  threading in `page.tsx`.
- `/team/attendance/fix` stays exactly as it is and keeps serving every link minted elsewhere.

### 4.5 U2b — the panel FITS its column, and a blank day gets a door — **SHIPPED 2026-08-08**

§4.2 sized the calendar CELL against the panel and never asked whether the PANEL's own contents
fit. They did not. The three forms inside `WorkerDayFixPanel` keyed their row-or-stack layouts on
`sm:` — a VIEWPORT query — while U2 docked the panel into a fixed 280–300px column, so at every
viewport ≥640px they took their WIDE layout inside a narrow box. Measured in real Chrome, with the
old instruction restored on the live page as the control:

| surface / width           | container | reason input usable | placeholder needs | verdict        |
| ------------------------- | --------- | ------------------- | ----------------- | -------------- |
| calendar, OLD layout      | 246       | **63**              | 154               | CLIPPED        |
| calendar 768–900          | 246       | **188**             | 154               | fits, stacked  |
| calendar 1024–1194        | 306       | **248**             | 154               | fits, stacked  |
| /team/attendance dock     | 760–1078  | 577–895             | 154               | fits, ROW kept |
| /team/attendance/fix 375  | 335       | 277                 | 154               | fits, stacked  |
| /team/attendance/fix 500+ | 460–1112  | 277–929             | 154               | fits, ROW kept |

⚠️ **One behaviour change on the two WIDE surfaces, stated rather than buried:** the row/stack
boundary moves from viewport 640 (`sm:`) to container 448, which is ≈488px of viewport on
`/team/attendance/fix` and ≈520 on the day panel. Those surfaces therefore ROW in the 488–640 band
where they previously stacked — measured to fit (277px of usable reason input at container 460), and
it is the point of keying on the box.

`63` against `154` is the truncated `เช่น ลงเวลาไ` on the operator's screenshot; the same cause
produced the ragged `เวลาเข้าใหม่` / `เวลาออกใหม่` alignment.

**Fix: container queries — the repo's first, established deliberately.** `sm:` → `@md:` in the two
forms with a real row/stack decision, and the `@container` is declared **by the panel**, not by its
doors, so the forms measure exactly the box they are in and a fourth door cannot forget. The `lg`
panel width goes 300 → 340 (measured: still ~108px per calendar column at 1194 against the 60 the
cell needs). ⚠️ `MusterReopenForm` has THREE renderers, not one — `attendance-day-panel` and
`attendance-drill` would have silently stacked, and both now declare their own container.

**§4.3's "an empty day is still reachable by clicking its cell" was never built, and now is.**
Operator ruling 2026-08-08: mirror `/team/attendance`'s gap-cell rule, do not invent a second one.
`calendarBlankDayFixable` DELEGATES to `gridCellFixable`; the only thing it owns is the mapping
(`canFixGaps` ⇒ the month is unambiguous, `headcount` ⇒ workers the resolved project scanned that
date, `nonWorking` ⇒ holiday-or-Sunday, NOT the calendar's own `isWeekend`). It costs ONE new read,
bought only when the viewer may correct AND the month names exactly one project.

Live August 2026 for a worker who missed one day: doors are her `08-02, 08-03, 08-05` **plus
`08-04`** — one new tap target, not the ~24 a link-every-blank rule would paint, and `08-06`–`08-31`
(zero teams) are excluded so the calendar never offers a day the add path would refuse with
`ยังไม่มีทีมของวันดังกล่าว`. The blank door carries the grid's own `+` mark and its `sr-only`
purpose reads `เพิ่มคนที่ตกหล่น` — there is no เช็คชื่อ on that day to แก้ไข. Blank doors JOIN
`doorDates`, so the steppers keep their invariant that the two controls never disagree about what
the month holds.

⚑ **Owed, measured, out of scope here:** the panel is **962px tall at 280px against a 900px
viewport** (897 at 340) with its only navigation at `top:155`, so scrolling to the form puts the
exit off screen — and stacking the forms correctly made it 52px taller. A sticky strip needs a
header-offset token this repo does not have (`DetailHeader` is 118px, `sticky top-0 z-20`), so it
is its own unit rather than a magic number.

### 4.6 U2c — เข้า and ออก are ONE RANGE — **SHIPPED 2026-08-08**

Operator, on U2b: _"เข้าออก side by side is better"_. U2b correctly stopped the retime form taking
its wide layout inside the 280–340px docked panel, but the narrow fallback **stacked** the two time
fields — and they are a pair the corrector is replacing together, not two independent questions.
They now share a wrapper that is a row **unconditionally**; the rest of the form still stacks.

⭐ **It only just fits, and it took THREE probes to get an honest number.** Chrome's native
`type="time"` control has a fixed intrinsic width of `100px + horizontal padding` at 15px, and it
**clips silently** — `scrollWidth` never grows on an `<input>`, so the first check ("no clipping down
to 60px") was the instrument, not the app. Only `min-content` can answer.

The second probe was worse: it reported a comfortable fit, because the class list had been built
with `cn(FIELD_INPUT, …)` and **tailwind-merge classifies `text-body` in its text-COLOUR group**, so
it silently deleted `text-body` along with `px-3`. Tailwind's preflight sets `font: inherit` on
`input`, so the control inherited its label's `text-[11px]` and rendered at **11px** — and the whole
geometry was then measured at the wrong font. Hence `FIELD_INPUT_TIME`, a derived constant, and a
test that pins `text-body` PRESENT.

Measured at the design 15px, in the real (doubly-carded) panel box:

| panel `md` width | field box | `px-3` = 124 | `px-2` = 116 | `px-1` = 108 | cells wrapped 768 / 834 / 900 |
| ---------------- | --------- | ------------ | ------------ | ------------ | ----------------------------- |
| 280 (U2b)        | **102**   | ✗            | ✗            | ✗            | 1/3 · 1/3 · 0/3               |
| **300 (U2c)**    | **112**   | ✗            | ✗            | **✓ +4**     | **1/3 · 1/3 · 0/3**           |
| 320              | 122       | ✗            | ✓ +6         | ✓            | 3/3 · 1/3 · 0/3               |

So the pair needs BOTH `px-1` and the panel at 300 — and 300 is free: the grid wraps exactly as it
did at 280 at all three widths, while 320 would have cost 768 three wrapped cells. It also returns
to §4.2's own arithmetic, which assumed 300. Final live check, 9 measurements across all three
surfaces: 15px everywhere, `sameRow` and `sameBottom` true everywhere, nothing clipped; the two wide
surfaces unchanged at 128px/`px-3`.

### 4.1 Breakpoints — two bands, tablet is desktop

| Band             | Width        | Layout                                               |
| ---------------- | ------------ | ---------------------------------------------------- |
| phone            | `<md` (<768) | panel REPLACES the calendar (full width, same route) |
| tablet + desktop | `md+` (≥768) | side by side; panel ~300px fixed, calendar flexes    |

The split is at `md`, not `lg`, **because a tablet is two widths and it changes under the user's
hand**: iPad Pro 11 is 1194 landscape / 834 portrait, iPad 10.9 is 1180 / 820. A `lg:` split would
appear in landscape and vanish in portrait on the same device. iPad mini portrait (744px) is the
one device that falls into the phone band, which is correct for a 744px screen.

⚠️ **The operator's own screenshot is ~1194 CSS px landscape.** That figure is DERIVED, not
measured: the week rows sit at the enforced `min-h-16` and the content is capped at
`lg:max-w-6xl`, which fixes the image scale. **`interaction_events.context` carries no viewport and
no orientation** (live keys: `where, recurred, kind, reason, status, digest, stage, message`), so
device mix on this page is currently unmeasurable — see §7.4.

### 4.2 The compact cell (the price of `md`)

Worst case is iPad portrait:

```
834  viewport
-40  px-5 page padding
-16  column gap
-300 panel floor (time inputs + buttons)
────
 478 calendar  ÷ 7 = 68px per column, minus p-1 = 60px usable
```

At 10px, `17:00 (อัตโนมัติ)` needs ~80px and `PRC-2026-004` ~58px. So the cell shrinks — and the
shrunk cell becomes the ONLY cell, at every width:

- **One time line**: `08:15–17:00` (~55px) instead of two stacked lines.
- **Markers become glyphs**: `(อัตโนมัติ)` and `(+1 วัน)` render as icons. Their words move into the
  panel, which at `md+` is always on screen. Desktop loses the spelled-out words too — accepted.
- **Project badge is the tail** (§3.2), ~18px instead of ~58px.
- `ทำงานวันหยุด` and `บันทึกมือ` are unchanged; both already fit.

### 4.3 Arrows — name the axis

The grid's walk is **next PERSON within a day**; the calendar's is **next DAY for one person**.
Same control, opposite axis, one shared component — so the calendar's steppers are labelled
`วันก่อนหน้า` / `วันถัดไป` (visible text or `aria-label`), never bare chevrons.

They step to the next **DOOR**, skipping every other blank cell: stepping through 20 blank days is
the cry-wolf failure U6b already ruled against. ⚠️ **U2b (§4.5) widened what a door is** — a blank
day the resolved project scanned other people on is now one, and joins the stepper walk, so this
line no longer reads "a day that carries attendance". An empty day is reachable by clicking its
cell — and here the calendar can do something the standalone fix screen structurally cannot,
because it knows the month's project set and can supply a project where an empty day has no session
to infer one from.

### 4.4 `title=` is not a fallback on a tablet

Two present defects, live today on the operator's own device, fixed in this unit because the cell is
being rewritten anyway:

- the holiday name is truncated with the full text only in `title=`;
- the fix link's entire purpose (`แก้ไขการเช็คชื่อ 5 ส.ค.`) is in `title=`.

Both comments justify it as "desktop back-office, where hover is real". There is no hover on an
iPad. The holiday name wraps or moves to the panel; the link's purpose is carried by the panel's own
heading once the cell opens it in place.

⚠️ **A panel that scrolls independently is a NEW scroller.** Before shipping, read
`prc-ops-touch-action-scroll-rows`: a tall scroller needs `manipulation` or vertical scroll dies on
touch, and making an element scrollable re-homes its `absolute` children.

⚠️ **`aria-label` on the day link stays FORBIDDEN.** It replaces the link's subtree as the
accessible name and would drop the times, OT, markers and badge — the exact defect U6b caught.

---

## 5. U3 — viewer-scope disclosure

`loadWorkerAttendance` filters muster to the viewer's memberships for any role outside
`viewerSeesAllMusterProjects`. A project manager who is a member of `-008` opens a moved worker and
sees the `-004` days simply MISSING — indistinguishable from "he did not come to work".

U3 renders, when and only when rows were withheld, a muted line under the summary:
`อีก N วันอยู่ในโครงการที่คุณไม่มีสิทธิ์เห็น`. The count comes from a second, membership-free
`count` on the same admin client — it discloses a NUMBER, never a project name or a date.

This is the same class as spec 400's finding that an event-derived report is structurally blind to
absence. Without it, every number on this page is wrong for the reader most likely to act on it.

---

## 6. Negative cases, messages, recovery

| #   | Mode                                                             | Thai string                                                                                  | Recovery                                                                                             |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `?fix=` carries a date outside the viewed month                  | `วันที่เลือกไม่อยู่ในเดือนนี้`                                                               | Panel does not open; the calendar renders normally. No retry promise — it is permanent for that URL. |
| 2   | `?fix=` is not a valid ISO date                                  | `ลิงก์ไม่ถูกต้อง` (existing `parseFixParams` behaviour)                                      | Panel does not open.                                                                                 |
| 3   | `?fix=` names an empty day and the month has no project to infer | `วันนี้ยังไม่มีการเช็คชื่อ และยังไม่ทราบโครงการ — เปิดจากหน้าตารางเช็คชื่อแทน`               | Permanent; names the surface that can resolve it. Never `ลองใหม่`.                                   |
| 4   | Retime / add / delete / reopen failure                           | Reuse `RETIME_ERROR_COPY`, `ADD_ERROR_COPY`, `UNDO_ERROR_COPY`, `REOPEN_ERROR_COPY` verbatim | Unchanged from U6a/U7. **Invent no new copy here.**                                                  |
| 5   | Month has zero muster rows                                       | `เดือนนี้ยังไม่มีการเช็คชื่อ`                                                                | Nothing to fix; steppers still work.                                                                 |
| 6   | Split month, one project contributes 0 days after a filter       | Not reachable — the split is derived from the rows present.                                  | —                                                                                                    |
| 7   | Viewer's memberships hide the whole month                        | U3's line renders with the full count and the summary reads 0                                | The line is the recovery: it tells them the zero is not absence.                                     |

Strings used on 2+ surfaces go to `src/lib/i18n/labels.ts`. `วันก่อนหน้า` / `วันถัดไป` are already
generic enough to belong there if a second surface adopts them; a single use stays local.

---

## 7. Out of scope, and why

1. **Per-project money.** §3.4. Blocked on the `wage_payments` project dimension — a schema unit and
   an operator call, since it also needs the `(worker, period)` uniqueness widened.
2. **Concurrent multi-project assignment.** Ruled out 2026-08-08 (§0). Would require rethinking the
   muster unique key, the roster reads, `sa_add_project_worker`'s firm-wide national-ID rule, and
   payroll splitting.
3. **A phone day-list view.** The `<md` band currently keeps the 7-column grid; at 375px it is
   genuinely unreadable, but replacing it is its own unit with its own design, not a rider on this
   one. U2 makes the panel work there; the calendar underneath is unchanged.
4. **Viewport / orientation telemetry.** `route_view` context stores neither, so every layout
   decision in §4 is derived from a screenshot rather than measured. Adding them is cheap and would
   make the next layout call evidence-based — recorded here, not built here.
5. **Rate snapshotting in the estimate.** The estimate uses the current `day_rate` and says so
   (§3.3). Using `day_rate_snapshot` per day is correct but changes what the number MEANS, so it
   belongs with the money unit.

---

## 8. Open operator questions

1. §3.3 — should `ประมาณการค่าแรง` be suppressed entirely in a split month rather than shown as one
   current-rate number? Suppressing is more honest; showing it keeps the page useful for the common
   single-project case. Recommendation: show it, labelled `ปัจจุบัน`.
2. §4.2 — the compact cell removes the spelled-out `(อัตโนมัติ)` on DESKTOP as well, to keep one
   cell everywhere. Acceptable, or does desktop keep the words?
3. §7.3 — is a phone day-list wanted at all, or is this page understood as tablet-and-up?

---

## 9. Acceptance

Run after U1, on production:

```sql
-- Worker-months that MUST render the split header. Zero today; non-zero is the trigger.
select count(*) from (
  select ma.worker_id, to_char(ma.work_date,'YYYY-MM') mo
  from muster_attendance ma join muster_teams mt on mt.id = ma.team_id
  group by 1,2 having count(distinct mt.project_id) > 1
) d;

-- Workers whose CURRENT project differs from where they worked this month
-- (these are the rows whose header is wrong today).
select w.name, p.code as assigned_now,
       (select string_agg(distinct p2.code, ',')
          from muster_attendance ma
          join muster_teams mt on mt.id = ma.team_id
          join projects p2 on p2.id = mt.project_id
         where ma.worker_id = w.id and ma.work_date >= date_trunc('month', now())) as worked_this_month
from workers w join projects p on p.id = w.project_id
where w.id in (select worker_id from worker_project_moves group by 1 having count(*) > 1);
```

After U2: `interaction_events` cannot see `?fix=` (the route stores no query string — standing
limitation recorded in spec 400). Acceptance is the audit trail instead: corrections whose
`audit_log` rows arrive in a tighter cluster than the ~24s-per-edit baseline #1026 measured on the
grid.
