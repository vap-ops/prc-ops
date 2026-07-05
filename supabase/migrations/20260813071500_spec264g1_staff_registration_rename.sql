-- Spec 264 G1 (ADR 0072) — generalize the technician self-registration substrate
-- into a role-neutral STAFF self-onboarding substrate, and make the approve RPC
-- role-parametric with a per-role side-effect. Technician becomes instance #1.
--
-- ADR 0072 supersedes ADR 0071. Spec 263 shipped a technician-NAMED substrate
-- (tables technician_registrations / technician_registration_attachments, enum
-- technician_doc_purpose, RPCs *_technician_registration + can_see helper). This
-- unit RENAMES those to staff_* IN PLACE (ALTER ... RENAME — preserves all data,
-- incl. the one live PRC-26-0001 pending row) and generalizes the approve.
--
-- ATOMIC-with-code: this migration renames the DB objects; the same PR renames
-- every src/ reference + regenerates database.types.ts, so `main` is never left
-- half-renamed and CI stays green.
--
-- House lessons applied verbatim (carried from spec 263 U1b/U1c):
--  * Every SECURITY DEFINER function keeps its OWN `revoke all … from public,
--    anon` + `grant execute … to authenticated` pair (Postgres defaults new funcs
--    to PUBLIC EXECUTE incl. anon — the spec-258 anon-exec pin).
--  * RPC bodies re-sourced VERBATIM from LIVE (pg_get_functiondef) then edited —
--    never reconstructed from an old file (db-migration-lessons). Only the object
--    names + the parametric widening + the PII copy + the consent floor change.
--  * An RLS USING clause never directly queries a table the caller lacks SELECT on
--    → the SA/site_owner cross-scope read routes through can_see_staff_registration.
--  * Every current_user_role()/auth.uid() call in a policy wrapped `(select …)`
--    (rls-eval-once pin).
--  * audit_log is append-only (INSERT only); role_change / worker_change are
--    EXISTING audit actions (no enum growth).

-- ============================================================================
-- 1. Rename the tables IN PLACE (preserves data + the live PRC-26-0001 row).
--    ALTER TABLE RENAME keeps constraints/indexes/RLS/grants; policies + triggers
--    + FK targets follow the table automatically. We rename the two staging
--    tables; employee_id_counters keeps its already-role-neutral name.
-- ============================================================================
alter table public.technician_registrations rename to staff_registrations;
alter table public.technician_registration_attachments rename to staff_registration_attachments;

comment on table public.staff_registrations is
  'Spec 264 (ADR 0072) — role-neutral staff self-onboarding staging record (one per person, user_id UNIQUE). Any internal staffer self-registers here; the approver assigns the authoritative role at approval. Applicant self-serve writes go through start_/update_own_ RPCs; approval into a role (+ workers row for field roles) is approve_staff_registration. SELECT is RLS-scoped (own row + back-office read-all + SA/site_owner pending read via can_see_staff_registration). Renamed in place from technician_registrations (spec 263).';
comment on table public.staff_registration_attachments is
  'Spec 264 (ADR 0072) — applicant document scans (id_card/profile_photo) in the contact-docs bucket. APPEND-ONLY supersede chain (ADR 0004/0009): a re-upload inserts a new row with superseded_by = the prior live row; current per purpose = anti-join. Written only by add_staff_registration_doc. Renamed in place from technician_registration_attachments (spec 263). The consent doc-purpose was retired — PDPA consent is now an in-app record (staff_consents).';

-- ============================================================================
-- 2. declared_role_hint — optional applicant "joining as" free text (ADR 0072 §3).
--    Advisory routing context for the approver ONLY: never a gate, never written
--    to users.role. Stored as free text (never a user_role value) so a
--    self-entered field cannot reach an enum column.
-- ============================================================================
alter table public.staff_registrations
  add column declared_role_hint text null,
  add constraint staff_registrations_role_hint_len
    check (declared_role_hint is null or length(declared_role_hint) <= 120);
comment on column public.staff_registrations.declared_role_hint is
  'Spec 264 (ADR 0072 §3) — optional applicant-declared "joining as" hint (free text, e.g. "ช่างไฟ"/"จัดซื้อ"). ADVISORY only: shown to the approver for routing; never a gate, never written to users.role. The approver picks the authoritative role.';

