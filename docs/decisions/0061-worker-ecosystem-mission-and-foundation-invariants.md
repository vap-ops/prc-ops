# ADR 0061: Worker ecosystem — mission & foundation invariants

## Status

**Proposed / vision — 2026-06-20.** The **umbrella** over [ADR 0060](0060-project-profit-sharing-nova-coins.md)
(profit-sharing = step 1). Sets the invariants every future worker-facing step must
honor. The **invariants are the decision**; the **trajectory** below is illustrative
direction (confirm per step), **not** committed scope.

## Context

The field DC workforce is excluded from the formal economy: paid daily with no
buffer; no credit history → informal lenders / loan sharks; no portable financial
identity → can't get a fair loan; no skills ladder; no safety net; low financial
literacy. The operator's mission: **build PRC's own ecosystem that changes their
lives, systematically, one step at a time.** ADR 0060 (Nova-coin profit-sharing) is
**step 1 / the foundation**, not the end goal.

## Decision

**Build a financial-inclusion + human-development ecosystem for the field workforce
— one that starts controlled but is engineered to grow toward worker empowerment.
Lock the foundation invariants now; keep every control lever as removable policy.**

### Control tool vs life-platform (the governing principle)

A **control tool** (opacity, revocability, invisible-locking, spend-surveillance)
and a **life-changing platform** (transparency, ownership, portability, trust) need
**opposite** foundations. v1 may be controlled — but those levers are **POLICY
(tunable / removable), never architecture.** The mission requires the system to be
able to become **more** pro-worker over time. Bake extraction into the foundation
and the trust that savings / credit / belonging depend on can never grow. **You
cannot build financial inclusion on a currency people fear.**

### Foundation invariants (binding on every step)

1. **DC = a durable person-identity** — a lifelong record; _project = current
   assignment_; the identity persists across tenure (external↔internal), employer-
   of-record, and time. The spine history / credit / benefits all hang on.
2. **Coin ledger = append-only, double-entry-grade, event-sourced** — every coin is
   a **posting** (source · reason · timestamp); balance is **derived**, never a
   mutated integer. Reuse the GL discipline ([ADR 0057](0057-in-app-general-ledger-feeding-peak.md)).
   This single choice enables interest, vesting, savings, transfers, credit, audit,
   and value-conversion later.
3. **Earn-rules = pluggable sources that post to the ledger** — profit-share, saver's
   bonus, behavior bonuses today; education / safety / referral / tenure tomorrow —
   each a named source, attaching without core surgery.
4. **Consent + PDPA + transparency baked in** — behavioral / financial / work data is
   sensitive; capture it consentfully and purpose-stated (extend the existing consent
   infra, ADR 0051 / spec 131). Required for the pro-worker arms **and** the ethics.
5. **Portability & ownership** — the worker's record + vested balances are **theirs**
   and exit with them. The trust foundation and the anti-entrapment guardrail.
6. **Evolvable transparency** — opacity / control are v1 **policies**, not permanent
   architecture; the system must be able to become more transparent over time.

### Ethics guardrail

An ecosystem holding a worker's savings + credit + record + benefits creates
dependency. Built wrong, that is a **company-town / debt-bondage** pattern —
construction labor's historical dark side. The mission holds only if it **empowers
and the worker can leave with what's theirs.** Portability (invariant 5) is the
antidote: build to free them, not to chain them.

## Trajectory (illustrative — confirm per step, NOT committed scope)

`coins → savings/buffer → verified work-income identity → fair credit/advances →
benefits/safety-net → financial education → family wellbeing.`

Staged, each step shippable and visibly life-improving:

- **0 — foundation spine:** DC-as-person + the ledger + the portal home (no economics).
- **1 — earn loop:** project-close settlement → coins → shop ([ADR 0060](0060-project-profit-sharing-nova-coins.md)).
- **2 — savings + trust:** saver's bonus, vesting, "your coins are yours."
- **3 — their record, visible:** work / earnings / level history as a portable asset.
- **4+ —** credit / advances · benefits · education · family.

## Consequences

- Every future worker-facing ADR/spec references these invariants.
- ADR 0060's control levers (confiscation, opacity, invisible-lock, spend-telemetry)
  are re-cast as **removable policy** under invariant 6 — fine for v1, not foundational.
- Invariants 1–3 (identity-as-person, ledger-grade coin ledger, pluggable sources) are
  paid up front — cheap now, agony to retrofit. They gate the foundation build.
- Reuses [ADR 0051](0051-external-partner-access-model.md) (the portal = the ecosystem
  home) and aligns with the per-department AI-agent direction (worker-facing assist).
