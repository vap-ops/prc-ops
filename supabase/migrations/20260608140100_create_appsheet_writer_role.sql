-- Purchasing P2 — create the appsheet_writer DB role, grant it the
-- minimum necessary privileges on purchase_requests, and attach
-- TO appsheet_writer RLS policies.
--
-- Design decisions recorded in ADR 0025 (Purchasing P2 write path).
-- This migration supersedes two parts of ADR 0018's grant matrix:
--   • SELECT gated on status in ('approved','purchased','delivered')
--     rather than source = 'appsheet' (Decision B).
--   • INSERT deferred — no INSERT grant here (Decision B).
-- ADR 0018 section updated with a pointer.
--
-- Password handling: the role is created NOLOGIN. The operator enables
-- login out-of-band after this migration merges:
--   alter role appsheet_writer with login password '<generated-secret>';
--   insert into public.audit_log (action, target_table, payload)
--   values ('other', null, jsonb_build_object(
--     'event','set appsheet_writer password','at', now()));
-- Never store a password in git or any migration. See change-management.md.

-- 1. Role — noinherit, nologin (login enabled out-of-band by operator).
create role appsheet_writer noinherit nologin;

-- 2. Grants — SELECT (table-level) + column-scoped UPDATE on the 7 P2
--    fact columns only. No INSERT, no DELETE, no UPDATE on status/source
--    or any other column. The column-scoped grant is the privilege-layer
--    guarantee that AppSheet cannot touch status directly (Decision A).
grant select on public.purchase_requests to appsheet_writer;
grant update (supplier, order_ref, amount, purchased_at,
              delivered_at, received_by, delivery_note)
  on public.purchase_requests to appsheet_writer;

-- future: when originated-requisitions ship, add
--   grant insert on public.purchase_requests to appsheet_writer;
-- and add the INSERT policy below.

-- 3. RLS policies TO appsheet_writer.
--    The existing TO-authenticated policies gate on current_user_role(),
--    which returns NULL for a direct-DB-role connection (no auth.uid()).
--    Every existing policy therefore DENIES appsheet_writer by default;
--    the TO-explicit policies below are the ONLY path that admits it.
--    BYPASSRLS is explicitly forbidden per ADR 0018.

-- SELECT: the procurement worklist — approved / purchased / delivered.
--   requested and rejected rows are NOT visible (they are in the native
--   decision domain, not the procurement execution domain).
--   Policies are additive (permissive OR): this policy lets appsheet_writer
--   read; the native authenticated policy is irrelevant because the role
--   never carries a JWT.
create policy "appsheet_writer select by status"
  on public.purchase_requests
  for select
  to appsheet_writer
  using (status in ('approved', 'purchased', 'delivered'));

-- future: when originated-requisitions ship, add
--   or source = 'appsheet'
-- to the above USING clause.

-- UPDATE: same stage gate in USING + WITH CHECK (belt-and-braces).
--   Column scope is enforced at the privilege layer (the column-scoped
--   UPDATE grant above). The BEFORE trigger (migration …140200) enforces
--   transition legality. This policy only guarantees the role updates
--   rows on the approved/purchased/delivered segment.
create policy "appsheet_writer update by status"
  on public.purchase_requests
  for update
  to appsheet_writer
  using (status in ('approved', 'purchased', 'delivered'))
  with check (status in ('approved', 'purchased', 'delivered'));
