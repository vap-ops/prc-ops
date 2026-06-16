# Spec 129 — PEAK accounting integration (outbound sync)

**Status:** in progress — 2026-06-16. **Type:** external integration + DB
migration (prod). Pushes prc-ops financial facts into **PEAK** (peakaccount.com),
the Thai cloud accounting platform. prc-ops is the source of truth; PEAK is the
accounting destination — **outbound, one-directional**.

Operator decisions (2026-06-16):

- Scope = **both** purchases → PEAK expenses **and** DC payments → PEAK expenses,
  with **contacts** (vendors/contractors) sync as the shared foundation.
- PEAK API access = **none yet**; operator requests the free **3-month UAT
  sandbox** (API Key + Secret Key). Build the credential-free parts meanwhile;
  the live client (U3) waits on the sandbox creds.

## PEAK API reality (researched 2026-06-16)

REST/JSON org API, docs at `developers.peakaccount.com` (`llms.txt` +
OpenAPI). Auth: `POST /api/v1/clienttoken` exchanged from an **API Key + Secret
Key** → a ClientToken; per-app **User Token** also exists. Free **3-month UAT**
sandbox. Real endpoints (verbatim):

- `POST/GET /api/v1/contacts`, `/contacts-list`, `/contacts-group`,
  `/contacts-edit` — contact auto-fills from the 13-digit tax id.
- `POST/GET /api/v1/expenses` (+ `/expenses-void`, `-list`), `/billingnotes`.
- `/invoices`, `/quotations`, `/receipts`, `/creditnotes`.
- `/products`, `/services`, `/paymentmethods` (+ `-transfer`), `/dailyjournals`
  (+ `-void`).
- Has **rate-limiting / concurrency** rules + **webhooks**.

Exact request-body field schemas for `/contacts` and `/expenses` are pulled per
unit from the OpenAPI reference before the transforms (U2) are written — never
guessed (same money-correctness posture as spec 128's file format).

### Verified so far (2026-06-16, from `developers.peakaccount.com/reference/*.md`)

**Auth headers (every call)** — richer than a bearer token; lands in U3 (worker):

- `Client-Token` (from `POST /api/v1/clienttoken` via API Key + Secret Key)
- `User-Token` (issued per app by PEAK)
- `Time-Stamp` (`yyyyMMddHHmmss`)
- `Time-Signature` (HMAC-SHA1 of the Time-Stamp, key = the Secret Key / connectId)

**`POST /api/v1/contacts`** — body wraps `{ "PeakContacts": { "contacts": [ … ] } }`.
Per-contact fields: `name` (req), `type` (int, req — PEAK contact-type code;
**only `5`=Individual confirmed, vendor/juristic codes TBD with PEAK**),
`code` (opt, our local ref), `taxNumber`, `branchCode` (5-digit), address group
(`address`, `subDistrict`, `district`, `province`, `country`, `postCode`),
contact-person group (`contactFirstName/LastName/NickName/Position`,
`contactPhoneNumber`, `contactEmail`), `purchaseAccount` / `sellAccount` (COA
codes — the mapping blocker), `bankAccount` `{ bankId, bankBranch, bankAccountNo,
bankAccountName }` (`bankId` = PEAK bank code, **lookup TBD**), `prefixNameType`
(int, req when `type=5`).

**Open unknowns that gate U2/U3 build** (beyond UAT creds + COA mapping):
the contact `type` code for a vendor/juristic party, and the `bankId` code map —
both confirmed with PEAK, not guessed.

## Flows (prc-ops fact → PEAK object)

| Flow                      | prc-ops source                                         | PEAK target | Notes                                                          |
| ------------------------- | ------------------------------------------------------ | ----------- | -------------------------------------------------------------- |
| **Contacts** (foundation) | `contractors` + `suppliers` (tax_id, address)          | `/contacts` | prerequisite — every expense references a PEAK contact id      |
| **Purchases → expense**   | `purchase_orders` / site purchases / supplier invoices | `/expenses` | high volume; VAT + supplier WHT                                |
| **DC payments → expense** | spec 127 `dc_payments`                                 | `/expenses` | contractor WHT (หัก ณ ที่จ่าย); ties labor money to accounting |

## Architecture — reuse the outbox + worker drainer (ADR 0037 precedent)

prc-ops already runs an outbox (`notification_outbox`) drained by the **worker**
(service-role). PEAK sync reuses that exact shape:

- **`peak_sync_outbox`** — queued sync jobs. Deliberately mutable (the drainer
  updates status/attempts), **zero user access** (RLS on, no policies, privileges
  revoked) — writers are SECURITY DEFINER enqueue functions, the only
  reader/updater is the worker via the service-role client. Same posture as
  `notification_outbox`.
- **`peak_sync_links`** — the idempotency map: `(entity_table, entity_id)` →
  `(peak_doc_type, peak_doc_id)`, UNIQUE. A job whose entity already has a link
  is an update/void, never a second create — **no double-posting**. PEAK
  `-void` endpoints handle reversal.
- **Worker drainer** (U3) — mints a ClientToken (API Key + Secret Key from the
  **worker env, never the repo/bundle**), reads pending jobs oldest-first,
  builds the PEAK payload via the pure transforms, POSTs to PEAK, writes the
  returned doc id into `peak_sync_links` + flips the outbox row to `sent`.
  Rate-limit / concurrency aware (PEAK publishes limits). Failures →
  `failed` + `last_error` + bounded retry (notification-drain precedent).
- **Posture: not silent-auto.** A financial post is reviewable — the outbox
  carries `sent | failed | skipped` and an admin retry/void surface (U4). First
  cut queues + posts with status, no fire-and-forget.

## Mapping config (accountant input — the correctness blocker)

prc-ops expense types → PEAK **chart-of-accounts / expense category** + **WHT
rate** (DC labor vs material vs service differ). This MUST come from the
operator's accountant; scaffolded as a config map (not hard-coded — ADR 0035
tenant-clean), filled before U2 transforms go live. Until then transforms are
unit-tested against a placeholder map.

