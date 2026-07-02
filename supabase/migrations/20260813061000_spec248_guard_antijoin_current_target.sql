-- Spec 248 M2 fix — the pairing target must be CURRENT, not merely real.
--
-- 20260813060000's guard checked target.storage_path IS NOT NULL, but a
-- tombstoned photo is a SEPARATE row pointing at its target via superseded_by
-- (ADR 0015) — the removed photo itself keeps its storage_path. "Current"
-- needs BOTH filters (ADR 0009 anti-join + tombstone), exactly like every
-- read path; pgTAP 256 B.5 caught the missing anti-join arm. Body otherwise
-- identical to 060000 (applied minutes earlier, unedited — re-asserted whole
-- per the never-edit-an-applied-migration rule).

create or replace function public.photo_logs_spec248_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  target public.photo_logs%rowtype;
  actor_role public.user_role;
begin
  -- a. pairing validation (null-permissive: plain rows and tombstones with
  --    NULL answers pass untouched).
  if new.answers_photo_id is not null then
    if new.phase <> 'after_fix' then
      raise exception 'answers_photo_id is allowed only on after_fix photos'
        using errcode = '23514';
    end if;
    select * into target from public.photo_logs where id = new.answers_photo_id;
    if target.id is null
       or target.work_package_id <> new.work_package_id
       or target.phase <> 'defect'
       or target.storage_path is null
       or target.rework_round <> new.rework_round
       -- ADR 0009: a row any other row supersedes is not current — a
       -- tombstoned (or edited-away) defect photo cannot be answered.
       or exists (select 1 from public.photo_logs n where n.superseded_by = target.id) then
      raise exception 'answers_photo_id must reference a current defect photo of the same work package and round'
        using errcode = '23514';
    end if;
  end if;

  -- b. defect-removal role gate (fires on tombstone inserts).
  if new.superseded_by is not null then
    select * into target from public.photo_logs where id = new.superseded_by;
    if target.id is not null and target.phase = 'defect' then
      actor_role := coalesce(public.current_user_role(), 'visitor'::public.user_role);
      if actor_role not in ('project_manager', 'project_director', 'super_admin') then
        raise exception 'defect photos are removable only by the roles that file defects'
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;
