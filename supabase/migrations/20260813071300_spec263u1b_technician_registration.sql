-- Spec 263 U1b (ADR 0071) — technician self-registration data layer + the
-- applicant's self-serve write path. This unit builds the staging substrate a
-- visitor self-registers into; the back-office approve/reject RPCs are U1c.
--
-- Doctrine (ADR 0071): a person arrives first with no record, taps START, is
-- handed a permanent person-level employee ID (gift-first, ADR 0061), and
-- progressively fills their own data while pending. Unverified self-entry never
-- reaches an authoritative table — the staging row sits in
-- technician_registrations until a human approves (U1c is the only writer into
-- workers). Substrate is NEW (ADR 0051 portal is invite-first/inverted); we
-- reuse the PATTERNS — DEFINER RPCs each with their own revoke/grant pair
-- (spec-258 anon-exec lesson), path-bound contact-docs storage (spec 97/131),
-- supersede attachments (ADR 0004/0009), a can_see-style RLS helper (spec 258).
--
-- House lessons applied verbatim:
--  * Every SECURITY DEFINER function gets `revoke all … from public, anon` +
--    `grant execute … to authenticated` (Postgres defaults new funcs to PUBLIC
--    EXECUTE incl. anon; the anon-exec-definer pin fails otherwise).
--  * Supabase default privileges grant authenticated/anon FULL DML on a new
--    public table → these hold PII, so after CREATE we `revoke all … from anon,
--    authenticated` then `grant select … to authenticated` (writes are RPC-only)
--    (spec 260 070800 lesson).
--  * The append-only attachments table additionally has NO update/delete grant
--    (revoked above) AND a BEFORE UPDATE/DELETE/TRUNCATE guard trigger.
--  * Every current_user_role()/auth.uid() call inside a policy is wrapped
--    `(select …)` for the rls-eval-once pin (file 40).
--  * An RLS USING clause may never directly query a table the caller's role
--    lacks SELECT on → the SA/site_owner cross-scope read routes through the
--    can_see_technician_registration SECURITY DEFINER helper (spec 258 lesson).
--  * gen_random_uuid() only (gen_random_bytes/pgcrypto in schema extensions is
--    unreachable under search_path=public).

-- ============================================================================
-- 1. Enums (new types — usable immediately, no committed-before-use split).
-- ============================================================================
create type public.registration_status  as enum ('pending', 'approved', 'rejected');
create type public.technician_doc_purpose as enum ('id_card', 'consent', 'profile_photo');

-- ============================================================================
-- 2. employee_id_counters — the gapless per-year mint source.
-- One row per year; next_val is the next sequence number to hand out. The mint
-- (inside start_technician_registration) does a row-locked upsert so two
-- concurrent STARTs cannot collide, and a rolled-back START rolls back the
-- increment (unlike a SEQUENCE, which skips on rollback).
-- Zero grant to anon/authenticated: only the SECURITY DEFINER mint touches it.
-- ============================================================================
create table public.employee_id_counters (
  year     int primary key,
  next_val int not null,
  constraint employee_id_counters_year_2digit check (year between 0 and 99),
  constraint employee_id_counters_next_positive check (next_val >= 1)
);
alter table public.employee_id_counters enable row level security;
revoke all on public.employee_id_counters from anon, authenticated;
-- No policies + no grants: the table is invisible/untouchable to app roles; the
-- DEFINER mint (function owner) is its only reader/writer.

comment on table public.employee_id_counters is
  'Spec 263 — per-year gapless counter for the PRC-YY-NNNN employee ID, advanced under a row lock by the mint inside start_technician_registration. Zero app-role grant; only the DEFINER mint touches it.';

-- ============================================================================
-- 3. technician_registrations — the staging record. One row per person, ever
-- (user_id UNIQUE, per ADR 0071 — re-application after rejection is out of
-- scope). Applicant fields nullable = progressive fill; completeness is a human
-- check at approval (U1c), not a DB NOT NULL.
-- ============================================================================
create table public.technician_registrations (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null unique references auth.users(id),
  employee_id                 text not null unique,
  full_name                   text null,
  phone                       text null,
  date_of_birth               date null,
  emergency_contact_name      text null,
  emergency_contact_relation  text null,
  emergency_contact_phone     text null,
  status                      public.registration_status not null default 'pending',
  reviewed_by                 uuid null references auth.users(id),
  reviewed_at                 timestamptz null,
  reject_reason               text null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint technician_registrations_full_name_len
    check (full_name is null or length(full_name) <= 200),
  constraint technician_registrations_phone_len
    check (phone is null or length(phone) <= 50),
  constraint technician_registrations_ec_name_len
    check (emergency_contact_name is null or length(emergency_contact_name) <= 200),
  constraint technician_registrations_ec_relation_len
    check (emergency_contact_relation is null or length(emergency_contact_relation) <= 100),
  constraint technician_registrations_ec_phone_len
    check (emergency_contact_phone is null or length(emergency_contact_phone) <= 50),
  constraint technician_registrations_employee_id_shape
    check (employee_id ~ '^PRC-[0-9]{2}-[0-9]{4}$')
);

