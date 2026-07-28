-- Spec 372 U4 — lock the widened decide_work_package down to `authenticated`.
--
-- Why a SECOND migration: `075868` was already recorded as applied when this hazard
-- was found, and editing an applied migration + re-pushing is a SILENT NO-OP — the
-- CLI reports "Remote database is up to date" and runs nothing. The repair must be a
-- new file. (`075868` also carries these statements so a fresh database gets the right
-- grants in one step; both are idempotent, so replaying them is harmless.)
--
-- The hazard: a CREATE OR REPLACE at a NEW signature creates a NEW function, which
-- inherits the default PUBLIC EXECUTE. The widened RPC therefore arrived callable by
-- `anon` — caught by 229-anon-exec-nova-coin-lockdown, which exists for exactly this.
-- The role gate inside would still refuse an anon session (current_user_role() is null
-- → 42501), so this is defence in depth, not an open door. It should not be there
-- regardless: the sibling RPCs read postgres | authenticated | service_role.
--
-- Note `from public, anon` — revoking from anon alone leaves the PUBLIC grant, which
-- anon inherits, and the lockdown test would still fail.

revoke all on function public.decide_work_package(
  uuid, public.approval_decision, text, public.approval_revision_reason,
  public.photo_phase[], uuid[]
) from public, anon;

grant execute on function public.decide_work_package(
  uuid, public.approval_decision, text, public.approval_revision_reason,
  public.photo_phase[], uuid[]
) to authenticated, service_role;
