---
name: bug-fix-flow
description: The autonomous bug-fix pipeline (redesigned 2026-06-26). Use when handling reported bugs end-to-end — discover → triage → fix → ship → reply → mark complete — driving each report as far as possible WITHOUT the operator, and flagging them only at genuine human-decision points. Invoke when the operator says "fix the bugs", "work the bug queue", "run the bug-fix flow", during the scheduled daily run, or any time you're closing out reported bugs. Builds on [[triage-feedback]] for the queue/message/status SQL mechanics; this skill is the orchestration, the autonomous lanes, the flag-points, and the digest.
---

# Autonomous bug-fix flow

A report goes from filed → fixed → closed with you (CC) driving the whole pipeline. Stop only at
the genuine human-decision points (§ Flag the operator). The operator's standing mandate
(2026-06-26): **do as much as possible autonomously until you can flag the bug complete; wait for
me only when you really need me, and be clear when you do.**

This skill orchestrates; [[triage-feedback]] holds the SQL mechanics (queue query, untrusted-input
boundary, ground-truth rule, status updates, the tiered reply: auto-publish low-risk vs. stage a
draft). Read it for the per-step commands. Run everything from the repo root with Node on PATH
(see [[cloud-pc-quirks]]).

## The pipeline (per report)

1. **Discover & triage** 🤖 — pull `status in ('open','in_progress')`. For each, set status →
   `in_progress` immediately (off `ใหม่`). Investigate against REAL code: locate the surface via
   `page_path`/`screen`/`role_snapshot`, read it, trace RLS/RPC, reproduce. Fetch attached
   screenshots and actually look at them (Storage REST trick in [[cloud-pc-quirks]]). Classify:
   - **fixable bug** (cause found, fix is code-only or _additive_ DB, confident) → Fix lane.
   - **needs reporter info** (can't reproduce) → reply a clarifying question (low-risk auto-publish).
   - **product / UX judgment** (redesign, ambiguous intent, trade-off) → **flag** (§ below).
   - **feature request** → acknowledge (low-risk auto-publish, NO promise); build only if trivially
     in-scope, else log + flag for a spec.
   - **already fixed** (a later commit) → reply saying so (low-risk), status → `done`.
2. **Fix lane** 🤖 — the quality bar is non-negotiable:
   - **TDD**: failing test FIRST (state "Writing failing test first"), then make it pass.
   - **Fix the whole CLASS, not one instance** + add a regression guard. If a bug exists on one
     surface, find its siblings and the systemic root, fix once, and leave a test that fails if it
     regresses (precedent: the horizontal-overflow sweep — [[prc-ops-overflow-containment]]).
   - **Verify**: `pnpm lint && pnpm typecheck && pnpm test` all green; for anything observable,
     confirm in a real browser (preview at a phone width), not just unit tests.
   - **Ship**: commit (Conventional Commits) → ff-merge `main` → `git push origin main` (auto-deploys).
3. **Reply** 🤖 — tiered (see [[triage-feedback]] §3): low-risk factual reply → auto-publish;
   anything that declines / commits / is uncertain / sensitive → stage a draft + flag.
   **Auto-publish is irreversible** (`feedback_messages` is append-only) and the operator may
   publish in-app at the same time — so re-query the thread immediately before posting and SKIP if
   a reply already exists, else you double-post (it happened on the inaugural run).
4. **Complete** 🤖 — status → `done` once the fix is shipped (+ reply handled per the tier).
5. **Report** 🤖 — digest (§ below): ✅ per completed bug, 🔔 per flagged one.

## Flag the operator — ONLY these, and be CRISP

Stop and flag (do NOT proceed) when:

- **Product / UX judgment** — a redesign, ambiguous intent, or a real trade-off. (You may still
  ship a safe defensive fix, but the design call is theirs.)
- **Destructive / irreversible** — a destructive migration (DROP / destructive ALTER / mass
  DELETE / TRUNCATE), a DB-role change, an append-only bypass (`audit_log`/`photo_logs`), or a
  worker/Railway redeploy. Read break-glass / change-management; flag BEFORE applying. (Additive
  migrations + code ship autonomously.)
- **Scope explosion** — the fix reveals a much larger problem or a missing requirement. Stop,
  surface, write a follow-up spec (CLAUDE.md scope discipline) — do not silently expand.
- **External blocker** — needs a secret, a third-party action, or something only you can do.
- **Low confidence** — you can't confirm the root cause or the fix's correctness. State a
  confidence %.
- **A reply that isn't low-risk** — declines, commits/promises, is uncertain, or is sensitive →
  stage the draft, flag, let the operator publish.

**How to flag** (Telegram — see [[telegram-progress-updates]]; 🔔 = needs-you). One message per
flagged bug, with exactly: `🔔 <bug title>` · what it is (1 line) · why I need you · **my
recommendation + the options** · confidence %. Never flag without a recommendation. Set status to
`in_progress` (not `done`) on a flagged report.

## The digest (close of a pass / scheduled run)

Telegram the operator one digest:

- **✅ Completed** — per bug: title, what shipped, commit hash, whether a reply was auto-published.
- **🔔 Needs you** — per flagged bug: the one-line ask + recommendation (link to `/feedback/<id>`
  for staged drafts to approve).
- **Staged drafts awaiting publish** — the non-low-risk replies you left for approval.

When the operator is mid-conversation (present), report inline instead of Telegram.

## Cadence

Runs **scheduled daily** + on demand (operator chose 2026-06-26). The scheduled run executes this
whole pipeline unattended and sends the digest. Pushes auto-deploy, so the Fix-lane verification
bar (tests green + real-browser check) is the safety gate — never ship red. On-demand: the
operator says "fix the bugs" / "run the bug-fix flow" and you drive the same pipeline in-session.

## What stays the operator's (never autonomous)

- Publishing/discarding a NON-low-risk reply draft (declines / commitments / uncertain / sensitive).
- Any destructive/irreversible DB or infra change.
- Product/UX design decisions.
- Promoting a feature request into built scope without a spec.