alter table public.technician_registrations enable row level security;
-- PII table: strip the Supabase-default full DML, re-grant SELECT only (RLS
-- restricts rows). Writes go through the DEFINER RPCs below.
revoke all on public.technician_registrations from anon, authenticated;
grant select on public.technician_registrations to authenticated;

comment on table public.technician_registrations is
  'Spec 263 — technician self-registration staging record (one per person, user_id UNIQUE). Applicant self-serve writes go through start_/update_own_ RPCs; approval into workers is U1c. SELECT is RLS-scoped (own row + back-office read-all + SA/site_owner read-only via can_see_technician_registration).';

-- Keep updated_at fresh on the DEFINER-driven updates (set_updated_at exists
-- from 20260505143544). RPCs already set updated_at explicitly, but the trigger
-- is the belt to their braces and matches the users-table precedent.
create trigger technician_registrations_set_updated_at
  before update on public.technician_registrations
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 4. technician_registration_attachments — append-only, latest-per-purpose via
-- the supersede chain (ADR 0004 write / ADR 0009 read). A re-upload INSERTs a
-- new row whose superseded_by points at the prior live row of the same purpose
-- (canonical direction: new.superseded_by = old.id — the new row knows about
-- the old; no UPDATE, so the table stays truly append-only). Current per
-- purpose = anti-join (rows nothing supersedes), never `IS NULL`.
-- ============================================================================
create table public.technician_registration_attachments (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.technician_registrations(id),
  purpose         public.technician_doc_purpose not null,
  storage_path    text not null,
  uploaded_by     uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  superseded_by   uuid null references public.technician_registration_attachments(id),
  constraint technician_registration_attachments_path_shape
    check (length(btrim(storage_path)) > 0 and length(storage_path) <= 400)
);
create index technician_registration_attachments_reg_idx
  on public.technician_registration_attachments (registration_id, purpose, created_at desc);
create index technician_registration_attachments_superseded_by_idx
  on public.technician_registration_attachments (superseded_by)
  where superseded_by is not null;

alter table public.technician_registration_attachments enable row level security;
revoke all on public.technician_registration_attachments from anon, authenticated;
grant select on public.technician_registration_attachments to authenticated;

-- Append-only guard (photo_logs / contact_attachments posture): blocks even
-- SECURITY DEFINER / service-role mutation. The supersede link is set at INSERT
-- time on the NEW row, so no legitimate UPDATE is ever needed.
create function public.technician_registration_attachments_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'technician_registration_attachments is append-only: % not allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger technician_registration_attachments_block_update_delete
  before update or delete on public.technician_registration_attachments
  for each row execute function public.technician_registration_attachments_block_mutation();
create trigger technician_registration_attachments_block_truncate
  before truncate on public.technician_registration_attachments
  for each statement execute function public.technician_registration_attachments_block_mutation();

comment on table public.technician_registration_attachments is
  'Spec 263 — applicant document scans (id_card/consent/profile_photo) in the contact-docs bucket. APPEND-ONLY supersede chain (ADR 0004/0009): a re-upload inserts a new row with superseded_by = the prior live row; current per purpose = anti-join. Written only by add_technician_registration_doc.';

-- ============================================================================
-- 5. workers.employee_id — the person-key carried from the registration on
-- approval (U1c). Nullable so existing DC/own rows (all NULL) are unaffected;
-- partial-unique so each carried ID is unique without colliding NULLs. No
-- backfill.
-- ============================================================================
alter table public.workers add column employee_id text null;
create unique index workers_employee_id_unique
  on public.workers (employee_id)
  where employee_id is not null;
comment on column public.workers.employee_id is
  'Spec 263 — permanent person-level employee ID (PRC-YY-NNNN) carried from technician_registrations on approval (U1c). Partial-unique (WHERE NOT NULL); the anchor for the future DC→technician merge + work-passport surface.';

