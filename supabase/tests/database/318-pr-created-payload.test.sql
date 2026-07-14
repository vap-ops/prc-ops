-- spec 318 U5 — notify_pr_created snapshots project_id into the outbox payload.
-- Fixture-scoped: assert on the row our own fixture insert enqueued.
begin;
select plan(2);

-- fixture: a requester + project + PR (rolled back with everything else)
insert into auth.users (id, email)
values ('00000000-0000-4318-b000-000000000001', 'spec318u5@test.local')
on conflict (id) do nothing;
insert into public.users (id, role)
values ('00000000-0000-4318-b000-000000000001', 'site_admin')
on conflict (id) do update set role = 'site_admin';
insert into public.projects (id, code, name, status)
values ('00000000-0000-4318-b000-00000000000a', 'T318', 'spec318 fixture', 'active');

insert into public.purchase_requests (id, project_id, item_description, quantity, unit, status, requested_by)
values (
  '00000000-0000-4318-b000-00000000000b',
  '00000000-0000-4318-b000-00000000000a',
  'spec318 fixture item', 1, 'ชิ้น', 'requested',
  '00000000-0000-4318-b000-000000000001'
);

select is(
  (select payload->>'project_id' from public.notification_outbox
    where purchase_request_id = '00000000-0000-4318-b000-00000000000b'
      and event_type = 'pr_created'),
  '00000000-0000-4318-b000-00000000000a',
  'pr_created payload carries the PR''s project_id'
);
select is(
  (select payload->>'requested_by' from public.notification_outbox
    where purchase_request_id = '00000000-0000-4318-b000-00000000000b'
      and event_type = 'pr_created'),
  '00000000-0000-4318-b000-000000000001',
  'existing payload fields unchanged (requested_by intact)'
);

select * from finish();
rollback;
