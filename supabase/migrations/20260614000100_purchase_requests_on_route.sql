-- Spec 22 / ADR 0027 — shipped_at fact column drives the new on_route
-- status, per the ADR 0025 posture: AppSheet writes facts, triggers
-- derive status, the status column itself stays un-granted.
--
-- ONE migration for column + grant + both trigger rewrites so there is
-- no window where shipped_at is writable but underived/unaudited
-- (same atomicity argument as 20260613100100).
--
-- Lifecycle after this migration:
--   approved  + purchased_at null→non-null  ⇒  purchased
--   purchased + shipped_at   null→non-null  ⇒  on_route
--   purchased | on_route + delivered_at null→non-null ⇒ delivered
-- on_route is SKIPPABLE (ADR 0027): purchased → delivered stays legal —
-- back offices won't always record a shipment moment, and delivery must
-- never be blocked on bookkeeping.
--
-- Audit (ADR 0027, no new audit_action value): purchased→on_route is
-- recorded as action 'update' with payload
-- {principal, shipped_at, transition:['purchased','on_route']}.
-- on_route→delivered reuses the purchase_request_delivery case.
-- shipped_at joins the case-3 correction diff (10th... 9th column).
--
-- Role-touching migration: re-run the Tier-2 smoke ritual
-- (supabase/scripts/smoke/appsheet_writer_p2.sql) and expose shipped_at
-- in the AppSheet column config (operator, go-live checklist §2a).

-- 1. The fact column.
alter table public.purchase_requests
  add column shipped_at timestamptz null;

-- 2. The additive column grant: shipped_at joins the 8 existing columns.
grant update (shipped_at) on public.purchase_requests to appsheet_writer;

-- 3. RLS stage gates widen to include on_route. Without this the derive
--    trigger's purchased→on_route advance violates the UPDATE policy's
--    WITH CHECK (NEW.status not in the list), and an on_route row would
--    be invisible/un-updatable to AppSheet — procurement could never
--    mark it delivered.
alter policy "appsheet_writer select by status"
  on public.purchase_requests
  using (status in ('approved', 'purchased', 'on_route', 'delivered'));

alter policy "appsheet_writer update by status"
  on public.purchase_requests
  using (status in ('approved', 'purchased', 'on_route', 'delivered'))
  with check (status in ('approved', 'purchased', 'on_route', 'delivered'));

-- 4. Derive trigger: on_route transitions + widened delivery guard.
create or replace function public.purchase_requests_derive_appsheet_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Illegal move guard: delivered_at on a row that is neither purchased
  -- nor on_route.
  if new.delivered_at is not null and old.delivered_at is null
     and old.status not in ('purchased', 'on_route') then
    raise exception
      'purchase_requests: delivered_at may only be set when status is purchased or on_route (current: %)',
      old.status
      using errcode = 'P0001';
  end if;

  -- Illegal move guard: purchased_at set while status is not approved.
  if new.purchased_at is not null and old.purchased_at is null
     and old.status <> 'approved' then
    raise exception
      'purchase_requests: purchased_at may only be set when status is approved (current: %)',
      old.status
      using errcode = 'P0001';
  end if;

  -- Illegal move guard: shipped_at first set while status is not
  -- purchased. (Corrections to an already-set shipped_at are allowed —
  -- old.shipped_at is not null then — matching the purchased_at pattern.)
  if new.shipped_at is not null and old.shipped_at is null
     and old.status <> 'purchased' then
    raise exception
      'purchase_requests: shipped_at may only be set when status is purchased (current: %)',
      old.status
      using errcode = 'P0001';
  end if;

  -- Approved → purchased transition: purchased_at just became non-null.
  if old.status = 'approved' and new.purchased_at is not null and old.purchased_at is null then
    new.status := 'purchased';
    return new;
  end if;

  -- Purchased → on_route transition: shipped_at just became non-null.
  -- Delivery wins if both facts land in one UPDATE (a back office syncing
  -- a fully completed order in one row save) — checked first below.
  if (old.status = 'purchased' or old.status = 'on_route')
     and new.delivered_at is not null and old.delivered_at is null then
    new.status := 'delivered';
    return new;
  end if;

  if old.status = 'purchased' and new.shipped_at is not null and old.shipped_at is null then
    new.status := 'on_route';
    return new;
  end if;

  -- Correction: no status advance, no error.
  return new;
end;
$$;

-- 5. Audit function: on_route transition arm + shipped_at correction diff.
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

  -- Case 2: purchased | on_route → delivered.
  if old.status in ('purchased', 'on_route') and new.status = 'delivered' then
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

  -- Case 2.5: purchased → on_route (ADR 0027 — action 'update', no new
  -- audit_action enum value; transition recorded in the payload).
  if old.status = 'purchased' and new.status = 'on_route' then
    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (null, null,
       'update',
       'purchase_requests',
       new.id,
       jsonb_build_object(
         'principal',  v_principal,
         'shipped_at', new.shipped_at,
         'transition', jsonb_build_array('purchased', 'on_route')
       ));
    return new;
  end if;

  -- Case 3: field correction — status unchanged, one or more of the 9
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
  if new.shipped_at   is distinct from old.shipped_at then
    v_changed := v_changed || jsonb_build_object('shipped_at',   jsonb_build_array(old.shipped_at, new.shipped_at));
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

-- 6. Recreate the trigger: new transition arms + shipped_at in the
--    correction WHEN. Mutual exclusion with the P1b decision trigger is
--    preserved (that one fires only on old.status = 'requested').
drop trigger purchase_requests_audit_appsheet on public.purchase_requests;

create trigger purchase_requests_audit_appsheet
  after update on public.purchase_requests
  for each row
  when (
    (old.status = 'approved' and new.status = 'purchased') or
    (old.status = 'purchased' and new.status = 'on_route') or
    (old.status in ('purchased', 'on_route') and new.status = 'delivered') or
    (old.status in ('approved', 'purchased', 'on_route', 'delivered') and (
      old.supplier      is distinct from new.supplier      or
      old.order_ref     is distinct from new.order_ref     or
      old.amount        is distinct from new.amount        or
      old.purchased_at  is distinct from new.purchased_at  or
      old.shipped_at    is distinct from new.shipped_at    or
      old.delivered_at  is distinct from new.delivered_at  or
      old.received_by   is distinct from new.received_by   or
      old.delivery_note is distinct from new.delivery_note or
      old.eta           is distinct from new.eta
    ))
  )
  execute function public.purchase_requests_audit_appsheet();
