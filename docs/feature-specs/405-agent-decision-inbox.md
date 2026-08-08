# Spec 405 — กล่องรอตัดสิน: a private agent→operator decision inbox

**Status:** 2026-08-08 — **SPEC ONLY, nothing built.** Lane `decide`, worktree
`../prc-ops-decide`, branch `spec405-decision-inbox`. U1 adds two tables ⇒ **schema lane +
danger-path PR ⇒ operator tap at merge.** Design brainstormed and operator-approved
2026-08-08; the six 🔒 rulings in §0 are SETTLED and must not be re-opened.

🔔 **ONE BLOCKING QUESTION BEFORE U1'S MIGRATION — §14 Q0.** Ruling 5 ("two tables, the answer
is an FK to the chosen option") and the multi-select requirement cannot both be satisfied
literally: N chosen options cannot be stored as one FK column, and Postgres arrays cannot carry
an FK. §4 is written to the recommended resolution; Q0 states the alternative and what changes
if the operator picks it. **This spec has been fact-checked** (`spec-fact-checker`, 2026-08-08);
the corrections it forced are marked ⚠️ **FACT-CHECK** inline so they are not re-introduced.

**The ask, in one line:** the agent has no way to ask the operator a blocking question and
have the question survive until it is answered.

---

## 0. 🔒 Settled by the operator, 2026-08-08 — do not re-litigate

1. **Scope = anything the agent is blocked on.** Feedback-linked _or_ standalone (a spec
   choice, ship/hold, an infra alert). Not a feedback feature.
2. **An unanswered card NEVER auto-acts.** It escalates by age — climbs the dashboard, enters
   the Telegram digest with its age in days, eventually a banner. **Silence is never consent.**
3. **Cards are PRIVATE — operator only.** Never written to `feedback_messages`.
4. **Reporting results back to staff is OUT OF SCOPE.** The operator does that out of band. A
   batched draft-summary is a possible fast-follow, not this spec.
5. **Two tables** (`agent_decisions` + `agent_decision_options`); the answer is an **FK to the
   chosen option** plus an optional free-text note. Rejected: options-as-`jsonb` (untyped join,
   violates CLAUDE.md's typed-FK rule) and overloading `feedback` (fights its staff-visible
   RLS, §1.3). ⚠️ **The ruling's REASON — a typed FK join, never untyped JSON — is what §4
   preserves absolutely. Its LETTER (which side holds the pointer) is what §14 Q0 asks about,
   because multi-select cannot be one FK column.**
6. **The Telegram ping comes from the AGENT'S runs, not the app** (§8).

---

## 1. Why — measured live 2026-08-08, in this session

Every figure below was re-measured on this branch. Do not inherit them; the windows slide.

| Probe                                                        | Result                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `feedback` stuck `in_progress`                               | **14**, oldest `2026-06-25`                                           |
| Agent messages in `feedback_messages`                        | **78** across **62** threads                                          |
| Operator messages                                            | **5** across **4** threads, last **`2026-06-28`**                     |
| Reporter messages, all time                                  | **6** across 6 threads                                                |
| Last agent message                                           | `2026-08-07` — the agent is still writing into a channel nobody reads |
| super_admin `route_view`, 60d, `/feedback` (the SUBMIT form) | **26** (1 actor, last 2026-08-07)                                     |
| super_admin `route_view`, 60d, `/feedback/review`            | **4** (1 actor, last 2026-07-27)                                      |
| super_admin `route_view`, 60d, an individual thread          | **3** (1 actor, last 2026-07-09)                                      |
| super_admin `route_view`, 30d, `/dashboard` · `/settings`    | **388** (2 actors) · **284** (1 actor)                                |

`/feedback` is trackable (`EXCLUDED_PREFIXES` in `src/lib/telemetry/scope.ts:10` is
`/login`, `/coming-soon`, `/client`, `/portal`), so these small numbers are real absence, not
an instrument gap.

⚠️ **FACT-CHECK — the 30d row moved 389→388 and 289→284 during the two hours this spec was
written**, because a 30-day window slides at its trailing edge. That is the point of the
doctrine rule, not an exception to it: **re-run these before quoting them, and never inherit
them from this table.**

**The feedback surfaces are not read.** The SUBMIT form draws 26 views and the review queue 4;
`/dashboard` draws 388 over 30 days. ⚠️ Note the `/dashboard` figure comes from **two distinct
super_admin actors**, so it is a role-level fact, not one person's habit — but the feedback
figures are all **1 actor**, so the asymmetry is real either way. Any channel living at
`/feedback/*` is, empirically, a channel to nobody.

### 1.1 The staff side is no better — and it has a real instrument

There is a first-class read signal: `public.feedback_views(feedback_id, user_id,
last_viewed_at)`, consumed by the DEFINER `feedback_unread_ids()`. Measured against it, over
the 62 threads carrying an agent reply, keyed on each thread's LAST agent message:

