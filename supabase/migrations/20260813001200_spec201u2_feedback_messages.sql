-- Spec 201 U2 — feedback two-way conversations. A report stops being a one-way
-- drop: feedback_messages holds the thread between the reporter, the operator, and
-- (later, U4) CC. Append-only — a message is never edited or deleted (the message
-- doctrine, like feedback_attachments / audit_log). Reads are own-thread (the
-- submitter, so they see replies) or super_admin (operator + CC). Writes are
-- RPC-only.
--
-- U2 scope: post_feedback_message is super_admin-only — an operator reply IS the
-- human-approved channel (the draft→approve gate exists for CC-generated replies,
-- which arrive in U4). The reporter-reply path is U3; the draft/published
-- distinction (so unapproved CC drafts stay hidden) is U4.

create type public.feedback_author_kind as enum ('reporter', 'operator', 'agent');

create table public.feedback_messages (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  author_kind public.feedback_author_kind not null,
  author_id   uuid references public.users(id),   -- null for an agent (CC) message
  body        text not null,
  created_at  timestamptz not null default now(),
  constraint feedback_messages_body_len check (length(btrim(body)) between 1 and 4000)
);
create index feedback_messages_thread_idx
  on public.feedback_messages (feedback_id, created_at);

-- Append-only (the message doctrine — mirrors feedback_attachments_block_write).
create function public.feedback_messages_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'feedback_messages is append-only: % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger feedback_messages_block_update_delete
  before update or delete on public.feedback_messages
  for each row execute function public.feedback_messages_block_write();
create trigger feedback_messages_block_truncate
  before truncate on public.feedback_messages
  for each statement execute function public.feedback_messages_block_write();

alter table public.feedback_messages enable row level security;
revoke all on public.feedback_messages from anon, authenticated;
grant select on public.feedback_messages to authenticated;
-- The submitter reads the thread on THEIR OWN report; super_admin reads every
-- thread. Writes are RPC-only (no insert grant/policy). Eval-once-wrapped (file 40).
create policy "feedback messages readable by submitter"
  on public.feedback_messages for select to authenticated
  using (exists (
    select 1 from public.feedback f
    where f.id = feedback_id and f.submitted_by = (select auth.uid())
  ));
create policy "feedback messages readable by super_admin"
  on public.feedback_messages for select to authenticated
  using ((select public.current_user_role()) = 'super_admin');

-- ----------------------------------------------------------------------------
-- post_feedback_message — U2: super_admin only (an operator reply). Stamps
-- author_kind = 'operator' and author_id = the caller; the body is the truth, the
-- feedback must exist. The feedback_messages table has no INSERT grant/policy, so
-- this definer is the sole write path.
-- ----------------------------------------------------------------------------
create function public.post_feedback_message(p_feedback_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_body text := nullif(btrim(p_body), '');
  v_id   uuid;
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'post_feedback_message: super_admin only' using errcode = '42501';
  end if;
  if v_body is null or length(v_body) > 4000 then
    raise exception 'post_feedback_message: body required (1..4000)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.feedback where id = p_feedback_id) then
    raise exception 'post_feedback_message: feedback not found' using errcode = '22023';
  end if;

  insert into public.feedback_messages (feedback_id, author_kind, author_id, body)
  values (p_feedback_id, 'operator', auth.uid(), v_body)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.post_feedback_message(uuid, text) from public, anon;
grant execute on function public.post_feedback_message(uuid, text) to authenticated;
