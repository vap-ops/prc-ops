# Quality-debt plan — June 2026

Origin: codebase-understanding review (2026-06-16). Three structural/infra weak
spots were identified and turned into specs + ADRs. This doc is the master plan:
sequencing, dependencies, and a frank assessment of what can run autonomously vs
what is operator-gated.

## The three units

| Unit | Spec                                                          | ADR                                                                | What it fixes                                                  |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1    | [122](feature-specs/122-feature-components-domain-folders.md) | — (taxonomy in-spec)                                               | 62 flat files in `src/components/features/` → 7 domain folders |
| 2    | [123](feature-specs/123-shared-db-types.md)                   | [0047](decisions/0047-shared-generated-types-across-app-worker.md) | `database.types.ts` duplicated app/worker, drifts silently     |
| 3    | [124](feature-specs/124-ci-worker-and-test-tiers.md)          | [0048](decisions/0048-ci-test-tier-policy.md)                      | CI never builds/tests the worker; test-tier policy unrecorded  |

## Sequencing & dependencies

- **122 is independent** — biggest diff (pure churn), lowest conceptual risk. Do
  it on its own branch first or last; no coupling.
- **123 → 124**: 124's CI runs 123's drift test (via `pnpm test`). Land 123
  before, or in the same wave as, 124. 124's _new_ CI content (the worker job) is
  itself independent of 123.
- One unit per session per the CLAUDE.md workflow; three branches, three PRs.

## Autonomy assessment

"Run autonomously" = implement to **local-green** (`pnpm lint && typecheck &&
test`, + `pnpm build` where relevant), producing a branch/diff ready for a manual
PR. It does **not** include merging — merges and `git push` to `main` are
laptop-only (CLAUDE.md), and PRs are opened manually in the browser.

| Step                             | Autonomous? | Confidence | Notes                                                  |
| -------------------------------- | ----------- | ---------- | ------------------------------------------------------ |
| 122 implement                    | ✅ fully    | ~90%       | `tsc` proves no import missed; risk is only diff size. |
| 123 test + gen-script + resync   | ✅ fully    | ~85%       | Drift test + byte-copy resync need no DB.              |
| 123 live `pnpm db:types` confirm | ❌ operator | —          | Needs a linked `supabase login` session.               |
| 124 worker CI job + policy doc   | ✅ fully    | ~90%       | Worker tests are secret-free.                          |
| 124 `db:test` CI (Tier C)        | ❌ operator | —          | Needs GitHub Actions secrets.                          |
| ADR 0047 / 0048 acceptance       | ❌ operator | —          | Architectural sign-off.                                |
| Merge / push / open PR           | ❌ operator | —          | Laptop-only per CLAUDE.md.                             |

### What blocks fully-hands-off completion (operator-only)

1. **Merges + push to `main`** — laptop-only. I stop at ready-for-PR.
2. **ADR 0047 & 0048 acceptance** — flip Proposed → Accepted.
3. **GitHub Actions secrets** (`SUPABASE_ACCESS_TOKEN`) — for the Tier C
   `db:test` CI job; until then it stays disabled and CI is unaffected.
4. **Live `pnpm db:types`** against the linked project — confirms the dual-write
   genuinely matches the live schema (the resync + guard already make the test
   green without it).

### What I can run end-to-end without further input (on greenlight)

- Spec 122 in full → local-green.
- Spec 123 (drift test + `gen-db-types.ts` + worker-copy resync) → local-green.
- Spec 124's worker CI job + the `workflow_dispatch` stub + policy doc.

All three land as branches with green `lint`/`typecheck`/`test` (+ `build` for
122), ready for the operator to PR and merge.

## Estimate

~5–8 h of active work total; at one-unit-per-session cadence with operator review

- laptop merge between units, ~3 sessions / end-of-week elapsed. These compete
  with the feature queue (spec 116 = PO UI, etc.) — operator picks priority.
