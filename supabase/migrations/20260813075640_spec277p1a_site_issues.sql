-- Spec 277 P1a — site-issue log (แจ้งปัญหา). Closes feedback 3d66bb37 (#2130):
-- a site_admin asked where to upload photos + what info to record when work pauses
-- (machines breaking down, rain). This adds a LIGHT, project-scoped problem record —
-- a type + optional note + photos — reported from the SA home, plus a serious-type
-- PM alert (wired app-side in a later PR).
--
-- Shapes are cloned from the LIVE house patterns, not invented:
--   * report_site_issue / resolve_site_issue mirror record_site_purchase
--     (20260751 + F2 20260813075580): a null-safe role gate, then a membership gate
--     (can_see_project) placed AFTER the existence check so an unknown scope stays
--     P0001 and only a non-member gets 42501.
--   * site_issue_attachments + add_site_issue_attachment + the private bucket clone
--     feedback_attachments (20260813000200): append-only, owner-bound upload, reads
--     via service-role signed URLs.
--   * The member SELECT policy mirrors daily_work_plans (can_see_project).
-- All writes go through the DEFINER RPCs; authenticated gets SELECT only.

-- ----------------------------------------------------------------------------
-- Enums (CLAUDE.md: types/statuses are enums, never free-text).
-- ----------------------------------------------------------------------------
create type public.site_issue_type as enum
  ('weather', 'equipment', 'safety', 'access', 'other');
create type public.site_issue_status as enum
  ('open', 'resolved');

-- ----------------------------------------------------------------------------
-- site_issues — project-scoped, optional WP scope.
-- ----------------------------------------------------------------------------
create table public.site_issues (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id),
  work_package_id uuid references public.work_packages(id) on delete set null,
  issue_type      public.site_issue_type not null,
  status          public.site_issue_status not null default 'open',
  note            text,
  reported_by     uuid not null references public.users(id),
  resolved_by     uuid references public.users(id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint site_issues_note_shape
    check (note is null or length(btrim(note)) between 1 and 1000)
);
-- The "today's open issues" read filters by project + status, newest first.
create index site_issues_project_status_idx
  on public.site_issues (project_id, status, created_at desc);

alter table public.site_issues enable row level security;
revoke all on public.site_issues from anon, authenticated;
grant select on public.site_issues to authenticated;
-- Members read issues in their visible projects (mirrors daily_work_plans). Writes
-- are RPC-only — no INSERT/UPDATE/DELETE grant or policy for authenticated.
create policy "site issues readable in visible projects"
  on public.site_issues
  for select
  to authenticated
  using (public.can_see_project(project_id));

-- ----------------------------------------------------------------------------
-- site_issue_attachments — clone of feedback_attachments (append-only).
-- ----------------------------------------------------------------------------
create table public.site_issue_attachments (
  id            uuid primary key default gen_random_uuid(),
  site_issue_id uuid not null references public.site_issues(id) on delete cascade,
  storage_path  text not null,
  uploaded_by   uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  constraint site_issue_attachments_path_shape
    check (length(btrim(storage_path)) between 1 and 400)
);
create index site_issue_attachments_issue_idx
  on public.site_issue_attachments (site_issue_id, created_at);

-- Append-only (the attachment doctrine — feedback_attachments / contact_attachments).
create function public.site_issue_attachments_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'site_issue_attachments is append-only: % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger site_issue_attachments_block_update_delete
  before update or delete on public.site_issue_attachments
  for each row execute function public.site_issue_attachments_block_write();
create trigger site_issue_attachments_block_truncate
  before truncate on public.site_issue_attachments
  for each statement execute function public.site_issue_attachments_block_write();

alter table public.site_issue_attachments enable row level security;
revoke all on public.site_issue_attachments from anon, authenticated;
grant select on public.site_issue_attachments to authenticated;
-- Members read attachment rows for issues they can see (bytes are signed-URL only —
-- the private bucket below has no SELECT policy).
create policy "site issue attachments readable in visible projects"
  on public.site_issue_attachments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.site_issues s
       where s.id = site_issue_id and public.can_see_project(s.project_id)
    )
  );

-- ----------------------------------------------------------------------------
-- Private bucket + owner-bound upload policy. Path: issue/{issueId}/{id}.{ext}
-- → foldername = ['issue', issueId]. Upload allowed only for the caller's OWN
-- issue (mirrors the feedback-attachments bucket). Reads = service-role signed URL.
-- The object key is qualified `objects.name` — the name-capture hazard honored.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-issues',
  'site-issues',
  false,
  10485760,   -- 10 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "site issue uploads by owner"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'site-issues'
    and array_length(storage.foldername(objects.name), 1) = 2
    and (storage.foldername(objects.name))[1] = 'issue'
    and exists (
      select 1 from public.site_issues s
      where s.id::text = (storage.foldername(objects.name))[2]
        and s.reported_by = (select auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- report_site_issue — file a new issue. Clones record_site_purchase's gate order:
-- null-safe role gate → validation → project existence → membership (42501 only
-- for a non-member of an EXISTING project) → optional WP-belongs-to-project.
-- ----------------------------------------------------------------------------
create function public.report_site_issue(
  p_project_id      uuid,
  p_work_package_id uuid,
  p_issue_type      public.site_issue_type,
  p_note            text
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
  -- project_director rides along with project_manager (same set as
  -- record_site_purchase; pgTAP file 91 pins every PM-gated RPC to name it).
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

  -- Project existence (precedes the membership gate — an unknown project is P0001).
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'report_site_issue: project not found' using errcode = 'P0001';
  end if;

  -- Membership scope (F2/F3): only a non-member of an EXISTING project gets 42501.
  -- super_admin / project_coordinator / project_director are unconditional via
  -- can_see_project.
  if not public.can_see_project(p_project_id) then
    raise exception 'report_site_issue: not a project member' using errcode = '42501';
  end if;

  -- An optional WP must belong to the named project (membership already proven for
  -- that project by can_see_project, so no separate visibility probe is needed).
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
-- add_site_issue_attachment — clone of add_feedback_attachment: any authenticated
-- user, but only for THEIR OWN issue (matches the owner-bound storage policy).
-- ----------------------------------------------------------------------------
create function public.add_site_issue_attachment(p_site_issue_id uuid, p_storage_path text)
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

  insert into public.site_issue_attachments (site_issue_id, storage_path, uploaded_by)
  values (p_site_issue_id, v_path, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_site_issue_attachment(uuid, text) from public, anon;
grant execute on function public.add_site_issue_attachment(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- resolve_site_issue — flip an open issue to resolved. Idempotent (re-resolving is
-- a no-op that still returns the id). Same gate order as report_site_issue.
-- ----------------------------------------------------------------------------
create function public.resolve_site_issue(p_site_issue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  if public.current_user_role() is null
     or public.current_user_role() not in
        ('site_admin', 'project_manager', 'super_admin', 'project_director') then
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
$$;
revoke all on function public.resolve_site_issue(uuid) from public, anon;
grant execute on function public.resolve_site_issue(uuid) to authenticated;
