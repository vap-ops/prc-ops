-- Spec 201 awareness arc A2 — reporter reply-awareness ("unread" state).
--
-- When the operator/agent publishes a reply, the reporter should see it without
-- re-polling. That needs per-(report, viewer) SEEN-state — which append-only forbids
-- on feedback_messages (UPDATE/DELETE → P0001) and which does not belong on the shared
-- feedback row (a single row can't hold one viewer's last-seen). So, exactly like
-- feedback_message_drafts got its own table for the same append-only reason, seen-state
-- lives in its OWN small MUTABLE table feedback_views — delivery/seen-state, not
-- evidence (the same category notification_outbox is deliberately mutable for).
--
-- Access is RPC-only (no direct grants/policies, like feedback_attachments): the
-- caller marks a report viewed (mark_feedback_viewed) and asks which of their own
-- reports have an unread team reply (feedback_unread_ids). Both definers scope to the
-- caller, so the table needs zero authenticated access.

create table public.feedback_views (
  feedback_id    uuid not null references public.feedback(id) on delete cascade,
  user_id        uuid not null references public.users(id)    on delete cascade,
  last_viewed_at timestamptz not null default now(),
  primary key (feedback_id, user_id)
);

alter table public.feedback_views enable row level security;
revoke all on public.feedback_views from anon, authenticated;
-- No policies on purpose: zero direct access. All reads/writes go through the two
-- definer RPCs below, each scoped to the caller (auth.uid()). The table is MUTABLE by
-- design (last_viewed_at is updated on every view) — it is NOT append-only.

-- ----------------------------------------------------------------------------
-- mark_feedback_viewed — record that the caller has now seen a report's thread.
-- Fired client-side after the thread renders (/feedback/[id]). Upsert: re-viewing
-- bumps last_viewed_at. The caller must be able to SEE the report (its submitter, or
-- super_admin) — mirrors the feedback read RLS so a stranger can't record a view on
-- someone else's report.
-- ----------------------------------------------------------------------------
create function public.mark_feedback_viewed(p_feedback_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'mark_feedback_viewed: not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.feedback where id = p_feedback_id) then
    raise exception 'mark_feedback_viewed: feedback not found' using errcode = '22023';
  end if;
  if not (
    exists (select 1 from public.feedback where id = p_feedback_id and submitted_by = v_uid)
    or (select public.current_user_role()) = 'super_admin'
  ) then
    raise exception 'mark_feedback_viewed: not your feedback' using errcode = '42501';
  end if;

  insert into public.feedback_views (feedback_id, user_id, last_viewed_at)
  values (p_feedback_id, v_uid, now())
  on conflict (feedback_id, user_id) do update set last_viewed_at = now();
end;
$$;
revoke execute on function public.mark_feedback_viewed(uuid) from public, anon;
grant execute on function public.mark_feedback_viewed(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- feedback_unread_ids — the caller's OWN submitted reports that have a team reply
-- (operator/agent) newer than the caller last viewed the thread. The reporter's own
-- 'reporter' messages never count. SECURITY DEFINER so it can read feedback_views
-- (zero-access) + feedback_messages; the submitted_by filter keeps it caller-scoped.
-- ----------------------------------------------------------------------------
create function public.feedback_unread_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select f.id
  from public.feedback f
  where f.submitted_by = (select auth.uid())
    and exists (
      select 1
      from public.feedback_messages m
      where m.feedback_id = f.id
        and m.author_kind in ('operator', 'agent')
        and m.created_at > coalesce(
          (select v.last_viewed_at
             from public.feedback_views v
            where v.feedback_id = f.id and v.user_id = (select auth.uid())),
          '-infinity'::timestamptz)
    );
$$;
revoke execute on function public.feedback_unread_ids() from public, anon;
grant execute on function public.feedback_unread_ids() to authenticated;
