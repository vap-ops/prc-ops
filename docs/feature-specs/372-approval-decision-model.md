# Spec 372 — the approval decision model: one question, four causes, three routes

**Status:** operator directive 2026-07-28 — _"upgrade the approval workflow to cover
more scenarios: ① hide rework and only show it if there is a rework rejection ② for
photo rejection, allow PM to multiselect which phases and zones are the problem"_ —
plus a brainstorm the same day that reshaped both asks against live data. **U1 is
SHIPPED** ([#824](https://github.com/vap-ops/prc-ops/pull/824), release 0.256.4);
U2–U4 are specified here. Refines specs 337 (F3 `rejected`→`rework`), 353 (the two
rejection types), 355 (revision reasons), 371 (review-queue focus).

**Schema:** U2 code-only · U3 additive (RPC body) · U4 additive (one table + one RPC
param). No destructive change.

---

## 1. Why

### What the workflow does today

The PM opens a WP at `/review/work-packages/[id]` and picks one of three radios,
enforced by the live `decide_work_package` RPC:

| Choice        | Enum             | Live effect                                                                |
| ------------- | ---------------- | -------------------------------------------------------------------------- |
| อนุมัติ       | `approved`       | → `complete`                                                               |
| ถ่ายรูปใหม่   | `needs_revision` | status **unchanged** (stays `pending_approval`), carries a spec-355 reason |
| ส่งกลับแก้งาน | `rejected`       | → `rework`, `rework_round++`, audit `via='review_rejection'`               |

### What the live data says (queried 2026-07-28, prod)

| Fact                                                                                                                                    | Consequence                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **166 `approved`** (first 2026-06-23, last 2026-07-28) — only **5** carry a comment                                                     | Approval is silent by habit. Not a problem to solve here, but it means the comment field is not where PM judgment lives.                                                       |
| **59 `needs_revision`**                                                                                                                 | This is the entire real rejection load.                                                                                                                                        |
| **0 `rejected`. Never once, in five weeks.**                                                                                            | The "reject work" door is unused — and everything downstream of it (specs 216, 248, 337 F3, the หลังแก้ไข bucket, defect pairing) has therefore **never fired in production**. |
| **0 of 397 WPs have ever had `rework_round > 0`; 0 at `status='rework'`; 0 `defect` photos, ever**                                      | Confirms the above from the other side. The rework subsystem is built, tested, shipped, and unfed.                                                                             |
| Reasons since spec 355 shipped (07-27): `incomplete` **12**, `mismatch` **10**, `premature` **0** (plus 37 pre-355 rows with no reason) | Two of three reasons are working within days. `premature` — "งานยังไม่เสร็จ" — is the one that means _the work_, and it is as unused as `rejected`.                            |
| **47 WPs bounced at least once; 6 bounced 2+ times; max 3 rounds**                                                                      | Repeat bounce exists and nothing surfaces it.                                                                                                                                  |
| **23 bounced WPs still `pending_approval`** — avg **2.8 days** waiting, worst **8.0 days**                                              | Nothing chases them. Spec 371 shows `ค้างมา N วัน`; nobody is told.                                                                                                            |
| Photos on a bounced WP: median **10**, mean 11.6, max **41**                                                                            | A generic "re-shoot" makes the SA search a 10-photo set for an unnamed fault.                                                                                                  |
| **Zones do not exist** — no table matching `%zone%` in `public`; spec 366 is a DRAFT                                                    | The operator's "zones" half of ② cannot be built yet.                                                                                                                          |

### The reading

`needs_revision` carries 100% of the load and is the crude instrument. The precise
machinery sits behind a door nobody opens. So the leverage is in **making the used
path precise**, not in adding more rework machinery.

The operator's own diagnosis of why `ส่งกลับแก้งาน` is unused: **it is unclear**
(answered 2026-07-28, choosing "fix it" over "retire it"). Reading the form
([record-decision-form.tsx][form]) supports that, concretely:

1. **The three options are not on one axis.** `ถ่ายรูปใหม่` is an instruction to the
   _SA_; `ส่งกลับแก้งาน` is an action the _PM_ takes. They cannot be compared.
2. **The heavy option explains itself in system words** — its hint is
   `"ตัวงานต้องแก้ไข — จะกลับไปเป็นงานแก้ไข (รอบใหม่) แล้วถ่ายรูปหลังแก้ไข"`. Round
   counters and photo buckets, never the consequence the PM decides on: _this leaves
   your queue and goes back to site to be physically redone._
3. **"The work isn't finished" already has a home inside the OTHER button.** Spec 355
   put `premature` under `needs_revision`. A PM who thinks "งานยังไม่เสร็จ" finds a
   home one level down and never reaches the third radio. Both sit at 0 uses.

---

## 2. The model

The PM answers **อนุมัติ / ไม่อนุมัติ**. If not, they pick **what is wrong** — never a
mechanism. The system chooses the route.

| Cause              | Enum         | Where the WP goes            | SA's next move                       | Turns rework on?        |
| ------------------ | ------------ | ---------------------------- | ------------------------------------ | ----------------------- |
| **รูปไม่ครบ**      | `incomplete` | stays `pending_approval`     | add photos to the **flagged phases** | no                      |
| **รูปไม่ตรงงาน**   | `mismatch`   | stays `pending_approval`     | replace the **flagged photos**       | no                      |
| **งานยังไม่เสร็จ** | `premature`  | → **`in_progress`**          | finish, shoot **แล้วเสร็จ**, submit  | no                      |
| **งานต้องแก้ไข**   | `rejected`   | → `rework`, `rework_round++` | shoot **หลังแก้ไข**                  | **yes — the only door** |

Three genuinely different routes for three genuinely different meanings, and the
rework subsystem hangs off exactly one row.

### Why `premature` → `in_progress` and not `rework`

Considered and **rejected** — the operator caught it during the brainstorm: _"if it's
the same as งานต้องแก้ไข, would it open up rework image uploads?"_ It would.
`canSubmitForApproval` ([transitions.ts][trans]) stops accepting `after` photos once
`status='rework'` and demands current-round `after_fix`; `submitEvidenceHint` then
tells the SA `"ถ่ายรูปหลังแก้ไขก่อนจึงจะส่งตรวจได้"`, and `canCaptureAfterFix` opens
the หลังแก้ไข bucket. An SA who merely **finished the work** would be ordered to file
completion photos as **after-fix** — a repair that never happened. It also
contradicts spec 353's own rule that after_fix is completion evidence **only inside a
rework cycle**.

`in_progress` gives the honest outcome: the WP leaves the review queue, returns to
site as ordinary active work, and completion evidence stays `after` (the `else` branch
of `canSubmitForApproval`). Gate-checked: `in_progress` is in the photo-**deletable**
set ([deletable.ts][del] — locked = `pending_approval`, `complete`), so sending a WP
back does not freeze its photos.

### Why the targeting axis follows the CAUSE

The operator asked for phase multiselect, then asked whether photo selection should be
allowed too. Both — but not as alternatives, because the two causes point at opposite
things:

- **`incomplete` points at ABSENCE.** You cannot tap a photo that was never taken.
  Only a phase can carry "ระหว่างทำ is missing". → **phase multiselect.**
- **`mismatch` points at THINGS THAT EXIST.** Phase-level is usually a lie here: the
  live comments say _"ลบรูปที่ใช้อุปกรณ์อื่น…"_ — a couple of bad shots, not the whole
  bucket. Telling the SA "all your ระหว่างทำ photos are wrong" makes them re-shoot 10
  to fix 2. → **photo multiselect**, with a per-phase _"ทั้งหมดในช่วงนี้"_ shortcut for
  the genuine "เปลี่ยนรูปใหม่ทั้งหมด" case that also appears in the comments.
- **`premature` / `rejected` get neither.** They are judgments about the work.

⚠️ **Do NOT reuse `answers_photo_id` for the mismatch link.** That spec-248 pairing is
bolted to `phase='defect'`, and `addPhoto` refuses a defect insert unless the WP is
already in `rework` — so reusing it would drag rework back in through a side door,
the exact thing ① exists to shut.

---

## 3. Decisions

| #   | Decision                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The PM never picks a mechanism. One "ไม่อนุมัติ" door, four causes, system routes.                                                                                            |
| D2  | `rejected` is **kept**, not retired — it becomes the fourth cause. Operator's call 2026-07-28: unused because unclear, so fix the clarity and judge on real usage afterwards. |
| D3  | `premature` routes to `in_progress`. No new enum value: the reason already exists, so this is a body-only change to `decide_work_package`.                                    |
| D4  | Targeting follows the cause: phases for `incomplete`, photos for `mismatch`.                                                                                                  |
| D5  | Flagging never deletes. It marks the tile and offers the existing ลบรูป; `photo_logs` stays append-only.                                                                      |
| D6  | Zones are **out of scope** — no table exists (spec 366 is a draft). The rejection form gains a zone axis when zones are real.                                                 |
| D7  | U1 (already shipped) named photo groups by round, not phase. `รูปเพิ่มเติม` for round 0.                                                                                      |

---

## 4. Units

### U1 — name photo groups by round, not phase ✅ SHIPPED

[#824](https://github.com/vap-ops/prc-ops/pull/824) `919f86b0` → 0.256.4. Code-only.
`photoSectionLabel(phase, wpReworkRound)` is the one home of the rule; round 0 reads
`รูปเพิ่มเติม`. Five render surfaces, no photo hidden, no data changed. This is ① —
the inventory found rework already conditional everywhere else.

### U2 — restructure the decision, fix the copy (code-only)

Two steps: **อนุมัติ / ไม่อนุมัติ**, then the four causes as one flat list with
consequences in plain Thai (_"งานจะกลับไปหน้างานเพื่อแก้ไข"_, not _"งานแก้ไข รอบใหม่"_).
`rejected` moves from a peer radio into the cause list; the RPC is untouched in this
unit — the client still sends `decision: 'rejected'` when that cause is picked.

⚠️ Gate-check before building: the RPC **requires** a comment for `rejected` and
**refuses** a reason on any non-`needs_revision` decision (`22023`). The new form must
keep both invariants or every rework send-back errors.

### U3 — `premature` sends the WP back to กำลังทำงาน (additive migration)

Body-only `create or replace` of `decide_work_package`: when
`p_decision='needs_revision' and p_revision_reason='premature'`, set
`status='in_progress'` instead of leaving it. Signature, DEFINER, grants unchanged.

pgTAP: a `premature` decision moves the WP off `pending_approval`; the other two
reasons do **not**; the approval row still records `needs_revision` + the reason.

Owed reads: `resubmit_work_package_evidence` (the SA's `needs_revision` loop) assumes
`pending_approval` — confirm a `premature` WP uses the ordinary ส่งงานเข้าตรวจ submit
instead, and that spec 371's queue view drops it cleanly.

### U4 — cause-driven targeting (additive migration)

New child table keyed to the decision (typed FKs, no mixed-content columns per
CLAUDE.md): flagged `photo_phase` values for `incomplete`, flagged `photo_logs` ids for
`mismatch`. One new `decide_work_package` param. SA side: the flagged phases/tiles are
marked on the WP detail with the spec-355 guidance.

⚠️ Two traps to build against: a flag must read **through the supersede chain** (ADR
0009 anti-join) or a flagged-then-replaced photo leaves a dangling mark; and flagging
must not delete — D5.

---

## 5. Deliberately out of scope

Real, measured, none blocking — a follow-up spec:

- **Nothing chases a bounced WP.** 23 waiting, avg 2.8 days, worst 8.0.
- **Repeat bounce is invisible.** 6 WPs went round 2+, max 3.
- **Bulk approve.** 52 actionable; real time cost, real evidence-quality risk.
- **Reviewer delegation.** No path when the PM is away; the 8-day wait may be this.
- **Silent approvals.** 5 comments in 163.
- **`rework_source='client'`** has never been used — dead enum or a future flow?

---

## 6. Success criteria

1. `premature` and `rejected` both move off **0 uses**, or the operator learns from
   real usage that they genuinely are not needed. Re-measure two weeks after U3.
2. A bounced WP names **which** phases or photos are wrong, so the SA does not search
   a 10-photo median set.
3. The review queue stops holding work that is not finished (U3 removes it from the
   `pending_approval` population that spec 371 counts).
4. No rework surface renders on a WP that was never sent back (U1, shipped).

[form]: ../../src/app/review/work-packages/%5BworkPackageId%5D/record-decision-form.tsx
[trans]: ../../src/lib/photos/transitions.ts
[del]: ../../src/lib/photos/deletable.ts
