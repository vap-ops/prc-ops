-- Spec 370 U1 (part 3) — fresh-eyes hardening of 075861 (found in review before
-- merge; 075861/075862 are already applied, so fixes land as their own migration
-- — editing an applied migration is a silent no-op).
--
-- ① The 🔴: equipment_usage_photos was created WITHOUT the house revoke-first,
--   so Supabase default privileges left anon/authenticated holding ALL —
--   including TRUNCATE, which RLS does not gate. Revoke everything, grant back
--   exactly SELECT+INSERT to authenticated.
-- ② All three new policies were created without TO authenticated (PUBLIC-scoped)
--   — the only such policies on their tables. The coalesce(current_user_role(),
--   false) wrap held anon out in live probes, but the defence-in-depth layer the
--   mirrored policies carry was silently dropped. Recreate with TO authenticated.
-- ③ The photo INSERT policy had no project-membership arm — the exact gap SA
--   audit F3 closed on check_out/check_in in this same object graph: a site_admin
--   from project A could attach "evidence" to any project B loan. Membership arm
--   mirrors the RPCs: scoped to site_admin/project_manager only (procurement
--   tiers have no project_members rows and must stay admitted).
-- ④ The DROP+CREATE in 075861 lost both RPCs' pg_proc COMMENTs (the live guard
--   inventory a gate-check reads). Restored, updated for the new params.
-- ⑤ Index on the documented read path (photos by log_id).

-- ① Grant hygiene (revoke-first, the 075838/075844 pattern).
revoke all on public.equipment_usage_photos from public, anon, authenticated;
grant select, insert on public.equipment_usage_photos to authenticated;

-- ②+③ Policy recreation. DROP+CREATE = a REWRITE: re-wrap (select …) + coalesce.
drop policy "equipment_usage_photos readable by staff" on public.equipment_usage_photos;
drop policy "equipment_usage_photos insert by movers" on public.equipment_usage_photos;
drop policy "equipment-images uploads by back office" on storage.objects;

create policy "equipment_usage_photos readable by staff"
  on public.equipment_usage_photos for select
  to authenticated
  using (
    coalesce(
      (select public.current_user_role()) = any (array[
        'site_admin', 'project_manager', 'procurement', 'procurement_manager',
        'super_admin', 'project_director'
      ]::public.user_role[]),
      false
    )
  );

create policy "equipment_usage_photos insert by movers"
  on public.equipment_usage_photos for insert
  to authenticated
  with check (
    coalesce(
      (select public.current_user_role()) = any (array[
        'site_admin', 'project_manager', 'procurement', 'procurement_manager',
        'super_admin', 'project_director'
      ]::public.user_role[]),
      false
    )
    and taken_by = (select auth.uid())
    -- F3 membership arm, mirroring check_out/check_in: the two membership-scoped
    -- roles must be members of the loan's project; the central-logistics tiers
    -- (procurement/procurement_manager) and see-all tiers pass on role alone.
    and (
      (select public.current_user_role()) not in ('site_admin', 'project_manager')
      or public.can_see_wp((
        select l.work_package_id from public.equipment_usage_logs l
         where l.id = log_id
      ))
    )
  );

create policy "equipment-images uploads by back office"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'equipment-images'
    and (
      (
        coalesce(
          (select public.current_user_role()) = any (array[
            'project_manager', 'procurement', 'procurement_manager',
            'super_admin', 'project_director'
          ]::public.user_role[]),
          false
        )
        and array_length(storage.foldername(name), 1) = 1
      )
      or (
        coalesce(
          (select public.current_user_role()) = any (array[
            'site_admin', 'project_manager', 'procurement', 'procurement_manager',
            'super_admin', 'project_director'
          ]::public.user_role[]),
          false
        )
        and (storage.foldername(name))[1] = 'usage'
        and array_length(storage.foldername(name), 1) = 2
      )
    )
  );

-- ④ Guard inventory back on the live objects.
comment on function public.check_out_equipment(uuid, uuid, date, public.equipment_usage_via, uuid) is
  'Open an equipment usage span on a WP. Gates: six-role allowlist (42501); F2 physical-availability status (available/on_site/in_use only); F3 project membership for site_admin/project_manager via can_see_wp; complete-WP refusal; one-open-span guard under a per-item advisory lock. Spec 370 U1: rate-OPTIONAL (null daily_rate snapshots null and charges 0 in wp_equipment_sell), p_via = the borrow door, p_borrower_worker_id = who physically holds it (entered_by is the recording custodian).';
comment on function public.check_in_equipment(uuid, date, public.equipment_usage_via) is
  'Close an equipment usage span: inserts a superseding row (append-only), copying checked_out_on / rate snapshot / borrower and stamping checked_in_on; restores the item status implied by its latest movement. Gates: six-role allowlist (42501); F3 membership for site_admin/project_manager; refuses already-closed / already-superseded / check-in-before-check-out. Spec 370 U1: p_via = the RETURN door (the borrow door lives on the original row).';

-- ⑤ The chain-follow read path.
create index equipment_usage_photos_log_id_idx
  on public.equipment_usage_photos (log_id);
