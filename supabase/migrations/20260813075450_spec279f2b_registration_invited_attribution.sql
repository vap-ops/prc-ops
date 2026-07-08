-- Spec 279 F2b — "log who invited who".
--
-- The SA's per-project self-onboard QR (spec 279 F2a, /sa/crew) already encodes
-- ?project=<id>&by=<sa_uid>. This migration lets the registration CAPTURE those at
-- mint time so the approver sees เชิญโดย: <SA> and the site pre-fills on approval.
--
-- Two nullable columns on staff_registrations + a re-signatured start RPC that
-- accepts them. TRUST: both refs are VISITOR-SUPPLIED (read off a URL), so they
-- are UNVERIFIED / ADVISORY only. They never drive an authorization decision — the
-- approver still confirms the site, and the workers.project_id binding is set from
-- the approver's OWN p_project_id at approve time (approve_staff_registration,
-- unchanged). The DEFINER RPC existence-COERCES a forged / mis-scanned / stale ref
-- to NULL, so a bad QR can neither violate the FK (which would block a legitimate
-- applicant) nor persist as garbage. ON DELETE SET NULL keeps attribution from
-- pinning a user/project row alive.

-- 1) Attribution columns (nullable; existing rows get NULL). FKs typed + validated
--    per house rule; ON DELETE SET NULL because attribution is a soft reference.
alter table public.staff_registrations
  add column invited_by uuid references auth.users(id) on delete set null,
  add column invited_project_id uuid references public.projects(id) on delete set null;

comment on column public.staff_registrations.invited_by is
  'Spec 279 F2b — the SA whose QR the applicant scanned (from ?by). Visitor-supplied → advisory, existence-coerced, never an authz edge.';
comment on column public.staff_registrations.invited_project_id is
  'Spec 279 F2b — the project the applicant is joining (from ?project). Visitor-supplied → advisory; pre-fills the approver''s site selector, which the approver confirms.';

-- 2) Re-signature start_staff_registration to accept the two advisory refs. A new
--    arg list is a NEW function object (CREATE OR REPLACE cannot change the arg
--    list), so DROP the old 3-arg overload first, then CREATE — and RE-REVOKE the
--    fresh PUBLIC/anon auto-grant Postgres puts on every new function. Body is the
--    live 3-arg body verbatim + the coerce + the two new INSERT columns.
drop function if exists public.start_staff_registration(text, text, text);

create function public.start_staff_registration(
  p_full_name text,
  p_phone text,
  p_declared_role_hint text default null,
  p_invited_by uuid default null,
  p_invited_project_id uuid default null
) returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_yy   int  := (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int;
  v_seq  int;
  v_emp  text;
  v_invited_by uuid;
  v_invited_project uuid;
begin
  if v_uid is null then
    raise exception 'start_staff_registration: not authenticated' using errcode = '42501';
  end if;
  if public.current_user_role() is distinct from 'visitor' then
    raise exception 'start_staff_registration: only a visitor may register' using errcode = '42501';
  end if;
  if exists (select 1 from public.staff_registrations where user_id = v_uid) then
    raise exception 'start_staff_registration: a registration already exists for this user'
      using errcode = 'P0001';
  end if;

  -- Existence-coerce the advisory invite refs (see header). A non-existent id
  -- (forged / mis-scanned / a since-deleted user or project) becomes NULL.
  v_invited_by := (select u.id from public.users u where u.id = p_invited_by);
  v_invited_project := (select p.id from public.projects p where p.id = p_invited_project_id);

  -- Row-locked gapless mint. First START of a year inserts (yy, 2) and hands out
  -- 1; each later START bumps next_val by one and hands out (next_val - 1). The
  -- ON CONFLICT DO UPDATE takes a row lock, serialising concurrent STARTs.
  insert into public.employee_id_counters (year, next_val)
    values (v_yy, 2)
  on conflict (year) do update
    set next_val = public.employee_id_counters.next_val + 1
  returning next_val - 1 into v_seq;

  v_emp := 'PRC-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.staff_registrations
    (user_id, employee_id, full_name, phone, declared_role_hint, invited_by, invited_project_id)
  values (
    v_uid,
    v_emp,
    nullif(btrim(coalesce(p_full_name, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_declared_role_hint, '')), ''),
    v_invited_by,
    v_invited_project
  );

  return v_emp;
end;
$function$;

revoke all on function public.start_staff_registration(text, text, text, uuid, uuid) from public, anon;
grant execute on function public.start_staff_registration(text, text, text, uuid, uuid) to authenticated;
