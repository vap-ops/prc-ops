# Spec 97 — Contacts v2 Unit 7: contact documents (ID card + bank book)

The last open unit of the operator-approved Contacts v2 program (see memory
`prc-ops-contacts-redesign-plan`; Units 1–6, 8, 9 shipped as specs 83–90). Operator
(2026-06-15) picked it for this session.

## Goal

Attach an **ID-card photo** and a **bank-book photo** to a paid contact
(contractor / supplier / service provider) and view them on the contact detail
page. ID card = PII, bank book = bank-adjacent → **PM/super only**, the same
money-isolation posture as `contact_bank` (spec 85). Clients are excluded (we don't
hold these for clients — mirrors the bank table's 3 FKs).

## Decision (mirrors contact_bank + pr-attachments)

- **Table `contact_attachments`** — `id`, three typed nullable FKs
  (`contractor_id` / `supplier_id` / `service_provider_id`) + exactly-one-target
  CHECK (like `contact_bank`, NOT polymorphic), `purpose contact_doc_purpose`,
  `storage_path text` (non-blank), `uploaded_by → users`, `created_at`.
  **APPEND-ONLY** (latest-per-purpose wins on display): no UPDATE/DELETE
  grants/policies + a BEFORE UPDATE/DELETE/TRUNCATE block trigger (P0001), the
  `purchase_request_attachments` doctrine. **Zero authenticated access** (RLS on,
  revoke all, NO grants/policies) — written only by the RPC, read only by the
  admin client, exactly like `contact_bank`.
- **Enum `contact_doc_purpose`** = `('id_card', 'bank_book')`.
- **RPC `add_contact_document(p_contractor_id, p_supplier_id, p_service_provider_id,
p_purpose, p_storage_path)`** — SECURITY DEFINER, PM/super gate (42501 else),
  exactly-one-target + purpose + path required (P0001 else), inserts with
  `uploaded_by = auth.uid()`. Called on the **user session** (so
  `current_user_role()`/`auth.uid()` resolve — the spec-68/85 lesson), never the
  admin client. `revoke all from public, anon; grant execute to authenticated`.
- **Private storage bucket `contact-docs`** (image mimes, 25 MiB) + a path-bound
  INSERT policy on `storage.objects`: PM/super, `bucket_id='contact-docs'`,
  2-segment path `{kind}/{contactId}/…`, `objects.name`-qualified (name-capture
  hazard). No SELECT/UPDATE/DELETE policies — reads via service-role signed URLs;
  orphans accepted (the table is source of truth — pr-attachments doctrine).
- **Path** `{kind}/{contactId}/{attachmentId}.{ext}` — built by a pure helper used
  by BOTH the client (upload target) and the server action (the path stored in the
  row is **rebuilt server-side**, so a forged path can't be persisted; invoice
  precedent).

## App layer

- `buckets.ts` — add `CONTACT_DOCS_BUCKET = "contact-docs"`.
- `lib/contacts/document-path.ts` (pure) — `buildContactDocPath(kind, id, attId, ext)`.
- `lib/contacts/documents.ts` (server-only) — `getContactDocuments(admin, kind, id)`
  → latest `id_card` + `bank_book` rows, mint signed URLs (admin), return
  `{ idCard, bankBook }` signed URLs (or null).
- `contacts/actions.ts` — `addContactDocument({ kind, id, purpose, attachmentId, ext })`:
  `pmSession` gate, validate uuid/ext/purpose, rebuild path, `rpc("add_contact_document")`
  on the user session, revalidate the contact detail path.
- `ContactDocumentsBlock` (client) — two rows (บัตรประชาชน / สมุดบัญชีธนาคาร), each
  shows the current image (signed URL) if present + an uploader button reusing the
  invoice-uploader flow (`preparePhotoForUpload` → browser `storage.upload` to
  `contact-docs` → `addContactDocument` → refresh). "เฉพาะผู้จัดการเห็นเอกสารนี้".
- Detail page — render `<ContactDocumentsBlock>` for `kind != null` (the 3 paid
  types), fed by `getContactDocuments`.

## Tests

- `document-path` pure test (path shape; rejects bad ext) — TDD.
- `contact-documents-block` component test — renders both purposes, shows a current
  image when a URL is passed, the uploader calls the (mocked) action.
- pgTAP (new file): table + RLS on + **zero** authenticated select/insert priv,
  exactly-one CHECK (0 and 2 targets fail), append-only update→P0001, RPC PM/super
  (SA/visitor 42501), bucket row exists.

## Gate (NOT auto-merge — schema + storage)

Build local-green with a **hand-extended `database.types.ts`**; then **AskUserQuestion
go/no-go before `db:push`** (change-management §1). On approval: `db:push` (both
migrations) → `db:types` regen → prettier → reconcile byte-exact → `db:test` →
commit the **migrations first**, then the code → push to main.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green (hand-typed).
- [ ] After push: `db:test` green incl. the new pgTAP file.
- [ ] Acceptance = operator iPhone: open a contractor/supplier/service-provider →
      upload an ID card + bank book → they display; SA sees nothing (PM-gated page).

## Out of scope

- Clients (no documents, mirrors bank). Multiple docs per purpose / history view
  (latest wins). Document deletion (append-only). PDF documents (images only v1).
