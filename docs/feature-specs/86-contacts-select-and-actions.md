# Spec 86 — Contacts v2 Unit 4: `select` field primitive + write-action layer

Contacts v2, Unit 4. Code-only (no DB change). Builds the write layer the detail page (U5) and list UI (U6) consume.

## `RecordFieldDef` gains `type: "select"`

`record-manager.tsx`: the field-schema type union adds `"select"` + an optional `options: { value; label }[]`; `maxLength` becomes optional (select ignores it). `FieldInputs` renders a native `<select>` (styled `FIELD_STACKED appearance-none`, the worker-roster precedent). `blankValues` defaults a select to its **first option** (a valid enum value, never `""`). Existing text/tel/email/textarea branches byte-unchanged. Failing test first: a select-typed field renders a `<select>` and reports its value through `onCreate`.

## Action layer — `contacts/actions.ts`

Extend the existing PM-gated, direct-write actions (no new RPC; the `/contacts` page is PM-gated and PM/super hold the UPDATE policy + column grants — spec 81/83 pattern):

- **contractors** create/update: + `contractorCategory`, `contractorSubtype`, `status` (validated against the enums via `checkEnum` over `Constants.public.Enums`; invalid → generic error; DB CHECK is the backstop) + enrich `contactPerson`/`email`/`mailingAddress`/`taxId`/`specialty`. Update: only-provided-keys; `contractorSubtype === ""` clears to null.
- **suppliers** create/update: + `contactPerson`/`email`/`mailingAddress`/`taxId`/`paymentTerms`.
- **service_providers** create/update (new): name + `serviceSubtype`/`status` (enum-checked) + phone/contact/email/address/vehicleType/plateNo/note.
- **clients**: unchanged (already rich; no subtype/status).

`norm()` trims, blank → null. Enum writes spread-omit when undefined (exactOptionalPropertyTypes). `status` rides the existing contractors UPDATE grant for v1 (audited-RPC seam, spec 83). Bank is NOT here — it's the `contact_bank` RPC (U3), wired in U5.

## Tests / verification

`record-manager.test.tsx` +1 (select). The action extensions are exercised by U5/U6 UI + manual (the established untested-RPC/relay-action precedent). `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green. No migration.
