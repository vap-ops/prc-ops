-- Spec 396 U1 — update_worker records the PREVIOUS value of each identity field
-- it actually changes, as "<field>_before" in the worker_change audit payload.
--
-- Why: on 2026-08-04 a real employee's worker record was renamed to a different
-- person's name in production. The change was detectable in audit_log but NOT
-- reversible from it — the row carried only the NEW name. The original was
-- recoverable purely by luck, because an approved staff_registrations row still
-- held it. A worker created any other way would have been unrecoverable.
--
-- Contract:
--   * "<field>_before" is present ONLY when that field actually changes.
--     Presence therefore means "this field moved", never "a value was passed" —
--     ten of the eleven real renames on bound workers in the incident window
--     were harmless normalisations, and a _before key on every save is noise
--     that would train readers to ignore it.
--   * The existing keys (kind, name, active, pay_type, employment_type, gender)
--     are unchanged, so every existing reader keeps working.
--   * audit_log stays append-only (ADR 0004): this changes what a NEW row
--     contains and never touches an existing row.
--
-- Signature is byte-identical to the live function: a pure CREATE OR REPLACE,
-- no new overload, so no caller and no other lane is affected.

create or replace function public.update_worker(
  p_id uuid,
  p_name text default null,
  p_active boolean default null,
  p_pay_type public.pay_type default null,
  p_employment_type public.employment_type default null,
  p_contractor uuid default null,
  p_note text default null,
  p_phone text default null,
  p_tax_id text default null,
  p_bank_name text default null,
  p_bank_account_number text default null,
  p_bank_account_name text default null,
  p_gender public.worker_gender default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.workers%rowtype;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_payload jsonb;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'update_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_row from public.workers where id = p_id;
  if not found then
    raise exception 'update_worker: worker not found' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'update_worker: invalid name' using errcode = 'P0001';
  end if;

  -- Coalesce semantics: omitted = preserved. Note case-preserves so an explicit
  -- '' can clear it; payee text fields coalesce (edit replaces, omit preserves).
  update public.workers
     set name                = coalesce(v_name, name),
         active              = coalesce(p_active, active),
         pay_type            = coalesce(p_pay_type, pay_type),
         employment_type     = coalesce(p_employment_type, employment_type),
         contractor_id       = coalesce(p_contractor, contractor_id),
         phone               = coalesce(nullif(btrim(p_phone), ''), phone),
         tax_id              = coalesce(nullif(btrim(p_tax_id), ''), tax_id),
         bank_name           = coalesce(nullif(btrim(p_bank_name), ''), bank_name),
         bank_account_number = coalesce(nullif(btrim(p_bank_account_number), ''), bank_account_number),
         bank_account_name   = coalesce(nullif(btrim(p_bank_account_name), ''), bank_account_name),
         gender              = coalesce(p_gender, gender),
         note                = case
                                 when p_note is null then note
                                 else nullif(btrim(p_note), '')
                               end
   where id = p_id;

  -- Unchanged shape, so existing readers keep working.
  v_payload := jsonb_build_object('kind', 'update', 'name', v_name,
                                  'active', p_active,
                                  'pay_type', p_pay_type,
                                  'employment_type', p_employment_type,
                                  'gender', p_gender);

  -- v_row was read BEFORE the update, so it holds the previous values. Add a
  -- "_before" key only where the field genuinely moved (`is distinct from`
  -- so a NULL→value transition counts and a value→same does not).
  if v_name is not null and v_name is distinct from v_row.name then
    v_payload := v_payload || jsonb_build_object('name_before', v_row.name);
  end if;
  if p_active is not null and p_active is distinct from v_row.active then
    v_payload := v_payload || jsonb_build_object('active_before', v_row.active);
  end if;
  if p_pay_type is not null and p_pay_type is distinct from v_row.pay_type then
    v_payload := v_payload || jsonb_build_object('pay_type_before', v_row.pay_type);
  end if;
  if p_employment_type is not null
     and p_employment_type is distinct from v_row.employment_type then
    v_payload := v_payload
      || jsonb_build_object('employment_type_before', v_row.employment_type);
  end if;
  if p_gender is not null and p_gender is distinct from v_row.gender then
    v_payload := v_payload || jsonb_build_object('gender_before', v_row.gender);
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('worker_change', auth.uid(), public.current_user_role(), 'workers',
          p_id, v_payload);
end;
$function$;
