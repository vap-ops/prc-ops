-- Spec 277 P1a follow-up (ships with the SA UI, PR2). Two RPC refinements, both
-- additive create-or-replace (same signatures, no data change):
--
--   1. report_site_issue — give the OPTIONAL params SQL DEFAULT NULL, matching the
--      house pattern (record_site_purchase's p_amount DEFAULT NULL). The UI files a
--      project-level issue (no WP, often no note); without a default the generated
--      TS Args typed those as required non-null strings, so a project-level call
--      couldn't be expressed. Body is otherwise identical to 20260813075640.
--
--   2. add_site_issue_attachment — adopt the adversarial-review F1 hardening: bind the
--      stored storage_path to the issue's own folder (issue/<id>/…), mirroring the
--      owner-bound storage upload policy. Defense-in-depth: the row's recorded path
--      can no longer drift from where the bytes are allowed to live. (Not exploitable
--      before this — the upload policy already forbids writing outside the folder —
--      but the attachment rows are member-readable, so we align the two guards.)

-- ----------------------------------------------------------------------------
create or replace function public.report_site_issue(
  p_project_id      uuid,
  p_work_package_id uuid default null,
  p_issue_type      public.site_issue_type default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in
        ('site_admin', 'project_manager', 'super_admin', 'project_director') then
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
$$;
revoke all on function public.report_site_issue(uuid, uuid, public.site_issue_type, text)
  from public, anon;
grant execute on function public.report_site_issue(uuid, uuid, public.site_issue_type, text)
  to authenticated;

-- ----------------------------------------------------------------------------
create or replace function public.add_site_issue_attachment(p_site_issue_id uuid, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text := nullif(btrim(p_storage_path), '');
  v_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'add_site_issue_attachment: not signed in' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.site_issues s
    where s.id = p_site_issue_id and s.reported_by = auth.uid()
  ) then
    raise exception 'add_site_issue_attachment: not your issue' using errcode = '42501';
  end if;
  if v_path is null then
    raise exception 'add_site_issue_attachment: storage_path required' using errcode = '22023';
  end if;
  -- F1 hardening: the recorded path must sit under this issue's own folder (the
  -- shape the owner-bound storage upload policy enforces). Belt-and-suspenders.
  if v_path not like 'issue/' || p_site_issue_id::text || '/%' then
    raise exception 'add_site_issue_attachment: path must be under issue/<id>/'
      using errcode = '22023';
  end if;

  insert into public.site_issue_attachments (site_issue_id, storage_path, uploaded_by)
  values (p_site_issue_id, v_path, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_site_issue_attachment(uuid, text) from public, anon;
grant execute on function public.add_site_issue_attachment(uuid, text) to authenticated;
