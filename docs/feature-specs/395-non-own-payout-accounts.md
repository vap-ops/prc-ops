# 395 — บัญชีรับเงินที่ไม่ใช่ของช่างเอง (non-own payout accounts)

**Status:** draft
**Author:** CC session 2026-08-04
**Related:** spec 320 (payout nominee), spec 315 / ADR 0062 (worker bank-change requests), ADR 0061 (worker ecosystem / financial inclusion), ADR 0079 (self-governance)

---

## 1. Why

The operator asked for abnormal payout accounts to be **flagged**, so the firm can
encourage every ช่าง to hold their own account (ADR 0061's financial-inclusion
goal). Today nothing surfaces this, and the practice has quietly routed around the
one mechanism built for it.

⚠️ **Every number below is a SNAPSHOT and is already known to move within hours.**
The roster was 35 rows at the start of the session, 37 at the first scan, 38 at the
second, and **39 at the fact-check** — dada is onboarding live. During the
fact-check itself one mismatch row (`สุรินทร์ นาคพันธุ์`) was corrected by a human
between two queries five minutes apart. **Re-measure at build time; do not inherit.**

**Latest measurement (fact-check pass, 2026-08-04):**

| Class                                        | Count   |
| -------------------------------------------- | ------- |
| Workers total / active                       | 39 / 38 |
| Bank account number present                  | 37      |
| Account name matches the worker (normalised) | 30      |
| **Name does NOT match**                      | **7**   |
| Bank number present, account name blank      | **0**   |
| `worker_payout_nominee` rows, all-time       | **0**   |

⭐ **The finding is concentration, and the honest number is 3, not 4.**
Three workers — พิเชษฐ์, โนรี, สายฟ้า — share **one account number**
(`014162319729`). A fourth row, อนันตชัย's own, names the same holder but carries
`044162319729` — a different number, almost certainly a transcription slip of the
same passbook, but the database says different.

⚠️ **That distinction is load-bearing and it constrains §3:** the shared-account
detector returns a group of **3**. The 4th is reachable only by the name detector
this spec deliberately demotes to advisory. Do not write §1's headline as 4 and
then build a detector that finds 3.

Remaining mismatches: one family case (`นายแดง บุญวัง` → `นางแก้ว บุญวัง`), one
unrelated third party (`เอกพัฒน์ อ่อนสา` → `น.ส.ปาณิศา บุญเรือง`), and the
`นายเหิน เมืองงาม` case (§7) — which **is one of the mismatch rows, not a separate
case beside them**. His record is `active = false`, so an active-only detector drops
him silently.

⚠️ **U1 must state whether it filters on `workers.active`.** An inactive row can
still hold a wrong account, and retired workers accumulate.

The `ด.ช.` (เด็กชาย — a minor) honorific appears on **four** account-name rows, all
naming the same holder. Possibly legitimate — a หัวหน้าชุด collecting for his crew is
normal practice — but it is invisible today, and it is exactly the concentration the
firm would want to see and eventually unwind.

## 2. What already exists

**Spec 320 already built this model.** `worker_payout_nominee` carries
`payee_name`, `payee_relationship`, `payee_bank_name`, `payee_account_name`,
`payee_account_number`, `consent_doc_path`, `set_by`/`set_at`,
`cleared_by`/`cleared_at`, `active` — all NOT NULL except the two `cleared_*`.
Four DEFINER RPCs exist (`set_` / `get_` / `list_active_` /
`clear_worker_payout_nominee`). The table is zero-grant bank PII. `clear_` only
flips `active = false`, so **0 rows genuinely means never inserted.**

⭐ **`consent_doc_path` is a harder prerequisite than "NOT NULL".**
`set_worker_payout_nominee` verifies the path sits under
`nominee-consent/<worker_id>/` in the `contact-docs` bucket **and that the object
actually exists in `storage.objects`**. Recording a nominee therefore requires a
completed upload first — an upload-must-precede constraint, not a nullable-column
technicality.

⚠️ **`PAYOUT_NOMINEE_STALE_DAYS = 45` IS ALREADY WIRED TO A SURFACE.**
`src/app/settings/payout-nominees/page.tsx` imports it and renders a highlighted age
chip (`บนบัญชีตัวแทน N วัน`, `bg-attn-soft`) on every row past the threshold. The
reclaim nudge is designed, built **and surfaced**. An earlier draft of this spec
proposed building it; that was wrong and the unit was removed.

