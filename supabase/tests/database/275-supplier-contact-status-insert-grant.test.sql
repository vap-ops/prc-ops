begin;
select plan(2);

-- ============================================================================
-- Bug 551d85ef — "กดบันทึกการเพิ่มผู้จำหน่ายไม่ได้" (a new supplier won't save).
-- createSupplierRecord() (src/app/contacts/actions.ts) inserts as the USER (role
-- `authenticated`) and always includes contact_status — the add-supplier form
-- defaults the status select to 'active'. Spec 275 U0 (vendor unification,
-- 20260813074000_spec275u0_vendor_unification.sql) added the contact_status column
-- and an UPDATE grant to authenticated, but NEVER an INSERT grant → the column-level
-- privilege check denied every insert with 42501 (before RLS even ran) and the action
-- swallowed it as a generic error. This pins the missing INSERT privilege.
-- ============================================================================

select has_column('public', 'suppliers', 'contact_status',
  'precondition: suppliers.contact_status exists (spec 275 U0)');

select ok(
  has_column_privilege('authenticated', 'public.suppliers', 'contact_status', 'INSERT'),
  'authenticated may INSERT suppliers.contact_status (fixes bug 551d85ef — supplier create 42501)');

select * from finish();
rollback;
