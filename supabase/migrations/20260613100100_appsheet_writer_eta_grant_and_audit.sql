-- Spec 16 P1 / ADR 0026 Decisions A+C — appsheet_writer may write eta,
-- and eta corrections are audited.
--
-- ONE migration on purpose: the grant and the audit amendment must land
-- atomically so there is no window where eta is writable but its
-- corrections are unaudited. supabase db push wraps the migration in a
-- single transaction; DROP TRIGGER + CREATE TRIGGER is atomic here.
--
-- Audit posture (ADR 0026 Decision C — one canonical shape): eta is
-- audited ONLY as a case-3 correction diff (action 'update',
-- changed:{eta:[old,new]}). The case-1 purchase and case-2 delivery
-- payloads are NOT amended. Accepted gap (recorded): an eta change
-- bundled into the same UPDATE statement as a status transition is not
-- separately audited — identical to the pre-existing posture for
-- supplier/order_ref/amount bundled with transitions (the case-1/2
-- early-returns).
--
-- Mechanism: the function body's diff list AND the trigger's WHEN clause
-- both hard-code the column list (20260608140300 lines ~94-114 and
-- ~145-157), so BOTH must be amended — CREATE OR REPLACE for the
-- function, DROP + recreate for the trigger (WHEN is not ALTERable).
-- The WHEN's correction arm stays inside old.status IN
-- ('approved','purchased','delivered'), preserving mutual exclusion with
-- the P1b decision trigger (old.status = 'requested').
--
-- Role-touching migration: re-run the Tier-2 smoke ritual
-- (supabase/scripts/smoke/appsheet_writer_p2.sql) after this lands, and
-- mark needed_by/priority read-only in the AppSheet column config FIRST
-- (go-live checklist §2a) — AppSheet row saves SET every editable
-- column, so an editable unguarded column fails saves wholesale (42501).

-- 1. The additive column grant: eta joins the 7 existing fact columns.
grant update (eta) on public.purchase_requests to appsheet_writer;

-- 2. The audit function gains an 8th diff branch (case 3 only).
--    Body is byte-faithful to 20260608140300 apart from the eta branch
--    and this header's case-3 comment (7 -> 8 columns).
create or replace function public.purchase_requests_audit_appsheet()
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

  -- Case 3: field correction — status unchanged, one or more of the 8
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
  if new.eta          is distinct from old.eta then
    v_changed := v_changed || jsonb_build_object('eta',          jsonb_build_array(old.eta, new.eta));
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

-- 3. Recreate the trigger with the 8th WHEN predicate inside the
--    correction arm. Mutual exclusion with the P1b decision trigger is
--    preserved: this WHEN still requires old.status IN
--    ('approved','purchased','delivered'); P1b fires only on
--    old.status = 'requested'.
drop trigger purchase_requests_audit_appsheet on public.purchase_requests;

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
      old.delivery_note is distinct from new.delivery_note or
      old.eta           is distinct from new.eta
    ))
  )
  execute function public.purchase_requests_audit_appsheet();
