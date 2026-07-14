-- spec 318 U1 — OA-friendship flag, refreshed at every LINE login by the
-- OAuth callback (service-role write; users grants unchanged: read-self RLS,
-- no authenticated UPDATE). null = never probed.

alter table public.users
  add column line_oa_friend boolean,
  add column line_oa_friend_checked_at timestamptz;

comment on column public.users.line_oa_friend is
  'spec 318: friendFlag from LINE friendship/v1/status at last login; null = never probed';
comment on column public.users.line_oa_friend_checked_at is
  'spec 318: when line_oa_friend was last refreshed (login-time probe)';
