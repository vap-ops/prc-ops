-- Purchasing P2 — AFTER UPDATE SECURITY DEFINER trigger that writes an
-- audit_log row for each AppSheet-originated lifecycle transition or field
-- correction on purchase_requests.
--
-- Why this migration is separate from …140000 (enum values):
--   ALTER TYPE ... ADD VALUE cannot be referenced in the same transaction
--   it lands in. This trigger's INSERT into audit_log uses the new
--   'purchase_request_purchase' and 'purchase_request_delivery' enum values.
--   Mirrors the 130000/130100 split in P1b exactly.
--
-- SECURITY DEFINER safety derivation (ADR 0011 checklist):
--   1. No row-selecting or column-naming argument — the function takes no
--      parameters (trigger functions never do) and writes to a fixed table.
--   2. Caller scoping: actor_id = NULL, actor_role = NULL. appsheet_writer
--      carries no auth.uid() (direct DB role, no JWT) and
--      public.current_user_role() returns NULL for it. Both are correct:
--      audit forensics for this principal are captured via session_user
--      (NOT current_user — under SECURITY DEFINER current_user is the
--      migration owner, i.e. postgres; session_user is the connected role,
--      i.e. appsheet_writer). This is the same discipline used by P1b
--      (purchase_requests_audit_decision), except that trigger uses
--      auth.uid()/current_user_role() because it fires for authenticated.
--   3. search_path pinned to public — no schema-resolution attack surface.
--   4. Side effects: a single INSERT into the append-only audit_log.
--      No UPDATE, no DELETE, no other writes.
--   5. The function returns trigger; not directly callable as an RPC.
--      No GRANT EXECUTE is required (or appropriate).
--   6. appsheet_writer has no audit_log grant and must never get one.
--      SECURITY DEFINER is the ONLY path that permits the INSERT without
--      granting the role direct access to audit_log.
--
-- WHEN clause — mutually exclusive with the P1b decision trigger:
--   P1b's WHEN: OLD.status = 'requested' AND NEW.status IN ('approved','rejected')
--   This trigger's WHEN: OLD.status IN ('approved','purchased','delivered')
--   The two WHEN clauses cover disjoint transitions; there is no row for
--   which both fire. No double-audit is possible by construction.
--
-- Three audit cases:
--   approved→purchased  ⇒  action 'purchase_request_purchase'
--   purchased→delivered ⇒  action 'purchase_request_delivery'
--   status unchanged, any of the 7 columns changed
--                       ⇒  action 'update' with a {changed:{col:[old,new]}}
--                           diff payload (money edits must be visible)

create function public.purchase_requests_audit_appsheet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_principal text := session_user;  -- NOT current_user (SECURITY DEFINER)
  v_changed   jsonb := '{}'::jsonb;
begin
  -- Case 1: approved → purchased.
  if old.status = 'approved' and new.status = 'purchased' then
    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (null, null,
       'purchase_request_purchase',
       'purchase_requests',
       new.id,
       jsonb_build_object(
         'principal',    v_principal,
         'supplier',     new.supplier,
         'order_ref',    new.order_ref,
         'amount',       new.amount,
         'purchased_at', new.purchased_at
       ));
    return new;
  end if;

  -- Case 2: purchased → delivered.
  if old.status = 'purchased' and new.status = 'delivered' then
    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (null, null,
       'purchase_request_delivery',
       'purchase_requests',
       new.id,
       jsonb_build_object(
         'principal',    v_principal,
         'delivered_at', new.delivered_at,
         'received_by',  new.received_by,
         'delivery_note',new.delivery_note
       ));
    return new;
  end if;

  -- Case 3: field correction — status unchanged, one or more of the 7
  --   granted columns changed. Build a {col: [old_val, new_val]} diff.
  if new.supplier     is distinct from old.supplier then
    v_changed := v_changed || jsonb_build_object('supplier',     jsonb_build_array(old.supplier, new.supplier));
  end if;
  if new.order_ref    is distinct from old.order_ref then
    v_changed := v_changed || jsonb_build_object('order_ref',    jsonb_build_array(old.order_ref, new.order_ref));
  end if;
  if new.amount       is distinct from old.amount then
    v_changed := v_changed || jsonb_build_object('amount',       jsonb_build_array(old.amount, new.amount));
  end if;
  if new.purchased_at is distinct from old.purchased_at then
    v_changed := v_changed || jsonb_build_object('purchased_at', jsonb_build_array(old.purchased_at, new.purchased_at));
  end if;
  if new.delivered_at is distinct from old.delivered_at then
    v_changed := v_changed || jsonb_build_object('delivered_at', jsonb_build_array(old.delivered_at, new.delivered_at));
  end if;
  if new.received_by  is distinct from old.received_by then
    v_changed := v_changed || jsonb_build_object('received_by',  jsonb_build_array(old.received_by, new.received_by));
  end if;
  if new.delivery_note is distinct from old.delivery_note then
    v_changed := v_changed || jsonb_build_object('delivery_note',jsonb_build_array(old.delivery_note, new.delivery_note));
  end if;

  if v_changed <> '{}'::jsonb then
    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (null, null,
       'update',
       'purchase_requests',
       new.id,
       jsonb_build_object(
         'principal', v_principal,
         'changed',   v_changed
       ));
  end if;

  return new;
end;
$$;

-- The WHEN clause covers the post-decision segment only — the rows that
-- AppSheet owns. The P1b decision trigger covers old.status='requested';
-- these two are mutually exclusive.
--
-- The WHEN clause is tightened to prevent the trigger from firing on no-op
-- updates (where none of the 7 fact columns actually change). The trigger
-- body already guards with v_changed='{}' → early return, but the tighter
-- WHEN avoids the function call entirely.
create trigger purchase_requests_audit_appsheet
  after update on public.purchase_requests
  for each row
  when (
    (old.status = 'approved' and new.status = 'purchased') or
    (old.status = 'purchased' and new.status = 'delivered') or
    (old.status in ('approved', 'purchased', 'delivered') and (
      old.supplier      is distinct from new.supplier      or
      old.order_ref     is distinct from new.order_ref     or
      old.amount        is distinct from new.amount        or
      old.purchased_at  is distinct from new.purchased_at  or
      old.delivered_at  is distinct from new.delivered_at  or
      old.received_by   is distinct from new.received_by   or
      old.delivery_note is distinct from new.delivery_note
    ))
  )
  execute function public.purchase_requests_audit_appsheet();