-- ============================================================================
-- 3. Enum: technician_doc_purpose → staff_doc_purpose, dropping `consent`.
--    Postgres cannot drop an enum value in place, so: create the new type with
--    the two remaining values, swap the column over (verified live: zero
--    attachment rows use `consent`, so the cast is total), drop the old type.
--    The RPCs that reference the old enum are dropped in step 5 BEFORE this runs
--    would fail on the type dependency — so order matters: we drop the RPCs
--    first (step 4), then swap the enum, then recreate the RPCs (step 5+).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4. Drop the old RPCs + helper (they depend on the old table/enum names). They
--    are recreated with staff_* names + bodies below. Dropping first lets us
--    swap the enum and rename cleanly.
--
--    The old RLS policies were CARRIED OVER onto the renamed tables (ALTER TABLE
--    RENAME keeps policies) but still reference can_see_technician_registration —
--    so they must be dropped BEFORE the helper (else DROP FUNCTION 2BP01s on the
--    policy dependency). Recreated in step 6.
-- ----------------------------------------------------------------------------
drop policy if exists "technician_registrations own row readable by applicant" on public.staff_registrations;
drop policy if exists "technician_registrations readable by back office and site read" on public.staff_registrations;
drop policy if exists "technician_registration_attachments readable by applicant" on public.staff_registration_attachments;
drop policy if exists "technician_registration_attachments readable by back office and site read" on public.staff_registration_attachments;

drop function if exists public.start_technician_registration(text, text);
drop function if exists public.update_own_technician_registration(text, text, date, text, text, text);
drop function if exists public.add_technician_registration_doc(public.technician_doc_purpose, text);
drop function if exists public.approve_technician_registration(uuid, uuid);
drop function if exists public.reject_technician_registration(uuid, text);
drop function if exists public.can_see_technician_registration(uuid);

-- Now the only remaining dependency on technician_doc_purpose is the
-- staff_registration_attachments.purpose column. Swap it to the new type.
create type public.staff_doc_purpose as enum ('id_card', 'profile_photo');
alter table public.staff_registration_attachments
  alter column purpose type public.staff_doc_purpose
  using purpose::text::public.staff_doc_purpose;
drop type public.technician_doc_purpose;

-- ============================================================================
-- 5. can_see_staff_registration(registration_id) — the RLS helper, renamed.
--    Body re-sourced from live; only the table + function names change. Same v1
--    seam: back-office approver set sees all; SA/site_owner see the pending queue.
-- ============================================================================
create function public.can_see_staff_registration(p_registration_id uuid)
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
        select 1 from public.staff_registrations r
         where r.id = p_registration_id
           and r.status = 'pending'
      )
    );
$$;
revoke all on function public.can_see_staff_registration(uuid) from public, anon;
grant execute on function public.can_see_staff_registration(uuid) to authenticated;
comment on function public.can_see_staff_registration(uuid) is
  'Spec 264 (ADR 0072) — true if the caller may READ a staff registration: back-office approver set (procurement_manager/project_director/super_admin) sees all; site_admin/site_owner see the pending queue read-only (the v1 seam a future project-scope edge narrows). SECURITY DEFINER so RLS policies can call it without granting the caller direct SELECT. Renamed from can_see_technician_registration (spec 263).';

-- ============================================================================
-- 6. RLS policies — recreate referencing the renamed table + helper. The
--    carried-over OLD policies were dropped in step 4 (before the helper).
-- ============================================================================
create policy "staff_registrations own row readable by applicant"
  on public.staff_registrations
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "staff_registrations readable by back office and site read"
  on public.staff_registrations
  for select
  to authenticated
  using (public.can_see_staff_registration(id));

create policy "staff_registration_attachments readable by applicant"
  on public.staff_registration_attachments
  for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_registrations r
       where r.id = staff_registration_attachments.registration_id
         and r.user_id = (select auth.uid())
    )
  );

create policy "staff_registration_attachments readable by back office and site read"
  on public.staff_registration_attachments
  for select
  to authenticated
  using (public.can_see_staff_registration(registration_id));

-- ============================================================================
-- 7. staff_consents — the PDPA consent RECORD (ADR 0072 §7), replacing the
--    dropped `consent` document upload. Mirrors the contractor_consents pattern
--    (migration 20260709000100): dated, scoped, revocable. Keyed on the
--    registration + the applicant's user_id. Writes are RPC-only.
-- ============================================================================
create type public.staff_consent_kind as enum ('pdpa_data');

