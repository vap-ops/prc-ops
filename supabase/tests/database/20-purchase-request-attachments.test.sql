begin;
select plan(67);

-- ============================================================================
-- Spec 23 / ADR 0028 — purchase_request_attachments (spec 16 §4 locked
-- design + purpose discriminator + delivery-confirmation branch).
-- Sections: B catalog, C checks/triggers/views (postgres), D role-sim RLS.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-11111111aaaa', 'super@pra-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-22222222aaaa', 'sa1@pra-test.local',     '{}'::jsonb),
  ('55555555-5555-5555-5555-55555555aaaa', 'sa2@pra-test.local',     '{}'::jsonb),
  ('44444444-4444-4444-4444-44444444aaaa', 'visitor@pra-test.local', '{}'::jsonb);

update public.users set role = 'super_admin'  where id = '11111111-1111-1111-1111-11111111aaaa';
update public.users set role = 'site_admin'   where id = '22222222-2222-2222-2222-22222222aaaa';
update public.users set role = 'site_admin', full_name = 'SA Two'
  where id = '55555555-5555-5555-5555-55555555aaaa';
-- Spec 70: procurement joins the back-office uploaders (invoice + delivery
-- confirmation); it is never the requester, so the reference arm stays inert.
insert into auth.users (id, email, raw_user_meta_data) values
  ('66666666-6666-6666-6666-66666666aaaa', 'proc@pra-test.local', '{}'::jsonb);
update public.users set role = 'procurement'
  where id = '66666666-6666-6666-6666-66666666aaaa';
-- 4444…aaaa keeps default 'visitor'.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-ccccccccaaaa', 'PRC-TEST-PRA', 'PRA fixture project');
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeaaaa',
   'cccccccc-cccc-cccc-cccc-ccccccccaaaa', 'WP-PRA-1', 'PRA fixture WP');

-- p1: requested by SA1 (reference-branch fixture).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status)
values
  ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeaaaa',
   'Cement', 10, 'bag', '22222222-2222-2222-2222-22222222aaaa', 'requested');

-- p2: DELIVERED, requested by SA1 (confirmation-branch fixture — SA2 is
-- the receiver, not the requester).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at, purchased_at, delivered_at)
values
  ('a2000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeaaaa',
   'Rebar', 50, 'rod', '22222222-2222-2222-2222-22222222aaaa', 'delivered',
   '11111111-1111-1111-1111-11111111aaaa',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day');

-- p3: ON_ROUTE, requested by SA1 — the spec-24 photo-completes-delivery
-- fixture (SA2 confirms receipt).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at, purchased_at, shipped_at)
values
  ('a3000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeaaaa',
   'Paint', 12, 'can', '22222222-2222-2222-2222-22222222aaaa', 'on_route',
   '11111111-1111-1111-1111-11111111aaaa',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day');

-- p4: PURCHASED (not yet shipped) — confirmation photos must stay denied.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at, purchased_at)
values
  ('a4000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeaaaa',
   'Wire', 5, 'roll', '22222222-2222-2222-2222-22222222aaaa', 'purchased',
   '11111111-1111-1111-1111-11111111aaaa',
   now() - interval '2 days', now() - interval '1 day');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog.
-- ============================================================================

select has_table('public', 'purchase_request_attachments', 'attachments table exists');
select has_table('public', 'purchase_request_attachment_tokens', 'token side table exists');
select enum_has_labels('public', 'purchase_request_attachment_kind',
  array['image', 'link', 'pdf'], 'kind enum is {image,link,pdf} (pdf added spec 121 / ADR 0046 Layer A)');
select enum_has_labels('public', 'purchase_request_attachment_purpose',
  array['reference', 'delivery_confirmation', 'invoice'],
  'purpose enum is {reference,delivery_confirmation,invoice} (ADR 0028/0043)');
