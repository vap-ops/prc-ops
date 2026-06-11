-- Spec 16 addendum A1 / ADR 0026 Decision B — site-wide purchase
-- visibility for site_admin.
--
-- REVERSES the 2026-06-07 owner decision recorded in ADR 0022 and in
-- 20260608120000's header ("site_admin sees rows they requested but NOT
-- another SA's rows"). Explicit operator decision 2026-06-11: "people on
-- site must see statuses of all the purchases related to the site, not
-- just the ones they requested." Access stays role-level (ADR 0013 — no
-- project-membership concept exists; both pilots share all staff).
--
-- Scope of this change:
--   - SELECT policy only. The own-row branch stays for future narrower
--     roles. The INSERT and UPDATE policies are untouched.
--   - The TO appsheet_writer policies (20260608140100) are untouched and
--     unaffected: current_user_role() returns NULL for that role, so this
--     policy never admits it.
--   - The spec-16 P2 attachments table's SELECT-via-parent policy will
--     inherit this widening automatically (its EXISTS runs under the
--     caller's purchase_requests RLS) — recorded in ADR 0026 together
--     with the wider signed-URL exposure radius.

drop policy "purchase_requests select own or privileged" on public.purchase_requests;

create policy "purchase_requests select own or privileged"
  on public.purchase_requests for select
  using (
    requested_by = auth.uid()
    or public.current_user_role() in (
      'site_admin', 'project_manager', 'procurement', 'super_admin'
    )
  );
