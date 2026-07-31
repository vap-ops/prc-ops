begin;
select plan(31);

-- ============================================================================
-- Spec 386 U1 — Telegram self-serve binding: the one-time link-token store and
-- the three DEFINER RPCs.
--
-- Why any of this needs a migration at all: `authenticated` holds NO UPDATE
-- grant on public.users (has_table_privilege → false), so telegram_chat_id is
-- unwritable by every app path today. Binding AND unbinding both go through
-- SECURITY DEFINER.
--
-- The privilege split is the security core and is asserted per function:
--   start_telegram_link()          authenticated  (mints for auth.uid() only)
--   consume_telegram_link_token()  service_role   — NOT authenticated: this is
--                                  the function that writes an identity link,
--                                  and its only legitimate caller is the
--                                  Telegram webhook holding the service key.
--   unlink_telegram()              authenticated  (clears auth.uid()'s own)
--
-- Privilege asserts use has_function_privilege, NOT a count over
-- information_schema.role_routine_grants: that view has no PUBLIC arm and
-- filters to enabled_roles, so it returns 0 whether or not PUBLIC holds
-- EXECUTE — it cannot fail on the exact default-grant hazard the migration's
-- `revoke ... from public` exists to kill. has_function_privilege resolves
-- PUBLIC through role inheritance (the 100-anon-exec-definer-harden pattern).
--
-- Every refusal assert below is PAIRED WITH A POSITIVE CONTROL through the same
-- caller: an `ok=false` on its own is equally consistent with "the guard works"
-- and "nothing works at all".
--
-- RED before the migration: the table, the column, the index and all three
-- functions do not exist.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Structure
-- ----------------------------------------------------------------------------
select has_table('public', 'telegram_link_tokens', 'telegram_link_tokens exists');
select has_column('public', 'telegram_link_tokens', 'token', 'has token');
select has_column('public', 'telegram_link_tokens', 'user_id', 'has user_id');
select has_column('public', 'telegram_link_tokens', 'expires_at', 'has expires_at');
select has_column('public', 'telegram_link_tokens', 'consumed_at', 'has consumed_at');
select has_column('public', 'telegram_link_tokens', 'consumed_chat_id', 'has consumed_chat_id');

select is(
  (select relrowsecurity from pg_class where oid = 'public.telegram_link_tokens'::regclass),
  true,
  'RLS is enabled on telegram_link_tokens'
);

-- No policies AND no grants: the table is reachable only through the DEFINER
-- functions and the service role. Both halves matter — RLS with a grant but no
-- policy is merely closed-by-accident.
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.telegram_link_tokens'::regclass),
  0,
  'telegram_link_tokens has no RLS policies (RPC-only table)'
);
select is(
  has_table_privilege('authenticated', 'public.telegram_link_tokens', 'SELECT'),
  false,
  'authenticated cannot select telegram_link_tokens directly'
);
select is(
  has_table_privilege('anon', 'public.telegram_link_tokens', 'SELECT'),
  false,
  'anon cannot select telegram_link_tokens directly'
);

select has_column('public', 'users', 'telegram_linked_at', 'users.telegram_linked_at exists');

-- One Telegram chat may back at most one app user, or a shared account would
-- deliver one person's notifications to another.
select is(
  (select count(*)::int from pg_index i
     where i.indrelid = 'public.users'::regclass
       and i.indisunique
       and pg_get_indexdef(i.indexrelid) like '%telegram_chat_id%'),
  1,
  'users.telegram_chat_id carries a unique index'
);

-- The Bot API deep-link payload is <= 64 chars of [A-Za-z0-9_-]; a token
-- outside that alphabet would be silently mangled by the t.me link, so the DB
-- refuses to store one.
select throws_ok(
  $$ insert into public.telegram_link_tokens (token, user_id, expires_at)
     select 'not a valid token!!', u.id, now() + interval '15 minutes'
     from public.users u limit 1 $$,
  '23514',
  null,
  'a token outside the Bot API alphabet is refused by the CHECK'
);

-- ----------------------------------------------------------------------------
-- B. Execute privileges
-- ----------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.start_telegram_link()', 'EXECUTE'), false,
  'anon cannot execute start_telegram_link');
select is(has_function_privilege('authenticated', 'public.start_telegram_link()', 'EXECUTE'), true,
  'authenticated CAN execute start_telegram_link');

select is(has_function_privilege('anon', 'public.consume_telegram_link_token(text, text)', 'EXECUTE'), false,
  'anon cannot execute consume_telegram_link_token');
select is(has_function_privilege('authenticated', 'public.consume_telegram_link_token(text, text)', 'EXECUTE'), false,
  'authenticated cannot execute consume_telegram_link_token (webhook/service-role only)');
select is(has_function_privilege('service_role', 'public.consume_telegram_link_token(text, text)', 'EXECUTE'), true,
  'service_role CAN execute consume_telegram_link_token');

