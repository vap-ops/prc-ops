# Spec 81 — Contacts management (clients · suppliers · contractors)

> **Amendment (2026-06-14, operator feedback):** renamed "master data" → **Contacts**.
> Route is `/pm/contacts` (not `/pm/masters`); nav label **รายชื่อติดต่อ**, page title
> **รายชื่อผู้ติดต่อ**; the generic component is `RecordManager`
> (`record-manager.tsx`) and the shell is `ContactsTabs` (`contacts-tabs.tsx`). The
> three tables (clients/suppliers/contractors) are the contact types. Everything below
> that says "masters"/`MasterManager`/`/pm/masters`/ข้อมูลหลัก reads with these new
> names — the design is unchanged, only the naming.

**Iteration unit.** Operator picked this from a "what next" menu: build the management
**screens** for the three "master" reference tables — `clients`, `suppliers`,
`contractors` — and in doing so **unblock the deferred `suppliers.note` /
`contractors.note`** (the notes-everywhere program, specs 72–75, stopped at these two
because "no edit screen exists yet"). This spec builds that screen and finishes notes
for the masters in the same unit.

## Problem

All three master tables are created **inline, in the middle of another flow**, and can
never be edited afterward:

| Table         | Created where (today)                                  | Editable?  | Note col? |
| ------------- | ------------------------------------------------------ | ---------- | --------- |
| `clients`     | inline "เพิ่มลูกค้าใหม่" in project **settings** form  | ❌ no edit | ❌ none   |
| `suppliers`   | inline "add supplier" in the **purchase-record** form  | ❌ no edit | ❌ none   |
| `contractors` | inline "add contractor" in the **WP assignment** panel | ❌ no edit | ❌ none   |

A typo in a client/supplier/contractor name (the snapshot that prints on reports and
purchase records) is **permanent**. There is no curation surface. And the notes-everywhere
program could not reach suppliers/contractors because they had no screen to host a note.

## Decision

One PM-gated route, **`/pm/masters`**, with a segmented control over the three masters.
This mirrors the `/workers` roster precedent (spec 46): a `requireRole(PM_ROLES)` page that
lists records and offers add + per-row edit, minus the money machinery (no master here has
a rate/cost column, so reads use the ordinary user-session server client — no admin client).

```
/pm/masters
 ┌─────────────────────────────────────────┐
 │  [ ลูกค้า ] [ ผู้ขาย ] [ ผู้รับเหมา ]      │  ← RadioChip segmented control
 ├─────────────────────────────────────────┤
 │  เพิ่มลูกค้า  (add form: the entity's fields + หมายเหตุ)  │
 │  ─────────────────────────────────────   │
 │  • บริษัท ก.    แก้ไข                       │  ← per-row display + edit expander
 │  • บริษัท ข.    แก้ไข                       │
 └─────────────────────────────────────────┘
```

### Why one route + segmented control (not three routes)

- The PM hub nav already carries four items; three more would crowd it. One entry
  (**ข้อมูลหลัก**) keeps nav lean.
- The three managers are near-identical (a record list with add/edit). They share one
  generic component; one route is the natural host.
- WP-centric principle is unaffected — these are reference masters, not work surfaces.

### Roles / access

- **Page gate:** `requireRole(PM_ROLES)` (`project_manager`, `super_admin`) — same as
  `/workers`. SA keeps its existing inline contractor quick-add (unchanged); SA does **not**
  get the management page in v1 (recorded seam). Procurement (a supplier writer at the data
  layer) does **not** get the page in v1 either (recorded seam — procurement depth).
- **Writes** ride each table's existing RLS UPDATE/INSERT policy directly under the
  authenticated PM session — **no new SECURITY DEFINER RPC**. PM/super already hold the
  policy + column grants on all three (`clients` pm/super; `contractors` sa/pm/super ⊇
  pm/super; `suppliers` pm/procurement/super ⊇ pm/super). This is the spec-80 precedent
  (project_members written directly under the session). The actions add an explicit
  `PM_ROLES` check before the write (defense-in-depth + a real error message — an RLS
  UPDATE whose USING fails affects 0 rows **silently**, spec-80 lesson).

