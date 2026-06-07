-- Create the purchase_requests table — single stateful row per requisition
-- carrying the full purchasing lifecycle. New Purchasing domain (ADR 0022,
-- feature spec 09).
--
-- Grain: one row = one requisition. Status walks
-- requested → approved | rejected → purchased → delivered, in place. Decisions
-- are stored on the row itself (no separate approvals log) — purchasing is a
-- single back-office workflow, not a multi-party decision event log like
-- work-package approvals. Differs from `approvals` (append-only event log)
-- and `photo_logs` (supersede pattern) on purpose; the trade-off is recorded
-- in ADR 0022.
--
-- Dual-identity (`requested_by` FK + `requested_by_email` + `source`):
-- the requester column is split so the table accepts both native sessions
-- (LINE-authed PRC users, `source = 'app'`) and the AppSheet back-office
-- writer (`source = 'appsheet'`), which connects as a Postgres role with no
-- auth.uid() and therefore writes an email address into `requested_by_email`
-- instead of a user FK. Enforced by the `pr_native_has_requester` CHECK and
-- the `pr_source_valid` CHECK; see ADR 0022 + ADR 0018.
--
-- Access model: role-level per ADR 0013, via public.current_user_role()
-- (ADR 0011 — never self-join public.users in a policy that gates on it).
-- The SELECT policy adds a per-row visibility branch — `requested_by =
-- auth.uid()` — so a requester always sees their own rows, regardless of
-- role. PM, procurement, and super_admin see all (procurement is the
-- back-office reviewer in v1).
--
-- v1 requester narrowing (owner decision, 2026-06-07): the INSERT policy
-- admits only the same role set that can read work_packages —
-- site_admin / project_manager / super_admin — pinning the row's
-- `requested_by = auth.uid()` and `source = 'app'`. Broadening the
-- requester base is a future unit.
--
-- Approval column / transition scoping (which columns may change, on which
-- transitions) is enforced in the server action via a two-layer guard
-- (JS predicate + `.eq('status','requested')` SQL clause), NOT in RLS.
-- The UPDATE policy admits PM + super_admin to write at all.
--
-- Phase-2 columns (supplier, order_ref, amount, purchased_at, delivered_at,
-- received_by, delivery_note) are created NULLABLE here and ship in P2 via
-- the AppSheet writer role; no further ALTER expected.

-- 1. Lifecycle enum.
create type public.purchase_request_status as enum (
  'requested', 'approved', 'rejected', 'purchased', 'delivered'
);

-- 2. Purchase requests table.
create table public.purchase_requests (
  id                 uuid primary key default gen_random_uuid(),
  work_package_id    uuid not null references public.work_packages(id) on delete cascade,
  -- Requisition.
  item_description   text not null,
  quantity           numeric not null,
  unit               text not null,
  status             public.purchase_request_status not null default 'requested',
  source             text not null default 'app',
  requested_by       uuid references public.users(id),
  requested_by_email text,
  requested_at       timestamptz not null default now(),
  -- Approval (native, PM/super).
  approved_by        uuid references public.users(id),
  decided_at         timestamptz,
  decision_comment   text,
  -- Purchase (AppSheet, P2 — null until then).
  supplier           text,
  order_ref          text,
  amount             numeric,
  purchased_at       timestamptz,
  -- Delivery (AppSheet, P2 — null until then).
  delivered_at       timestamptz,
  received_by        text,
  delivery_note      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint pr_source_valid         check (source in ('app', 'appsheet')),
  constraint pr_native_has_requester check (source <> 'app' or requested_by is not null),
  constraint pr_item_nonblank        check (length(trim(item_description)) > 0),
  constraint pr_unit_nonblank        check (length(trim(unit)) > 0),
  constraint pr_quantity_positive    check (quantity > 0),
  constraint pr_reject_has_comment   check (
    status <> 'rejected'
    or (decision_comment is not null and length(trim(decision_comment)) > 0)
  )
);

-- ON DELETE CASCADE on work_package_id is a defensive consistency default
-- for the case where a WP is hard-deleted at the service-role layer
-- (the application path is no-DELETE per ADR 0013). The application never
-- invokes this path.

-- 3. Indexes.
--    wp_idx serves "list requests for WP X" (the PM review queue grouped by WP).
--    The composite (status, requested_at desc) serves the top-level review
--    queue: "all requests in status S, newest first."
create index purchase_requests_wp_idx
  on public.purchase_requests (work_package_id);
create index purchase_requests_status_requested_at_idx
  on public.purchase_requests (status, requested_at desc);

-- 4. updated_at maintenance via the existing public.set_updated_at() function
--    (defined in 20260505143544_create_users.sql). Same convention as
--    work_packages (20260524010000_create_work_packages.sql) and users.
create trigger purchase_requests_set_updated_at
  before update on public.purchase_requests
  for each row execute function public.set_updated_at();

-- 5. RLS — role-level access per ADR 0013, with a per-row "own row" branch
--    on SELECT for the requester self-view.
alter table public.purchase_requests enable row level security;

-- SELECT: a requester sees their own rows (requested_by = auth.uid());
-- project_manager + procurement + super_admin see all (role-level).
-- site_admin therefore sees rows they requested but NOT another SA's rows —
-- the cross-user isolation that the owner narrowed the requester base to.
create policy "purchase_requests select own or privileged"
  on public.purchase_requests for select
  using (
    requested_by = auth.uid()
    or public.current_user_role() in (
      'project_manager', 'procurement', 'super_admin'
    )
  );

-- INSERT: site_admin / project_manager / super_admin — the same roles that
-- can read work_packages to pick one. Owner decision 2026-06-07 narrowed
-- this from "any non-visitor" to wp-readers. The WITH CHECK also pins the
-- row to the caller (`requested_by = auth.uid()`) and to the native source
-- (`source = 'app'`) — the AppSheet path writes via its own DB role in P2.
create policy "purchase_requests insert by wp-readers"
  on public.purchase_requests for insert
  with check (
    public.current_user_role() in (
      'site_admin', 'project_manager', 'super_admin'
    )
    and requested_by = auth.uid()
    and source = 'app'
  );

-- UPDATE: project_manager + super_admin. Column / transition scoping
-- (which columns may change, only on requested→approved/rejected) is
-- enforced in the server action via a two-layer guard
-- (JS predicate + `.eq('status','requested')` SQL clause), NOT here.
create policy "purchase_requests update by pm or super"
  on public.purchase_requests for update
  using      (public.current_user_role() in ('project_manager', 'super_admin'))
  with check (public.current_user_role() in ('project_manager', 'super_admin'));

-- No DELETE policy. With RLS enabled and no DELETE policy, every DELETE
-- against this table through the application path affects zero rows —
-- including super_admin. Hard deletes, when ever needed, require a
-- service-role context (an explicit migration / console action). Same
-- archive-not-delete contract as projects / work_packages / approvals.

-- 6. Grants. Default-revoke for anon and authenticated, then grant the
--    minimum the application needs (SELECT/INSERT/UPDATE under RLS).
--    Phase-2 grants for the AppSheet role ship in P2 (see ADR 0018), not here.
revoke all on public.purchase_requests from authenticated, anon;
grant select, insert, update on public.purchase_requests to authenticated;
