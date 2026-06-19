-- Spec 149 U5b / ADR 0057 decision 8 — retention lifecycle write path:
--   mark_retention_due   — operator records the warranty-end date (held → due).
--   release_retention    — operator releases the withheld cash (held|due → released),
--                          which the enqueue trigger turns into a GL post.
-- Release is an EXPLICIT operator action (money never moves itself; decision #4).
-- Auto-flagging held→due at warranty end is deferred — projects carry no
-- warranty_end date yet; the operator marks due manually until that is modelled.

alter table public.retention_receivables
  add column released_by uuid null references public.users(id);

-- ----------------------------------------------------------------------------
create function public.mark_retention_due(p_id uuid, p_due_date date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.retention_status;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'mark_retention_due: role not permitted' using errcode = '42501';
  end if;
  select status into v_status from public.retention_receivables where id = p_id;
  if not found then
    raise exception 'mark_retention_due: retention not found' using errcode = 'P0001';
  end if;
  if v_status <> 'held' then
    raise exception 'mark_retention_due: only a held retention can be marked due' using errcode = 'P0001';
  end if;

  update public.retention_receivables
     set status = 'due', due_date = p_due_date where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('retention_due', auth.uid(), public.current_user_role(),
          'retention_receivables', p_id, jsonb_build_object('due_date', p_due_date));
  return p_id;
end;
$$;
revoke all on function public.mark_retention_due(uuid, date) from public, anon;
grant execute on function public.mark_retention_due(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
create function public.release_retention(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.retention_status;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'release_retention: role not permitted' using errcode = '42501';
  end if;
  select status into v_status from public.retention_receivables where id = p_id;
  if not found then
    raise exception 'release_retention: retention not found' using errcode = 'P0001';
  end if;
  if v_status not in ('held', 'due') then
    raise exception 'release_retention: retention is not releasable (status %)', v_status using errcode = 'P0001';
  end if;

  update public.retention_receivables
     set status = 'released', released_at = now(), released_by = auth.uid()
   where id = p_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('retention_release', auth.uid(), public.current_user_role(),
          'retention_receivables', p_id, jsonb_build_object('from_status', v_status));
  -- The GL post is enqueued by the status→released trigger below.
  return p_id;
end;
$$;
revoke all on function public.release_retention(uuid) from public, anon;
grant execute on function public.release_retention(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Enqueue the release posting. UPDATE-only (a retention row is inserted 'held' by
-- certify, never as 'released') so the WHEN may reference OLD safely.
create trigger retention_receivables_enqueue_gl_posting_upd
  after update on public.retention_receivables
  for each row
  when (new.status = 'released' and old.status is distinct from new.status)
  execute function public.enqueue_gl_posting_tg('retention_release', 'id');
