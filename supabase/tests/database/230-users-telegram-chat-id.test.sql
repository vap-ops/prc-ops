begin;
select plan(3);

-- ============================================================================
-- Telegram notification channel — users.telegram_chat_id is the per-user Telegram
-- chat id the notification drain reads (via the service_role admin client) to push
-- to Telegram alongside LINE. Nullable text; same exposure model as line_user_id.
-- ============================================================================

select has_column('public', 'users', 'telegram_chat_id', 'users.telegram_chat_id exists');
select col_type_is('public', 'users', 'telegram_chat_id', 'text', 'telegram_chat_id is text');
select is(
  has_column_privilege('service_role', 'public.users', 'telegram_chat_id', 'SELECT'),
  true, 'service_role (the drain) can read telegram_chat_id');

select * from finish();
rollback;
