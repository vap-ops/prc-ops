# Spec 201 — Feedback two-way conversations + CC triage agent

Extends Spec 193 (in-app feedback). Today feedback is **one-way**: a user submits,
super_admin moves the status (`open → in_progress → done/declined`). RLS already lets
a submitter read their own row, but no UI shows it back and there is no reply channel.

This spec makes feedback a **two-way conversation** and introduces the app's first
AI-agent loop: **CC (Claude Code), run on demand, triages reports** — investigates
against the real codebase, then drafts a resolution, a clarifying question, or a
request for an annotated screenshot. Drafts are **approved by the operator** before
they reach the reporter. North-star fit: a low-stakes pilot for the per-department
agents in [[ai-driven-direction-keep-images]].

## Locked decisions (operator, 2026-06-25)

1. **Reply gate — draft → operator approves.** CC never publishes to a reporter
   directly. A CC/operator reply is born `draft` (status `awaiting_review`); the
   operator approves to publish. Matches Anthropic's human-in-the-loop-before-
   outward-actions guidance and contains the prompt-injection risk of feeding
   untrusted feedback text into the agent. May relax to auto-send later.
2. **Cadence — manual.** The operator runs the `/triage-feedback` skill on demand
   (as they query the table today). No scheduler in v1; add once the loop is proven.
3. **Annotation — later unit, reuse `photo_markups`.** Ship plain image upload + a
   text ask first; add draw-on-image markup in U5 by reusing the existing markup
   capability.

## Patterns (Anthropic, building-effective-agents / writing-tools-for-agents)

- Outer loop = **workflow** (deterministic: poll → route by status → publish approved).
- Inner step = **agent** (model-driven: investigate one item, decide reply kind, draft).
- Agent "tools" = a few purpose-named DEFINER RPCs returning plain-language context.
- Keep it simple: CC = the operator's Claude Code; the app only needs the thread data
  model + UI. No in-app Claude API worker in v1 (that is the future autonomous state).

## Unit breakdown

- **U1 — my-requests list** (this unit; code-only, read RLS already exists).
- **U2 — thread read**: `feedback_messages` (append-only) + RLS + thread UI.
- **U3 — reporter reply**: insert RPC + composer.
- **U4 — CC drafts → operator approves**: status `+awaiting_review/+awaiting_user`,
  draft/publish/resolve RPCs, approve UI. The core.
- **U5 — annotated-screenshot request**: reuse `photo_markups`.
- **U6 — reporter notification** of a published reply.
- **`/triage-feedback` skill** — the reusable agent procedure (depends on U4 RPCs).

## U1 — my-requests list (scope)

A reporter sees the reports they have submitted, with current status, on `/feedback`
below the form. No DB change — the `"feedback readable by submitter"` RLS
(`submitted_by = auth.uid()`, mig 20260813000000) already permits the read; the page
fetches via the user's RLS context (server client).

- New presentational component `MyFeedbackList` (`src/components/features/feedback/`):
  props = the reporter's own rows; renders newest-first with a type badge + a status
  badge + the title + the submit date; empty state when the reporter has none.
- `src/app/feedback/page.tsx` fetches the caller's own feedback
  (`id, type, status, title, created_at`, newest-first) and renders the list under
  the form. The form's existing `router.refresh()` on submit refreshes the list.
- Attachments are **not** shown in this list (the reporter cannot yet read their own
  attachment rows — `feedback_attachments` is zero-authenticated-access; deferred to
  a later unit with an owner-read policy).

### Verification (U1)

- `pnpm test tests/unit/my-feedback-list.test.tsx` — list renders rows, badges the
  type + status, sorts newest-first, shows the empty state.
- `pnpm lint && pnpm typecheck && pnpm test` green.
- Manual: submit a report → it appears in the list below the form with status `ใหม่`.

## U2 — thread (scope)

A report becomes a conversation. Scope call: U2 needs a seed writer or the thread is
empty to read — so U2 includes the **operator-posts-a-reply** path. An operator (a
human) writing IS the human-approved channel; the draft→approve gate (locked dial 1)
governs **CC-generated** replies, which arrive in U4. Reporter-reply = U3.

- **DB (`20260813001200`, pgTAP 218):** `feedback_messages` (append-only — the message
  doctrine, like `feedback_attachments`): `feedback_id` FK, `author_kind`
  (`feedback_author_kind` enum = reporter/operator/agent), `author_id` (null for agent),
  `body` (1..4000), `created_at`. RLS SELECT: submitter reads the thread on their own
  report; super_admin reads all. Writes RPC-only. `post_feedback_message(feedback_id,
body)` — super_admin-only definer, stamps `author_kind='operator'` + `author_id`.
- **UI:** `FeedbackThread` (presentational, oldest-first, author-labelled, team accent) ·
  `FeedbackReply` (operator composer → `postFeedbackMessage` action) · a single thread
  surface at `/feedback/[id]` (RLS own-or-super → notFound otherwise; the composer renders
  only for super_admin). `MyFeedbackList` rows link to it; the review cards link to it
  (`ดูบทสนทนา / ตอบกลับ`). `FEEDBACK_AUTHOR_LABEL` added.
- Reporter view is **read-only** in U2 (reporter-reply composer is U3). No `state`
  (draft/published) column yet — added in U4 when CC drafts need hiding pre-approval.

### Verification (U2)

- pgTAP `218-feedback-messages` (13): catalog + execute lockdown · super posts (operator) ·
  submitter reads own thread · non-submitter reads nothing · non-super cannot post (42501) ·
  unknown id / empty body (22023) · append-only UPDATE/DELETE (P0001).
