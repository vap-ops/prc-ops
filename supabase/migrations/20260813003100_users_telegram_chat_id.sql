-- Telegram notification channel — a per-user Telegram chat id so the notification
-- drain can deliver to Telegram alongside LINE (a SECOND delivery channel, primarily
-- for super-admins). Nullable: a user only receives Telegram pushes once their chat id
-- is set (today, just the operator). The drain reads it server-side via the admin
-- (service_role) client; `users` carries table-level grants, so the new column is
-- covered with no extra grant — same exposure model as line_user_id (it is an id, not
-- a credential), so no RLS/grant change is warranted.

alter table public.users add column telegram_chat_id text;
