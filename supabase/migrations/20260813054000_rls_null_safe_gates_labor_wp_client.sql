-- rls-audit-2026-07 Pass B / M-B4 labor / WP / client-invite / PII / feedback — null-safe SECURITY DEFINER role gates (F1).
-- log/correct labor, reopen/delete WP, WP contractor+hold, claim client/contractor/worker invite, grant_client_access target-role, contact-doc + consent staff checks, mark_feedback_viewed (15 fns).
-- Each body is VERBATIM from LIVE (pg_get_functiondef, 2026-07-02) with ONE
-- mechanical edit per gate: a NULL role now fails the gate closed instead of
-- falling through (bare `not in` / `v_role not in` / `<>` / `= any` /
-- `v_is_staff := role in` forms all get an `is null`/`coalesce(...,false)`
-- guard). Real roles behave identically. All CREATE OR REPLACE (no signature
-- change) → grants preserved, no db:types drift, no pin churn.

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
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'log_labor_day: role not permitted' using errcode = '42501';
  end if;
  if p_fraction is null then
    raise exception 'log_labor_day: day fraction required' using errcode = 'P0001';
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
     day_rate_snapshot, worker_name_snapshot, worker_type_snapshot,
     contractor_id_snapshot, entered_by, self_logged, note)
  values
    (p_wp, p_worker, p_date, p_fraction,
     v_worker.day_rate, v_worker.name, v_worker.worker_type,
     v_worker.contractor_id, auth.uid(),
     v_worker.user_id is not distinct from auth.uid()
       and v_worker.user_id is not null,
     nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

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
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
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
     day_rate_snapshot, worker_name_snapshot, worker_type_snapshot,
     contractor_id_snapshot, entered_by, self_logged,
     superseded_by, correction_reason, note)
  values
    (v_orig.work_package_id, v_orig.worker_id, v_orig.work_date,
     case when p_tombstone then null else p_fraction end,
     v_orig.day_rate_snapshot, v_orig.worker_name_snapshot,
     v_orig.worker_type_snapshot, v_orig.contractor_id_snapshot,
     auth.uid(),
     v_worker_user is not distinct from auth.uid() and v_worker_user is not null,
     p_log, v_reason,
     -- Note carries forward unless edited; a tombstone removal clears it.
     case
       when p_tombstone then null
       when p_note is null then v_orig.note
       else nullif(btrim(p_note), '')
     end)
  returning id into v_id;
  return v_id;
