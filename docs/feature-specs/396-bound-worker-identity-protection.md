# 396 — ปกป้องตัวตนของช่างที่ผูกบัญชีแล้ว (protecting a bound worker's identity)

**Status:** draft
**Author:** CC session 2026-08-04
**Related:** spec 395 §7 (the incident), ADR 0062 (ช่าง binds on `workers.user_id`),
spec 317 / `identity_change_requests` (the worker-side name-change flow),
spec 172 / ADR 0062 (procurement owns ช่าง onboarding)

---

## 1. Why — a real employee's record was overwritten with another person's identity

On 2026-08-04 procurement, looking for worker `นายเหิน เมืองงาม`, opened a
**different** worker's record and renamed it to his name. Reconstructed from
`audit_log`:

| When (UTC)        | Who         | What                                                                                                                          |
| ----------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 08-02 01:23       | aemon       | submits a staff registration **for herself** (`เอมอร ฮามศรีพรม`, phone `0832569095`)                                          |
| 08-02 06:32       | Pattrawut   | approves it → creates her worker record, `PRC-26-0036`, bound to her own account, her own bank (`source: staff_registration`) |
| 08-04 05:34–05:35 | procurement | project move; day rate `0 → 515.46`; active toggled                                                                           |
| **08-04 05:55**   | procurement | **name → `นายเหิน เมืองงาม`**, gender `male`, pay type daily/temporary                                                        |
| 08-04 06:16       | procurement | deactivates the row                                                                                                           |

The record still carries **aemon's phone and employee id**. Nothing was mis-bound —
the binding was correct throughout. This was a **mis-edit**, and the app offered no
signal that the row belonged to someone with their own login.

⭐ **What held:** the bank lock (`รออนุมัติจากคำขอของช่าง`) is the only reason
`เหิน`'s bank details did not also land on aemon's record. **The protection exists
for money and stops at the identity.** That asymmetry is this spec.

## 2. Blast radius — measured

⚠️ Snapshot 2026-08-04; the roster is growing daily. Re-measure at build time.

| Measure                             | Value                                               |
| ----------------------------------- | --------------------------------------------------- |
| Workers bound to a user account     | **15 of 39**                                        |
| Back-office rename events, all-time | **22**                                              |
| …of those, on a **bound** worker    | **11 (50%)**                                        |
| Those 11: actor / date              | **all** procurement, **all** 2026-08-04 05:37–05:55 |
| Pending `identity_change_requests`  | **4, all `pending`**                                |

⭐ **Ten of the eleven were legitimate** — a bulk normalisation pass adding
`นาย`/`นาง`/`นางสาว` prefixes (`นายจรูญ โสภา` → `นายจรูญ โสภา`), ten of them inside
90 seconds. The eleventh, twenty minutes later, replaced a person.

⚠️ **This is why the fix is NOT "block renames."** Renaming bound workers is normal,
frequent and useful work. The system simply cannot distinguish _normalise this
person's name_ from _replace this person with a different person_ — and neither can
the person doing it, because nothing on screen says whose record it is.

## 3. The asymmetry

| Who renames a bound worker | Path                                                  | Result                                                                     |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| **The worker themself**    | `identity_change_requests` → `decide_identity_change` | Queued for approval. **4 are pending right now, undecided.**               |
| **Back-office**            | `update_worker`                                       | Instant. No confirmation, no ownership signal, no previous value retained. |

From a data-integrity standpoint this is backwards: the person best placed to know
their own name waits for approval; the person least able to verify it writes
immediately.

## 4. Two concrete holes

1. **The UI structurally cannot name the account holder.**
   `src/app/workers/page.tsx:174` destructures `user_id` out and passes only a
   boolean `portalBound` to the client. The edit sheet's only ownership cues are the
   bank lock and a `เชื่อมบัญชีพอร์ทัลแล้ว` card — **neither says _whose_ account.**
   Surfacing a name is a deliberate PII decision, not an oversight to code around
   (§8).
2. **The audit payload keeps only the NEW value.** A rename writes
   `{"kind":"update","name":"<new>"}` — there is no previous value anywhere. The
   original name in this incident was recoverable **only** because an approved
   `staff_registrations` row happened to hold it. A worker created any other way
   would be unrecoverable from the log.

## 5. Units

- **U1 — audit the previous value.** `update_worker` records `name_before` /
  `name_after` (and the same for the other identity fields it changes) in the
  `worker_change` payload. No UI. Cheapest unit, and the one that makes this whole
  class recoverable rather than merely detectable. ⚠️ `audit_log` is append-only —
  this changes what a NEW row contains, never an existing one.
- **U2 — say whose record this is.** When `user_id is not null`, the edit sheet
  names the bound account holder rather than only asserting that a binding exists.
  Requires passing one display name through the boundary that currently passes a
  boolean — see §8 Q1 before building.
- **U3 — confirm a non-normalising rename of a bound worker.** If the row is bound
  and the new name is not a normalisation of the old (prefix added, whitespace or
  honorific changed), require an explicit confirm naming the account holder.
  ⚠️ **The copy must not accuse** — ten of eleven such renames were correct work.
  It reads as _this record belongs to X — is that who you mean?_, never as a warning.
- **U4 — surface the pending identity queue.** 4 `identity_change_requests` sit
  `pending` with no worklist pointing at them. Small, and it closes the other half
  of the asymmetry.

⚠️ **U1 before U2/U3.** U1 is independent, cheap, and makes every later mistake
recoverable; U2 and U3 only reduce the rate.

## 6. Gates

- `update_worker` is already `is_back_office`-gated; **this spec does not narrow
  who may rename.** It adds signal and a trail, not authority.
- No new role, no enum change, no change to `workers.user_id` semantics.
- U1 touches a DEFINER RPC and the audit payload ⇒ migration ⇒ danger path ⇒
  operator-merged or grant-merged.

## 7. Non-goals

- ❌ **No unbind capability.** An earlier reading of this incident called for one;
  the audit log refuted it — nothing was mis-bound. `claim_worker_invite` (visitor
  only, refuses an already-linked worker, refuses an already-bound caller) plus the
  `workers_user_id_key` unique partial index already guard the binding well.
  ⚠️ `create_worker` does accept an unvalidated `p_user`, but **no app code passes
  it**; note it, do not build on it.
- ❌ **Do not route back-office renames through `identity_change_requests`.** That
  would queue the ten legitimate normalisations behind an approver who is already
  four requests behind.

## 8. Open questions

1. **May the edit sheet display the bound account holder's name?** It is another
   employee's identity shown to procurement, who can already see the roster — but
   `page.tsx` strips `user_id` deliberately, so treat this as a PDPA decision, not a
   refactor. If the answer is no, U2 degrades to "this record belongs to a
   registered account" without the name, and U3 carries the whole load.
2. Should U3's confirm also fire on gender / pay-type / employment changes to a bound
   row? All three were overwritten in this incident.
3. Who should work the 4 pending `identity_change_requests` (U4)?
4. Repair of the damaged record is **operational, not code** — it needs aemon's own
   answers (gender, whether daily/temporary @ 515.46 and the project move are hers).
   Tracked with the operator, not in this spec.
