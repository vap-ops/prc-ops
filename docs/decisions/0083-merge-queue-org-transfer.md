# ADR 0083 — Serialize merges with GitHub merge queue (requires org transfer)

**Status:** Proposed (operator decision — repo transfer is an owner-console action)
**Date:** 2026-07-19
**Extends:** ADR 0081 (pgTAP required CI gate), autonomous-build fence (2026-06-26)

## 1. Problem — measured, not hypothetical

2026-07-19, one afternoon with 3–4 concurrent sessions:

- **6 pgTAP evictions.** The `pgtap-shared-db` concurrency group
  (`.github/workflows/ci.yml`, `cancel-in-progress: false`) serializes runs
  against the one shared DB, but GitHub holds only ONE pending slot per group —
  a newer pending run **evicts** the older one (conclusion `cancelled`). Three
  sessions relanding simultaneously produced eviction ping-pong; one docs-only
  PR (#649) took ~4 hours from open to merge.
- **Two DB-ahead windows.** A schema lane `db:push`es its migration, then
  builds its PR; until that PR merges, the live DB is ahead of every tree and
  pgTAP reds on EVERY branch (seen twice: spec 331's enforce-type trigger,
  spec 330 U3c's `075820`). Unrelated PRs pay the cost.
- **Stale merge-ref reruns.** `gh run rerun` reuses the run's original merge
  commit — after main is fixed, rerunning an old PR run still tests the stale
  tree. Manual workaround: `gh pr update-branch` per PR per fix.

Session-side politeness protocols (drain the queue, reland last) work but are
manual, per-session, and unenforced.

## 2. Constraint discovered during gate-check

GitHub's native merge queue is available only on **organization-owned**
repositories (free for public repos; private needs Enterprise Cloud). This
repo is owned by the personal user account `VAP-Solution` and is **public** —
merge queue is therefore unavailable as-is, and GitHub has stated no plan to
extend it to personal accounts.

## 3. Options

**A. Transfer the repo to a free GitHub organization, enable merge queue.**
Native, £0 (public repo), permanent. The queue builds an ordered merge-group
ref per candidate (always fresh — kills the stale-rerun class), runs required
checks on it (`merge_group` event), and merges FIFO — schema PRs land minutes
after green, collapsing the DB-ahead window from hours to minutes. Eviction
ping-pong disappears at the decision point (the queue is ordered; PR-branch
runs become advisory). Side benefit, independent of CI: **org ownership is a
bus-factor/G3 win** — business continuity, a 2nd owner/admin slot, org-level
rulesets, teams when hiring. Cost: a one-time migration checklist (§5).

**B. Homegrown queue discipline.** Encode drain-then-reland into
`scripts/ship-pr.sh` + retry loops. No platform change, but fragile (polling,
no ordering guarantee, every session must cooperate) and does nothing for the
DB-ahead window or stale reruns.

**C. Mergify (third-party queue).** Free for public repos, but grants an
external app write access to the repo — a supply-chain surface the fence was
built to avoid. Declined unless A is rejected.

**Recommendation: A.**

## 4. Design once on an org

- `ci.yml` gains `merge_group:` in `on:` — same jobs run for queued candidates;
  the `pgtap-shared-db` concurrency group stays global (one shared DB) so
  merge-group pgTAP runs serialize exactly like today, but ordered.
- Branch protection on `main` adds **Require merge queue**; the full required
  set carries over unchanged (lint/typecheck/test, secret scan, and the two
  ADR-0081 checks pgTAP + Build).
- Danger-path guard interplay unchanged: a deny-path PR fails the guard → never
  enters the queue → operator (or the standing-grant admin-merge) bypasses via
  the ruleset bypass list, exactly today's held-PR flow.
- `scripts/ship-pr.sh` unchanged in interface: it arms auto-merge via a
  GraphQL `enablePullRequestAutoMerge` mutation (not the `gh` CLI); on a
  queue-protected branch that same mutation enqueues instead. Migration step:
  verify with the canary PR that this path enqueues correctly.

## 5. Migration checklist (one-time, operator + one session)

1. Operator creates free org; transfers repo (GitHub redirects old URLs).
2. Re-scope the fine-grained PATs to the new owner: `RELEASE_TOKEN` +
   the pipeline PAT used for admin-merges.
3. Verify post-transfer (transfer preserves most settings; trust nothing
   silently): Actions secrets (`SUPABASE_ACCESS_TOKEN`, Telegram, …), branch
   protection, environments.
4. Re-link integrations to the new repo path: Vercel ×2 (`prc-ops`,
   `prc-ops-sandbox`), Railway worker (watch-paths), Supabase GitHub
   integration if linked.
5. Sessions update local remotes (`git remote set-url`) in main repo +
   worktrees; LANES note.
6. Enable merge queue; add `merge_group:` trigger PR; one canary PR through
   the queue before declaring done.

## 6. Consequences

- Each merge runs CI twice (PR ref + merge-group ref); pgTAP is batched
  (~5.5 min) — acceptable.
- Auto-merge semantics shift from "merge when green" to "enqueue when green";
  the fence's auto/held split is preserved by the guard + bypass list.
- Until A is executed, the interim rule stays: drain the pgTAP group before
  relanding, `gh pr update-branch` after any main fix.
