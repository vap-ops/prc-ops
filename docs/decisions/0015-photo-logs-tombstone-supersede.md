# ADR 0015: photo_logs tombstone-supersede + well-formedness CHECK

## Status

Accepted — 2026-05-24

Extends [ADR 0004](0004-audit.md) (append-only / supersede write pattern) and
[ADR 0009](0009-supersede-query-correction.md) (current-state read pattern via
anti-join). Inherits the role-level access model of
[ADR 0013](0013-project-access-model.md). Policies use the
[ADR 0011](0011-rls-role-helper.md) `current_user_role()` helper exclusively;
never self-joins `public.users`.

## Context

ADR 0004 establishes append-only enforcement for `audit_log`, `photo_logs`, and
`dc_entries`, with the supersede pattern handling logical edits: a "replacement"
is an INSERT of a new row whose `superseded_by` points at the row being replaced.
The replaced row is never modified. ADR 0009 corrected the current-state read
to an anti-join — the current row is the one no other row's `superseded_by`
points at.

`photo_logs` is the first table to actually exercise this pattern in
production, and the design session before this PR surfaced two things ADR 0004
and ADR 0009 do not cover:

1. **Photos accumulate, they don't get edited.** A WP/phase carries multiple
   photos. There is no per-photo "edit" operation. The supersede framing in
   ADR 0004 — "a logical edit replaces the previous row" — describes
   replacement, not addition or removal of items from an accumulating
   collection.

2. **Removal must work without inventing a parallel deletion path.** A photo
   may need to be removed with no replacement (the photographer took an
   unusable shot; the wrong file was uploaded). The strict append-only
   invariant from ADR 0004 forbids any UPDATE or DELETE. So "remove" cannot
   be `set deleted_at = now()` (UPDATE) and cannot be `delete from
photo_logs` (DELETE). It must also be an INSERT.

The decision below extends the supersede mechanism rather than adding a
parallel deletion mechanism, and adds a DB-enforced well-formedness
invariant so every row is provably either a real photo or a valid tombstone.

## Decision

### Tombstone-supersede

`photo_logs` reuses the supersede mechanism (the `superseded_by` self-FK and
the ADR 0009 anti-join read pattern) for **removal** as well as
**replacement**:

- **Add** a photo: INSERT a row with `storage_path` set and `superseded_by`
  NULL. (Same as a fresh original row under ADR 0004.)
- **Remove** a photo: INSERT a **tombstone** row with `storage_path = NULL`
  and `superseded_by = <id of the photo being removed>`. The tombstone is
  itself never pointed at by another row; the row it supersedes is now
  pointed at (and therefore no longer "current" under the anti-join).
- **Replace** a photo: tombstone the old photo + INSERT a new photo. Two
  appends, not one operation. There is no atomic-replacement variant in v1.
  Callers that need both writes to commit together must wrap the pair in a
  single transaction.

The `storage_path IS NULL` sentinel is the load-bearing signal that a row is
a tombstone. Real photos always have a non-null `storage_path`; tombstones
never do.

### Well-formedness CHECK constraint

The constraint

```sql
constraint photo_logs_path_supersede_well_formed
  check ((storage_path is null) = (superseded_by is not null))
```

is mandatory and DB-enforced. Every row is provably exactly one of:

- a **real photo** — `storage_path` set, `superseded_by` NULL (the row
  supersedes nothing), or
- a **tombstone** — `storage_path` NULL, `superseded_by` set (the row
  supersedes exactly one other row).

The two malformed combinations are rejected at INSERT time:

- both NULL — a row that is neither a photo nor a removal-of-something. The
  app has no use for such a row, and allowing it would silently widen the
  invariant the read pattern relies on.
- both set — a "hybrid" row that both stores a photo AND removes another
  row. The supersede mechanism in ADR 0004 was always one-directional
  (newer → older); a real photo carrying a `superseded_by` would let a
  single row serve two roles, undermining the simple either-or that the
  current-state query relies on.