create table public.staff_consents (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.staff_registrations(id),
  user_id         uuid not null references auth.users(id),
  kind            public.staff_consent_kind not null,
  consented_at    timestamptz not null default now(),
  recorded_by     uuid not null references auth.users(id),
  revoked_at      timestamptz null,
  created_at      timestamptz not null default now()
);
create index staff_consents_registration_idx on public.staff_consents (registration_id, kind);
create index staff_consents_user_idx on public.staff_consents (user_id, kind);

alter table public.staff_consents enable row level security;
revoke all on public.staff_consents from anon, authenticated;
grant select on public.staff_consents to authenticated;

comment on table public.staff_consents is
  'Spec 264 (ADR 0072 §7) — dated, revocable PDPA consent records for staff self-onboarding. Replaces the spec-263 consent file upload with a structured in-app record (who/when/kind/revocable). One live (non-revoked) pdpa_data record is part of the approve floor. Written only by record_staff_consent; SELECT is RLS-scoped (applicant own + back-office/site read via can_see_staff_registration).';

-- Applicant reads own consent rows; back-office/site read via the parent's helper.
create policy "staff_consents readable by applicant"
  on public.staff_consents
  for select
  to authenticated
  using (user_id = (select auth.uid()));
create policy "staff_consents readable by back office and site read"
  on public.staff_consents
  for select
  to authenticated
  using (public.can_see_staff_registration(registration_id));

-- record_staff_consent — the applicant records their OWN consent for their own
-- live pending registration. Self-serve DEFINER (own revoke/grant pair). Returns
-- the consent id. A new record per call (append; revocation is a future unit).
create function public.record_staff_consent(
  p_kind public.staff_consent_kind default 'pdpa_data'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reg public.staff_registrations%rowtype;
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'record_staff_consent: not authenticated' using errcode = '42501';
  end if;
  select * into v_reg from public.staff_registrations where user_id = v_uid;
  if not found then
    raise exception 'record_staff_consent: no registration for this user' using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'record_staff_consent: registration is no longer pending' using errcode = 'P0001';
  end if;

  insert into public.staff_consents (registration_id, user_id, kind, recorded_by)
  values (v_reg.id, v_uid, coalesce(p_kind, 'pdpa_data'), v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_staff_consent(public.staff_consent_kind) from public, anon;
grant execute on function public.record_staff_consent(public.staff_consent_kind) to authenticated;
comment on function public.record_staff_consent(public.staff_consent_kind) is
  'Spec 264 (ADR 0072 §7) — the applicant records their OWN PDPA consent (pdpa_data by default) for their own pending staff_registration. Self-serve SECURITY DEFINER; writes a dated staff_consents row. A live (non-revoked) record is part of the approve floor.';

-- ============================================================================
-- 8. Self-serve write RPCs — renamed to staff_*, bodies re-sourced from live +
--    the declared_role_hint thread-through. Each keeps its own revoke/grant pair.
-- ============================================================================

-- start_staff_registration — visitor only, own uid. One-live-per-user → mint the
-- PRC-YY-NNNN id under a row lock → INSERT the pending row (now also capturing the
-- optional declared_role_hint) → return the employee_id.
create function public.start_staff_registration(
  p_full_name          text,
  p_phone              text,
  p_declared_role_hint text default null
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
    raise exception 'start_staff_registration: not authenticated' using errcode = '42501';
  end if;
  if public.current_user_role() is distinct from 'visitor' then
    raise exception 'start_staff_registration: only a visitor may register' using errcode = '42501';
  end if;
  if exists (select 1 from public.staff_registrations where user_id = v_uid) then
    raise exception 'start_staff_registration: a registration already exists for this user'
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

  insert into public.staff_registrations (user_id, employee_id, full_name, phone, declared_role_hint)
  values (
    v_uid,
    v_emp,
    nullif(btrim(coalesce(p_full_name, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_declared_role_hint, '')), '')
  );

  return v_emp;
end;
$$;
revoke all on function public.start_staff_registration(text, text, text) from public, anon;
grant execute on function public.start_staff_registration(text, text, text) to authenticated;

-- update_own_staff_registration — applicant, own row, PENDING only. Coalesce
-- semantics (omitted = preserved). Now also threads the optional
-- declared_role_hint. Cannot touch status/employee_id/reviewed_*/role.
create function public.update_own_staff_registration(
  p_full_name                  text default null,
  p_phone                      text default null,
  p_date_of_birth              date default null,
  p_emergency_contact_name     text default null,
  p_emergency_contact_relation text default null,
  p_emergency_contact_phone    text default null,
  p_declared_role_hint         text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.staff_registrations%rowtype;
begin
  if v_uid is null then
    raise exception 'update_own_staff_registration: not authenticated' using errcode = '42501';
  end if;
  select * into v_row from public.staff_registrations where user_id = v_uid;
  if not found then
    raise exception 'update_own_staff_registration: no registration for this user'
      using errcode = 'P0001';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'update_own_staff_registration: registration is no longer pending'
      using errcode = 'P0001';
  end if;

  update public.staff_registrations
     set full_name                  = coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), full_name),
         phone                      = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), phone),
         date_of_birth              = coalesce(p_date_of_birth, date_of_birth),
         emergency_contact_name     = coalesce(nullif(btrim(coalesce(p_emergency_contact_name, '')), ''), emergency_contact_name),
         emergency_contact_relation = coalesce(nullif(btrim(coalesce(p_emergency_contact_relation, '')), ''), emergency_contact_relation),
         emergency_contact_phone    = coalesce(nullif(btrim(coalesce(p_emergency_contact_phone, '')), ''), emergency_contact_phone),
         declared_role_hint         = coalesce(nullif(btrim(coalesce(p_declared_role_hint, '')), ''), declared_role_hint),
         updated_at                 = now()
   where id = v_row.id;
