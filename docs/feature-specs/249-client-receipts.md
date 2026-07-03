# Spec 249 — Client receipts (เงินรับจากลูกค้า) + billed-vs-received rollup

**Status:** APPROVED (operator-aligned design 2026-07-03; part of the Finance build 249–253)
**Origin:** Finance user via operator — "วางบิลไปแล้วกี่บิล และได้รับเงินครบหรือยัง". Today `client_billings.status` has a `paid` value but payment-received is a **status flip only** — no receipt rows, no partial payments, no advances. Operator constraint: **clients sometimes pay before the contract (or even the billing) exists** — money must never be blocked by a missing document.

## Goals

1. Record actual cash received from clients: amount, date, method — including **partial** payments.
2. Support **advance receipts**: a receipt with NO billing link (money before billing/contract), reallocatable later.
3. Answer "ได้รับเงินครบหรือยัง" per billing and per project: billed vs received vs outstanding vs unallocated advance.
4. Post receipts to the GL (cash in; AR settle or customer-advance liability).

## Data model (schema lane, migration ts `20260813063000`)

- **`client_receipts`** (append-only, supersede pattern — mirrors `dc_payments`):
  - `id uuid PK`, `project_id uuid NOT NULL → projects`, `client_billing_id uuid NULL → client_billings`,
    `amount numeric(14,2) CHECK (amount > 0)`, `received_date date NOT NULL`,
    `method receipt_method NOT NULL` (new enum `bank_transfer | cheque | cash`),
    `note text NULL`, `created_by uuid NOT NULL`, `created_at`, `superseded_by uuid NULL → client_receipts(id)`.
  - Append-only guard trigger (BEFORE UPDATE/DELETE/TRUNCATE raises), same as the ERD-audit M7 pattern.
  - If `client_billing_id` set: same-project CHECK enforced by trigger (billing.project_id = NEW.project_id).
  - Edits + re-allocation (advance → billing) = supersede row; current-state reads = anti-join.
- **RLS:** SELECT to the money-read set (PM_ROLES + `accounting`, tenant-scoped per `money-read-policy.ts` conventions); INSERT via DEFINER RPC only; no UPDATE/DELETE grants.
- **RPCs (null-safe gates, fail-closed):**
  - `record_client_receipt(p_project, p_billing NULL, p_amount, p_date, p_method, p_note)` — gate PM_ROLES (project_manager/super_admin/project_director). Enqueues GL posting.
  - `supersede_client_receipt(p_receipt, …new values)` — same gate; inserts the replacement row pointing at the old, enqueues GL reversal + re-posting.
- **GL:** outbox rows `source_table='client_receipts'`. Drain gains a CASE arm — **body re-sourced VERBATIM from LIVE** (hard lesson ×3: never from a migration file). Postings:
  - Billing-linked: Dr cash · Cr AR.
  - Unlinked (advance): Dr cash · Cr **customer-advance liability** (เงินรับล่วงหน้าจากลูกค้า — add a 2xxx `gl_accounts` row if absent).
  - Re-allocation supersede: reversal of the old posting + new posting.
  - Exact account codes resolved at build time from the live COA; do not invent codes if suitable ones exist.
- **Billing paid status:** when a `record_client_receipt`/supersede leaves a billing's current receipts ≥ `net_receivable`, the RPC advances `client_billings.status → paid` (respecting the existing status machine; verify the allowed transition at build time — if `invoiced→paid` is the only legal edge, only auto-flip from `invoiced`). Display-level coverage (received/outstanding) is always computed from receipts regardless of status.

## Behaviour / UI

- `/accounting/billings`: each billing row gains received-so-far + outstanding; a receipts drawer (list + record form for PM_ROLES; read-only for `accounting`).
- Advance receipts (no billing) are recorded from the project drill (spec 253) revenue section; shown as "เงินรับล่วงหน้า (ยังไม่ตัดบิล)" with a re-allocate action (PM_ROLES) once billings exist.
- Rollup helper (pure, unit-tested) `src/lib/accounting/receipts.ts`: per-billing coverage + per-project {billed, received, advances, outstanding}.

## Units

| Unit | Lane   | Content                                                                                                                                                                |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1   | SCHEMA | Table + enum + guards + RLS + 2 RPCs + GL outbox arm (drain re-sourced from LIVE) + advance-liability account + pgTAP + db:types                                       |
| U2   | code   | Receipts drawer + coverage columns on `/accounting/billings`; pure rollup helpers; advance record/re-allocate on the drill (lands with spec 253 if sequencing demands) |

Out of scope: multi-billing split allocation of ONE receipt (v1: one receipt row links one billing; split = supersede into rows); receipt documents/attachments; client refunds (negative receipts) — follow-up spec if Finance asks.

## Verification checklist

- [ ] pgTAP: append-only guard; RLS (accounting read, site_admin no-read, unbound-caller fail-closed); RPC gates null-safe; same-project billing check; GL rows enqueued (linked → AR arm, unlinked → advance arm); supersede reverses + re-posts; paid auto-flip only on legal transition.
- [ ] Unit: coverage math (full/partial/over/advance/superseded excluded); re-allocation.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` + full `pnpm db:test` green.
