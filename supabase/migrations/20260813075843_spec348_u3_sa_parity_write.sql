-- Spec 348 U3 / ADR 0084 — procurement_manager gains SA WRITE parity.
--
-- U1 (mig 075842) gave her see-all VISIBILITY + the six staff-read policies; U2
-- opened the SA page gates. This unit is the "do everything" half: every WRITE
-- gate that admits site_admin now also admits procurement_manager, under the same
-- conditions — she is a full site_admin superset (union with procurement + her
-- manager-tier extras), matching project_director's see-all posture.
--
-- SCOPE = "widen to SA's arm, never past it." Sourced from a LIVE sweep
-- 2026-07-23 of every SECURITY DEFINER function + every non-SELECT RLS policy
-- naming site_admin. Each widened gate is CREATE-OR-REPLACE'd byte-for-byte
-- except that 'procurement_manager' is added to the site_admin role array (CREATE
-- OR REPLACE preserves each function's existing ACL — no re-grant needed).
--
-- DIRECTIONAL: only procurement_manager is added. Plain `procurement` is
-- unchanged everywhere (where a body comment says "procurement is excluded" it
-- means the PLAIN procurement role, which stays excluded — clarified inline).
-- site_admin is unchanged.
--
-- WIDENED (25 write RPCs + 3 role helpers):
--   • muster: open_muster_team, muster_scan_in, muster_scan_out,
--     set_muster_team_wps, move_muster_worker, close_muster_day
--   • labor: log_labor_day, correct_labor_log
--   • WP lifecycle: submit_work_package_for_approval, resubmit_work_package_evidence,
--     reopen_work_package_for_defect (BOTH arms — the internal-defect admit arm AND
--     the client-source refusal arm, so she mirrors site_admin: files internal
--     defects, refused for client-source below PM tier, spec 337 U5b)
--   • stock/store: issue_stock, issue_stock_bulk, return_stock_to_store,
--     reverse_stock_issue, record_stock_count, divert_purchase_to_store,
--     split_purchase_request_on_receipt
--   • site purchase: record_site_purchase, site_purchase_use_now
--   • workers/consent: sa_add_project_worker, sa_add_project_worker_with_bank,
--     record_contractor_consent
--   • site issues: report_site_issue, resolve_site_issue
--   • helpers: is_site_staff (deferred from U1 — it gates only write RPCs:
--     set_work_package_notes, enqueue_peak_sync), daily_work_plan_assert_writer,
--     sa_worker_bank_status
--
-- DELIBERATELY NOT TOUCHED (site_admin is a comment / data-filter / exclusion —
-- SA is NOT admitted, so parity keeps procurement_manager out):
--   • decide_work_package — gate is PM-tier (pm/super/pd); site_admin only in a
--     comment. She keeps her existing PR-decide surface, never WP approval.
--   • record_wage_payment — refuses site_admin (money), but its role gate is
--     is_back_office(current_user_role()), which INCLUDES procurement_manager, so
--     she is ALREADY admitted to record wage payments by design (back-office
--     tier) — no literal to widen, no gap. site_admin is refused, so SA parity
--     leaves it untouched. (The body comment "pm/super/director/procurement only"
--     is stale — it predates procurement_manager joining is_back_office.)
--   • confirm_stock_issue_on_behalf — "PM tier only. NOT site_admin."
--   • set_primary_project_for, project_site_management — site_admin is the SUBJECT
--     being selected (u.role = 'site_admin'), not the caller gate.
--   • current_user_sa_visible_crew_ids — an SA crew-visibility read path;
--     procurement_manager already reads all crews via is_back_office (redundant).
--
-- Equipment (check_in/out, movement) already admits her via EQUIPMENT_MOVE_ROLES
-- (procurement_manager); receive/supply/stock-in already admit her via a
-- procurement exemption arm — no change here.

-- report_site_issue
CREATE OR REPLACE FUNCTION public.report_site_issue(p_project_id uuid, p_work_package_id uuid DEFAULT NULL::uuid, p_issue_type site_issue_type DEFAULT NULL::site_issue_type, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in
        ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'report_site_issue: role not permitted' using errcode = '42501';
  end if;

  if p_issue_type is null then
    raise exception 'report_site_issue: issue type required' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'report_site_issue: note too long' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'report_site_issue: project not found' using errcode = 'P0001';
  end if;

  if not public.can_see_project(p_project_id) then
    raise exception 'report_site_issue: not a project member' using errcode = '42501';
  end if;

  if p_work_package_id is not null then
    if not exists (
      select 1 from public.work_packages wp
       where wp.id = p_work_package_id and wp.project_id = p_project_id
    ) then
      raise exception 'report_site_issue: work package not found in project'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.site_issues
    (project_id, work_package_id, issue_type, note, reported_by)
  values
    (p_project_id, p_work_package_id, p_issue_type, v_note, auth.uid())
  returning id into v_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(), 'insert', 'site_issues', v_id,
     jsonb_build_object(
       'project_id',      p_project_id,
       'work_package_id', p_work_package_id,
       'issue_type',      p_issue_type::text,
       'note',            v_note));

  return v_id;
end;
$function$;

-- open_muster_team
CREATE OR REPLACE FUNCTION public.open_muster_team(p_project uuid, p_date date, p_lead_worker uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
  v_id   uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'open_muster_team: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null or p_lead_worker is null then
    raise exception 'open_muster_team: project, date and lead worker are required' using errcode = 'P0001';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'open_muster_team: not a member of this project' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers w where w.id = p_lead_worker) then
    raise exception 'open_muster_team: unknown lead worker' using errcode = 'P0001';
  end if;

  insert into public.muster_teams as t (project_id, work_date, lead_worker_id, created_by)
  values (p_project, p_date, p_lead_worker, auth.uid())
  on conflict (project_id, work_date, lead_worker_id)
  do update set lead_worker_id = excluded.lead_worker_id
  returning t.id into v_id;
  return v_id;
end; $function$;

-- muster_scan_in
CREATE OR REPLACE FUNCTION public.muster_scan_in(p_team uuid, p_worker uuid, p_method muster_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role      public.user_role := public.current_user_role();
  v_team      public.muster_teams%rowtype;
  v_existing  public.muster_attendance%rowtype;
  v_other     text;
  v_other_prj uuid;
  v_id        uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'muster_scan_in: role not permitted' using errcode = '42501';
  end if;
  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'muster_scan_in: team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_team.project_id) then
    raise exception 'muster_scan_in: not a member of this project' using errcode = '42501';
  end if;
  if p_method is null then
    raise exception 'muster_scan_in: method required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.workers w where w.id = p_worker) then
    raise exception 'muster_scan_in: unknown worker' using errcode = 'P0001';
  end if;

  select * into v_existing from public.muster_attendance
   where worker_id = p_worker and work_date = v_team.work_date;
  if found then
    if v_existing.team_id = p_team then
      return v_existing.id;
    end if;
    select t.project_id, w.name into v_other_prj, v_other
      from public.muster_teams t
      join public.workers w on w.id = t.lead_worker_id
     where t.id = v_existing.team_id;
    if v_other_prj is not null and public.can_see_project(v_other_prj) then
      raise exception 'muster_scan_in: worker already in team of % today', coalesce(v_other, '?')
        using errcode = 'P0001';
    else
      raise exception 'muster_scan_in: worker is already mustered elsewhere today'
        using errcode = 'P0001';
    end if;
  end if;

  -- Guard the concurrent-scan race (two phones, same worker+date): the unique
  -- (worker_id, work_date) constraint is the backstop; surface the friendly conflict.
  begin
    insert into public.muster_attendance (team_id, worker_id, work_date, in_method, scanned_by)
    values (p_team, p_worker, v_team.work_date, p_method, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'muster_scan_in: worker already mustered today (concurrent scan)' using errcode = 'P0001';
  end;
  return v_id;
end; $function$;

-- muster_scan_out
CREATE OR REPLACE FUNCTION public.muster_scan_out(p_team uuid, p_worker uuid, p_method muster_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role    public.user_role := public.current_user_role();
  v_team    public.muster_teams%rowtype;
  v_att     public.muster_attendance%rowtype;
  v_day_end timestamptz;
  v_ot      numeric;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'muster_scan_out: role not permitted' using errcode = '42501';
  end if;
  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'muster_scan_out: team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_team.project_id) then
    raise exception 'muster_scan_out: not a member of this project' using errcode = '42501';
  end if;
  if p_method is null then
    raise exception 'muster_scan_out: method required' using errcode = 'P0001';
  end if;

  select * into v_att from public.muster_attendance
   where worker_id = p_worker and work_date = v_team.work_date;
  if not found then
    raise exception 'muster_scan_out: no attendance for this worker on the team''s date' using errcode = 'P0001';
  end if;
  if v_att.team_id is distinct from p_team then
    raise exception 'muster_scan_out: worker is in another team today — move first' using errcode = 'P0001';
  end if;

  -- v1 standard day end = 17:00 Asia/Bangkok (spec 306 U4; per-project config = YAGNI).
  v_day_end := (v_team.work_date + time '17:00') at time zone 'Asia/Bangkok';
  v_ot := floor((extract(epoch from (now() - v_day_end)) / 3600.0) * 2) / 2;
  if v_ot <= 0 then
    v_ot := null;
  end if;

  update public.muster_attendance
     set out_at = now(), out_method = p_method, ot_hours = v_ot, out_auto = false
   where id = v_att.id;
  return v_att.id;
end; $function$;

-- set_muster_team_wps
CREATE OR REPLACE FUNCTION public.set_muster_team_wps(p_team uuid, p_wp_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
  v_team public.muster_teams%rowtype;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'set_muster_team_wps: role not permitted' using errcode = '42501';
  end if;
  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'set_muster_team_wps: team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_team.project_id) then
    raise exception 'set_muster_team_wps: not a member of this project' using errcode = '42501';
  end if;
  if p_wp_ids is null then
    raise exception 'set_muster_team_wps: WP id array required (empty array clears)' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_wp_ids) as x(id)
     where not exists (
       select 1 from public.work_packages w
        where w.id = x.id and w.project_id = v_team.project_id)) then
    raise exception 'set_muster_team_wps: every WP must belong to the team''s project' using errcode = 'P0001';
  end if;

  delete from public.muster_team_wps
   where team_id = p_team and not (work_package_id = any (p_wp_ids));
  insert into public.muster_team_wps (team_id, work_package_id)
  select p_team, x.id from unnest(p_wp_ids) as x(id)
  on conflict do nothing;
end; $function$;

-- move_muster_worker
CREATE OR REPLACE FUNCTION public.move_muster_worker(p_worker uuid, p_date date, p_to_team uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role         public.user_role := public.current_user_role();
  v_to           public.muster_teams%rowtype;
  v_att          public.muster_attendance%rowtype;
  v_from_project uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'move_muster_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_to from public.muster_teams where id = p_to_team;
  if not found then
    raise exception 'move_muster_worker: target team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_to.project_id) then
    raise exception 'move_muster_worker: not a member of this project' using errcode = '42501';
  end if;
  if v_to.work_date is distinct from p_date then
    raise exception 'move_muster_worker: target team is not for this date' using errcode = 'P0001';
  end if;
  select * into v_att from public.muster_attendance
   where worker_id = p_worker and work_date = p_date;
  if not found then
    raise exception 'move_muster_worker: no attendance for this worker on this date' using errcode = 'P0001';
  end if;
  if v_att.team_id = p_to_team then
    return v_att.id;
  end if;
  select project_id into v_from_project from public.muster_teams where id = v_att.team_id;
  if v_from_project is distinct from v_to.project_id then
    raise exception 'move_muster_worker: cannot move across projects' using errcode = 'P0001';
  end if;

  update public.muster_attendance set team_id = p_to_team where id = v_att.id;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'muster_attendance', v_att.id,
          jsonb_build_object('kind', 'muster_move', 'worker_id', p_worker,
                             'work_date', p_date, 'from_team', v_att.team_id,
                             'to_team', p_to_team));
  return v_att.id;
end; $function$;

-- close_muster_day
CREATE OR REPLACE FUNCTION public.close_muster_day(p_project uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role    public.user_role := public.current_user_role();
  v_day_end timestamptz;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'close_muster_day: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null then
    raise exception 'close_muster_day: project and date are required' using errcode = 'P0001';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'close_muster_day: not a member of this project' using errcode = '42501';
  end if;

  v_day_end := (p_date + time '17:00') at time zone 'Asia/Bangkok';
  -- Auto-out at day-end, but never before the worker's own in_at (a post-17:00
  -- scan-in would otherwise get out_at < in_at → negative span into the U5 derive).
  update public.muster_attendance a
     set out_at = greatest(v_day_end, a.in_at), out_auto = true
    from public.muster_teams t
   where t.id = a.team_id and t.project_id = p_project
     and a.work_date = p_date and a.out_at is null;

  insert into public.muster_day_closures (project_id, work_date, closed_by)
  values (p_project, p_date, auth.uid())
  on conflict (project_id, work_date)
  do update set closed_at = now(), closed_by = excluded.closed_by;
end; $function$;

-- split_purchase_request_on_receipt
CREATE OR REPLACE FUNCTION public.split_purchase_request_on_receipt(p_request_id uuid, p_received_qty numeric, p_received_by text DEFAULT NULL::text, p_delivery_note text DEFAULT NULL::text, p_delivered_amount numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orig          public.purchase_requests%rowtype;
  v_remaining_qty numeric;
  v_delivered_amt numeric;
  v_remaining_amt numeric;
  v_child_id      uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'split_purchase_request_on_receipt: role not permitted'
      using errcode = '42501';
  end if;

  select * into v_orig
    from public.purchase_requests
   where id = p_request_id
   for update;
  if not found then
    raise exception 'split_purchase_request_on_receipt: request not found'
      using errcode = 'P0001';
  end if;

  if v_orig.purchase_order_id is null
     or v_orig.status not in ('purchased', 'on_route') then
    raise exception
      'split_purchase_request_on_receipt: not an in-transit PO member (status %)', v_orig.status
      using errcode = 'P0001';
  end if;

  if p_received_qty is null or p_received_qty <= 0 or p_received_qty >= v_orig.quantity then
    raise exception
      'split_purchase_request_on_receipt: received qty must be > 0 and < ordered (%)', v_orig.quantity
      using errcode = 'P0001';
  end if;

  v_remaining_qty := v_orig.quantity - p_received_qty;

  if v_orig.amount is null then
    v_delivered_amt := null;
    v_remaining_amt := null;
  elsif p_delivered_amount is not null then
    if p_delivered_amount < 0 or p_delivered_amount > v_orig.amount then
      raise exception
        'split_purchase_request_on_receipt: delivered amount out of range (0..%)', v_orig.amount
        using errcode = 'P0001';
    end if;
    v_delivered_amt := p_delivered_amount;
    v_remaining_amt := v_orig.amount - p_delivered_amount;
  else
    v_delivered_amt := round(v_orig.amount * p_received_qty / v_orig.quantity, 2);
    v_remaining_amt := v_orig.amount - v_delivered_amt;
  end if;

  -- The remainder child stays in the SAME delivery as the original (ADR 0054 §7).
  insert into public.purchase_requests (
    work_package_id, item_description, quantity, unit, status, source,
    requested_by, requested_by_email, approved_by, decided_at, decision_comment,
    supplier, supplier_id, order_ref, amount, purchased_at, shipped_at,
    eta, needed_by, priority, notes, purchase_order_id, delivery_id, split_from_request_id
  )
  values (
    v_orig.work_package_id, v_orig.item_description, v_remaining_qty, v_orig.unit,
    'on_route', v_orig.source,
    v_orig.requested_by, v_orig.requested_by_email, v_orig.approved_by, v_orig.decided_at,
    v_orig.decision_comment, v_orig.supplier, v_orig.supplier_id, v_orig.order_ref,
    v_remaining_amt, v_orig.purchased_at, coalesce(v_orig.shipped_at, now()),
    v_orig.eta, v_orig.needed_by, v_orig.priority, v_orig.notes,
    v_orig.purchase_order_id, v_orig.delivery_id, p_request_id
  )
  returning id into v_child_id;

  update public.purchase_requests
     set quantity         = p_received_qty,
         amount           = v_delivered_amt,
         delivered_at     = now(),
         received_by      = p_received_by,
         delivery_note    = p_delivery_note,
         delivery_batch_id = gen_random_uuid()
   where id = p_request_id;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(), public.current_user_role(), 'update', 'purchase_requests', p_request_id,
     jsonb_build_object(
       'principal',         session_user,
       'transition',        jsonb_build_array('partial_receipt_split'),
       'split_child_id',    v_child_id,
       'ordered_qty',       v_orig.quantity,
       'received_qty',      p_received_qty,
       'remaining_qty',     v_remaining_qty,
       'delivered_amount',  v_delivered_amt,
       'remaining_amount',  v_remaining_amt,
       'purchase_order_id', v_orig.purchase_order_id
     ));

  return v_child_id;
end;
$function$;

-- sa_add_project_worker_with_bank
CREATE OR REPLACE FUNCTION public.sa_add_project_worker_with_bank(p_project uuid, p_name text, p_national_id text, p_dob date, p_photo_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_yy     int  := (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int;
  v_seq    int;
  v_emp    text;
  v_worker uuid;
begin
  if v_role is null or v_role not in ('site_admin','super_admin', 'procurement_manager') then
    raise exception 'sa_add_project_worker_with_bank: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'sa_add_project_worker_with_bank: not a member of this project' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'sa_add_project_worker_with_bank: name required' using errcode = 'P0001';
  end if;
  if not public.is_valid_thai_national_id(p_national_id) then
    raise exception 'sa_add_project_worker_with_bank: invalid Thai national-ID' using errcode = 'P0001';
  end if;
  if p_dob is null or p_dob > (((now() at time zone 'Asia/Bangkok')::date) - interval '18 years') then
    raise exception 'sa_add_project_worker_with_bank: worker must be at least 18' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_photo_path), '') = ''
     or split_part(p_photo_path, '/', 1) is distinct from 'sa-bank-capture' then
    raise exception 'sa_add_project_worker_with_bank: a passbook photo is required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workers w where w.tax_id = p_national_id) then
    raise exception 'sa_add_project_worker_with_bank: this national-ID is already on a worker' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.crew_registrations r where r.national_id = p_national_id and r.status = 'pending') then
    raise exception 'sa_add_project_worker_with_bank: this national-ID is already a pending registration' using errcode = 'P0001';
  end if;

  insert into public.employee_id_counters (year, next_val) values (v_yy, 2)
  on conflict (year) do update set next_val = public.employee_id_counters.next_val + 1
  returning next_val - 1 into v_seq;
  v_emp := 'PRC-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.workers (name, pay_type, employment_type, user_id, employee_id, day_rate,
                              active, created_by, project_id, tax_id, date_of_birth)
  values (v_name, 'daily', 'temporary', null, v_emp, 0,
          true, auth.uid(), p_project, p_national_id, p_dob)
  returning id into v_worker;

  insert into public.worker_bank_capture (worker_id, photo_path, status, captured_by)
  values (v_worker, p_photo_path, 'pending_pm', auth.uid());

  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (v_worker, p_project, auth.uid(), 'sa direct add (capture-blind bank)');

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', v_worker,
          jsonb_build_object('kind','create','source','sa_add_with_bank','project_id',p_project,'employee_id',v_emp));
  return v_worker;
