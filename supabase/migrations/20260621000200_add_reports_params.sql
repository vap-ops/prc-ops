-- Spec 61 — PM control over report content. params is written once by
-- the requester at INSERT (rides the existing reports INSERT policy)
-- and parsed defensively by every reader: '{}' (every pre-61 row) and
-- malformed values both render the legacy report. No new policies, no
-- grants change.

alter table public.reports
  add column params jsonb not null default '{}'::jsonb;
