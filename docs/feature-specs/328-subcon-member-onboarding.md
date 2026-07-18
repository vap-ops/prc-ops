# Spec 328 — Subcontractor-member onboarding QR (ทีมผู้รับเหมา)

**Status:** design approved by operator 2026-07-18 (chat, with UI mockup). Build not started.
**Depends on:** spec 279/282/298 registration pipeline (live), spec 306 muster (live U1–U4).
**ADRs touched:** 0051 (external partner portal), 0060/0061 (money governance), 0079 (onboarding gates), 0080 (org axes).

## 0. Why (grounded in a real day)

The operator's hand-typed daily report for TFM โพธิ์ทอง (18/07/2026, 48 heads) contains
21 workers from subcontractor trade crews (หลังคา, ฐานราก, ไฟ, กระเบื้อง, กระจก). Live
gap-check (2026-07-18): the contractor FIRMS already exist in `contractors` (ช่างสุทิน/ประดับ,
ช่างอวย, วุฒินันท์, ธนากร/24 เฮ้าส์ …) but the member layer is empty — `contractor_users` 0,
`subcontract_crew_members` 0, `workers.contractor_id` set on 0 rows. Those 21 people
cannot be muster-scanned, so attendance capture (spec 306) and the future auto daily
report (spec 212 revive) stop at the PRC-paid half of the site.

The existing QR (`/register/technician`, spec 282 F2a/F2b) is the WRONG vehicle: it
feeds the PRC-paid pipeline (bank capture, day_rate, cost-confirm gate). Pay-model
doctrine: the subcon firm pays its own crew; PRC pays the firm per work package.
Therefore members must onboard WITHOUT any bank/pay data — but WITH a login, so they
carry their own muster QR and self-serve their identity (self-governance doctrine).

## 1. Operator decisions (locked 2026-07-18)