end;
$function$;

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
  if v_role is null or v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_work_package(p_work_package_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if exists (select 1 from public.photo_logs where work_package_id = p_work_package_id)
     or exists (select 1 from public.labor_logs where work_package_id = p_work_package_id)
     or exists (select 1 from public.approvals where work_package_id = p_work_package_id)
     or exists (select 1 from public.purchase_requests where work_package_id = p_work_package_id)
     or exists (select 1 from public.work_package_members where work_package_id = p_work_package_id)
     or exists (select 1 from public.work_package_dependencies
                 where predecessor_id = p_work_package_id or successor_id = p_work_package_id)
  then
    raise exception 'delete_work_package: work package has history (photos/labor/requests/members/dependencies) — cancel it instead'
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

CREATE OR REPLACE FUNCTION public.delete_deliverable(p_deliverable_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role := public.current_user_role();
  v_project uuid;
  v_code    text;
  v_name    text;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'delete_deliverable: role not permitted' using errcode = '42501';
  end if;

  select project_id, code, name into v_project, v_code, v_name
    from public.deliverables where id = p_deliverable_id;
  if v_project is null then
    return false;
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'delete_deliverable: not a member of this project' using errcode = '42501';
  end if;

  if exists (select 1 from public.work_packages where deliverable_id = p_deliverable_id) then
    raise exception 'delete_deliverable: deliverable still has work packages — remove them first'
      using errcode = 'P0001';
  end if;

  delete from public.deliverables where id = p_deliverable_id;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'deliverables', p_deliverable_id,
    jsonb_build_object('event', 'deliverable_deleted', 'code', v_code, 'name', v_name)
  );

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_work_package_contractor(p_work_package_id uuid, p_contractor_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_user_role() is null
     or public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'set_work_package_contractor: role not permitted'
      using errcode = '42501';
  end if;

  if p_contractor_id is not null
     and not exists (select 1 from public.contractors c where c.id = p_contractor_id) then
    return false;
  end if;

  update public.work_packages
     set contractor_id = p_contractor_id
   where id = p_work_package_id;
  return found;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_work_package_hold(p_wp uuid, p_hold boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status     public.work_package_status;
  v_has_during boolean;
  v_new        public.work_package_status;
begin
  if not coalesce(public.current_user_role() = any (array['project_manager', 'super_admin', 'project_director']::public.user_role[]), false) then
    raise exception 'set_work_package_hold: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'set_work_package_hold: not a member of this project' using errcode = '42501';
  end if;

  select status into v_status from public.work_packages where id = p_wp;
  if not found then
    raise exception 'set_work_package_hold: work package not found' using errcode = 'P0001';
  end if;

  if p_hold then
    if v_status not in ('not_started', 'in_progress') then
      raise exception 'set_work_package_hold: cannot hold from status %', v_status using errcode = 'P0001';
    end if;
    update public.work_packages set status = 'on_hold'
      where id = p_wp and status in ('not_started', 'in_progress');
    v_new := 'on_hold';
  else
    if v_status <> 'on_hold' then
      raise exception 'set_work_package_hold: work package is not on hold' using errcode = 'P0001';
    end if;
    select exists (
      select 1 from public.photo_logs pl
      where pl.work_package_id = p_wp
        and pl.phase = 'during'
        and pl.storage_path is not null
        and not exists (select 1 from public.photo_logs n where n.superseded_by = pl.id)
    ) into v_has_during;
    v_new := case when v_has_during then 'in_progress' else 'not_started' end;
    update public.work_packages set status = v_new
      where id = p_wp and status = 'on_hold';
  end if;

  return v_new::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_client_invite(p_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite      public.client_invites%rowtype;
  v_role        public.user_role;
  v_was_visitor boolean;
  v_access_id   uuid;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null then
    raise exception 'claim_client_invite: no user' using errcode = 'P0001';
  end if;
  if v_role is null or v_role not in ('visitor', 'client') then
    raise exception 'claim_client_invite: only a visitor or client may claim' using errcode = '42501';
  end if;
  v_was_visitor := (v_role = 'visitor');

  select * into v_invite from public.client_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then
    raise exception 'claim_client_invite: invalid token' using errcode = 'P0001';
  end if;
  if v_invite.claimed_by is not null then
    raise exception 'claim_client_invite: token already used' using errcode = 'P0001';
  end if;
  if v_invite.created_at < now() - interval '14 days' then
    raise exception 'claim_client_invite: token expired' using errcode = 'P0001';
  end if;

  insert into public.client_portal_access (user_id, project_id, granted_by, expires_at)
  values (auth.uid(), v_invite.project_id, v_invite.created_by, v_invite.access_expires_at)
  on conflict (user_id, project_id) do update
    set expires_at = excluded.expires_at,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = null,
        revoked_by = null
  returning id into v_access_id;

  if v_was_visitor then
    update public.users set role = 'client' where id = auth.uid();
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('role_change', auth.uid(), 'client', 'users', auth.uid(),
            jsonb_build_object('from', 'visitor', 'to', 'client',
                               'project_id', v_invite.project_id, 'via', 'client_invite'));
  else
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('other', auth.uid(), 'client', 'client_portal_access', v_access_id,
            jsonb_build_object('event', 'client_access_granted',
                               'project_id', v_invite.project_id, 'via', 'client_invite'));
  end if;

  update public.client_invites set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_contractor_invite(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite public.contractor_invites%rowtype;
  v_role   public.user_role;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null then
    raise exception 'claim_contractor_invite: no user' using errcode = 'P0001';
  end if;
  if v_role is null or v_role <> 'visitor' then
    raise exception 'claim_contractor_invite: only a visitor may claim' using errcode = '42501';
  end if;
  if exists (select 1 from public.contractor_users where user_id = auth.uid()) then
    raise exception 'claim_contractor_invite: already bound' using errcode = 'P0001';
  end if;

  select * into v_invite from public.contractor_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then
    raise exception 'claim_contractor_invite: invalid token' using errcode = 'P0001';
  end if;
  if v_invite.claimed_by is not null then
    raise exception 'claim_contractor_invite: token already used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'claim_contractor_invite: token expired' using errcode = 'P0001';
  end if;

  insert into public.contractor_users (user_id, contractor_id)
  values (auth.uid(), v_invite.contractor_id);

  update public.users set role = 'contractor' where id = auth.uid();

  update public.contractor_invites
     set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('role_change', auth.uid(), 'contractor', 'users', auth.uid(),
          jsonb_build_object('from', 'visitor', 'to', 'contractor',
                             'contractor_id', v_invite.contractor_id,
                             'via', 'contractor_invite'));
  return v_invite.contractor_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_worker_invite(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite   public.worker_invites%rowtype;
  v_role     public.user_role;
  v_existing uuid;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null then
    raise exception 'claim_worker_invite: no user' using errcode = 'P0001';
  end if;
  if v_role is null or v_role <> 'visitor' then
    raise exception 'claim_worker_invite: only a visitor may claim' using errcode = '42501';
  end if;
  if exists (select 1 from public.workers where user_id = auth.uid())
     or exists (select 1 from public.contractor_users where user_id = auth.uid()) then
    raise exception 'claim_worker_invite: already bound' using errcode = 'P0001';
  end if;

  select * into v_invite from public.worker_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then
    raise exception 'claim_worker_invite: invalid token' using errcode = 'P0001';
  end if;
  if v_invite.claimed_by is not null then
    raise exception 'claim_worker_invite: token already used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'claim_worker_invite: token expired' using errcode = 'P0001';
  end if;

  select user_id into v_existing from public.workers where id = v_invite.worker_id;
  if v_existing is not null then
    raise exception 'claim_worker_invite: worker already linked' using errcode = 'P0001';
  end if;

  update public.workers set user_id = auth.uid() where id = v_invite.worker_id;
  update public.users set role = 'contractor' where id = auth.uid();
  update public.worker_invites
     set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('role_change', auth.uid(), 'contractor', 'users', auth.uid(),
          jsonb_build_object('from', 'visitor', 'to', 'contractor',
                             'worker_id', v_invite.worker_id, 'via', 'worker_invite'));
  return v_invite.worker_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_client_access(p_user_id uuid, p_project uuid, p_valid_until timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_access_id   uuid;
  v_target_role public.user_role;
  v_was_visitor boolean;
begin
  if not coalesce((select public.current_user_role()) in ('project_director', 'super_admin'), false) then
    raise exception 'grant_client_access: role not permitted' using errcode = '42501';
  end if;
  if p_valid_until is null then
    raise exception 'grant_client_access: valid-until required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'grant_client_access: project not found' using errcode = 'P0001';
  end if;

  select role into v_target_role from public.users where id = p_user_id;
  if v_target_role is null then
    raise exception 'grant_client_access: user not found' using errcode = 'P0001';
  end if;
  -- A PD/super may grant a visitor (flip → client) or an existing client. Staff
  -- and contractor are never converted (no demotion / no silent flip).
  if v_target_role is null or v_target_role not in ('visitor', 'client') then
    raise exception 'grant_client_access: target is not eligible (must be a visitor or client)'
      using errcode = 'P0001';
  end if;
  v_was_visitor := (v_target_role = 'visitor');

  insert into public.client_portal_access (user_id, project_id, granted_by, expires_at)
  values (p_user_id, p_project, auth.uid(), p_valid_until)
  on conflict (user_id, project_id) do update
    set expires_at = excluded.expires_at,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = null,
        revoked_by = null
  returning id into v_access_id;

  if v_was_visitor then
    update public.users set role = 'client' where id = p_user_id;
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('role_change', auth.uid(), (select public.current_user_role()), 'users', p_user_id,
            jsonb_build_object('from', 'visitor', 'to', 'client',
                               'project_id', p_project, 'via', 'manual_grant'));
  else
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('other', auth.uid(), (select public.current_user_role()), 'client_portal_access', v_access_id,
            jsonb_build_object('event', 'client_access_granted',
                               'user_id', p_user_id, 'project_id', p_project,
                               'access_expires_at', p_valid_until));
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_contact_document(p_contractor_id uuid DEFAULT NULL::uuid, p_supplier_id uuid DEFAULT NULL::uuid, p_service_provider_id uuid DEFAULT NULL::uuid, p_purpose contact_doc_purpose DEFAULT NULL::contact_doc_purpose, p_storage_path text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_targets int := (p_contractor_id is not null)::int
                 + (p_supplier_id is not null)::int
                 + (p_service_provider_id is not null)::int;
  v_path text := nullif(btrim(p_storage_path), '');
  v_self uuid := public.current_user_contractor_id();
  v_is_staff boolean := coalesce(public.current_user_role() in ('project_manager', 'super_admin', 'project_director'), false);
  v_is_self_doc boolean := coalesce(
    v_self is not null
    and p_contractor_id = v_self
    and p_supplier_id is null
    and p_service_provider_id is null,
    false);
  v_id uuid;
begin
  if not (v_is_staff or v_is_self_doc) then
    raise exception 'add_contact_document: not permitted' using errcode = '42501';
  end if;
  if v_targets <> 1 then
    raise exception 'add_contact_document: exactly one target required' using errcode = 'P0001';
  end if;
  if p_purpose is null then
    raise exception 'add_contact_document: purpose required' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'add_contact_document: storage_path required' using errcode = 'P0001';
  end if;

  insert into public.contact_attachments
    (contractor_id, supplier_id, service_provider_id, purpose, storage_path, uploaded_by)
  values
    (p_contractor_id, p_supplier_id, p_service_provider_id, p_purpose, v_path, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_contractor_consent(p_contractor uuid, p_kind contractor_consent_kind, p_document_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_is_self  boolean := coalesce(public.current_user_contractor_id() = p_contractor, false);
  v_is_staff boolean := coalesce(public.current_user_role() in ('site_admin', 'project_manager', 'super_admin', 'project_director'), false);
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

CREATE OR REPLACE FUNCTION public.revoke_contractor_consent(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req      public.contractor_consents%rowtype;
  v_is_self  boolean;
  v_is_staff boolean := coalesce(public.current_user_role()
    in ('project_manager', 'super_admin', 'project_director'), false);
begin
  select * into v_req from public.contractor_consents where id = p_id for update;
  if not found then
    raise exception 'revoke_contractor_consent: not found' using errcode = 'P0001';
  end if;
  v_is_self := coalesce(public.current_user_contractor_id() = v_req.contractor_id, false)
            or coalesce(public.current_user_worker_id() = v_req.worker_id, false);
  if not (v_is_self or v_is_staff) then
    raise exception 'revoke_contractor_consent: not permitted' using errcode = '42501';
  end if;
  update public.contractor_consents set revoked_at = now() where id = p_id and revoked_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_feedback_viewed(p_feedback_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'mark_feedback_viewed: not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.feedback where id = p_feedback_id) then
    raise exception 'mark_feedback_viewed: feedback not found' using errcode = '22023';
  end if;
  if not (
    exists (select 1 from public.feedback where id = p_feedback_id and submitted_by = v_uid)
    or coalesce((select public.current_user_role()) = 'super_admin', false)
  ) then
    raise exception 'mark_feedback_viewed: not your feedback' using errcode = '42501';
  end if;

  insert into public.feedback_views (feedback_id, user_id, last_viewed_at)
  values (p_feedback_id, v_uid, now())
  on conflict (feedback_id, user_id) do update set last_viewed_at = now();
end;
$function$;
