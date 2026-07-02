-- Spec 248 M2 — defect↔after-fix pairing + guards.
--
-- 1. answers_photo_id: an after_fix photo records WHICH defect photo it
--    answers (same-angle re-shoot; feeds the future defect→fix report).
-- 2. Tombstones never answer (ADR 0015 all-payload-NULL doctrine) — same-row
--    CHECK.
-- 3. BEFORE INSERT guard trigger:
--      a. pairing validation — answers_photo_id only on after_fix rows, and
--         the target must be a REAL (non-tombstone) defect photo on the SAME
--         work package and SAME rework round (stale rounds are not evidence);
--      b. defect-removal role gate — a tombstone whose target is a defect
--         photo requires a filing role (PM/PD/super). Without this the gated
--         site_admin could delete the PM's defect photos and collapse the
--         spec-248 submit gate to the weaker floor rule (design-review
--         blocker, found by two independent lenses).
-- 4. INSERT policy re-created from LIVE + attribution pin
--    (uploaded_by = auth.uid()): evidence attribution was forgeable by any
--    allowed role.
-- 5. Client-portal SELECT arm re-created from LIVE + phase <> 'defect':
--    internal defect evidence must not leak to clients once the WP returns
--    to complete.
--
-- Policies were sourced VERBATIM from live pg_policy on 2026-07-03 before
-- editing (db-migration lesson: never trust a migration file as the source).

-- 1 + 2 — column, FK, partial index, tombstones-never-answer CHECK.
alter table public.photo_logs
  add column answers_photo_id uuid null references public.photo_logs(id);

create index photo_logs_answers_photo_id_idx
  on public.photo_logs (answers_photo_id)
  where answers_photo_id is not null;

alter table public.photo_logs
  add constraint photo_logs_answer_only_on_real_photo
  check (answers_photo_id is null or storage_path is not null);

-- 3 — the guard trigger. SECURITY DEFINER so the target lookup is not
-- narrowed by the caller's RLS (the caller provably sees the WP already —
-- the INSERT policy requires can_see_wp). Null-safe role read: an unbound
-- role coalesces to 'visitor' and FAILS CLOSED (rls-self-check-coalesce
-- lesson).
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
       or target.rework_round <> new.rework_round then
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

create trigger photo_logs_spec248_guard
  before insert on public.photo_logs
  for each row execute function public.photo_logs_spec248_guard();

-- 4 — INSERT policy: LIVE body + the uploaded_by attribution pin.
drop policy "photo_logs insert by sa/pm/super" on public.photo_logs;
create policy "photo_logs insert by sa/pm/super"
  on public.photo_logs for insert to authenticated
  with check (
    (( select public.current_user_role() ) = any (array[
      'site_admin'::public.user_role,
      'project_manager'::public.user_role,
      'super_admin'::public.user_role,
      'project_director'::public.user_role
    ]))
    and ( select public.can_see_wp(photo_logs.work_package_id) )
    and uploaded_by = ( select auth.uid() )
  );

-- 5 — client portal SELECT arm: LIVE body + the defect exclusion.
drop policy "client reads approved project photos" on public.photo_logs;
create policy "client reads approved project photos"
  on public.photo_logs for select to authenticated
  using (
    (( select public.current_user_role() ) = 'client'::public.user_role)
    and phase <> 'defect'::public.photo_phase
    and exists (
      select 1
      from public.work_packages w
      where w.id = photo_logs.work_package_id
        and w.status = 'complete'::public.work_package_status
        and public.client_has_live_access(w.project_id)
    )
  );
