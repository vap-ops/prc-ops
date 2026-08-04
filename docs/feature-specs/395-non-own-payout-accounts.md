# 395 — บัญชีรับเงินที่ไม่ใช่ของช่างเอง (non-own payout accounts)

**Status:** draft
**Author:** CC session 2026-08-04
**Related:** spec 320 (payout nominee), ADR 0061 (worker ecosystem / financial inclusion), ADR 0079 (self-governance), spec 172/ADR 0062 (procurement owns ช่าง onboarding)

---

## 1. Why

The operator asked for abnormal payout accounts to be **flagged**, so the firm can
encourage every ช่าง to hold their own account (ADR 0061's financial-inclusion
goal). Today nothing surfaces this, and the practice has quietly routed around the
one mechanism built for it.

**Measured live 2026-08-04** (roster was 37 rows at scan time and is growing during
the working day — dada is onboarding; **re-measure before building, do not inherit
these numbers**):

| Class                                        | Count |
| -------------------------------------------- | ----- |
| Account name matches the worker (normalised) | 27    |
| **Name does NOT match**                      | **8** |
| Bank number present, account name blank      | 2     |
| `worker_payout_nominee` rows, all-time       | **0** |

The 8 are not one problem. Classified by hand:

| Class                                              | Rows  | Example                                                            |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| ⚠️ **One holder collecting for several workers**   | **4** | โนรี / พิเชษฐ์ / สายฟ้า / อนันตชัย → all → `อนันตชัย ทีฆายุทธสกุล` |
| Same person, Thai spelling or prefix variance only | 2     | `สุรินทร์ นาคพันธุ์` vs `นางสุรินทร์ นาคพันธ์`                     |
| Family (shared surname)                            | 1     | `นายแดง บุญวัง` → `นางแก้ว บุญวัง`                                 |
| Unrelated third party                              | 1     | `เอกพัฒน์ อ่อนสา` → `น.ส.ปาณิศา บุญเรือง`                          |

Plus a data-integrity case found the same day and handled separately (§7): worker
`นายเหิน เมืองงาม` record B carries a colleague's account.

⭐ **The concentration is the finding, not the count.** Three workers' wages land in
a fourth worker's account, and three of those four rows carry the prefix **ด.ช.
(เด็กชาย — a minor)**. This may be entirely legitimate — a หัวหน้าช่าง collecting for
his crew is normal practice — but it is invisible today, and it is precisely the
concentration the firm would want to see and eventually unwind.

## 2. What already exists — and why it is empty

**Spec 320 already built this model.** `worker_payout_nominee` carries
`payee_name`, `payee_relationship`, `payee_bank_name`, `payee_account_name`,
`payee_account_number`, a **required** `consent_doc_path`, `set_by`/`set_at`,
`cleared_by`/`cleared_at`, `active`. Four DEFINER RPCs exist
(`set_` / `get_` / `list_active_` / `clear_worker_payout_nominee`), the table is
zero-grant bank PII, and `PAYOUT_NOMINEE_STALE_DAYS = 45` already exists as
display-only reclaim pressure — i.e. the "encourage them to get their own account"
nudge is **already designed and shipped**.

It has never been used once.

**Two candidate causes, both verified against the live system:**

1. ❌ **Not the gate.** All four RPCs gate on
   `('procurement_manager','project_director','super_admin','procurement')` —
   verified live. dada can already set a nominee today.
   ⚠️ `src/lib/payroll/payout-nominee.ts` says "procurement_manager-gated". That
   comment is **stale**; the live gate is wider. Fix it in whichever unit touches
   the file.
2. ✅ **Placement.** The bank fields sit on the `/workers` edit sheet where
   onboarding actually happens; the nominee lives on a separate page under
   `/settings/payout-nominees`. The person typing the account never passes the
   nominee control, so the third-party account goes into `workers.bank_*` — which
   silently asserts the account is the worker's own, and bypasses the consent doc,
   the audit trail and the 45-day nudge.
3. ⚠️ **Suspected secondary friction:** `consent_doc_path` is `NOT NULL`, so
   recording a nominee requires uploading a consent document. Unconfirmed —
   **ask the team before designing around it** (§8).

**So this spec is mostly not new machinery. It is: detect what already went to the
wrong place, route new entries to the right place, and migrate the existing 8.**

## 3. The signal

⭐ **Primary detector — shared account, no name logic:**

> the number of DISTINCT workers sharing one `bank_account_number`

Objective, immune to Thai spelling variance, and it catches the concentration case
immediately. This is the one with real audit and financial-inclusion weight.

