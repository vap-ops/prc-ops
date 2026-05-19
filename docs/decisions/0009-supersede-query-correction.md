# ADR 0009: Supersede Current-State Query Pattern (Amends ADR 0004)

## Status

Accepted — 2026-05-20

Amends ADR 0004 (audit/immutability). ADR 0004 remains the foundational record for append-only enforcement and the supersede write pattern. This ADR corrects the current-state read pattern only.

## Context

ADR 0004 specifies that append-only tables (`photo_logs`, `dc_entries`) handle logical edits via the supersede pattern:

- Paragraph 24: "edits happen by inserting a new row with a `superseded_by` foreign key pointing to the row being replaced"
- Paragraph 26: "current-state queries filter `WHERE superseded_by IS NULL`"
- Paragraph 37: same `WHERE superseded_by IS NULL` pattern restated

These three statements are mutually inconsistent. Walking through an entity with two edits:

| Row | id     | superseded_by                        |
| --- | ------ | ------------------------------------ |
| A   | uuid-A | NULL (original)                      |
| B   | uuid-B | uuid-A (replaces A)                  |
| C   | uuid-C | uuid-B (replaces B; current version) |

Under ADR 0004's write rule, the current row C has `superseded_by = uuid-B`, not NULL. The original row A is the only row with `superseded_by IS NULL`. So `WHERE superseded_by IS NULL` returns the **oldest** row of each edit chain, not the current one.

This bug was discovered when reconciling the `supersede-pattern` skill against ADR 0004 prior to building `photo_logs`. No application code has been written against the wrong query yet; the migration for `photo_logs` has not been written; no production data depends on the answer. The cost of correcting is documentation-only.

The strict append-only invariant (no UPDATE on any row, ever) is non-negotiable per ADR 0004 and cannot be relaxed to make `IS NULL` work. Therefore the read pattern must change, not the write pattern.

## Decision

The write pattern in ADR 0004 is correct and stays: a logical edit inserts a new row with `superseded_by` pointing at the row being replaced. The old row is never modified.

The current-state read pattern is corrected to an anti-join: the current version of a logical entity is the row that no other row's `superseded_by` column points at.

```sql
-- Correct current-state query
SELECT pl.*
FROM photo_logs pl
WHERE NOT EXISTS (
  SELECT 1 FROM photo_logs newer
  WHERE newer.superseded_by = pl.id
);
```

Equivalent forms (use whichever is most readable in context, but prefer `NOT EXISTS` for performance on indexed `superseded_by`):

```sql
-- NOT IN variant
SELECT *
FROM photo_logs
WHERE id NOT IN (
  SELECT superseded_by FROM photo_logs WHERE superseded_by IS NOT NULL
);

-- LEFT JOIN variant
SELECT pl.*
FROM photo_logs pl
LEFT JOIN photo_logs newer ON newer.superseded_by = pl.id
WHERE newer.id IS NULL;
```

### Indexing requirement

Every append-only table using this pattern must have an index on `superseded_by`. The current-state query is run on every user-facing read; an unindexed `superseded_by` makes every read scan the full table.

```sql
CREATE INDEX <table>_superseded_by_idx ON <table>(superseded_by) WHERE superseded_by IS NOT NULL;
```

The partial index (`WHERE superseded_by IS NOT NULL`) is sufficient because the anti-join only cares about rows that supersede something.

### Walking edit history

To reconstruct the edit history of a logical entity from the current row backwards:

```sql
WITH RECURSIVE history AS (
  -- start at the current row
  SELECT * FROM photo_logs WHERE id = $current_id
  UNION ALL
  -- walk backwards via superseded_by
  SELECT pl.*
  FROM photo_logs pl
  JOIN history h ON h.superseded_by = pl.id
)
SELECT * FROM history ORDER BY created_at DESC;
```

## Consequences

**Positive**

- The query pattern now matches the write pattern. Implementers reading the skill, ADR 0004, and this ADR together get consistent guidance.
- No schema change required. No data migration required. No application code change required (no application code references the wrong query yet).
- The partial index on `superseded_by` is small (only superseded rows occupy it) and fast.

**Negative**

- All future application code, views, and RLS policies must use the anti-join pattern, not the simpler `IS NULL` filter. This is more error-prone for hand-written queries.
- Documentation drift risk: ADR 0004 still contains the incorrect `IS NULL` pattern in its text. Per the immutability convention for accepted ADRs, ADR 0004 body is not edited — readers must see the Status annotation pointing at this ADR.

**Neutral**

- The `supersede-pattern` skill is rewritten to teach the anti-join pattern and references ADR 0009 alongside ADR 0004.

## Documentation handling

ADR 0004 is not edited except for a Status annotation pointing at ADR 0009.

`CLAUDE.md` is updated to reference ADR 0009 in the Supersede pattern bullet under "Database schema & immutability."

`.claude/skills/supersede-pattern/SKILL.md` is rewritten to teach the corrected pattern, citing ADR 0009 as the source of truth for queries and ADR 0004 as the foundational invariant doc.

## Open questions

None blocking. Worth noting for future ADR process:

- ADR 0004's bug survived review because nobody implemented a current-state query against it before this point. Future ADRs that prescribe SQL patterns should include a worked example with sample rows and expected query output to catch this class of error earlier.

## References

- ADR 0004 — Audit log immutability and the supersede pattern
- `.claude/skills/supersede-pattern/SKILL.md` — rewritten in this same unit
- `CLAUDE.md` — Supersede pattern bullet updated in this same unit
