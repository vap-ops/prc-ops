-- Data-architecture hardening (rank 9) — pin the no-JWT NULL-deny invariant.
--
-- current_user_role() resolves the caller's role via auth.uid(). With no JWT
-- sub, auth.uid() is NULL, so current_user_role() returns NULL, and every
-- "current_user_role() in (...)" policy then denies. THREE isolation models
-- silently depend on this: the appsheet_writer DB role, anon, and any future
-- read-only AI/agent principal. None pinned it until now. A refactor of
-- current_user_role() that returned a non-NULL fallback for a JWT-less
-- connection would silently open every role-gated table — this test fails first.
--
-- (The companion current_org_id() seam for multi-tenancy is intentionally NOT
-- added yet: a NULL-returning stub is dead code until per-org scoping is
-- designed; the real reduction in future migration cost comes with that design.
-- Recorded as the next tenancy step.)

begin;
select plan(2);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-0000000000de', 'nulldeny@arch-test.local', '{}'::jsonb);
update public.users set role = 'project_manager'
  where id = 'a0000000-0000-0000-0000-0000000000de';

-- The runner collects assertions into _tap_buf; under `set local role
-- authenticated` the insert needs explicit grants (reset before finish()).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- Positive control: a valid JWT sub resolves the role.
set local "request.jwt.claims" = '{"sub": "a0000000-0000-0000-0000-0000000000de"}';
select is(
  public.current_user_role(), 'project_manager'::user_role,
  'current_user_role() resolves the role for a valid JWT sub'
);

-- The invariant: no sub -> NULL -> every role policy denies.
set local "request.jwt.claims" = '{}';
select is(
  public.current_user_role(), null,
  'current_user_role() is NULL with no JWT sub (the deny invariant)'
);

reset role;

select * from finish();
rollback;
