# Spec 403 — ตรวจสอบวันเกิด (DOB sanity gate + minimum-age floor)

**Status:** U1 BUILT 2026-08-07 (migration `20260813075918` applied, pgTAP 27/27). U2–U4 open.
**Schema.** One migration. Lane `dobgate`, `../prc-ops-dobgate`.

**Operator ask (2026-08-07),** on a screenshot of `/contacts/bank-changes`, verbatim:

> 1. no image attachment shown, don't know how to check
> 2. dob is often wrong year, how about verifying child labor to prevent that?

Ask 2 is this spec. **Ask 1 is a real and separate gap — recorded in §8, deliberately not built
here.** Asked which age floor to enforce, the operator ruled: **hard block under 15**, and on a
follow-up, **keep the 120-year upper bound**.

⚠️ **This file was fact-checked against the live DB on 2026-08-07 and three claims in its first
draft were REFUTED. The corrections are inline and marked — they are not cosmetic; one of them
changes what "the floor" even means (§1.1) and one of them is the reason the design is a trigger
(§2.1).**

---

## 1. Why — two live wrong-year classes

`submit_identity_change` runs a **mod-11 checksum on the national ID and no check at all on
DOB** (`20260813075790_spec317u3_identity_change_requests.sql:78`). Measured live 2026-08-07:

| Class                 | Live instance                                                                             | How it happens                                                     |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Buddhist-era year** | `วีระชัย เส็งนา` = **`2513-03-11`**, in **both** `workers` and `staff_registrations`      | BE year typed into a CE field → a date **487 years in the future** |
| **Today's date**      | pending request `1085b058`, `proposed_dob = 2026-07-15` = **its own submit date** (age 0) | date picker default / tap-today, nothing rejects it                |

The second one is the row the operator photographed: the card reads `วันเกิดใหม่ 15 ก.ค. 2569`,
which is `formatThaiDate` (`labels.ts:1245`, `th-TH-u-ca-buddhist`) faithfully rendering a stored
`2026-07-15`.

Supporting fill rates (live): `workers` 20 of 43 rows carry a DOB · `staff_registrations` 3 of
21 · `contractors` **0 of 10** · `crew_registrations` empty. **1 of 47 `type="date"` inputs in
`src/` carries a `max` attribute** — the one is `labor-log-zone.tsx:367`.

### 1.1 ⚠️ CORRECTION — an 18 floor already exists on three of the paths

The first draft said an age was "unconstrained in both directions". **False for half the
surface.** `sa_add_project_worker`, `sa_add_project_worker_with_bank` and `crew_lead_add_member`
each already carry, verbatim:

```sql
if p_dob is null or p_dob > (((now() at time zone 'Asia/Bangkok')::date) - interval '18 years') then
  raise exception '<fn>: worker must be at least 18' using errcode = 'P0001';
```

…already pinned in pgTAP (`280-crew-add-member.test.sql:77`, `281-sa-add-project-worker.test.sql:67`).
So the real map is:

| Path                                                    | Floor before 403 | Floor after U1          |
| ------------------------------------------------------- | ---------------- | ----------------------- |
| SA adds a ช่าง (×2 RPCs), หัวหน้าชุด adds a crew member | **18**           | **18** (18 binds first) |
| identity change (submit **and** approve)                | none             | **15**                  |
| staff self-registration                                 | none             | **15**                  |
| contractor DOB                                          | none             | **15**                  |

**U1 deliberately did not touch the three 18-floor RPCs.** The operator's "hard block under 15"
answered _what floor should the new gate use_, asked at a moment when nobody knew an 18 floor
already existed — relaxing a shipped 18 down to 15 is a different decision and is not implied.
🔔 **Open for the operator: leave the asymmetry, or raise everything to 18?**

### 1.2 The child-labour half

Zero genuine minors exist today — the only under-18 rows anywhere are the two `2513` future
dates. The gate blocks nothing that legitimately exists, which makes now the cheapest possible
moment to install it.

⚠️ Adjacent and NOT a child-labour signal: spec 395 records three worker rows whose **payout
account holder** names carry `ด.ช.` (เด็กชาย). Those are family account holders, not workers.

---

## 2. Where a DOB can enter

Six SECURITY DEFINER RPCs, enumerated from the live catalogue, **not** the migration files:

