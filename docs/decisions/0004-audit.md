# ADR 0004: Audit Trail and Data Immutability

Date: 2026-05-03  
Status: Accepted

## Context

Regulatory and operational requirements demand a reliable audit trail for all significant actions. Data integrity must be provable and immutable.

## Decision

### Audit Log Enforcement (Defense in Depth)

Immutability of `audit_log` is enforced at three layers:

1. **Privilege level (primary):** The application database role is granted only `INSERT` and `SELECT` on `audit_log`. `UPDATE` and `DELETE` are explicitly REVOKED. Migrations enforce this.
2. **RLS policies (secondary):** Row Level Security policies on `audit_log` permit `SELECT` (scoped by role) and `INSERT` only. No `UPDATE` or `DELETE` policies exist.
3. **Trigger (tertiary):** A `BEFORE UPDATE OR DELETE` trigger on `audit_log` raises an exception if either operation is attempted, providing a final safeguard against misconfiguration.

The supersede pattern for `photo_logs` and `dc_entries` uses RLS to permit `INSERT` only; updates to existing rows are blocked by the same three-layer pattern when those tables are created.

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
