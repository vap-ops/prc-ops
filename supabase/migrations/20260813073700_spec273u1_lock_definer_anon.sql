-- Spec 273 U1 follow-up — lock the definer functions to authenticated.
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, so the 073600 RPCs +
-- validation trigger were callable by anon — tripping the anon-exec-definer
-- invariant (test 229, "no callable SECURITY DEFINER public function grants
-- anon EXECUTE"). Revoke PUBLIC (and anon explicitly); the 5 RPCs keep the
-- explicit authenticated grant from 073600, so authenticated is unaffected.
-- Forward-fix migration (073600 is already applied — never edited in place).

revoke execute on function public.add_daily_plan_item(uuid, date, uuid)      from public, anon;
revoke execute on function public.remove_daily_plan_item(uuid)               from public, anon;
revoke execute on function public.set_daily_plan_item_note(uuid, text)       from public, anon;
revoke execute on function public.reorder_daily_plan_items(uuid, uuid[])     from public, anon;
revoke execute on function public.set_daily_plan_item_crew(uuid, uuid[], uuid) from public, anon;
revoke execute on function public.daily_work_plan_items_validate()           from public, anon;
