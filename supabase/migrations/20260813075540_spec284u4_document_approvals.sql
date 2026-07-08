-- ============================================================================
-- Spec 284 U4 / ADR 0080 dec 10 — generalized DOCUMENT_APPROVALS decision-log.
--
-- The Legal department's approval ledger: an append-only, immutable record of
-- decisions (approve / reject / needs_revision) taken on a document, each carrying
-- a mandatory reason (comment). U3 gave Legal the `contracts` deal header; this
-- unit gives it the decision trail that drives a contract's lifecycle — an
-- 'approve' transitions the contract draft→active in the SAME txn, mirroring how
-- `approvals` drives work-package state.
--
-- TYPED FK, NOT a polymorphic target (CLAUDE.md L22): the decision points at a
-- contract via `contract_id uuid not null references contracts(id)`. `target_type`
-- is a forward DISCRIMINATOR enum (only 'contract' today) so a second document kind
-- later adds its OWN typed nullable FK column + widens the enum — never a
-- mixed-content `target_id`.
--
-- MONEY/DOCUMENT posture (binding — spec 46 / ADR 0055, matching U3's contracts):
-- ZERO authenticated grant (RLS on, NO policies) — read only via the service-role
-- admin client behind requireRole(DOC_APPROVAL_ROLES), never a site_admin screen;
-- written only by the SECURITY DEFINER RPC below, gated DOC_APPROVAL_ROLES
-- (= LEGAL_ROLES: legal, super_admin) FAIL-CLOSED via `is distinct from` (a null-role
-- unbound caller raises 42501, never falls through — the rls-self-check-coalesce
-- trap), with anon/public EXECUTE revoked INLINE (brand-new fn → no separate lock
-- migration; the 229 anon-default-privilege invariant covers it).
--
-- AUDITED: document_approvals IS the audit trail. Each row is an immutable
-- (append-only, freeze-triggered) decision with actor + reason + timestamp — the
-- spec's "audited" posture is satisfied by the ledger itself; no duplicate
-- audit_log row is written (matches U3, which likewise carries no audit_log).
--
-- Additive only. All state is Postgres enums (never free text). No GL posting —
-- the decision records intent + flips the contract status; money movement stays in
-- the payment entities.
-- ============================================================================

-- ---- 1. Enums --------------------------------------------------------------
-- Forward discriminator: widen (+ add a typed nullable FK per new kind) when a
-- second document target appears. Never a polymorphic id column.
create type public.document_target_type as enum ('contract');
create type public.document_decision    as enum ('approve', 'reject', 'needs_revision');

-- ---- 2. document_approvals — append-only decision ledger --------------------
create table public.document_approvals (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.contracts (id),        -- TYPED FK (no mixed-content target_id)
  target_type  public.document_target_type not null default 'contract',
  decision     public.document_decision not null,
  comment      text not null,                                         -- a decision must carry a reason (like approvals)
  actor_id     uuid references public.users (id),
  created_at   timestamptz not null default now(),
  constraint document_approvals_comment_nonblank check (length(btrim(comment)) > 0),
  constraint document_approvals_comment_len      check (length(comment) <= 2000)
);
create index document_approvals_contract_idx on public.document_approvals (contract_id, created_at desc);

alter table public.document_approvals enable row level security;
revoke all on public.document_approvals from anon, authenticated;   -- zero-grant; admin-client reads only

-- Append-only freeze trigger (audit_log / contract_attachments doctrine): INSERT
-- passes; UPDATE/DELETE/TRUNCATE raise P0001 for every role, incl. the definer —
-- the decision ledger is immutable (this immutability IS the "audited" guarantee).
create function public.document_approvals_freeze()
returns trigger
language plpgsql
as $$
begin
  raise exception 'document_approvals is append-only: % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;
create trigger document_approvals_block_update_delete
  before update or delete on public.document_approvals
  for each row execute function public.document_approvals_freeze();
create trigger document_approvals_block_truncate
  before truncate on public.document_approvals
  for each statement execute function public.document_approvals_freeze();

comment on table public.document_approvals is
  'Legal document decision-log (spec 284 U4 / ADR 0080) — append-only ledger of approve/reject/needs_revision decisions, each with a required comment + actor, pointing at a document via a TYPED FK (contract_id; NO mixed-content target_id, target_type is a forward discriminator). MONEY/DOCUMENT DOMAIN — zero authenticated grant (RLS on, no policies); read via the service-role admin client behind requireRole(DOC_APPROVAL_ROLES); written only by submit_document_decision. Immutable (freeze trigger) = the audit trail itself; no separate audit_log row.';

-- ---- 3. RPC — SECURITY DEFINER, DOC_APPROVAL_ROLES fail-closed -------------
-- Gate shape: `v_role is distinct from 'legal' and v_role is distinct from
-- 'super_admin'` — a null (unbound) role satisfies both → raises. Called on the
-- USER session (auth.uid()/current_user_role() resolve); the service-role admin
-- client, having no JWT, would 42501 the gate — so the write never goes through it.
-- An 'approve' decision flips the contract draft→active atomically in this txn.
create function public.submit_document_decision(
  p_contract_id uuid,
  p_decision    public.document_decision,
  p_comment     text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    public.user_role := public.current_user_role();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_id      uuid;
begin
  if v_role is distinct from 'legal' and v_role is distinct from 'super_admin' then
    raise exception 'submit_document_decision: role not permitted' using errcode = '42501';
  end if;
  if p_decision is null then
    raise exception 'submit_document_decision: decision required' using errcode = 'P0001';
  end if;
  if v_comment is null or length(v_comment) > 2000 then
    raise exception 'submit_document_decision: comment required (<=2000)' using errcode = 'P0001';
  end if;

  insert into public.document_approvals (contract_id, decision, comment, actor_id)
  values (p_contract_id, p_decision, v_comment, auth.uid())
  returning id into v_id;

  -- 'approve' transitions the deal draft→active (single txn), mirroring how
  -- `approvals` drives WP state. A non-draft contract is left untouched.
  if p_decision = 'approve' then
    update public.contracts set status = 'active' where id = p_contract_id and status = 'draft';
  end if;

  return v_id;
end;
$$;
revoke all on function public.submit_document_decision(uuid, public.document_decision, text) from public, anon;
grant execute on function public.submit_document_decision(uuid, public.document_decision, text) to authenticated;
