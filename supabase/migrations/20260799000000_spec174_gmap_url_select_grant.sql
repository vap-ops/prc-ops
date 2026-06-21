-- Spec 174 follow-up — grant SELECT on projects.gmap_url.
--
-- public.projects carries COLUMN-level SELECT grants (budget_amount_thb is
-- deliberately excluded for money isolation, spec 79), so the gmap_url column
-- added in 20260798 inherited the table-level INSERT/UPDATE but NOT SELECT. The
-- project detail + settings pages read gmap_url under the USER session
-- (createClient / RLS), so authenticated (and anon, mirroring site_address) need
-- the column SELECT. RLS on projects still gates which rows are visible; this only
-- opens the column. Idempotent (re-granting is a no-op).
grant select (gmap_url) on public.projects to authenticated, anon;
