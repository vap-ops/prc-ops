-- Spec 48 — purchase_requests.notes privilege posture.
--
-- The note is write-once at creation: authenticated may INSERT it but
-- never UPDATE it (spec 33 / ADR 0038 column-scope doctrine), and
-- appsheet_writer does not see it at all (ADR 0034 column freeze).

begin;

select plan(3);

select is(
  has_column_privilege('authenticated', 'public.purchase_requests', 'notes', 'INSERT'),
  true,
  'authenticated can INSERT notes (requester sets it at creation)'
);

select is(
  has_column_privilege('authenticated', 'public.purchase_requests', 'notes', 'UPDATE'),
  false,
  'authenticated has NO UPDATE on notes (write-once posture)'
);

select is(
  has_column_privilege('appsheet_writer', 'public.purchase_requests', 'notes', 'UPDATE'),
  false,
  'appsheet_writer has NO UPDATE on notes (ADR 0034 column freeze)'
);

select * from finish();

rollback;