-- ============================================================================
-- 6. can_see_technician_registration(registration_id) — RLS helper.
-- SECURITY DEFINER so it can evaluate against tables/rows the CALLING role may
-- not directly read, per the spec-258 lesson (an RLS USING clause may never
-- directly query a table the caller lacks SELECT on). v1 seam: because a pending
-- registration carries NO project edge (human Web-Share routing, not a project
-- picker), the SA/site_owner arm returns the whole pending queue read-only —
-- this helper is exactly where a future registration→SA/site binding narrows it
-- to true project scope (spec 263 RLS scope note / ADR 0071 open question).
-- ============================================================================
create function public.can_see_technician_registration(p_registration_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    -- back-office approver set: sees every registration.
    (select public.current_user_role())
      in ('procurement_manager', 'project_director', 'super_admin')
    or (
      -- SA + site_owner: read-only view of the pending applicant queue (the v1
      -- seam; narrowed to project scope by a future referring-SA edge).
      (select public.current_user_role()) in ('site_admin', 'site_owner')
      and exists (
        select 1 from public.technician_registrations r
         where r.id = p_registration_id
           and r.status = 'pending'
      )
    );
$$;
revoke all on function public.can_see_technician_registration(uuid) from public, anon;
grant execute on function public.can_see_technician_registration(uuid) to authenticated;
comment on function public.can_see_technician_registration(uuid) is
  'Spec 263 — true if the caller may READ a technician registration: back-office approver set (procurement_manager/project_director/super_admin) sees all; site_admin/site_owner see the pending queue read-only (the v1 seam a future project-scope edge narrows). SECURITY DEFINER so RLS policies can call it without granting the caller direct SELECT.';

-- ============================================================================
-- 7. RLS policies.
-- ============================================================================
-- technician_registrations — applicant reads own; everyone else reads via the
-- can_see helper (back-office all + SA/site_owner pending queue). No write
-- policy: all writes are DEFINER-RPC only.
create policy "technician_registrations own row readable by applicant"
  on public.technician_registrations
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "technician_registrations readable by back office and site read"
  on public.technician_registrations
  for select
  to authenticated
  using (public.can_see_technician_registration(id));

-- technician_registration_attachments — applicant reads own (join to own
-- registration); back-office/site read via the parent's can_see helper. No
-- write policy (DEFINER-RPC only; append-only guard blocks mutation regardless).
create policy "technician_registration_attachments readable by applicant"
  on public.technician_registration_attachments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.technician_registrations r
       where r.id = technician_registration_attachments.registration_id
         and r.user_id = (select auth.uid())
    )
  );

create policy "technician_registration_attachments readable by back office and site read"
  on public.technician_registration_attachments
  for select
  to authenticated
  using (public.can_see_technician_registration(registration_id));

-- ============================================================================
-- 8. Self-serve RPCs — SECURITY DEFINER, own revoke/grant pair each.
-- ============================================================================