## Data model (U1 — this unit, credential-free)

Enums: `peak_entity_type` (`contact`, `expense`), `peak_sync_operation`
(`create`, `void`), `peak_sync_status` (`pending`, `sending`, `sent`, `failed`,
`skipped`), `peak_doc_type` (`contact`, `expense`).

- **`peak_sync_outbox`**: `id` uuid PK, `entity_type` peak_entity_type NOT NULL,
  `source_table` text NOT NULL (the prc-ops table — `contractors` / `suppliers`
  / `purchase_orders` / `dc_payments` / …), `source_id` uuid NOT NULL,
  `operation` peak_sync_operation NOT NULL DEFAULT `create`, `payload` jsonb
  NOT NULL DEFAULT `{}` (snapshot/prepared body; the PEAK shape lives here so
  the table is schema-shape-agnostic), `status` peak_sync_status NOT NULL
  DEFAULT `pending`, `attempts` int NOT NULL DEFAULT 0, `last_error` text,
  `peak_doc_type` peak_doc_type NULL, `peak_doc_id` text NULL, `created_at`,
  `sent_at`. Index `(status, created_at)` (drain order, notification precedent).
- **`peak_sync_links`**: `id` uuid PK, `source_table` text NOT NULL, `source_id`
  uuid NOT NULL, `peak_doc_type` peak_doc_type NOT NULL, `peak_doc_id` text
  NOT NULL, `created_at`, UNIQUE `(source_table, source_id, peak_doc_type)`.
- Both: RLS enabled, **zero authenticated grant, no policies** (worker-only via
  service-role, like `notification_outbox`).
- **`enqueue_peak_sync(p_entity_type, p_source_table, p_source_id, p_operation,
p_payload)`** SECURITY DEFINER — the only writer. Role-gated to staff
  (sa/pm/super) for the manual path; later capture triggers call it too.
  Idempotent enqueue: skips if a `pending`/`sending` job already exists for
  `(source_table, source_id, operation)` (no duplicate queue rows).

No audit_action change (the outbox is delivery state, not evidence — same call
as `notification_outbox`; the source rows are already audited).

## Units

- **U1 — sync infrastructure (this unit, credential-free):** enums +
  `peak_sync_outbox` + `peak_sync_links` + `enqueue_peak_sync` RPC + pgTAP +
  types. Prod migration → operator gate before `db:push`.
- **U2 — pure transforms + mapping config:** `contractor/supplierToPeakContact`,
  `purchaseOrder/dcPaymentToPeakExpense` → PEAK payloads (TDD; fetch the exact
  `/contacts` + `/expenses` field schemas first), COA + WHT mapping config.
- **U3 — worker PEAK client + drainer:** ClientToken auth, rate-limit-aware
  POST, link write-back, retry. **Needs UAT creds.**
- **U4 — capture + admin surface:** enqueue triggers on PO recorded / dc_payment
  recorded / contact upsert; a sync-status list with retry/void.

## Verification (U1)

`pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; pgTAP for the new
tables (shape, zero-grant posture, enqueue RPC role gate + idempotent skip).
**Gate → operator confirms → `pnpm db:push`** (prod) → `db:types` → reconcile →
`db:test`.

## Blockers (downstream units)

- **UAT credentials** (API Key + Secret Key) — operator requests from PEAK (U3).
- **COA / WHT mapping** — accountant input (U2 correctness).
- **PEAK payload field schemas** — fetched from the OpenAPI before U2.

## Out of scope / seams

- Inbound sync (PEAK → prc-ops) — not now; prc-ops stays the source of truth.
- Invoices/receipts/quotations to PEAK (prc-ops is ops, not the billing system
  of record for customers — `/invoices` stays unused unless a flow needs it).
- e-Tax Invoice issuance, PEAK webhooks back into prc-ops, journal-entry sync.
- Auto-fire without review (the status/retry posture stays).
