# Spec 133 — Subcontractor-member → future-DC pipeline (prospect tier)

**Status:** proposed — 2026-06-17. **Type:** design / product decision (external
tier extension; reuses ADR 0051). **NOT built** — written to decide before any
unit. Operator framing (2026-06-16/17, below) is the source of truth for the model.

## The model this serves (operator, verbatim sense)

Three kinds of people in the field — distinguished by **how they are paid**:

1. **Company staff** — employees, on company payroll. (`worker_type = own`)
2. **DC (direct contractor)** — NOT employees, but **the company pays them
   directly, daily**. Every DC is paid the _same way_; the DC subtype
   (`dc_regular` / `dc_temporary` / `dc_company`) changes **gamification + rules
   only**, never the pay mechanism. (`worker_type = dc`, under a contractor)
3. **A subcontractor's (เหมา firm's) team members** — belong to a firm the company
   pays **lump-sum**; **the company does NOT pay these members** (the firm does).
   They are not in payroll. **But** the company wants to let them **join as portal
   users now**, so that if one later chooses to become the company's **own DC**,
   their profile/documents/consent already exist — instant onboarding.

This spec is about group (3): a **prospect** — a self-service portal user the
company does **not** pay, who is a candidate to become a DC later.

## Goal

Capture a subcontractor member's data **now** (self-service, zero money flows),
and **promote** them to a real DC later with that data intact — a recruiting /
data-capture pipeline that turns "we met them on a เหมา job" into "they're already
onboarded the day they go direct."

## Hard invariants

- **Zero money for a prospect.** No bank payout, no `dc_payments`, no payroll, no
  KBank/PEAK. A prospect may _stage_ bank/tax for later, but nothing pays out and
  nothing feeds the money pipelines until promotion. (Extends ADR 0051 §6 — staged,
  never auto-active — to "staged, and not even payable until promoted".)
- **Promotion is a deliberate PM act**, audited. A prospect never self-promotes
  (mirrors claim-once: the system never lets an external user grant themselves a
  paying relationship).
- **Data carries over on promotion** — the same record is reused (profile, the
  spec-131 packet: docs/consent/emergency, staged bank), not re-collected.

## Design fork — how to model a prospect (decide first)

**Option A — a `status` on the contractor record (Recommended).** Reuse the
existing `contractors` row + the ADR-0051 `contractor` tier + the spec-130
invite/claim, but add a contact-status value `prospect` (alongside
active/probation/blacklisted). A prospect is a contractor row with
`status = prospect`: self-serves the spec-131 packet + spec-132 contactability,
but the portal hides all money (no payment history, bank is capture-only).
**Promote** = PM flips `status` → `active` (an audited RPC), at which point the
DC subtype/gamification/rules attach and money turns on. _Pro:_ minimal new
surface, reuses everything (invite, packet, self-edit, RLS). _Con:_ overloads
`status`; "prospect" is a lifecycle state, not a standing like blacklisted.

**Option B — a distinct `prospect` external role / membership.** A separate role
(not `contractor`) bound the same way, with its own portal scoping; promotion
swaps the role to `contractor` + creates/activates the contractor record. _Pro:_
clean separation, no money table ever references a prospect. _Con:_ a second
external tier to build + prove (RLS, gates) — heavy; ADR 0051 deliberately kept
one external tier.

**Recommendation:** Option A. It is the smallest correct change and the money
posture is enforced the same way DC money already is (column grants + the
`get_my_dc_payments` reader naturally returns 0 rows for a non-paying contractor;
the portal simply hides the bank/payment surfaces for `status = prospect`). Revisit
B only if a prospect must be invisible to every contractor-tier query.

## Open questions (decide before U1)

- **The firm link.** Do we record _which_ subcontractor firm a prospect came from
  (a self-FK `contractors.referred_by_contractor_id`, or a join), or is the
  prospect just a standalone individual? Useful for "who do we know through firm X",
  but adds a relationship to model. _Lean: capture it (nullable FK) — it's the
  whole point of "we met them on a เหมา job"._
- **Who invites a prospect?** The PM (spec-130 U5 invite, but flagged prospect)?
  Or can a subcontractor firm (itself a portal user later) invite its own members?
  _Lean: PM-issued only for v1 — firm-issued invites are a bigger trust change._
- **Gamification at promotion.** The DC subtype + rules attach on promotion — does
  promotion require choosing the subtype then? _Lean: yes — promotion is where the
  DC classification is set._
- **Does a prospect see a money surface at all?** Recommend: bank is _capture-only_
  (staged, shown as "saved, used when you start"), no payment history, no payout.

## Proposed units (NOT built — for sizing only)

- **U1** — `prospect` status + the promote RPC (`promote_prospect_to_dc`, PM-gated,
  audited, sets subtype) + pgTAP (prospect has zero money; promotion flips status +
  preserves the packet; non-PM refused). Prod migration.
- **U2** — portal scoping for `status = prospect`: hide payment history + payout
  bank; bank/tax become capture-only; the rest of the packet (docs/consent/profile)
  unchanged.
- **U3** — PM convert UI on the contact page ("เลื่อนเป็น DC") + the prospect-vs-DC
  distinction in the contacts list.

## Out of scope (and never)

- **Paying a subcontractor's members.** The company never pays a prospect; the
  firm pays them. Promotion to DC is what makes them payable — as a _new_ direct
  relationship, not a back-payment.
- The เหมา firm lump-sum payment itself (that is the contractor/KBank-128 track).

## References

- ADR 0051 — external partner access model (the `contractor` tier this extends).
- Spec 130 — DC self-service portal (invite/claim, RLS, portal surfaces).
- Spec 131 — DC onboarding packet (the data a prospect self-captures).
- Spec 132 — DC portal profile self-edit (cashout field doctrine; a prospect is
  the "no cashout yet" case).