end;
$$;
revoke all on function public.update_own_staff_registration(text, text, date, text, text, text, text) from public, anon;
grant execute on function public.update_own_staff_registration(text, text, date, text, text, text, text) to authenticated;

-- add_staff_registration_doc — applicant, own row, PENDING only. INSERTs an
-- attachment; supersedes the prior live row of the same purpose. Purpose is now
-- the two-value staff_doc_purpose (consent retired).
create function public.add_staff_registration_doc(
  p_purpose      public.staff_doc_purpose,
  p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_row   public.staff_registrations%rowtype;
  v_path  text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_prior uuid;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'add_staff_registration_doc: not authenticated' using errcode = '42501';
  end if;
  if p_purpose is null then
    raise exception 'add_staff_registration_doc: purpose required' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'add_staff_registration_doc: storage_path required' using errcode = 'P0001';
  end if;
  select * into v_row from public.staff_registrations where user_id = v_uid;
  if not found then
    raise exception 'add_staff_registration_doc: no registration for this user'
      using errcode = 'P0001';
  end if;
  if v_row.status is distinct from 'pending' then
    raise exception 'add_staff_registration_doc: registration is no longer pending'
      using errcode = 'P0001';
  end if;

  -- The current live row of this purpose (anti-join head), if any.
  select a.id into v_prior
    from public.staff_registration_attachments a
   where a.registration_id = v_row.id
     and a.purpose = p_purpose
     and not exists (
       select 1 from public.staff_registration_attachments n
        where n.superseded_by = a.id
     )
   limit 1;

  insert into public.staff_registration_attachments
    (registration_id, purpose, storage_path, uploaded_by, superseded_by)
  values (v_row.id, p_purpose, v_path, v_uid, v_prior)
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_staff_registration_doc(public.staff_doc_purpose, text) from public, anon;
grant execute on function public.add_staff_registration_doc(public.staff_doc_purpose, text) to authenticated;

-- ============================================================================
-- 9. approve_staff_registration(p_id, p_role, p_project_id default null) — the
--    role-parametric authoritative approve (ADR 0072 §4). Body re-sourced from
--    the live approve_technician_registration + generalized:
--      * NEW p_role param, guarded against STAFF_ASSIGNABLE_ROLES (internal roles
--        only — visitor/contractor/client/super_admin REJECTED, the privilege
--        boundary).
--      * Floor now also requires a live (non-revoked) staff_consents record.
--      * users.role = p_role (was hard-coded 'technician').
--      * Per-role side-effect branched on STAFF_FIELD_ROLES (currently {technician}):
--        FIELD role → workers INSERT WITH the applicant's PII copied (phone/DOB/
--        emergency_*); OFFICE role → role assignment only, NO workers row.
--      * Returns the worker id (field) or NULL (office).
--    Still ATOMIC (one plpgsql body = one transaction); role flip INLINE (never
--    nests set_user_role — its gate is super_admin-only).
-- ============================================================================
create function public.approve_staff_registration(
  p_id         uuid,
  p_role       public.user_role,
  p_project_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_reg        public.staff_registrations%rowtype;
  v_old_role   public.user_role;
  v_worker_id  uuid;
  v_name       text;
begin
  -- 1. Gate the approver: the small explicit approver set (null-safe).
  if v_actor_role is null
     or v_actor_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'approve_staff_registration: role not permitted'
      using errcode = '42501';
  end if;

  -- 2. Guard p_role — STAFF_ASSIGNABLE_ROLES (internal roles only). This is the
  --    privilege boundary: never assign visitor/contractor/client/super_admin
  --    through a self-serve applicant flow (super_admin stays operator-minted via
  --    set_user_role/ADR 0050). A null p_role is rejected too.
  if p_role is null
     or p_role not in (
       'technician', 'procurement', 'procurement_manager', 'accounting', 'hr',
       'project_coordinator', 'site_admin', 'project_manager', 'project_director',
       'site_owner', 'subcon_manager', 'auditor'
     ) then
    raise exception 'approve_staff_registration: role % is not assignable through staff onboarding', coalesce(p_role::text, 'null')
      using errcode = '42501';
  end if;

  -- 3. Target must exist AND be pending (also blocks double-approve).
  select * into v_reg from public.staff_registrations where id = p_id;
  if not found then
    raise exception 'approve_staff_registration: registration not found'
      using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'approve_staff_registration: registration is not pending'
      using errcode = 'P0001';
  end if;

  -- 4. Floor — no nameless / doc-less / consent-less approval. full_name present
  --    AND a LIVE id_card attachment (anti-join head, ADR 0009) AND a LIVE
  --    (non-revoked) PDPA consent record.
  v_name := nullif(btrim(coalesce(v_reg.full_name, '')), '');
  if v_name is null then
    raise exception 'approve_staff_registration: full_name required before approval'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.staff_registration_attachments a
     where a.registration_id = v_reg.id
       and a.purpose = 'id_card'
       and not exists (
         select 1 from public.staff_registration_attachments n
          where n.superseded_by = a.id
       )
  ) then
    raise exception 'approve_staff_registration: an id_card attachment is required before approval'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.staff_consents c
     where c.registration_id = v_reg.id
       and c.kind = 'pdpa_data'
       and c.revoked_at is null
  ) then
    raise exception 'approve_staff_registration: a PDPA consent record is required before approval'
      using errcode = 'P0001';
  end if;

  -- 5. Approve the staging row.
  update public.staff_registrations
     set status      = 'approved',
         reviewed_by = v_actor,
         reviewed_at = now(),
         updated_at  = now()
   where id = v_reg.id;

  -- 6. Flip the applicant's role to p_role INLINE (never nest set_user_role — its
  --    gate is super_admin-only; a nested call would 42501 a proc_mgr/PD approver)
  --    + the matching role_change audit row (house style).
  select role into v_old_role from public.users where id = v_reg.user_id;
  update public.users set role = p_role, updated_at = now()
   where id = v_reg.user_id;
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_actor, v_actor_role, 'role_change', 'users', v_reg.user_id,
     jsonb_build_object('from', v_old_role, 'to', p_role));

  -- 7. Per-role side-effect, branched on STAFF_FIELD_ROLES (currently just
  --    'technician'). A future field role joins by adding to this IN list.
  --    FIELD role → INSERT the authoritative worker WITH the applicant's
  --    self-reported PII copied onto it (those columns exist — ADR 0062 U1/U4b).
  --    OFFICE role → role assignment only; NO workers row (the carried
  --    employee_id stays on the staging row).
  if p_role in ('technician') then
    insert into public.workers
      (name, worker_type, user_id, employee_id, active, created_by, project_id,
       phone, date_of_birth,
       emergency_contact_name, emergency_contact_relation, emergency_contact_phone)
    values
      (v_name, 'own', v_reg.user_id, v_reg.employee_id, true, v_actor, p_project_id,
       v_reg.phone, v_reg.date_of_birth,
       v_reg.emergency_contact_name, v_reg.emergency_contact_relation, v_reg.emergency_contact_phone)
    returning id into v_worker_id;

    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (v_actor, v_actor_role, 'worker_change', 'workers', v_worker_id,
       jsonb_build_object('kind', 'create', 'source', 'staff_registration',
                          'registration_id', v_reg.id, 'employee_id', v_reg.employee_id,
                          'role', p_role));
  end if;

  -- Field branch returns the new worker id; office branch returns NULL.
  return v_worker_id;
