# Spec 48 — Requester notes on purchase requests

**Status:** locked — 2026-06-12. Operator (WP-detail feedback item 2):
"Allow user to include some notes." The create form carries only the
structured fields (item, qty, unit, needed-by, priority); anything the
requester wants to tell the PM/procurement — brand, spec, "same as last
time", site gate instructions — has nowhere to live except abusing the
item description.

## Scope

### A. DB — `purchase_requests.notes` (write-once at creation)

- Migration: `alter table public.purchase_requests add column notes
text;` + `grant insert (notes) on public.purchase_requests to
authenticated;`.
- Posture (spec 33 / ADR 0038 column-scope doctrine): INSERT-only for
  authenticated — **no UPDATE grant**; the note is part of the request
  the PM decided on, mutating it after decision would falsify the
  record. `appsheet_writer` gets nothing (ADR 0034 column freeze).
- No DB CHECK length cap — consistent with the item_description posture
  (spec 36; DB CHECKs are one queued follow-up for all three).
- RLS untouched: the existing INSERT policy (requester-pin) and
  site-wide SELECT already cover the column.
- pgTAP file 30 (3 asserts): authenticated INSERT privilege on notes
  true; authenticated UPDATE false; appsheet_writer UPDATE false.

### B. Validation + action

`validateCreatePurchaseRequest` accepts optional `notes`: trim; blank
collapses to null; > 1000 chars → `หมายเหตุต้องไม่เกิน 1000 ตัวอักษร`
(server-side cap, spec-36 shape). `createPurchaseRequest` threads
`notes` into the INSERT.

### C. UI

- `PurchaseRequestForm`: optional textarea `หมายเหตุ (ไม่บังคับ)` after
  the urgency selector — `maxLength 1000`, 3 rows, field-border
  convention (`border-zinc-400`, ui-conventions §7), participates in
  validation/reset/userTyped exactly like the other fields.
- Detail page (`/requests/[requestId]`): notes render in the facts card
  under needed-by, `whitespace-pre-wrap`, labeled `หมายเหตุ`.
- Slim cards (spec 47) deliberately do NOT show notes.

### Out of scope

Notes editing after creation (write-once by posture), PM/back-office
note threads, notes in LINE notification payloads, list-page display,
AppSheet exposure.

## Tests

- **Failing first:** new cases in
  `tests/unit/validate-purchase-request.test.ts` — notes omitted/blank →
  null; trimmed passthrough; 1001 chars rejected with the Thai message.
- pgTAP file 30 as §A.

## Verification checklist

- [ ] Validator tests RED before the validator change, GREEN after.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] Migration dry-run shows exactly this one file, zero drift; applied
      with `pnpm db:push`; `pnpm db:types` regen reconciles the
      hand-extended types; `pnpm db:test` green (existing file-17
      negative pins unaffected — additive column).
- [ ] `pnpm build` passes.
- [ ] No diff under `worker/`; no enum/route/RLS-policy change.
