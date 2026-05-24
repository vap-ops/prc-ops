-- Create the approvals table — append-only per-WP decision event log.
--
-- Grain: one row = one decision EVENT. The table is a chronological event
-- log, NOT a supersede chain. Every decision is preserved; the WP's
-- "current decision" is the row with max(decided_at) for that
-- work_package_id. A needs_revision followed later by an approved decision
-- is two rows; nothing is rewritten. Not the supersede pattern (no
-- superseded_by, no anti-join) because decisions are events, not edits of
-- a single logical record.
--
-- Append-only is triple-enforced exactly like audit_log
-- (supabase/migrations/20260505143800_create_audit_log.sql) and photo_logs
-- (20260524020000_create_photo_logs.sql):
--   1. Privilege:  REVOKE UPDATE/DELETE from authenticated and anon.
--                  GRANT INSERT, SELECT to authenticated.
--   2. RLS:        policies for INSERT + SELECT only (no UPDATE policy,
--                  no DELETE policy).
--   3. Trigger:    BEFORE UPDATE OR DELETE raises P0001. Catches the
--                  service_role / superuser path that bypasses layers 1
--                  and 2.
--
-- Access model is role-level per ADR 0013, via public.current_user_role()
-- (ADR 0011 — never self-join public.users in a policy that gates on it).
-- The access split is the load-bearing difference from photo_logs:
--   INSERT: project_manager + super_admin ONLY. site_admin CANNOT approve.
--   SELECT: site_admin + project_manager + super_admin. SA must be able
--           to read approvals to see needs_revision comments on WPs they
--           uploaded to.
--
-- v1 NOTE on separation of duties: a project_manager who uploaded photos
-- to a WP can still record an approval on that same WP. Acceptable in v1
-- (the operator's team is small and trusted). Adding a separation-of-
-- duties guard would require either a tracking column on approvals or an
-- EXISTS subquery against photo_logs in the INSERT policy — both deferred
-- to a future unit per feature spec 02.
--
-- comment is text NULL at the column level, but the
-- approvals_comment_required_when_negative CHECK constraint requires
-- comment to be present AND non-blank (length(trim(comment)) > 0) when
-- decision is 'rejected' or 'needs_revision'. "Required" means visible
-- text, not just a non-NULL value — a whitespace-only comment on a
-- negative decision is rejected by the constraint.

-- 1. Enum for the decision space.
create type public.approval_decision as enum (
  'approved', 'rejected', 'needs_revision'
);

-- 2. Approvals table. decided_at is server-authoritative; it is the
--    canonical ordering key for the "latest decision per WP" semantic.
create table public.approvals (
  id              uuid primary key default gen_random_uuid(),
  work_package_id uuid not null
                    references public.work_packages(id) on delete cascade,
  decision        public.approval_decision not null,
  comment         text,
  decided_by      uuid not null references public.users(id),
  decided_at      timestamptz not null default now(),
  -- Comment is required (present AND non-blank) for negative decisions.
  -- length(trim(comment)) > 0 is the "non-blank" half — a whitespace-only
  -- comment on rejected/needs_revision is rejected by this constraint.
  constraint approvals_comment_required_when_negative
    check (
      decision = 'approved'
      or (comment is not null and length(trim(comment)) > 0)
    )
);

-- ON DELETE CASCADE on work_package_id is a defensive consistency default
-- for the case where a WP is hard-deleted at the service-role layer (the
-- application path is no-DELETE per ADR 0013). The application never
-- invokes this path.

-- 3. Composite (work_package_id, decided_at DESC) index. Serves both
--    hot reads cleanly:
--      - "latest decision for WP X" → index seek on work_package_id,
--        first index entry by decided_at desc;
--      - "decision history for WP X" → range scan, already sorted.
--    A plain work_package_id index would also serve both queries, just
--    with a sort step for ordering; the composite removes that step at
--    negligible storage cost (one row per decision).
create index approvals_work_package_id_decided_at_idx
  on public.approvals (work_package_id, decided_at desc);

-- 4. Triple-enforcement, layer 1: privilege. Match photo_logs' REVOKE
--    targets (authenticated + anon) exactly. authenticated may INSERT
--    (decisions) and SELECT. UPDATE/DELETE not granted. anon has no
--    access. service_role retains all privileges by default; layer 3
--    catches its UPDATE/DELETE attempts.
revoke all on public.approvals from authenticated, anon;
grant insert, select on public.approvals to authenticated;

-- 5. Triple-enforcement, layer 2: RLS. INSERT + SELECT policies only;
--    NO UPDATE policy, NO DELETE policy. Policies gate on
--    public.current_user_role() per ADR 0011 — never self-joining
--    public.users.
alter table public.approvals enable row level security;

-- SELECT: site_admin + project_manager + super_admin. SA reads so they
-- can see needs_revision comments on WPs they uploaded to.
create policy "approvals readable by sa/pm/super"
  on public.approvals for select
  using (
    public.current_user_role() in (
      'site_admin', 'project_manager', 'super_admin'
    )
  );

-- INSERT: project_manager + super_admin ONLY. site_admin CANNOT approve —
-- this is the load-bearing access difference from photo_logs.
create policy "approvals insert by pm/super"
  on public.approvals for insert
  with check (
    public.current_user_role() in ('project_manager', 'super_admin')
  );

-- 6. Triple-enforcement, layer 3: trigger raises on every UPDATE/DELETE
--    attempt, catching the service_role / superuser path that bypasses
--    layers 1 and 2. Function mirrors photo_logs_block_write() /
--    audit_log_block_write() in shape; message differs so the error
--    identifies which table refused the write.
create function public.approvals_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'approvals is append-only'
    using errcode = 'P0001';
end;
$$;

create trigger approvals_block_update
  before update on public.approvals
  for each row execute function public.approvals_block_write();

create trigger approvals_block_delete
  before delete on public.approvals
  for each row execute function public.approvals_block_write();
