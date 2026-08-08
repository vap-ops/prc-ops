# Spec 407 — เปิดวันย้อนหลัง: backfilling attendance on days the SA never opened

**Status:** 2026-08-08 — spec written, **no units started**. Lane `backfill`, worktree
`../prc-ops-backfill`, branch `spec407-attendance-backfill`, off `origin/main` `e2185e8b`
(release 0.365.3). **NO MIGRATION** — see §3, which is the whole point of this spec.

**Operator ask (2026-08-08), verbatim:**

> figure out how do we allow procurement users to edit attendance on dates without any scans
> (no เปิดวัน) or no OT. sometimes they come to work but SA was absent so no check in

Their answers to the follow-ups: AM/PM seen on **desktop** (that half is a separate, non-app
issue — §8) · **all TFM projects** were running · **"Procurement is source of truth for now"** ·
**"Procurement team audit attendance everyday"**.

---

## 1. The hole, in rows

Only **13 distinct dates carry any attendance at all, ever**, across 52 workers on three active
projects — all TFM, all confirmed running by the operator.

| project                               | workers | teams EVER | past weekdays with NO team (07-01→08-07) |
| ------------------------------------- | ------- | ---------- | ---------------------------------------- |
| `PRC-2026-004` TFM โพธิ์ทอง ลพบุรี    | 25      | 39         | 19                                       |
| `PRC-2026-007` TFM นายาว เพชรบูรณ์    | 11      | **6**      | 23                                       |
| `PRC-2026-008` TFM กกกระทอน เพชรบูรณ์ | 16      | **0**      | 28                                       |

⚠️ **Gap counts RE-MEASURED 2026-08-08 at spec time; the `attendance-backfill-gap-2026-08` brief
quotes 23 / 27 / 33 — do not inherit those.** Mine is `dow between 1 and 5` over `2026-07-01 →
2026-08-07` with no `muster_teams` row for that project-day; the brief's numbers run uniformly +4,
so the two used different definitions (holidays, or "no attendance" rather than "no team" — a team
can exist with nobody on it). **Workers and teams-ever match exactly**, which is what makes the
gap definition the suspect rather than the data. State the definition beside any number you quote.

**`-008` has 16 workers assigned and has never had a team opened.** Every day of its attendance is
missing. This is the norm on these sites, not an edge case.

---

## 2. 🚨 The measurement that removed the migration

The obvious scoping of this ask is a danger-path `create or replace` of `open_muster_team`: its
gate ends in `can_see_project`, which falls to `else false` for plain `procurement`, so widening
the role list alone would pass the role gate and then raise `42501 not a member of this project`.
Three sibling RPCs already carry the cross-project arm that fixes it.

**That work is not needed, because the audience is not plain `procurement`.**

Route views on `/team/attendance*`, last 30 days:

| role                      | views   | people | last seen  |
| ------------------------- | ------- | ------ | ---------- |
| **`procurement_manager`** | **289** | 1      | 2026-08-08 |
| `super_admin`             | 160     | 1      | 2026-08-08 |
| `accounting`              | 3       | 1      | 2026-07-26 |
| `project_director`        | 2       | 1      | 2026-08-07 |
| **plain `procurement`**   | **0**   | —      | never      |

There are **4 plain `procurement` users and all 4 are active in the app** — they have simply never
opened an attendance surface. So "procurement team audit attendance everyday" is **one
`procurement_manager`**, at roughly ten views a day.

⭐ **The rule this is an instance of:** a role NAME in an operator sentence is a hypothesis about
the audience, not the audience. One `group by actor_role` over the surface's own telemetry
converted a schema change into a UI change. **Re-run it before U1** — a second person joining the
plain-`procurement` tier flips this spec back to §7.

⚠️ **If the operator meant the 4 plain `procurement` users**, §7 is the version to build instead,
and it is danger-path with an operator-held merge. Flagged and answered: build the
`procurement_manager` reading.

---

## 3. What the database already permits — gate-checked live 2026-08-08

**Re-verify at build time; do not quote these without re-running them.**