end; $function$;

-- resolve_site_issue
CREATE OR REPLACE FUNCTION public.resolve_site_issue(p_site_issue_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in
        ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'resolve_site_issue: role not permitted' using errcode = '42501';
  end if;

  select project_id into v_project
    from public.site_issues where id = p_site_issue_id;
  if v_project is null then
    raise exception 'resolve_site_issue: issue not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'resolve_site_issue: not a project member' using errcode = '42501';
  end if;

  update public.site_issues
     set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
   where id = p_site_issue_id and status <> 'resolved';

  if found then
    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (auth.uid(), public.current_user_role(), 'update', 'site_issues', p_site_issue_id,
       jsonb_build_object('event', 'site_issue_resolved'));
  end if;

  return p_site_issue_id;
end;
$function$;

-- record_contractor_consent
CREATE OR REPLACE FUNCTION public.record_contractor_consent(p_contractor uuid, p_kind contractor_consent_kind, p_document_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_is_self  boolean := coalesce(public.current_user_contractor_id() = p_contractor, false);
  v_is_staff boolean := coalesce(public.current_user_role() in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager'), false);
begin
  if not (v_is_self or v_is_staff) then
    raise exception 'record_contractor_consent: not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor) then
    raise exception 'record_contractor_consent: contractor not found' using errcode = 'P0001';
  end if;
  insert into public.contractor_consents (contractor_id, kind, recorded_by, document_id)
  values (p_contractor, p_kind, auth.uid(), p_document_id)
  returning id into v_id;
  return v_id;
end;
$function$;

-- submit_work_package_for_approval
CREATE OR REPLACE FUNCTION public.submit_work_package_for_approval(p_wp uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_status public.work_package_status;
begin
  -- SITE_STAFF_ROLES (src/lib/auth/role-home.ts): the field-capture population.
  -- procurement is a read-only WP viewer and must never submit. Null-safe: a
  -- session with no JWT (the old admin-client path) has no role and is refused.
  if not coalesce(v_role = any (array['site_admin', 'project_manager',
                                      'super_admin', 'project_director', 'procurement_manager']::public.user_role[]), false) then
    raise exception 'submit_work_package_for_approval: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'submit_work_package_for_approval: not a member of this project'
      using errcode = '42501';
  end if;

  -- FOR UPDATE serialises against a concurrent decide/submit on the same WP, so
  -- the status checked below is the status updated.
  select status into v_status from public.work_packages where id = p_wp for update;
  if not found then
    raise exception 'submit_work_package_for_approval: work package not found' using errcode = '22023';
  end if;
  -- TRANSITIONABLE_FROM_STATUSES (src/lib/photos/transitions.ts). Spec 144:
  -- rework is submittable — fixing a defect sends it back to review.
  if v_status not in ('not_started', 'in_progress', 'on_hold', 'rework') then
    raise exception 'submit_work_package_for_approval: cannot submit from status %', v_status
      using errcode = '22023';
  end if;

  update public.work_packages
     set status = 'pending_approval'
   where id = p_wp
     and status in ('not_started', 'in_progress', 'on_hold', 'rework');

  return true;
end;
$function$;

-- log_labor_day
CREATE OR REPLACE FUNCTION public.log_labor_day(p_wp uuid, p_worker uuid, p_date date, p_fraction day_fraction, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_worker public.workers%rowtype;
  v_wp_status public.work_package_status;
  v_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'log_labor_day: role not permitted' using errcode = '42501';
  end if;
  if p_fraction is null then
    raise exception 'log_labor_day: day fraction required' using errcode = 'P0001';
  end if;
  -- U3 (spec 271 §3): the labor actual_start anchor must not be stageable
  -- ahead of time.
  if p_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'log_labor_day: work_date cannot be in the future' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_wp::text || '|' || p_worker::text || '|' || p_date::text, 0));

  select status into v_wp_status
    from public.work_packages where id = p_wp;
  if not found then
    raise exception 'log_labor_day: work package not found' using errcode = 'P0001';
  end if;
  if v_wp_status = 'complete' then
    raise exception 'log_labor_day: work package is complete'
      using errcode = 'P0001';
  end if;

  select * into v_worker from public.workers where id = p_worker;
  if not found then
    raise exception 'log_labor_day: worker not found' using errcode = 'P0001';
  end if;
  if not v_worker.active then
    raise exception 'log_labor_day: worker is inactive' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.labor_logs ll
     where ll.work_package_id = p_wp
       and ll.worker_id = p_worker
       and ll.work_date = p_date
       and ll.day_fraction is not null
       and not exists (select 1 from public.labor_logs newer
                        where newer.superseded_by = ll.id)
  ) then
    raise exception 'log_labor_day: entry already exists for this worker and day'
      using errcode = 'P0001';
  end if;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, pay_type_snapshot,
     wht_pct_snapshot,
     entered_by, self_logged, note)
  values
    (p_wp, p_worker, p_date, p_fraction,
     v_worker.day_rate, v_worker.name, v_worker.pay_type,
     (select wht_pct from public.labor_wht_config where id = true),
     auth.uid(),
     v_worker.user_id is not distinct from auth.uid()
       and v_worker.user_id is not null,
     nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

-- correct_labor_log
CREATE OR REPLACE FUNCTION public.correct_labor_log(p_log uuid, p_reason text, p_fraction day_fraction DEFAULT NULL::day_fraction, p_tombstone boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orig public.labor_logs%rowtype;
  v_worker_user uuid;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'correct_labor_log: role not permitted' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 300 then
    raise exception 'correct_labor_log: reason required (max 300 chars)'
      using errcode = 'P0001';
  end if;
  if not p_tombstone and p_fraction is null then
    raise exception 'correct_labor_log: new fraction required unless removing'
      using errcode = 'P0001';
  end if;

  select * into v_orig from public.labor_logs where id = p_log;
  if not found then
    raise exception 'correct_labor_log: log not found' using errcode = 'P0001';
  end if;
  if v_orig.day_fraction is null then
    raise exception 'correct_labor_log: cannot correct a removal'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_orig.work_package_id::text || '|'
                     || v_orig.worker_id::text || '|'
                     || v_orig.work_date::text, 0));

  if exists (select 1 from public.labor_logs newer
              where newer.superseded_by = p_log) then
    raise exception 'correct_labor_log: log already superseded'
      using errcode = 'P0001';
  end if;

  select w.user_id into v_worker_user
    from public.workers w where w.id = v_orig.worker_id;

  insert into public.labor_logs
    (work_package_id, worker_id, work_date, day_fraction,
     day_rate_snapshot, worker_name_snapshot, pay_type_snapshot,
     wht_pct_snapshot,
     entered_by, self_logged,
     superseded_by, correction_reason, note)
  values
    (v_orig.work_package_id, v_orig.worker_id, v_orig.work_date,
     case when p_tombstone then null else p_fraction end,
     v_orig.day_rate_snapshot, v_orig.worker_name_snapshot,
     v_orig.pay_type_snapshot,
     v_orig.wht_pct_snapshot,
     auth.uid(),
     v_worker_user is not distinct from auth.uid() and v_worker_user is not null,
     p_log, v_reason,
     case
       when p_tombstone then null
       when p_note is null then v_orig.note
       else nullif(btrim(p_note), '')
     end)
  returning id into v_id;
  return v_id;
end;
$function$;

-- record_site_purchase
CREATE OR REPLACE FUNCTION public.record_site_purchase(p_work_package_id uuid, p_item_description text, p_quantity numeric, p_unit text, p_reason_code purchase_request_reason_code, p_amount numeric DEFAULT NULL::numeric, p_vat_rate numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item  text := nullif(trim(coalesce(p_item_description, '')), '');
  v_unit  text := nullif(trim(coalesce(p_unit, '')), '');
  v_actor text;
  v_id    uuid;
begin
  -- project_director rides along with project_manager (spec 152 / ADR 0058;
  -- pgTAP file 91 pins that every PM-gated RPC also names it) — the LIVE gate
  -- carried it (added by 20260751); reconstructing from the pre-152 body would
  -- have dropped it.
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
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
  -- Spec 176 U4: the reactive-reason tag is required.
  if p_reason_code is null then
    raise exception 'record_site_purchase: reason code required'
      using errcode = 'P0001';
  end if;
  -- Spec 103: amount optional, positive when supplied.
  if p_amount is not null and p_amount <= 0 then
    raise exception 'record_site_purchase: amount must be positive'
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

  -- SA audit 2026-07 F2: project-membership scope. The v1 "no membership" note
  -- above is superseded here — a site_purchased row is an EXPENSE, and a role-only
  -- gate let any admitted role file it against a WP in a non-member project. Mirror
  -- the siblings issue_stock / site_purchase_use_now (which gate on can_see_project);
  -- this RPC takes only the WP, so gate on can_see_wp. Kept AFTER the existence check
  -- so an unknown WP stays a P0001 'not found' — the only new behaviour is this
  -- reject. super_admin / project_director stay unconditional via can_see_project.
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'record_site_purchase: not a project member'
      using errcode = '42501';
  end if;

  select coalesce(nullif(trim(u.full_name), ''), auth.uid()::text)
    into v_actor
    from public.users u
    where u.id = auth.uid();

  insert into public.purchase_requests
    (work_package_id, item_description, quantity, unit, amount, vat_rate, reason_code,
     status, source, requested_by, purchased_at, delivered_at, received_by, received_by_id)
  values
    (p_work_package_id, v_item, p_quantity, v_unit, p_amount, p_vat_rate, p_reason_code,
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
       'amount',           p_amount,
       'vat_rate',         p_vat_rate,
       'reason_code',      p_reason_code,
       'received_by',      v_actor
     ));

  return v_id;
end;
$function$;

-- issue_stock
CREATE OR REPLACE FUNCTION public.issue_stock(p_project_id uuid, p_catalog_item_id uuid, p_work_package_id uuid, p_qty numeric, p_note text DEFAULT NULL::text, p_receiver_worker_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_unit        text;
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_sell        numeric;
  v_decrement   numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES — site_admin draws at the WP, plus the PM tier.
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'issue_stock: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'issue_stock: not a project member' using errcode = '42501';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'issue_stock: qty must be > 0' using errcode = '22023';
  end if;
  -- The WP must belong to this project (you draw to a WP in the same store).
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'issue_stock: work package not in this project' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'issue_stock: unknown or inactive catalog item' using errcode = '22023';
  end if;
  -- A named receiver must be an ACTIVE worker on this project (or unassigned).
  if p_receiver_worker_id is not null and not exists (
    select 1 from public.workers w
     where w.id = p_receiver_worker_id and w.active
       and (w.project_id = p_project_id or w.project_id is null)
  ) then
    raise exception 'issue_stock: receiver is not an active worker on this project'
      using errcode = '22023';
  end if;

  -- Lock the on-hand row and check sufficiency.
  select qty_on_hand, total_value into v_qty_on_hand, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  if v_qty_on_hand is null or v_qty_on_hand < p_qty then
    raise exception 'issue_stock: insufficient stock on hand' using errcode = '22023';
  end if;

  -- Moving-average cost at issue (the cost basis). Decrement on-hand by qty and
  -- by qty*avg; fully depleting forces value to 0 so rounding dust never lingers.
  v_avg := round(v_value / v_qty_on_hand, 2);
  v_decrement := p_qty * v_avg;
  -- Sell price snapshot (transfer price): the item's rate, else the cost (unpriced
  -- sells at cost → zero store margin, never null).
  v_sell := coalesce(
    (select sell_rate from public.item_sell_rates where catalog_item_id = p_catalog_item_id),
    v_avg);
  update public.stock_on_hand
     set qty_on_hand = v_qty_on_hand - p_qty,
         total_value = case when v_qty_on_hand - p_qty = 0 then 0 else v_value - v_decrement end,
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  insert into public.stock_issues
    (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price, note,
     receiver_worker_id)
  values
    (p_project_id, p_catalog_item_id, p_work_package_id, p_qty, v_unit, v_avg, v_sell, v_note,
     p_receiver_worker_id)
  returning id into v_id;

  return v_id;
end;
$function$;

-- divert_purchase_to_store
CREATE OR REPLACE FUNCTION public.divert_purchase_to_store(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role      public.user_role := public.current_user_role();
  v_project   uuid;
  v_wp        uuid;
  v_item      uuid;
  v_status    text;
  v_qty       numeric;
  v_amount    numeric;
  v_rate      numeric;
  v_net_total numeric(14, 2);
  v_supplier  uuid;
  v_requester uuid;
  v_actor     uuid;
  v_unit      text;
  v_unit_cost numeric(12, 2);
  v_old       uuid;
  v_id        uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'divert_purchase_to_store: role not permitted' using errcode = '42501';
  end if;

  select pr.project_id, pr.work_package_id, pr.catalog_item_id, pr.status::text,
         pr.quantity, pr.amount, coalesce(pr.vat_rate, 0), pr.supplier_id, pr.requested_by
    into v_project, v_wp, v_item, v_status, v_qty, v_amount, v_rate, v_supplier, v_requester
    from public.purchase_requests pr where pr.id = p_request_id;
  if v_project is null then
    raise exception 'divert_purchase_to_store: unknown purchase request' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'divert_purchase_to_store: not a project member' using errcode = '42501';
  end if;
  if v_status <> 'delivered' then
    raise exception 'divert_purchase_to_store: purchase is not delivered' using errcode = '22023';
  end if;
  if v_wp is null then
    raise exception 'divert_purchase_to_store: purchase is not work-package-bound' using errcode = '22023';
  end if;
  if v_item is null then
    raise exception 'divert_purchase_to_store: purchase has no catalog item' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_receipts sr where sr.purchase_request_id = p_request_id) then
    raise exception 'divert_purchase_to_store: already diverted into the store' using errcode = '22023';
  end if;

  select c.unit into v_unit from public.catalog_items c where c.id = v_item;
  if v_unit is null then
    raise exception 'divert_purchase_to_store: unknown or inactive catalog item' using errcode = '22023';
  end if;

  v_actor := coalesce(auth.uid(), v_requester);

  -- 1. Reverse the WP-bound purchase's posted GL entry, if it has posted (this
  --    undoes Dr 1400 net + Dr 1300 Input VAT + Cr 2100 gross). The cost — and the
  --    Input VAT — leave the WP entry; the receipt re-books both (step 3).
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'purchase_requests'
     and e.source_id    = p_request_id
     and e.source_event = 'purchase'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'spec 198 U2: diverted to store');
  end if;

  -- 2. Skip any still-pending/posting purchase job so it can't post WP-WIP after
  --    the divert.
  update public.gl_posting_outbox
     set status = 'skipped'
   where source_table = 'purchase_requests'
     and source_id    = p_request_id
     and source_event = 'purchase'
     and status in ('pending', 'posting');

  -- 3. Receive into the store at NET cost (ex-VAT) + snapshot vat_rate, so the
  --    receipt poster splits Dr 1500 net / Dr 1300 Input VAT / Cr 2100 gross
  --    (U4b). With no VAT, net == gross — the prior all-in behaviour.
  if v_rate > 0 then
    v_net_total := round(coalesce(v_amount, 0) / (1 + v_rate / 100), 2);
  else
    v_net_total := coalesce(v_amount, 0);
  end if;
  v_unit_cost := round(v_net_total / nullif(v_qty, 0), 2);
  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note,
     created_by, purchase_request_id, vat_rate)
  values
    (v_project, v_item, v_qty, v_unit, coalesce(v_unit_cost, 0), v_supplier,
     'ย้ายเข้าคลังจากงาน', auth.uid(), p_request_id, v_rate)
  returning id into v_id;

  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (v_project, v_item, v_qty, v_qty * coalesce(v_unit_cost, 0))
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  -- 4. The PR becomes store-bound — it joins the WP-less population.
  update public.purchase_requests set work_package_id = null where id = p_request_id;

  return v_id;
