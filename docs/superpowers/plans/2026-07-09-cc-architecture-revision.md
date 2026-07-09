# CC operating-architecture revision — design (2026-07-09)

Meta-work. Origin: operator feedback, spec-284-U5 session 2026-07-09. Two goals:
(1) fit the operator's style (reporting format + Telegram timing), (2) make CC
quality model-independent (push cleverness into architecture: hooks, skills,
CLAUDE.md doctrine, gates).

## Operator feedback (verbatim, from the 2026-07-09 handoff prompt)

> 1a. Reporting: format reports for USE, not dumped. Separate "FYI / what happened"
> (short prose) from "for you to act on." Lead every report with status + the
> single next action (if any). Anything copy-pasted — handoff prompts, commands,
> PR titles, IDs, URLs — in its own fenced, SELF-CONTAINED code block (no prose
> to trim, no hand-editing). Kill the wall-of-bold; caveman = terse words, not
> decoration.
>
> 1b. Telegram: TG is the ASYNC channel for when the operator is AWAY. Do NOT push TG
> while the operator is live in-session (duplicate noise). 🔔 only for a real
> decision/blocker they might miss; ✅ only for a done-milestone reached
> unattended. Define + encode a crisp "attended vs unattended" heuristic.
> [telegram-progress-updates] currently pushes at every phase boundary — too
> chatty when attended.
>
> 2. Make CC behave like a clever model (Fable-5-class) even when the underlying
>    model is weaker. Push cleverness INTO the architecture so it's model-independent:
>    deterministic hooks, procedure-carrying skills, tight CLAUDE.md doctrine,
>    verification/self-review gates, subagent review. Codify what the U5 session did
>    well as ENFORCED defaults a weaker model can't skip: gate-check a dependency
>    before building on it; TDD failing-test-first; real-browser verify the actual
>    flow; merge-tree conflict probe before claiming "clean"; LANES single-writer
>    discipline.

## Current state (surveyed)

- CI already model-independent where it counts: lint/typecheck/test + secret-scan +
  danger-path guard + build-failing doctrine tests (design tokens, nav-back,
  ui-class, touch-action).
