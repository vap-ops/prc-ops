-- 377-U1-review follow-up — delete_work_package: close every history-guard gap.
--
-- The guard's exists() list was hand-grown per spec and had drifted from the FK
-- graph. Audited live 2026-07-30 (pg_constraint over confrelid = work_packages,
-- 24 referencing columns + a name sweep): a WP whose only references were in the
-- unlisted tables either
--   * died mid-delete on a ledger BEFORE DELETE trigger (stock_issues — its FK
--     is ON DELETE CASCADE and the cascade hits stock_issues_no_delete),
--   * silently destroyed cross-role history (CASCADE: daily_work_plan_items,
--     muster_team_wps, supply_plan_lines, wp_economics budget config),
--   * silently orphaned provenance (SET NULL: purchase_requests.
--     requested_from_work_package_id — the live store-first provenance column;
--     work_package_id is force-nulled by that flow — and site_issues), or
--   * surfaced a raw 23503 the app shows as a retryable "ลองใหม่" (NO ACTION:
--     journal_lines, wp_labor_costs, plan_baseline_items, stock_returns,
--     equipment_usage_logs, wp_profit_bank, variance_snapshots,
--     subcontract_wps, and child WPs via work_packages.parent_id).
--
-- Deliberately STILL cascading (audited, not missed):
--   * notification_outbox — system queue; RLS on, zero policies, no reader.
--   * wp_briefs DRAFT row — 377 U1 ruling: the draft dies with the WP, the
--     published wp_brief_versions rows are the blocking history (ADR 0086 §4).
--
-- Body-only CREATE OR REPLACE sourced from the LIVE definition (mig 075874's
-- form) — signature, DEFINER, search_path, role gate, audit write unchanged.
-- New: a children check with its own message (23503 named a constraint, not the
-- fix), requested_from_work_package_id folded into the purchase_requests arm,
-- and 15 additional reference arms. The P0001 errcode is the app's contract
-- (delete-actions.ts maps it to the friendly Thai refusal).

create or replace function public.delete_work_package(p_work_package_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
  v_code text;
  v_name text;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'delete_work_package: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'delete_work_package: not a member of this project' using errcode = '42501';
  end if;

  select code, name into v_code, v_name
    from public.work_packages where id = p_work_package_id;
  if not found then
    return false;
  end if;

  if exists (select 1 from public.work_packages where parent_id = p_work_package_id) then
    raise exception 'delete_work_package: work package has child work packages — delete the children first'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.photo_logs where work_package_id = p_work_package_id)
     or exists (select 1 from public.labor_logs where work_package_id = p_work_package_id)
     or exists (select 1 from public.approvals where work_package_id = p_work_package_id)
     or exists (select 1 from public.purchase_requests
                 where work_package_id = p_work_package_id
                    or requested_from_work_package_id = p_work_package_id)
     or exists (select 1 from public.work_package_members where work_package_id = p_work_package_id)
     or exists (select 1 from public.work_package_dependencies
                 where predecessor_id = p_work_package_id or successor_id = p_work_package_id)
     or exists (select 1 from public.wp_brief_versions where work_package_id = p_work_package_id)
     or exists (select 1 from public.wp_brief_attachments a
                  join public.wp_briefs b on b.id = a.brief_id
                 where b.work_package_id = p_work_package_id)
     or exists (select 1 from public.stock_issues where work_package_id = p_work_package_id)
     or exists (select 1 from public.stock_returns where work_package_id = p_work_package_id)
     or exists (select 1 from public.journal_lines where work_package_id = p_work_package_id)
     or exists (select 1 from public.equipment_usage_logs where work_package_id = p_work_package_id)
     or exists (select 1 from public.wp_labor_costs where work_package_id = p_work_package_id)
     or exists (select 1 from public.wp_profit_bank where work_package_id = p_work_package_id)
     or exists (select 1 from public.wp_economics where work_package_id = p_work_package_id)
     or exists (select 1 from public.plan_baseline_items where work_package_id = p_work_package_id)
     or exists (select 1 from public.variance_snapshots where work_package_id = p_work_package_id)
     or exists (select 1 from public.subcontract_wps where work_package_id = p_work_package_id)
     or exists (select 1 from public.muster_team_wps where work_package_id = p_work_package_id)
     or exists (select 1 from public.daily_work_plan_items where work_package_id = p_work_package_id)
     or exists (select 1 from public.supply_plan_lines where work_package_id = p_work_package_id)
     or exists (select 1 from public.site_issues where work_package_id = p_work_package_id)
  then
    raise exception 'delete_work_package: work package has history (photos/labor/approvals/requests/members/dependencies/brief/stock/plans/money) — cancel it instead'
      using errcode = 'P0001';
  end if;

  delete from public.work_packages where id = p_work_package_id;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'work_packages', p_work_package_id,
    jsonb_build_object('event', 'wp_deleted', 'code', v_code, 'name', v_name)
  );

  return true;
end;
$function$;

-- CREATE OR REPLACE preserves the ACL (verified live: postgres/authenticated/
-- service_role, no anon, no PUBLIC) — re-emitted as belt-and-suspenders for a
-- fresh full-history apply.
revoke all on function public.delete_work_package(uuid) from public, anon;
grant execute on function public.delete_work_package(uuid) to authenticated, service_role;
