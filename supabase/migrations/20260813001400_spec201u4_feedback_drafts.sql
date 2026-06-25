-- Spec 201 U4 — CC drafts → operator approves (the human-in-the-loop gate, locked
-- dial 1). A CC-generated reply is NOT a thread message yet: feedback_messages is
-- append-only and immutable by design, so a draft cannot be a feedback_messages row
-- toggled draft→published. Instead a draft is STAGED in feedback_message_drafts —
-- mutable, super_admin-only — and the reporter NEVER sees it. Approval is the only
-- path to the reporter: publish_feedback_draft inserts a real (append-only) agent
-- message and deletes the draft; discard_feedback_draft drops it unsent.
--
-- This contains the prompt-injection risk of feeding untrusted feedback text to CC:
-- nothing CC writes reaches a user without the operator's explicit approval.

create table public.feedback_message_drafts (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now(),
  constraint feedback_message_drafts_body_len check (length(btrim(body)) between 1 and 4000)
);
create index feedback_message_drafts_feedback_idx
  on public.feedback_message_drafts (feedback_id, created_at);

alter table public.feedback_message_drafts enable row level security;
revoke all on public.feedback_message_drafts from anon, authenticated;
grant select on public.feedback_message_drafts to authenticated;
-- Only the super_admin operator sees pending drafts. The reporter has NO read path
-- (an unapproved CC draft must never surface). Writes are RPC-only. Eval-once (file 40).
create policy "feedback drafts readable by super_admin"
  on public.feedback_message_drafts for select to authenticated
  using ((select public.current_user_role()) = 'super_admin');

-- ----------------------------------------------------------------------------
-- draft_feedback_message — CC (service_role) stages an agent draft. Callable ONLY
-- by service_role (CC runs it through `supabase db query`); app users cannot draft.
-- ----------------------------------------------------------------------------
create function public.draft_feedback_message(p_feedback_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := nullif(btrim(p_body), '');
  v_id   uuid;
begin
  if v_body is null or length(v_body) > 4000 then
    raise exception 'draft_feedback_message: body required (1..4000)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.feedback where id = p_feedback_id) then
    raise exception 'draft_feedback_message: feedback not found' using errcode = '22023';
  end if;

  insert into public.feedback_message_drafts (feedback_id, body)
  values (p_feedback_id, v_body)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.draft_feedback_message(uuid, text) from public;
revoke execute on function public.draft_feedback_message(uuid, text) from authenticated, anon;
grant execute on function public.draft_feedback_message(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- publish_feedback_draft — the super_admin operator APPROVES a draft: insert a real
-- append-only agent message into the thread, then delete the draft. Atomic. This is
-- the only way a CC draft reaches the reporter.
-- ----------------------------------------------------------------------------
create function public.publish_feedback_draft(p_draft_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_feedback_id uuid;
  v_body text;
  v_msg_id uuid;
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'publish_feedback_draft: super_admin only' using errcode = '42501';
  end if;

  select feedback_id, body into v_feedback_id, v_body
  from public.feedback_message_drafts where id = p_draft_id;
  if not found then
    raise exception 'publish_feedback_draft: draft not found' using errcode = '22023';
  end if;

  insert into public.feedback_messages (feedback_id, author_kind, author_id, body)
  values (v_feedback_id, 'agent', null, v_body)
  returning id into v_msg_id;

  delete from public.feedback_message_drafts where id = p_draft_id;
  return v_msg_id;
end;
$$;
revoke execute on function public.publish_feedback_draft(uuid) from public, anon;
grant execute on function public.publish_feedback_draft(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- discard_feedback_draft — the super_admin drops a draft without sending it.
-- ----------------------------------------------------------------------------
create function public.discard_feedback_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'discard_feedback_draft: super_admin only' using errcode = '42501';
  end if;

  delete from public.feedback_message_drafts where id = p_draft_id;
  if not found then
    raise exception 'discard_feedback_draft: draft not found' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.discard_feedback_draft(uuid) from public, anon;
grant execute on function public.discard_feedback_draft(uuid) to authenticated;
