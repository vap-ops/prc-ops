# Lalamove Delivery API — Integration Research (Thailand)

> Findings to ground a FUTURE spec/ADR for dispatching material deliveries and
> capturing proof-of-delivery (POD). Operator asked to "check Lalamove API, we will
> apply in the future soon" (2026-06-17). NOT built — this is research only.
> Verified against official Lalamove developer docs where possible; uncertain items
> flagged inline (⚠️).

## 1. Availability & account model (Thailand)

- **Available in Thailand.** Lalamove markets API integration on its Thai site and
  the v3 API exposes market code **`TH`** with cities **Bangkok (`TH BKK`)** and
  Chonburi, languages `th_TH` / `en_TH`. [1][8][2]
- **Account = Lalamove Business Account + Partner Portal registration.** Self-serve
  at `partnerportal.lalamove.com`. Integration typically takes "a week or two"
  before Go-Live. Support: `partner.support@lalamove.com` / `api-support@lalamove.com`. [1][3][9]
- **Onboarding (4 steps, official):** (1) study docs; (2) register as API Partner;
  (3) Sandbox — keys issued immediately, no money; (4) Production — _"top up real
  money as actual credits to generate the Production API Keys."_ [1]
- **KYC / business-registration prerequisites: NOT documented publicly.** ⚠️ Confirm
  during onboarding (a Thai business entity + wallet top-up almost certainly
  required for production, but not stated in the docs).

## 2. Authentication

- **Scheme: HMAC-SHA256 request signing.** API **key + secret** from the Partner
  Portal "Developers" tab. [2][3]
- **Signature string (verified verbatim, 3 independent sources):** [2][4][3]
  ```
  SIGNATURE = HmacSHA256ToHex(<TIMESTAMP>\r\n<HTTP_VERB>\r\n<PATH>\r\n\r\n<BODY>, <SECRET>)
  ```

  - `TIMESTAMP` = Unix epoch **milliseconds**; `HTTP_VERB` = GET/POST/PUT/DELETE/PATCH;
    `PATH` = pathname incl. version (e.g. `/v3/quotations`); `BODY` = JSON string
    (empty for GET). Note the **blank line** (double `\r\n`) between PATH and BODY.
    Output is **lowercase hex**.
- **Authorization header:** `Authorization: hmac <KEY>:<TIMESTAMP>:<SIGNATURE>` [2][3]
- **Other required headers:** `Market: <MARKET_CODE>` (e.g. `TH`),
  `Request-ID: <NONCE>` (unique per request — replay protection / tracing),
  `Content-Type: application/json`. [2]
- **Base URLs & versioning:** [2]
  - Sandbox: `https://rest.sandbox.lalamove.com/v3`
  - Production: `https://rest.lalamove.com/v3`
  - **Current version: v3.** **v2 deprecated 30 Apr 2024** — build on v3 only. [7]
- **Key prefixes:** sandbox `pk_test`/`sk_test`, production `pk_prod`/`sk_prod`. [2]

## 3. Core REST endpoints (v3)

| Purpose                            | Method & Path                                    | Notes                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quotation**                      | `POST /v3/quotations`                            | `serviceType`, `stops[2–16]`, `language`, optional `scheduleAt` (ISO-8601 UTC), `specialRequests`, `item`, `isRouteOptimized`. Returns `quotationId`, `expiresAt` (**5-min validity**), `priceBreakdown`, `distance`, `stops`. [2][5] |
| Quotation detail                   | `GET /v3/quotations/{quotationId}`               | service type, special requests, stops bound to the quotation ID in v3. [2]                                                                                                                                                            |
| **Place order**                    | `POST /v3/orders`                                | `quotationId`, `sender{stopId,name,phone}`, `recipients[]`, **`isPODEnabled`** (bool), `partner`, `metadata`. Returns `orderId`, `status`, `driverId`, `shareLink`, `priceBreakdown` (incl. `priorityFee`), `stops`. [2]              |
| **Get order / status**             | `GET /v3/orders/{orderId}`                       | orders ≤ 60 days old. Carries `status` and (when enabled) POD data in `stops`. [2]                                                                                                                                                    |
| **Driver details + live location** | `GET /v3/orders/{orderId}/drivers/{driverId}`    | from 1 h before `scheduleAt` (or on pickup arrival) until completion. **Location ~every 10 s.** [2]                                                                                                                                   |
| **Add priority fee / tip**         | `POST /v3/orders/{orderId}/priority-fee`         | `{"data":{"priorityFee":"20"}}`. Only before driver accepts; each new fee must exceed the previous. [2]                                                                                                                               |
| **Cancel order**                   | `DELETE /v3/orders/{orderId}`                    | only during `ASSIGNING_DRIVER` or within 5 min of matching, else fees may apply. [2][4]                                                                                                                                               |
| Change driver                      | `DELETE /v3/orders/{orderId}/drivers/{driverId}` | 15+ min after match, pre-pickup; needs `reason`. [2]                                                                                                                                                                                  |
| Edit order                         | `PATCH /v3/orders/{orderId}`                     | once, during `ON_GOING` pre-pickup; drop-off only. [2]                                                                                                                                                                                |
| City/service catalog               | `GET /v3/cities`                                 | per-city service types + special requests — **source of truth for valid `serviceType` per market.** [2]                                                                                                                               |
| Set webhook                        | `PATCH /v3/webhook`                              | webhook URL; can also be set in Partner Portal. [2][9]                                                                                                                                                                                |

