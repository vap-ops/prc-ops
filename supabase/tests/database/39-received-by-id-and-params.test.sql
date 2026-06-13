-- Data-architecture hardening (rank 7): pin the structured receiver FK on
-- purchase_requests and the reports.params object CHECK (20260625000500).

begin;
select plan(4);

select has_column(
  'public', 'purchase_requests', 'received_by_id',
  'purchase_requests.received_by_id exists'
);
select col_type_is(
  'public', 'purchase_requests', 'received_by_id', 'uuid',
  'received_by_id is uuid'
);
select fk_ok(
  'public', 'purchase_requests', 'received_by_id',
  'public', 'users', 'id'
);
select is(
  (select count(*)::int from pg_constraint where conname = 'reports_params_is_object'),
  1, 'reports.params object CHECK constraint exists'
);

select * from finish();
rollback;
