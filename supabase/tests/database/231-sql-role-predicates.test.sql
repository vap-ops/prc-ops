begin;
select plan(27);

-- ============================================================================
-- Architecture-quality audit rank 5 (sql-role-helpers), stage 1 — the SQL role
-- predicates is_manager / is_back_office / is_site_staff must mirror the TS
-- role-set SSOT (src/lib/auth/role-home.ts) EXACTLY. This is the TS↔SQL parity
-- guard: tests/unit/role-sets.test.ts pins the TS side, this pins the SQL side,
-- and the two membership lists must agree.
--
-- Each predicate is checked two ways: an exact COUNT over the whole user_role
-- enum (proves NOTHING outside the set is admitted — the exhaustive deny side),
-- plus an explicit true for every member and a representative denial.
-- ============================================================================

-- Enum-completeness guard: 16 roles today. If someone ADDs a user_role value,
-- this fails until they decide which predicate(s) admit it (kills silent drift).
-- 'client' (spec 233 / ADR 0067) is an EXTERNAL read-only audience admitted by
-- NONE of the staff predicates below. 'procurement_manager' (spec 261 / ADR 0070)
-- is a superset of procurement — is_back_office YES, is_manager/is_site_staff NO.
-- 'site_owner' + 'auditor' (spec 263 / ADR 0071) are behavior-free forward-compat
-- field roles — admitted by NONE of the staff predicates below (they do nothing yet).
select is(
  (select count(*)::int from unnest(enum_range(null::public.user_role))),
  16,
  'user_role enum has 16 values (add one => classify it in the predicates)');

-- --- is_manager = PM_ROLES (project_manager, super_admin, project_director) ---
select is(
  (select count(*)::int from unnest(enum_range(null::public.user_role)) r where public.is_manager(r)),
  3, 'is_manager admits exactly 3 roles (the PM set)');
select is(public.is_manager('project_manager'::public.user_role), true, 'is_manager: project_manager');
select is(public.is_manager('super_admin'::public.user_role), true, 'is_manager: super_admin');
select is(public.is_manager('project_director'::public.user_role), true, 'is_manager: project_director (ADR 0058)');
select is(public.is_manager('site_admin'::public.user_role), false, 'is_manager: site_admin denied');
select is(public.is_manager('procurement_manager'::public.user_role), false, 'is_manager: procurement_manager denied (dept manager, NOT the project tier)');
select is(public.is_manager('site_owner'::public.user_role), false, 'is_manager: site_owner denied (behavior-free, spec 263)');
select is(public.is_manager('auditor'::public.user_role), false, 'is_manager: auditor denied (behavior-free, spec 263)');

-- --- is_back_office = BACK_OFFICE_ROLES (PM set + procurement, NOT site_admin) ---
select is(
  (select count(*)::int from unnest(enum_range(null::public.user_role)) r where public.is_back_office(r)),
  5, 'is_back_office admits exactly 5 roles (PM set + procurement + procurement_manager)');
select is(public.is_back_office('project_manager'::public.user_role), true, 'is_back_office: project_manager');
select is(public.is_back_office('super_admin'::public.user_role), true, 'is_back_office: super_admin');
select is(public.is_back_office('procurement'::public.user_role), true, 'is_back_office: procurement');
select is(public.is_back_office('procurement_manager'::public.user_role), true, 'is_back_office: procurement_manager (spec 261 parity)');
select is(public.is_back_office('project_director'::public.user_role), true, 'is_back_office: project_director');
select is(public.is_back_office('site_admin'::public.user_role), false, 'is_back_office: site_admin denied (financial data)');
select is(public.is_back_office('site_owner'::public.user_role), false, 'is_back_office: site_owner denied (behavior-free, spec 263)');
select is(public.is_back_office('auditor'::public.user_role), false, 'is_back_office: auditor denied (behavior-free, spec 263)');

-- --- is_site_staff = SITE_STAFF_ROLES (site_admin + the PM set) ---
select is(
  (select count(*)::int from unnest(enum_range(null::public.user_role)) r where public.is_site_staff(r)),
  4, 'is_site_staff admits exactly 4 roles (site_admin + PM set)');
select is(public.is_site_staff('site_admin'::public.user_role), true, 'is_site_staff: site_admin');
select is(public.is_site_staff('project_manager'::public.user_role), true, 'is_site_staff: project_manager');
select is(public.is_site_staff('super_admin'::public.user_role), true, 'is_site_staff: super_admin');
select is(public.is_site_staff('project_director'::public.user_role), true, 'is_site_staff: project_director');
select is(public.is_site_staff('procurement'::public.user_role), false, 'is_site_staff: procurement denied (read-only viewer, not staff)');
select is(public.is_site_staff('procurement_manager'::public.user_role), false, 'is_site_staff: procurement_manager denied (dept manager, not site staff)');
select is(public.is_site_staff('site_owner'::public.user_role), false, 'is_site_staff: site_owner denied (behavior-free, spec 263)');
select is(public.is_site_staff('auditor'::public.user_role), false, 'is_site_staff: auditor denied (behavior-free, spec 263)');

select * from finish();
rollback;