select is(has_function_privilege('anon', 'public.unlink_telegram()', 'EXECUTE'), false,
  'anon cannot execute unlink_telegram');
select is(has_function_privilege('authenticated', 'public.unlink_telegram()', 'EXECUTE'), true,
  'authenticated CAN execute unlink_telegram');

-- ----------------------------------------------------------------------------
-- C. Minting, as a real authenticated caller (dev-preview)
-- ----------------------------------------------------------------------------
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "2c741de8-1e38-4806-a13d-1d9c541072de"}';

-- base64url of 32 random bytes, padding stripped = exactly 43 chars.
select matches(
  public.start_telegram_link(),
  '^[A-Za-z0-9_-]{43}$',
  'start_telegram_link returns a 43-char base64url token'
);

-- Mint a SECOND time; the rotation is counted after `reset role` below, because
-- reading the table directly as `authenticated` is precisely what assertion 9
-- forbids — the first run of this file errored 42501 here, which is the guard
-- working, not a defect in it.
select public.start_telegram_link();

-- Null-safe gate. `current setting is NULL` must REFUSE, not fall through —
-- the coalesce trap: a definer helper comparing NULL yields NULL, not false.
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.start_telegram_link() $$,
  '42501', null,
  'null-role caller refused: start_telegram_link'
);
select throws_ok(
  $$ select public.unlink_telegram() $$,
  '42501', null,
  'null-role caller refused: unlink_telegram'
);

reset role;

-- Minting ROTATES: an abandoned link must die the moment a new one is asked
-- for, or a token screenshotted an hour ago still binds. Two mints happened
-- above; exactly one open token may survive them.
select is(
  (select count(*)::int from public.telegram_link_tokens
     where user_id = '2c741de8-1e38-4806-a13d-1d9c541072de'
       and consumed_at is null),
  1,
  'minting rotates: only the newest unconsumed token survives'
);

-- ----------------------------------------------------------------------------
-- D. Consuming (the webhook's half)
-- ----------------------------------------------------------------------------
insert into public.telegram_link_tokens (token, user_id, expires_at)
values ('tap0000000000000000000000000000000000000AAA',
        '2c741de8-1e38-4806-a13d-1d9c541072de',
        now() + interval '15 minutes');

select is(
  public.consume_telegram_link_token('tap0000000000000000000000000000000000000AAA', 'tap-chat-1') ->> 'ok',
  'true',
  'a valid unexpired token binds the chat'
);
select is(
  (select telegram_chat_id from public.users where id = '2c741de8-1e38-4806-a13d-1d9c541072de'),
  'tap-chat-1',
  'the bind wrote users.telegram_chat_id'
);

-- Single use: a replayed token must not re-bind (a forwarded link would
-- otherwise let a second person capture the account).
select is(
  public.consume_telegram_link_token('tap0000000000000000000000000000000000000AAA', 'tap-chat-2') ->> 'reason',
  'invalid_or_expired',
  'a consumed token cannot be replayed'
);

insert into public.telegram_link_tokens (token, user_id, expires_at, created_at)
values ('tapEXPIRED000000000000000000000000000000BBB',
        '2c741de8-1e38-4806-a13d-1d9c541072de',
        now() - interval '1 minute',
        now() - interval '20 minutes');
select is(
  public.consume_telegram_link_token('tapEXPIRED000000000000000000000000000000BBB', 'tap-chat-3') ->> 'reason',
  'invalid_or_expired',
  'an expired token is refused'
);

-- A chat already bound to a DIFFERENT user is refused — permanent, not
-- retryable, which is why the webhook copy for this case must not say ลองใหม่.
insert into public.telegram_link_tokens (token, user_id, expires_at)
select 'tapOTHERUSER0000000000000000000000000000CCC', u.id, now() + interval '15 minutes'
from public.users u
where u.id <> '2c741de8-1e38-4806-a13d-1d9c541072de'
limit 1;

select is(
  public.consume_telegram_link_token('tapOTHERUSER0000000000000000000000000000CCC', 'tap-chat-1') ->> 'reason',
  'chat_already_linked',
  'a chat already bound to another user is refused'
);

-- POSITIVE CONTROL for the assert above: the SAME token through the SAME
-- caller must succeed against a free chat. Without this the refusal is equally
-- consistent with the token having been invalidated by the failed attempt.
select is(
  public.consume_telegram_link_token('tapOTHERUSER0000000000000000000000000000CCC', 'tap-chat-free') ->> 'ok',
  'true',
  'positive control: the same token binds a chat nobody holds'
);

-- ----------------------------------------------------------------------------
-- E. Unlink is self-scoped and one call
-- ----------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "2c741de8-1e38-4806-a13d-1d9c541072de"}';
select public.unlink_telegram();
reset role;

select is(
  (select telegram_chat_id from public.users where id = '2c741de8-1e38-4806-a13d-1d9c541072de'),
  null,
  'unlink_telegram clears the caller OWN chat id'
);

select * from finish();
rollback;
