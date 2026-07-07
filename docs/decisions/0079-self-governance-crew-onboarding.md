# ADR 0079: Self-governance crew onboarding + money-governance confirmation split

## Status

**Proposed** — design approved by the operator 2026-07-08; build starts at spec 279 U1. Sits **under [ADR 0060](0060-project-profit-sharing-nova-coins.md)** (WP profit center, HT/DC, level→sell-rate, anti-favoritism §5) and **[ADR 0061](0061-worker-ecosystem-mission-and-foundation-invariants.md)** (durable identity, consent/PDPA, portability). **Not** under [ADR 0072](0072-role-parametric-staff-self-onboarding.md) — that spine is `auth.uid()` + `staff_consents`-keyed and is structurally wrong for phoneless field crew. Supersedes nothing. Implementing arc = **[spec 279](../feature-specs/279-self-governance-worker-onboarding.md)**.

## Context

`workers` is empty firm-wide (wiped by spec 266), `labor_logs` = 0 all-time. The real workforce (~30 named hands, 6 crews under a หัวหน้า, on TFM โพธิ์ทอง) exists only on a hand-written Daily Report — so spec 278's attendance muster (and the whole ADR-0060 cost/profit engine that reads `labor_logs`) is dead on arrival. Onboarding is the missing prerequisite. The operator chose a **self-governance** driver: each crew-lead onboards and manages their own crew, matching ADR 0060's HT-runs-the-crew economics and ADR 0061's self-report doctrine. Two forces pull against naive self-governance: (a) the money-adjacent worker attributes are **gameable** (a lead who understates a member's level lowers his own WP's sell cost), and (b) phoneless field workers cannot self-consent under Thai PDPA. The design was hardened by a 19-agent adversarial pass (23-hole register; 4 holes verified against live code).

## Decision

**1. Crew-lead authority is a bound-worker predicate, not a role.** The lead is a `workers` row whose `user_id` is claimed; authority to manage a crew is `current_user_worker_id() = crews.lead_worker_id` (own-crew), never `current_user_role()`. Verified-forced: `claim_worker_invite` sets `role='contractor'` unconditionally, so a lead can hold no other app-role — a role-based "crew-lead" is internally impossible. Lead surfaces gate on the predicate (coalesce-to-false + null-guarded per the spec-131 self-check trap); a crew-leading `contractor` gets a role-home route to the crew UI.

**2. A first-class `crews` entity + `crew_members` SSOT.** Crews are project-scoped org units with a named accountable head (`lead_worker_id`) and, for the money model, a `kind` (dc | subcon) and a PM-set `default_day_rate`. Membership lives in `crew_members` (append-only tombstone; `UNIQUE(worker_id) WHERE removed_at IS NULL` — one active crew per human). Worker↔crew is derived from `crew_members`, not a denormalised pointer (zero drift). This is a new authority shape (worker-to-worker write predicate) with no precedent in the codebase's role-based gates.

**3. Money-governance confirmation split (anti-self-dealing, ADR 0060 §5).** The lead writes only operational facts (name, phone, national-ID, DOB, crew, project, WP-bundle). The gameable levers are confirmed by a disinterested hand: `day_rate`/`pay_type`/`employment_type` by **PM/PD/procurement tier** (`is_back_office`), `level` (the **sell-rate key** — the number the WP is charged and the lead sees) by **super_admin only**. Enforced structurally by **parameter absence**: the lead's RPCs carry no money parameters. A worker is rostered/attendable/payable-at-the-crew-default but **not cost-loggable** (`cost_confirmed_at` NULL) until level + rate + pay-class + tenure are all set — the single choke point that keeps ungraded/unpriced labor out of the cost engine.

**4. Pay vs sell (operator, 2026-07-08).** We PAY a worker (cost to firm, e.g. 500); the WP is CHARGED the **sell** (per level, e.g. 560); firm keeps the markup (60). **WP cost = sell.** The crew-lead (WP owner) SEES the sell/WP-cost (ADR 0060 HT-sees-P&L — not a no-baht violation, that invariant targets plain SA/DC); pay + markup stay firm-internal; the SA-proxy view suppresses baht.

**5. PDPA lawful-basis reframe for phoneless-by-proxy.** A lead attesting "I got his consent" is void under Thai PDPA s.19 (the subject must consent; lead↔member dependency is coercive). The phoneless lane instead records a **lawful basis** (`processing_basis_employment` — legitimate-interest / contractual, for site-access + pay) with a delivered versioned notice + a **neutral witness**, never called "consent"; genuine subject-given `pdpa_data` consent is captured only at self-claim. Purpose-scoped: cost/coin/portability uses each need their own granted purpose. ⚖️ The sufficiency of this basis and the retention-vs-erasure policy on withdrawal are **counsel decisions**, flagged before the consent unit (spec 279 U3).

## Consequences

- A durable roster the muster (spec 278 U2) and the ADR-0060 cost/profit engine can finally read, produced by the people closest to the work, with the gameable inputs objectified (anti-favoritism preserved).
- New surfaces: a project-scoped crew-lead UI (`contractor` role-home route), a PM/PD confirmation queue, and the crew↔WP edge the WP even-split reads.
- Large, danger-path surface (auth predicate, RLS, consent/PDPA, money-adjacent) → ships as a sequence of separately-reviewable **operator-held** units (spec 279 U0–U6); U1 (crew entity + dedup key) is the minimal first slice.
- A dependency on two pre-existing ADR-0060 engine gaps surfaced by the review (no `level` snapshot at settlement; `day_rate=0` leaks into cost/wages) — reconciled as spec 279 U0 before the cost gates (U6).
- Threat model explicitly covers lead-unilateral and lead↔PM collusion; super_admin corruption is out of scope (ADR 0050 omnipotence).