| Function                                                        | Notes                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `submit_identity_change(text, text, date)`                      | anyone, for themselves; no DOB check                            |
| `decide_identity_change(uuid, boolean)`                         | the trio; **applies `proposed_dob`** — see the correction below |
| `sa_add_project_worker(uuid, text, text, date)`                 | already floors at 18; **zero app callers today**                |
| `sa_add_project_worker_with_bank(uuid, text, text, date, text)` | already floors at 18                                            |
| `crew_lead_add_member(uuid, text, text, text, date)`            | already floors at 18; **zero app callers today**                |
| `update_own_staff_registration(text, text, date, …)`            | no DOB check; **coalesce-keep** (see §7)                        |

⚠️ **CORRECTION:** the first draft said `decide_identity_change` applies the DOB to
`users`/`workers`/`staff_registrations`. It writes **`workers`, `staff_registrations` and
`contractors`** (spec 321 U6, via `contractor_users`); `public.users` has **no DOB column at
all** — only `full_name` is written there.

⭐ **`decide_identity_change` must be covered, not only `submit`.** The four pending requests
already hold their values — one of them the age-0 date — so a submit-side-only guard would let an
approve write it into three tables in one txn.

### 2.1 ⚠️ The seventh path — and the reason the design is a trigger

The first draft assumed every write goes through an RPC. **It does not.** `authenticated` holds
**column-level INSERT _and_ UPDATE on `contractors.date_of_birth`**
(`information_schema.column_privileges`), paired with permissive RLS
(`contractors insert by staff` / `contractors update by staff`) gated only on a six-role list. No
app code sends the column today (`contacts/actions.ts:343-490` omits it), but any of those six
roles can set it directly through PostgREST with no RPC at all. `service_role` writes
(`src/lib/db/admin.ts`) bypass RLS entirely and would bypass an RPC-side guard too.

`workers` and `crew_registrations` are clean (zero grants to `authenticated`/`anon`);
`staff_registrations` and `identity_change_requests` are SELECT-only.

**A per-RPC `perform` therefore could not have closed this**, and would have had to be reproduced
in six function bodies while silently not covering writer number seven.

---

## 3. Decisions

**D1 — a BEFORE INSERT OR UPDATE trigger per table, over a pure reason function.** Not a
`perform` in each RPC (§2.1), and not a CHECK constraint (the rule depends on `current_date`,
which is not immutable). `public.dob_rejection_reason(date)` is the SSOT and returns **the
reason**, so each caller can name the actual cause rather than refuse generically.

**D2 — the floor is 15, hard.** Operator ruling. A 15–17 year old passes **silently** on the
paths this spec gates; no flag, no warning, no review queue. Recorded so nobody later reads the
absence as an oversight. See §1.1 for the three paths that already floor at 18.

**D3 — the Buddhist-era arm is checked BEFORE the future arm.** `2513-03-11` satisfies both, and
"the future" would be true, useless, and would never teach the user to subtract 543. Every BE
year a living person holds is ≥ 2440 and no legitimate CE birth year exceeds 2400, so
`extract(year from p_dob) > 2400` is an exact discriminator — verified against live data: exactly
one row in the whole database exceeds 2400, and it is the known mis-entry.

**D4 — the 120-year ceiling stays.** Operator-confirmed 2026-08-07. "Wrong year" is symmetric; a
`1889` typo is the same defect as a `2569` one.

**D5 — rejection order and tokens.** `null` → accept · BE year → `dob looks like a buddhist era
year` · future → `dob in the future` · under 15 → `dob under minimum age` · over 120 → `dob
implausibly old`. Distinct, non-overlapping English tokens, because the server actions map errors
by substring (`my-info/actions.ts:52-57` is the existing convention).

**D6 — an UPDATE that does not CHANGE the DOB is not validated.** The gate is not retroactive, so
the legacy `2513` row stays editable for every other reason. Without this, one bad date would
freeze a whole record.

**D7 — `null` is accepted by the gate.** ⚠️ CORRECTION: that is not the same as "null is
acceptable everywhere" — `crew_registrations.date_of_birth` is **NOT NULL** at the column level,
and the three 18-floor RPCs reject a null outright. The trigger simply does not add a _new_
requirement; existing ones stand.

---

## 4. Units

**U1 — the gate (schema, danger path). ✅ BUILT.** `dob_rejection_reason(date)` +
`assert_valid_dob_trigger()` + five triggers (`workers`, `staff_registrations`,
`crew_registrations`, `contractors`, `identity_change_requests.proposed_dob`). Migration
`20260813075918`, head re-queried at apply time. pgTAP `403-dob-sanity.test.sql` 27/27; full suite
**362 files / 7,643 assertions / 0 failures**.

