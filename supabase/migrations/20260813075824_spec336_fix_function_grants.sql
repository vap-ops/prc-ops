-- Spec 336 follow-up — close the anon EXECUTE hole left by 075823.
--
-- 075823 wrote `revoke execute ... from anon`, which does NOT remove the
-- EXECUTE that Postgres grants to PUBLIC by default when a function is created
-- — so anon could still call both functions through the PUBLIC grant. The
-- established pattern in this repo (20260727000000, 20260813072700) is
-- `revoke all ... from public, anon`. The 229 anon-exec lockdown test is what
-- caught it. Applied migrations are never edited, so this is a new file.

revoke all on function public.create_work_package(uuid, text, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.create_work_package(uuid, text, text, text, uuid, uuid)
  to authenticated;

revoke all on function public.suggest_work_package_code(uuid, uuid) from public, anon;
grant execute on function public.suggest_work_package_code(uuid, uuid) to authenticated;