select has_column('public', 'purchase_request_attachments', 'purpose', 'purpose column exists');
select col_default_is('public', 'purchase_request_attachments', 'purpose',
  'reference'::public.purchase_request_attachment_purpose,
  'purpose defaults to reference (spec-16 flow unchanged)');
select has_index('public', 'purchase_request_attachments',
  'purchase_request_attachments_pr_idx', 'parent index exists');

select is((select relrowsecurity from pg_class
            where oid = 'public.purchase_request_attachments'::regclass),
  true, 'RLS enabled on attachments');
select is((select relrowsecurity from pg_class
            where oid = 'public.purchase_request_attachment_tokens'::regclass),
  true, 'RLS enabled on tokens');

select policies_are('public', 'purchase_request_attachments',
  array['select via parent',
        'insert reference while pending or confirmation when delivered',
        'appsheet_writer select via parent status'],
  'attachments has exactly the three policies — zero UPDATE/DELETE policies');
select policies_are('public', 'purchase_request_attachment_tokens',
  array['appsheet_writer select tokens via attachment'],
  'tokens has exactly the appsheet SELECT policy');

-- Privilege matrix.
select is(has_table_privilege('authenticated', 'public.purchase_request_attachments', 'SELECT'),
  true,  'authenticated may SELECT attachments');
select is(has_table_privilege('authenticated', 'public.purchase_request_attachments', 'UPDATE'),
  false, 'authenticated has NO UPDATE on attachments (append-only layer 1)');
select is(has_table_privilege('authenticated', 'public.purchase_request_attachments', 'DELETE'),
  false, 'authenticated has NO DELETE on attachments (append-only layer 1)');
select is(has_column_privilege('authenticated', 'public.purchase_request_attachments', 'purpose', 'INSERT'),
  true,  'authenticated INSERT grant covers purpose');
select is(has_table_privilege('authenticated', 'public.purchase_request_attachment_tokens', 'SELECT'),
  false, 'authenticated can NEVER read capability tokens');
select is(has_table_privilege('appsheet_writer', 'public.purchase_request_attachments', 'SELECT'),
  true,  'appsheet_writer may SELECT attachments');
select is(has_table_privilege('appsheet_writer', 'public.purchase_request_attachment_tokens', 'SELECT'),
  true,  'appsheet_writer may SELECT tokens');
select is(has_table_privilege('appsheet_writer', 'public.purchase_request_attachments', 'INSERT'),
  false, 'appsheet_writer has NO INSERT on attachments');

-- Policy text pins (name-capture + branch regression guards).
select ok(
  (select with_check like '%pr_attachment_tombstone_target_ok%'
     from pg_policies
     where schemaname = 'public' and tablename = 'purchase_request_attachments'
       and policyname = 'insert reference while pending or confirmation when delivered'),
  'INSERT policy validates tombstone targets via the SECURITY DEFINER helper (42P17 recursion fix)'
);
select ok(
  (select with_check like '%delivery_confirmation%' and with_check like '%delivered%'
     from pg_policies
     where schemaname = 'public' and tablename = 'purchase_request_attachments'
       and policyname = 'insert reference while pending or confirmation when delivered'),
  'INSERT policy carries the delivery-confirmation branch (ADR 0028)'
);
select ok(
  (select qual like '%approved%' and qual like '%purchased%'
      and qual like '%on_route%' and qual like '%delivered%'
     from pg_policies
     where schemaname = 'public' and tablename = 'purchase_request_attachments'
       and policyname = 'appsheet_writer select via parent status'),
  'appsheet SELECT policy lists all four post-decision statuses explicitly (incl. on_route)'
);

-- Spec 24 / ADR 0030: the photo-completes-delivery trigger.
select has_function('public', 'purchase_request_attachments_complete_delivery',
  'completion trigger function exists (spec 24)');
select has_trigger('public', 'purchase_request_attachments',
  'purchase_request_attachments_complete_delivery',
  'AFTER INSERT completion trigger attached (spec 24)');

