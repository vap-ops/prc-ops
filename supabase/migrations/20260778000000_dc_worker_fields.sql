-- Spec 170 / ADR 0062 U1 — a DC is a worker, not a contractor party.
--
-- Make a `workers` row self-sufficient as a DC person: an ARRANGEMENT
-- (ประจำ regular / ชั่วคราว temporary) and the PAYEE fields needed to pay them
-- directly. No contractor party required anymore (spec 160 already nulled
-- workers.contractor_id + dropped the workers_dc_has_contractor CHECK).
--
-- MONEY/PII POSTURE (mirrors day_rate, spec 46 C3): tax_id + the bank_* columns
-- get NO authenticated grant — the only reader is the service-role client inside
-- requireRole(pm/super)-gated server code (the /workers page) or the owner via a
-- definer RPC on the portal (later units). dc_arrangement is non-sensitive
-- (regular/temporary), so it IS granted. phone is contact PII → kept ungranted.
--
-- This is ADDITIVE: nothing is removed. Payment / portal / Nova still key on the
-- contractor party until ADR-0062 U2–U4 repoint them onto the worker.

create type public.dc_arrangement as enum ('regular', 'temporary');

alter table public.workers
  add column dc_arrangement      public.dc_arrangement null,
  add column phone               text null,
  add column tax_id              text null,
  add column bank_name           text null,
  add column bank_account_number text null,
  add column bank_account_name   text null,
  -- arrangement is a DC-only attribute.
  add constraint workers_arrangement_dc_only
    check (dc_arrangement is null or worker_type = 'dc'),
  add constraint workers_phone_cap check (phone is null or length(phone) <= 50),
  add constraint workers_tax_id_cap check (tax_id is null or length(tax_id) <= 50),
  add constraint workers_bank_name_cap check (bank_name is null or length(bank_name) <= 120),
  add constraint workers_bank_acct_no_cap
    check (bank_account_number is null or length(bank_account_number) <= 50),
  add constraint workers_bank_acct_name_cap
    check (bank_account_name is null or length(bank_account_name) <= 120);

-- Non-sensitive: arrangement is readable like name/worker_type. The bank_* + tax_id
-- + phone columns are deliberately NOT granted (admin-client / owner-RPC only).
grant select (dc_arrangement) on public.workers to authenticated;

-- ----------------------------------------------------------------------------
-- Both write RPCs gain the arrangement + payee params. CREATE OR REPLACE cannot
-- add parameters, so DROP then CREATE — bodies reproduced from the current
-- definitions (20260751 project_director gate) plus the new fields. The DROP
-- resets EXECUTE to the PUBLIC default, so the 20260625000200 lockdown is
-- re-applied below for the new signatures (pinned by pgTAP 36).
-- ----------------------------------------------------------------------------

drop function public.create_worker(text, public.worker_type, numeric, uuid, uuid, text);

create function public.create_worker(
  p_name text,
  p_type public.worker_type,
  p_day_rate numeric,
  p_contractor uuid default null,
  p_user uuid default null,
  p_note text default null,
  p_arrangement public.dc_arrangement default null,
  p_phone text default null,
  p_tax_id text default null,
  p_bank_name text default null,
  p_bank_account_number text default null,
  p_bank_account_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_worker: role not permitted' using errcode = '42501';
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'create_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_day_rate is null or p_day_rate < 0 then
    raise exception 'create_worker: invalid day rate' using errcode = 'P0001';
  end if;
  if p_arrangement is not null and p_type <> 'dc' then
    raise exception 'create_worker: arrangement only applies to dc workers'
      using errcode = 'P0001';
  end if;

  insert into public.workers (name, worker_type, contractor_id, user_id,
                              day_rate, created_by, note, dc_arrangement,
                              phone, tax_id, bank_name, bank_account_number,
                              bank_account_name)
  values (v_name, p_type, p_contractor, p_user, p_day_rate, auth.uid(),
          nullif(btrim(p_note), ''), p_arrangement,
          nullif(btrim(p_phone), ''), nullif(btrim(p_tax_id), ''),
          nullif(btrim(p_bank_name), ''), nullif(btrim(p_bank_account_number), ''),
          nullif(btrim(p_bank_account_name), ''))
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          v_id, jsonb_build_object('kind', 'create', 'name', v_name,
                                   'worker_type', p_type,
                                   'day_rate', p_day_rate,
                                   'dc_arrangement', p_arrangement));
  return v_id;
end;
$$;

drop function public.update_worker(uuid, text, boolean, uuid, text);

create function public.update_worker(
  p_id uuid,
  p_name text default null,
  p_active boolean default null,
  p_contractor uuid default null,
  p_note text default null,
  p_arrangement public.dc_arrangement default null,
  p_phone text default null,
  p_tax_id text default null,
  p_bank_name text default null,
  p_bank_account_number text default null,
  p_bank_account_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.workers%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'update_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_row from public.workers where id = p_id;
  if not found then
    raise exception 'update_worker: worker not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'update_worker: invalid name' using errcode = 'P0001';
  end if;
  if p_contractor is not null and v_row.worker_type <> 'dc' then
    raise exception 'update_worker: contractor only applies to dc workers'
      using errcode = 'P0001';
  end if;
  if p_arrangement is not null and v_row.worker_type <> 'dc' then
    raise exception 'update_worker: arrangement only applies to dc workers'
      using errcode = 'P0001';
  end if;

  -- Coalesce semantics (record_purchase precedent): omitted = preserved.
  -- The note uses case-preserve so an explicit '' can clear it; the payee
  -- text fields coalesce (edit replaces, omit preserves).
  update public.workers
     set name                = coalesce(v_name, name),
         active              = coalesce(p_active, active),
         contractor_id       = coalesce(p_contractor, contractor_id),
         dc_arrangement      = coalesce(p_arrangement, dc_arrangement),
         phone               = coalesce(nullif(btrim(p_phone), ''), phone),
         tax_id              = coalesce(nullif(btrim(p_tax_id), ''), tax_id),
         bank_name           = coalesce(nullif(btrim(p_bank_name), ''), bank_name),
         bank_account_number = coalesce(nullif(btrim(p_bank_account_number), ''), bank_account_number),
         bank_account_name   = coalesce(nullif(btrim(p_bank_account_name), ''), bank_account_name),
         note                = case
                                 when p_note is null then note
                                 else nullif(btrim(p_note), '')
                               end
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, jsonb_build_object('kind', 'update', 'name', v_name,
                                   'active', p_active,
                                   'contractor_id', p_contractor,
                                   'dc_arrangement', p_arrangement));
end;
$$;

-- Re-apply the spec-46-C3 / 20260625000200 EXECUTE lockdown for the NEW
-- signatures (DROP+CREATE reset them to the PUBLIC default). pgTAP 36 pins this.
revoke all on function
  public.create_worker(text, public.worker_type, numeric, uuid, uuid, text,
                       public.dc_arrangement, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.create_worker(text, public.worker_type, numeric, uuid, uuid, text,
                       public.dc_arrangement, text, text, text, text, text)
  to authenticated;

revoke all on function
  public.update_worker(uuid, text, boolean, uuid, text,
                       public.dc_arrangement, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.update_worker(uuid, text, boolean, uuid, text,
                       public.dc_arrangement, text, text, text, text, text)
  to authenticated;
