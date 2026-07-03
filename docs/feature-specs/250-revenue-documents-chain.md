# Spec 250 — Revenue documents chain: quotation → client PO → contract + งวดเบิก

**Status:** APPROVED (operator-aligned design 2026-07-03; part of the Finance build 249–253)
**Origin:** Finance user via operator — "สัญญาแต่ละโครงการดูงวดเบิก". Operator added: track the client-side document chain (PRC sends **ใบเสนอราคา**, client answers with a **PO**), and handle the recurring real case where **the client is slow on the contract but already paying** — no document may block the next step.

## Goals

1. Model the revenue chain per project: quotation(s) sent → client PO received → contract with งวดเบิก (installments).
2. Every link **nullable in both directions** — a contract without a quote, a PO without a quote, receipts before any of them (spec 249) are all legal.
3. Each `client_billings` row can claim against a specific งวด, so Finance sees per-งวด billed/received.
4. Leave the hook for a future full quotation entity (line items, versions) without rework.

## Data model (schema lane, migration ts `20260813062000`)

New tables (all RLS-on, money-read SELECT set = PM_ROLES + `accounting`, writes via DEFINER RPCs gated PM_ROLES, null-safe fail-closed):

- **`quotations`**: `id`, `project_id NOT NULL → projects`, `quotation_no text NOT NULL`, `amount numeric(14,2) CHECK (> 0)`, `quote_date date NOT NULL`, `status quotation_status NOT NULL default 'draft'` (new enum `draft | sent | accepted | rejected`), `note`, `document_path text NULL` (Storage object; single PDF v1), `created_by`, timestamps. Unique `(project_id, quotation_no)`.
- **`client_pos`**: `id`, `project_id NOT NULL`, `quotation_id uuid NULL → quotations`, `po_no text NOT NULL`, `po_date date NOT NULL`, `amount numeric(14,2) CHECK (> 0)`, `note`, `document_path NULL`, `created_by`, timestamps. Unique `(project_id, po_no)`. Cross-project quotation link rejected by trigger.
- **`project_contracts`**: `id`, `project_id NOT NULL UNIQUE` (one contract per project — operator decision), `quotation_id NULL`, `client_po_id NULL`, `contract_no text NULL`, `contract_value numeric(14,2) CHECK (> 0)`, `retention_rate numeric(5,4) NOT NULL default 0.05`, `sign_date date NULL`, `start_date date NULL`, `end_date date NULL`, `note`, `document_path NULL`, `created_by`, timestamps. Cross-project links rejected by trigger.
- **`contract_installments`**: `id`, `contract_id NOT NULL → project_contracts ON DELETE CASCADE`, `seq smallint NOT NULL CHECK (> 0)`, `label text NOT NULL` (e.g. "งวดที่ 1 — เซ็นสัญญา"), `amount numeric(14,2) CHECK (> 0)`, `planned_date date NULL`. Unique `(contract_id, seq)`.
- **`client_billings.installment_id uuid NULL → contract_installments`** — additive column; existing rows untouched; trigger rejects an installment whose contract belongs to another project.

**Deliberately NOT enforced:** Σ installments = contract_value (UI warns; Thai contracts vary), quotation `accepted` before a PO links it, contract requiring a PO. The chain is documentation, not a workflow gate.

**RPCs:** `create_quotation` / `update_quotation` (incl. status) / `create_client_po` / `update_client_po` / `upsert_project_contract` / `add_contract_installment` / `update_contract_installment` / `remove_contract_installment` — all PM_ROLES-gated DEFINER, null-safe. Installment remove refuses when current billings reference it (23503 by FK `ON DELETE RESTRICT` is acceptable — surface a friendly error).

## Behaviour / UI

Entry + display live on the spec 253 project drill (revenue section):

- Quotation list (status chips) + create/edit form; client PO list + form (optional quotation select scoped to the project); contract card (value, retention, dates, doc link) + งวด table.
- งวด table rows: seq · label · amount · planned date · billed (Σ current billings linked) · received (via spec 249 coverage) — per-งวด answer to "เบิกถึงไหน".
- Σ-installments ≠ contract_value renders a warning badge, nothing blocks.
- `create-billing-form` (spec 204 surface) gains an optional งวด select (installments of the project's contract) writing `installment_id`.
- Document upload: reuse the existing Storage upload pattern (browser-direct to a dedicated bucket path, path stored on the row). Read via signed URL, money-read roles only.

## Units

| Unit | Lane   | Content                                                                                                                  |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| U1   | SCHEMA | 4 tables + enum + triggers + RLS + RPCs + `client_billings.installment_id` + pgTAP + db:types                            |
| U2   | code   | Billing form งวด select + pure per-งวด rollup helpers (`src/lib/accounting/contract.ts`); drill forms land with spec 253 |

Out of scope: quotation line items/versions (future spec — `document_path` + `quotation_no` are the hook); multiple contracts per project / variation orders (future: additive `contract_adjustments`); watermarking documents; workflow gates on the chain.

## Verification checklist

- [ ] pgTAP: RLS read set (accounting yes, site_admin no, unbound fail-closed); write RPC gates; cross-project triggers reject; installment unique seq; billing→installment project guard; RESTRICT on referenced installment.
- [ ] Unit: per-งวด billed/received rollup; Σ-vs-value warning logic.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` + full `pnpm db:test` green.
