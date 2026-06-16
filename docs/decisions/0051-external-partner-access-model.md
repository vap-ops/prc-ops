# ADR 0051: External partner access model — row-level RLS for an external tier

## Status

Accepted — 2026-06-16 (operator confirmed: same-app hard-bounded `/portal`
segment, LINE auth for external parties). Auth + RLS on money + a new external
trust tier = the highest-stakes change in the app; built in small, exhaustively
pgTAP-proven units (spec 130).

Extends [ADR 0013](0013-project-access-model.md). 0013 chose **role-level only**
for v1 and named the exact trigger to revisit: _"a subcontractor account is
granted access, a customer-review account is added."_ The operator's decision
(2026-06-16) to give **direct contractors (DC) their own logins** is that
trigger. This ADR defines the access model for external parties; the DC portal
itself is [spec 130](../feature-specs/130-dc-self-service-portal.md). Clients
follow the same model later.

## Context

Today every user is **internal staff** (PRC team), access is **role-level**
(ADR 0013 — a `site_admin` sees every WP/contractor/payment), money columns
(`day_rate`, `dc_payments`, `contact_bank`) are **zero-authenticated-grant**,
read only via the **service-role admin client** behind `requireRole`. No
per-row ownership gate exists anywhere.

An external DC self-serving their own record breaks three of those assumptions
at once: they must see **only their own** rows (row-level, not role-level); they
must read **their own** money (their payments/amounts) without seeing anyone
else's; and they are **untrusted** — a policy bug leaks one contractor's bank to
another, with a worse blast radius than any internal mistake.

## Decision

**An external tier, scoped by party ownership via row-level RLS, in the same
app behind a hard boundary, whose sessions never touch the admin client.**

1. **New external role(s).** `contractor` now; `client` later. External roles
   are distinct from every internal role and from `visitor`.

2. **Identity binding — a membership table, not a column.**
   `contractor_users (user_id → contractor_id)`, many users per contractor
   (a firm's staff). Populated by an **invite/claim flow**: a PM issues an
   invite for contractor X → the party logs in via **LINE** (the existing auth,
   ubiquitous in TH) → their `auth.uid()` is bound to X and the role set to
   `contractor`. New LINE signups still default to `visitor` (ADR 0010) until
   claimed. A `current_user_contractor_id()` SECURITY DEFINER helper (mirrors
   `current_user_role()`, ADR 0011 — no `public.users` self-join) returns the
   bound contractor or NULL.

3. **Dual-policy RLS, scoped by `contractor_id`.** Every externally-reachable
   table keeps its internal role-level policy **and** gains an external own-row
   policy: `using (contractor_id = current_user_contractor_id())`. This is the
   `contractor_id` ownership axis — orthogonal to ADR 0013's `project_id`
   membership axis (which the `client` tier will use). Internal access is
   unchanged; the external policy only ever **adds** the party's own rows.

4. **Scoped money visibility — a narrow, deliberate exception.** A DC may read
   **their own** amounts (their `dc_payments`, their labor totals) — that is the
   point of the portal. This is a **new column grant scoped by the own-row RLS**,
   NOT a relaxation of the zero-grant posture for internal field roles. The
   company's margin, rates of other parties, and every other contractor's data
   stay invisible. The internal `site_admin` money-isolation is untouched.

5. **External sessions use the RLS-respecting client — NEVER the admin client.**
   The service-role admin client bypasses RLS; an external request must never
   reach it. External surfaces read through the anon/authenticated server
   client so the DB (RLS) is the enforcement, not app code. This is a hard,
   testable rule.

6. **Self-entered money data is staged, never auto-active (anti-fraud).** A DC
   editing bank/tax/docs via the portal writes a **pending** record; a PM
   approves before it becomes the active payout target feeding payroll / KBank
   (spec 128) / PEAK (spec 129). A contractor silently changing their bank
   before a run is a fraud vector the approval gate closes.

7. **Same app, hard-bounded segment — not a separate app (revisitable).** The
   portal lives under a dedicated route segment with **middleware** that blocks
   external roles from internal routes and vice versa. Rationale: reuse of auth
   /components/infra, instance-per-customer (ADR 0035) keeps blast radius to one
   tenant, small team. The risk (internal/external mixing in one codebase) is
   mitigated by (3) DB-enforced RLS + (5) no-admin-client + (7) the middleware
   boundary — defense in depth, not app-code discipline alone. Revisit a
   separate app if the boundary proves leaky.

## Consequences

**Positive** — follows ADR 0013's pre-planned upgrade path; internal access
model untouched; DB-enforced isolation (not app-code-enforced); one boundary
serves DC now and clients later.

**Negative** — row-level RLS must be proven **exhaustively** per table (a DC
cannot read another DC's anything) — heavy pgTAP, the real cost. Mixing tiers
in one app is a standing risk requiring discipline (mitigated, not eliminated).
The scoped money grant is a new surface to audit on every future money column.

**Neutral** — `client` tier reuses this model on the `project_id` axis;
deferred but designed-for. DC labor self-capture (a DC logging their own days)
is explicitly out — a separate, larger decision.

## Open questions (confirm before build)

- **Same-app segment vs separate app** (decision 7) — recommended same-app; the
  one architecture call to confirm.
- **LINE for external auth** — recommended (ubiquitous in TH); revisit only if
  contractors lack LINE (then email/phone-OTP).

## Notifications & LINE OA (decided 2026-06-16)

LINE **login** stays one channel (identity is unified; the app routes by role).
LINE **messaging/OA**: **one OA now** for staff + DC (per-user rich menus give
each audience its own menu without a second OA); a **dedicated client-facing
OA** is added when the client portal lands (clients are external customers — a
brand/relationship surface — not workforce). Standing up separate DC/client OAs
today is overhead the not-yet-onboarded external base doesn't justify.

**Hard requirement regardless of OA count:** the notification outbox (spec 32 /
ADR 0037) is staff-shaped today; before ANY external user receives a LINE push,
the send path MUST **gate by recipient audience** so a DC/client can never
receive an internal WP/PR notification. Keep the send path OA-/channel-aware so
adding the client OA later is config, not a rewrite.

## References

- ADR 0013 — role-level access (this ADR is its named upgrade trigger)
- ADR 0011 — RLS role helper (the `current_user_contractor_id()` pattern)
- ADR 0010 — visitor default (external signups land here until claimed)
- ADR 0035 — instance-per-customer (one tenant = one blast radius)
- Spec 127/128/129 — the money flows the staged-approval gate protects