- One hook: `protect-audit-log.js` — good logic, but repo settings.json invokes it
  with a RELATIVE path (fails open on cwd change) and wrapper-launched sessions
  (`D:\claude\projects\prc-ops`) load neither hook nor allowlist
  (cc-config-audit HIGH#2, empirically confirmed, still open).
- CLAUDE.md: stale (roles enum says 10, live is 17 incl. `legal`; "40 ADRs through
  0043" vs 80+; CI description contradicts itself L93 vs L133) and contradicts the
  standing autonomy grant ("Stop. Do not start the next unit"; "wait for explicit
  acknowledgement"). Churny status content in a durable file = the root cause
  (audit finding).
- telegram-progress-updates.md: mandates a push at EVERY phase boundary + TG resume
  briefing before work — correct for unattended, noise when attended. No
  attended/unattended distinction anywhere.
- The U5-session wins live only in prose/habit (memory topics), skippable by a
  weaker model. `git merge-tree --write-tree` works (git 2.54). LANES claim is
  convention-only. Browser-verify recipe lives in memory only.
- ship-pr.sh: pushes branch + opens PR + auto-merge; no conflict probe.

## Design decisions

**D1 — Where doctrine lives.** Behavior doctrine (reporting format, TG timing) goes
in MEMORY (feedback topic files + index hooks): loads every session, local, no PR,
operator-amendable by talking. CLAUDE.md carries only repo-process doctrine.
Output-style swap DECLINED: caveman plugin already handles terseness; goal 1a is
STRUCTURE, not verbosity — a custom output style would fight the caveman hooks and
adds a cross-cutting surface for marginal gain.

**D2 — Attended/unattended heuristic (goal 1b).**
ATTENDED = the current turn responds to a message the operator just typed, or the
operator has sent anything within ~30 min while the session works. UNATTENDED =
scheduled/cron runs; an explicit "run unattended / going away"; or >30 min of
autonomous work since the operator's last message. Transition rule: a milestone or
blocker reached while UNATTENDED → push TG; while ATTENDED → report in-chat only.
🔔 only for decision/blocker that stalls work (any attendance state — but if
attended, ask in-chat and only TG if no reply in ~10 min). ✅ only for milestone
completed unattended. 📋 phase-plan and 5-point resume briefing: in-chat when
attended; TG only when starting/continuing a run the operator won't watch.
Phase-boundary pushes: KILLED when attended; unattended runs keep milestone ✅.

**D3 — Enforcement tiers (goal 2).** Deterministic where mechanically checkable,
procedure-carrying skill where judgment is needed, CLAUDE.md doctrine as the
binding prose SSOT:

- merge-tree probe → CODE (ship-pr.sh refuses conflicted PR; override env).
- LANES claim → HOOK (block migration writes unless current branch appears in
  LANES.md; fail-open on infra errors; override env; mirrors protect-audit-log).
  Edge: branch `main` would substring-match "origin/main" everywhere → migrations
  on `main` are hard-blocked instead (schema work belongs in a worktree branch —
  enforces worktree discipline too). Name-match applies to feature branches only.
- hook reliability → repo settings.json uses `$CLAUDE_PROJECT_DIR` absolute form;
  wrapper settings.json wires the same hooks absolute (closes HIGH#2).
- dependency gate-check, TDD RED-first, real-browser verify, self-review →
  SKILL `ship-unit` (repo, procedure-carrying checklist a weak model executes
  step-by-step) + CLAUDE.md "Unit gates" section (binding prose).
- TDD "can't skip": full determinism impossible without heavy tooling; enforced
  via ship-unit checklist + existing CLAUDE.md rule + review rejection. Accepted.

**D4 — One held PR.** All repo-file changes (ship-pr.sh, hooks, settings.json,
CLAUDE.md, ship-unit skill) ship as ONE PR via ship-pr.sh → danger-path guard holds
it → operator merge = the confirmation the prompt requires for cross-cutting
changes. Local surfaces (memory, wrapper settings, user settings) apply now.

## Ranked changes (what / why / surface / risk)

| #   | What                                                                                                                                                         | Why                                               | Surface                                                                                     | Risk                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| R1  | TG attended/unattended doctrine (D2)                                                                                                                         | kills duplicate noise; 1b verbatim                | memory: telegram-progress-updates.md + MEMORY.md resume line + autonomy-grant briefing para | under-notify; mitigated by transition rule + 🔔 fallback                                                       |
| R2  | Report-format doctrine (1a verbatim)                                                                                                                         | reports formatted for USE                         | new memory report-format-for-use.md + index line                                            | none                                                                                                           |
| R3  | Wire hooks absolute + wrapper hooks (HIGH#2)                                                                                                                 | hook currently fails open outside repo cwd        | repo settings.json (PR) + wrapper .claude/settings.json (local)                             | none; fail-open preserved                                                                                      |
| R4  | merge-tree probe in ship-pr.sh                                                                                                                               | "clean" claim becomes mechanical                  | scripts/ship-pr.sh (PR)                                                                     | blocks legit ship if origin/main moved w/ conflict — that's the point; override env SHIP_SKIP_CONFLICT_PROBE=1 |
| R5  | require-lane-claim hook (migrations blocked w/o LANES claim)                                                                                                 | single-writer discipline enforced, not remembered | new .claude/hooks/require-lane-claim.js + settings wiring (PR + wrapper local)              | false block in odd worktree states → fail-open + override env                                                  |
| R6  | CLAUDE.md refresh: de-stale + "Unit gates" section + reconcile autonomy grant                                                                                | tight doctrine a weak model reads first           | CLAUDE.md (PR, governance danger-path)                                                      | operator review burden; stale-pointer strategy (point at SSOTs, not counts) prevents recurrence                |
| R7  | ship-unit skill: claim lane → gate-check deps → RED test → build → verify (incl. real-browser) → self-review → ship-pr → release lane → update memory/report | procedure-carrying; encodes U5 wins as steps      | .claude/skills/ship-unit/SKILL.md (PR)                                                      | drift vs CLAUDE.md — skill points at CLAUDE.md gates, doesn't restate                                          |
| R8  | deny-read secrets: ../.github.env + .telegram.env (tg-send.ps1 + ship-pr.sh read them, model needn't)                                                        | unattended autonomy + zero secret reads           | user settings.json deny (local)                                                             | breaks flows that read tokens directly → verify tg-send.ps1 self-contained first                               |

Declined: output-style swap (D1) · blanket `.env*` deny (dev-preview login reads
.env.local) · TDD PreToolUse hook (heuristic, high false-block; checklist instead).

## Success criteria

- Attended session: zero TG pushes unless a blocker waits >10 min.
- Unattended run: 📋 at start, ✅ per milestone, 🔔 only at real gates (unchanged).
- A conflicted branch cannot open a PR without the override env.
- A migration file cannot be written unless LANES.md names the current branch.
- Wrapper-launched session: audit-log hook + lane hook both fire (test empirically).
- CLAUDE.md contains no live-state counts that rot (roles/ADR numbers → pointers).

# CC Operating-Architecture Revision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode the operator's reporting/Telegram doctrine in memory, and make CC session quality model-independent via deterministic hooks, a conflict probe in ship-pr.sh, a procedure-carrying ship-unit skill, and a de-staled CLAUDE.md.

**Architecture:** Local surfaces (memory, wrapper/user settings) apply immediately; all repo files ship as ONE danger-path PR (operator merge = confirmation). Hooks mirror protect-audit-log.js conventions: CommonJS, fail-open, env override, exit 2 to block.

**Tech Stack:** Node CommonJS hooks, bash (ship-pr.sh), CC settings.json hook wiring, markdown skills/memory.

## Global Constraints

- Repo: `D:\claude\projects\prc-ops\prc-ops`; wrapper root `D:\claude\projects\prc-ops`; work in a worktree, never the main dir (CLAUDE.md "Parallel sessions").
- All repo changes in ONE branch/PR via `scripts/ship-pr.sh` (danger-path guard will HOLD — expected, by design).
- Hooks MUST fail open on any unexpected error (never block unrelated work) and support an env override.
- Memory files: UTF-8 via Write/Edit tools only (PowerShell corrupts Thai).
- No secrets in any committed file.
- CI must stay green: `pnpm lint && pnpm typecheck && pnpm test` before ship.
- Operator feedback text (design doc §verbatim) must be carried verbatim into the memory captures.

---

### Task 1: Memory — report-format doctrine (R2, local)

**Files:**

- Create: `C:\Users\PresIn01\.claude\projects\D--claude-projects-prc-ops\memory\report-format-for-use.md`
- Modify: `...memory\MEMORY.md` (add index line under "Working with the operator")

**Steps:**

- [ ] Write topic file: frontmatter type `feedback`; verbatim 1a feedback; **Why**; **How to apply** = report skeleton (STATUS line → NEXT ACTION → "for you" fenced blocks → short FYI prose; no wall-of-bold; every copy-paste artifact self-contained in its own fence).
- [ ] Add MEMORY.md index line: `- [Report format: for USE](report-format-for-use.md) — lead status + single next action; act-on vs FYI split; copy-paste always fenced self-contained; kill wall-of-bold`.
- [ ] Verify MEMORY.md still < 17.1KB (`wc -c`).

### Task 2: Memory — Telegram attended/unattended doctrine (R1, local)

**Files:**

- Modify: `...memory\telegram-progress-updates.md` (rewrite How-to-apply with D2 heuristic; keep icon set + creds + script)
- Modify: `...memory\MEMORY.md` (index line + RESUME PROTOCOL line)
- Modify: `...memory\autonomy-grant-backlog-execution.md` (RESUME BRIEFING para: in-chat when attended, TG when unattended)

**Steps:**

- [ ] Rewrite telegram topic: verbatim 1b feedback; ATTENDED/UNATTENDED definitions (design D2: operator message this turn or <30 min ago = attended; scheduled runs / explicit going-away / >30 min silent = unattended); rules (attended → in-chat only; unattended milestone → ✅; decision/blocker → in-chat first, TG 🔔 if no reply ~10 min or unattended; 📋/briefing in-chat when attended); dated 2026-07-09, supersedes every-phase-boundary convention.
- [ ] MEMORY.md: index line → `— ASYNC channel for AWAY operator; attended→in-chat, no TG; 🔔 real gates · ✅ unattended milestones; creds .telegram.env`; RESUME PROTOCOL → briefing in-chat when attended, TG when unattended.
- [ ] autonomy-grant: amend briefing para to reference the heuristic (do not delete history; append dated refinement).
- [ ] Verify size + no dangling links (link-check loop from Step 0).

### Task 3: Worktree + branch for the repo PR

**Steps:**

- [ ] `cd D:\claude\projects\prc-ops\prc-ops && git fetch origin && git worktree add ../prc-ops-ccarch -b cc-arch-revision origin/main`
- [ ] Append lane claim to `D:\claude\projects\prc-ops\LANES.md` (Edit tool): CODE-only lane, files = `.claude/**`, `scripts/ship-pr.sh`, `CLAUDE.md`, `docs/superpowers/plans/**`; no schema. Re-read to confirm.
- [ ] Copy `.temp` + `pnpm install` if needed for lint/test (cloud-pc quirk).

### Task 4: Hook — require-lane-claim.js (R5)

**Files:**

- Create: `.claude/hooks/require-lane-claim.js`
- Test: manual stdin harness (hooks aren't in vitest scope)

**Interfaces:**

- Consumes: PreToolUse JSON on stdin (`tool_input.file_path`), `.git` HEAD via `git rev-parse --abbrev-ref HEAD` (cwd), `../LANES.md` relative to repo root (`git rev-parse --show-toplevel`), env `CLAUDE_ALLOW_UNCLAIMED_MIGRATION`.
- Produces: exit 0 allow / exit 2 block with instruction message.

**Logic (complete):** path matches `/supabase\/migrations\//` → if override env set → allow. Resolve branch; branch === `main` → BLOCK ("schema work on main is forbidden — use a worktree branch; see CLAUDE.md Parallel sessions"). Else read `<toplevel>/../LANES.md`; if file unreadable → allow (fail open). If content does NOT include branch name → BLOCK ("append your lane claim naming branch '<branch>' to ../LANES.md, re-read it, then retry; see safe-parallel-sessions"). All unexpected errors → exit 0.

- [ ] Write hook (mirror protect-audit-log.js style, sync `child_process.execSync` for branch with try/catch → fail open).
- [ ] Test RED/GREEN manually: `echo '{"tool_input":{"file_path":"supabase/migrations/x.sql"}}' | node .claude/hooks/require-lane-claim.js` on branch cc-arch-revision (claimed → exit 0; then with a bogus branch name test via env-faked... instead: temporarily test on branch not in LANES → expect exit 2). Verify non-migration path → exit 0; `CLAUDE_ALLOW_UNCLAIMED_MIGRATION=1` → exit 0.
- [ ] Commit `feat(cc): require-lane-claim hook`.

### Task 5: Hook wiring absolute + wrapper (R3, HIGH#2)

**Files:**

- Modify: repo `.claude/settings.json` — hook commands → `node "$CLAUDE_PROJECT_DIR/.claude/hooks/protect-audit-log.js"` + add require-lane-claim entry (same matcher Write|Edit).
- Modify (LOCAL, not in PR): `D:\claude\projects\prc-ops\.claude\settings.json` — add same PreToolUse hooks with ABSOLUTE `D:\claude\projects\prc-ops\prc-ops\.claude\hooks\...` paths.

**Steps:**

- [ ] Edit repo settings.json (both hooks, $CLAUDE_PROJECT_DIR form).
- [ ] Edit wrapper settings.json (absolute paths; keep existing allowlist).
- [ ] Empirical check: from wrapper cwd, `echo '{"tool_input":{"file_path":"D:/x/supabase/migrations/20990101000000_audit_log_test.sql"}}' | node "D:\claude\projects\prc-ops\prc-ops\.claude\hooks\protect-audit-log.js"` → expect exit 2.
- [ ] Commit repo half `fix(cc): absolute hook paths — close wrapper fail-open gap`.

### Task 6: ship-pr.sh merge-tree probe (R4)

**Files:**

- Modify: `scripts/ship-pr.sh` (insert after branch check, before push)

**Code:**

```bash
# Conflict probe (2026-07-09): a PR must prove it merges clean before claiming it.
# git merge-tree --write-tree exits 1 + prints conflicted paths on conflict.
if [ -z "${SHIP_SKIP_CONFLICT_PROBE:-}" ]; then
  git fetch origin main --quiet
  if ! git merge-tree --write-tree FETCH_HEAD HEAD >/dev/null 2>&1; then
    echo "CONFLICT vs origin/main — rebase first (git rebase FETCH_HEAD), or set SHIP_SKIP_CONFLICT_PROBE=1 to override:" >&2
    git merge-tree --write-tree --no-messages FETCH_HEAD HEAD 2>/dev/null | tail -n +2 >&2 || true
    exit 1
  fi
fi
```

- [ ] Apply; `bash -n scripts/ship-pr.sh` (syntax).
- [ ] GREEN test: on the clean branch, run probe block standalone → exit 0. RED test: `git merge-tree --write-tree <old-conflicting-shas>` known-conflict pair if cheap, else assert exit-1 semantics via `git merge-tree --write-tree HEAD~1 HEAD` variants — if impractical, document manual verification.
- [ ] Commit `feat(cc): merge-tree conflict probe in ship gate`.

### Task 7: ship-unit skill (R7)

**Files:**

- Create: `.claude/skills/ship-unit/SKILL.md`

**Content outline (write full):** trigger = building/shipping any feature unit. Ordered gates, each with the exact command/recipe: (0) read LANES whole-file + `git status`; claim lane; (1) **dependency gate-check** — before building ON anything (RPC, table, component, route), read its LIVE form (live schema via `pnpm exec supabase db query`, source file, spec) and confirm the contract; (2) TDD RED first (state "Writing failing test first", run, show FAIL); (3) build minimal; (4) verify: lint+typecheck+test (+pgTAP if schema) AND **real-browser verify the actual flow** via dev-preview login recipe (inline the magiclink→ssr-cookie steps from memory so the skill is self-contained); (5) self-review: dispatch reviewer subagent (cavecrew-reviewer / code-review) and address findings; (6) ship via `scripts/ship-pr.sh` (probe enforces clean-merge); (7) release lane in LANES.md + update memory ▶ NEXT UP; (8) report per report-format doctrine.

- [ ] Write SKILL.md; lint by reading once for contradictions with CLAUDE.md (skill POINTS at CLAUDE.md rules rather than restating where possible).
- [ ] Commit `feat(cc): ship-unit procedure skill`.

### Task 8: CLAUDE.md refresh (R6)

**Files:**

- Modify: `CLAUDE.md`

**Changes (complete list):**

1. Roles section → delete hardcoded 10-role list + per-role status; replace with: enum SSOT = `user_role` in live DB + `src/lib/auth/role-home.ts` (routes) + role-set constants; "do not add/remove enum values without an ADR" stays.
2. ADR count sentence → "the full current list is docs/decisions/README.md" (no number).
3. CI description (L133 area) → real list: lint/typecheck/test + secret-scan + danger-path guard; e2e/db:test/spikes still local.
4. "Feature workflow" step 7 "Stop. Do not start the next unit" → point at the standing autonomy grant (memory `autonomy-grant-backlog-execution`): under the grant, continue units unattended; stop only at grant gates.
5. "When blocked … wait" → keep for judgment blockers, add "under the autonomy grant, exhaust self-service diagnosis first; 🔔 Telegram when truly operator-gated".
6. NEW "## Unit gates (binding)" section: dependency gate-check before building on it; TDD RED-first; real-browser verify the actual flow before claiming done; merge-tree probe (ship-pr.sh enforces); LANES single-writer + whole-file read; skill pointer `.claude/skills/ship-unit`.
7. "Skills…installed:" line → add ship-unit; hooks line → add require-lane-claim.js.

- [ ] Apply edits; re-read diff for stale-count regressions (no live numbers anywhere new).
- [ ] Commit `docs(cc): de-stale CLAUDE.md + binding unit gates`.

### Task 9: Ship the PR + local finishers

- [ ] Copy plan+design docs into `docs/superpowers/plans/2026-07-09-cc-architecture-revision.md` (single combined doc), commit.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` in worktree → all green.
- [ ] `scripts/ship-pr.sh "chore(cc): operating-architecture revision — hooks, ship gate probe, ship-unit skill, CLAUDE.md"` with body = ranked R-table + verification evidence. Danger-path guard HOLDS → operator merge = approval.
- [ ] LANES.md: update lane entry → PR OPEN, operator-HELD.
- [ ] R8 (user settings deny): verify `tg-send.ps1` reads env itself; then add user settings.json `permissions.deny`: `Read(D:\claude\projects\prc-ops\.telegram.env)`, `Read(D:\claude\projects\prc-ops\.github.env)`. Skip if tg-send.ps1 not self-contained.
- [ ] Update memory: cc-config-audit line (HIGH#1 ✅ / HIGH#2 ✅-pending-PR), ▶ NEXT UP, new [[cc-architecture-revision-2026-07-09]] topic if warranted (fold into existing files if not).

## Self-Review

- Spec coverage: R1→T2, R2→T1, R3→T5, R4→T6, R5→T4, R6→T8, R7→T7, R8→T9. Declined items documented in design. ✓
- Placeholders: none — hook logic, probe code, CLAUDE.md change list are concrete. ✓
- Consistency: override env names `CLAUDE_ALLOW_UNCLAIMED_MIGRATION` / `SHIP_SKIP_CONFLICT_PROBE` used consistently; hook file name `require-lane-claim.js` consistent across T4/T5/T8. ✓
