# ADR 0004: Audit Trail and Data Immutability

Date: 2026-05-03  
Status: Accepted

## Context

Regulatory and operational requirements demand a reliable audit trail for all significant actions. Data integrity must be provable and immutable.

## Decision

### Audit Log

- An `audit_log` table records every status change, photo upload, approval action, and import event.
- The table is **append-only**: `UPDATE` and `DELETE` on `audit_log` are prohibited at the application layer and enforced via RLS policy (no UPDATE/DELETE privilege granted to the application role).

### Supersede Pattern for Mutable Entities

- `photo_logs` and DC entries are **append-only**. Logical edits are expressed as a new row with a `superseded_by` foreign key pointing to the row being replaced.
- The superseded row is never modified or deleted.
- Queries that need the current state filter for rows where `superseded_by IS NULL`.

### Timestamps

- **Server timestamps are authoritative** for all audit and ordering purposes.
- Client-reported timestamps (e.g. EXIF capture time, form submission time) are **recorded for reference** but never used as the canonical timestamp for audit events.

## Consequences

- The supersede pattern increases row count over time but enables full lineage tracing — every version of a record is recoverable.
- Append-only audit_log means the log cannot be tampered with by application code; RLS is the enforcement mechanism.
- Queries on current state require a `WHERE superseded_by IS NULL` filter; this should be encapsulated in views or query helpers.