**Secondary detector — normalised name mismatch (advisory only):**

Strip honorifics (`นาย|นาง|นางสาว|น.ส.|ด.ช.|ด.ญ.`) and whitespace, then compare.

⚠️ **Do NOT make name mismatch the primary flag.** 2 of the 8 measured mismatches
are pure spelling variance for the same person — a name-based flag would nag those
two forever while saying nothing about concentration. Name mismatch is a hint that
a nominee record is _probably missing_, never a defect claim in itself.

⚠️ **A non-matching account holder is NORMAL at this firm** (operator, 2026-08-04:
some technicians use a family member's account temporarily). Copy must never call
it an error. The ask is _record it and encourage_, not _forbid_.

## 4. Design

Three states per worker, derived — no new column on `workers`:

| State        | Derivation                                                                                |
| ------------ | ----------------------------------------------------------------------------------------- |
| `own`        | has bank, no active nominee, account not shared, name matches                             |
| `nominee`    | an active `worker_payout_nominee` row exists — the recorded, consented case               |
| `unrecorded` | account is shared with another worker, and/or the name does not match, and no nominee row |

`unrecorded` is the worklist. The goal is to drive it to zero — every genuine
third-party account becomes a `nominee` row, and every worker who can open their
own account moves to `own`.

## 5. Units

- **U1 — the detector (no schema).** A server reader returning, per worker:
  `sharedWithCount`, `nameMatches`, `hasActiveNominee` → the derived state.
  Pure function + exhaustive tests over the real shapes (spelling variance, shared
  account, blank account name). ⚠️ Pin the Thai honorific list; a `ด.ช.` prefix
  appears in live data and must normalise away.
- **U2 — surface it where the work happens.** A badge on the `/workers` roster row
  and the edit sheet. `unrecorded` reads as an invitation, never an error.
- **U3 — the nominee control moves to the point of entry.** On the `/workers` edit
  sheet, beside the bank fields: "บัญชีนี้เป็นของใคร" → own / someone else. Choosing
  _someone else_ opens the existing spec-320 nominee flow. No new RPC — reuse
  `set_worker_payout_nominee`.
- **U4 — migrate the existing 8.** Not a script. A review list the procurement team
  works through, per worker: confirm own / record a nominee / correct a typo. The
  two spelling-variance rows are corrections, not nominees.
- **U5 — the reclaim nudge.** `PAYOUT_NOMINEE_STALE_DAYS = 45` already exists and is
  unwired to any surface. Give it one: a soft worklist of nominees older than 45
  days, to prompt "can this ช่าง open their own account yet?"

⚠️ **U1 before U2 before U3.** Shipping a badge whose control does not exist yet
strands the reader with a flag and no way to resolve it. U4 needs U3 to exist.

## 6. Gates

- Read + write: `('procurement_manager','project_director','super_admin','procurement')`
  — the live nominee-RPC gate. **Do not restate the list**; call the same gate the
  RPCs use, or the two drift (this repo has hit that exact failure before).
- Bank columns are zero-grant PII: reads go through the DEFINER RPCs / admin-client
  seam, never a field-role RLS session. Follow `payout-nominee.ts`'s existing shape.
- No new role, no enum change.

## 7. Related, deliberately NOT in this spec

**Worker `นายเหิน เมืองงาม` is broken in a different way** and is being repaired
separately: two records exist, and record B (`PRC-26-0036`) is bound to the user
account `aemon` (a `site_admin`, a different person), carrying aemon's bank account.
Operator decision 2026-08-04: **keep record A**, its 07-25 attendance is real, the
ธ.ก.ส. account on B is aemon's.

That repair needs a capability this codebase does not have: **there is no in-app way
to unbind a worker from a user.** `create_worker` accepts `p_user`; `update_worker`
does not; no unbind RPC exists. So a mis-link is currently unfixable from the UI and
will recur. That belongs in its own spec.

## 8. Open questions

1. Is the `consent_doc_path` NOT NULL requirement the real adoption blocker? Ask the
   team before designing around it — if yes, the question is whether a nominee may
   be recorded provisionally with the document owed.
2. Is `อนันตชัย ทีฆายุทธสกุล` collecting for his crew by arrangement? If so these are
   four legitimate nominee rows, not four problems — but the relationship should be
   `หัวหน้าชุด`, not family.
3. The `ด.ช.` prefix on three account names suggests an account in a minor's name.
   Confirm with the team; it may just be a stale passbook.
4. 2 workers have a bank number but a blank account name — decide whether that is
   `unrecorded` or its own "incomplete" state.
