# Data architecture review & hardening — June 2026

A multi-agent audit (normalization, scale, RLS/tenancy, AI-readiness), then an
autonomous remediation pass. Verdicts up front, then what shipped (all applied
to prod, pgTAP-pinned), then what is deliberately deferred.

## Verdicts

- **Normalized?** YES, to an unusually high standard — 15 enums back every
  status/type column, FKs typed throughout with reasoned ON DELETE, CHECK
  constraints encode real invariants, and the `*_snapshot` denormalization on
  `labor_logs` is correct point-in-time audit truth. One genuine defect found
  and fixed (`purchase_requests.received_by`).
- **Scale-ready?** Was NO (pilot-fine), now substantially yes for the next order
  of magnitude. The headline tax — every RLS policy re-evaluating the role
  function per row — is fixed; hot-path indexes added; the only unbounded
  disposable table is now pruned.
- **AI-ready?** Was greenfield. Foundations now in place (the schema is legible
  to an LLM, the money boundary is pinned). The semantic/vector layer and the
  AI-access contract are scoped but not built (deferred, below).

## Shipped (2026-06-13, all on prod)

| Rank | Change                                                                                                                                                                                                | Migration / file            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1    | `labor_logs` `superseded_by` partial index (anti-join) + `work_date` index (the spec-69 payroll date-window was seq-scanning)                                                                         | `20260625000100`            |
| 2    | FK/status indexes: `purchase_requests(requested_by, supplier_id)`, `work_packages(status,updated_at)`+`(contractor_id)`, `workers(contractor_id, user_id)`                                            | `20260625000100`            |
| 5    | Revoke PUBLIC/anon EXECUTE on `log_labor_day`, `correct_labor_log`, `create_worker`, `update_worker`, `set_worker_day_rate` (the 0624 note-param DROP+CREATEs had reset grants to the PUBLIC default) | `20260625000200`            |
| 4    | `prune_notification_outbox` daily cron — deletes terminal (`sent`/`expired`) rows >30d                                                                                                                | `20260625000300`            |
| 6    | `COMMENT ON` for all 20 tables + load-bearing columns (supersede/tombstone rules, money boundary, enum meanings, snapshots) — was 0 table / 4 column comments                                         | `20260625000400`            |
| 7    | `purchase_requests.received_by_id` FK (the receiver is a known users row), populated on both write paths; `reports.params` object CHECK; `workers.contractor_id` delete-block comment                 | `20260625000500`            |
| 3    | **RLS eval-once** — wrap `auth.uid()` / `current_user_role()` in scalar subselects so the planner hoists them to a one-per-query InitPlan (verified via EXPLAIN). 66 of 67 public policies            | `20260625000600/700/800`    |
| 8    | `/requests` bounded queries — split pending/decided, `?mine` as a DB predicate; kills the silent 1000-row PostgREST truncation                                                                        | `src/app/requests/page.tsx` |
| 9    | Pin the no-JWT → NULL → deny invariant (appsheet_writer / anon / future AI role all depend on it)                                                                                                     | pgTAP `41`                  |

pgTAP pins added: `35` indexes, `36` execute-lockdown, `37` retention, `38`
comments, `39` received_by_id + params, `40` eval-once, `41` NULL-deny. Suite
865 assertions / 0 failures.

### RLS eval-once — the one exception

`photo_markups` is excluded. Its INSERT policy has an **inline self-referential
subquery** (own-tombstone-target check); wrapping calls in either of its policies
makes the self-reference re-apply a wrapped policy → `42P17` infinite recursion.
Both photo_markups policies stay bare. It is low-volume (photo annotations).
**To re-include it:** route the tombstone check through a SECURITY DEFINER helper
(mirroring attachments' `pr_attachment_tombstone_target_ok`), which removes the
inline self-reference; then the wrap is safe.

## Deferred — the AI layer and the bigger bets (in build order)

These are scoped, not started. Each is its own future unit.

1. **AI access contract (CRITICAL, do before any AI query surface).** The
   service-role admin client (`src/lib/db/admin.ts`) is the only reader of money
   columns AND a full RLS+grant bypass. Any text-to-SQL/MCP/agent surface MUST
   run under the caller's authenticated RLS context (`server.ts`), never the
   admin client; expose cost aggregates only via pm/super-gated SECURITY DEFINER
   views/RPCs. Extend pgTAP 34's money-boundary pattern to a dedicated read-only
   agent role once one exists.
2. **Semantic / analytics views.** Pre-bake the supersede+tombstone+snapshot
   logic and expose safe aggregates (`labor_cost_by_project_month`,
   `purchase_spend_by_project`, `wp_current_status`). Money-bearing views gated
   to pm/super; cost-free shapes to the broader role set. Collapses the queries
   agents get wrong into ones they cannot. Materialize enum→Thai labels (today
   only in `src/lib/i18n/labels.ts`) into a seeded table or COMMENTs.
3. **`ai_insights` landing table** (modeled on `reports`): AI output stays DRAFT
   until a human accepts; never auto-promoted into the audit_log evidence chain.
4. **Partition the evidence logs** (`audit_log`/`photo_logs` by `created_at`,
   `labor_logs` by `work_date`) once volume justifies — they can't be deleted
   (evidence), so partition, not retention. The index + eval-once fixes buy
   substantial runway first.
5. **pgvector** last: a `content_embeddings` SIDE table (never a column on the
   append-only tables) + HNSW index, kept current by cloning the
   notification_outbox outbox pattern. Start with `purchase_requests.item_description`
   and `work_packages.name/description`, then photo vision-captions, then invoice OCR.

### Smaller recorded follow-ups

- **Multi-tenancy seam:** no `org_id`/tenant dimension exists (ADR 0013 is
  role-level only; ADR 0035 chose instance-per-customer). Adding a
  `current_org_id()` companion to `current_user_role()` + threading it through
  policies is a mechanical migration _once per-org scoping is designed_ — decide
  before customer instance #2 (cross-customer aggregation is impossible after
  instances split).
- `/requests` keyset pagination if the 500 decided-row cap is ever reached.
- `photo_markups` SECURITY DEFINER tombstone helper (re-include in eval-once).
- Snapshot the contractor name on `labor_logs`/`purchase_requests` if rename
  drift on historical rows ever matters (today: current name).

## Honest caveats

- The eval-once win is verified via EXPLAIN (InitPlan hoist confirmed on
  `labor_logs`); it was not separately benchmarked on a large seeded dataset, but
  the InitPlan vs per-row Filter change is structural.
- Partitioning urgency depends on real insert rates (unmeasured) — deferred for
  that reason, not overlooked.
- The money column-grant boundary was already pinned by pgTAP `34`; the residual
  test gap is only a future agent role + the (now-added) NULL-deny assertion.
