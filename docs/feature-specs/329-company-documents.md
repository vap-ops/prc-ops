# Spec 329 — Company documents library (เอกสารบริษัท)

- **Status:** DESIGN APPROVED (operator, in-chat 2026-07-19) — build pending spec review
- **Date:** 2026-07-19
- **Depends on:** none (new domain; storage + supersede patterns already in-app)
- **Related:** spec 284 (Legal — contracts/document_approvals; deliberately NOT reused here),
  ADR 0004/0009 (supersede pattern), spec 46 (zero-grant read posture reference)

## 0. Problem + users

The company's own papers — หนังสือรับรองบริษัท, ภ.พ.20 (VAT registration), company
profile, bank confirmation letters, etc. — live nowhere in the app. Accounting
admins need them constantly: sent to suppliers for credit applications, to banks,
to clients for billing/tender paperwork. Today they hunt through chat threads and
personal drives.

**Users:** accounting (+ super_admin) maintain the library; the wider back office
reads it.

Operator-approved capabilities (all v1): upload + update versions · download to
send out · expiry/renewal tracking · version history · share by time-limited link.

## 1. Access model

- **Manage (upload, new version, retire):** existing `ACCOUNTING_ROLES`
  (`accounting`, `super_admin`) — SSOT `src/lib/auth/role-home.ts`.
- **Read (view, download, share-link):** NEW `COMPANY_DOC_VIEW_ROLES` =
  `[...BACK_OFFICE_ROLES, "accounting", "legal"]` (project_manager, super_admin,
  procurement, procurement_manager, project_director, accounting, legal). New
  constant per role doctrine — new meaning gets its own set, even where
  membership overlaps.

## 2. Data model — ONE append-only table

`company_documents` — canonical supersede pattern (ADR 0004 write / ADR 0009 read;
same as `photo_logs`). Each row = one **version** of one document. A logical edit
or re-issued cert = INSERT a new row with `superseded_by` pointing at the row it
replaces. No UPDATE/DELETE ever (freeze trigger, P0001).

| column          | type        | notes                                                                                                                                                                     |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | uuid PK     | `gen_random_uuid()`                                                                                                                                                       |
| `title`         | text        | not null, nonblank, ≤200 (Thai)                                                                                                                                           |
| `note`          | text null   | free remark                                                                                                                                                               |
| `storage_path`  | text        | not null — object key in `company-docs` bucket                                                                                                                            |
| `issued_at`     | date null   | document issue date                                                                                                                                                       |
| `expires_at`    | date null   | validity end (หนังสือรับรอง practical ~6 months)                                                                                                                          |
| `retired`       | boolean     | not null default false — tombstone version: supersede with `retired=true` removes the document from the current list (wrong-doc-entirely case) while history stays intact |
| `superseded_by` | uuid null   | FK → `company_documents(id)` — the row THIS row replaces (new points at old, per CLAUDE.md)                                                                               |
| `created_by`    | uuid        | FK → `users(id)`                                                                                                                                                          |
| `created_at`    | timestamptz | default now()                                                                                                                                                             |

Invariants:

- **Single-child chain:** partial unique index on `superseded_by` (where not
  null) — a version can be replaced by exactly one newer version.
- **Current set** = anti-join (`WHERE NOT EXISTS (newer.superseded_by = d.id)`)
  AND `retired = false`.
- **Version history** of a doc = walk the `superseded_by` chain from the head.

RLS (fail-closed per `rls-self-check-coalesce` lesson — role checks via the
existing definer role-helper, `is distinct from` / coalesce-to-false form):

- SELECT → `COMPANY_DOC_VIEW_ROLES`.
- INSERT → `ACCOUNTING_ROLES` (with-check: `created_by = auth.uid()`).
- No UPDATE/DELETE policies + freeze trigger (UPDATE/DELETE per-row, TRUNCATE
  per-statement → P0001).

**Conscious deviation from the `contact_attachments` template** (zero-grant +
DEFINER RPC + admin-client reads): that ceremony exists for PII-bearing contact
files. Company documents carry no PII and have a wide read set, so plain RLS
policies + user-context server client suffice — less machinery, and pgTAP can
assert the policies directly. If review disagrees, the RPC form is a mechanical
swap in U1.

## 3. Storage

- New **private** bucket `company-docs` (constant added to
  `src/lib/storage/buckets.ts`).
