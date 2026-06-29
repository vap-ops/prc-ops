begin;
select plan(6);

-- ============================================================================
-- ERD audit (2026-06-29) — finding M1. The plaintext `token` column on both
-- invite tables is gone; only a SHA-256 digest (`token_hash`) is stored, so a
-- DB read / backup leak yields nothing replayable. The end-to-end claim-by-hash
-- behaviour is exercised by 37-contractor-identity and 116-worker-portal-binding
-- (which now seed token_hash and still claim with cleartext); this file pins the
-- structural shape so it cannot regress.
-- ============================================================================

select hasnt_column('public', 'contractor_invites', 'token',
  'M1: plaintext contractor_invites.token is removed');
select has_column('public', 'contractor_invites', 'token_hash',
  'M1: contractor_invites.token_hash exists');
select col_not_null('public', 'contractor_invites', 'token_hash',
  'M1: contractor_invites.token_hash is NOT NULL');

select hasnt_column('public', 'worker_invites', 'token',
  'M1: plaintext worker_invites.token is removed');
select has_column('public', 'worker_invites', 'token_hash',
  'M1: worker_invites.token_hash exists');
select col_not_null('public', 'worker_invites', 'token_hash',
  'M1: worker_invites.token_hash is NOT NULL');

select * from finish();
rollback;