### Money

None. No master table has a money column. All reads = user-session server client; SELECT
is granted to pm/super on all three. (Contrast `/workers`, which needs the admin client
for `day_rate`.)

## Data model — `note` column on all three masters

Migration `supabase/migrations/20260627000000_masters_notes.sql`:

For **each** of `clients`, `suppliers`, `contractors`:

```sql
alter table public.<t> add column note text;
alter table public.<t>
  add constraint <t>_note_len check (note is null or length(note) <= 2000);
grant insert (note) on public.<t> to authenticated;
grant update (note) on public.<t> to authenticated;
comment on column public.<t>.note is
  'Operator backup-capture note (notes-everywhere, spec 81). Mutable, presence data — granted to authenticated SELECT via the table grant; not money.';
```

- App cap **1000** (`validateNotes` default); DB CHECK **2000** (abuse backstop) — the
  doctrine from specs 71–75.
- `note` is readable through the existing **table-level** `grant select` — no per-column
  SELECT change needed.
- **No RLS policy is dropped or created.** The eval-once doctrine (pgTAP file 40) only
  trips on `CREATE/ALTER POLICY` with a bare `current_user_role()`/`auth.uid()`; this
  migration touches columns + grants only, so file 40 stays green. (This is the reason a
  note column does not need an RPC: the column rides the existing UPDATE policy.)

## App surface

### Server actions — `src/app/pm/masters/actions.ts` (new, `"use server"`)

Six actions, all gated `PM_ROLES` then a direct table write under the session, then
`revalidatePath("/pm/masters")`. Names are `*Record` to avoid colliding with the Supabase
`createClient` factory.

- `createClientRecord({ name, contactPerson, phone, email, mailingAddress, note })`
- `updateClientRecord({ id, name?, contactPerson?, phone?, email?, mailingAddress?, note? })`
- `createSupplierRecord({ name, phone, note })`
- `updateSupplierRecord({ id, name?, phone?, note? })`
- `createContractorRecord({ name, phone, note })`
- `updateContractorRecord({ id, name?, phone?, note? })`

Rules:

- `name` required, trimmed, 1–200 (clients 120 to match the existing `CLIENT_NAME_MAX`);
  blank → Thai error.
- text fields (`contactPerson` 120, `phone` 50, `email` 200, `mailingAddress` 500): trim,
  empty → `null`.
- `note`: `validateNotes` (shared, cap 1000) → trimmed value or `null`.
- **update**: only keys that are `!== undefined` are written; passing `""` clears a text
  field / note to `null` (the worker-update precedent), omitting preserves it.
- The existing inline quick-adds (`createClient` in settings, `createSupplier` in requests,
  `createContractor` in assignment) are **untouched** — they stay note-less and return the
  new id for immediate selection in their host flow. _(Recorded simplify-seam: a shared
  insert core could unify the masters-page create with the inline quick-add; deferred —
  they differ in return shape, revalidate target, and note support.)_

### Components

- `src/components/features/master-manager.tsx` (new, `'use client'`) — **generic,
  presentational**. Props:
  - `addLabel: string`
  - `fields: MasterFieldDef[]` where `MasterFieldDef = { key; label; type: "text" | "tel" | "email" | "textarea"; maxLength }`
  - `rows: { id: string; values: Record<string, string | null> }[]`
  - `onCreate: (values: Record<string, string>) => Promise<MasterActionResult>`
  - `onUpdate: (id: string, values: Record<string, string>) => Promise<MasterActionResult>`

  Renders an add card (blank fields) and a list; each row shows its `name` value + a
  non-name field preview + an **แก้ไข** expander with the full field set. Save calls
  `onCreate`/`onUpdate` with a record keyed by `field.key` (only changed keys on update).
  Reuses `CARD`, `FIELD_STACKED`, `BUTTON_PRIMARY_COMPACT`, `BUTTON_SECONDARY_COMPACT`,
  `INLINE_ALERT_TEXT` from `@/lib/ui/classes`; `active:` press tints per spec 77; toast on
  success via `useToast` (spec 76); `router.refresh()` after a successful write.

