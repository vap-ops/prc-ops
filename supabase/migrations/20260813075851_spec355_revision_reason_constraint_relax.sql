-- Spec 355 U1 (fix) — the reason constraint added in 075850 was a strict
-- biconditional ((revision_reason is not null) = (decision = needs_revision)),
-- which requires EVERY needs_revision approvals row to carry a reason. The RPC
-- always supplies one, but many pgTAP fixtures (and any direct/admin insert)
-- create needs_revision rows without a reason — legitimately, since "reason
-- required for needs_revision" is the RPC's job (raises 22023), not the table's.
--
-- Relax to the FORBIDDEN direction only: a reason may exist ONLY on a
-- needs_revision row. This is what the table should guarantee (no reason leaks
-- onto approved/rejected); it is satisfied by every legacy row and every existing
-- fixture, so it validates. The required-direction stays in decide_work_package.
--
-- Separate migration because 075850 was already applied.

alter table public.approvals drop constraint approvals_revision_reason_matches_decision;

alter table public.approvals add constraint approvals_revision_reason_forbidden_unless_needs_revision
  check (decision = 'needs_revision' or revision_reason is null);
