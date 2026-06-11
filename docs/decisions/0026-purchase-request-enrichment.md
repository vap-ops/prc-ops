# ADR 0026: Purchase-request enrichment — needed_by/eta/priority, site-wide visibility, attachments domain

## Status

Accepted — 2026-06-11

Implements [spec 16 + its locked addendum](../feature-specs/16-purchase-request-enrichment.md)
(operator decisions Q1–Q4 of 2026-06-11 and the iteration-6 brief).
**Amends ADR 0022** (two "no further ALTER expected" claims; the
SA cross-user isolation decision), **ADR 0018** (grant matrix), and
adds a pointer to **ADR 0025** (grant-relevant sections). P1 ships the
columns + visibility; P2 ships the attachments domain declared here;
P3 (capability-URL image bridge) is governed by ADR 0027, not this ADR.

## Decision A — three new `purchase_requests` columns

| Column      | Type                                                  | Writer                                                               | Notes                                                                                                                                                                   |
| ----------- | ----------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needed_by` | `date NULL`                                           | requester at INSERT                                                  | No now()-relative CHECK (would invalidate rows over time); the >= today rule is validator-only UX.                                                                      |
| `eta`       | `date NULL`                                           | `appsheet_writer` ONLY (additive column-scoped `GRANT UPDATE (eta)`) | Row gate = existing `"appsheet_writer update by status"` policy — eta may be set on `approved` rows before the purchase is recorded (desired). The app never writes it. |
| `priority`  | `purchase_request_priority NOT NULL DEFAULT 'normal'` | requester at INSERT                                                  | Enum declared `'normal','urgent','critical'` — declaration order IS the sort order (`ORDER BY priority DESC` = critical first).                                         |

`date` over `timestamptz` for both dates: day-granular intent, no
Bangkok/UTC off-by-one, trivially comparable. Neither `needed_by` nor
`priority` is editable post-insert in v1 (an SA-edit RPC is a recorded
seam). **Two-layer-guard extension (recorded):** PM/super remain
_technically_ able to write all three columns via the open UPDATE
policy (`purchase_requests update by pm or super` — role-gated only);
no server action exposes them, the same posture ADR 0022 records for
the decision columns. `appsheet_writer` must NOT write `needed_by` or
`priority` — its protected set grows to 5 (status, source,
item_description, needed_by, priority), pinned in pgTAP and by the
AppSheet read-only column config (go-live §2a; mandatory before the
Tier-2 smoke re-run, or AppSheet row saves fail 42501 wholesale).

## Decision B — site-wide SELECT for `site_admin` (REVERSES the 2026-06-07 isolation decision)

Operator decision 2026-06-11: "people on site must see statuses of all
the purchases related to the site, not just the ones they requested."
The SELECT policy's privileged list gains `site_admin`:

```sql
using (
  requested_by = auth.uid()
  or public.current_user_role() in
     ('site_admin', 'project_manager', 'procurement', 'super_admin')
)
```

- Access remains **role-level** (ADR 0013): no project-membership
  concept exists and both pilots share all staff, so "the site" =
  everything the role can see, same as work_packages.
- The own-row branch stays for future narrower roles.
- The UPDATE policy and every `TO appsheet_writer` policy are
  untouched; `appsheet_writer` is unaffected (NULL
  `current_user_role()`).
- **Name exposure (operator-sanctioned):** the site-wide list shows
  ขอซื้อโดย display names to SAs via the admin-client
  `fetchDisplayNames` helper — and, per the spec A1 fallback chain
  (name → email → em-dash), the requester's login email
  (`requested_by_email`) where no display name exists. The exposure
  radius is display name OR login email, to every role that can read
  the row (security-lens amendment, 2026-06-11).
- **Attachments follow automatically** (P2): the child SELECT policy's
  EXISTS runs under the caller's parent RLS, so SAs will also see
  colleagues' attachments — and the pr-attachments **signed-URL
  exposure radius is therefore project-wide for site_admin as well as
  PM/procurement/super** (supersedes the narrower radius in spec 16's
  original governance item (f)). Pages may feed the minting helper
  only rows already selected for render.
- **Migration immutability correction to the spec addendum:** the
  addendum asked for pointer edits inside applied migration
  `20260608120000` (the isolation header note AND the index
  "purpose-built" comment). Applied migrations are immutable
  (checksummed by `supabase migration list`); both notes are
  superseded **by this ADR**, not by editing the file. ADR 0022 (a
  doc, not a migration) gets the in-place pointers.
- **Transitional deploy window (recorded):** the policy flips the
  moment `db push` runs, minutes before the P1 UI deploys — in that
  window SAs see foreign rows on the already-deployed `/requests`
  (spec 19 dropped its own-rows filter) under the stale ของฉัน
  heading, with no requester names rendered (the deployed code gates
  them to pm/super). Operator-sanctioned outcome arriving slightly
  early; accepted.

## Decision C — eta audit posture: one canonical shape

eta is audited **only** as a case-3 correction diff (action `update`,
`changed:{eta:[old,new]}`) in `purchase_requests_audit_appsheet`. The
case-1 purchase and case-2 delivery payloads are NOT amended — one
fact, one audit shape, pinned in pgTAP (purchase payload keys exactly
{principal, supplier, order_ref, amount, purchased_at}).
**Accepted gaps (all identical to the pre-existing posture for the 7
original fact columns):** (1) an eta change bundled into the same
UPDATE statement as a status transition is not separately audited (the
case-1/2 early-returns); (2) a native (PM/super) eta write on a row
still in `requested`/`rejected` escapes BOTH audit triggers — their
WHEN domains are disjoint from that state; (3) eta (like every column)
is technically seedable at INSERT time under the table-level
authenticated INSERT grant. All three are accepted because no server
action exposes eta, `appsheet_writer` cannot see pre-approval rows,
and the same holds today for the decision and fact columns. The function's diff
body AND the trigger's WHEN clause both hard-code the column list, so
the migration must CREATE OR REPLACE the function and DROP + recreate
the trigger (WHEN is not ALTERable); grant + audit amendment land in
ONE migration so there is no window where eta is writable but its
corrections are unaudited.

## Decision D — attachments domain (P2; declared here, governed by spec 16 §4)

- `purchase_request_attachments`: one table, `kind` enum
  (`image`/`link`), XOR payload CHECKs, **tombstone-supersede removal**
  per ADR 0015 (removal is an INSERT; the composite FK
  `(superseded_by, purchase_request_id, kind) → (id, purchase_request_id, kind)`
  makes same-parent/same-kind tombstoning a DB invariant).
  Append-only **triple-enforced + TRUNCATE** (block-write trigger —
  this table is more security-relevant than photos).
  `created_by = pr.requested_by` holds transitively at insert time
  only (both pinned to `auth.uid()`); it is NOT an independent DB
  constraint.
- **Capability token in a 1:1 side table**
  (`purchase_request_attachment_tokens`), NOT on the append-only
  table: rotation is a plain service-role UPDATE with no append-only
  conflict. Browser-reachable roles have ZERO access to the token
  table; `appsheet_writer` reads it via a status-gated policy.
- Two **security_invoker** views encode the ADR 0009 anti-join once:
  `_current` (app pages, no token) and `_appsheet` (token included).
- Private `pr-attachments` bucket; the storage INSERT policy is
  **path-bound to the caller's own pending request** (project_id + PR
  id verified in WITH CHECK) — the photos bucket's role-only looseness
  deliberately does NOT carry over to a client-built path.
- **Accepted TOCTOU:** a tombstone whose snapshot saw
  `status='requested'` can commit just after an approval commits —
  same class the photos flow accepts.
- Every new object's migration opens with
  `revoke all … from anon, authenticated` (Supabase default-privilege
  posture), then re-grants column-scoped.

## Amended grant matrix (supersedes the ADR 0018 rows in place)

| Object                               | appsheet_writer                                                                                         | Notes                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `purchase_requests` UPDATE           | 8 columns: supplier, order_ref, amount, purchased_at, delivered_at, received_by, delivery_note, **eta** | needed_by/priority join the protected set |
| `purchase_request_attachments`       | SELECT (status-gated policy) — P2                                                                       | no INSERT/UPDATE/DELETE                   |
| `purchase_request_attachment_tokens` | SELECT (status-gated via parent) — P2                                                                   | rotation is service-role only             |
| `_appsheet` view                     | SELECT — P2                                                                                             | the configured AppSheet surface           |

## Rejected alternatives

- **Project-membership scoping for Decision B** — no membership
  concept exists (ADR 0013 is role-level by design); inventing one for
  this feature would be a far larger access-model change than the
  operator asked for. Revisit when an external account joins (ADR
  0013's recorded trigger).
- **eta in the transition payloads too** — two immutable audit shapes
  for one fact; consumers could never rely on either.
- **Token column on the attachments table** — rotation would require
  violating the table's own append-only enforcement.
- **CHECK-based priority ordering or a smallint** — the enum's
  declaration order gives sorting for free and keeps the status-field
  doctrine.

## Consequences

**Positive:** requesters state urgency and deadlines; the back office
states ETAs; site staff see the whole site's purchasing state; every
new write surface keeps the established privilege-layer guarantees.

**Negative:** SA-tier cross-user isolation is gone (deliberate,
operator-decided); the `(status, requested_at desc)` index no longer
serves the pending band's full ORDER BY (filter-via-index + in-memory
sort accepted at pilot scale); two more columns AppSheet operators
must mark read-only.

**Neutral:** P3's no-login read path is deliberately OUT of this ADR —
ADR 0027 owns that posture change.

## References

- [Spec 16 + addendum](../feature-specs/16-purchase-request-enrichment.md) — the locked design this ADR canonizes.
- ADR 0013 (role-level access), ADR 0015 (tombstone-supersede), ADR 0018 (AppSheet role — matrix amended in place), ADR 0022 (purchasing domain — amended in place), ADR 0025 (AppSheet write path — pointer added).
- Migrations `20260613100000`, `20260613100050`, `20260613100100` (P1); the P2 set per spec 16 §6.
