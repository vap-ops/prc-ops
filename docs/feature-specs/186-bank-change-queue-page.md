# Spec 186 — Contractor bank-change approval queue page

## Origin

Follow-up to spec 184/185 (the deferred "dedicated bank-change queue"). Operator:
"proceed." Spec 184 surfaced the pending contractor bank-change COUNT on the
dashboard ([[183-approvals-awareness]]); spec 185's card links to
`/contacts/subcontractors`, where the PM must hunt for the flagged contractor.
This closes the awareness→action loop: a real queue listing every pending
bank-change with an inline approve/reject.

## Background

- Bank changes = `contractor_bank_change_requests` at `status='pending'`
  (contractor = subcontractor; DC is a worker now, ADR 0062). Bank fields have
  zero authenticated grant (money) → read via the admin client behind a role gate
  (same as the contractor detail page does, `/contacts/[type]/[id]/page.tsx`).
- Decision: `decide_contractor_bank_change` RPC, gate pm/super/director (mig
  20260751 added director) — so deciders = `isManagerRole`. Procurement onboards
  contractors but does NOT decide bank changes → excluded.
- The decision UI already exists and is reusable: `BankChangeDecision({ requestId,
revalidate })` (`src/components/features/portal/bank-change-decision.tsx`).

## Design

A new route `/contacts/bank-changes` (static segment — wins over the `[type]`
dynamic route), gated `requireRole(PM_ROLES)`:

- Admin-read every `pending` request (id, contractor_id, bank fields, created_at),
  oldest first; join contractor names (admin read). A pure
  `buildBankChangeQueue(rows, namesById)` builds the view model (name fallback
  "—").
- Render a `DetailHeader` (back → `/dashboard`, the card's origin) + a list: per
  request the contractor name, the proposed bank (name / account name / account
  no), when it was submitted, and the reused `BankChangeDecision` (revalidate
  `/contacts/bank-changes`). Calm empty state.
- Repoint the spec-185 dashboard bank-change card from `/contacts/subcontractors`
  to `/contacts/bank-changes`.

The per-contractor pending block on the contractor detail page stays (the
per-contractor view); this is the aggregate queue.

## Units

### U1 — The queue page + card repoint

- `src/lib/approvals/bank-change-queue.ts`: pure `buildBankChangeQueue`.
- `src/app/contacts/bank-changes/page.tsx`: the gated queue page (admin-read,
  DetailHeader, reused decision component).
- Dashboard: the bank-change `AwarenessCard` href → `/contacts/bank-changes`.
- Test-first: `buildBankChangeQueue` (name join; missing name → "—"; empty → []).

## Acceptance

- A PM-tier user reaching `/contacts/bank-changes` sees every pending contractor
  bank change with the proposed bank details and can approve/reject inline.
- The dashboard bank-change card lands there (not the contractor list).
- Procurement / SA cannot reach it (PM_ROLES gate).
- `pnpm lint && pnpm typecheck && pnpm test` green. No DB.

## Notes

- No DB — reads against existing tables/policies + the existing decide RPC.
- Worker-DC bank changes (ADR 0062 U4c-2) aren't built; when they are, this queue
  (or a sibling) lists them too.
