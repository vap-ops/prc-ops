-- Data-architecture hardening (rank 5) — defense-in-depth on the worker/labor
-- mutation RPCs. These SECURITY DEFINER functions guard themselves with an
-- internal current_user_role() check, but were never revoked from PUBLIC, so
-- Postgres's default EXECUTE-to-PUBLIC stands (and the 20260624 note-param
-- DROP+CREATEs reset any grant back to that default). One future edit that
-- forgets the internal gate would be reachable by anon. Tighten to match the
-- posture record_purchase / freeze_wp_labor_cost / update_project_settings
-- already use: EXECUTE only by authenticated. Behavior-neutral for the app
-- (it calls these as an authenticated session); removes the anon attack surface.
--
-- Signatures are the CURRENT ones (note param added in 20260624000500/000600).

revoke all on function
  public.log_labor_day(uuid, uuid, date, public.day_fraction, text)
  from public, anon, authenticated;
grant execute on function
  public.log_labor_day(uuid, uuid, date, public.day_fraction, text)
  to authenticated;

revoke all on function
  public.correct_labor_log(uuid, text, public.day_fraction, boolean, text)
  from public, anon, authenticated;
grant execute on function
  public.correct_labor_log(uuid, text, public.day_fraction, boolean, text)
  to authenticated;

revoke all on function
  public.create_worker(text, public.worker_type, numeric, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.create_worker(text, public.worker_type, numeric, uuid, uuid, text)
  to authenticated;

revoke all on function
  public.update_worker(uuid, text, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.update_worker(uuid, text, boolean, uuid, text)
  to authenticated;

revoke all on function
  public.set_worker_day_rate(uuid, numeric)
  from public, anon, authenticated;
grant execute on function
  public.set_worker_day_rate(uuid, numeric)
  to authenticated;
