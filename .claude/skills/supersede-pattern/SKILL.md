---
name: supersede-pattern
description: This skill should be used when writing or modifying code that touches photo_logs, dc_entries, or any append-only table. Covers the supersede pattern: never UPDATE, always INSERT a new row with superseded_by pointing at the old row. Trigger terms include supersede, photo_logs, dc_entries, append-only, edit photo, edit log entry.
---

# Supersede pattern

`photo_logs` and `dc_entries` are **append-only** tables. A row's content is
never updated or deleted to express a change. A logical edit is recorded as a
_new row_, leaving the original intact for lineage and audit.

## How a logical edit works

A logical edit is a two-statement transaction:

1. **INSERT** a new row with the new values. Use `RETURNING id` to capture the
   new row's id.
2. **UPDATE** the OLD row, setting `superseded_by` to the new id. This is the
   only column allowed to change on an old row — the immutability trigger
   permits this single update and blocks every other modification.

## Querying current state

Current-state queries always filter for rows that have not been superseded:

```sql
WHERE superseded_by IS NULL
```

A row with `superseded_by IS NULL` is the live version. A row with
`superseded_by` set has been replaced and is kept only for history.

## Required tests

Every feature that writes to `photo_logs` or `dc_entries` must include tests
that verify:

- A logical edit **creates a new row**, not an update.
- The old row's `superseded_by` **points at the new row**.
- A current-state query **returns only the new row**.

## Reference

See ADR 0004 (`docs/decisions/0004-audit.md`) for the full rationale.