### Why is it empty? — a HYPOTHESIS, not a diagnosis

Nothing has been measured that distinguishes these. Treat as open (§8).

1. ❌ **Not the gate.** All four RPCs carry the identical **inline** literal
   `('procurement_manager','project_director','super_admin','procurement')` —
   verified in `pg_get_functiondef` for each. `current_user_role()` is a role
   _lookup_, not a role-set helper, so there is no indirection that could widen or
   narrow this. **dada could have recorded a nominee today.**
2. **Placement (argued from architecture, not evidence).** The bank fields sit on
   the `/workers` edit sheet where onboarding happens; the nominee control lives at
   `/settings/payout-nominees`. The person typing the account never passes the
   nominee control.
3. **Consent-upload friction.** Given the storage-object check above, this is now
   the stronger candidate. Ask the team.

⚠️ **`/workers` is NOT the only path into `workers.bank_*`.** The table
`worker_bank_change_requests` and its RPC `decide_worker_bank_change(p_id, p_approve)`
(spec 315 / ADR 0062) also write all three bank columns — the ช่าง's own self-service
request, approved by back-office — and that path equally bypasses the nominee. Its
gate is different again: `is_manager(role) or role = 'procurement_manager'`.
**Any unit that claims to route third-party accounts to the right place must cover
both doors or it is incomplete.**

⚠️ **The "procurement_manager-gated" comment is stale in FOUR places**, not one:
`src/lib/payroll/payout-nominee.ts` lines 3–8, 76 and 105–108, plus
`src/app/settings/payout-nominees/page.tsx:3`. Fix them all in whichever unit
touches the file.

## 3. The signal

⭐ **Primary detector — shared account, no name logic:**

> the number of DISTINCT workers sharing one `bank_account_number`

Objective and immune to Thai spelling variance. **It returns 3 for the concentration
case, not 4** (§1) — say so in the UI rather than quietly disagreeing with the
number in this document.

**Secondary detector — normalised name mismatch (advisory only):**

Strip honorifics (`นาย|นาง|นางสาว|น.ส.|ด.ช.|ด.ญ.`) and whitespace, then compare.

⚠️ **Do NOT make name mismatch the primary flag.** Spelling variance for the same
person is common in this data and a human corrected one such row mid-verification.
Name mismatch hints that a nominee record is _probably missing_; it is never a defect
claim in itself.