end;
$function$;

-- issue_stock_bulk
CREATE OR REPLACE FUNCTION public.issue_stock_bulk(p_project_id uuid, p_work_package_id uuid, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_line        jsonb;
  v_item        uuid;
  v_qty         numeric;
  v_receiver    uuid;
  v_note        text;
  v_unit        text;
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_sell        numeric;
  v_decrement   numeric;
  v_count       int := 0;
begin
  -- Role: SITE_STAFF_ROLES (issue is a member-only OUT; plain procurement is excluded (procurement_manager is admitted via SA parity, spec 348 U3)).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'issue_stock_bulk: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'issue_stock_bulk: not a project member' using errcode = '42501';
  end if;
  -- The WP must belong to this project (slip level — one slip, one WP).
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'issue_stock_bulk: work package not in this project' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'issue_stock_bulk: lines must be a non-empty json array' using errcode = '22023';
  end if;

  -- Atomic: validate + issue every line; any failure rolls back the whole call.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item     := (v_line ->> 'catalog_item_id')::uuid;
    v_qty      := (v_line ->> 'qty')::numeric;
    v_receiver := nullif(v_line ->> 'receiver_worker_id', '')::uuid;
    v_note     := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'issue_stock_bulk: qty must be > 0' using errcode = '22023';
    end if;
    -- Catalog item must exist and be active; snapshot its unit.
    select c.unit into v_unit
      from public.catalog_items c
     where c.id = v_item and c.is_active;
    if v_unit is null then
      raise exception 'issue_stock_bulk: unknown or inactive catalog item' using errcode = '22023';
    end if;
    -- A named receiver must be an ACTIVE worker on this project (or unassigned).
    if v_receiver is not null and not exists (
      select 1 from public.workers w
       where w.id = v_receiver and w.active
         and (w.project_id = p_project_id or w.project_id is null)
    ) then
      raise exception 'issue_stock_bulk: receiver is not an active worker on this project'
        using errcode = '22023';
    end if;

    -- Lock the on-hand row and check sufficiency (per line; interleaving safe).
    select qty_on_hand, total_value into v_qty_on_hand, v_value
      from public.stock_on_hand
     where project_id = p_project_id and catalog_item_id = v_item
     for update;
    if v_qty_on_hand is null or v_qty_on_hand < v_qty then
      raise exception 'issue_stock_bulk: insufficient stock on hand' using errcode = '22023';
    end if;

    -- Moving-average cost at issue; decrement qty + value; zero value on depletion
    -- so rounding dust never lingers (mirrors issue_stock exactly).
    v_avg := round(v_value / v_qty_on_hand, 2);
    v_decrement := v_qty * v_avg;
    v_sell := coalesce(
      (select sell_rate from public.item_sell_rates where catalog_item_id = v_item),
      v_avg);
    update public.stock_on_hand
       set qty_on_hand = v_qty_on_hand - v_qty,
           total_value = case when v_qty_on_hand - v_qty = 0 then 0 else v_value - v_decrement end,
           updated_at  = now()
     where project_id = p_project_id and catalog_item_id = v_item;

    insert into public.stock_issues
      (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price, note,
       receiver_worker_id)
    values
      (p_project_id, v_item, p_work_package_id, v_qty, v_unit, v_avg, v_sell, v_note, v_receiver);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- resubmit_work_package_evidence
CREATE OR REPLACE FUNCTION public.resubmit_work_package_evidence(p_wp uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_uid         uuid             := auth.uid();
  v_wp          record;
  v_decision_id uuid;
  v_decision    public.approval_decision;
  v_decided_at  timestamptz;
  v_decided_by  uuid;
begin
  if not coalesce(v_role = any (array['site_admin', 'project_manager',
                                      'super_admin', 'project_director', 'procurement_manager']::public.user_role[]), false) then
    raise exception 'resubmit_work_package_evidence: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'resubmit_work_package_evidence: not a member of this project'
      using errcode = '42501';
  end if;

  -- FOR UPDATE serialises a double-tap of ส่งตรวจอีกครั้ง (flaky mobile
  -- connection, action retry) so the idempotency guard below cannot be raced.
  select id, code, name, project_id, status into v_wp
    from public.work_packages where id = p_wp for update;
  if not found then
    raise exception 'resubmit_work_package_evidence: work package not found' using errcode = '22023';
  end if;
  if v_wp.status <> 'pending_approval' then
    raise exception 'resubmit_work_package_evidence: work package is not pending approval'
      using errcode = '22023';
  end if;

  -- The decision being answered = the LATEST one on this WP. Anything other than
  -- needs_revision means there is no outstanding re-shoot request.
  select id, decision, decided_at, decided_by
    into v_decision_id, v_decision, v_decided_at, v_decided_by
    from public.approvals
   where work_package_id = p_wp
   order by decided_at desc, id desc
   limit 1;
  if not found or v_decision <> 'needs_revision' then
    raise exception 'resubmit_work_package_evidence: no revision request to answer'
      using errcode = '22023';
  end if;

  -- Idempotency: one resubmit per decision. Without this a retry enqueues a
  -- second ping for the same round and the decider is told twice.
  if exists (
    select 1 from public.audit_log a
     where a.target_table = 'work_packages'
       and a.target_id = p_wp
       and a.payload->>'event' = 'wp_evidence_resubmitted'
       and a.payload->>'answers_decision_id' = v_decision_id::text
  ) then
    raise exception 'resubmit_work_package_evidence: this revision request was already answered'
      using errcode = '22023';
  end if;

  -- The gate (spec 337 F2): at least one CURRENT completion photo shot AFTER the
  -- decision. Current-state read is the supersede anti-join + tombstone check
  -- (ADR 0009/0015) — a removed photo never satisfies the gate.
  if not exists (
    select 1 from public.photo_logs pl
     where pl.work_package_id = p_wp
       and pl.phase in ('after', 'after_fix')
       and pl.storage_path is not null
       and pl.created_at > v_decided_at
       and not exists (select 1 from public.photo_logs n where n.superseded_by = pl.id)
  ) then
    raise exception 'resubmit_work_package_evidence: no new photo since the revision request'
      using errcode = '22023';
  end if;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'work_packages', p_wp,
    jsonb_build_object(
      'event', 'wp_evidence_resubmitted',
      'answers_decision_id', v_decision_id,
      'decided_by', v_decided_by
    )
  );

  -- Ping the DECIDER, not the approval pool — they wrote the free-text ask, so
  -- they are the one who can tell whether it was answered. Deliberately NOT
  -- wrapped in an exception handler (unlike the notify_* triggers): the ping is
  -- the whole point of the call, so a failed enqueue must fail the resubmit and
  -- let the SA retry rather than silently close the loop with nobody told.
  insert into public.notification_outbox (event_type, work_package_id, payload)
  values (
    'wp_evidence_resubmitted', p_wp,
    jsonb_build_object(
      'code', v_wp.code,
      'name', v_wp.name,
      'project_id', v_wp.project_id,
      'decided_by', v_decided_by,
      'resubmitted_by', v_uid
    )
  );

  return true;
end;
$function$;

-- return_stock_to_store
CREATE OR REPLACE FUNCTION public.return_stock_to_store(p_issue_id uuid, p_qty numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role       public.user_role := public.current_user_role();
  v_project    uuid;
  v_item       uuid;
  v_wp         uuid;
  v_unit       text;
  v_issue_qty  numeric;
  v_unit_cost  numeric(12, 2);
  v_returned   numeric;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_id         uuid;
begin
  -- Role: SITE_STAFF tier (a return is the same physical-custody action as เบิก;
  -- plain procurement is excluded (procurement_manager is admitted via SA parity, spec 348 U3), mirroring issue_stock).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'return_stock_to_store: role not permitted' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'return_stock_to_store: qty must be positive' using errcode = '22023';
  end if;

  select si.project_id, si.catalog_item_id, si.work_package_id, si.unit, si.qty, si.unit_cost
    into v_project, v_item, v_wp, v_unit, v_issue_qty, v_unit_cost
    from public.stock_issues si where si.id = p_issue_id;
  if v_project is null then
    raise exception 'return_stock_to_store: unknown issue' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'return_stock_to_store: not a project member' using errcode = '42501';
  end if;

  -- A reversed (voided) issue never charged the WP — there is nothing to return;
  -- correct it via the mistake-undo instead.
  if exists (select 1 from public.stock_reversals r where r.issue_id = p_issue_id) then
    raise exception 'return_stock_to_store: issue was reversed' using errcode = '22023';
  end if;

  -- Cannot return more than was issued (net of prior returns).
  select coalesce(sum(r.qty), 0) into v_returned
    from public.stock_returns r where r.issue_id = p_issue_id;
  if p_qty > v_issue_qty - v_returned then
    raise exception 'return_stock_to_store: cannot return more than was issued' using errcode = '22023';
  end if;

  insert into public.stock_returns
    (project_id, catalog_item_id, issue_id, work_package_id, qty, unit, unit_cost, note, returned_by)
  values
    (v_project, v_item, p_issue_id, v_wp, p_qty, v_unit, v_unit_cost, v_note, auth.uid())
  returning id into v_id;

  -- Re-enter the store at the issue cost (the insert's enqueue trigger books
  -- Dr 1500 / Cr 1400 on drain).
  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (v_project, v_item, p_qty, p_qty * v_unit_cost)
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  return v_id;
end;
$function$;

-- site_purchase_use_now
CREATE OR REPLACE FUNCTION public.site_purchase_use_now(p_project_id uuid, p_work_package_id uuid, p_catalog_item_id uuid, p_qty numeric, p_unit_cost numeric, p_note text DEFAULT NULL::text, p_vat_rate numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_unit        text;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_rate        numeric := coalesce(p_vat_rate, 0);
  v_net_total   numeric(14, 2);
  v_unit_net    numeric(12, 2);
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_decrement   numeric;
  v_sell        numeric;
  v_issue_id    uuid;
begin
  -- Role + membership (issue_stock's gate; procurement excluded).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'site_purchase_use_now: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'site_purchase_use_now: not a project member' using errcode = '42501';
  end if;
  -- The WP must belong to this project.
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'site_purchase_use_now: work package not in this project' using errcode = '22023';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'site_purchase_use_now: qty must be > 0' using errcode = '22023';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'site_purchase_use_now: unit_cost must be >= 0' using errcode = '22023';
  end if;
  if v_rate < 0 then
    raise exception 'site_purchase_use_now: vat_rate must be >= 0' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'site_purchase_use_now: unknown or inactive catalog item' using errcode = '22023';
  end if;

  -- Inventory carries the NET (ex-VAT) cost; reclaimable Input VAT is split to 1300
  -- by the receipt poster. p_unit_cost is the GROSS paid; with no VAT, net == gross
  -- (the prior all-in behaviour). Net derived at the TOTAL then back to a unit cost
  -- (mirrors purchase_requests_stock_in_on_receive's rounding, spec 208 U4b).
  if v_rate > 0 then
    v_net_total := round((p_qty * p_unit_cost) / (1 + v_rate / 100), 2);
  else
    v_net_total := p_qty * p_unit_cost;
  end if;
  v_unit_net := round(v_net_total / nullif(p_qty, 0), 2);

  -- 1) RECEIVE into the store at NET cost + snapshot vat_rate (the GL trigger books
  --    Dr 1500 net / Dr 1300 Input VAT when rate>0 / Cr 2100 gross).
  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note, vat_rate)
  values
    (p_project_id, p_catalog_item_id, p_qty, v_unit, coalesce(v_unit_net, 0), null,
     coalesce(v_note, 'ซื้อใช้หน้างาน'), v_rate);

  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (p_project_id, p_catalog_item_id, p_qty, p_qty * coalesce(v_unit_net, 0))
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  -- 2) ISSUE to the WP at moving-average cost (the GL trigger books Dr 1400 / Cr
  --    1500). Lock the on-hand row we just rolled; sufficiency is guaranteed (we
  --    added p_qty), but keep the same lock/compute path as issue_stock.
  select qty_on_hand, total_value into v_qty_on_hand, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  v_avg := round(v_value / v_qty_on_hand, 2);
  v_decrement := p_qty * v_avg;
  v_sell := coalesce(
    (select sell_rate from public.item_sell_rates where catalog_item_id = p_catalog_item_id),
    v_avg);
  update public.stock_on_hand
     set qty_on_hand = v_qty_on_hand - p_qty,
         total_value = case when v_qty_on_hand - p_qty = 0 then 0 else v_value - v_decrement end,
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  insert into public.stock_issues
    (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price, note,
     receiver_worker_id)
  values
    (p_project_id, p_catalog_item_id, p_work_package_id, p_qty, v_unit, v_avg, v_sell,
     coalesce(v_note, 'ซื้อใช้หน้างาน'), null)
  returning id into v_issue_id;

  return v_issue_id;
end;
$function$;

-- record_stock_count
CREATE OR REPLACE FUNCTION public.record_stock_count(p_project_id uuid, p_catalog_item_id uuid, p_counted_qty numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_unit        text;
  v_system_qty  numeric;
  v_value       numeric;
  v_avg         numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES — site_admin keeps the physical store + the PM tier.
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'record_stock_count: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'record_stock_count: not a project member' using errcode = '42501';
  end if;

  if p_counted_qty is null or p_counted_qty < 0 then
    raise exception 'record_stock_count: counted qty must be >= 0' using errcode = '22023';
  end if;

  -- Lock the on-hand row; counting is limited to items the store tracks.
  select qty_on_hand, total_value into v_system_qty, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  if v_system_qty is null then
    raise exception 'record_stock_count: item is not stocked in this store' using errcode = '22023';
  end if;

  -- Unit snapshot (the item may be deactivated but still physically on hand).
  select c.unit into v_unit from public.catalog_items c where c.id = p_catalog_item_id;

  -- Moving-average unit cost stays the count's valuation basis.
  v_avg := case when v_system_qty > 0 then round(v_value / v_system_qty, 2) else 0 end;

  insert into public.stock_counts
    (project_id, catalog_item_id, system_qty, counted_qty, unit, unit_cost, note)
  values
    (p_project_id, p_catalog_item_id, v_system_qty, p_counted_qty, v_unit, v_avg, v_note)
  returning id into v_id;

  -- Reconcile on-hand to the counted truth, valued at the (unchanged) avg cost.
  update public.stock_on_hand
     set qty_on_hand = p_counted_qty,
         total_value = round(p_counted_qty * v_avg, 2),
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  return v_id;
end;
$function$;

-- reverse_stock_issue
CREATE OR REPLACE FUNCTION public.reverse_stock_issue(p_issue_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_project     uuid;
  v_item        uuid;
  v_qty         numeric;
  v_total_cost  numeric;
  v_on_hand     numeric;
  v_value       numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES (who records เบิก).
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager') then
    raise exception 'reverse_stock_issue: role not permitted' using errcode = '42501';
  end if;

  select project_id, catalog_item_id, qty, total_cost
    into v_project, v_item, v_qty, v_total_cost
    from public.stock_issues where id = p_issue_id;
  if v_project is null then
    raise exception 'reverse_stock_issue: unknown issue' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'reverse_stock_issue: not a project member' using errcode = '42501';
  end if;

  select qty_on_hand, total_value into v_on_hand, v_value
    from public.stock_on_hand
   where project_id = v_project and catalog_item_id = v_item
   for update;
  if v_on_hand is null then
    raise exception 'reverse_stock_issue: no on-hand row for this item' using errcode = '22023';
  end if;

  -- Record the reversal first (unique index blocks a double reversal → 23505).
  insert into public.stock_reversals (project_id, catalog_item_id, issue_id, qty, value_delta, note)
  values (v_project, v_item, p_issue_id, v_qty, v_total_cost, v_note)
  returning id into v_id;

  -- Add the issued qty/value back to on-hand.
  update public.stock_on_hand
     set qty_on_hand = v_on_hand + v_qty,
         total_value = v_value + v_total_cost,
         updated_at  = now()
   where project_id = v_project and catalog_item_id = v_item;

  return v_id;
end;
$function$;

-- reopen_work_package_for_defect
CREATE OR REPLACE FUNCTION public.reopen_work_package_for_defect(p_wp uuid, p_reason text, p_source rework_source DEFAULT 'internal'::rework_source)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.work_package_status;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_uid    uuid := auth.uid();
  v_role   public.user_role := public.current_user_role();
  v_round  smallint;
begin
  -- U3: auditor added.
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'auditor', 'procurement_manager') then
    raise exception 'reopen_work_package_for_defect: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'reopen_work_package_for_defect: not a member of this project'
      using errcode = '42501';
  end if;
  -- U3 (D2/D5): client defects are a PM-tier act — auditor and site_admin
  -- file internal only.
  if p_source = 'client' and v_role in ('site_admin', 'auditor', 'procurement_manager') then
    raise exception 'reopen_work_package_for_defect: only PM tier may file a client defect'
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
$function$;

-- sa_add_project_worker
CREATE OR REPLACE FUNCTION public.sa_add_project_worker(p_project uuid, p_name text, p_national_id text, p_dob date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_yy     int  := (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int;
  v_seq    int;
  v_emp    text;
  v_worker uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'sa_add_project_worker: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'sa_add_project_worker: not a member of this project' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'sa_add_project_worker: name required' using errcode = 'P0001';
  end if;
  if not public.is_valid_thai_national_id(p_national_id) then
    raise exception 'sa_add_project_worker: invalid Thai national-ID' using errcode = 'P0001';
  end if;
  if p_dob is null or p_dob > (((now() at time zone 'Asia/Bangkok')::date) - interval '18 years') then
    raise exception 'sa_add_project_worker: worker must be at least 18' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workers w where w.tax_id = p_national_id) then
    raise exception 'sa_add_project_worker: this national-ID is already on a worker' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.crew_registrations r where r.national_id = p_national_id and r.status = 'pending') then
    raise exception 'sa_add_project_worker: this national-ID is already a pending registration' using errcode = 'P0001';
  end if;

  insert into public.employee_id_counters (year, next_val) values (v_yy, 2)
  on conflict (year) do update set next_val = public.employee_id_counters.next_val + 1
  returning next_val - 1 into v_seq;
  v_emp := 'PRC-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');

  -- Active + project-bound + phoneless (no user_id). SA sets NO money: day_rate 0,
  -- level null, cost_confirmed_at null → excluded from cost/pay until a PM confirms.
  -- employment_type defaults to a daily 'temporary' hand (a PM may reclassify).
  insert into public.workers (name, pay_type, employment_type, user_id, employee_id, day_rate,
                              active, created_by, project_id, tax_id, date_of_birth)
  values (v_name, 'daily', 'temporary', null, v_emp, 0,
          true, auth.uid(), p_project, p_national_id, p_dob)
  returning id into v_worker;

  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (v_worker, p_project, auth.uid(), 'sa direct add');

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', v_worker,
          jsonb_build_object('kind', 'create', 'source', 'sa_add', 'project_id', p_project,
                             'employee_id', v_emp));
  return v_worker;
end;
$function$;

-- daily_work_plan_assert_writer
CREATE OR REPLACE FUNCTION public.daily_work_plan_assert_writer(p_project uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  if not coalesce(v_role in
      ('site_admin', 'project_manager', 'project_director', 'super_admin', 'site_owner', 'procurement_manager'),
      false) then
    raise exception 'daily work plan: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'daily work plan: not a member of this project' using errcode = '42501';
  end if;
end;
$function$;

-- is_site_staff
CREATE OR REPLACE FUNCTION public.is_site_staff(p_role user_role)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(p_role in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement_manager'), false)
$function$;

-- sa_worker_bank_status
CREATE OR REPLACE FUNCTION public.sa_worker_bank_status(p_project uuid)
 RETURNS TABLE(worker_id uuid, status worker_bank_capture_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role not in ('site_admin','super_admin', 'procurement_manager') then
    raise exception 'sa_worker_bank_status: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'sa_worker_bank_status: not a member of this project' using errcode = '42501';
  end if;
  return query
    select c.worker_id, c.status
    from public.worker_bank_capture c
    join public.workers w on w.id = c.worker_id
    where w.project_id = p_project;
end; $function$;

-- ============================================================================
-- Non-SELECT RLS policies naming site_admin → add procurement_manager.
-- drop+create = REWRITE; each reproduces its exact live shape (initplan wrapper
-- style preserved: wrapped where the original wrapped current_user_role() in a
-- SELECT, bare where it was bare) with 'procurement_manager' added to the array.
-- ============================================================================

-- photo_logs INSERT (roles = public — preserved).
drop policy if exists "photo_logs insert by sa/pm/super" on public.photo_logs;
create policy "photo_logs insert by sa/pm/super" on public.photo_logs
  for insert to public
  with check (
    (select public.current_user_role()) = any (array[
      'site_admin'::public.user_role, 'project_manager'::public.user_role,
      'super_admin'::public.user_role, 'project_director'::public.user_role,
      'procurement_manager'::public.user_role
    ])
    and (select public.can_see_wp(photo_logs.work_package_id))
    and uploaded_by = (select auth.uid())
    and ((superseded_by is null) or public.photo_removal_allowed(work_package_id, superseded_by))
  );

-- photo_markups INSERT (roles = authenticated).
drop policy if exists "photo_markups insert content or own tombstone" on public.photo_markups;
create policy "photo_markups insert content or own tombstone" on public.photo_markups
  for insert to authenticated
  with check (
    (select public.current_user_role()) = any (array[
      'site_admin'::public.user_role, 'project_manager'::public.user_role,
      'super_admin'::public.user_role, 'project_director'::public.user_role,
      'procurement_manager'::public.user_role
    ])
    and (created_by = (select auth.uid()))
    and (exists (select 1 from public.photo_logs pl where pl.id = photo_markups.photo_log_id))
    and ((superseded_by is null)
         or (select public.photo_markup_tombstone_target_ok(photo_markups.superseded_by, photo_markups.photo_log_id)))
    and (select public.can_see_photo_log(photo_markups.photo_log_id))
  );

-- storage.objects: photos bucket upload (bare current_user_role, as live).
drop policy if exists "photos uploads by sa/pm/super" on storage.objects;
create policy "photos uploads by sa/pm/super" on storage.objects
  for insert to authenticated
  with check (
    (bucket_id = 'photos'::text)
    and (public.current_user_role() = any (array[
      'site_admin'::public.user_role, 'project_manager'::public.user_role,
      'super_admin'::public.user_role, 'project_director'::public.user_role,
      'procurement_manager'::public.user_role
    ]))
  );

-- storage.objects: PO attachment upload (wrapped current_user_role, as live;
-- admits site_admin + plain procurement — add procurement_manager for parity).
drop policy if exists "po attachment uploads by back office" on storage.objects;
create policy "po attachment uploads by back office" on storage.objects
  for insert to authenticated
  with check (
    (bucket_id = 'po-attachments'::text)
    and ((select public.current_user_role()) = any (array[
      'site_admin'::public.user_role, 'project_manager'::public.user_role,
      'procurement'::public.user_role, 'super_admin'::public.user_role,
      'procurement_manager'::public.user_role
    ]))
    and (array_length(storage.foldername(name), 1) = 1)
    and (exists (select 1 from public.purchase_orders po
                  where (po.id)::text = (storage.foldername(objects.name))[1]))
  );

-- storage.objects: SA bank-capture upload (bare current_user_role, as live).
drop policy if exists "sa bank-capture uploads by site_admin" on storage.objects;
create policy "sa bank-capture uploads by site_admin" on storage.objects
  for insert to authenticated
  with check (
    (bucket_id = 'contact-docs'::text)
    and ((storage.foldername(name))[1] = 'sa-bank-capture'::text)
    and (public.current_user_role() = any (array[
      'site_admin'::public.user_role, 'super_admin'::public.user_role,
      'procurement_manager'::public.user_role
    ]))
  );
