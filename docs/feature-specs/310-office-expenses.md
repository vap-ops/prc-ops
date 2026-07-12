# Spec 310 — Non-WP office expenses

**Status:** design approved (brainstorming, 2026-07-12). Phase-1 = capture + reimburse. GL + settlement = Phase-2.

## Context

Office/admin staff spend money on things that are **not WP material purchases**: fuel, tolls, office supplies, software subscriptions, utilities, government fees, meals. Some are attributable to a project; many are company overhead. Today there is **no home** for these — the only "expense" path is spec 285 site-purchase, which is WP-tied, catalog-only, and lives inside `purchase_requests`. So non-WP spend is invisible to the company and, critically, the person who fronted the money (often on the company credit card held by Pattrawut) has no tracked way to be reimbursed.

**Goal:** an office user records a non-WP expense, states **where the money came from**, and the system determines **who gets reimbursed**. A superadmin maintains the registry of company credit cards (which card belongs to whom).

## Goals / Non-goals

**Goals (Phase-1)**

- Office users record a non-WP expense: amount, date, category, description, optional project, receipt photo.
- Payment source selection drives a resolved reimburse-target.
- Superadmin card registry (label + holder, no card number).
- Finance/back-office marks an expense reimbursed when settled.

**Non-goals (deferred to Phase-2)**

- GL posting (needs accountant to assign SG&A account codes).
- Settlement/batch payout (group unreimbursed per person, record a single payout, reconcile).
- Approval workflow (Phase-1 is record-only, matching spec 285 precedent).
- Storing actual card numbers (never — see Security).

## Design decisions

### D1 — New tables, not `purchase_requests`

Spec 285 reused `purchase_requests` because site-purchase _is_ a WP + catalog purchase. Office expenses have **no WP, no catalog item**, and two new dimensions (payment source, reimburse-target). Forcing them into the WP-centric table means null `work_package_id`/`material_id` and semantic drift. Decision: own tables, own RLS, own lifecycle.

### D2 — Record-only, no approval

Trusted office roles record the expense with evidence; it books straight through. Consistent with spec 285. Amount-gated approval can be added later without schema churn (add nullable `approved_at`/`approved_by`).

### D3 — Payment source resolves reimburse-target server-side

The reimburse-target is **derived in the RPC**, never accepted from the client, so it cannot be spoofed.

| `payment_source` | reimburse-target                                  | requires            |
| ---------------- | ------------------------------------------------- | ------------------- |
| `company_card`   | the card's `holder_user_id` (PD Visa → Pattrawut) | a `company_card_id` |
| `own_money`      | the submitter (`auth.uid()`)                      | —                   |
| `company_direct` | none (`reimburse_to_user_id` NULL)                | —                   |

### D4 — Category table carries the future GL mapping

Categories are a small managed table (label-only, superadmin-editable — consistent with ADR 0080 open-data departments), **not a hard enum** (enums are painful to alter). Each category row has a nullable `gl_account_code`. Phase-2 GL = accountant fills those codes + we flip posting on. `project_id` + `category_id` are the two GL dimensions and are captured from day one, so Phase-2 is a pure add.

### D5 — Evidence expected, soft-gated

A receipt image is expected but attachments are post-create by architecture (same as 285). The expense saves, then flags **"รอใบเสร็จ"** (awaiting receipt) until ≥1 attachment lands, reading **complete** after. Not hard-blocked.

## Data model

All FKs: person = `public.users(id)`, project = `public.projects(id)`.

### `company_cards` (superadmin registry)

| column                                     | type                          | notes                                             |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------- |
| `id`                                       | uuid pk                       |                                                   |
| `label`                                    | text not null                 | e.g. 'PD Visa'                                    |
| `holder_user_id`                           | uuid not null → users         | reimburse-target for card spends                  |
| `last4`                                    | text null                     | optional, display only; CHECK 4 digits if present |
| `is_active`                                | boolean not null default true | soft-delete                                       |
| `created_by` / `created_at` / `updated_at` |                               |                                                   |

### `office_expense_categories` (managed list)

| column            | type                          | notes                                                 |
| ----------------- | ----------------------------- | ----------------------------------------------------- |
| `id`              | uuid pk                       |                                                       |
| `label_th`        | text not null                 |                                                       |
| `label_en`        | text null                     |                                                       |
| `gl_account_code` | text null                     | **Phase-2** GL mapping; FK-soft to `gl_accounts.code` |
| `sort`            | int not null default 100      |                                                       |
| `is_active`       | boolean not null default true |                                                       |

Seed (superadmin can edit): น้ำมัน/ค่าเดินทาง · ทางด่วน/ที่จอดรถ · อุปกรณ์สำนักงาน · ซอฟต์แวร์/บริการ · ค่ารับรอง/อาหาร · ค่าสาธารณูปโภค · ค่าธรรมเนียม/ราชการ · อื่นๆ.

### `payment_source` enum

`company_card` | `own_money` | `company_direct`.

### `office_expenses`