- ✅ **`open_muster_team` has NO date bound.** It null-checks `p_date` and nothing else, so it
  **already accepts a past date**. The "locked to today" limit is the SA cockpit UI, not the RPC.
- ✅ **Its role gate is exactly `'site_admin', 'super_admin', 'procurement_manager'`** — read from
  the live definition. `procurement_manager` is **in**.
- ✅ **`can_see_project` has a `procurement_manager` arm returning true**, and no plain-`procurement`
  arm at all.
- ✅ **An `office` team needs no lead worker** — the lead is required only for `v_kind = 'crew'`.
  **That answers "who leads a team opened three weeks later": nobody.**
- ✅ **`muster_correct_session`** adds a missing person to an existing team **with an explicit
  check-in time**, and admits `procurement_manager`.
- ⛔ **`muster_scan_in` stamps `in_at = now()` and can never back-date.** The explicit-time path is
  `muster_correct_session` only.

**⇒ The entire backfill chain works at the DB level today. Only a UI is missing.**

---

## 4. The design — the wall is one existing arm, and it already has a name

`addPersonControl` (spec 400 U3c-b) already ends:

```ts
if (teamCount === 0) return { control: "none", reason: "noTeams" };
```

and the day panel renders `ยังไม่มีทีมของวันดังกล่าว — เพิ่มคนที่ตกหล่นไม่ได้`. **That sentence is
this spec's entire problem statement.** On a day the SA never opened, the grid already draws the
column, `dayCorrectionControl` already answers, the add-person form already exists and is already
correct — and it refuses because there is no team to add anyone _to_.

**So the unit is: on that arm, offer the missing act.** `เปิดวันย้อนหลัง` opens an **office** team
for that project-day with a null lead, `teamCount` becomes 1, `addPersonControl` returns `add`, and
every downstream control the audit team already uses starts working unchanged.

⭐ **Nothing new is invented.** `openMusterTeam` in `src/lib/muster/actions.ts` already takes an
arbitrary `date`, already supports `kind: "office"`, and its null-lead path is already pinned by
`office-team-open.test.ts`. The unit is a form, a `…FromForm` wrapper beside the existing ones, and
one role set.

### 4.1 Copy must not promise the whole day

The control opens a **container**, it does not record anyone. Naming it
`บันทึกการเข้างานย้อนหลัง` would be the doctrine's control-names-an-act-its-target-may-not-offer
defect: the very next thing the reader meets is an empty add form. Name the act
(`เปิดวันย้อนหลัง`) and let the add form say what is available.

### 4.2 The office kind is a claim, and it is visible

An office team with no lead renders in surfaces that group by lead. U1 must check what the SA
cockpit and the team map do with a leadless office team on a **past** date before shipping, and say
so in the PR — the cockpit is today-locked so it is probably untouched, but "probably" is not the
evidence rule.

---

## 5. The role set — this is what makes the PR danger-path

`open_muster_team`'s allowlist (`site_admin`, `super_admin`, `procurement_manager`) is **narrower
than `MUSTER_CORRECT_ROLES`**, which since spec 400 U6c equals `ATTENDANCE_AUDIT_ROLES` — eight
roles including `accounting`, `hr` and `project_director`.

⚠️ **So the control may NOT be gated on `canCorrect`.** Doing that would show the button to five
roles the RPC refuses with `42501` — affordance-then-refuse, the class this repo ratchets against,
and the exact defect spec 400 U6c's own notes describe fixing elsewhere.

**U1 adds `MUSTER_TEAM_OPEN_ROLES` to `src/lib/auth/role-home.ts`, mirroring the live allowlist**,
and pins the mirror with a test that iterates the complete `user_role` domain and asserts the
positive set is exactly those three (the hand-listed-allowlist rule).

🔒 **`src/lib/auth/` is in the CI deny regex, so U1 is a DANGER-PATH PR and needs an operator tap** —
`gh pr merge <n> --disable-auto && gh pr merge <n> --squash --admin`, then verify `mergedAt`.
**This is still strictly better than the §7 version:** no schema, no `create or replace`, nothing to
roll back, and the constant is one line to narrow later.

---

## 6. Units

