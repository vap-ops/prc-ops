-- Spec 386 U1 — Telegram self-serve binding: the one-time link-token store.
--
-- Why this is a migration and not a page: `authenticated` holds NO UPDATE grant
-- on public.users at all (has_table_privilege → false; the only UPDATE policy is
-- super_admin's, and even that has no grant to exercise). So users.telegram_chat_id
-- is unwritable by every app path today — which is exactly why 1 of 40 users has
-- one, set by hand in SQL. Binding AND unbinding both need SECURITY DEFINER.
--
-- The flow this enables (spec 386 §2): Telegram never hands an application a chat
-- id — it hands one to a BOT, and only after the user messages it. So the app mints
-- a one-time token, deep-links the user to t.me/<bot>?start=<token>, and the bot's
-- webhook trades that token for the chat id.
--
-- Bot API constraints, verified against the docs 2026-07-31 (not from memory):
-- the `start` payload is at most 64 characters of [A-Za-z0-9_-]. base64url of 32
-- random bytes is 43 chars — fits, and 256 bits is the right entropy floor because
-- POSSESSION OF THE TOKEN IS WHAT PROVES IDENTITY. The alphabet is enforced by a
-- CHECK so no future caller can mint a token the t.me link would silently mangle.

-- ============================================================================
-- §1 the token store
-- ============================================================================
create table public.telegram_link_tokens (
  token            text primary key,
  user_id          uuid not null references public.users (id) on delete cascade,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  consumed_chat_id text,
  constraint telegram_link_tokens_token_shape
    check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  constraint telegram_link_tokens_expiry_after_creation
    check (expires_at > created_at)
);

comment on table public.telegram_link_tokens is
  'Spec 386: short-lived single-use tokens that trade a t.me/<bot>?start=<token> deep link for a Telegram chat id. RPC-only — no policies, no grants.';

-- the lookup both RPCs make (mint rotates the caller''s outstanding token;
-- unlink drops it)
create index telegram_link_tokens_open_by_user_idx
  on public.telegram_link_tokens (user_id) where consumed_at is null;

-- ============================================================================
-- §2 RLS — enabled with NO policies, and NO grants. The table is reachable only
-- through the DEFINER functions below and the service role. Both halves matter:
-- RLS with a grant but no policy is merely closed by accident, and a grant with
-- no RLS is open.
-- ============================================================================
alter table public.telegram_link_tokens enable row level security;
revoke all on table public.telegram_link_tokens from public, anon, authenticated;

-- ============================================================================
-- §3 users: when the link was made, and the one-chat-one-user rule.
--
-- A Telegram chat is a person''s account. Without the unique index two app users
-- could share one chat, and one person would receive the other''s notifications.
-- Safe to create: exactly one non-null telegram_chat_id exists today.
-- ============================================================================
alter table public.users add column telegram_linked_at timestamptz;

comment on column public.users.telegram_linked_at is
  'Spec 386: when telegram_chat_id was bound (self-serve or by hand). NULL = not linked.';

create unique index users_telegram_chat_id_key
  on public.users (telegram_chat_id) where telegram_chat_id is not null;

-- ============================================================================
-- §4 start_telegram_link — the caller mints a token for THEMSELVES.
--
-- Minting ROTATES: an abandoned link dies the moment a new one is asked for, so
-- a token screenshotted an hour ago cannot still bind.
-- ============================================================================
create or replace function public.start_telegram_link()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_token text;
begin
  -- Null-safe: an unbound caller must be REFUSED, never fall through. A NULL
  -- compared with anything yields NULL, not false (the RLS self-check trap).
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  delete from public.telegram_link_tokens
   where user_id = v_uid and consumed_at is null;

  -- base64url, padding stripped: 32 bytes -> 43 chars of [A-Za-z0-9_-].
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  insert into public.telegram_link_tokens (token, user_id, expires_at)
  values (v_token, v_uid, now() + interval '15 minutes');

  return v_token;
end;
$$;

revoke all on function public.start_telegram_link() from public, anon;
grant execute on function public.start_telegram_link() to authenticated;

-- ============================================================================
-- §5 consume_telegram_link_token — the webhook''s half.
--
-- SERVICE ROLE ONLY. This is the function that writes an identity link, and its
-- only legitimate caller is the Telegram webhook holding the service key; it is
-- revoked from `authenticated` as well as anon/public. Identity comes from the
-- TOKEN alone — never from anything in the Telegram update body.
--
-- Returns jsonb rather than raising so the webhook can answer the user in-chat
-- with copy that matches the outcome honestly: invalid_or_expired IS retryable
-- (go back to the app and press เชื่อม again), chat_already_linked is NOT.
-- ============================================================================
create or replace function public.consume_telegram_link_token(
  p_token text,
  p_chat_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_name    text;
begin
  if p_token is null or p_chat_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  -- Lock the row so two concurrent updates for the same token cannot both bind.
  select t.user_id into v_user_id
    from public.telegram_link_tokens t
   where t.token = p_token
     and t.consumed_at is null
     and t.expires_at > now()
   for update;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  -- One chat backs at most one user. Re-binding your OWN chat is idempotent
  -- (same row, no violation); a chat held by someone else is a PERMANENT
  -- refusal, which is why the webhook copy for this case must not say ลองใหม่.
  --
  -- Deliberately NOT a select-then-compare pre-check: that would be a second
  -- enforcement point racing the first, and the unique index is the one that
  -- actually decides. Handling its error is error MAPPING, not a guard — it
  -- turns the backstop's 23505 into the same honest reason instead of letting
  -- it escape as a 500 that Telegram would then retry.
  begin
    update public.users
       set telegram_chat_id   = p_chat_id,
           telegram_linked_at = now()
     where id = v_user_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'chat_already_linked');
  end;

  update public.telegram_link_tokens
     set consumed_at = now(),
         consumed_chat_id = p_chat_id
   where token = p_token;

  select coalesce(u.full_name, u.line_display_name) into v_name
    from public.users u where u.id = v_user_id;

  return jsonb_build_object('ok', true, 'display_name', v_name);
end;
$$;

revoke all on function public.consume_telegram_link_token(text, text) from public, anon, authenticated;
grant execute on function public.consume_telegram_link_token(text, text) to service_role;

-- ============================================================================
-- §6 unlink_telegram — one call, self-scoped. No confirmation step by design:
-- it is reversible in two taps, and an unlink nobody can find is worse than an
-- accidental one.
-- ============================================================================
create or replace function public.unlink_telegram()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.users
     set telegram_chat_id = null,
         telegram_linked_at = null
   where id = v_uid;

  delete from public.telegram_link_tokens
   where user_id = v_uid and consumed_at is null;
end;
$$;

revoke all on function public.unlink_telegram() from public, anon;
grant execute on function public.unlink_telegram() to authenticated;
