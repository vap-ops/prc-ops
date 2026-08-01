# 388 — ช่าง nav: two tabs, and ประวัติ becomes attendance

**Operator, 2026-08-01:** _"redesign technician's nav system"_, scoped in chat to
**the bar itself** (capability set unchanged), then _"for now, only check in/out
ontime/delay"_ for the second destination.

The on-site sibling of [376](376-onsite-nav.md), whose U3 gave the role its
first three-tab bar two days earlier (2026-07-30, #855). This spec does not
reverse that decision — the split of daily-vs-rest was right. It corrects **what
the second destination is**, using the two days of telemetry U3 did not have.

---

## §1 — Why the bar is wrong, measured

Every number below was queried live on 2026-08-01, not read from a document.

| Signal | Live value |
|---|---|
| `/technician` route views | **38 all-time**, 6 distinct people (31 in the last 30 days) |
| `/technician/history` route views | **0 — all-time.** The tab has never been opened by anyone since it shipped 07-30 |
| Write events by a `technician` (30d) | **0.** `interaction_events` holds only `heartbeat` (141), `session_end` (64), `session_start` (55), `route_view` (44), `js_error` (2) |
| `technician` users | 13 (6 opened the app at all in 30 days) |
| Active workers bound to a login | **14 of 31** |
| Muster scans (30d) | **189 scans · 29 distinct workers · 7 work days** |
| Photos (30d) | 2,342 — every one taken by an SA, none by a ช่าง |

Read together: **29 ช่าง turn up and are recorded; 6 ever open the app; the one
page they open is the QR badge; the second tab has never been opened.** The bar
is not failing to route people — the destinations behind two of its three tabs
are empty.

### The three tabs, audited against live rows

**ประวัติ `/technician/history` — two of its three sections are empty by
construction, not by chance.**

| Section | Live rows |
|---|---|
| Wage-payment history | `wage_payments` = **0 all-time** (`labor_logs` is 0 too — the 306 money wall blocks every worker until the cost-confirm data op) |
| Bank change-request state | `worker_bank_change_requests where status='pending'` = **0** |
| รายการรอรับ (materials awaiting acknowledgement) | **39 pending, 11 of them addressed to a worker who has a login**, 7 receivers, issued 07-02 → 07-31 |

So the tab's only live content is รายการรอรับ — and **that is the only write a
ช่าง owns anywhere in the app.** It has been sitting behind a money-labelled tab
that nobody has ever tapped. That single fact explains the "0 writes in 30 days"
row above better than any nav theory.

**โปรไฟล์ `/profile` — a drill-down serving as a tab.** It renders
`DetailHeader backHref="/settings"`, and re-renders two things `/technician`
already shows: the same `WorkerBadgeQr` (identical payload — `current_user_worker_id`)
and an employee card. Its only unique content is the display-name editor.
`technician` is the app's **only** role whose tab lands on a detail page.

**หน้าหลัก `/technician` — its second block is permanently empty.**
`AssignedWorkCard` reads `get_my_assigned_work`, which joins `muster_team_wps`
off the caller's latest muster team. That table holds **5 links across 27 teams**,
and **0 of the 13 bound workers' latest teams have any** — so the card renders its
empty state for 13 of 13, every time.

---

## §2 — Decisions

- **D1 — the bar goes 3 → 2: หน้าหลัก `/technician` · ตั้งค่า `/settings`.**
  The desktop strip (`TECHNICIAN_HUB_NAV`) mirrors it one-for-one, nav law rule 2.
  โปรไฟล์ leaves the bar and becomes what its own back chip has always said it
  was — a `/settings` leaf. It keeps lighting a tab with **no new match entry**:
  `SETTINGS_TAB.match` already contains `/profile` (`bottom-tab-bar.tsx:59`),
  shared by every other role.

- **D2 — a ช่าง gets a settings door.** This closes the 🔔 decision left open by
  [#856](https://github.com/vap-ops/prc-ops/pull/856) on 07-30, where `technician`
  was found to be the only nav-rendering role whose set omits `/settings`, making
  `/profile`'s back chip their sole path to `/settings/my-info`,
  `/settings/notifications` and `/feedback`. Verified the destination is not a
  blank page for them: the `my-info` section is pinned visible for **every** role
  (`settings-sections.test.ts` §my-info), and `help` → `/feedback` likewise.
  `/settings` carries no role gate at all today (no `middleware.ts` in the repo),
  so this makes an existing capability **visible**; it grants nothing new.

- **D3 — ประวัติ means attendance, not money** (operator, verbatim: _"for now,
  only check in/out ontime/delay"_). `/technician/history` becomes the ช่าง's own
  check-in/check-out record. It is the one subject with real rows — 189 in eight
  days against 0 wage payments all-time — and the only question a ช่าง has ever
  been able to ask about their own work that the app could answer and doesn't.

- **D4 — the money content leaves that page, and the bank goes back to
  `/technician`.** ⚠️ **This reverses half of 376 U3 deliberately, because U3 left
  a live copy bug behind it.** `/settings/my-info` refuses to host a bound ช่าง's
  bank on purpose (comment, 2026-07-14 fresh-eyes: _"a bound ช่าง's home is
  /technician … surfacing two bank homes for one person invites drift"_) and
  instead renders a card reading **"แก้ไขข้อมูลติดต่อ เอกสาร และบัญชีธนาคารได้ที่
  หน้าหลักช่าง"**, linking to `/technician`. U3 then moved the bank OFF
  `/technician` to `/technician/history` — so that card has been pointing at a
  page with no bank on it since 07-30. Moving the bank back into the identity
  block on `/technician` makes the existing pointer true again, rather than
  adding a third surface that names it.
  The wage-payment list moves back to `/technician` too, but **renders only when
  the caller has ≥1 payment** — 0 rows today, so it is invisible, and it restores
  itself the day payroll starts producing rows. `for now` is implemented
  literally, with nothing deleted.
  *Rejected, recorded:* making `/settings/my-info` the ช่าง's identity+bank home
  (which the two-tab split argues for — daily vs me). It is a larger relocation
  that touches contractor parity on `/portal`, and it contradicts a decision that
  was made deliberately with a reason. Revisit if the identity block outgrows the
  home page.

- **D5 — รายการรอรับ moves up to `/technician`, directly under the QR.** 11 live
  rows, oldest issued 07-02. It is the role's only write; it belongs on the only
  page they open, not behind a tab.

- **D6 — the late rule: 08:00 start, 15 minutes' grace ⇒ สาย from 08:15**,
  regular session only. Derivation in §3. A constant in one pure module, **no
  schema column** — there is exactly one live project and the rule is a policy the
  operator may change; a column costs a migration to move and would still be
  unpopulated for every other project.

- **D7 — a verdict is rendered only on a QR-scanned row.** 31 of 131 regular
  check-ins were entered `manual` by an SA, where the timestamp is the SA's tap,
  not the ช่าง's arrival. A manual row shows its time plus **บันทึกโดยหัวหน้า**
  and no ตรงเวลา/สาย verdict. Honest-copy doctrine applied to a judgement about a
  person: the app must not tell a worker they were late on someone else's clock.

- **D8 — the assigned-work card stays, demoted below the receipts.** Empty for
  13/13 today, but it costs one RPC, renders an honest empty state, and fills by
  itself the day an SA binds WPs to a muster team. Removing it would need a second
  unit to bring back and nothing would remember why.

---

## §3 — Where 08:15 comes from, and in what unit

**No start time exists anywhere in the schema.** A sweep of
`information_schema.columns` across the whole `public` schema for
`%start_time%`, `%shift%`, `%work_start%`, `%late%` returns three unrelated
columns (`boq_line.boq_template_id`, `service_providers.plate_no`,
`supply_plans.is_template`). "Late" is therefore not a fact the database can
currently produce — it is a rule this spec introduces.

The 131 `regular`-session check-ins, converted to **Asia/Bangkok wall clock**
(fixed UTC+7, no DST):

| Band | Rows |
|---|---|
| 07:38 – 07:59 | 64 |
| 08:00 – 08:12 | 61 |
| **08:13 – 08:26** | **0 — empty interval** |
| 08:27 – 08:32 | 4 |
| **08:33 – 09:07** | **0 — empty interval** |
| 09:08 | 2 |

Earliest arrival ever recorded: **07:38:16**. Latest: **09:08:14**.

The cut sits in the empty interval `[08:13, 08:27)`, dead centre at **08:15** —
the same shape as [384](384-sa-fix-queue-batches.md)'s staleness boundary, and
chosen the same way. Today it marks **6 of 131 rows late (4.6%)** and leaves the
whole 08:00–08:12 morning cluster on time. Compare the alternatives that were
costed against the same rows: *08:00 sharp* marks **66 of 131** — half the
workforce, including the normal morning, i.e. the 99%-fire-rate defect
[375](375-sa-home-movement-sort.md) rejected; *08:00 + 30 min* marks 4.

⚠️ **The unit is part of the constant** ([384](384-sa-fix-queue-batches.md)'s
lesson, paid there): the histogram above is **wall-clock minutes-of-day in
Asia/Bangkok**, so the code must compare in the same unit — minutes since
Bangkok midnight, derived through the module's existing Bangkok formatter, never
a string comparison against a timestamptz and never a UTC time-of-day.
`muster_attendance.in_at` is `timestamptz`; PostgREST renders it `…+00:00` while
a JS-built cutoff renders `…Z`, and `"+" < "Z"` bytewise —
[375](375-sa-home-movement-sort.md)'s boundary trap.

**Acceptance re-runs the derivation rather than trusting the constant** (§6): a
suite of hand-built fixtures is green at any threshold, because fixtures encode
whatever unit their author had in mind.

OT sessions carry no verdict at all — the 58 OT check-ins run 17:21–17:47 and
there is no OT start rule to be late against. They render times and `ot_hours`.

---

## §4 — The design

### The bar and strip

| | Today | After |
|---|---|---|
| 1 | หน้าหลัก `/technician` | หน้าหลัก `/technician` |
| 2 | ประวัติ `/technician/history` | **ตั้งค่า `/settings`** |
| 3 | โปรไฟล์ `/profile` | — |

### `/technician` — the daily page

1. **QR badge** — unchanged, keeps the lead. It is the single proven reason the
   role opens the app.
2. **ของที่ต้องรับ** — the receipts, lifted out of the dead tab (D5).
3. **งานที่ได้รับมอบหมาย** — demoted below the receipts (D8).
4. **ประวัติการเข้างาน** — a row linking to the attendance page.
5. **Identity block** — e-card, ID-card renewal, contact + consents (unchanged),
   plus the **bank** section returning from the history page (D4), plus the wage
   list rendered only when non-empty (D4).

### `/technician/history` — ประวัติการเข้างาน

Stops being a tab; gains `DetailHeader backHref="/technician"` (it has none
today — as a tab destination it needed none, and as a leaf without one it would
be stranded, since the bar no longer names it).

A reverse-chronological **list** of the caller's own work days, not a calendar —
this is a phone surface answering "what does the company have recorded for me",
where a month grid costs a screen to say what a list says in a line. Each row:

- Thai date (B.E.)
- session — ปกติ / OT
- เข้า time · ออก time (`outNextDay` already handled by the shared cell builder
  for a post-midnight OT check-out)
- **ตรงเวลา / สาย** — regular + QR rows only (D6, D7); manual rows read
  **บันทึกโดยหัวหน้า**
- OT hours where present
- ปิดอัตโนมัติ where `out_auto` (3 rows to date) — an auto-closed day is not a
  recorded departure and must not read as one

**Window: the last 30 days**, newest first, with the summary computed over the
same 30 days — days recorded · on-time · late · OT sessions. The whole live
record is 8 days old (07-24 → 07-31), so 30 days shows everything today and
stays a single screen once it fills; no pagination is built until the RPC
returns more than a month, and the window is one constant beside the late rule.

**Reuse, not a second builder.** [374](374-attendance-calendar.md)'s
`src/lib/attendance/attendance-month.ts` already models exactly these rows —
`AttendanceMusterRow` carries `work_date · in_at · out_at · in_method ·
out_method · out_auto · ot_hours · project_name`, and `AttendanceDayCell` already
merges the spec-351 dual sessions per date, resolves post-midnight OT check-outs,
and formats Bangkok wall clock through `formatThaiTime`. The lateness derivation
is added to that module as a pure function over a cell; the ช่าง's list view
consumes the same cells the procurement calendar does. One home for the rule, two
audiences.

---

## §5 — Units

**U1 — `get_my_attendance()` (schema lane).** A ช่าง **cannot read one row of
their own attendance today**: `muster_attendance` carries exactly one SELECT
policy, `can_see_project(t.project_id)`, and that function's live body falls to
`else false` for `technician` (it admits super_admin / project_coordinator /
project_director / procurement_manager unconditionally, and PM / site_admin /
site_owner / auditor by membership). So the reader must be a `SECURITY DEFINER`
RPC self-scoped on the `workers.user_id` binding — the shape the portal already
uses for `get_my_wage_payments`, `get_my_assigned_work` and
`get_my_worker_profile`.

Returns the `AttendanceMusterRow` columns plus `session`, ordered by
`work_date desc`. pgTAP:
- a bound worker reads their OWN rows;
- **a positive control** — the same caller reads a row that exists, so an empty
  result cannot be mistaken for a working filter;
- **a negative control** — another worker's rows are never returned;
- no EXECUTE for `anon` or `PUBLIC`, asserted with
  `has_function_privilege(...)` (the house pattern in
  `100-anon-exec-definer-harden`, which resolves PUBLIC through role
  inheritance — *not* a bespoke `role_routine_grants` count, which has no PUBLIC
  arm and reads "safe" either way).

**U2 — the attendance page.** The lateness derivation in
`attendance-month.ts` (pure, unit-tested **at the boundary**: 08:14:59 on time,
08:15:00 late, in Bangkok minutes-of-day), the ช่าง list view, `DetailHeader`,
the D7 manual-row branch, the OT no-verdict branch, the `out_auto` note. The
money sections move out to `/technician` in the same unit — a half that removed
the bank without re-homing it would delete a capability, and `/settings/my-info`
points at that home by name.

**U3 — the bar, the strip and the home order.** `TECHNICIAN_TABS` and
`TECHNICIAN_HUB_NAV` 3 → 2, receipts lifted, assigned work demoted, the
ประวัติการเข้างาน row added, guards updated (§7).

Sequential: U1 → U2 → U3. U1's RPC has no reader without U2; U3's home row
should name the attendance page, not the money page it replaced.

---

## §6 — Acceptance

Not a green suite — a **fill rate** and a **re-derivation**.

1. **Re-run the histogram of §3 against live rows at ship time** and confirm
   `[08:13, 08:27)` is still empty. If the empty interval has moved, the constant
   moves with it and the prose is corrected in the same PR. A passing vitest suite
   is not evidence about a threshold.
2. **`/technician/history` route views must leave 0.** It is the only destination
   in this spec whose entire justification is that it will be opened.
3. **Receipt acknowledgements must leave 0.** `select count(*) from stock_issues
   where received_at is not null and received_by is not null` — the 11 pending
   rows now sit on the page the role actually opens. Flat after a fortnight means
   the receipts were never the blocked action and the next unit is elsewhere, not
   more layout.
4. **`/settings` views by `actor_role='technician'`** should rise off its
   current 6 (2 people) once the door is visible rather than hidden behind a
   back chip.

---

## §7 — Guards that go red on purpose

- `nav-law-strip-superset.test.ts` — the **exact-set** pin added by #856
  specifically so that granting a ช่าง a settings door reds the guard. Update it;
  never weaken it. Its other invariant (every gated role of every promoted hub
  has a non-empty strip AND a tab set AND the page is claimed) must still hold
  for the 2-tab set.
- The `TECHNICIAN_TABS` / `TECHNICIAN_HUB_NAV` content pins — both arrays, kept
  one-for-one (rule 2).
- `nav-back-affordance.test.ts` — `/technician/history` re-classifies
  `NON_DETAIL` → `STATIC_DETAIL` (it gains a back chip). It is single-parent, so
  it does **not** join `STATIC_MULTI_PARENT`.
- `settings-sections.test.ts` — unchanged. This spec adds no settings entry; it
  only makes the existing hub reachable.

---

## §8 — Out of scope, recorded

- **Why the portal is unused at all.** 17 of 31 active workers have no login, and
  6 of 13 technician users opened the app in 30 days. That is a reach and
  purpose question — this spec was scoped by the operator to the bar, and a
  better bar over a 38-view portal is a better bar over a 38-view portal. Named
  here so it is not mistaken for something this spec fixed.
- **`muster_team_wps` is empty in practice** (5 links / 27 teams), which is why
  the assigned-work card never fills. That is an SA-side workflow gap, not a
  technician nav gap.
- **A per-project work start time.** D6 puts the rule in code for one live
  project. Project #2 turns it into a column — fold it into the multi-project
  punch-list rather than pre-building it here.
- **Whether a ช่าง may dispute a recorded time.** D7 avoids asserting a verdict
  the app cannot stand behind, but there is no correction path. If สาย starts
  carrying consequences, a dispute affordance is owed before, not after.
