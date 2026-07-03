# Spec 258 — Subcontract crew register (ลูกทีมผู้รับเหมาช่วง)

**Status:** DRAFT (operator-aligned design 2026-07-03; follow-up to spec 251)
**Origin:** Operator — "We also need their team members' ID card under each contract"
(alongside the WP-owner ID card + bank info, which already exist: `contact_attachments`
purposes `id_card`/`bank_book` + the isolated `contact_bank`, both keyed by
`contractor_id`).

**Depends on spec 251** (`subcontracts` table) — approved but **not built**; 251 U1
must land first. This spec's build queues behind it.

## Why this is a NEW entity (not `workers`, not `contact_attachments`)

A subcontractor firm's crew members are a third category of person, deliberately
distinct from both existing worker-shaped entities:

| Entity | Paid by PRC? | Daily-logged? | Table |
| --- | --- | --- | --- |
| DC (direct labor) | yes (`day_rate` / `dc_payments`) | yes | `workers`, ADR 0062 |
| Subcontractor firm | yes, lump-sum (`subcontract_payments`) | no | `contractors` |
| **Subcon crew member** | **NO — the firm pays them** (จ่ายลูกทีมเอง) | no | **this spec** |

- **Not `workers`:** no day_rate, no payroll, no Nova, no labor logs. Forcing crew
  into `workers` would recreate the two-entities-for-one-person confusion ADR 0062
  just eliminated for DC.
- **Not `contact_attachments`:** that table's load-bearing invariant is
  "site_admin can never see it" (spec 97 — it holds the FIRM's PII/bank docs, a
  PM-administrative concern). Crew ID cards have the OPPOSITE access pattern:
  site_admin is exactly who needs them (gate check — who is allowed on site).
  Different reader set → different table with its own RLS.

## Goals

1. Under each subcontract deal, register the crew members the firm brings on site:
   name, ID number, nationality, work permit (non-Thai), phone.
2. Hold their document scans (ID card, work permit) — append-only, latest wins.
3. Let the field (site_admin) verify a person at the gate: read the register +
   docs for contracts on their site. Surface work-permit expiry as a danger badge.

## Data model (schema lane; migration after spec 251 U1's `20260813064000`)

### `subcontract_crew_members`

- `id` uuid PK default gen_random_uuid()
- `subcontract_id` uuid NOT NULL → `subcontracts` (per-contract scope — see
  Decisions)
- `name` text NOT NULL — CHECK nonblank, ≤120
- `national_id_number` text NULL — CHECK ≤50 (เลขบัตรประชาชน; the number, distinct
  from the scan)
- `nationality` text NULL — CHECK ≤80
- `work_permit_number` text NULL — CHECK ≤50 (ใบอนุญาตทำงาน, non-Thai crew)
- `work_permit_expiry` date NULL — unlike an ID card, this EXPIRES; a lapsed
  permit on site is GC liability
- `phone` text NULL — CHECK ≤50
- `active` boolean NOT NULL default true — left the crew = false; **no DELETE
  ever** (masters posture)
- `created_by` uuid NOT NULL → users, `created_at` timestamptz default now()

Index: `(subcontract_id, active, name)`.

### `subcontract_crew_attachments` (mirrors `contact_attachments` mechanics)

- `id` uuid PK, `crew_member_id` uuid NOT NULL → `subcontract_crew_members`
- `purpose` — new enum `crew_doc_purpose` (`id_card`, `work_permit`)
- `storage_path` text NOT NULL — CHECK nonblank ≤400
- `uploaded_by` uuid NOT NULL → users, `created_at` timestamptz default now()
- **Append-only:** block trigger on UPDATE/DELETE/TRUNCATE (P0001, house
  doctrine); latest row per purpose wins on display
- Index: `(crew_member_id, purpose, created_at desc)`
- Private storage bucket path-bound policy (same shape as the contact-docs
  bucket migration)

### RLS — deliberate, documented deviation from the contact-PII pattern

- **SELECT (both tables): site_admin + PM_ROLES.** This is the point of the
  feature — the field checks people at the gate. Every OTHER contact-PII table
  excludes site_admin; this one admits them BY DESIGN. The pgTAP suite must pin
  site_admin-CAN-read here (inverse of the spec-97 pin) so a future RLS sweep
  doesn't "fix" it.
- Site-scoping: site_admin read limited to crews of subcontracts on projects the
  SA can see (`can_see_project(subcontracts.project_id)` via join — same axis as
  other project-scoped reads).
- **Writes: PM_ROLES only, via SECURITY DEFINER RPCs** (null-safe fail-closed
  gates, house pattern): `add_crew_member`, `update_crew_member` (name / permit
  fields / phone / active — coalesce semantics), `add_crew_document`. No user
  UPDATE/DELETE on attachments (append-only trigger holds regardless).
- **No money on crew rows** — the firm's bank stays in `contact_bank`; crew are
  never payees. `client` role: no access (crew PII is not client-visible).

## Behaviour / UI (single surface, v1)

- **Crew block on the subcontract deal** (inside the spec-253 drill's deal
  drawer if layout allows; else its own section on the deal detail): active crew
  list (name · nationality · permit chip) + add form + per-member doc upload +
  document viewer (signed URL, service-role mint — ADR 0015 exposure model).
- **Expiry badge:** work permit expired → danger chip; expiring ≤30 days → warn
  chip. Pure date helper, TDD. Badge only — NO notification machinery in v1.
- **Field read surface:** site_admin reaches the same crew list read-only from
  the project's subcontract context (exact placement decided in U2 — smallest
  door that answers "is this person on a crew here?").

## Decisions (operator-approved 2026-07-03)

1. **Per-contract register, not a durable person entity.** Same person on the
   firm's next contract = re-entered. Simple, matches the ask; upgrade path to a
   firm-level roster + junction later without breaking this shape.
2. **Nationality + work permit included** (columns + doc purpose + badge);
   expiry NOTIFICATIONS excluded.
3. **site_admin: read yes, write no.**

## Units

| Unit | Lane   | Content                                                                      |
| ---- | ------ | ---------------------------------------------------------------------------- |
| U1   | SCHEMA | 2 tables + `crew_doc_purpose` enum + append-only trigger + RLS + 3 RPCs + storage policy + pgTAP + db:types |
| U2   | code   | crew block UI (list/add/upload/viewer) + expiry-badge helper + SA read surface + tests |

Out of scope: safety-induction records; daily crew check-in/attendance; crew
photos beyond the ID scans; per-person blacklist; permit-expiry LINE
notifications; portal upload by the subcontractor firm; linking crew to labor
logs or any money.

## Verification checklist

- [ ] pgTAP: append-only guard on attachments; RLS — site_admin CAN read (pinned
      both tables, project-scoped), PM_ROLES read/write via RPCs, client +
      unbound roles denied; RPC gates null-safe; no-delete posture.
- [ ] Unit: expiry-badge helper (expired / ≤30d / ok / null permit); latest-per-
      purpose doc resolution.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` + full `pnpm db:test` green.
- [ ] Real-browser: PM adds crew + uploads doc; site_admin sees register on own
      project, cannot write; client role sees nothing.
