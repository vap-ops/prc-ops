-- rls-audit-2026-07 Pass A — audit_log confidentiality + integrity + inert anon DML.
-- Operator-commissioned security fix (F2/F3/F4 of the 2026-07-02 permission-matrix
-- audit). STRENGTHENS ADR 0004: append-only is untouched (UPDATE/DELETE stay revoked,
-- trigger stays); this scopes who may READ the log and removes the forgeable
-- user-facing INSERT path.
--
-- F2 — SELECT was `USING (true)` for ALL authenticated roles: an external `client`
-- login could read every audit row (role changes, dc_payment / journal /
-- client_billing / bank-change events) — confirmed live, 373 rows. Replace with:
--   1. full read for the internal privileged set (super_admin, project_director,
--      accounting, project_manager) — ADR 0004 layer 2 "SELECT scoped by role";
--   2. a narrow arm for the app's only other audit read (pre-flight: /sa home,
--      WP-detail rework gallery): site_admin + procurement may read
--      wp_reopened_for_defect event rows ONLY.
-- Both arms are NULL-SAFE (coalesce → a roleless JWT sees nothing) and wrap the
-- helper in a scalar subselect (RLS eval-once pin, pgTAP 40).
--
-- F3 — INSERT was granted to anon + authenticated with WITH CHECK (true): any
-- authenticated session could forge audit rows (confirmed live — forged
-- role_change row with actor_role=super_admin accepted). All 49 real writers are
-- SECURITY DEFINER functions owned by postgres (the table owner, force-RLS off),
-- so they bypass both the grant and the policy layer: revoking the user-facing
-- INSERT breaks nothing. service_role keeps INSERT (trusted server).
--
-- F4 — inert anon DML grants (defense-in-depth; RLS already blocked rows, the
-- grants were dead surface): revoke on the 5 content tables + users.

-- ---------------------------------------------------------------------------
-- F2: scope audit_log SELECT.
-- ---------------------------------------------------------------------------
drop policy if exists "audit_log select by authenticated" on public.audit_log;

create policy "audit_log select internal privileged"
  on public.audit_log for select
  to authenticated
  using (
    coalesce((select public.current_user_role())::text, '')
      in ('super_admin', 'project_director', 'accounting', 'project_manager')
  );

create policy "audit_log select wp rework events"
  on public.audit_log for select
  to authenticated
  using (
    coalesce((select public.current_user_role())::text, '')
      in ('site_admin', 'procurement')
    and payload->>'event' = 'wp_reopened_for_defect'
  );

-- ---------------------------------------------------------------------------
-- F3: audit_log INSERT is trusted-server only.
-- ---------------------------------------------------------------------------
drop policy if exists "audit_log insert by authenticated" on public.audit_log;
revoke insert on public.audit_log from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- F4: revoke the inert anon DML grants.
-- ---------------------------------------------------------------------------
revoke select, insert, update, delete on public.projects                   from anon, public;
revoke select, insert, update, delete on public.work_packages              from anon, public;
revoke select, insert, update, delete on public.deliverables               from anon, public;
revoke select, insert, update, delete on public.reports                    from anon, public;
revoke select, insert, update, delete on public.work_package_dependencies  from anon, public;
revoke select, insert, update, delete on public.users                      from anon, public;
