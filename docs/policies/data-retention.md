# Policy: Data Retention & Erasure (Thailand PDPA)

> **STATUS: DRAFT SCAFFOLD — NOT YET IN FORCE, NOT YET COUNSEL-REVIEWED.**
> Scaffolded on **2026-07-09** alongside [`privacy-policy.md`](./privacy-policy.md).
> The **mechanisms** described here are factual (verified against the live
> schema on 2026-07-09). Every **retention period** and every
> **erasure-on-withdrawal decision** is a firm/counsel choice left as an explicit
> **`<<FILL: ...>>`** placeholder. [ADR 0079](../decisions/0079-self-governance-crew-onboarding.md)
> §5 already records that "the retention-vs-erasure policy on withdrawal" is a
> **counsel decision** — this document is where that decision, once made, is
> written down.

**Applies to:** all personal data held by the PRC Ops application (see the
inventory in `privacy-policy.md` §4).
**Companion documents:** [`privacy-policy.md`](./privacy-policy.md),
[`change-management.md`](./change-management.md),
[`break-glass.md`](../break-glass.md) (the operator-only procedure any true
erasure must currently go through).

---

## 1. The headline gap (state it plainly)

**There is no automated retention or erasure in the application today.**

- **Erasure is a manual, service-role SQL operation.** There is no self-service
  "delete my data" feature, no scheduled purge job, and no retention clock.
  Fulfilling a PDPA erasure request (s.33) means an operator writing and running
  targeted SQL against the live database.
- **No soft-delete / anonymisation columns exist.** A schema sweep on 2026-07-09
  found **no** `deleted_at`, `deactivated_at`, `redacted_at`, or
  anonymisation columns on any table. "Removal" is expressed only as:
  - `active` boolean flags (`workers.active`, `crews.active`,
    `subcontract_crew_members.active`) — these hide a record from active use but
    **retain all personal data**;
  - lifecycle timestamps `crew_members.removed_at`,
    `worker_invites.expires_at` / `contractor_invites.expires_at`,
    `client_invites.access_expires_at`,
    `client_portal_access.expires_at` / `revoked_at`,
    `login_handoffs.expires_at` — these **expire access**, not the data;
  - consent `revoked_at` (`contractor_consents`, `staff_consents`) — this
    records **withdrawal of consent**, and does **not** itself erase the
    underlying personal data the consent covered.
- **Several stores are append-only and cannot be deleted through the app at
  all.** `audit_log`, `photo_logs`, `labor_logs`, and `wage_payments` use the
  append-only / supersede pattern (CLAUDE.md; ADR 0004 / 0009 / 0015). A logical
  "delete" is a new tombstone row, **not** a physical delete. True physical
  removal requires the operator-only **break-glass** procedure.

This is the gap G8 tracks. Until it is closed, the honest disclosure in
`privacy-policy.md` §7 ("erasure is a manual process") must stand.

## 2. Retention & erasure matrix

One row per data category from `privacy-policy.md` §4. **Retention period** is
the maximum time the firm keeps the data after the triggering event; all are
`<<FILL>>` pending counsel. **Erasure today** is the mechanism that would
actually remove the data now.