-- start_technician_registration — visitor only, acting on own uid. One-live-
-- per-user guard (clean error ahead of the user_id UNIQUE backstop) → mint the
-- PRC-YY-NNNN ID from employee_id_counters under a row lock (upsert) → INSERT
-- the pending row → return the employee_id.
create function public.start_technician_registration(
  p_full_name text,
  p_phone     text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_yy   int  := (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int;
  v_seq  int;
  v_emp  text;
begin
  if v_uid is null then
    raise exception 'start_technician_registration: not authenticated' using errcode = '42501';
  end if;
  if public.current_user_role() is distinct from 'visitor' then
    raise exception 'start_technician_registration: only a visitor may register' using errcode = '42501';
  end if;
  if exists (select 1 from public.technician_registrations where user_id = v_uid) then
    raise exception 'start_technician_registration: a registration already exists for this user'
      using errcode = 'P0001';
  end if;

  -- Row-locked gapless mint. First START of a year inserts (yy, 2) and hands out
  -- 1; each later START bumps next_val by one and hands out (next_val - 1). The
  -- ON CONFLICT DO UPDATE takes a row lock, serialising concurrent STARTs.
  insert into public.employee_id_counters (year, next_val)
    values (v_yy, 2)
  on conflict (year) do update
    set next_val = public.employee_id_counters.next_val + 1
  returning next_val - 1 into v_seq;

  v_emp := 'PRC-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.technician_registrations (user_id, employee_id, full_name, phone)
  values (
    v_uid,
    v_emp,
    nullif(btrim(coalesce(p_full_name, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), '')
  );

  return v_emp;
end;
$$;
revoke all on function public.start_technician_registration(text, text) from public, anon;
grant execute on function public.start_technician_registration(text, text) to authenticated;

-- update_own_technician_registration — applicant, own row, PENDING only. Updates
-- only the self fields (name/phone/DOB/emergency_*); coalesce semantics (omitted
-- = preserved). Cannot touch status/employee_id/reviewed_*. NULL-clearing is not
-- offered (a blank collapses to preserve) — progressive fill only adds.
create function public.update_own_technician_registration(
  p_full_name                  text default null,
  p_phone                      text default null,
  p_date_of_birth              date default null,
  p_emergency_contact_name     text default null,
  p_emergency_contact_relation text default null,
  p_emergency_contact_phone    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.technician_registrations%rowtype;
begin
  if v_uid is null then
    raise exception 'update_own_technician_registration: not authenticated' using errcode = '42501';
  end if;
  select * into v_row from public.technician_registrations where user_id = v_uid;
  if not found then
    raise exception 'update_own_technician_registration: no registration for this user'
      using errcode = 'P0001';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'update_own_technician_registration: registration is no longer pending'
      using errcode = 'P0001';
  end if;

  update public.technician_registrations
     set full_name                  = coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), full_name),
         phone                      = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
         date_of_birth              = coalesce(p_date_of_birth, date_of_birth),
         emergency_contact_name     = coalesce(nullif(btrim(coalesce(p_emergency_contact_name, '')), ''), emergency_contact_name),
         emergency_contact_relation = coalesce(nullif(btrim(coalesce(p_emergency_contact_relation, '')), ''), emergency_contact_relation),
         emergency_contact_phone    = coalesce(nullif(btrim(coalesce(p_emergency_contact_phone, '')), ''), emergency_contact_phone),
         updated_at                 = now()
   where id = v_row.id;
end;
$$;
revoke all on function public.update_own_technician_registration(text, text, date, text, text, text) from public, anon;
grant execute on function public.update_own_technician_registration(text, text, date, text, text, text) to authenticated;

-- add_technician_registration_doc — applicant, own row, PENDING only. INSERTs an
-- attachment; if a live row for that purpose exists, the new row supersedes it
-- (superseded_by = the prior live row). Append-only: the supersede link is set
-- at INSERT on the new row; the old row is never touched.
create function public.add_technician_registration_doc(
  p_purpose      public.technician_doc_purpose,
  p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.technician_registrations%rowtype;
  v_path  text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_prior uuid;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'add_technician_registration_doc: not authenticated' using errcode = '42501';
  end if;
  if p_purpose is null then
    raise exception 'add_technician_registration_doc: purpose required' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'add_technician_registration_doc: storage_path required' using errcode = 'P0001';
  end if;
  select * into v_row from public.technician_registrations where user_id = v_uid;
  if not found then
    raise exception 'add_technician_registration_doc: no registration for this user'
      using errcode = 'P0001';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'add_technician_registration_doc: registration is no longer pending'
      using errcode = 'P0001';
  end if;

  -- The current live row of this purpose (anti-join head), if any.
  select a.id into v_prior
    from public.technician_registration_attachments a
   where a.registration_id = v_row.id
     and a.purpose = p_purpose
     and not exists (
       select 1 from public.technician_registration_attachments n
        where n.superseded_by = a.id
     )
   limit 1;

  insert into public.technician_registration_attachments
    (registration_id, purpose, storage_path, uploaded_by, superseded_by)
  values (v_row.id, p_purpose, v_path, v_uid, v_prior)
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_technician_registration_doc(public.technician_doc_purpose, text) from public, anon;
grant execute on function public.add_technician_registration_doc(public.technician_doc_purpose, text) to authenticated;

-- ============================================================================
-- 9. Storage — reuse the existing private contact-docs bucket. Path-bound
-- INSERT + SELECT policies scoping the applicant to their own
-- technician/<auth.uid()>/<purpose>/ prefix (mirrors spec 131's own-contractor
-- policy, keyed on auth.uid() not contractor_id). objects.name is qualified
-- (the spec-97 name-capture hazard). Every uid call wrapped (select …).
-- Foldername of technician/<uid>/<purpose>/<file>.<ext> = [technician, uid, purpose].
-- ============================================================================
create policy "technician doc uploads by applicant"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(objects.name), 1) = 3
    and (storage.foldername(objects.name))[1] = 'technician'
    and (storage.foldername(objects.name))[2] = (select auth.uid()::text)
    and (storage.foldername(objects.name))[3] in ('id_card', 'consent', 'profile_photo')
  );

create policy "technician doc reads by applicant"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(objects.name), 1) = 3
    and (storage.foldername(objects.name))[1] = 'technician'
    and (storage.foldername(objects.name))[2] = (select auth.uid()::text)
    and (storage.foldername(objects.name))[3] in ('id_card', 'consent', 'profile_photo')
  );
