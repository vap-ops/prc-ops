-- Spec 391 U2 — the hidden table needs the SAME read posture as its sibling.
--
-- 075898 created it zero-grant (RLS on, no policies, no grants) and 075899
-- hardened that with an explicit revoke. Correct for WRITES — every write must
-- go through the PD-gated DEFINER functions — but it also made the table
-- unreadable, and `/review` has to show a PD which photos are already hidden so
-- the control can render its current state.
--
-- ⚠️ Caught by building U2, not by a test: a zero-grant table silently returns
-- ZERO ROWS to the RLS session client rather than erroring, so the toggle would
-- have rendered "not hidden" for every photo — including ones the PD had just
-- hidden — and the bug would have looked like a failed write. This is the
-- has_column_privilege lesson at table scope: check the grant before believing
-- a read-back.
--
-- Mirrors `wp_catalog_reference_photos` exactly (verified live): SELECT granted
-- to `authenticated` + a permissive SELECT policy, and NO write policy at all,
-- so INSERT/UPDATE/DELETE remain reachable only through
-- hide_reference_photo / unhide_reference_photo. Read-open, write-closed.
--
-- A hidden row is (photo, who, when) — it carries no PII and no money, and the
-- photo ids in it are already visible to any authenticated caller through the
-- reference reader. There is nothing here to protect that the write gate does
-- not already protect.

grant select on public.wp_catalog_hidden_reference_photos to authenticated;

drop policy if exists "hidden reference photos readable by authenticated"
  on public.wp_catalog_hidden_reference_photos;
create policy "hidden reference photos readable by authenticated"
  on public.wp_catalog_hidden_reference_photos
  for select
  to authenticated
  using (true);