end;
$$;
revoke all on function public.approve_staff_registration(uuid, public.user_role, uuid) from public, anon;
grant execute on function public.approve_staff_registration(uuid, public.user_role, uuid) to authenticated;
comment on function public.approve_staff_registration(uuid, public.user_role, uuid) is
  'Spec 264 (ADR 0072 §4) — role-parametric back-office (procurement_manager/project_director/super_admin) approval of a pending staff registration. ATOMIC: guards p_role against STAFF_ASSIGNABLE_ROLES (never visitor/contractor/client/super_admin), asserts the floor (full_name + live id_card + live PDPA consent), flips status to approved, flips users.role to p_role INLINE (never nests set_user_role), and — for a FIELD role (STAFF_FIELD_ROLES={technician}) — inserts the one authoritative workers(worker_type=own, employee_id carried, active, PII copied) row + role_change & worker_change audits. Office roles get role assignment only (no workers row). Returns the new worker id (field) or NULL (office). Generalized from approve_technician_registration (spec 263).';

-- ============================================================================
-- 10. reject_staff_registration(p_id, p_reason) — pure rename, behavior
--     unchanged. Body re-sourced from live; only object names change.
-- ============================================================================
create function public.reject_staff_registration(
  p_id     uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_reg        public.staff_registrations%rowtype;
begin
  -- 1. Gate: same explicit approver set, null-safe.
  if v_actor_role is null
     or v_actor_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'reject_staff_registration: role not permitted'
      using errcode = '42501';
  end if;

  -- 2. Target must exist AND be pending (idempotency).
  select * into v_reg from public.staff_registrations where id = p_id;
  if not found then
    raise exception 'reject_staff_registration: registration not found'
      using errcode = 'P0001';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'reject_staff_registration: registration is not pending'
      using errcode = 'P0001';
  end if;

  -- 3. Reject the staging row. No authoritative write — the burned employee_id
  --    stays on the staging row; no role change, no workers row.
  update public.staff_registrations
     set status        = 'rejected',
         reviewed_by   = v_actor,
         reviewed_at   = now(),
         reject_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         updated_at    = now()
   where id = v_reg.id;

  -- 4. Audit the rejection (existing worker_change action; target the staging row).
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_actor, v_actor_role, 'worker_change', 'staff_registrations', v_reg.id,
     jsonb_build_object('kind', 'registration_reject',
                        'employee_id', v_reg.employee_id,
                        'reason', nullif(btrim(coalesce(p_reason, '')), '')));