-- Views.
select has_view('public', 'purchase_request_attachments_current', '_current view exists');
select has_view('public', 'purchase_request_attachments_appsheet', '_appsheet view exists');
select ok(
  (select 'security_invoker=true' = any(reloptions) from pg_class
     where oid = 'public.purchase_request_attachments_current'::regclass),
  '_current is security_invoker'
);
select hasnt_column('public', 'purchase_request_attachments_current', 'access_token',
  '_current never exposes the capability token');
select is(has_table_privilege('authenticated', 'public.purchase_request_attachments_appsheet', 'SELECT'),
  false, 'authenticated cannot SELECT the _appsheet view');

-- ============================================================================
-- C. CHECK shapes, token trigger, block-write, view semantics (postgres).
-- ============================================================================

select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, storage_path, url, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'p/x.jpg', 'https://x.test',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  '23514', null, 'image content row carrying a url violates pra_image_shape');

select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, url, storage_path, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'link', 'https://x.test', 'p/x.jpg',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  '23514', null, 'link content row carrying a storage_path violates pra_link_shape');

select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, url, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'link', 'ftp://x.test',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  '23514', null, 'ftp:// url violates pra_url_shape');

select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, url, created_by)
     values ('a2000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'link', 'delivery_confirmation',
             'https://x.test', '22222222-2222-2222-2222-22222222aaaa') $$,
  '23514', null, 'delivery_confirmation link violates pra_purpose_kind (images only, ADR 0028)');

select throws_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, kind, storage_path, superseded_by, created_by)
     values (gen_random_uuid(), 'a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'p/y.jpg',
             gen_random_uuid(), '22222222-2222-2222-2222-22222222aaaa') $$,
  '23514', null, 'tombstone carrying a payload violates pra_tombstone_shape');

-- Content fixtures r1 (image) + r3 (link) on p1.
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, kind, storage_path, created_by)
     values ('f1000000-ffff-ffff-ffff-ffffffffffff', 'a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             'image', 'cccccccc-cccc-cccc-cccc-ccccccccaaaa/a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1000000-ffff-ffff-ffff-ffffffffffff.jpg',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  'reference image content row inserts (r1)');

select is(
  (select count(*)::int from public.purchase_request_attachment_tokens
     where attachment_id = 'f1000000-ffff-ffff-ffff-ffffffffffff'),
  1, 'token trigger created exactly one token for the image content row');

select lives_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, kind, url, created_by)
     values ('f3000000-ffff-ffff-ffff-ffffffffffff', 'a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             'link', 'https://example.test/spec', '22222222-2222-2222-2222-22222222aaaa') $$,
  'reference link content row inserts (r3)');

select is(
  (select count(*)::int from public.purchase_request_attachment_tokens
     where attachment_id = 'f3000000-ffff-ffff-ffff-ffffffffffff'),
  0, 'links get NO token (trigger is image-only)');

-- Cross-kind tombstone: image tombstone targeting the link row — the
-- composite FK (superseded_by, purchase_request_id, kind) has no match.
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, superseded_by, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image',
             'f3000000-ffff-ffff-ffff-ffffffffffff',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  '23503', null, 'cross-kind tombstone violates the composite supersede FK');

select lives_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, superseded_by, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'link',
             'f3000000-ffff-ffff-ffff-ffffffffffff',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  'same-kind tombstone of r3 inserts');

select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, superseded_by, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'link',
             'f3000000-ffff-ffff-ffff-ffffffffffff',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  '23505', null, 'second tombstone of the same target violates the partial unique index');

-- Triple-enforcement layer 3.
select throws_ok(
  $$ update public.purchase_request_attachments set url = 'https://t.test'
     where id = 'f3000000-ffff-ffff-ffff-ffffffffffff' $$,
  'P0001', null, 'UPDATE raises P0001 (block-write trigger)');
select throws_ok(
  $$ delete from public.purchase_request_attachments
     where id = 'f3000000-ffff-ffff-ffff-ffffffffffff' $$,
  'P0001', null, 'DELETE raises P0001 (block-write trigger)');
