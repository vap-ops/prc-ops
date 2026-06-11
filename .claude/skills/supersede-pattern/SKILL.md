---
name: supersede-pattern
description: This skill should be used when writing or modifying code that touches photo_logs, dc_entries, purchase_request_attachments, or any append-only table. Covers the supersede pattern: never UPDATE any row, ever. A logical edit is a new row whose `superseded_by` column points at the row being replaced; a logical REMOVAL is a tombstone row (payload NULL + superseded_by set, ADR 0015). Current-state queries use an anti-join (not `IS NULL`) plus a tombstone filter. Trigger terms include supersede, tombstone, photo_logs, dc_entries, attachments, append-only, edit photo, remove photo, edit log entry.
---

# Supersede pattern for append-only tables

Tables `photo_logs` and `dc_entries` are strictly append-only. No row is ever modified after insert. The triple-enforcement (REVOKE UPDATE/DELETE + RLS without UPDATE/DELETE policies + BEFORE UPDATE/DELETE trigger) is total. There are no exceptions.

## Write rule

- Never UPDATE these tables. Ever. Not even one column.
- A "logical edit" is a single INSERT of a new row containing the new values. The new row's `superseded_by` column is set to the ID of the row being replaced.
- The replaced row is never touched. It stays in the table forever, exactly as written.
- The link is one-directional: the new row knows about the row it replaces. The replaced row does not know it has been superseded.

## Schema

Each table that uses this pattern has a `superseded_by UUID NULL REFERENCES <same_table>(id)` column. A row with `superseded_by IS NULL` is an **original** — it has not replaced anything. A row with `superseded_by IS NOT NULL` is a **replacement** — it points at the row it replaces.

A partial index on `superseded_by` is required:

```sql
CREATE INDEX <table>_superseded_by_idx ON <table>(superseded_by) WHERE superseded_by IS NOT NULL;
```

The current-state query depends on this index.

## Current-state queries — read this carefully

The "current version" of a logical entity is the row that no other row's `superseded_by` points at. This is **NOT** the same as `WHERE superseded_by IS NULL`.

Walk through an entity edited twice, in order A then B then C:

| Row | id     | superseded_by | Meaning                       |
| --- | ------ | ------------- | ----------------------------- |
| A   | uuid-A | NULL          | Original, no longer current   |
| B   | uuid-B | uuid-A        | Replaced A, no longer current |
| C   | uuid-C | uuid-B        | Current version               |

Under the write rule, `WHERE superseded_by IS NULL` returns A — the oldest row, not the current row. To get C, use an anti-join:

```sql
SELECT pl.*
FROM photo_logs pl
WHERE NOT EXISTS (
  SELECT 1 FROM photo_logs newer
  WHERE newer.superseded_by = pl.id
);
```

This returns every row that is not pointed at by any other row's `superseded_by` — i.e., every "head" of an edit chain. For an unedited entity, the head is the original. For an edited entity, the head is the latest replacement.

Equivalent variants are listed in ADR 0009. Use `NOT EXISTS` by default.

**User-facing views must use the anti-join pattern.** Never expose the full history of a logical entity to users unless explicitly displaying an audit trail.

## Tombstone variant — removal without replacement (ADR 0015)

Accumulating collections (photos on a WP/phase; attachments on a purchase
request) need **removal**, not just replacement. Removal is ALSO an
INSERT — a **tombstone** row:

- **Tombstone shape:** the payload column(s) are NULL and `superseded_by`
  points at the row being removed. For `photo_logs` the sentinel is
  `storage_path IS NULL`; for tables with multiple payload columns (e.g.
  `purchase_request_attachments`: `storage_path` XOR `url`), ALL payload
  columns are NULL on a tombstone.
- **A well-formedness CHECK is mandatory** so every row is provably
  either real content or a valid tombstone — the two malformed shapes
  (no payload + supersedes nothing; payload + supersedes something) are
  rejected at INSERT time. photo_logs canonical form:

```sql
constraint photo_logs_path_supersede_well_formed
  check ((storage_path is null) = (superseded_by is not null))
```

This deliberately forecloses atomic replacement (one row that both
carries new content AND supersedes an old row). Replacement = TWO
appends (tombstone + fresh insert), wrapped in a transaction by the
caller when they must commit together.

- **Current-state read = anti-join PLUS tombstone filter.** Both filters
  are necessary: the anti-join alone still surfaces tombstone rows
  (nothing supersedes a tombstone); the payload-not-null filter alone
  still surfaces replaced rows.

```sql
select pl.*
from photo_logs pl
where pl.storage_path is not null            -- exclude tombstones
  and not exists (
    select 1 from photo_logs newer
    where newer.superseded_by = pl.id
  );
```

- The removed row's Storage object (if any) stays in the bucket —
  orphan-accepted; the table is the source of truth, never a bucket
  listing.
- **Policy hazard:** when an INSERT policy's WITH CHECK validates a
  tombstone via a subquery FROM the same table, outer-row references
  MUST be table-qualified (`<table>.superseded_by`), or SQL name capture
  silently rewrites the predicate against the subquery's alias (found
  the hard way in the spec-16 design review).

## Walking history backwards

To reconstruct the full edit history of a logical entity, start at the current (head) row and walk backwards via `superseded_by`:

```sql
WITH RECURSIVE history AS (
  SELECT * FROM photo_logs WHERE id = $current_id
  UNION ALL
  SELECT pl.*
  FROM photo_logs pl
  JOIN history h ON h.superseded_by = pl.id
)
SELECT * FROM history ORDER BY created_at DESC;
```

`$current_id` must be the head row's id (obtained from the anti-join query above), not an arbitrary id from the edit chain.

## Tests required

Any feature that writes to an append-only table using this pattern must include tests verifying:

- A logical edit produces a new row with the correct `superseded_by` value pointing at the row being replaced. The replaced row is unchanged.
- An attempt to UPDATE any row raises (triple-enforcement test).
- The current-state anti-join query returns only head rows for each logical entity (verify with a 3-row chain A then B then C, anti-join returns only C).
- Tombstone tables additionally: the well-formedness CHECK rejects both malformed shapes (`throws_ok`); a tombstone removes its target from the current-state read; the current-state query carries BOTH filters.
- A naive `WHERE superseded_by IS NULL` query is **not** used in production code (grep or lint check). This pattern is a common bug and worth a guard.
- The full history of a logical entity is reconstructible by walking the `superseded_by` chain backwards from the head row.

## Sources of truth

- **ADR 0004** — establishes append-only enforcement and the write pattern. Foundational.
- **ADR 0009** — corrects the current-state read pattern from `IS NULL` (incorrect) to anti-join. Amends ADR 0004.
- **ADR 0015** — adds the tombstone-removal variant, the payload-NULL sentinel, the well-formedness CHECK, and the two-filter current-state read. Extends 0004/0009.

When implementing, all three ADRs apply. If anything in this skill contradicts an ADR, the ADRs win and this skill should be updated to match.