end;
$$;
revoke all on function public.reject_staff_registration(uuid, text) from public, anon;
grant execute on function public.reject_staff_registration(uuid, text) to authenticated;
comment on function public.reject_staff_registration(uuid, text) is
  'Spec 264 (ADR 0072) — back-office (procurement_manager/project_director/super_admin) rejection of a pending staff registration. Sets status=rejected + reviewed_* + reject_reason; writes NOTHING authoritative (no role change, no workers row); the burned employee_id stays on the staging row. Idempotent — only a pending row may be rejected. Audited (worker_change / registration_reject). Renamed from reject_technician_registration (spec 263).';

-- ============================================================================
-- 11. Storage policies — recreate with the narrowed purpose set (id_card |
--     profile_photo; `consent` path value retired). The applicant-scoped path
--     prefix stays `technician/<uid>/<purpose>` for v1 (internal path, not a role
--     assertion; renaming it would orphan the one in-flight test upload).
-- ============================================================================
drop policy if exists "technician doc uploads by applicant" on storage.objects;
drop policy if exists "technician doc reads by applicant" on storage.objects;

create policy "staff doc uploads by applicant"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(objects.name), 1) = 3
    and (storage.foldername(objects.name))[1] = 'technician'
    and (storage.foldername(objects.name))[2] = (select auth.uid()::text)
    and (storage.foldername(objects.name))[3] in ('id_card', 'profile_photo')
  );

create policy "staff doc reads by applicant"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(objects.name), 1) = 3
    and (storage.foldername(objects.name))[1] = 'technician'
    and (storage.foldername(objects.name))[2] = (select auth.uid()::text)
    and (storage.foldername(objects.name))[3] in ('id_card', 'profile_photo')
  );
