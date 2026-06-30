-- Spec 216 U1 — multi-rework rounds: a round dimension so each งานแก้ไข cycle
-- is distinguishable.
--
-- The defect loop (spec 144) is already repeatable, but every round's after_fix
-- (หลังแก้ไข, spec 215) photos collide in one bucket and only the latest reason
-- shows. This adds a `rework_round` counter:
--   • work_packages.rework_round — the WP's current cycle (0 = never reworked).
--   • photo_logs.rework_round     — the cycle a photo belongs to (after_fix carries
--     the WP's current round; before/during/after stay 0).
-- The reopen RPC increments the WP counter and stamps the round into the audit
-- payload (round ↔ reason becomes explicit, not just by ordering).
--
-- Additive: both columns NOT NULL DEFAULT 0 (existing rows backfill to 0). The
-- RPC is CREATE OR REPLACE'd from its LIVE body (project_director gate, migration
-- 20260751000000) — only the increment + audit `round` are new. No enum change:
-- after_fix stays one phase; the round is an orthogonal dimension. (U2 stamps the
-- photo round in addPhoto; U3/U4 read + render per-round — separate units.)

alter table public.work_packages
  add column rework_round smallint not null default 0;
comment on column public.work_packages.rework_round is
  'Spec 216 — the WP''s current rework cycle (0 = never reworked). Incremented by reopen_work_package_for_defect each time a complete WP is reopened for a defect.';

alter table public.photo_logs
  add column rework_round smallint not null default 0;
comment on column public.photo_logs.rework_round is
  'Spec 216 — the rework cycle this photo belongs to. after_fix (หลังแก้ไข) photos carry the WP''s rework_round at capture; before/during/after stay 0.';

-- Sourced from the LIVE body (migration 20260751000000_project_director_rpc_gates).
-- New: the UPDATE increments rework_round and returns it; the audit payload gains
-- `round`. Everything else (role/membership/complete-only gates) is unchanged.
create or replace function public.reopen_work_package_for_defect(p_wp uuid, p_reason text)
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

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'work_packages', p_wp,
    jsonb_build_object('event', 'wp_reopened_for_defect', 'reason', v_reason, 'round', v_round)
  );

  return true;
end;
$$;

revoke all on function public.reopen_work_package_for_defect(uuid, text) from public, anon;
grant execute on function public.reopen_work_package_for_defect(uuid, text) to authenticated;

comment on function public.reopen_work_package_for_defect(uuid, text) is
  'Spec 144/216 — reopen a complete WP to rework for a defect (site_admin/PM/PD/super, membership-gated). Advances rework_round and records the reason + round in audit_log. Only complete → rework.';
