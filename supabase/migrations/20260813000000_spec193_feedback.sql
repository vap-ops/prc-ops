-- Spec 193 — in-app feedback: bug report / feature request. A settings-area form
-- lets any authenticated user file a report; CC reads the table (via the admin
-- client / `supabase db query`) with enough context to fix or build without a
-- round-trip — type, the structured body, the user-named screen, and the
-- AUTO-captured signals that matter most for triage: the submitter's ROLE (most
-- bugs are role/RLS-gated), the app VERSION (which code state), the USER-AGENT
-- (mobile-vs-desktop), and a best-effort page path.
--
-- submitted_by + role_snapshot are stamped by the definer RPC (not trusted from
-- the client). status carries a triage lifecycle (open → in_progress/done/declined)
-- for later. Writes are RPC-only; reads are own-or-super_admin (CC + the operator).

create type public.feedback_type as enum ('bug', 'feature');
create type public.feedback_status as enum ('open', 'in_progress', 'done', 'declined');

create table public.feedback (
  id            uuid primary key default gen_random_uuid(),
  type          public.feedback_type not null,
  title         text not null,
  body          text not null,
  screen        text,
  page_path     text,
  app_version   text,
  user_agent    text,
  status        public.feedback_status not null default 'open',
  submitted_by  uuid not null references public.users(id),
  role_snapshot public.user_role not null,
  created_at    timestamptz not null default now(),
  constraint feedback_title_len  check (length(title) between 1 and 200),
  constraint feedback_body_len   check (length(body) between 1 and 4000),
  constraint feedback_screen_len check (screen is null or length(screen) <= 200),
  constraint feedback_path_len   check (page_path is null or length(page_path) <= 500),
  constraint feedback_ver_len    check (app_version is null or length(app_version) <= 50),
  constraint feedback_ua_len     check (user_agent is null or length(user_agent) <= 500)
);
create index feedback_status_created_idx on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;
-- The submitter reads their own (to see status); super_admin (the operator + CC's
-- read role) reads all. Everyone else sees nothing. Writes are RPC-only (no insert
-- grant). Eval-once-wrapped (file 40).
create policy "feedback readable by submitter"
  on public.feedback for select to authenticated
  using (submitted_by = (select auth.uid()));
create policy "feedback readable by super_admin"
  on public.feedback for select to authenticated
  using ((select public.current_user_role()) = 'super_admin');

-- ----------------------------------------------------------------------------
-- submit_feedback — any authenticated user. submitted_by + role_snapshot are
-- captured server-side (never trusted from the client). p_type is enum-typed, so
-- an invalid type is rejected by the cast. Returns the new row id.
-- ----------------------------------------------------------------------------
create function public.submit_feedback(
  p_type        public.feedback_type,
  p_title       text,
  p_body        text,
  p_screen      text default null,
  p_page_path   text default null,
  p_app_version text default null,
  p_user_agent  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
  v_id   uuid;
begin
  if v_uid is null or v_role is null then
    raise exception 'submit_feedback: not signed in' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'submit_feedback: title required' using errcode = '22023';
  end if;
  if nullif(btrim(p_body), '') is null then
    raise exception 'submit_feedback: body required' using errcode = '22023';
  end if;

  insert into public.feedback
    (type, title, body, screen, page_path, app_version, user_agent, submitted_by, role_snapshot)
  values (p_type,
          btrim(p_title),
          btrim(p_body),
          nullif(btrim(p_screen), ''),
          nullif(btrim(p_page_path), ''),
          nullif(btrim(p_app_version), ''),
          nullif(btrim(p_user_agent), ''),
          v_uid,
          v_role)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_feedback(
  public.feedback_type, text, text, text, text, text, text) from public, anon;
grant execute on function public.submit_feedback(
  public.feedback_type, text, text, text, text, text, text) to authenticated;
