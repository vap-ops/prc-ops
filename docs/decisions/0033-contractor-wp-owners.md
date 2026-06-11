# ADR 0033 — Contractor entities as WP owners (supersedes ADR 0032's user-owner UI)

**Status:** Accepted — 2026-06-11. Spec 31. Operator decision in chat
("Replace"): มอบหมายงาน assigns OUTSIDER crews, not internal staff.

## Context

ADR 0032 modeled WP ownership as internal `users` references. The
operator's field reality: work packages are executed by subcontractor
crews — outsiders, or internal crews treated as outsiders — who have no
login and never will. Assigning login-users was the wrong entity.

## Decision

- New master table `public.contractors`:
  `id uuid PK`, `name text NOT NULL` (non-blank CHECK), `phone text
NULL`, `created_by uuid → users`, `created_at`. Plain mutable master
  data (members-table precedent, ADR 0032): PM/super INSERT and UPDATE
  (name/phone corrections); **no DELETE policy** — a contractor that
  worked a WP stays referencable; pruning is a service-role concern.
- `work_packages.contractor_id uuid NULL → contractors` — THE owner of
  the WP. Written through the existing PM/super WP UPDATE policy.
- RLS on contractors: staff SELECT (sa/pm/super); PM/super
  INSERT (`created_by = auth.uid()` pinned) and UPDATE.
- **ADR 0032's user-owner/team UI is REMOVED** (panel, chips, staff
  picker). The `work_packages.owner_id` column and
  `work_package_members` table stay in place, dormant — dropping them
  same-day buys nothing and costs a migration; recorded as cleanup
  candidates if still unused at v2.
- appsheet_writer: no grants (unchanged posture).
- Not built (recorded seams): contractor detail page, per-contractor WP
  list, contractor merge/dedup tooling.

## Consequences

- มอบหมายงาน panel becomes: contractor `<select>` + inline
  เพิ่มผู้รับเหมาใหม่ (name + phone) + clear option.
- Header shows ผู้รับเหมา {name · phone} — readable by all staff.
- pgTAP file 24; file 23 keeps guarding the dormant tables (cheap,
  still correct).
