-- Spec 144 U1 — add the 'rework' work-package status.
--
-- A completed WP can still have a defect found later; 'complete' was terminal
-- with no path back (the after-photo transition won't fire from complete, and
-- labor logging is blocked on complete). 'rework' is the reopened state: a
-- defect reopens complete → rework, the site re-captures, it returns to
-- pending_approval → complete.
--
-- ADD VALUE in its OWN migration: a newly-added enum value cannot be USED in
-- the same transaction it is added (Postgres). The reopen RPC that references
-- 'rework' ships in the next migration (20260734000100).

alter type public.work_package_status add value if not exists 'rework';