- **U1 — the control.** `MUSTER_TEAM_OPEN_ROLES` + a `เปิดวันย้อนหลัง` form on the day panel's
  `noTeams` arm + an `openBackfillDayFromForm` wrapper + outcome copy. Past days only (never today —
  the cockpit owns today) and never the future. 🔒 danger path (§5).
- **U2 — the calendar door.** The same control on `/workers/[workerId]/attendance`'s `?fix=` panel,
  which is where a per-person audit actually happens. Code-only. ⚠️ Its `dayClosed === null` means
  **no project resolved**, not "no attendance" (spec 404's `WorkerDayFix` semantics differ from
  `GridDay`'s — recorded in the #1036 review), so U2 must resolve the project before it can offer
  anything.
- **U3 — the roster shape.** Backfilling 33 days one person at a time is 500+ taps. Once U1 proves
  the loop, the real unit is "tick the people who were there, one shift time for all" — but that is
  **operator question ① in §8** and must not be guessed.

---

## 7. The rejected version, recorded so it is not re-derived

If the audience were plain `procurement`: `create or replace open_muster_team` adding the
cross-project arm `v_role in ('accounting','hr','project_director','project_coordinator',
'procurement_manager','procurement','super_admin') or public.can_see_project(...)`, which
`muster_correct_session`, `reopen_muster_day` and `close_muster_day` already carry verbatim.

⚠️ It **reverses a deliberate decision** — `open_muster_team`'s own comment says _"who may create it
is still the site staff on the ground"_. The operator's "procurement is source of truth for now" +
"procurement team audit attendance everyday" is the ruling that would reverse it, and **both the old
comment and the ruling must be quoted in the migration header** rather than the comment being
silently deleted.

---

## 8. What this spec does NOT do

- **It does not pay anyone.** 🚨 `cost_confirmed_at` is **0 of 53 workers**, so `labor_logs` is **0
  rows org-wide**: `derive_muster_labor` skips a worker until `confirm_worker_cost` stamps them, and
  **no muster day recorded so far has produced a single wage row**. A perfect backfill still yields
  zero wages. The unblock is an operator data op already recorded as **spec 368 U2** (~5 min:
  `/workers` → แก้ไข each PRC-paid daily ช่าง → ระดับ → ยืนยัน). **Acceptance:
  `select count(cost_confirmed_at) from workers` moves off 0.** Whoever builds U1 must expect the
  zero and must not read it as their own bug.
- **It does not record OT.** Retroactive OT is Case C1 — two regular-only guards
  (`muster_correct_session`'s insert path and `muster_scan_in`'s correction arm, the first
  delegating to the second) — and it is **downstream of this spec**: you cannot add OT to a day
  nobody can open. 🚨 It is also **paid nowhere today**: `derive_muster_labor_internal` contains
  neither `ot_hours` nor `1.5`, and `labor_logs` has no OT column, so spec 351's ×1.5 is design
  intent, not implemented pricing. C1 buys a RECORD, not money — say so in its UI or its spec.
- **It does not fix the 12-hour time input.** Proven in real Chrome: `lang` on the input, on a
  parent, and on `<html>` are all **ignored by Chrome** for `type="time"`; the control follows the
  **OS/browser** format. Data is unaffected (always submits 24h `HH:MM`; every renderer is already
  `h23`). The fix is the desktop's Windows regional format, or a custom control that loses the
  native picker and re-opens spec 404 U2c's width geometry.

---

## 9. Open questions

1. 🔔 **On a backfilled day, is the check-in time per-person, or ONE shift time applied to everyone
   the auditor ticks?** This decides whether U3 is a form or a roster with a default, and it is the
   difference between ~500 taps and ~33 for the `-008` gap. **Blocks U3, not U1.**
2. Should a backfilled day be **visibly marked** as reconstructed rather than scanned? The audit
   trail records it (`muster_correction_scan_in`), but the grid cell looks identical to a real scan.
   Bears on whether "procurement is source of truth" survives contact with a dispute.
3. How far back may a backfill reach? `open_muster_team` has no bound at all; the operator may want
   one (a closed payroll period, say). Not urgent while `labor_logs` is empty.
