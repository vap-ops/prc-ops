# ADR 0035 — Tenancy: instance-per-customer, tenant-clean codebase

**Status:** Accepted — 2026-06-11. Source:
`docs/architecture-revision-2026-06.md` §3.4 + §6; operator granted
decision authority in chat.

## Context

The schema is single-tenant (one company: PRC). Productization would
force a choice between cloning the whole stack per customer or
retrofitting `org_id` multi-tenancy. Deciding by default risks the
expensive outcome (schema surgery on a grown dataset).

## Decision

- **Instance-per-customer** is the tenancy model for the foreseeable
  future: a new customer gets their own Supabase project + Vercel
  project (+ LINE channels). Maximum isolation, zero schema work.
- **Tenant-clean rule (binding on all future code):** no
  customer-specific values hardcoded in code, copy, or config —
  company/project names, codes, and branding stay in data or env vars.
  "PRC" appearing in a string literal in `src/` is a review failure
  (the repo/product name `prc-ops` itself is exempt).
- A **"spin up a new instance" runbook** is written when (and only
  when) instance #2 is actually provisioned — it documents itself
  during the first real clone.
- **Re-open trigger:** a signed second customer AND projected instance
  count past ~5, or a real need for cross-customer aggregation. Only
  then is `org_id` multi-tenancy re-evaluated.

## Consequences

- No schema change now; no `organizations` table.
- Existing data needs no backfill, ever, under this model.
- In-app user/role admin (backlog) becomes the main productization
  prerequisite — each instance's operator must be able to promote users
  without SQL.
- Future sessions stop re-deriving the tenancy question; this ADR is
  the answer until the re-open trigger fires.
