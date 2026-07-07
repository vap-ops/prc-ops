-- Spec 273 U1 follow-up 2 — revoke the EXPLICIT anon EXECUTE grant.
--
-- Supabase's ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to anon *explicitly*
-- on every new public function, so `revoke ... from public` alone does not
-- remove it (229 header). 073600 revoked daily_work_plan_assert_writer from
-- PUBLIC only, leaving its explicit anon grant — the last anon-reachable definer
-- function (test 229 "have: 1"). Revoke from anon here; also re-revoke the other
-- six from anon idempotently so the whole cluster is provably anon-closed.
-- Forward-fix (073600/073700 already applied — never edited in place).

revoke execute on function public.daily_work_plan_assert_writer(uuid)          from anon, public;
revoke execute on function public.add_daily_plan_item(uuid, date, uuid)        from anon, public;
revoke execute on function public.remove_daily_plan_item(uuid)                 from anon, public;
revoke execute on function public.set_daily_plan_item_note(uuid, text)         from anon, public;
revoke execute on function public.reorder_daily_plan_items(uuid, uuid[])       from anon, public;
revoke execute on function public.set_daily_plan_item_crew(uuid, uuid[], uuid) from anon, public;
revoke execute on function public.daily_work_plan_items_validate()             from anon, public;