| #   | Category                                      | Primary tables                                                                                                                                      | Retention period                                                                             | Retention basis                                                                | Erasure today                                                            |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | App-user account & identity                   | `users`, `login_handoffs`                                                                                                                           | `<<FILL>>` (handoffs are ephemeral — `expires_at`)                                           | Service provision; account lifecycle                                           | Manual service-role SQL; `login_handoffs` self-expire                    |
| 2   | Field-worker records                          | `workers`, `worker_bank_change_requests`, `worker_invites`, `worker_project_moves`, `crew_registrations`, `crew_members`                            | `<<FILL: e.g. employment + statutory tail — Labour Protection Act min. retention; confirm>>` | Payroll, safety, statutory employment records                                  | Manual SQL; today `active=false` only hides, does not erase              |
| 3   | Subcontractor / migrant crew                  | `subcontract_crew_members`, `subcontract_crew_attachments`, `subcontract_payments`                                                                  | `<<FILL: incl. work-permit statutory retention>>`                                            | Immigration/work-permit compliance, payment records                            | Manual SQL + Storage object delete for attachments                       |
| 4   | Contractor & staff onboarding                 | `contractors`, `contractor_bank_change_requests`, `contractor_users`, `contractor_invites`, `staff_registrations`, `staff_registration_attachments` | `<<FILL>>`                                                                                   | Contractual relationship; onboarding audit                                     | Manual SQL + Storage object delete for attachments                       |
| 5   | Consent records                               | `contractor_consents`, `staff_consents`                                                                                                             | `<<FILL: keep the consent/withdrawal record even after erasing covered data? — counsel>>`    | Proof of consent / withdrawal (accountability)                                 | Withdrawal recorded via `revoked_at`; record itself retained as evidence |
| 6   | Client & portal                               | `clients`, `client_invites`, `client_portal_access`                                                                                                 | `<<FILL>>` (access self-expires via `expires_at`)                                            | Progress-portal relationship                                                   | Manual SQL; access grants self-expire / `revoked_at`                     |
| 7   | Vendor / supplier / service-provider contacts | `suppliers`, `service_providers`, `equipment_owners`, `contact_bank`, `contact_attachments`                                                         | `<<FILL>>`                                                                                   | Procurement relationship; accounting                                           | Manual SQL + Storage object delete for attachments                       |
| 8   | Tax documents                                 | `wht_certificates`                                                                                                                                  | `<<FILL: statutory — Thai Revenue Code, commonly ~5 yr; confirm>>`                           | **Legal obligation** — likely blocks erasure until the statutory period lapses | Retained for the statutory period; not erasable before it                |
| 9   | Progress photos                               | `photo_logs`, `photo_markups` (files in Storage)                                                                                                    | `<<FILL>>`                                                                                   | Work evidence, dispute defence                                                 | Append-only DB row + Storage object; physical removal is break-glass     |
| 10  | Feedback                                      | `feedback`, `feedback_messages`, `feedback_message_drafts`, `feedback_attachments`, `feedback_views`                                                | `<<FILL>>`                                                                                   | Support / product record                                                       | Manual SQL + Storage object delete for attachments                       |
| 11  | Usage telemetry                               | `interaction_events`, `usage_daily`                                                                                                                 | `<<FILL: e.g. raw events N days, rollups longer; confirm>>`                                  | Product improvement (ADR 0068)                                                 | Manual SQL; `usage_daily` is an aggregate rollup of raw events           |
| 12  | Payroll / payment records                     | `wage_payments`, `subcontract_payments`                                                                                                             | `<<FILL: statutory accounting retention>>`                                                   | **Legal obligation** — accounting records                                      | Append-only; retained for statutory period                               |
| 13  | Audit trail                                   | `audit_log`                                                                                                                                         | `<<FILL>>`                                                                                   | Security, accountability, defence of claims                                    | **Immutable — cannot be erased through the app by design** (see §3)      |
| 14  | Notifications                                 | `notification_outbox`                                                                                                                               | `<<FILL: short — drain + prune>>`                                                            | Delivery + retry                                                               | Manual SQL prune of sent/failed rows                                     |

## 3. The append-only / audit-log tension with the erasure right

`audit_log` is immutable by design (ADR 0004): UPDATE/DELETE privileges are
revoked, RLS grants no delete, and a trigger raises on any mutation. This is a
deliberate integrity control — but it means personal data embedded in an
`audit_log.payload` (or in `photo_logs` / `labor_logs` / `wage_payments`, which
are append-only for the same reason) **cannot be physically deleted through the
application.**

Under PDPA this is handled by the erasure right's own limits, not by weakening
the audit trail: retention for the **establishment, exercise, or defence of
legal claims** and for **compliance with a legal obligation** are recognised
grounds to retain. The intended posture (to be confirmed by counsel) is:

- **Do not delete audit / append-only rows.** Retain them on the legal-record
  basis for their statutory/limitation period.
- **Erase or anonymise the referenced live data** (e.g. the `workers` row) so
  that the retained audit rows point at an anonymised subject where possible.

`<<FILL: counsel to confirm this posture and the retention/limitation period for
audit and append-only records>>`

## 4. Counsel-pending decisions (do not guess)

Per [ADR 0079](../decisions/0079-self-governance-crew-onboarding.md) §5 and the
scope of this scaffold, the following are **not** decided here and must be set by
counsel:

1. Every retention **period** in the §2 matrix.
2. Whether **withdrawal of consent** (`revoked_at`) triggers **erasure** of the
   data that consent covered, or only stops further processing while the record
   is retained on another basis.
3. The retention/limitation period for **immutable audit and append-only**
   records, and the anonymise-by-reference posture in §3.
4. Whether the **legitimate-interest** basis for proxy-onboarded worker PII
   (ADR 0079 §5) is sufficient, which governs what a valid erasure request can
   compel.

## 5. Closing the gap (not built here — scope note)

This document is a scaffold; it commits no engineering. When the firm decides to
close the gap, the shape of the work — to be specced and built separately, not
in this docs-only change — is roughly:

- a **retention clock** and a scheduled **purge/anonymisation job** driven by the
  §2 periods;
- **soft-delete / anonymisation columns** (the `deactivated_at` idea parked in
  spec 235) so a subject can be deactivated and then anonymised on schedule;
- a **data-subject-request (DSAR) runbook** turning the manual SQL of §1 into a
  repeatable, logged procedure (access, rectification, erasure, portability);
- an **anonymise-by-reference** routine for the append-only stores in §3.

Until then, retention is governed by this policy on paper and enforced by hand.

---

### Provenance

Mechanisms verified 2026-07-09 against `src/lib/db/database.types.ts` and
`supabase/migrations/`. The absence of `deleted_at` / `deactivated_at` /
anonymisation columns, and the append-only nature of `audit_log` / `photo_logs`
/ `labor_logs` / `wage_payments`, are facts as of that date — re-verify if the
schema changes. Gap **G8** in the GA-readiness register.