**U2 — the three forms (code-only).** `identity-change-form.tsx`, `staff-registration-form.tsx`,
`add-technician-sheet.tsx` (`staff-register-workspace.tsx` only feeds the second): `max` on the
input, the four checks inline, Thai copy per cause including the พ.ศ. hint. Plus the substring
maps in the four server actions that call these RPCs — `settings/my-info/actions.ts:46`,
`lib/portal/actions.ts:245`, `lib/register/actions.ts:111`, `sa/crew/actions.ts:62`. Vitest files
that touch a DOB and will need updating: `bank-change-queue`, `load-profile-card`,
`register-profile`, `staff-register-workspace-docs-owed`, `staff-register-workspace-floor`,
`worker-history-sections`, `worker-portal-sections`.

**U3 — the approval card shows an age (code-only).** `/contacts/bank-changes` renders
`วันเกิดใหม่ 15 ก.ค. 2569` — a date a human reads as plausible. It renders **`อายุ 0 ปี`** in the
attention colour beside it, which is not. ⚠️ **The age renderer needs its own guard:**
`formatThaiDate` adds 543 to an _already_-BE year, so the `2513` row displays as `11 มี.ค. 3056`
and a naive age would read `อายุ -1030 ปี` — a second nonsense string replacing the first. Out-of-
range ages render as a named problem, not as a number.

**U4 — repair the committed bad data (operator-run, not a migration).** The `2513-03-11` row in
`workers` + `staff_registrations`, and a decision on pending request `1085b058`. ⚠️ U1 is live, so
**approving that request now refuses with `P0001`** — correct, and exactly why U2/U3 must tell the
approver to reject it and ask the person to resubmit rather than leave them on a generic error.

Order: U1 ✅ → U2. U3 is independent. U4 any time after U1.

---

## 5. Verification (U1, done)

- RED first, for the right reason: `function "public.dob_rejection_reason(date)" does not exist`,
  with the rest of the suite green (361/361) in the same run.
- 27 assertions: three catalogue/posture, ten pure arms (including **both** boundaries — exactly
  15 accepted, one day short refused; exactly 120 accepted, one day over refused), five
  trigger-presence, seven `workers` behaviours, two `identity_change_requests` behaviours.
- Mutation: each of the five triggers dropped **separately** — a whole-set mutation cannot tell
  "gated" from "gated in one place".
- The objects were verified **live** after `db:push`, not from the push's own success message.
- ✅ **No existing pgTAP goes red:** every DOB literal in the eight affected test files is a
  legitimate adult date (`1992-03-04`, `1990-05-01`, `1988-03-03`, `1990-01-15`, `1988-03-15`, …);
  the `2015-01-01` cases in 280/281 already expect `P0001`.
- ✅ **No downstream consumer breaks:** `date_of_birth` appears in non-generated app code in three
  places (`load-portal-data.ts:32`, `register/actions.ts:114`, `registration-profile.ts:2`) plus
  five display-only surfaces. Nothing in `worker/` or `scripts/`. No payroll, report or export
  reads it.

---

## 6. Risks

- **The gate is not retroactive** and must never be described as if it were (D6).
- **A refusal on a surface with no other exit.** `update_own_staff_registration` is on the
  self-registration path.

---

## 7. ⚠️ CORRECTION — "let the field be cleared" is not currently possible

The first draft's mitigation ("the form must let the field be cleared, not force a wrong value
in") **cannot be delivered as written.** `update_own_staff_registration` is
`date_of_birth = coalesce(p_date_of_birth, date_of_birth)` — passing `null` **keeps** the existing
value; the repo documents this itself at `my-info/actions.ts:63` ("blank = keep, never clears").
Clearing needs a change to that RPC's semantics, which is **not scoped here**. U2 must not promise
a clear it cannot perform.

---

## 8. Out of scope — but recorded, because it is the operator's ask #1

**Identity changes are approved against zero evidence.** `identity_change_requests` has three
proposal columns and **no photo column**; the form has no upload; and `bank-changes/page.tsx:132`
signs passbook photos only for the bank kinds (`it.kind !== "identity"`). Of the four pending
requesters, **one** has an `id_card` attachment anywhere.

Second, smaller gap on the same card: it renders only the **proposed** value, never the current
one, so even with a photo there is nothing on screen to compare against.

Both need their own spec (a column + a bucket path + RLS + the upload control + the signing).
Listed here so the omission is a decision, not a gap.