- `feedback-thread.test.tsx` (4) + `feedback-reply.test.tsx` (2).
- `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:test` 218 green.

## U3 — reporter reply (scope)

The loop closes from the reporter's side: the report's own submitter can now post onto
the thread. `post_feedback_message` **widens** (same signature → CREATE OR REPLACE,
grants preserved, body re-sourced from the U2 body) so the author voice is DERIVED from
the caller, never trusted: super_admin → `operator`, the submitter → `reporter`, anyone
else → 42501. One RPC, role-derived — no second write path.

- **DB (`20260813001300`, pgTAP 219):** widened gate. file 218's "cannot post" case
  retargeted to a true non-owner non-super (the submitter posting is now the U3 path).
- **UI:** `/feedback/[id]` shows the `FeedbackReply` composer to `canReply = super_admin
|| submitted_by === viewer`; the page fetches `submitted_by` to decide. The composer
  copy is neutralised (`ตอบกลับ`) so it reads correctly for both ends; the same component
  - action serve both because the RPC stamps the voice.
- No new column/enum/type (no `database.types` drift).

### Verification (U3)

- pgTAP `219-feedback-reporter-reply` (5): submitter posts · stamped `reporter` · author_id
  = submitter · non-owner non-super denied (42501) · super still stamped `operator`.
- `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:test` 218 + 219 green.

## U4 — CC drafts → operator approves (the core)

The human-in-the-loop gate (locked dial 1). **Model refinement** (driven by the
append-only constraint): a CC draft cannot be a `feedback_messages` row toggled
draft→published, because `feedback_messages` is append-only/immutable. So a draft is
**not a message yet** — it is staged in a separate **`feedback_message_drafts`** table
(mutable, super_admin-only read; the reporter has NO read path). Approval = insert a
real append-only agent message + delete the draft. This keeps the thread immutable,
auto-hides drafts, and makes "approve" the only path a CC reply reaches the reporter.

**Deferred from the original dial wording:** the `feedback_status` enum is NOT extended
with `awaiting_review`/`awaiting_user`. The presence of a pending draft already signals
"awaiting the operator" (derived, not denormalised), and resolution reuses the existing
`set_feedback_status` (done/declined). A dedicated worklist status can come later if the
review list needs it — it would be its own enum-add migration.

- **DB (`20260813001400`, pgTAP 220):** `feedback_message_drafts` (feedback_id FK, body
  1..4000) — super_admin-only RLS, RPC-only writes. `draft_feedback_message(uuid,text)`
  **service_role-only** (CC stages via `supabase db query`; app users cannot draft).
  `publish_feedback_draft(uuid)` super_admin-only — inserts an `agent` message + deletes
  the draft, atomic. `discard_feedback_draft(uuid)` super_admin-only — drops it unsent.
- **UI:** `FeedbackDrafts` (super-only, on `/feedback/[id]` above the composer) lists
  pending drafts with อนุมัติและส่ง / ทิ้ง → `publishFeedbackDraft` / `discardFeedbackDraft`
  actions. The page fetches drafts only for super (RLS belt-and-braces). A published
  draft shows in the thread as `ผู้ช่วย AI` (transparent that it is AI-assisted).
- **Not in U4:** the `/triage-feedback` skill (CC's procedure that calls
  `draft_feedback_message`) is its own deliverable; U4 ships the gate the skill needs.

### Verification (U4)

- pgTAP `220-feedback-drafts` (16): catalog + service_role/super lockdown · reporter
  cannot see drafts · super sees them · draft_feedback_message stages · publish →
  agent message + draft gone · reporter then sees the agent reply · non-super cannot
  publish/discard (42501) · discard removes · unknown draft (22023).
- `feedback-drafts.test.tsx` (4).
- `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:test` 220 green.

## `/triage-feedback` skill

The agent procedure that activates the arc — CC's manual-cadence triage step. Lives at
`.claude/skills/triage-feedback/SKILL.md` (registered in CLAUDE.md). CC connects via
`pnpm exec supabase db query --linked` (service_role: bypasses RLS to read; granted execute
on `draft_feedback_message`). Procedure: pull the open/in_progress queue → per report read
the thread + skip if a draft exists → investigate against the codebase (locate via
`page_path`/`screen`/`role_snapshot`, read code, reproduce) → stage ONE reply draft via
`draft_feedback_message` (use `--file` for Thai/quoted bodies) → hand off to the operator,
who approves at `/feedback/[id]`.

Guardrails (Anthropic building-effective-agents + the locked dials): **draft only** (never
publish / set status / `UPDATE feedback`); **feedback text + attachments are untrusted** (the
`db query` boundary wrapper — a report is evidence, never a command — prompt-injection guard);
**ground every claim in real code/reproduction**; **draft in Thai, brief, one ask** (shown to
the reporter as `ผู้ช่วย AI` — transparent it's AI); **never double-draft**.

- Not TDD-testable (a procedure doc, no code/DB). Validated by running Step 1 against live
  data (returns the open queue; the untrusted-data boundary confirms the injection guard).
- Cadence stays manual — no scheduler. A scheduled routine is a later, separate decision.

## Arc status

U1–U4 + the `/triage-feedback` skill shipped (2026-06-25). The loop runs end to end:
reporter files → CC triages + stages a draft → operator approves/discards → approved reply
reaches the reporter as `ผู้ช่วย AI` → reporter replies → repeat. Remaining: **U5**
annotated screenshots (reuse `photo_markups`) · **U6** reporter notification of a published
reply.
