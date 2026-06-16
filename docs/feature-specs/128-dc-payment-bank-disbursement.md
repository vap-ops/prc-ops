# Spec 128 — DC payment bank disbursement (KBank), provider-abstracted

**Status:** DESIGN — 2026-06-16. **Blocked on operator input** before build (see
§Blocker). **Type:** money + external integration + DB migration (prod). Extends
[spec 127](127-dc-payment-recording.md) (the DC payment ledger) from _recording a
manual transfer_ to _preparing/executing the transfer_.

Operator decisions (2026-06-16):

- Target **Path A** first — generate a KBank bulk-payment file the operator
  uploads in **K BIZ**; import the result to mark paid. No new bank contract.
- Design **provider-abstracted** so Bulk Gateway (B) and live Open API (C) are
  future adapters, not rewrites.
- KBank access (Bulk Gateway / corporate API) status **TBD** — operator checks
  with KBank. Path A needs only the existing K BIZ login.

## Reality (researched 2026-06-16)

KBank's **self-serve Open API** (`apiportal.kasikornbank.com`) products are QR
payment, inward remittance, K PLUS info-sharing, slip verification, bill payment
— **no self-serve outbound payroll/credit-transfer API**. Auth there is OAuth2
client-credentials + **mTLS** (two-way SSL); sandbox `openapi-sandbox.kasikornbank.com`.

KBank's payroll money-out is **file/batch**, not realtime API:

- **K BIZ bulk payroll** — manual web upload, ≤500 payees (Path A target).
- **Bulk Gateway Service** / **K-Cash Connect Plus** — file-based host-to-host
  (SFTP), contract + credentials required (Path B).
- Live realtime transfer (Path C) needs a corporate fund-transfer API agreement
  KBank rarely grants for payroll.

The upload file is a **"Smart Payroll"-style fixed-width / delimited text file**
keyed on payee name + receiving account + amount, plus a company-account /
sender header. Exact field widths, encoding, bank-code handling and result-file
layout are **product- and account-specific** — they MUST be confirmed against
the operator's real K BIZ template before the writer is implemented (a money
file; a wrong width mis-pays or rejects). See §Blocker.

## Paths (one spine, three transports)

| Path                    | App does                                                  | Needs from KBank                  | This spec       |
| ----------------------- | --------------------------------------------------------- | --------------------------------- | --------------- |
| **A — K BIZ bulk file** | generate file → operator uploads in K BIZ → import result | nothing beyond K BIZ login        | **build first** |
| **B — Bulk Gateway**    | generate **+ SFTP-transmit** → ingest result file         | Bulk Gateway agreement + SFTP key | adapter seam    |
| **C — Open API**        | realtime per-payment call (OAuth2+mTLS)                   | corporate transfer API contract   | adapter seam    |

## Safety spine (non-negotiable, all paths)

- **No money moves without an explicit human authorize step.** The system
  _prepares_ a batch and _generates_ a file; a PM/super must **authorize** the
  batch (a deliberate, audited action) before a file is downloadable
  (A) / transmitted (B) / sent (C). Auto-send is never wired.
- **Idempotency + double-pay guard.** Each instruction carries an idempotency
  key; reconciliation into the ledger reuses spec 127's one-current-payment-
  per-(contractor, period) guard, so a re-imported result cannot double-record.
- **Credential isolation.** SFTP keys / API certs / secrets live server-only in
  the **worker**, never in the Next bundle or the repo. Path A needs no such
  secret (manual transport), which is part of why it ships first.
- **Money-isolation unchanged (spec 127).** Amounts/accounts have zero
  authenticated grant; all of this is PM/super-only, admin-client reads, RPC
  writes.

## Data model (Path A; B/C reuse it)

Extends spec 127's `dc_payments`:

- `source` enum `dc_payment_source` (`manual`, `kbiz_bulk`, `bulk_gateway`,
  `api`) NOT NULL DEFAULT `manual` — backward-compatible; existing rows = manual.
- `batch_id` uuid NULL → `dc_payment_batches(id)`.
- `record_dc_payment` gains `p_source` (default `manual`) + optional `p_batch`;
  the spec-127 call sites are unaffected (defaults preserve behaviour).

New tables (money-isolated like `dc_payments`: zero grant, RLS on, RPC-written):

- **`dc_payment_batches`** — one disbursement run. `id`, `provider`
  (`dc_payment_provider` enum = the path), `status` (`dc_batch_status`:
  `draft → authorized → submitted → settled | partial | failed | cancelled`),
  `created_by`, `authorized_by` NULL, `authorized_at` NULL, `file_generated_at`
  NULL, `note`, `created_at`. Append-only on the terminal states via audited RPC
  transitions (no silent UPDATE of a settled batch).