| #   | Decision       | Choice                                                                                                                                                                                                                                                             |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Member storage | `workers` row with `contractor_id` set — pay-exempt. Muster, badges, digital QR card, daily-report roster all work unchanged. (Rejected: separate `subcontract_crew_members` path — every attendance surface FKs `workers`; rejected: login-only — not scannable.) |
| D2  | Login role     | `technician` (existing role; `/technician` home + digital muster QR already built). The `contractor_id` on the worker row is what marks them external — no new enum value.                                                                                         |
| D3  | Approval       | SA on site, via the existing `/registrations` queue (F2b invited-by pattern). (Rejected for v1: contractor-lead self-approval — `contractor_users` is 0 today; auto-approve — no gate.)                                                                            |
| D4  | QR shape       | Per-firm QR (one per active contractor × project), NOT a single QR with classify-at-approval. Classification happens at scan time where it is self-evident (member scans own team's poster). Omotenashi: burden lands on nobody.                                   |
| D5  | Distribution   | SA screen-show, printed per-firm poster, or LINE-forwarded link — all the same URL. Poster recommended for the 21-person backlog.                                                                                                                                  |

## 2. Design

### 2.1 Mint (SA side)

`/team` → เพิ่มช่างใหม่ sheet gains ONE new selector **สมัครเข้าทีม** under the existing
โครงการ select:

- Row 1: **ทีม PRC** (ช่างบริษัท / ทีมงาน DC) → today's QR + เพิ่มเอง manual arm, unchanged.
- Rows 2+: one row per **active contractor** → firm QR card below, labelled
  `สมัครทีม <firm> — <project>` with hint `ไม่เก็บข้อมูลธนาคาร`, plus พิมพ์โปสเตอร์ and
  ส่งลิงก์ทาง LINE actions.

Link = existing route + one new param:
`/register/technician?project=<id>&contractor=<id>&site=<name>&by=<sa_uid>`.

### 2.2 Register (member side)

Member opens link → LINE login (existing flow — registration is already login-first,
`staff_registrations.user_id NOT NULL`) → same identity form (name/phone/DOB). Banner
shows firm + project (`สมัครทีม ช่างอวย — โพธิ์ทอง`) so a mis-scan is catchable.

**⚠ Bank reality (fact-check 2026-07-19, corrects the design chat):** the pipeline
TODAY is bank-mandatory — `approve_staff_registration` carries unconditional spec-296
floors (id_card + PDPA consent + `book_bank` attachment + `staff_registration_bank`
rows) before ANY approval, and the register flow captures them. "No bank for
contractor members" is therefore something U1/U2 must BUILD, not something already
true: U1 skips the `book_bank` + `staff_registration_bank` floors when
`p_contractor_id` is set (id_card + PDPA consent floors STAY); U2 hides the bank
capture step on the register flow when the firm banner is active.

**Trust rule (F2b verbatim):** every QR param is visitor-supplied → advisory display
and pre-select ONLY. Never an authz edge. The binding contractor/project are always the
APPROVER's confirmed values, and pre-selects are honored only when the invited id is a
visible, active option in the approver's own RLS-scoped list — else fall back to empty
(spec 282 hidden-bind lesson).

### 2.3 Approve (SA side)

`/registrations` queue rows carry a firm chip when `invited_contractor_id` is present.
The decision screen pre-selects the firm (subject to the trust rule). On approve:

- user role → `technician` (QR role options already restrict to technician/site_admin);
- `workers` row minted with: `contractor_id = <approver-confirmed firm>`, `project_id =
<approver-confirmed project>`, `user_id` bound, `day_rate = 0`, `pay_type = 'daily'`,
  `cost_confirmed_at = NULL` **permanently** (never cost-confirmed — the money-governance
  gate that keeps them out of every pay surface).

### 2.4 Money wall (pinned, not conventional)

`workers.contractor_id IS NOT NULL` ⇒ pay-exempt:

- **Payroll** — excluded. Today this holds transitively (payroll reads `labor_logs`;
  none exist for them). U1 pins it with an explicit test so a future payroll change
  cannot silently include them.
- **Muster U5 derive (future)** — when spec 306 U5 lands, the derive MUST skip
  contractor-tied workers: their labor cost lives inside the WP contract price
  (pay-model doctrine). Recorded here so U5's spec inherits the rule.
- **Bank** — not collected for contractor members (U1/U2 carve, see §2.2), and
  profile-edit surfaces (spec 321 `ProfileEditSections`) hide bank sections for
  contractor-tied workers.
- **Payout-nominee bankless picker (spec 320) — LEAK, must close:** `listBanklessWorkers()`
  filters only `active + bank_account_number IS NULL` → contractor members would appear
  and a nominee payout could be routed for someone PRC never pays. U3 adds
  `contractor_id IS NULL` to the filter + a pin test.
- **Labor capture picker — LEAK, must close:** the WP labor picker surfaces ALL active
  daily workers (grouped by contractor_id) → a contractor member could be ticked into
  `labor_logs` and appear on payroll at gross 0. Their labor is not PRC cost (it lives
  in the WP contract price) — U3 excludes contractor-tied workers from the capture
  picker + pin test. This converts §2.4's payroll exclusion from transitive to enforced.
- **Coins/incentives (ADR 0061)** — out of scope v1; contractor members excluded until
  the operator rules otherwise.

### 2.5 What comes free (why D1)

Muster scan-in/out + OT, digital QR card on /technician + /profile, printed badge on
/team/badges, roster/team board, daily-report attendance — all zero-change, because
they key on `workers`. Bonus: the daily report's trade sections (ช่างหลังคา…) fall out
of grouping by contractor name at render time — no trade field needed on workers.

## 3. Verified-live facts this design rests on (2026-07-18)

- `approve_staff_registration(p_id, p_role, p_project_id?, p_pay_type?, p_employment_type?)`
  — live signature confirmed; mints a worker ONLY when `p_role='technician'` (site_admin
  approval mints no worker — reinforces the U1 role guard); carries unconditional
  spec-296 bank floors (see §2.2); `p_pay_type` DEFAULTS `'monthly'` → the contractor
  arm must pass `'daily'` explicitly. Gains optional `p_contractor_id` in U1.
- `staff_registrations` has `invited_by` / `invited_project_id` (F2b) — `invited_contractor_id`
  is the symmetric addition (nullable FK, ON DELETE SET NULL, existence-coerced). Bank
  data lives in the SEPARATE `staff_registration_bank` table + `book_bank` attachment —
  which is exactly what the contractor arm skips.
- `start_staff_registration` live sig = `(p_full_name, p_phone, p_declared_role_hint?,
p_invited_by?, p_invited_project_id?)` — U1 re-signature adds `p_invited_contractor_id`
  (defaulted, DROP old arity, re-revoke anon; F2b precedent).
- QR mint lives on `/team` (`AddTechnicianSheet`, `technicianOnboardUrl` helper — pure
  URL builder, `&contractor=` is an additive param).
- `workers` has NO worker_type column and NO CHECK tying `contractor_id` to anything;
  plain FK `workers_contractor_id_fkey → contractors(id)` (no cascade). One live RLS
  consequence of D1: policy "workers readable by bound contractor"
  (`contractor_id = current_user_contractor_id()`) means once firm principals get
  `contractor_users` logins (0 today), the firm can READ its own members' worker rows —
  intended (firm sees own crew), no self-escalation (`current_user_contractor_id()`
  reads `contractor_users`, not workers).
- `contractors` has 9 rows incl. the report's trade firms; 1 test row
  (⚠ ทดสอบระบบ CC 2026-07-14) should be cleaned before the picker ships.
- Muster live: `muster_attendance` FKs `workers.id`; scan payload = worker uuid
  (printed badge and digital card identical).

## 4. Units

| Unit | Lane                                | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1   | SCHEMA (danger-path, operator-held) | `staff_registrations.invited_contractor_id` (nullable FK, SET NULL) + `approve_staff_registration` gains `p_contractor_id` (existence-validated, approver-confirmed; mints worker with contractor_id + day_rate 0 + explicit `pay_type='daily'` + cost_confirmed_at NULL) + **bank-floor carve: when `p_contractor_id` is set, skip the `book_bank` + `staff_registration_bank` floors (id_card + PDPA floors STAY)** + `start_staff_registration` gains `p_invited_contractor_id` (re-signature per F2b precedent: defaulted param, DROP old arity, re-revoke anon) + **role guard: when `p_contractor_id` is set the RPC refuses any `p_role` other than `technician`** + pgTAP: happy path, forged-contractor coerce, role-guard refusal, bank-floor-carve (contractor arm approves WITHOUT bank; PRC arm still REFUSES without bank), payroll-exclusion pin, anon revoked. |
| U2   | CODE                                | `/team` sheet สมัครเข้าทีม selector (PRC row + active-contractor rows) + firm QR card + พิมพ์โปสเตอร์ + LINE share; `/register/technician` firm banner from `?contractor` (display-only, React-escaped, server-resolved name only) + **hide the bank capture step when the firm param is active**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| U3   | CODE                                | `/registrations` queue firm chip + decision pre-select (trust rule) + `ProfileEditSections` bank-hide + **close the 2 money-wall leaks (§2.4): `listBanklessWorkers()` gains `contractor_id IS NULL`; WP labor capture picker excludes contractor-tied workers** — each with a pin test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| U4   | PILOT (no code)                     | Clean the test contractor row; onboard ช่างอวย's crew (3 people, smallest firm) end-to-end: poster scan → LINE login → SA approve → muster scan next morning. Then the remaining firms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Sequencing: U1 → U2/U3 (parallelizable, disjoint files) → U4.

## 5. Open items (non-blocking, recorded)

- Contractor-lead self-approval (D3 rejected-for-v1) becomes attractive once firm
  principals hold logins (`contractor_users` still 0) — revisit after ADR 0051 portal
  adoption.
- Firm-member lifecycle (member leaves firm / moves site) — reuse worker deactivation
  path (spec 235 `deactivated_at`, parked) when it lands.
- The report's หัวหน้าโครงการ/แอดมิน staff-attendance gap is OUT of this spec (they are
  users, not workers) — separate operator decision pending (gap-check 2026-07-18).
- PDPA: members self-enter their own data post-login (self-consent lane). The 279 U3
  witnessed-consent question applies only to the phoneless path, which this spec does
  not use — subcon members without phones stay on paper until the operator extends
  the SA-proxy arm to them.