- Multi-stop up to **16 stops** per order (some sources cite 19; treat 16 as the
  quotation-array limit, verify). Phones must be **E.164** (`^\+[1-9]\d{1,14}$`).
  Scheduling up to **30 days** ahead. [2][5][1]

## 4. Webhooks (incl. proof of delivery)

- **Config:** `PATCH /v3/webhook` or Partner Portal → Developers. Choose **Webhook
  Version 3**. [9]
- **Event types:** `ORDER_STATUS_CHANGED` (main lifecycle), `DRIVER_ASSIGNED`,
  `ORDER_AMOUNT_CHANGED`, `ORDER_REPLACED` (cancel-and-clone), `ORDER_EDITED`,
  `WALLET_BALANCE_CHANGED`, and **`POD_STATUS_CHANGED`** / **`POP_STATUS_CHANGED`**
  (proof of delivery / pickup). ⚠️ POD/POP events listed in the v3 reference; the
  v1.4 tutorial deck enumerated the first six — treat POD/POP as v3-current,
  confirm in sandbox. [9][3]
- **`ORDER_STATUS_CHANGED` carries 7 statuses:** `ASSIGNING_DRIVER`, `ON_GOING`,
  `PICKED_UP`, `COMPLETED`, `EXPIRED`, `CANCELED`, `REJECTED`. [9]
- **Payload (v3):** `eventType`, `eventVersion`, top-level `updatedAt`, `data`
  object with the order (`orderId`, `market`, `driverId`, `shareLink`, `status`,
  `previousStatus`, `createdAt`, `scheduledAt`; CANCELED adds `cancelParty`/
  `cancelReason`). Only changed sub-objects on `ORDER_EDITED`. [9]
- **Operational caveats (official):** [9]
  - Webhooks may arrive **out of chronological order** → **sort by timestamp**;
    treat status as a set, not a stream.
  - Retries: up to **10 attempts over 24 h** with exponential backoff; after 10
    failures Lalamove **disables the URL** (re-save in Portal). → endpoint must
    return **HTTP 200 quickly, before any heavy logic**.
  - Fields are **subject to change — do not hard-code**; ignore unknown fields.
  - **Cancel-and-clone:** post-match adjustments cancel the old order and create a
    clone; you get `CANCELED` → new order `ASSIGNING_DRIVER` … + `ORDER_REPLACED`
    linking old→new. Model must follow the order-ID hand-off.
- **Webhook signature verification:** recompute an HMAC from your **API secret** +
  the **URL path after the root domain** and compare to the signature Lalamove
  sends. ⚠️ Exact inbound-webhook signature **header name + signed-string** not
  stated verbatim publicly — confirm against the in-portal "Validating the
  webhooks" sample during build. [9]
- **Proof of Delivery (how POD is delivered):**
  - Enabled **per order** via `"isPODEnabled": true` at place-order; driver is
    prompted for photo and/or recipient signature(s). [4][6]
  - POD lifecycle signalled by **`POD_STATUS_CHANGED`**; the **artifact itself
    (photo/signature) is retrieved via `GET /v3/orders/{orderId}`**, inside the
    per-stop data (status + image URL + timestamp). [2][3]
  - ⚠️ **Exact field names not confirmable from public docs** (deep v3 reference
    returns 403 to anonymous fetch). Plan for POD `status`
    (`PENDING`/`DELIVERED`/`SIGNED`/`FAILED`), an `image`/photo URL, possibly a
    separate signature URL, recipient name, `deliveredAt` — **schema TBD until
    sandbox.** Verify whether the photo URL is **time-limited/signed** (drives
    whether we must copy it into our own storage promptly).