select throws_ok(
  $$ truncate public.purchase_request_attachments cascade $$,
  'P0001', null, 'TRUNCATE CASCADE raises P0001 (block-write trigger; plain TRUNCATE already fails on the token FK)');

-- View semantics: anti-join + tombstone filter (ADR 0009/0015).
select is(
  (select count(*)::int from public.purchase_request_attachments_current
     where id = 'f3000000-ffff-ffff-ffff-ffffffffffff'),
  0, '_current excludes the tombstoned link row');
select is(
  (select count(*)::int from public.purchase_request_attachments_current
     where id = 'f1000000-ffff-ffff-ffff-ffffffffffff'),
  1, '_current includes the live image row');

-- ----------------------------------------------------------------------------
-- Spec 121 / ADR 0046 Layer A — the pdf kind (postgres-level CHECK shapes).
-- ----------------------------------------------------------------------------

-- A pdf content row must carry a storage_path (mirrors pra_image_shape).
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pdf',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  '23514', null, 'pdf content row with no storage_path violates pra_pdf_shape');

-- A PDF can never be a delivery-confirmation (receipt photo) — pra_purpose_kind
-- still pins kind='image' there, so the new kind cannot leak into that slot.
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pdf', 'delivery_confirmation',
             'p/x.pdf', '22222222-2222-2222-2222-22222222aaaa') $$,
  '23514', null, 'delivery_confirmation pdf violates pra_purpose_kind (images only, ADR 0028)');

-- A well-formed pdf reference content row inserts.
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, kind, purpose, storage_path, created_by)
     values ('f4000000-ffff-ffff-ffff-ffffffffffff', 'a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             'pdf', 'reference',
             'cccccccc-cccc-cccc-cccc-ccccccccaaaa/a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f4000000-ffff-ffff-ffff-ffffffffffff.pdf',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  'pdf reference content row inserts (kind pdf, storage_path set)');

select is(
  (select kind::text from public.purchase_request_attachments
     where id = 'f4000000-ffff-ffff-ffff-ffffffffffff'),
  'pdf', 'the pdf row stored kind = pdf');

-- The token trigger is image-only — a pdf gets NO capability token (tokens are
-- the vestigial AppSheet image bridge, ADR 0034 cancelled; reads use signed URLs).
select is(
  (select count(*)::int from public.purchase_request_attachment_tokens
     where attachment_id = 'f4000000-ffff-ffff-ffff-ffffffffffff'),
  0, 'pdf rows get NO token (trigger is image-only)');

-- ============================================================================
-- D. Role-simulation RLS (authenticated + JWT claims).
-- ============================================================================

set local role authenticated;

-- D.1 SA1 reference insert on own pending parent.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222aaaa"}';
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, storage_path, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'p/ok-ref.jpg',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  'owner reference image on own pending parent is permitted');

-- D.2 SA2 reference insert on SA1's pending parent denied (requester pin).
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-55555555aaaa"}';
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, storage_path, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'p/deny-foreign.jpg',
             '55555555-5555-5555-5555-55555555aaaa') $$,
  '42501', null, 'non-requester reference insert on a foreign pending parent is denied');

-- D.3 Reference insert on a delivered parent denied (set freezes at decision).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222aaaa"}';
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, storage_path, created_by)
     values ('a2000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'p/deny-late-ref.jpg',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  '42501', null, 'reference insert on a delivered parent is denied (spec-16 Q2 freeze)');

-- D.4 SA2 (receiver, NOT the requester) confirmation image on the
--     delivered parent is permitted — the ADR 0028 branch.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-55555555aaaa"}';
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, kind, purpose, storage_path, created_by)
     values ('f2000000-ffff-ffff-ffff-ffffffffffff', 'a2000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             'image', 'delivery_confirmation', 'p/confirm.jpg',
             '55555555-5555-5555-5555-55555555aaaa') $$,
  'any staff member may attach a delivery-confirmation image on a delivered parent');