⚠️ **A non-matching account holder is NORMAL at this firm** (operator, 2026-08-04:
some technicians use a family member's account temporarily). Copy must never call it
an error. The ask is _record it and encourage_, not _forbid_.

## 4. Design

Three states per worker, derived — **no new column on `workers`**:

| State        | Derivation                                                                                |
| ------------ | ----------------------------------------------------------------------------------------- |
| `own`        | has bank, no active nominee, account not shared, name matches                             |
| `nominee`    | an active `worker_payout_nominee` row exists — the recorded, consented case               |
| `unrecorded` | account is shared with another worker, and/or the name does not match, and no nominee row |

⚠️ **This reader cannot run in an RLS session.** `workers.bank_*` are zero-grant
(only `postgres`/`service_role` hold SELECT), and the shared-account count is
inherently cross-worker, so it is not expressible under row-level scoping at all.
It must go through the admin-client / DEFINER seam, as `payout-nominee.ts` already
does. `list_active_payout_nominees()` returns `worker_id`, so one call covers the
roster.

`unrecorded` is the worklist; drive it to zero.

## 5. Units

- **U1 — the detector (no schema).** Pure classifier + an admin-seam reader
  returning per worker: `sharedWithCount`, `nameMatches`, `hasActiveNominee` → the
  derived state. Exhaustive tests over the real shapes (spelling variance, shared
  account, near-miss account number, inactive worker). ⚠️ Pin the Thai honorific
  list — `ด.ช.` appears in live data. ⚠️ State and test the `active` filter.
- **U2 — surface it where the work happens.** A badge on the `/workers` roster row
  and edit sheet. `unrecorded` reads as an invitation, never an error.
  ⭐ **Refined on measurement (2026-08-05, built). `unrecorded` is ONE state covering
  TWO facts that need DIFFERENT remedies.** On a shared account the holder is often one
  of the workers themselves — live, **2 of the 3 shared groups contain their own owner**
  (ปาณิศา on `1130967980`, นางแก้ว on `020087576927`). Badging them "ยังไม่ได้บันทึกบัญชีตัวแทน"
  and offering the nominee form would invite them to invent a nominee for their OWN
  account. So the owner's row states the sharing (`ใช้บัญชีร่วมกับช่างคนอื่น`) and gets **no
  CTA** — the work belongs to the other rows on that account. Live split: **6 third-party
  badges + 2 owner badges** across 43 rows.
  ⚠️ **The CTA MUST deep-link `?worker=<uuid>`, structurally.** The nominee ADD picker
  lists only workers with **no bank of their own** (`listBanklessWorkers`, "เลือกช่างที่ยัง
  ไม่มีบัญชีธนาคารของตัวเอง") — every worker this badge fires on HAS one, so without the
  parameter none of them is reachable through the normal flow. The deep-linked form has
  no bankless guard and `set_worker_payout_nominee` has no bankless precondition, so the
  route works; it is only the picker that excludes them. **U3 should fix the picker.**
  ⚠️ **The CTA names the consent document** (`ต้องแนบหนังสือยินยอม`): the RPC raises without
  an uploaded หนังสือยินยอม, and §8 Q1 names that upload as the leading suspect for 0 rows.
  An invitation that dead-ends at an unobtainable artifact is worse than one that states
  its price.
  ⚠️ **Gated at the SOURCE on `PAYOUT_NOMINEE_ROLES`, not on page access.**
  `WORKER_ROSTER_ROLES` includes `project_manager`, who cannot open the nominee control;
  not computing the state means it never reaches their bundle. Verified live: pm sees
  0 badges of 43 rows, procurement and super_admin see 8.
  ⚠️ **The reader is wrapped on this page.** It throws by design (an empty worklist is a
  lie), but `/workers` is the only ช่าง-management surface in the app — a transient read
  error must cost the badges, never the roster.
- **U3 — route new entries to the right place.** On the `/workers` edit sheet,
  beside the bank fields: "บัญชีนี้เป็นของใคร" → own / someone else. _Someone else_
  opens the existing spec-320 flow. No new RPC — reuse `set_worker_payout_nominee`.
  ⚠️ **Must also cover the `worker_bank_change_requests` approval path** (§2), or
  third-party accounts keep arriving through the door this unit didn't close.
- **U4 — work the existing mismatches by hand.** A review list, per worker: confirm
  own / record a nominee / correct a typo. The spelling-variance rows are
  **corrections, not nominees** — and the `044…`/`014…` near-miss pair in §1 is very
  likely one such correction.

⚠️ **U1 → U2 → U3 order is load-bearing.** A badge whose control does not exist
strands the reader with a flag and no way to resolve it. U4 needs U3.

❌ **No unit for the 45-day nudge.** It already ships (§2).

## 6. Gates

Read + write:
`('procurement_manager','project_director','super_admin','procurement')` — the live
nominee-RPC membership.

⚠️ **No shared constant for this set exists today, and the instruction "don't
restate the list" is currently unfollowable.** `STAFF_APPROVAL_ROLES` is the same
set minus plain `procurement`; `BACK_OFFICE_ROLES` / `WORKER_ROSTER_ROLES` /
`PAYROLL_ROLES` all additionally include `project_manager`. Worse, the two shipped
nominee pages (`/settings/payout-nominees/page.tsx` and `.../edit/page.tsx`) already
pass the four literals inline to `requireRole`.

⇒ **U1 creates `PAYOUT_NOMINEE_ROLES = [...STAFF_APPROVAL_ROLES, "procurement"]` in
`role-home.ts` and migrates both existing pages onto it.** Budget it; it is real
work this spec previously hand-waved.

Bank columns are zero-grant PII: reads go through the DEFINER / admin seam, never a
field-role RLS session. No new role, no enum change.

## 7. Related, deliberately NOT in this spec

🚨 **An earlier revision of this section was WRONG in every particular. It is kept
corrected rather than deleted, because the way it was wrong is the finding.**

It claimed worker `นายเหิน เมืองงาม` had two records, that record B (`PRC-26-0036`)
was **mis-bound** to the `site_admin` account `aemon`, and that repairing it needed
an unbind capability the codebase lacks. The audit log refutes all of it:

- **2026-08-02 01:23Z** — aemon submitted a staff registration **for herself**
  (`full_name = เอมอร ฮามศรีพรม`, phone `0832569095`).
- **2026-08-02 06:32Z** — approved, creating her worker record with employee id
  `PRC-26-0036`, bound to her own account, carrying her own bank. The audit payload
  says `source: staff_registration`. **The binding was correct.**
- **2026-08-04 05:34–06:16Z** — procurement, hunting for `เหิน`, edited _that_ row:
  project move, rate `0 → 515.46`, **renamed it to `นายเหิน เมืองงาม`**, gender
  `male`, pay type daily/temporary, then deactivated it. It still carries aemon's
  phone and employee id today.

So there are **two people with one record each**, not two records for one person;
nothing was ever mis-bound; and **no unbind capability is required**. Retiring B —
the action the earlier revision implied — would have erased a current employee's
record and her employee id.

⚠️ **Correction of fact:** only **one** function writes `workers.user_id` —
`claim_worker_invite` — plus `create_worker`'s insert. `decide_identity_change`
updates `users.full_name`, and `decide_worker_bank_change` merely joins on the
column; neither writes it. (The earlier claim of "three writers" came from a
fact-check whose pattern matched any body mentioning both `workers` and `user_id`.
⭐ A fact-checker's finding is itself a claim.)

⭐ **The real gap the episode exposes, and the subject of its own spec: back-office
can silently overwrite the IDENTITY of a worker record belonging to a registered,
portal-bound person.** When the worker changes their own name it routes through
`identity_change_requests` → `decide_identity_change` approval; when back-office
renames that same bound worker, `update_worker` simply does it — no confirmation, no
signal on the edit sheet that the row belongs to someone's account, and only a
generic `worker_change` audit row.

⭐ **Note what held:** the bank lock (`รออนุมัติจากคำขอของช่าง`, §2) is the sole
reason เหิน's bank details did not land on aemon's record. The protection exists for
money and stops at the identity — which is exactly the asymmetry to close.

## 8. Open questions

1. **Why is the nominee feature unused — placement or the consent upload?** The
   storage-object check (§2) makes friction the stronger candidate. Ask the team
   before designing around either. If it is the upload, the real question is whether
   a nominee may be recorded provisionally with the document owed.
2. Is `อนันตชัย ทีฆายุทธสกุล` collecting for his crew by arrangement? If so these are
   legitimate nominee rows with relationship `หัวหน้าชุด`, not problems.
3. Are `014162319729` and `044162319729` the same passbook mistyped? If yes it is a
   correction and the concentration is genuinely 4 workers on one account.
4. The `ด.ช.` prefix suggests an account in a minor's name. Confirm with the team; it
   may just be a stale passbook.
5. Does the detector include inactive workers? (§1)
   ⭐ **ANSWERED by U1 (2026-08-04): no — the count is over the ACTIVE roster**, and
   spec 396's incident is the reason. Account `020203221364` looks shared, but its
   second row is `นายเหิน เมืองงาม` — the **unrepaired** deactivated mis-edit that
   overwrote a real employee's record (it still carries her phone and employee id;
   restoring it needs her own answers). Counting it would report a live shared account
   that does not exist. Active-only takes the live shared-account count from 4 to 3.
   ⚠️ **The blind spot this leaves, stated rather than hidden:** payroll's payee read
   (`fetchWorkerBanks`) is **not** active-filtered, so a deactivated worker with
   unsettled wages can still be paid into a shared account and U1 will not see them.
   Closing that needs a decision about terminated-but-owed workers — it is not a code
   detail. **Still open.**

6. **Does a nominee record consent to the WORKER, or to one ACCOUNT?** U1 implements
   the latter: a nominee whose `payee_account_number` differs from the account
   currently on `workers.bank_account_number` does **not** count as recorded, because
   payroll pays the account on file and a stale nominee would silence the flag
   permanently. §4's table says only "an active row exists" — U1's reading is
   deliberately narrower. Confirm it matches how the team actually uses the record.

7. **Formatting variants of an account number.** U1 groups on the TRIMMED string only,
   so `014-1623197-29` and `014162319729` would be two groups and the sharing would go
   undetected. Measured 2026-08-04: **all 42 stored numbers are digits-only**, so there
   is nothing to normalise today. Revisit with evidence if hand-entry ever introduces
   separators — note this is a FORMATTING question, distinct from the `044…`/`014…`
   near-miss in Q3, which stays a human correction (U4).
