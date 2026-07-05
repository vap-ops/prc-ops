-- Spec 265 U1 — super_admin LINE-identity visibility (schema half).
--
-- Two additive, NULLABLE columns on public.users so super_admin can always see a
-- person's LINE ground-truth identity, independent of what they later edited
-- (full_name) or uploaded (profile_photo):
--
--   line_display_name text        — the LINE-OWNED display name, REFRESHED on
--                                    EVERY login from claims.name (SEPARATE from
--                                    the user-owned, NULL-only full_name — see
--                                    ADR 0017/0020). The verification anchor.
--   line_synced_at    timestamptz — the "last checked" time, stamped each login
--                                    when the LINE profile is fetched. Distinct
--                                    from updated_at (which any write bumps).
--
-- Both are plain text/timestamptz columns and inherit the existing users
-- row-level SELECT policies (super_admin reads any row; every other role reads
-- only its own — ADR 0011/0019). No RLS policy change and no new column GRANT is
-- required: the callback writes them via the admin (service_role) client, which
-- bypasses RLS exactly like line_avatar_url today, and UPDATE on users stays
-- revoked from authenticated/anon (ADR 0019). This extends ADR 0020's
-- LINE-owned/refresh-on-login split to one more field; it is additive within an
-- accepted decision, so no ADR (spec 265 § "Why no ADR").
--
-- NO backfill: seeding line_display_name from full_name would be lossy (full_name
-- may already be user-edited, so it would seed the DRIFTED value into the field
-- whose purpose is to hold un-drifted LINE ground truth). Both columns populate
-- naturally on each user's next login (spec 265 § "Backfill decision").

alter table public.users
  add column line_display_name text,
  add column line_synced_at timestamptz;