The constraint is not free — it forecloses any future "atomic replacement"
variant that wanted to encode "this row is the replacement of <id>" as a
single INSERT. That variant is explicitly out of v1 scope; if it ever
returns, the right move is a new ADR that reconsiders this constraint
together with the new write shape, not a quiet relaxation.

### Current-state read

The "current photos for WP X / phase Y" query is the ADR 0009 anti-join
plus a `storage_path IS NOT NULL` filter:

```sql
select pl.*
from public.photo_logs pl
where pl.work_package_id = $wp_id
  and pl.phase           = $phase
  and pl.storage_path is not null            -- exclude tombstones
  and not exists (                           -- ADR 0009 anti-join
    select 1 from public.photo_logs newer
    where newer.superseded_by = pl.id
  );
```

The first filter (`storage_path IS NOT NULL`) excludes tombstones; the
anti-join filter (`NOT EXISTS …`) excludes photos that something else
supersedes (tombstoned photos and any replaced photos). The combination
returns exactly the currently-visible photos for that WP / phase. Both
filters are necessary — the anti-join alone would still surface tombstone
rows (no row supersedes a tombstone), and the path-not-null filter alone
would surface superseded-then-replaced photos.

The partial index from ADR 0009 (`photo_logs_superseded_by_idx ON
(superseded_by) WHERE superseded_by IS NOT NULL`) is the index that makes
this query fast. Without it, the anti-join scans the whole table.

### Worked example

A single WP/phase, three appends, plus a tombstone:

| t   | Append                | id   | storage_path | superseded_by |
| --- | --------------------- | ---- | ------------ | ------------- |
| t0  | Photo A uploaded      | id-A | `…/A.jpg`    | NULL          |
| t1  | Photo B uploaded      | id-B | `…/B.jpg`    | NULL          |
| t2  | A removed (tombstone) | id-T | NULL         | id-A          |

Anti-join + tombstone filter for this WP/phase:

- id-A: tombstoned (id-T points at it) — anti-join excludes.
- id-B: nothing points at it, `storage_path` is not null — **kept**.
- id-T: nothing points at it, but `storage_path` IS NULL — tombstone filter
  excludes.

Result: { id-B }. Photo A was successfully removed without modifying or
deleting any row. The full history (A uploaded, B uploaded, A removed) is
still recoverable by reading every row for the WP/phase ordered by
`created_at`.

A "replacement" of B with B′ is two appends: tombstone id-B (INSERT a
removal row pointing at id-B), then INSERT id-B′. The anti-join then
returns { id-B′ }. Note that both writes are independent INSERTs — for
atomicity, wrap them in a transaction at the application layer.

### Triple-enforcement (unchanged from ADR 0004 + audit_log shape)

`photo_logs` is append-only, enforced at three layers exactly like
`audit_log`:

1. **Privilege** — REVOKE ALL on `photo_logs` from `authenticated, anon`;
   GRANT INSERT and SELECT only. `service_role` retains all privileges by
   default; layer 3 catches its UPDATE/DELETE attempts too.
2. **RLS** — policies for INSERT and SELECT only. No UPDATE or DELETE
   policy exists; with RLS enabled and no matching policy, every UPDATE
   or DELETE through the application path affects zero rows.
3. **Trigger** — a `BEFORE UPDATE OR DELETE` trigger on `photo_logs` raises
   `P0001` with message `"photo_logs is append-only"`. Mirrors
   `audit_log_block_write()` in shape and message; defined as a separate
   function (`photo_logs_block_write()`) because the existing function
   hard-codes the audit_log message.

### Access model (inherits ADR 0013)

Role-level access via `public.current_user_role()`. INSERT permitted for
`site_admin`, `project_manager`, `super_admin` — all three can both upload
photos AND create tombstones. There is intentionally no separate
"moderator" role for removals in v1; the privilege to remove is the same
as the privilege to add. SELECT permitted for the same set. No UPDATE
policy, no DELETE policy.

