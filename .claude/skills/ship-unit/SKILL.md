---
name: ship-unit
description: The gated unit loop for building and shipping ANY feature unit in this repo — claim a lane, gate-check every dependency against its LIVE form, TDD RED-first, verify in a real browser, self-review with a fresh reviewer, ship through scripts/ship-pr.sh, release the lane, report. Use whenever implementing a spec unit, a fix, or any change that ends in a PR. The gates are ordered and none may be skipped; each gate names its exact command. Encodes the session discipline the operator mandated 2026-07-09 ("enforced defaults a weaker model can't skip").
---

# Ship a unit — the gated loop

Every unit walks these gates IN ORDER. A gate is either satisfied with evidence
(command output you actually ran) or the unit stops there. Do not narrate a gate
as done without its evidence. CLAUDE.md rules override anything here.

## Gate 0 — Orient + claim the lane

1. Read the WHOLE `../LANES.md` (relative to the repo root) — it has BOTH prepend
   and append conventions; a bottom entry bit a session once (spec-286 collision).
   Confirm: no active lane on your files; schema lane free if you need it.
2. `git status` — stop if the target dir is dirty with someone else's work.
3. Work in a worktree, never the main dir:
   `git worktree add ../prc-ops-<lane> -b <branch> origin/main`
   (then copy `.temp` + `pnpm install` — cloud-PC quirk).
4. APPEND your lane claim to `../LANES.md` (Edit tool only — PowerShell corrupts
   Thai): branch name, files touched, schema migration number if claimed. RE-READ
   to confirm it landed. The `require-lane-claim` hook blocks migration writes on
   any branch not named in LANES.md — the claim is not optional.
5. If schema: also check live `supabase_migrations.schema_migrations` for
   DB-ahead migrations (`pnpm exec supabase db query --linked "select version from supabase_migrations.schema_migrations order by version desc limit 5"`)
   — git alone lies when another session already pushed.

## Gate 1 — Dependency gate-check (before building ON anything)

For EVERY artifact this unit builds on — an RPC, a table, a component, a route, a
label constant, a spec assumption — read its LIVE form first and confirm the
contract you are about to rely on:

- DB object: source it from the LIVE database, not from a migration file
  (`pnpm exec supabase db query --linked "select pg_get_functiondef('public.<fn>'::regproc)"`;
  policies via `pg_policies`). Migration files can be stale or edited-after-apply.
- Code: Read the actual file at HEAD of YOUR branch (another lane may have moved it).
- Spec/ADR: read the numbered spec + the ADRs its area touches (CLAUDE.md rule).

State in one line per dependency what you verified (e.g. "approve_staff_registration
LIVE signature = ..., allowlist contains X — matches plan"). If a dependency does
NOT match the plan's assumption, STOP and re-plan before writing code.

## Gate 2 — TDD, RED first

State "Writing failing test first." Write the failing test (vitest, or pgTAP RED
for schema), RUN it, and show the failure output. Only then implement — minimal
code to green. No production code before its failing test exists and was seen to
fail. (CLAUDE.md project rule; restated here because it is the most-skipped gate.)

## Gate 3 — Verify, including the real browser

1. `pnpm lint && pnpm typecheck && pnpm test` — all green (full suite, not a subset).
2. Schema units: `pnpm db:push` then `pnpm db:types` then `pnpm db:test` — new file
   green, ZERO collateral (known pre-existing reds are 200/221 ONLY; anything else
   is yours).
3. **Real-flow verify the ACTUAL change** — not just tests. UI/route units: start
   the dev server on your worktree branch, sign in as the dev-preview user, and
   click through the user journey the unit changes (create → see → act). Recipe
   (memory `dev-preview-login`): generate a magiclink token via the auth admin
   API, then in `preview_eval` use `@supabase/ssr`
   `verifyOtp({type:'email', token_hash})` to mint the session cookies; navigate
   and drive the flow; require zero console errors. The dev server serves the
   CHECKED-OUT branch — confirm you're on yours. Units with NO browser surface
   (hooks, scripts, worker, schema-only, docs): execute the changed artifact
   end-to-end instead and show its real output (run the hook on crafted stdin,
   exercise the script's new branch, query the live DB object).
4. New/changed UI: run the guard suites locally before pushing
   (design-doctrine, nav-back-affordance, ui-class-contracts) — they fail CI otherwise.

## Gate 4 — Fresh-eyes review

Dispatch a reviewer subagent (cavecrew-reviewer, or /code-review for bigger diffs)
on the full diff. Address every finding or state why not. An adversarial pass has
caught real holes (hidden-bind, returns double-count) — it is not ceremony.

## Gate 5 — Ship through the gate

**COMMIT FIRST.** `ship-pr.sh` opens a PR for the CURRENT COMMIT — it does NOT
commit for you. `git add` without `git commit` → the branch pushes at its base sha
→ `gh pr create` fails "Validation Failed" (no commits between main and branch).
Always `git commit` (let the husky/lint-staged hook run) and confirm `git log -1`
is your change before calling ship-pr.sh.

`scripts/ship-pr.sh "<conventional-commit title>" "<body>"` — it pushes, opens the
PR, requests auto-merge, and REFUSES a branch that does not merge clean against
origin/main (merge-tree probe; do not bypass with SHIP_SKIP_CONFLICT_PROBE unless
the operator says so). Code-only + green CI auto-merges; danger-path holds for the
operator — that hold is BY DESIGN, never override without the standing grant
(memory `autonomous-build-fence`).

## Gate 6 — Release + record

1. Update `../LANES.md`: while the PR is open/held, annotate your entry; once
   MERGED, MOVE the whole block to `LANES.archive.md` (append there, delete
   here) and refresh the STATUS line (main HEAD + schema watermark) — LANES.md
   stays live-only. Remove the worktree + branch once merged.
2. Update memory: the spec's topic file (outcome + gotchas, one line in the index)
   - the ▶ NEXT UP line. Memory is single-writer — check no other session is live.
3. Report per memory `report-format-for-use`: STATUS line → single NEXT ACTION →
   fenced copy-paste artifacts → short FYI. Telegram only per memory
   `telegram-progress-updates` (attended → in-chat only).