- `src/components/features/masters-tabs.tsx` (new, `'use client'`) — the segmented-control
  shell. Holds the active tab (`RadioChip` group, labels ลูกค้า / ผู้ขาย / ผู้รับเหมา),
  imports the six server actions, and renders one `<MasterManager>` for the active entity
  with that entity's field schema + handler functions that map the generic `values` record
  to the typed action input. Receives `clients`, `suppliers`, `contractors` arrays as props.

### Page — `src/app/pm/masters/page.tsx` (new, server)

`requireRole(PM_ROLES)`; fetch all three lists with the **user-session** server client
(`order by name`); render `PageShell` + `BottomTabBar` + `AppHeader`
(kicker "ข้อมูลหลัก", title "ลูกค้า ผู้ขาย ผู้รับเหมา") + `<MastersTabs … />`, inside the
canonical `PAGE_MAX_W` wrapper. Add `src/app/pm/masters/loading.tsx` (PageSkeleton, mirrors
`/pm`). `export const metadata = { title: "ข้อมูลหลัก" }`.

### Navigation

- `PM_HUB_NAV` (`src/components/features/hub-nav.tsx`) += `{ label: "ข้อมูลหลัก", href: "/pm/masters" }` (now 5 items, desktop strip; same phone-bottom-tab seam as `/workers` and `/pm/payroll`).
- `docs/site-map.md`: add `/pm/masters` (the nav-change contract — must update same unit).

## Tests

**Unit (`pnpm test`) — write the failing test first.**

- `tests/unit/master-manager.test.tsx` (new):
  1. renders each row's `name` value.
  2. add form: filling the fields + submit → `onCreate` called with the field values.
  3. edit: expand a row, change a field, save → `onUpdate` called with `(id, { changedKey })`.
  4. a `textarea` is rendered for a `type: "textarea"` field (the note).
  5. on `onCreate` failure the returned error renders.

**pgTAP (`pnpm db:test`) — additive, exact plan-count bump.**

- `24-contractors.test.sql`, `26-suppliers-purchase-rpcs.test.sql`,
  `42-clients-and-project-meta.test.sql`: each +`note` column exists / `text` / nullable, +`note > 2000` rejected by the CHECK, +`has_column_privilege(authenticated, note,
INSERT)` and `UPDATE` = true, +a PM update of `note` lands. Bump each file's `plan(N)`
  by exactly the asserts added (the recurring plan-count lesson).

**Regen:** `pnpm db:types` after the migration; reconcile byte-exact.

## Verification checklist

- `pnpm lint && pnpm typecheck && pnpm test` green.
- `pnpm db:test` green (after the migration is applied).
- Build green.
- Manual (operator acceptance): as PM open `/pm/masters` → see the three tabs; add a
  client with a note, edit it, reload → persists; rename a supplier; rename a contractor;
  add a contractor note. Confirm SA cannot reach `/pm/masters`.

## Out of scope (recorded seams)

- **SA / procurement access** to the management page (SA contractors, procurement
  suppliers) — role-widening is its own unit.
- **Delete / merge / dedup** of masters — ADR 0033/0038 keep masters un-deletable
  (referenced rows stay referencable); curation = service-role for now.
- **Unifying** the masters-page create with the three inline quick-adds (shared insert
  core).
- Per-record usage view ("which projects/WPs/PRs reference this master").
- Client `budget`/analytics surfaces (spec 79 seam, separate).

## Operator gate

Schema change → build everything local-green first, then **AskUserQuestion go/no-go before
`db:push`**. Migration is applied **before** the code is pushed (the code references the new
`note` columns; it must not deploy ahead of the schema). Then commit + push to `main`.