## 5. Service / market types in Thailand

Vehicle types + **load limits** (Thai pricing page — verify live via `GET /v3/cities`,
codes are per-city): [10]

| Vehicle         | Max weight | Cargo (cm, approx)      |
| --------------- | ---------- | ----------------------- |
| Motorcycle      | 20 kg      | 50×40×50                |
| Sedan           | 100 kg     | 90×100×70               |
| Hatchback       | 200 kg     | 110×110×80              |
| SUV             | 300 kg     | 130×160×80              |
| Pickup Truck    | 1,100 kg   | 150×140×50 (4-door bed) |
| Box Truck       | 1,100 kg   | 170×180×170             |
| Fence Truck     | 1,100 kg   | 170×180×170             |
| Box Truck Jumbo | 2,400 kg   | 180×300×200             |

- **Construction relevance:** motorcycle/sedan unrealistic for jobsite materials;
  meaningful tiers are **Pickup, Box/Fence Truck (≤1,100 kg), Jumbo (≤2,400 kg)**.
  **Fence Truck** (open-sided flatbed) fits rebar/pipe/long stock; box trucks for
  boxed/cement goods. ⚠️ >2.4 t or >~3 m exceeds the on-demand fleet → needs a
  freight carrier (out of Lalamove scope). Always **gate `serviceType` on
  `GET /v3/cities`**, don't hard-code.

## 6. Operational concerns

- **Rate limits (per min, prod/sandbox):** Quotation 100/30, Quotation-detail
  300/50, Place-order 100/30, Get-order 300/50, Driver-detail 300/50, Cancel/Change/
  Priority-fee 100/30, Cities 300/50. `429` on breach; `RateLimit-*` headers. [2]
- **Idempotency:** No dedicated idempotency-key field. **`Request-ID`** is the
  nonce. ⚠️ Treat it as our idempotency anchor for place-order retries, but
  **verify** Lalamove actually dedupes on it — assume not, guard double-create on
  our side. [2][7]
- **Error model:** `{"errors":[{"id","message","detail"}]}`; HTTP
  `400/401/402/403/404/422/429/500`. **`402 Payment Required` = insufficient wallet
  balance** — a first-class case for dispatch. [2]
- **Billing:** **prepaid wallet / credit** — production keys require real top-up;
  orders draw down the wallet; `WALLET_BALANCE_CHANGED` tracks balance. No public
  per-order rate card (dynamic; quotation is the price source). ⚠️ Invoice/
  settlement terms not public — confirm in onboarding. [1][9][11]

## 7. Mapping to our model (design seam, not code)

### 7a. Status → `purchase_request` lifecycle (`purchased → on_route → delivered`)

A PO groups N tickets; **one Lalamove order = one dispatch** (a PO, or a per-truck
shipment within a PO). Recommend a dedicated **`delivery`/`dispatch` row** keyed to
the PO (and its tickets) carrying the Lalamove `orderId`, NOT overloading
`purchase_request` columns.

| Lalamove status                     | Our lifecycle                    | Notes                                                                        |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `ASSIGNING_DRIVER`                  | `purchased` (dispatch requested) | order placed, no driver                                                      |
| `DRIVER_ASSIGNED` / `ON_GOING`      | `on_route`                       | matched / en route to pickup                                                 |
| `PICKED_UP`                         | `on_route` (sub-state)           | optional finer state                                                         |
| `COMPLETED` (+ POD)                 | `delivered`                      | flip only on `COMPLETED`, ideally gated on POD captured                      |
| `CANCELED` / `EXPIRED` / `REJECTED` | revert / `dispatch_failed`       | un-stick the PO to re-dispatch; follow `ORDER_REPLACED` to the new `orderId` |

Tickets roll up to a PO and Lalamove status is per-order → set ticket `delivered`
**fan-out from the PO/dispatch `COMPLETED`** (if a PO is split across orders, each
order delivers its own ticket subset — store the ticket↔order linkage).

### 7b. POD as a proof attachment ← ties to operator's "proof attachments" ask

- New attachment purpose **`proof_of_delivery`**, distinct from the existing
  operator-captured `delivery_confirmation` photos (provenance differs:
  carrier-generated vs our crew).
- **Attach at PO/dispatch level** as primary anchor (POD ≈ the drop/order), and
  **fan out a reference to each ticket** so ticket detail still surfaces its proof
  (WP-/ticket-centric doctrine). Subset orders → attach to exactly those tickets.