| column                 | type                                      | notes                                      |
| ---------------------- | ----------------------------------------- | ------------------------------------------ |
| `id`                   | uuid pk                                   |                                            |
| `project_id`           | uuid null → projects                      | null = company overhead                    |
| `category_id`          | uuid not null → office_expense_categories |                                            |
| `description`          | text not null                             | free-text (this is NOT a catalog purchase) |
| `amount`               | numeric not null                          | CHECK > 0                                  |
| `expense_date`         | date not null                             | when the spend happened                    |
| `payment_source`       | payment_source not null                   |                                            |
| `company_card_id`      | uuid null → company_cards                 | required iff source = company_card (CHECK) |
| `reimburse_to_user_id` | uuid null → users                         | RESOLVED server-side per D3                |
| `reimbursed_at`        | timestamptz null                          |                                            |
| `reimbursed_by`        | uuid null → users                         |                                            |
| `submitted_by`         | uuid not null → users                     | `auth.uid()` at insert                     |
| `created_at`           | timestamptz not null default now()        |                                            |

Derived state (no column): **awaiting-receipt** = no attachment; **awaiting-reimbursement** = `reimburse_to_user_id is not null and reimbursed_at is null`.

### Attachments

Receipt images via the existing storage-bucket pattern (`pr-attachments`/`po-attachments` precedent) → new bucket `expense-attachments`, path keyed by expense id. RLS mirrors the row's visibility.

## Security

- **No card numbers.** `company_cards` stores label + holder + optional `last4` only. Storing a full PAN pulls the app into PCI-DSS scope and PDPA breach liability for zero operational gain. Explicitly out of scope.
- **DEFINER RPCs**, mirroring `record_site_purchase`: `revoke all ... from public, anon; grant execute ... to authenticated`. Reimburse-target and `submitted_by` are set server-side from `auth.uid()`, never client input.
- **RLS** (writes RPC-only; tables select-scoped):
  - `office_expenses` SELECT: submitter sees own; back_office/super_admin (finance) see all. **Not** exposed to site roles even when `project_id` is set — project attribution is for accounting, not site-role visibility (back-office financial data stays back-office).
  - `company_cards` SELECT: authenticated may read `label`+`holder`+`last4` (needed by the form's card picker); INSERT/UPDATE via `upsert_company_card` DEFINER gated to `super_admin`.
  - `office_expense_categories` SELECT: authenticated; mutate: super_admin RPC.

## Reimburse logic (the core rule)

RPC `record_office_expense(p_project_id, p_category_id, p_description, p_amount, p_expense_date, p_payment_source, p_company_card_id)`:

1. Validate: amount > 0; category active; if `payment_source='company_card'` then `p_company_card_id` present + active, else must be null.
2. Resolve `reimburse_to_user_id`: card → `company_cards.holder_user_id`; own_money → `auth.uid()`; company_direct → null.
3. Insert with `submitted_by = auth.uid()`. Return new id.

RPC `mark_expense_reimbursed(p_expense_id)`: gated to finance roles (back_office/super_admin); sets `reimbursed_at = now()`, `reimbursed_by = auth.uid()`; no-op/error if already reimbursed or target is null.

## Surfaces & roles

| Surface                     | Route                                              | Roles                                                      |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Expense form + my-list      | `/expenses`                                        | back_office, procurement, procurement_manager, super_admin |
| Reimburse queue (mark-paid) | `/expenses` finance tab (or `/expenses/reimburse`) | back_office, super_admin                                   |
| Card registry (CRUD)        | `/settings/cards`                                  | super_admin                                                |

Form fields: category (select), amount, expense_date, project (optional select of active projects), payment source (segmented: card / own money / company) → card picker shown only for card, description, receipt upload.

## Units

- **U1 — schema** _(schema lane `075760`)_: 3 tables + `payment_source` enum + category seed + RLS + RPCs (`record_office_expense`, `mark_expense_reimbursed`, `upsert_company_card`, `deactivate_company_card`) + pgTAP. `expense-attachments` bucket + storage RLS.
- **U2 — card registry UI** (`/settings/cards`, super_admin): list + add/edit/deactivate card (label, holder picker, optional last4). Code-only.
- **U3 — expense form + my-list** (`/expenses`): the form (U1 RPC) + submitter's list with awaiting-receipt / reimburse-target chips + receipt uploader. Code-only.
- **U4 — reimburse queue**: finance list of awaiting-reimbursement grouped by target person, `[mark reimbursed]`. Code-only.
- **Phase-2** (separate spec/units): GL posting (accountant assigns `gl_account_code` per category, enqueue on insert like 285) + settlement/batch payout.

## Open questions (non-blocking; Phase-1 proceeds)

1. GL account codes per category — accountant, Phase-2.
2. Does `company_direct` need a sub-choice (which company account / petty cash vs bank)? Phase-1 treats it as one "company paid" bucket; can add a `company_account` registry later, symmetric to cards.
3. Reimburse queue as a tab on `/expenses` vs its own route — settle at U4 build.