-- D.5 Confirmation insert on a still-requested parent denied.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222aaaa"}';
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'delivery_confirmation',
             'p/deny-early-confirm.jpg', '22222222-2222-2222-2222-22222222aaaa') $$,
  '42501', null, 'confirmation insert on a requested parent is denied (delivered-only)');

-- D.6 Visitor denied everywhere (role gate).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-44444444aaaa"}';
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ('a2000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'delivery_confirmation',
             'p/deny-visitor.jpg', '44444444-4444-4444-4444-44444444aaaa') $$,
  '42501', null, 'visitor confirmation insert is denied (requester-capable roles only)');

-- D.7 SA1 cannot tombstone SA2's confirmation photo (creator-only removal).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222aaaa"}';
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, superseded_by, created_by)
     values ('a2000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'delivery_confirmation',
             'f2000000-ffff-ffff-ffff-ffffffffffff',
             '22222222-2222-2222-2222-22222222aaaa') $$,
  '42501', null, 'non-creator tombstone of a confirmation photo is denied');

-- D.8 SA2 tombstones their own confirmation photo while parent is delivered.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-55555555aaaa"}';
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, superseded_by, created_by)
     values ('a2000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'delivery_confirmation',
             'f2000000-ffff-ffff-ffff-ffffffffffff',
             '55555555-5555-5555-5555-55555555aaaa') $$,
  'creator tombstone of own confirmation photo is permitted');

-- D.9 (spec 24) SA2 attaches a confirmation photo while p3 is ON_ROUTE —
--     permitted by the widened branch; the completion trigger fires.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-55555555aaaa"}';
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ('a3000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'delivery_confirmation',
             'p/confirm-onroute.jpg', '55555555-5555-5555-5555-55555555aaaa') $$,
  'confirmation photo on an on_route parent is permitted (spec 24)');

-- D.10 (spec 24) Confirmation photo on a PURCHASED parent stays denied.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222aaaa"}';
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ('a4000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'delivery_confirmation',
             'p/deny-purchased.jpg', '22222222-2222-2222-2222-22222222aaaa') $$,
  '42501', null, 'confirmation photo on a purchased parent is denied (flow starts at on_route)');

-- D.11 (spec 70) procurement attaches an INVOICE on the PURCHASED parent p4 —
--      permitted by the invoice arm + the procurement-widened role gate.
--      Invoices never advance status (the completion trigger keys on
--      delivery_confirmation), so p4 stays 'purchased'.
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-66666666aaaa"}';
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ('a4000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'invoice',
             'p/proc-invoice.jpg', '66666666-6666-6666-6666-66666666aaaa') $$,
  'procurement may attach an invoice on a purchased parent (spec 70 back-office parity)');

-- D.12 (spec 70) procurement is NOT a requester — the reference arm
--      (own-parent + status='requested') stays inert for it.
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (purchase_request_id, kind, purpose, storage_path, created_by)
     values ('a1000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'image', 'reference',
             'p/proc-deny-ref.jpg', '66666666-6666-6666-6666-66666666aaaa') $$,
  '42501', null, 'procurement reference insert on a foreign requested parent is denied');

-- ============================================================================
-- E. Spec 24 outcomes (back as postgres).
-- ============================================================================
reset role;

select is(
  (select status::text from public.purchase_requests
     where id = 'a3000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'delivered',
  'the photo completed the delivery: p3 advanced on_route→delivered');

select isnt(
  (select delivered_at from public.purchase_requests
     where id = 'a3000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  null,
  'delivered_at was stamped by the completion trigger');

select is(
  (select received_by from public.purchase_requests
     where id = 'a3000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'SA Two',
  'received_by = the confirming user''s full_name');

select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_delivery'
       and target_id = 'a3000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'the existing audit trigger wrote exactly one purchase_request_delivery row');

select * from finish();
rollback;