- **Copy the POD photo/signature into Supabase Storage** on receipt — do NOT
  hot-link Lalamove's URL (assume signed/expiring). Store recipient name +
  `deliveredAt` as metadata.
- Follow the existing **append-only / supersede** discipline for the attachment rows.

### 7c. Provider-abstracted integration shape (mirror bank-disbursement, spec 128)

- **`DeliveryProvider` interface** — `quote()`, `placeOrder()`, `getOrder()`,
  `getDriver()`, `addPriorityFee()`, `cancel()`, `verifyWebhook()`,
  `parseWebhook()` — `LalamoveProvider` as first impl, so a second carrier / freight
  fallback (>2.4 t) can swap in. Market/`serviceType` resolution behind the
  interface (driven by `GET /v3/cities`).
- **Outbound outbox:** reuse `notification_outbox` / `peak_sync_outbox` pattern →
  `delivery_dispatch_outbox` (enqueue + retry + idempotent place-order/cancel/
  priority-fee; anchor on `Request-ID`).
- **Inbound webhook-inbox:** persist every webhook **raw** into
  `delivery_webhook_inbox` first (return 200 immediately, process async). Satisfies
  Lalamove's "respond 200 fast, out-of-order, retries, don't hard-code fields"
  constraints; gives replay/audit; dedupe + reorder by timestamp before projecting
  onto dispatch state.

## 8. Blockers / unknowns (resolve before building)

1. **KYC / Thai business-registration** for a production account — not documented;
   ask `partner.support@lalamove.com`.
2. **Production wallet/billing terms** — top-up minimums, invoicing/credit, `402`
   handling. Prepaid-only is the default assumption.
3. **Exact POD response schema** — verbatim field names/paths for POD photo URL,
   signature image, recipient name in `GET /v3/orders/{id}`, and **whether URLs
   expire** (drives copy-to-storage timing). Needs sandbox.
4. **Inbound webhook signature** — exact header + signed-string for verifying
   _incoming_ webhooks (vs the documented _outbound request_ signature).
5. **`Request-ID` idempotency guarantee** — does Lalamove dedupe duplicate
   place-orders by it, or must we guard entirely on our side?
6. **Stops limit** — 16 (quotation array) vs 19 (marketing); confirm v3 hard cap.
7. **`serviceType` codes for `TH`/`TH BKK`** — pull live from `GET /v3/cities`;
   confirm Fence/Box truck availability + true weight ceilings.
8. **POD/POP webhook events in v3** — confirm emitted in our market and whether they
   carry the artifact URL or only a status flag (webhook-driven vs poll-on-`COMPLETED`).

_3–8 are answerable with **sandbox credentials**; 1–2 need a **conversation with
Lalamove partner support**. None block writing the spec/ADR; they block finalizing
the concrete `LalamoveProvider` + POD schema._

## Sources

1. Lalamove TH — API Solutions: https://www.lalamove.com/en-th/business/api-solutions
2. Lalamove API v3 Reference: https://developers.lalamove.com/
3. Lalamove API Reference (index): https://developers.lalamove.com/index.html
4. Lalamove REST API request-signing examples: https://github.com/lalamove/api-examples
5. Lalamove API Solutions (PH — quotation validity, multistop): https://www.lalamove.com/en-ph/business/api-solutions
6. Lalamove FAQ — POD enablement (`isPODEnabled`): https://www.lalamove.com/en-vn/faq
7. Lalamove v2 deprecation / v3 migration: https://developers.lalamove.com/v2/index.html
8. Lalamove TH — additional vehicle types: https://www.lalamove.com/en-th/blog/not-just-motorcycle-lalamove-also-provides-hatchback-and-pickup-truck-delivery
9. Lalamove v3 Webhook Tutorial (PDF): https://developers.lalamove.com/files/v3_Webhook_v1.4.pdf
10. Lalamove TH — all-vehicle pricing/spec: https://www.lalamove.com/en-th/all-vehicle-pricing-detail
11. Lalamove Wallet / top-up: https://www.lalamove.com/en-sg/blog/how-to-use-the-lalamove-wallet

---

_Verification: auth signature string, base URLs, endpoint paths, status values,
webhook behaviour, TH vehicle weights, billing model, v2-deprecation are
well-verified (2–3 independent sources). ⚠️ items (exact POD field names,
inbound-webhook signature header, `Request-ID` dedupe, KYC) could not be pinned to
verbatim official text and are sandbox/partner-support blockers (§8)._
