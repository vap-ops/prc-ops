-- Spec 149 U1 / ADR 0057 — upsert_gl_account: the single maintain path for the
-- chart of accounts (insert-or-update by code). pm/super gate (GL is pm/super;
-- the accounting role joins the read gate in U9). Mirrors the project's money-RPC
-- posture (set_worker_day_rate / update_project_settings): SECURITY DEFINER,
-- internal role gate, validate, write, audit, tighten grants.
--
-- INVOCATION: run on the AUTHENTICATED session, never the service-role admin
-- client — service-role has no JWT, so auth.uid() is NULL and current_user_role()
-- would refuse it (and the audit actor_id would be NULL).

create function public.upsert_gl_account(
  p_code              text,
  p_name_th           text,
  p_name_en           text,
  p_account_type      public.gl_account_type,
  p_normal_side       text,
  p_parent_code       text default null,
  p_is_postable       boolean default true,
  p_peak_account_code text default null,
  p_sort_order        integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code      text := btrim(coalesce(p_code, ''));
  v_name_th   text := btrim(coalesce(p_name_th, ''));
  v_name_en   text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_peak      text := nullif(btrim(coalesce(p_peak_account_code, '')), '');
  v_parent_raw text := nullif(btrim(coalesce(p_parent_code, '')), '');
  v_parent_id uuid;
  v_id        uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'upsert_gl_account: role not permitted' using errcode = '42501';
  end if;

  if v_code = '' or length(v_code) > 20 then
    raise exception 'upsert_gl_account: invalid code' using errcode = 'P0001';
  end if;
  if v_name_th = '' or length(v_name_th) > 120 then
    raise exception 'upsert_gl_account: invalid name' using errcode = 'P0001';
  end if;
  if p_normal_side not in ('debit', 'credit') then
    raise exception 'upsert_gl_account: normal_side must be debit or credit' using errcode = 'P0001';
  end if;

  -- Resolve the parent by code (the COA tree). Unknown parent = a friendly
  -- P0001 before the insert (the self-parent CHECK is the deeper guard).
  if v_parent_raw is not null then
    select id into v_parent_id from public.gl_accounts where code = v_parent_raw;
    if v_parent_id is null then
      raise exception 'upsert_gl_account: unknown parent code %', v_parent_raw using errcode = 'P0001';
    end if;
  end if;

  insert into public.gl_accounts
    (code, name_th, name_en, account_type, normal_side, parent_id, is_postable, peak_account_code, sort_order)
  values
    (v_code, v_name_th, v_name_en, p_account_type, p_normal_side, v_parent_id,
     coalesce(p_is_postable, true), v_peak, coalesce(p_sort_order, 0))
  on conflict (code) do update
    set name_th           = excluded.name_th,
        name_en           = excluded.name_en,
        account_type      = excluded.account_type,
        normal_side       = excluded.normal_side,
        parent_id         = excluded.parent_id,
        is_postable       = excluded.is_postable,
        peak_account_code = excluded.peak_account_code,
        sort_order        = excluded.sort_order,
        updated_at        = now()
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('gl_account_upsert', auth.uid(), public.current_user_role(),
          'gl_accounts', v_id,
          jsonb_build_object(
            'code', v_code,
            'account_type', p_account_type,
            'normal_side', p_normal_side,
            'parent_code', v_parent_raw,
            'is_postable', coalesce(p_is_postable, true),
            'peak_account_code', v_peak));

  return v_id;
end;
$$;

-- WRITES the COA. anon must not reach it; authenticated still hits the internal
-- pm/super gate (set_worker_day_rate posture).
revoke all on function public.upsert_gl_account(
  text, text, text, public.gl_account_type, text, text, boolean, text, integer)
  from public, anon;
grant execute on function public.upsert_gl_account(
  text, text, text, public.gl_account_type, text, text, boolean, text, integer)
  to authenticated;