- Object path: `<document_row_id>/<sanitized original filename>` — row id minted
  server-side before upload so path and row bind.
- `storage.objects` policies mirror the table: INSERT (upload) gated
  `ACCOUNTING_ROLES`; download runs through the existing signed-URL helper
  pattern (`src/lib/storage/signed-urls.ts`) behind the page's role gate.
- ⚠ pgTAP must assert the `storage.objects` policies directly — parity sweeps
  that scan only `public` miss storage policies (lesson
  `delivery-photo-storage-rls-fix-2026-07`, #456).

## 4. Surfaces

- **`/settings/company-docs`** — Server Component, `requireRole(COMPANY_DOC_VIEW_ROLES)`.
  Twin of `/settings/org-chart` placement-wise. Sections:
  - Current documents list: title · issued/expiry dates · expiry badge
    (**หมดอายุ** red when past; **ใกล้หมดอายุ** amber when ≤30 days out) ·
    ดาวน์โหลด (signed URL) · แชร์ลิงก์ · ประวัติเวอร์ชัน (collapsed accordion
    listing superseded rows, each downloadable).
  - Manage controls (rendered ONLY for `ACCOUNTING_ROLES`): อัปโหลดเอกสาร (new
    doc) · อัปเดตเวอร์ชัน per row · retire per row (tombstone, confirm dialog).
  - Forms are bottom sheets (ui-conventions §7): file + title + note +
    issued_at + expires_at; new-version sheet prefills title/note from the row
    it replaces.
- **Settings hub entry** in `sections.ts`, visible to `COMPANY_DOC_VIEW_ROLES`.
- **`/accounting` home card** — door to `/settings/company-docs` (accounting are
  the primary users; their home advertises it).
- Labels: new block in `src/lib/i18n/labels.ts` (UI-term SSOT).

## 5. Share by link

แชร์ลิงก์ per document version → server action (gated
`COMPANY_DOC_VIEW_ROLES`) mints a signed URL, **TTL 7 days**, returned to a
copy-to-clipboard control. Anyone holding the link can download for the TTL —
that is the feature (send to bank/supplier without downloading first). No share
audit table v1.

## 6. Expiry tracking

v1 is **visual only**: badges computed from `expires_at` at render (no cron, no
notification). A renewal-reminder automation (outbox notification when a doc
crosses the 30-day window) is a deliberate follow-up unit — if built, it must be
documented in `docs/automations.md` per the automation doctrine.

## 7. Non-goals (v1)

- No category taxonomy (doc count ~10–30; title is enough).
- No approval workflow (`document_approvals` stays contract-scoped, spec 284).
- No per-document ACL beyond the two role sets.
- No expiry notifications (see §6).
- No public/anonymous listing; share = per-version signed URL only.
- No physical DELETE — wrong uploads are superseded or tombstone-retired;
  true removal is operator break-glass.

## 8. Units

- **U1 — schema + storage (additive migration, schema lane; pgTAP RED-first).**
  Table + freeze trigger + partial unique index + RLS + bucket + storage
  policies + `db:types`. Danger-path (migration) → held; additive → standing
  self-merge grant applies on green.
- **U2 — role set + UI (code, browser-verified).** `COMPANY_DOC_VIEW_ROLES`
  (touches `src/lib/auth/role-home.ts` → danger-path guard HOLDS the PR by
  design; operator one-tap) + page + sheets + server actions (upload / new
  version / retire / share) + settings entry + /accounting card + labels +
  guard updates (settings-sections pin, nav-back classify, feature-components
  structure if new `src/components/features/company-docs/`).

Expected guard trips (pre-empt per `prc-ops-guard-trip-map`): new settings
section pin · new page.tsx nav-back classify · new component folder · role-set
exhaustiveness fixtures.

Verification floor: pgTAP (RLS both directions, append-only freeze, unique
child, storage policies) · vitest RED-first for page/components/actions ·
real-browser as dev-preview super_admin (upload → list → new version → history
→ share link → download) · view-as `procurement` sees list WITHOUT manage
controls (SSR probe) · view-as role outside `COMPANY_DOC_VIEW_ROLES` (e.g.
`technician`) is refused.

## 9. Open questions

None blocking. Defaults chosen and changeable cheaply: expiry warning window
30 days · share TTL 7 days.
