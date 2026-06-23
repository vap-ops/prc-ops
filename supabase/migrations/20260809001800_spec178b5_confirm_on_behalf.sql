-- Spec 178 B5 — confirm-on-behalf (the custody fallback for login-less workers).
--
-- The two-party custody handshake (spec 177 U6) lets the NAMED receiver worker
-- attest receipt on the portal. A worker with no portal login can't, so their
-- เบิก would sit รอรับ forever. This adds a manager override: a PM-tier user
-- confirms on the worker's behalf. Operator gate (AskUserQuestion 2026-06-23):
-- PM TIER ONLY (project_manager/super_admin/project_director) AND never the person
-- who ISSUED the stock (separation of duties — no rubber-stamping your own
-- handoff). Every on-behalf confirm is stamped for audit: received_by = the
-- manager, received_on_behalf = true (a worker self-confirm via confirm_stock_issue
-- leaves both at their defaults, so the two are always distinguishable).

alter table public.stock_issues
  add column received_on_behalf boolean not null default false,
  add column received_by uuid references public.users(id);

comment on column public.stock_issues.received_on_behalf is
  'Spec 178 B5 — true when a manager confirmed receipt on behalf of a login-less worker (vs the receiver self-attesting on the portal).';
comment on column public.stock_issues.received_by is
  'Spec 178 B5 — the user who confirmed an on-behalf receipt (the manager); null for a worker self-confirm.';

create function public.confirm_stock_issue_on_behalf(p_issue_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      public.user_role := public.current_user_role();
  v_project   uuid;
  v_receiver  uuid;
  v_received  timestamptz;
  v_issued_by uuid;
begin
  -- PM tier only (operator gate). NOT site_admin (often the issuer), NOT the
  -- worker portal (that is confirm_stock_issue).
  if v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'confirm_stock_issue_on_behalf: role not permitted' using errcode = '42501';
  end if;

  select project_id, receiver_worker_id, received_at, issued_by
    into v_project, v_receiver, v_received, v_issued_by
    from public.stock_issues where id = p_issue_id;
  if not found then
    raise exception 'confirm_stock_issue_on_behalf: unknown issue' using errcode = '22023';
  end if;
  -- Membership: PM by project membership; super/director see-all.
  if not public.can_see_project(v_project) then
    raise exception 'confirm_stock_issue_on_behalf: not a project member' using errcode = '42501';
  end if;
  if v_receiver is null then
    raise exception 'confirm_stock_issue_on_behalf: no receiver named on this issue'
      using errcode = '22023';
  end if;
  if v_received is not null then
    raise exception 'confirm_stock_issue_on_behalf: already confirmed' using errcode = '22023';
  end if;
  -- Separation of duties: the issuer cannot confirm their own handoff.
  if v_issued_by is not null and v_issued_by = auth.uid() then
    raise exception 'confirm_stock_issue_on_behalf: the issuer cannot confirm their own handoff'
      using errcode = '42501';
  end if;

  update public.stock_issues
     set received_at = now(), received_on_behalf = true, received_by = auth.uid()
   where id = p_issue_id;
end;
$$;

revoke execute on function public.confirm_stock_issue_on_behalf(uuid) from public, anon;
grant execute on function public.confirm_stock_issue_on_behalf(uuid) to authenticated, service_role;

comment on function public.confirm_stock_issue_on_behalf(uuid) is
  'Spec 178 B5 — a PM-tier manager (not the issuer) confirms receipt on behalf of a login-less receiver worker. Stamps received_by + received_on_behalf. Completes the custody handshake when the worker cannot self-attest on the portal.';
