-- Data-architecture hardening (rank 7) — normalization fixes.
--
-- (1) purchase_requests.received_by was the one genuine free-text-where-FK
-- belongs column: the receiver is a known users row (auth.uid()/created_by in
-- hand at write time) yet only a display-name string was stored. Add a
-- structured received_by_id FK, populated on both write paths. received_by
-- (text) stays as the point-in-time name snapshot (already documented), mirroring
-- the requested_by (FK) + requested_by_email (text) split this table already uses.
-- SELECT on purchase_requests is table-wide for authenticated, so the new column
-- needs no extra grant. Historical rows keep received_by_id NULL (forward-looking).
--
-- (2) reports.params is untyped jsonb; pin it to an object so a malformed
-- non-object can never land (all rows are the '{}' default or PM-chosen objects).
--
-- (3) Document workers.contractor_id's delete-block intent (the lone FK with no
-- reasoned ON DELETE). NO ACTION already blocks deleting a referenced contractor,
-- identical to RESTRICT here, so this is a comment, not a constraint swap.

alter table public.purchase_requests
  add column received_by_id uuid references public.users(id);

comment on column public.purchase_requests.received_by_id is
  'Structured receiver identity (FK to users): the uploader of the delivery-confirmation photo, or the actor on a site purchase. received_by (text) is the name snapshot. NULL on rows received before this column existed.';

comment on column public.workers.contractor_id is
  'DC parent contractor (FK). A referenced contractor cannot be deleted (NO ACTION = RESTRICT here) — contractors are retained forever, retired via a withheld DELETE grant.';

alter table public.reports
  add constraint reports_params_is_object check (jsonb_typeof(params) = 'object');

-- Re-define the two writers to also set received_by_id. CREATE OR REPLACE
-- preserves existing grants (record_site_purchase stays authenticated-only).
create or replace function public.record_site_purchase(
  p_work_package_id uuid,
  p_item_description text,
  p_quantity numeric,
  p_unit text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item  text := nullif(trim(coalesce(p_item_description, '')), '');
  v_unit  text := nullif(trim(coalesce(p_unit, '')), '');
  v_actor text;
  v_id    uuid;
begin
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin') then
    raise exception 'record_site_purchase: role not permitted'
      using errcode = '42501';
  end if;

  if v_item is null then
    raise exception 'record_site_purchase: item description required'
      using errcode = 'P0001';
  end if;
  if length(v_item) > 500 then
    raise exception 'record_site_purchase: item description too long'
      using errcode = 'P0001';
  end if;
  if v_unit is null then
    raise exception 'record_site_purchase: unit required'
      using errcode = 'P0001';
  end if;
  if length(v_unit) > 40 then
    raise exception 'record_site_purchase: unit too long'
      using errcode = 'P0001';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'record_site_purchase: quantity must be positive'
      using errcode = 'P0001';
  end if;

  -- WP existence. v1 access is role-level (ADR 0013 — no membership): the
  -- admitted roles read every WP, so there is no per-project scope to
  -- probe; the role gate + this existence check are the full visibility
  -- guard (ADR 0043 §6). Revisit if a per-project access model lands.
  if not exists (select 1 from public.work_packages wp where wp.id = p_work_package_id) then
    raise exception 'record_site_purchase: work package not found'
      using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(u.full_name), ''), auth.uid()::text)
    into v_actor
    from public.users u
    where u.id = auth.uid();

  insert into public.purchase_requests
    (work_package_id, item_description, quantity, unit,
     status, source, requested_by, purchased_at, delivered_at, received_by, received_by_id)
  values
    (p_work_package_id, v_item, p_quantity, v_unit,
     'site_purchased', 'site_purchase', auth.uid(), now(), now(), v_actor, auth.uid())
  returning id into v_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(),
     public.current_user_role(),
     'insert',
     'purchase_requests',
     v_id,
     jsonb_build_object(
       'source',           'site_purchase',
       'work_package_id',  p_work_package_id,
       'item_description', v_item,
       'quantity',         p_quantity,
       'unit',             v_unit,
       'received_by',      v_actor
     ));

  return v_id;
end;
$$;

create or replace function public.purchase_request_attachments_complete_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receiver text;
begin
  if new.purpose = 'delivery_confirmation'
     and new.superseded_by is null
     and exists (select 1 from public.purchase_requests pr
                 where pr.id = new.purchase_request_id
                   and pr.status = 'on_route') then
    select coalesce(nullif(trim(u.full_name), ''), new.created_by::text)
      into v_receiver
      from public.users u
      where u.id = new.created_by;

    update public.purchase_requests
       set delivered_at   = now(),
           received_by    = v_receiver,
           received_by_id = new.created_by
     where id = new.purchase_request_id
       and status = 'on_route';
  end if;
  return new;
end;
$$;
