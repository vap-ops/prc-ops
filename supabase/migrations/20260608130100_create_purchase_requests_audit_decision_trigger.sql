-- Purchasing P1b — atomic decision audit logging via AFTER UPDATE trigger.
--
-- Why this migration is separate from 20260608130000:
--   ALTER TYPE ... ADD VALUE (the prior migration) cannot be referenced
--   in the same transaction it lands in. This migration runs in its own
--   transaction and is therefore free to reference the new
--   'purchase_request_decision' enum value (it does so implicitly via
--   the audit_log INSERT inside the trigger function).
--
-- Why a trigger (not a TS-side INSERT):
--   The audit_log INSERT must be in the same transaction as the
--   purchase_requests UPDATE, so a decision that fails to audit cannot
--   commit. The prior P1b shape (TS-side INSERT after the UPDATE
--   succeeded, with a console.error + continue fallback) made the
--   audit a best-effort side car — and an audit log you can't
--   guarantee wrote is a weak audit log. AFTER UPDATE + WHEN gives us
--   "exactly one row per decision, never on a non-transition" as a DB
--   invariant testable in pgTAP, not a TS guarantee that no test ever
--   reached.
--
-- SECURITY DEFINER safety derivation (ADR 0011 checklist):
--   1. No row-selecting or column-naming argument — the function takes
--      no parameters (trigger functions never do) and writes to a
--      fixed schema/table.
--   2. Caller scoping: writes a single audit_log row whose actor_id is
--      auth.uid() (the caller, even under SECURITY DEFINER — GUC-based,
--      not role-based). actor_role is public.current_user_role(), which
--      is itself SECURITY DEFINER and reads users.role where id =
--      auth.uid(). Both resolve to the caller's identity, not the
--      function owner's. Same shape the update_my_display_name RPC uses.
--   3. search_path pinned to public — no schema-resolution attack
--      surface.
--   4. Side effects: a single INSERT into the append-only audit_log.
--      No UPDATE, no DELETE, no other writes.
--   5. The function returns trigger; not directly callable as an RPC.
--      No GRANT EXECUTE is required (or appropriate).
--
-- Why SECURITY DEFINER even though authenticated can already INSERT
-- into audit_log: the trigger must work for any caller that can run the
-- UPDATE — including future paths (a P2 service role, an internal
-- maintenance role) that might not have direct INSERT grant on
-- audit_log. SECURITY DEFINER decouples the trigger's write path from
-- the caller's privilege set.

create function public.purchase_requests_audit_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(),
     public.current_user_role(),
     'purchase_request_decision',
     'purchase_requests',
     new.id,
     jsonb_build_object(
       'work_package_id', new.work_package_id,
       'decision',        new.status,
       'comment',         new.decision_comment,
       'decided_by',      new.approved_by
     ));
  return new;
end;
$$;

-- The WHEN clause is the precision contract:
--   - OLD.status = 'requested' — only the initial decision transition
--     ever fires the trigger. A subsequent UPDATE (e.g. an AppSheet
--     stage moving approved → purchased) never matches OLD.status =
--     'requested' and so cannot accidentally re-audit as a decision.
--   - NEW.status IN ('approved','rejected') — the two native decision
--     outcomes ADR 0022 / spec 09 / validate-purchase-request.ts
--     enumerate. 'purchased' and 'delivered' are P2 AppSheet stages,
--     not decisions, and don't fire here.
-- Both halves together: the trigger writes exactly one audit row on
-- exactly the requested→approved and requested→rejected boundaries.
create trigger purchase_requests_audit_decision
  after update on public.purchase_requests
  for each row
  when (
    old.status = 'requested'
    and new.status in ('approved', 'rejected')
  )
  execute function public.purchase_requests_audit_decision();