- **17 read after the reply · 45 not · 37 never opened at all** ⇒ **27% read-after-reply.**
  ⚠️ **All three are SUBMITTER-keyed** (`feedback_views.user_id = feedback.submitted_by`) — the
  same keying `feedback_unread_ids()` itself uses (`v.user_id = (select auth.uid())` for
  `f.submitted_by = auth.uid()`). State the keying whenever you re-run this: an any-user
  variant of the same query returns **35** for "never opened", and a trio that silently mixes
  the two keyings does not reconcile.
- `feedback_views` earliest row `2026-06-25 18:58`, i.e. the same day as the first agent
  reply — the instrument covers the whole population, so the 45 is a real unread count and
  not a collection-window artefact.
- Latest row of any kind: **`2026-07-22`**. No reporter has opened any thread in 17 days.

⭐ A route-view proxy would have got this wrong. `interaction_events` only begins
`2026-07-01`, six days AFTER the first agent reply, so 16 of the 62 threads are structurally
invisible to it. `feedback_views` is the instrument the repo already trusts; use it.

### 1.2 The operator answers fast or never — there is no middle

Two histograms, both in **elapsed interval** (`now() - created_at`), never calendar-date
subtraction — a `::date` difference of 3 covers 3.0–3.99 elapsed days and would slice a
cohort by time of day (spec 384 U1's lesson).

- **Operator reply latency, all 5 replies, hours:** `0.03 | 3.95 | 4.14 | 9.55 | 49.24`.
  Empty interval **(9.55h, 49.24h)**.
- **`in_progress` age, all 14, days:**
  `0.7 | 2.6 | 21.2 | 23.7 | 24.1 | 25.2 | 25.7 | 28.1 | 36.5 | 39.3 | 42.0 | 42.2 | 42.2 | 43.6`.
  Empty interval **(2.6d, 21.2d)** — 18.6 days wide, two fresh items and twelve abandoned.

**Nothing has ever been answered between day 2.05 and day 21.** That is what §7's thresholds
are cut from, and §7.1 states plainly what those numbers do and do not license.

### 1.3 The cause the operator named: there is no private lane

Live policies on `public.feedback_messages` (read from `pg_policy`, not from a migration
file):

| Policy                                      | cmd | qual                                                            |
| ------------------------------------------- | --- | --------------------------------------------------------------- |
| `feedback messages readable by submitter`   | `r` | `exists (… f.id = feedback_id and f.submitted_by = auth.uid())` |
| `feedback messages readable by super_admin` | `r` | `current_user_role() = 'super_admin'`                           |

**The submitter policy carries no `author_kind` filter.** The column `author_kind` has members
`reporter · operator · agent`, and the submitter reads all three. ⚠️ **FACT-CHECK — the TYPE is
named `feedback_author_kind`, not `author_kind`.** `enum_range(null::public.author_kind)` does
not resolve; any migration or pgTAP written against `::author_kind` fails `42704`. So every word the operator
types into a thread is staff-visible, and `feedback-reply.tsx` renders **no audience cue at
all** (grepped: no `author_kind`, no `ส่งถึง`, no `ส่วนตัว`, nothing). The operator's stated
reason for not replying is that they cannot tell who will see it. **They are right, and the
schema agrees with them.**

This spec does not change that policy. It builds the lane that does not exist beside it.

---

## 2. Prior art — and the gap this fills

Anthropic's own published guidance covers the SHAPE of a good agent→human gate. It does not
cover PERSISTENCE, which is the entire problem here. **Every claim below was fetched and
verified against the live docs on 2026-08-08, not quoted from memory.**

- **[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)** —
  a three-tier gate model (auto-approve / notify-with-undo / block), and the rule that at any
  gate you show **what will happen, the reasoning, what changes, and how to undo it**. Also:
  batch approvals rather than interrupting per action. §5's card anatomy is this list, and
  §6's single dashboard card is the batching.
- **[AskUserQuestion](https://code.claude.com/docs/en/agent-sdk/user-input.md)** — verbatim:
  `header` is a _"Short label for the question (max 12 characters)"_ and `options` is an
  _"Array of 2-4 choices, each with `label` and `description`"_ (the limits section repeats
  _"1-4 questions with 2-4 options each"_). §5.3's ≤12 CHECK is taken from that sentence.
  ⚠️ **The per-option `preview` is TypeScript-only and OPT-IN** — it appears only when
  `toolConfig.askUserQuestion.previewFormat` is set to `"markdown"` (ASCII art + fenced code)
  or `"html"` (a styled `<div>`; the SDK strips `<script>`, `<style>`, `<!DOCTYPE>`). It is
  absent by default, so it is a capability to copy, not a default to assume.
  ⭐ **Two findings that strengthen §5.4 rather than merely informing it:** the tool ships **no
  "none of these"** option, and free text is not a built-in field either — the docs tell the
  HOST app to _"display an additional 'Other' choice after Claude's options"_ and use the typed
  text as the answer value. So the escape hatch is something the integrator adds, every time,
  by hand. §5.4 makes it structural instead.
- **[Plan mode](https://code.claude.com/docs/en/permission-modes.md)** — exactly three answers,
  the third verbatim _"**No, keep planning**: stay in plan mode and tell Claude what to
  change"_, and _"edits stay blocked until you approve the plan"_. That is exactly
  `effect_kind = 'refine'` (§4.2).
- **[Permission prompts](https://code.claude.com/docs/en/permissions.md)** — "deny with
  feedback" exists so the human can **steer**, not merely block. That is why `decline` records
  a reason and why every option carries a free-text note.

**⛔ The key negative result, and it must be stated honestly in any PR body: neither Claude
Code nor the Agent SDK has a decision that survives a session.** `askUserQuestionTimeout`
simply closes the card; the documentation's own answer is to build your own persistence. So
this spec is **filling a documented gap, not porting a shipped Anthropic feature** — do not
write "as Claude Code does" anywhere in the implementation, because for the one property that
matters here, it does not.

---

## 3. The model

A **decision** is one blocking question with 2–4 **options**. The operator taps one option,
optionally types a note, and the card is answered. **The answer is a typed row in
`agent_decision_options`, never a string and never JSON** — so a rendered answer is a JOIN,
every option is typed, and `effect_kind` is enforced by the enum rather than by a convention.
Which side holds the pointer is §14 Q0.

Rejected, recorded so they are not re-proposed:

- **Options as `jsonb` on the decision row.** No FK, no join, no type. CLAUDE.md's typed-FK
  rule exists for this; the answer would be a string nobody can constrain.
- **Overloading `feedback` + `feedback_messages`.** Its RLS is deliberately staff-visible
  (§1.3) and its status enum is `open · in_progress · done · declined` — a vocabulary about
  bug reports, not about decisions. Every card would either leak or need a policy fight.

---

## 4. U1 — the schema

⚠️ **Re-query the migration head AT APPLY TIME, never at plan time.** At the time of writing
live head is `20260813075921`, equal to main's newest migration file ⇒ live == main and the
schema lane is FREE. A number can be consumed by another lane while you build, and `db:push`
then reports **"Remote database is up to date"** and applies **nothing** — so after pushing,
verify the OBJECTS exist, never the push's own success message.

### 4.1 `agent_decisions`

| Column               | Type               | Notes                                                                |
| -------------------- | ------------------ | -------------------------------------------------------------------- |
| `id`                 | `uuid` PK          | `gen_random_uuid()`                                                  |
| `decision_number`    | `bigint`           | Identity, like `feedback.feedback_number` — a short human handle     |
| `header`             | `text`             | **≤12 chars**, CHECK-enforced (§5.3)                                 |
| `question`           | `text`             | The clarifying question — leads the card below the threshold (§5.2)  |
| `context`            | `text`             | What the agent measured/read to get here                             |
| `interpretation_pct` | `smallint`         | 0–100, CHECK. "ผมเข้าใจโจทย์ N%" (§5.1)                              |
| `multi_select`       | `boolean`          | Default false (§5.5)                                                 |
| `status`             | enum               | `open · answered · withdrawn`                                        |
| `feedback_id`        | `uuid` NULL        | FK → `feedback(id)`, **nullable** — ruling 1: standalone cards exist |
| `spec_ref`           | `text` NULL        | e.g. `405` / `docs/feature-specs/401-…` — the other kind of anchor   |
| `round`              | `smallint`         | Default 0; `refine` increments it (§4.2)                             |
| `session_brief`      | `text` NULL        | Written by the agent after a `session` answer (§4.2)                 |
| `answer_note`        | `text` NULL        | Free text, always available alongside any option                     |
| `answered_at`        | `timestamptz` NULL |                                                                      |
| `answered_by`        | `uuid` NULL        | FK → `users(id)`                                                     |
| `created_at`         | `timestamptz`      | `now()`                                                              |
| `updated_at`         | `timestamptz`      | Bumped when the agent rewrites the card in place                     |

**The answer lives on the OPTION row** (`chosen_at`, §4.2), not as an `answered_option_id`
column here. That is §14 Q0's recommendation, and it buys three things: single- and
multi-select become the same shape (no second code path), there is exactly one source of truth
for "was this option chosen", and **there is no FK cycle**, so no deferred constraints and no
third table.

⚠️ **FACT-CHECK — an earlier draft proposed `answered_option_id` plus a
`deferrable initially deferred` FK, justified as "or the agent cannot write a decision and its
options in one transaction". That justification was FALSE, and it is recorded here so it is not
re-proposed: the column was nullable, and Postgres does not check an FK whose referencing value
is NULL.** A card is born unanswered, so that write never needed deferral — the deferral would
have traded fail-fast constraint checking for nothing.

**Single-select exclusivity** is a `BEFORE INSERT OR UPDATE` trigger on
`agent_decision_options`: when `chosen_at` is being set, lock the parent decision row
(`select … for update`) and raise if the parent is `not multi_select` and another option on it
is already chosen. ⚠️ **The row lock is load-bearing** — without it two concurrent taps both
read zero chosen options and both write. A partial unique index cannot do this job: an index
sees only columns of its own table, and `multi_select` lives on the parent.

### 4.2 `agent_decision_options`

| Column           | Type               | Notes                                                                |
| ---------------- | ------------------ | -------------------------------------------------------------------- |
| `id`             | `uuid` PK          |                                                                      |
| `decision_id`    | `uuid`             | FK → `agent_decisions(id)` `on delete cascade`                       |
| `sort_order`     | `smallint`         | Render order                                                         |
| `label`          | `text`             | What the option IS                                                   |
| `consequence`    | `text`             | What picking it DOES — required, not nullable (§5.3)                 |
| `recommended`    | `boolean`          | At most one per decision (partial unique index)                      |
| `confidence_pct` | `smallint` NULL    | 0–100, only meaningful on the recommended option                     |
| `preview_path`   | `text` NULL        | Storage key for a per-option visual preview (§9)                     |
| `reversal`       | `text` NULL        | Rendered ONLY when present — see §13.3, this replaces the risk badge |
| `effect_kind`    | enum               | `answer · refine · session · decline`                                |
| `chosen_at`      | `timestamptz` NULL | **The answer.** Null = not chosen. Exclusivity per §4.1's trigger    |

`effect_kind` is the contract between the tap and the agent's next run:

- **`answer`** — records the decision; the agent acts on it next run.
- **`refine`** — **nothing is decided.** The note goes back to the agent, which **rewrites the
  card in place** next run and increments `round`. Modelled on plan mode's "No, keep
  planning" loop. ⚠️ A rewrite must not silently discard the operator's note — keep the
  previous rounds (see §13.4's schema note) or the loop destroys its own history.
- **`session`** — the operator marks it as needing live work. The agent writes a
  `session_brief` onto the card — measurements taken, queries run, files and RPCs touched,
  options already rejected and why, and what it needs from the operator — so the next session
  **opens with context instead of re-deriving it.** This is the unit that pays for itself.
- **`decline`** — closes it with the operator's reason on the record.

⚠️ **A new enum is a guard-trip.** Adding `audit_action` values tripped TWO full-array pins in
spec 367; check `docs/prc-ops-guard-trip-map` equivalents and grep for every exhaustive
`toEqual` over enum members before assuming one file needs updating.

### 4.3 Posture — private by construction

🚨 **A new table is born PUBLIC.** This project's default privileges hand a brand-new table
full rights to `anon` AND `authenticated`, so a table created with only a `grant select` is
directly INSERT/UPDATE/DELETE-able by every signed-in user while the migration reads as if it
locked things down. **Both** tables get, **before** any grant:

```sql
revoke all on public.agent_decisions from public, anon, authenticated;
```

The precedent to copy is `feedback_message_drafts` (mig `20260813001400`), verified live:
RLS enabled · `grant select to authenticated` and **nothing else** · one SELECT policy
`current_user_role() = 'super_admin'` · every write path `service_role` only. The agent writes
cards with the service-role admin client, exactly as it writes drafts today.

⚠️ **"Operator only" means `super_admin`, and there are TWO super_admin users** (verified
live). That is the app's expression of "the operator" and it is the same audience that
already reads `feedback_message_drafts` and every `feedback_messages` row. Named here so it
is a decision rather than a surprise; §14 Q1 asks whether that is acceptable.

**pgTAP must pin all four postures per table** — `authenticated` may SELECT, may **not**
INSERT/UPDATE/DELETE; `anon` may not SELECT — plus a positive control that an `authenticated`
non-super_admin gets **zero rows** while a super_admin gets the row. An absence assertion
without a positive control cannot tell "the policy works" from "the policy is gone".

⚠️ **No bare `count(*)` over these tables in pgTAP.** The agent writes them, so a global count
is non-deterministic on the merge ref and jams the queue **repo-wide** (#954). Scope every
count to fixture rows.

---

## 5. The card

### 5.1 Two confidences, two different jobs

This is the part that is not in any prior art, and it is deliberate.

- **Interpretation confidence** sits at the TOP and qualifies everything below it:
  _"ผมเข้าใจโจทย์ 65%"_. It answers **"do I even have the right question?"**
- **Recommendation confidence** sits on the recommended option: _"แนะนำ · 80%"_. It answers
  **"given the question is right, which answer is best?"**

Collapsing them into one number is the failure mode. A card can be 95% sure that option B is
the best answer to a question it is 40% sure it understood — and that card must not read as
95% confident.

### 5.2 Below the threshold, the card leads with the question

When `interpretation_pct` is below the threshold, the card **renders the clarifying question
first and the options second, visually demoted**. It does not hide the options — a half-
understood question with plausible options is still useful — but it must not invite a tap as
its primary affordance.

**Threshold: 60.** ⚠️ **This number has no measurement behind it — there is no corpus of agent
self-assessments to cut it from.** It is a starting value, it lives in ONE constant beside the
escalation constants (§7), and §15's acceptance re-derives it once ~20 cards exist. Do not
write it inline at a call site.

### 5.3 Anatomy — the four things a gate must show

Per Building effective agents, every card shows what will happen, the reasoning, what
changes, and how to undo. Mapped onto the schema:

| Requirement      | Where it lives                                                   |
| ---------------- | ---------------------------------------------------------------- |
| What will happen | `option.consequence` — **required**, one line per option         |
| The reasoning    | `decision.context` + the two confidences                         |
| What changes     | `option.preview_path` when a visual says it faster than words    |
| How to undo      | `option.reversal`, rendered only when the effect is hard to undo |

`header` is **≤12 characters**, CHECK-enforced, and exists so a list of cards is scannable at
a glance — lifted straight from AskUserQuestion. It is a label, not a summary.

### 5.4 The standing escape option — `ผมเข้าใจผิด`

**Every card carries it, always, in addition to its real options**, with a free-text box.
AskUserQuestion deliberately ships no "none of these"; this spec deliberately adds one,
because the failure modes are not symmetric. **Misreading the case is the agent's worst
failure mode** — a confidently-wrong card that gets tapped produces confidently-wrong work,
and the operator pays for it twice. Burying that escape inside a textarea makes the cheap
correction more expensive than the expensive mistake.

It is an ordinary row with `effect_kind = 'refine'`, so it feeds the same loop. It is
generated by the writer, not typed per card, so it cannot be forgotten — pin that as a test:
**every card the agent writes has exactly one `refine` option whose label is the standing
string.**

### 5.5 Multi-select

Allowed, `multi_select = true`, for genuine sweep cases — _"which of these 8 latent bugs do I
fix?"_. The UI switches radios for checkboxes; **under §14 Q0's recommendation the storage is
identical to single-select** — N option rows carry a `chosen_at`, and the §4.1 trigger simply
does not enforce exclusivity when the parent is `multi_select`. That sameness is the design's
main argument: one write path, one read path, no second place to look.

⚠️ 2–4 options is the AskUserQuestion guidance for a CHOICE (verified §2); a sweep card is a
different object and may legitimately carry 8. Do not CHECK-constrain the option count to 4 —
constrain it only on single-select cards, if at all.

---

## 6. Surface — the dashboard, beside the existing cluster

`src/app/dashboard/page.tsx:250` renders `PendingApprovalsCard` and `AwarenessCard`, and its
own comment calls that group **"the dashboard inbox"**. That is the correct home, for the
reason §1 measures: 389 views in 30 days against 4 for the review queue.

- The card follows `AwarenessCard`'s shape (`src/components/features/dashboard/awareness-card.tsx`)
  and its **exception-driven rule: it renders nothing at zero.** An always-present "0 คำถาม"
  row is a nag, and the file's own comment says so.
- **The gate is `ctx.role === "super_admin"`, NOT `isManager`.** `PM_ROLES` is
  `project_manager · super_admin · project_director` (`src/lib/auth/role-home.ts:19`), so
  reusing `isManager` would put private cards in front of two other roles. ⚠️ **Both cards at
  `dashboard/page.tsx:250` are gated on `isManager` today, so the new card cannot simply join
  that block — it needs its own gate.** The catalog already has the right predicate for this
  audience — `operatorOnly` in `src/lib/notifications/notification-catalog.ts` — but ⚠️ **it is
  module-local, not exported**, so reuse means exporting it or re-deriving the predicate.
- Tapping the card opens the inbox at a new route. **The route must not live under
  `/feedback`** — §1 measures that neighbourhood as unread, and the card is not feedback.
  Proposed: `/decisions`. ⚠️ **FACT-CHECK — an earlier draft said "BOTH `nav-back-affordance`
  lists"; that pair does not exist.** `tests/unit/nav-back-affordance.test.ts` holds at least
  six named lists (`STATIC_DETAIL`, `NON_DETAIL_ROUTES`, `EXCLUDED_ROUTES`,
  `MULTI_PARENT_DETAILS`, `STATIC_MULTI_PARENT`, `HUB_STRIP_ROUTES`) plus a derived
  `DETAIL_ROUTES`; **which ones a new route must join depends on its shape, and U3 discovers
  that by reading the file, not from this spec.** Updating **`docs/site-map.md`** is not
  optional — a nav unit's diff includes the nav doc.

---

## 7. Escalation — cut from §1.2's empty intervals

Silence is never consent (ruling 2). An unanswered card gets progressively louder and never
acts.

| Age (elapsed)  | Behaviour                                                                             |
| -------------- | ------------------------------------------------------------------------------------- |
| `< 48h`        | **Resting.** Normal position in the dashboard cluster, no age shown.                  |
| `>= 48h`       | **Climbs.** Renders ABOVE `PendingApprovalsCard`, and starts showing its age in days. |
| `>= 72h`       | **Enters the Telegram digest** (§8), with the age in days.                            |
| `>= 168h` (7d) | **Banner** — a persistent bar on every page the operator loads.                       |

**Why these cuts.** 49.24h is the slowest answer ever observed, so 48h is the edge of "still
plausibly coming". Every later cut lands inside the measured-empty **(2.6d, 21.2d)** interval
with margin on both sides. 72h rather than 48h for the digest because the digest fires from a
run, not continuously — a card at hour 50 that the operator is about to answer should not
ping. 7d because the next observed stop after day 2.6 is day 21, which is far too late to
still be useful.

All four constants live in one module with the §5.2 threshold, compared as **elapsed
instants** (`Date.parse`, not string compare — PostgREST returns `…+00:00` and
`toISOString()` returns `…Z`, and `"+" < "Z"` bytewise, so a string comparison is only
accidentally right and wrong exactly at the boundary).

### 7.1 ⚠️ What these numbers are, honestly

They are cut from **feedback threads, n=5 replies and n=14 open items** — not from decision
cards, which do not exist yet. They are the closest available proxy and nothing more. The
distribution's shape (fast-or-never, with a wide empty middle) is the durable finding; the
exact cuts are a starting calibration. **§15 requires re-deriving them from `agent_decisions`
itself once ~20 cards have been answered**, in elapsed units, with the query written beside
the constants.

---

## 8. Telegram — the ping comes from the AGENT'S runs, not the app

🚨 **Design nothing that depends on the app being able to push.**

- `TELEGRAM_BOT_TOKEN` is **unset in Vercel prod** — verified in the Vercel console during
  spec 386, including the **Shared** tab reading "No shared variables linked", so no
  team-level variable supplies it invisibly.
- LINE push has blown its monthly quota before — 404 outbox rows failing
  `429 "You have reached your monthly limit"` across nine days, org-wide, silently.
- `notification_outbox.status = 'sent'` is **not delivery evidence**: `rowOutcomeAfterPushes`
  returns `sent` when `recipientCount === 0` (`drain-policy.ts:32`). A card that "was sent" to
  nobody is byte-identical to one that arrived.

So the digest is composed and sent **by the agent during its own scheduled runs**, reading
`agent_decisions` directly with the service-role client and posting through its own Telegram
credentials (`.telegram.env`). The app's only escalation surfaces are the ones it can render
itself: the climb and the banner.

**Consequence for the notification catalog: this spec adds NO new `NotificationEventType`.**
That is deliberate, not an omission. If a future unit ever does, note that
`NOTIFICATION_CATALOG_BY_EVENT` is `as const satisfies Record<NotificationEventType,
NotificationCatalogEntry>` (`notification-catalog.ts:178`), so a new event fails typecheck
until it is catalogued with a Thai label and an audience predicate.

---

## 9. Reuse — verified `file:line` on this branch, do not reinvent

| Need                         | Existing thing                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Radio + label + consequence  | `ChoiceRow` — `src/app/review/work-packages/[workPackageId]/record-decision-form.tsx:354`. Props are exactly `{name, checked, onPick, label, hint}` — `hint` **is** the consequence line. ⚠️ It is file-local; **exporting it is part of U-card**, and moving it means the review form's own tests must still cover it. |
| Compact single-choice chip   | `RadioChip` — `src/components/features/common/radio-chip.tsx:30`                                                                                                                                                                                                                                                        |
| Per-option preview image     | `ZoomablePhoto` — `src/components/features/photos/photo-lightbox.tsx:67`. Only `src` is required; its own doc comment says purchase-request attachments (not `photo_logs`) use it without `photoId`. So `<ZoomablePhoto src={signedUrl} />` is a clean, supported call — do not thread `photoId`/`group`.               |
| Private read + service write | `feedback_message_drafts` (§4.3) and `src/lib/feedback/attachment-urls.ts` — the latter is the pattern for **zero authenticated grant + signed URLs minted by the admin client**, which is what `preview_path` needs.                                                                                                   |
| Dashboard card shape         | `AwarenessCard` — `src/components/features/dashboard/awareness-card.tsx`                                                                                                                                                                                                                                                |

⚠️ Preview images are agent-authored and operator-only. They must NOT go in a bucket whose
policy is `authenticated`-readable, and a Storage policy must **delegate to a `public` role
helper, never restate a role array** — a `public`-only policy sweep misses `storage.objects`
entirely, which is how #823 sat live for two weeks. Also: Storage keys reject non-ASCII, so
any key derived from Thai text needs an ASCII-only sanitiser (`\p{L}` leaks Thai and dies at
the bucket).

---

## 10. Units

Order is load-bearing: **U1 → U2 → U3**. A reader before a writer shows an empty box; a writer
before a reader repeats spec 377's failure (a full authoring UI shipped against zero read
surfaces, still at 0 rows and 0 route views).

| Unit | What                                                                                                                                                                                                                  | Lane                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| U1   | **Two** tables, enums, the exclusivity trigger, RLS, grants, `revoke all` FIRST, pgTAP (4 postures × 2 tables + positive controls + a concurrent-tap probe on the trigger). 🔔 **Blocked on §14 Q0**                  | **SCHEMA · danger path** |
| U2   | The agent's writer — a service-role module that composes a card + options, always emitting the standing `ผมเข้าใจผิด` refine option; plus the `bug-fix-flow` skill wiring that calls it instead of asking in a thread | code                     |
| U3   | `/decisions` — the list, the card, the answer action; `ChoiceRow` exported; nav-back + `docs/site-map.md`                                                                                                             | code                     |
| U4   | Dashboard card + the climb (§7 rows 1–2)                                                                                                                                                                              | code                     |
| U5   | The banner (§7 row 4) + the agent-side Telegram digest (§8)                                                                                                                                                           | code + skill             |
| U6   | `session_brief` — the writer fills it after a `session` answer; the card renders it                                                                                                                                   | code                     |

U1 is a **danger-path PR** (`supabase/`) ⇒ the guard fails BY DESIGN and the UI merge button
only ENQUEUES. The only path is the admin two-step —
`gh pr merge <n> --disable-auto && gh pr merge <n> --squash --admin` — then verify `mergedAt`.
⚠️ `--admin` **skips the queue's pgTAP run**, and pgTAP short-circuits on PR refs, so on this
PR the **local `pnpm db:test` is the only real schema evidence.**

---

## 11. Out of scope, and why

- **Reporting results back to staff** (ruling 4). The operator does it out of band. A batched
  draft-summary — one draft per affected thread, operator publishes — is the natural
  fast-follow, and §12's skill change is its precondition.
- **Changing the `feedback_messages` submitter policy.** Adding an `author_kind` filter there
  is a real and separate question (it would let the operator write privately in a thread), but
  it is a policy rewrite on a live staff-facing surface and it is not what unblocks the agent.
- **Any auto-action on silence.** Ruling 2, absolutely.
- **The app pushing a notification** (§8).

---

## 12. Separate and ship-independent — retire the skill's auto-publish lane

**Done in this lane. It is a two-file change and it IS a PR** — ⚠️ **FACT-CHECK: an earlier
draft said "one skill file, no PR". Both claims were wrong.**

⚠️ **The tier is defined in `triage-feedback`, not in `bug-fix-flow`.** `bug-fix-flow/SKILL.md`
merely _delegates_ ("tiered — see [[triage-feedback]] §3"); the literal mechanism lives in
`.claude/skills/triage-feedback/SKILL.md` **Step 3**, which carries the
`insert into public.feedback_messages (feedback_id, author_kind, author_id, body) values (…,
'agent', null, …)` heredoc run through the service-role connection — and it explicitly notes
that this **bypasses the `super_admin`-gated `publish_feedback_draft` RPC**. `triage-feedback`
is independently invocable, so **editing only `bug-fix-flow` would leave the lane fully live.**

⚠️ **`git ls-files .claude/skills/` shows all four SKILL.md files are TRACKED**, and `main` is
branch-protected ⇒ this ships as an ordinary code-only PR, not a free-hand edit.

Those messages are staff-visible, never reviewed by the operator, and — measured in §1.1 —
**73% unread** (45 of 62). The lane writes irreversibly (`feedback_messages` is append-only)
into a channel whose readers do not read it.

**Every staff-visible message becomes a draft the operator publishes.** The replacement path
already exists: `feedback_message_drafts` (0 rows, queue cleared 2026-08-07), the
`draft_feedback_message` writer that works under service-role, and the mandatory de-dup guard
at `triage-feedback/SKILL.md` lines 118–135. **This removes the tier, not the reply.**

---

## 13. The four open questions, RESOLVED

### 13.1 Does this need an ADR? — **YES, ADR 0087**

The ADR index tops out at **0086** (verified by listing `docs/decisions/` on a tree created
from `origin/main` AND cross-checking `docs/decisions/README.md`, because a directory listing
is branch-relative and has produced a wrong ADR number here before). **None of them defines an
agent surface or an agent↔operator channel.** ⚠️ **FACT-CHECK — an earlier draft said "one
mentions agent at all"; that is INDEX-scoped.** Body-scoped, six ADRs mention the word, all
incidentally: 0054, 0061, 0068, 0072, 0079, 0081. The conclusion holds; the count did not.

It qualifies on the README's own bar — _"binding decisions; they override defaults"_ — because
it binds behaviour outside this feature:

> **The agent does not ask the operator a blocking question through `feedback_messages`. It
> writes an `agent_decisions` card. An unanswered card never becomes consent.**

That rule governs every future spec and skill, and it overrides what `bug-fix-flow` does
today (§12). A spec describes one feature; this is a standing constraint on all of them.
Write it as part of U1.

### 13.2 Exact escalation thresholds — **48h / 72h / 7d**, §7

Derived in §1.2, cut inside measured-empty intervals, with §7.1 stating exactly how weak the
n is and requiring re-derivation from real cards.

### 13.3 Does the risk badge earn its place? — **NO. Cut it.**

It was repurposed to mean "how much work your tap unleashes" now that nothing auto-fires.
Three reasons it fails:

1. **It duplicates two fields that are already required.** `effect_kind` says what class of
   thing the tap does; `consequence` says what it does in words. A three-level badge on top is
   a coarser third encoding of the same axis.
2. **A severity dimension you cannot show varies is decoration.** There is no corpus of
   decision cards, so nobody can claim the badge would vary; the honest default is not to ship
   a dimension whose distribution is unmeasurable. 🚨 **FACT-CHECK — this argument originally
   leaned on spec 402's "100% of `pr_created` rows are `critical`", and that inherited figure
   is STALE.** Re-measured live 2026-08-08: `critical` **176** · `normal` **49** · `urgent`
   **18** — 72%, not 100%. Still skewed enough to be a weak signal, but **do not re-quote the
   100%**, and note that spec 402's rejection may itself deserve re-checking against this
   number. The argument here stands on points 1 and 3, which need no external metric.
3. **A coarse class invites branching on it**, and a class built for grouping is always wider
   than the decision you want to key on (`diagnoseStorageFailure`'s `authz` lumping 401 with
   403 is the house example).

**What survives, because `consequence` genuinely cannot carry it cheaply: reversibility.**
Keep a **nullable `reversal` text on the option, rendered only when present** — exception-
driven, the same rule `AwarenessCard` already uses. "This applies a migration to prod" earns a
line; "this changes a label" renders nothing. If, after ~20 cards, `reversal` turns out to be
filled on nearly all or nearly none, that is the measurement that decides whether it becomes
an enum or disappears.

### 13.4 Standing policy — "don't ask me this again" — **DEFERRED, not rejected**

Mirrors Claude Code's "Yes, don't ask again". It is a good idea and it is **unbuildable
today**, for a concrete reason: a standing policy is a claim that a question REPEATS, and
there are zero decision cards, so the repeat rate is not merely unknown — it is
unmeasurable. Building the rule engine first would be guessing at which axis to key it on
(the question text? the spec? the `effect_kind`? the surface?).

**What U1 must do so the door stays open:** keep `round` and the per-round history (a
`agent_decision_rounds` child, or at minimum never destroying the prior `question`/`context`
on a `refine` rewrite). A standing policy is derived from repetition, and repetition is only
visible if the history survives. ⚠️ Do NOT add a `policy` column now — an unused column on a
new table is the "dormant constant" trap, and the next session will wire it up without the
evidence that justifies it.

---

## 14. Open operator questions

### 🔔 Q0 — BLOCKING U1's migration. Where does the answer pointer live?

Ruling 5 says two tables and "the answer is an FK to the chosen option". Multi-select (§5.5) is
also a locked requirement. **Both cannot be satisfied literally**: N chosen options cannot be
one FK column, and a Postgres array column cannot carry an FK. So one of them bends. This
changes the migration, so it must be settled before U1 — not discovered during it.

- **A — RECOMMENDED, and what §4 is written to: the pointer moves to the option row**
  (`chosen_at timestamptz null`), exclusivity by trigger. **Two tables, ruling 5's count
  intact.** The ruling's REASON — a typed row, joined, never jsonb — is fully preserved; only
  the direction of the pointer changes. Bonus: single- and multi-select become one shape, and
  the FK cycle disappears entirely.
- **B — the literal reading: keep `answered_option_id` on the decision and add a third table**
  `agent_decision_answers(decision_id, option_id)` for multi-select. Ruling 5's sentence intact,
  its "two tables" broken, and single- vs multi-select become two code paths reading two
  different places — the shape most likely to grow a bug where one path is updated and the
  other is not.
- **C — cut multi-select from U1** and ship A or B later. Two tables, ruling 5 verbatim, at the
  price of deferring a locked design element.

**Recommendation: A.** It is the only option that keeps both locked items, and it is
strictly simpler. But it re-reads a 🔒 SETTLED ruling, and this spec forbids doing that
silently — hence the question.

### Non-blocking

1. **Two super_admins share this "private" lane** (§4.3). Is operator-private = super_admin
   acceptable, or does a card need a single named owner?
2. **Is `/decisions` the right route name**, and should the card's Thai label be
   `รอคุณตัดสิน`? Both strings are **proposals, not approved copy** — an invented Thai string
   has been vetoed before.
3. **Should a `decline` on a feedback-linked card also set that `feedback.status`?** It would
   close the loop on the 14 stuck items; it also writes to a staff-visible row from a private
   surface, which is exactly the boundary ruling 3 draws. Recommend **no** by default.

---

## 15. Acceptance — fill rates, not green tests

A feature whose whole job is to make a write happen is proved by that write's fill rate in
prod, split by cohort. Not by the suite.

- **`agent_decisions` rows > 0 and answered rows > 0.** Zero answers after N real cards means
  the surface is as unread as `/feedback/review` and the spec failed.
- **`select status, count(*) from agent_decisions group by 1`** — the `open` pile must not
  reproduce §1.2's 14-item graveyard.
- **Answer latency, re-derived in elapsed units once ~20 cards are answered**, feeding §7's
  constants and §5.2's threshold. Put the query beside the constants.
- **`effect_kind` distribution.** If `refine` is never chosen, the loop is decoration; if it
  is chosen constantly, the agent's cards are under-specified and §5.1's interpretation number
  is not being taken seriously.
- **`reversal` fill rate** (§13.3) — decides that field's future.
- **The §12 skill change is verified separately:** new agent rows in `feedback_messages`
  should stop appearing, while `feedback_message_drafts` starts carrying rows.
