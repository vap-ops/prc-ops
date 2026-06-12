-- Spec 43 / ADR 0041 — device-code handoff for standalone PWA login.
--
-- Handshake state for OAuth flows started inside the installed PWA,
-- whose callback may land in a different browsing context (LINE's
-- auto-login reopens the callback in the system browser on iOS). The
-- callback binds the authenticated identity to the row; the PWA polls
-- with the device_code and the poll route mints the session in the
-- PWA's own cookie jar.
--
-- Zero user access (outbox posture, ADR 0037): privileges revoked, RLS
-- enabled with no policies; the only reader/writer is the service-role
-- client in /auth/handoff/* and the LINE callback. Deliberately
-- mutable — short-lived handshake state, not evidence; audit_log is
-- unaffected. Expired rows are purged opportunistically on each
-- handoff start (no cron; rows live 10 minutes).
--
-- user_email stores the ADR 0012 synthetic identity
-- (line_<sub>@line.local), not a FK — the poll route feeds it straight
-- to generateLink without an admin user lookup (ADR 0041).

create type public.login_handoff_status as enum
  ('pending', 'approved', 'consumed');

create table public.login_handoffs (
  id          uuid primary key default gen_random_uuid(),
  state       text not null unique,
  device_code text not null unique,
  status      public.login_handoff_status not null default 'pending',
  user_email  text,
  -- Verified id_token claims subset ({sub, name, picture}) stashed by
  -- the callback so the poll route can run the ADR 0012 profile write
  -- (NULL-only line_user_id/full_name + avatar refresh) at mint time.
  line_claims jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

revoke all on public.login_handoffs from authenticated, anon;
alter table public.login_handoffs enable row level security;
-- No policies on purpose: zero user access.
