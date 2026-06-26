# Policy: Database & Infrastructure Change Management

**Status:** Adopted — 2026-06-07. Binding.
**Applies to:** the live Supabase project (Postgres schema, data, Storage
buckets, DB roles) and any other shared production state.
**Why this exists:** three confirmed changes reached the live pilot DB
_outside_ the git + CLI flow — the `deliverables` schema was `db push`ed
from a branch never committed to git; go-live §1 test data was left
unpurged; the `photos` Storage bucket was flipped `public=true` in the
dashboard against its migration. Each cost real time to detect and
recover. The repo claims "git is the source of truth" — this policy is
what makes that true in practice.

## 1. The rule

**All changes to schema, data, Storage buckets, and DB roles go through a
migration, on a reviewed branch, applied with `supabase db push`.** Not
the dashboard SQL editor, not dashboard toggles, not ad-hoc `psql`.

- One change → one timestamped migration under `supabase/migrations/`.
- Reviewed before it reaches prod: **destructive** migrations via operator
  PR + merge; **additive** migrations the agent self-reviews against green
  pgTAP and ships per the 2026-06-25 standing grant (tiers below).
- `supabase db pull` is not a substitute for committing the migration —
  the migration file is the artifact of record.

**Who runs `db push`.** Two tiers by migration class:

- **Additive / non-destructive** (new tables, columns, RPCs, policies,
  grants — anything _not_ in `break-glass.md` Procedure B): the agent
  (Claude Code) ships end-to-end once its pgTAP is green — commit, ff-merge
  to `main`, `git push origin main`, `supabase db push`, then verify
  post-apply (`db:test` / targeted check) and report. No per-task confirm
  (operator standing grant, 2026-06-25).
- **Destructive / irreversible** (DROP, destructive ALTER incl. column-type
  change, mass DELETE, TRUNCATE — `break-glass.md` Procedure B):
  operator-gated. The operator owns the merge and `git push` and runs the
  three break-glass floors; the agent may `db push` only an already-merged
  migration, then verifies and reports.

The agent never mutates prod via the dashboard SQL editor, and emergency /
out-of-band changes remain operator-only with an `audit_log` row. Routine
(non-schema) code follows CLAUDE.md's standing auto-commit-and-merge grant.

**The dashboard SQL editor is read-only / diagnostics only.** Use it to
inspect, audit, and verify — never to mutate shared state.

**Emergencies are the only exception.** If prod must be changed before a
migration can ship (incident, data hotfix), the operator may act
directly, but the action **must write an `audit_log` row** describing
what was done and why, and a fix-forward migration must follow. The
go-live §1 test-data cleanup is the exemplar: triggers were disabled in a
single guarded transaction and an `audit_log` row
(`action='other'`, payload describing the maintenance) recorded the
event (`56a4d80e-…`, 2026-06-07).

## 2. Who can do what (least privilege)

- **Supabase team membership is minimal.** Only people who need write
  access to prod have it; everyone else is read-only or has no dashboard
  access. Review membership when the team changes.
- **The service-role key and DB password are tracked** — known list of
  where each lives (Vercel env, Railway worker env, any local
  `.env.local`, the linked CLI). If the distribution is unknown or a key
  may have leaked, **rotate it** (coordinating the Vercel + Railway +
  worker updates that a service-role rotation requires).
- **No new DB principals without an ADR.** A non-platform DB role (e.g.
  the planned `appsheet` role) is an architecture decision — see the
  least-privilege requirements in its ADR.

## 3. Detection

Drift is cheap to catch and expensive to discover by accident. Run, on a
schedule (e.g. weekly) or before any migration work:

```
supabase db push --dry-run --linked
```

If it reports anything other than **"Remote database is up to date"**,
git and the live DB have diverged — investigate before doing anything
else. (This is exactly how the `deliverables` drift surfaced.) For
object-level drift the dry-run can't see — a hand-created table, a
flipped bucket flag, a redefined function — a periodic schema
introspection (table/function/policy/bucket inventory + SECURITY DEFINER
function-body and bucket-flag checks) against the union of committed
migrations is the backstop. No new tooling required; both are existing
commands / read-only queries.

## 4. Remediation pattern (when drift is found)

The response is **not** `migration repair --reverted` (that falsifies the
history table while the objects persist). It is:

1. **Recover the truth.** For CLI-applied migrations, the exact SQL is in
   `supabase_migrations.schema_migrations.statements` (verbatim — better
   than `db pull`, which only reconstructs a diff and needs Docker, which
   this project does not use per ADR 0006).
2. **Commit it on a `chore/` branch** as the recovery migration, plus an
   **as-built ADR** documenting what shipped and when, so the decision
   record isn't lost.
3. **PR + merge** so git realigns with prod, and `db push --dry-run`
   returns to "up to date."

The `deliverables` recovery is the exemplar: migrations
`20260531000000` / `20260531000100` were recovered verbatim, documented
as as-built ADR 0016 / spec 04, and landed on
`chore/recover-migration-drift`.

## 5. Known follow-ups this policy retroactively gates

These predate the policy and must be brought into compliance:

- **Photos-bucket re-assertion.** Live `photos.public=true` vs migration
  `public=false`. Fix is a migration re-asserting `public=false`, not a
  dashboard toggle. Re-drift after that is evidence of continued
  out-of-band access. (Addressed in this same change.)
- **Appsheet role unit.** Must create the role via migration with
  least-privilege per-table grants (never `audit_log` / `users`), the
  password set out-of-band as a logged exception, and its own ADR (0018).
- **`REVOKE UPDATE ON public.users FROM authenticated`.** Supabase grants
  this by default; today the escalation block is RLS alone. A hardening
  migration restores defense-in-depth and makes the "no user-write path"
  stance literally true.

## 6. Adoption

This file is binding on merge. A pointer in `CLAUDE.md` (alongside the
ADR reference) gives it the same "read before acting" status as the
decision log.
