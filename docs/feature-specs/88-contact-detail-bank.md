# Spec 88 — Contacts v2 Unit 5: contact detail page + bank block

Contacts v2. The per-contact detail page — the home for the deep info (bank now; documents U7, crew U8). Field editing stays inline on the list (spec 87); the detail page is read-only display + the money-isolated bank editor.

## Route `/contacts/[type]/[id]`

PM/super only. `type ∈ clients | suppliers | contractors | service-providers` (DC contractors use the `contractors` route). Server component: fetch the record (user session) by id → `notFound()` if missing; render `DetailHeader` (back → `/contacts`) + a read-only field list (Thai labels; status/subtype mapped to Thai) + the bank block. List rows link here via the new `RecordManager` `rowHref`.

## Bank — admin read + RPC write

- `src/lib/contacts/bank.ts` `getContactBank(admin, kind, id)` — service-role admin read of `contact_bank` (zero authenticated access, spec 85), called ONLY from this requireRole(PM_ROLES) page.
- `setContactBank` action (contacts/actions.ts) — PM-gated, calls `set_contact_bank` RPC on the **user session** (the RPC needs `auth.uid()`/`current_user_role()`).
- `ContactBankBlock` (client) — bank name / account no / account name, save via `setContactBank`, toast + refresh. Labeled "เฉพาะผู้จัดการเห็นข้อมูลนี้". clients have no bank block.

## RecordManager — `rowHref`

Additive prop: when set, a row's name links to its detail page. contacts-tabs passes the per-type href. Inline edit retained.

## Tests / verification

`contact-bank-block.test.tsx` (RED first): shows initial values; save calls `setContactBank` with `{kind,id,bankName}`. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green. No DB change (contact_bank + RPC shipped U3). Acceptance = operator phone (PM-gated). Documents/crew sections attach here in U7/U8.