- **`dc_payment_instructions`** — one payee line in a batch. `id`, `batch_id`,
  `contractor_id`, `period_from`, `period_to`, `amount` numeric(12,2),
  **account snapshot** (`bank_code`, `account_no`, `account_name` — snapshotted
  at batch build so a later contact-bank edit can't retro-alter a sent file),
  `idempotency_key` text UNIQUE, `status` (`pending → sent → settled | failed`),
  `result_code` NULL, `dc_payment_id` NULL → `dc_payments(id)` (set on settle),
  `created_at`. Constraint: one current instruction per (batch, contractor,
  period).

RPCs (SECURITY DEFINER, pm/super only — money):

- `create_dc_payment_batch(provider, instruction[])` — builds a draft batch +
  instructions, snapshotting each contractor's bank from `contact_bank`; refuses
  payees with no bank on file or a blacklisted contractor; audited.
- `authorize_dc_payment_batch(batch)` — `draft → authorized`, stamps
  `authorized_by/at`; the gate that unlocks file generation; audited
  (`dc_batch_authorize`). Refuses non-draft.
- `record_dc_batch_result(batch, [{instruction, ok, code}])` — per instruction:
  on ok → `record_dc_payment(..., p_source=batch.provider, p_batch=batch)` +
  link `dc_payment_id`, instruction → settled; on fail → failed + code. Batch →
  `settled`/`partial`/`failed` by roll-up. Reuses the dup guard; audited.

## App layer

- **Pure (TDD):** `src/lib/labor/disbursement/` —
  - `BankDisbursementProvider` interface: `formatBulkFile(instructions,
senderConfig): { filename, mime, content }`, `parseResultFile(text):
InstructionResult[]` (Path A); B adds `transmit()`, C is a separate
    `sendInstruction()` adapter (different shape — not forced into the file
    interface).
  - `kbank/` impl: the file writer + result parser. **Format pinned by tests
    against a real K BIZ sample** (see §Blocker) — the writer is the only piece
    that waits.
  - `senderConfig` (company account, sender name/code) from project settings /
    env — operator-provided, never hard-coded (ADR 0035 tenant-clean).
- **Actions:** `createDcPaymentBatch`, `authorizeDcPaymentBatch`,
  `importDcBatchResult` (file upload → parse → `record_dc_batch_result`).
- **UI:** on `/payroll`, select unpaid contractor×period rows → "เตรียมจ่าย"
  builds a batch; a batch detail surface shows instructions, an **authorize**
  button (the gate), a **download file** action (post-authorize), and an
  **import result** uploader; settle flips the payroll rows to จ่ายแล้ว
  (source-tagged). Reuses spec 127's badges/drift.

## Units (when unblocked)

- **U1** — data model: `dc_payment_source`/`provider`/`batch_status` enums,
  `dc_payments` `source`+`batch_id`, `dc_payment_batches` +
  `dc_payment_instructions`, the 3 RPCs, `record_dc_payment` source param. pgTAP
  - types. (Prod migration → operator gate.)
- **U2** — pure `BankDisbursementProvider` + KBank file writer + result parser
  (TDD against the operator's sample), `senderConfig`.
- **U3** — batch/authorize/import actions + `/payroll` UI.
- **Seam** — Path B (Bulk Gateway SFTP transmit + auto-ingest), Path C (Open API
  adapter, OAuth2+mTLS in the worker), export/import audit depth.

## Blocker (must resolve before build)

The KBank bulk-file + result-file **byte layout is account/product-specific and
cannot be safely guessed** (money file). To build U2 (and validate U1's
snapshot fields), I need from the operator **one** of:

1. A **sample/template** K BIZ bulk-payment upload file (a real or dummy export),
   **and** a sample **result/confirmation** file, **and**
2. Which K BIZ payment product they use (K-Payroll / K-Cash Connect Plus Smart
   Payroll / "โอนเงินหลายบัญชี" bulk transfer), **and**
3. The sender/company account config the file header expects.

Until then: U1 (bank-agnostic data model) is buildable; U2's writer is not. Per
CLAUDE.md "when blocked, do not improvise" — the format is confirmed against a
real sample, never reverse-guessed.

## Out of scope / recorded seams

- Live realtime transfer (Path C) and Bulk Gateway automation (Path B).
- Multi-bank payees (a DC paid into a non-KBank account — the file carries a
  receiving bank code; cross-bank is in-format but fees/cutoffs are a bank-side
  concern).
- FX / non-THB. PromptPay-by-ID payees (vs account number).
- Scheduling/recurring auto-runs (explicitly NOT auto — the authorize gate stays
  manual).

## Sources

- KBank Open API portal — https://apiportal.kasikornbank.com/
- Bulk Gateway Service — https://www.kasikornbank.com/en/business/cash-management/e-service-payment/pages/bulk-gateway.aspx
- K BIZ payroll — https://www.kasikornbank.com/en/business/sme/financial-services/money-transfer/pages/payroll.aspx
- KBTG two-way SSL / OAuth guides — https://katalyst.kasikornbank.com/th/blog/Pages/api-with-kbank.html