## Consequences

**Positive**

- One mechanism (supersede + anti-join) handles add, remove, and replace.
  No parallel deletion path, no `deleted_at` column, no soft-delete shim.
- The well-formedness CHECK makes invalid states unrepresentable: every
  row is provably either a real photo or a valid tombstone, and the
  invariant is enforced by Postgres, not by application code.
- Full history is preserved — every upload and every removal is a durable
  row. The PDF report's "what happened on this WP" view is a trivial
  ordered scan; the auditor's view is the same scan.
- The skill at [`.claude/skills/supersede-pattern/SKILL.md`](../../.claude/skills/supersede-pattern/SKILL.md)
  extends naturally — same anti-join, one extra filter.

**Negative**

- The current-state query is anti-join + tombstone filter, not the
  simpler "newest non-tombstoned row". This is two filters, not one, and
  must be applied consistently. A naive `where storage_path is not null`
  alone would surface superseded photos; a naive anti-join alone would
  surface tombstone rows. The supersede skill will be updated to teach
  this — note that **this PR does not update the skill**; the skill
  update is tracked as a follow-up so the change can be reviewed
  alongside a real consumer of the pattern.
- Replacement is two appends, not one atomic write. Callers that need
  the tombstone and the new photo to commit together must open a
  transaction. The default INSERT is not transactional with anything
  else.
- The well-formedness CHECK forecloses a future "atomic replacement"
  encoding (a single row that both stores a new photo and supersedes an
  old one). That variant would need a new ADR.

**Neutral**

- Extends ADR 0004 / ADR 0009 rather than contradicting them. The
  write pattern from 0004 and the read pattern from 0009 are
  unchanged; this ADR adds the tombstone shape and the
  well-formedness invariant on top.
- The `superseded_by` column already exists in ADR 0004's framing; the
  partial index already exists in ADR 0009's framing. The tombstone
  variant uses both without changes.

## Follow-ups (not part of this PR)

- **Skill update.** [`.claude/skills/supersede-pattern/SKILL.md`](../../.claude/skills/supersede-pattern/SKILL.md)
  teaches the supersede pattern in its replacement-only framing. It
  must be extended to teach the tombstone variant, the
  `storage_path IS NULL` sentinel, the `WHERE storage_path IS NOT NULL`
  filter on current-state queries, and the well-formedness CHECK. Not
  done here — deferred to a follow-up so the skill change can be
  reviewed against the first real consumer (the photo-upload UI unit).
- **Supabase Storage bucket.** `photo_logs.storage_path` currently
  references object paths that the Storage bucket — a separate later
  unit — will make real. Until then `storage_path` is just text. The
  signed-upload-URL minting endpoint and the storage-side RLS belong to
  that unit.
- **Atomic replacement helper.** If a future operational need calls for
  a single-statement replace (tombstone + new in one write), that ships
  with its own ADR that reconsiders the well-formedness CHECK.

## References

- [ADR 0004](0004-audit.md) — append-only enforcement and the original
  supersede write pattern this ADR extends.
- [ADR 0009](0009-supersede-query-correction.md) — anti-join read
  pattern this ADR builds on (tombstone filter layered on top).
- [ADR 0011](0011-rls-role-helper.md) — `current_user_role()` helper;
  mandatory primitive for every policy this table specifies.
- [ADR 0013](0013-project-access-model.md) — role-level access model
  inherited by every domain table in v1, including `photo_logs`.
- [`docs/feature-specs/02-photos-and-approvals.md`](../feature-specs/02-photos-and-approvals.md)
  — the spec that locks the design this ADR documents in canonical form.
- [`.claude/skills/supersede-pattern/SKILL.md`](../../.claude/skills/supersede-pattern/SKILL.md)
  — to be updated in a follow-up unit (see Follow-ups above).
