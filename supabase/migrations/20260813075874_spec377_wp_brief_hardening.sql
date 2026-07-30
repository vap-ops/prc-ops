-- Spec 377 U1 — fresh-eyes hardening of 075873 (same unit, second migration per
-- the applied-migration-edit-no-op rule; 372-U4a precedent).
--
-- The review's live-probed findings, each fixed here:
--   🔴 delete_work_package + project hard-delete died on a raw 23503 the moment a
--      WP carried a brief — the draft FK now CASCADES (derived content), and the
--      RPC's history guard learns about published versions + attachments so the
--      refusal is the FRIENDLY P0001, exactly like photos.
--   🟡 wp_brief_criteria.brief_id was re-parentable, silently bypassing the slot
--      guard — now immutable (23514).
--   🟡 wp_brief_attachments.superseded_by was unguarded — a tombstone in brief B
--      could retire brief A's attachment (invisible to A's readers, unfixable in
--      an append-only table), a second tombstone could stack, and the target was
--      never required to be a content row. Guard trigger added.
--   🟡 wp_brief_versions.version trusted the caller — now DERIVED in-DB
--      (max+1, caller input ignored), so gaps / re-publish-at-a-lower-number are
--      unrepresentable; unique(work_package_id, version) still serializes a
--      concurrent double-publish.
--   🔵 dial RPC: a NULL flag no longer defaults the kill switch ON (22023); the
--      registry code gains a not-blank CHECK the btrim matcher relies on.
--   🔵 jsonb bounds (display_config / content) — everything else was bounded.
--   🔵 the redundant (work_package_id, version desc) index dropped (the unique
--      constraint's index serves the DESC scan).
--
-- NOTE (recorded, not changed): the read model excludes the `client` role by
-- design (`client reads project work_packages` has no brief counterpart) — a
-- client portal shows WPs without briefs. U3 must not render a brief door for
-- client. All tables here are empty (created this session) — the CHECKs and FK
-- swap validate instantly.

-- 1. Draft FK → CASCADE (derived content; versions/attachments are the evidence)
alter table public.wp_briefs
  drop constraint wp_briefs_work_package_id_fkey,
  add constraint wp_briefs_work_package_id_fkey
    foreign key (work_package_id) references public.work_packages (id)
    on delete cascade;

-- 2. Criteria cannot re-parent
create function public.wp_brief_criteria_guard()
returns trigger
language plpgsql
as $$
begin
  if new.brief_id is distinct from old.brief_id then
    raise exception 'wp_brief_criteria: a criterion cannot move to another brief'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger wp_brief_criteria_guard
  before update on public.wp_brief_criteria
  for each row execute function public.wp_brief_criteria_guard();

-- 3. Attachment supersede guard: same brief, content-row target, single tombstone
create function public.wp_brief_attachment_guard()
returns trigger
language plpgsql
as $$
declare
  v_target public.wp_brief_attachments%rowtype;
begin
  if new.superseded_by is not null then
    select * into v_target from public.wp_brief_attachments
     where id = new.superseded_by;
    if not found then
      raise exception 'wp_brief_attachments: supersede target does not exist'
        using errcode = '23514';
    end if;
    if v_target.brief_id <> new.brief_id then
      raise exception 'wp_brief_attachments: supersede target belongs to another brief'
        using errcode = '23514';
    end if;
    if v_target.storage_path is null then
      raise exception 'wp_brief_attachments: cannot supersede a tombstone'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.wp_brief_attachments x
                where x.superseded_by = new.superseded_by) then
      raise exception 'wp_brief_attachments: target is already superseded'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger wp_brief_attachments_guard
  before insert on public.wp_brief_attachments
  for each row execute function public.wp_brief_attachment_guard();

-- 4. Version numbers are DERIVED in-DB; the caller's value is ignored
create function public.wp_brief_versions_number()
returns trigger
language plpgsql
as $$
begin
  new.version := coalesce(
    (select max(version) + 1 from public.wp_brief_versions
      where work_package_id = new.work_package_id),
    1);
  return new;
end;
$$;
create trigger wp_brief_versions_number
  before insert on public.wp_brief_versions
  for each row execute function public.wp_brief_versions_number();

drop index public.wp_brief_versions_wp_idx;

-- 5. jsonb bounds + registry code hygiene
alter table public.wp_briefs
  add constraint wp_briefs_display_config_bounds check (
    display_config is null or length(display_config::text) <= 10000
  );
alter table public.wp_brief_versions
  add constraint wp_brief_versions_content_bounds check (
    length(content::text) <= 100000
  );
alter table public.wp_brief_attachment_types
  add constraint wp_brief_attachment_types_code_not_blank check (
    length(btrim(code)) > 0
  );

-- 6. Dial RPC: a NULL flag is a caller bug, never "turn the type ON"
create or replace function public.set_wp_brief_attachment_type_active(
  p_code      text,
  p_is_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'set_wp_brief_attachment_type_active: role not permitted' using errcode = '42501';
  end if;
  if p_is_active is null then
    raise exception 'set_wp_brief_attachment_type_active: flag required' using errcode = '22023';
  end if;
  update public.wp_brief_attachment_types
     set is_active = p_is_active
   where code = btrim(coalesce(p_code, ''));
  if not found then
    raise exception 'set_wp_brief_attachment_type_active: unknown code' using errcode = '22023';
  end if;
end;
$$;
-- create-or-replace keeps the 075873 grants; re-assert anyway (defence in depth
-- against the new-signature-default-EXECUTE class — same signature here, no-op).
revoke all on function public.set_wp_brief_attachment_type_active(text, boolean) from public, anon;
grant execute on function public.set_wp_brief_attachment_type_active(text, boolean) to authenticated;

-- 7. delete_work_package learns about briefs — sourced from the LIVE definition
-- (2026-07-30, this session); the ONLY changes are the two new exists() arms and
-- the message. A WP with published versions or uploaded attachments refuses
-- friendly; a WP with only a draft (criteria/slots included) cascades cleanly.
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

  if exists (select 1 from public.photo_logs where work_package_id = p_work_package_id)
     or exists (select 1 from public.labor_logs where work_package_id = p_work_package_id)
     or exists (select 1 from public.approvals where work_package_id = p_work_package_id)
     or exists (select 1 from public.purchase_requests where work_package_id = p_work_package_id)
     or exists (select 1 from public.work_package_members where work_package_id = p_work_package_id)
     or exists (select 1 from public.work_package_dependencies
                 where predecessor_id = p_work_package_id or successor_id = p_work_package_id)
     or exists (select 1 from public.wp_brief_versions where work_package_id = p_work_package_id)
     or exists (select 1 from public.wp_brief_attachments a
                  join public.wp_briefs b on b.id = a.brief_id
                 where b.work_package_id = p_work_package_id)
  then
    raise exception 'delete_work_package: work package has history (photos/labor/requests/members/dependencies/brief) — cancel it instead'
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
