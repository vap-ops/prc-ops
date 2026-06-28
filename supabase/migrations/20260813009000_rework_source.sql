-- Spec 217 U1 — rework source (ตรวจภายใน vs ลูกค้าแจ้ง).
--
-- A rework round is now also tagged with WHO called it: 'internal' (our QA/SA
-- found the defect) or 'client' (the client reported it). Operator scope:
-- record + display only — no behaviour change.
--
-- The source is a per-round property, so (like the spec-216 reason + round) it
-- lives in the wp_reopened_for_defect audit payload — no new column. The reopen
-- RPC gains p_source; the report-defect form picks it (U2).
--
-- Signature change: the 2-arg reopen is DROPped and recreated as 3-arg with
-- p_source DEFAULT 'internal' (so the still-2-arg app call + the pgTAP 2-arg
-- calls keep working until U2 passes the source). DROP+CREATE drops grants, so
-- they are re-applied (the grant trap). Body sourced from the LIVE 216 version
-- (rework_round increment + project_director gate) — only p_source + the audit
-- `source` key are new.

create type public.rework_source as enum ('internal', 'client');
comment on type public.rework_source is
  'Spec 217 — who called a rework: internal (our QA/SA, ตรวจภายใน) or client (ลูกค้าแจ้ง).';

drop function if exists public.reopen_work_package_for_defect(uuid, text);

create function public.reopen_work_package_for_defect(
  p_wp uuid,
  p_reason text,
  p_source public.rework_source default 'internal'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.work_package_status;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_uid    uuid := auth.uid();
  v_role   public.user_role := public.current_user_role();
  v_round  smallint;
begin
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'reopen_work_package_for_defect: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'reopen_work_package_for_defect: not a member of this project'
      using errcode = '42501';
  end if;
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'reopen_work_package_for_defect: reason required (<= 1000 chars)'
      using errcode = '22023';
  end if;

  select status into v_status from public.work_packages where id = p_wp;
  if not found then
    raise exception 'reopen_work_package_for_defect: unknown work package' using errcode = '22023';
  end if;
  if v_status <> 'complete' then
    raise exception 'reopen_work_package_for_defect: only a complete work package can be reopened'
      using errcode = '22023';
  end if;

  -- Spec 216: advance the rework cycle and capture which round this reopen opened.
  update public.work_packages
     set status = 'rework', rework_round = rework_round + 1
   where id = p_wp
  returning rework_round into v_round;

  -- Spec 217: stamp the source (internal/client) alongside the reason + round.
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'work_packages', p_wp,
    jsonb_build_object(
      'event', 'wp_reopened_for_defect',
      'reason', v_reason,
      'round', v_round,
      'source', p_source
    )
  );

  return true;
end;
$$;

revoke all on function public.reopen_work_package_for_defect(uuid, text, public.rework_source)
  from public, anon;
grant execute on function public.reopen_work_package_for_defect(uuid, text, public.rework_source)
  to authenticated;

comment on function public.reopen_work_package_for_defect(uuid, text, public.rework_source) is
  'Spec 144/216/217 — reopen a complete WP to rework for a defect (site_admin/PM/PD/super, membership-gated). Advances rework_round; records reason + round + source (internal/client) in audit_log. Only complete → rework.';
