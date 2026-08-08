# Spec 405 U1 — the two decision-inbox tables

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo additionally requires the `ship-unit` skill for the gate order and the PR.

**Goal:** Create `agent_decisions` + `agent_decision_options` — the private, operator-only store that lets the agent ask a blocking question that survives until it is answered — with the privacy posture pinned in pgTAP, and ADR 0087 binding the rule that the agent never asks through `feedback_messages`.

**Architecture:** Two tables in `public`, both zero-write for `authenticated` and readable only by `super_admin`, all writes via the service-role admin client — the exact posture `feedback_message_drafts` already ships (mig `20260813001400`). The answer is not a column on the decision: it is `chosen_at` on the option row, with a parent-row-locking trigger enforcing single-select exclusivity. That keeps the design at two tables, makes single- and multi-select one shape, and avoids an FK cycle entirely.

**Tech Stack:** Postgres 15 via Supabase (linked remote, no local Docker — ADR 0006), pgTAP via `scripts/run-pgtap.ts`, Supabase CLI migrations.

## 🔔 BLOCKED — read before Task 1

**This unit cannot start until the operator answers spec 405 §14 Q0.** The spec's §0 ruling 5 says "two tables, the answer is an FK to the chosen option"; multi-select (§5.5) is also locked; **both cannot hold literally** because N chosen options are not one FK column and a Postgres array cannot carry an FK.

- **This plan implements option A** (recommended): the pointer moves to the option row as `chosen_at`, exclusivity by trigger. Two tables, no FK cycle.
- **If the operator picks B** (keep `answered_option_id` on the decision, add a third table `agent_decision_answers`): Task 2's table DDL gains `answered_option_id uuid references public.agent_decision_options(id) deferrable initially deferred`, Task 3's trigger is deleted, a third table is created with a composite PK `(decision_id, option_id)`, and Task 4's pgTAP becomes 4 postures × 3 tables. **Do not start Task 2 under B without re-planning it.**
- **If the operator picks C** (cut multi-select): drop `multi_select` from Task 2's DDL and simplify Task 3's trigger to an unconditional exclusivity check.

Do not guess. A wrong table shape on a live DB is a destructive migration to undo (`break-glass.md` Procedure B), not an edit.

## Global Constraints

- **SCHEMA LANE — single-writer.** Claim it in `../LANES.md` (Edit tool only; PowerShell corrupts Thai) with your branch name **before the first migration write** — `require-lane-claim.js` hook-blocks migration writes otherwise, and always blocks them on `main`.
- 🚨 **Re-query the migration head AT APPLY TIME, never at plan time.** It was `20260813075921` (== main's newest file) when this plan was written. **A number can be consumed by another lane while you build, and `db:push` then reports "Remote database is up to date" and applies NOTHING.** After any push, verify the OBJECTS you created — never the push's own success message.
- 🚨 **A NEW TABLE IS BORN PUBLIC.** `pg_default_acl` on `public` grants `anon` and `authenticated` `arwdDxtm` on new tables, so a table created with only a `grant select` is INSERT/UPDATE/DELETE-able by every signed-in user. **`revoke all … from public, anon, authenticated` comes BEFORE any grant**, in every table's DDL.
- ⚠️ **The `feedback` author-kind TYPE is `feedback_author_kind`, not `author_kind`** — `enum_range(null::public.author_kind)` fails `42704`. This unit does not touch it, but do not copy the wrong name into a comment or test.
- ⚠️ **No bare `count(*)` over these tables in pgTAP.** The agent writes them, so a global count is non-deterministic on the merge ref and **jams the merge queue repo-wide** (#954). Scope every count to fixture rows.
- ⭐ **`plan(N)` is grep-derived, never hand-counted:** `grep -cE '^select (ok|is|results_eq|lives_ok|throws_ok|has_table|has_column|col_is_pk|col_type_is)\(' <file>` and compare before running. Three ~5-minute pgTAP cycles have died to a hand-counted plan.
- ⚠️ **`throws_ok(…, 'P0001', null, …)` is VACUOUS when a function raises that code from several branches.** Pass the message.
- **DANGER PATH** (`supabase/migrations/`, `docs/decisions/`) ⇒ the guard fails BY DESIGN and the UI merge button only ENQUEUES. The only path is the admin two-step: `gh pr merge <n> --disable-auto && gh pr merge <n> --squash --admin`, then verify `mergedAt`. ⚠️ **`--admin` SKIPS the queue's pgTAP run and pgTAP short-circuits on PR refs, so the LOCAL `pnpm db:test` is the only real schema evidence for this PR.**
- ⚠️ **Do NOT run `pnpm db:types` in this unit unless live == main + your own migration only.** It is generated from the LIVE DB and imports every other lane's applied-but-unmerged schema. Check `supabase_migrations.schema_migrations` against `origin/main`'s migration files first; if anything but yours differs, defer the regen to U2, which is what actually needs the types.
- **Run repo commands through the PowerShell tool** (`Set-Location <abs worktree>; $env:PATH="C:\Program Files\Git\bin;C:\Program Files\nodejs;$env:PATH"; …`) — it never trips the `cd` guard. ⚠️ Keep `Git\bin` on that PATH or `pnpm test` reds exactly 10 `ship-pr-*` tests deterministically.
- Conventional Commits (`feat:`, `test:`, `docs:`).
- **Commit before you mutation-check.** `git checkout --` restores to HEAD, not to your working tree; run `git diff --quiet -- <paths> || { echo DIRTY; exit 1; }` as a GATE (not a printed line) before every mutation batch.

---

## File Structure

- `supabase/migrations/<head+1>_spec405u1_agent_decisions.sql` — **create**. Two enums, two tables, the exclusivity trigger + its function, revokes, grants, RLS, policies. One file: everything here is additive and interdependent, and splitting it would leave a window where the tables exist without their policies.
- `supabase/tests/database/405-agent-decisions.test.sql` — **create**. Posture pins (4 per table), the CHECK boundaries, and the trigger's behaviour.
- `docs/decisions/0087-agent-decision-channel.md` — **create**. The binding rule.
- `docs/decisions/README.md` — **modify**. One index row.
- `docs/feature-specs/405-agent-decision-inbox.md` — **modify**. Mark U1 shipped in the status line.

---

## Task 1: Claim the lane and pin the real head

**Files:**

- Modify: `../LANES.md` (outside the repo — Edit tool only)

**Interfaces:**

- Produces: `<HEAD+1>`, the migration version every later task uses in its filename.

- [ ] **Step 1: Confirm the schema lane is free**

Read `../LANES.md` WHOLE. Any open lane whose block says it touches `supabase/` means **stop and wait** — schema is single-lane against one shared remote DB.

- [ ] **Step 2: Query the live head**

```bash
pnpm exec supabase db query --linked "select version, name from supabase_migrations.schema_migrations order by version desc limit 3"
```

Expected: three rows. Take the top `version`, add 1 → `<HEAD+1>`.

- [ ] **Step 3: Confirm live == main**

```bash
git fetch origin && ls supabase/migrations/ | tail -3
```

Expected: main's newest migration filename carries the SAME version as the live head. If it does not, another lane has applied-but-unmerged schema — record that in your lane block and **do not run `db:types` at any point in this unit**.

- [ ] **Step 4: Claim the lane** (Edit tool, `../LANES.md`, under the STATUS header)

Append a block naming: the branch, the worktree, `SCHEMA LANE CLAIMED`, `<HEAD+1>`, and that this is a danger-path PR needing the admin two-step.

- [ ] **Step 5: Commit** (nothing repo-side yet — LANES.md is outside the repo; no commit)

---

## Task 2: The two tables, RED first

**Files:**

- Create: `supabase/tests/database/405-agent-decisions.test.sql`
- Create: `supabase/migrations/<HEAD+1>_spec405u1_agent_decisions.sql`

**Interfaces:**

- Produces: tables `public.agent_decisions`, `public.agent_decision_options`; enums `public.agent_decision_status` (`open|answered|withdrawn`), `public.agent_decision_effect` (`answer|refine|session|decline`).

- [ ] **Step 1: Write the failing test** — `supabase/tests/database/405-agent-decisions.test.sql`

```sql
begin;
select plan(14);

-- existence
select has_table('public', 'agent_decisions', 'agent_decisions exists');
select has_table('public', 'agent_decision_options', 'agent_decision_options exists');
select has_column('public', 'agent_decision_options', 'chosen_at', 'the answer lives on the option row');
select has_column('public', 'agent_decisions', 'interpretation_pct', 'interpretation confidence is stored');

-- posture: authenticated may READ and may do nothing else
select ok(has_table_privilege('authenticated', 'public.agent_decisions', 'SELECT'),
  'authenticated may SELECT agent_decisions');
select ok(not has_table_privilege('authenticated', 'public.agent_decisions', 'INSERT'),
  'authenticated may NOT INSERT agent_decisions');
select ok(not has_table_privilege('authenticated', 'public.agent_decisions', 'UPDATE'),
  'authenticated may NOT UPDATE agent_decisions');
select ok(not has_table_privilege('authenticated', 'public.agent_decisions', 'DELETE'),
  'authenticated may NOT DELETE agent_decisions');
select ok(not has_table_privilege('anon', 'public.agent_decisions', 'SELECT'),
  'anon may NOT SELECT agent_decisions');

select ok(has_table_privilege('authenticated', 'public.agent_decision_options', 'SELECT'),
  'authenticated may SELECT agent_decision_options');
select ok(not has_table_privilege('authenticated', 'public.agent_decision_options', 'INSERT'),
  'authenticated may NOT INSERT agent_decision_options');
select ok(not has_table_privilege('authenticated', 'public.agent_decision_options', 'UPDATE'),
  'authenticated may NOT UPDATE agent_decision_options');
select ok(not has_table_privilege('authenticated', 'public.agent_decision_options', 'DELETE'),
  'authenticated may NOT DELETE agent_decision_options');
select ok(not has_table_privilege('anon', 'public.agent_decision_options', 'SELECT'),
  'anon may NOT SELECT agent_decision_options');

select * from finish();
rollback;
```

- [ ] **Step 2: Derive the plan number, then run RED**

```bash
grep -cE '^select (ok|is|results_eq|lives_ok|throws_ok|has_table|has_column|col_is_pk|col_type_is)\(' supabase/tests/database/405-agent-decisions.test.sql
```

Expected: `14`, matching `plan(14)`. Then:

```bash
pnpm exec tsx scripts/run-pgtap.ts 405-agent-decisions > /tmp/pg405.log 2>&1; grep -E "not ok|# Looks like" /tmp/pg405.log
```

Expected: FAIL — `not ok 1 - agent_decisions exists` and onward. ⚠️ pgTAP prints failures as lowercase `not ok N`, which matches neither `FAIL` nor `✕`; redirect the whole log and grep it afterwards, because a filtered capture cannot be re-grepped.

- [ ] **Step 3: Write the migration** — `supabase/migrations/<HEAD+1>_spec405u1_agent_decisions.sql`

```sql
-- Spec 405 U1 — the private agent→operator decision inbox.
-- Posture mirrors feedback_message_drafts (mig 20260813001400): RLS on, SELECT to
-- authenticated gated to super_admin by policy, every write via service_role.
-- A new table is born PUBLIC here (pg_default_acl grants anon+authenticated
-- arwdDxtm), so the revoke comes BEFORE the grant, on both tables.

create type public.agent_decision_status as enum ('open', 'answered', 'withdrawn');
create type public.agent_decision_effect as enum ('answer', 'refine', 'session', 'decline');

create table public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_number bigint generated always as identity,
  header text not null,
  question text not null,
  context text,
  interpretation_pct smallint not null,
  multi_select boolean not null default false,
  status public.agent_decision_status not null default 'open',
  feedback_id uuid references public.feedback (id) on delete set null,
  spec_ref text,
  round smallint not null default 0,
  session_brief text,
  answer_note text,
  answered_at timestamptz,
  answered_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_decisions_header_len check (char_length(header) between 1 and 12),
  constraint agent_decisions_interpretation_range check (interpretation_pct between 0 and 100)
);

create table public.agent_decision_options (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.agent_decisions (id) on delete cascade,
  sort_order smallint not null,
  label text not null,
  consequence text not null,
  recommended boolean not null default false,
  confidence_pct smallint,
  preview_path text,
  reversal text,
  effect_kind public.agent_decision_effect not null,
  chosen_at timestamptz,
  constraint agent_decision_options_confidence_range
    check (confidence_pct is null or confidence_pct between 0 and 100)
);

create unique index agent_decision_options_one_recommended
  on public.agent_decision_options (decision_id) where recommended;
create index agent_decision_options_by_decision
  on public.agent_decision_options (decision_id, sort_order);
create index agent_decisions_open_by_age
  on public.agent_decisions (created_at) where status = 'open';

revoke all on public.agent_decisions from public, anon, authenticated;
revoke all on public.agent_decision_options from public, anon, authenticated;
grant select on public.agent_decisions to authenticated;
grant select on public.agent_decision_options to authenticated;

alter table public.agent_decisions enable row level security;
alter table public.agent_decision_options enable row level security;

create policy "agent decisions readable by super_admin" on public.agent_decisions
  for select using ((select public.current_user_role()) = 'super_admin');
create policy "agent decision options readable by super_admin" on public.agent_decision_options
  for select using ((select public.current_user_role()) = 'super_admin');
```

- [ ] **Step 4: Apply it and verify the OBJECTS, not the message**

```bash
pnpm db:push
```

Then, regardless of what push printed:

```bash
pnpm exec supabase db query --linked "select to_regclass('public.agent_decisions') a, to_regclass('public.agent_decision_options') b, (select name from supabase_migrations.schema_migrations where version = '<HEAD+1>') applied_name"
```

Expected: both non-null, and `applied_name` is **yours** (`spec405u1_agent_decisions`). If push said "Remote database is up to date" and `applied_name` is someone else's, another lane consumed your number — pick a new one and re-apply.

- [ ] **Step 5: Run the test GREEN**

```bash
pnpm exec tsx scripts/run-pgtap.ts 405-agent-decisions > /tmp/pg405.log 2>&1; grep -E "not ok|# Looks like|ok 14" /tmp/pg405.log
```

Expected: no `not ok` lines; 14/14.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests/database/405-agent-decisions.test.sql
git commit -m "feat(decisions): agent_decisions + agent_decision_options, operator-private"
```

---

## Task 3: The exclusivity trigger

**Files:**

- Modify: `supabase/migrations/<HEAD+2>_spec405u1_option_exclusive.sql` (Create — a NEW file; **never edit an applied migration**, the CLI keys on the version and a re-push silently no-ops)
- Modify: `supabase/tests/database/405-agent-decisions.test.sql`

**Interfaces:**

- Produces: `public.agent_decision_option_exclusive()` trigger function, raising `P0001` with message `decision already has a chosen option`.

- [ ] **Step 1: Write the failing tests** — append to `405-agent-decisions.test.sql`, and raise `plan(14)` to `plan(18)`

```sql
-- fixtures
insert into public.agent_decisions (id, header, question, interpretation_pct, multi_select)
values ('00000000-0000-4000-8000-000000000401', 'ทดสอบ', 'q?', 60, false),
       ('00000000-0000-4000-8000-000000000402', 'ทดสอบ2', 'q?', 60, true);
insert into public.agent_decision_options (id, decision_id, sort_order, label, consequence, effect_kind)
values ('00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000401', 1, 'a', 'does a', 'answer'),
       ('00000000-0000-4000-8000-000000000412', '00000000-0000-4000-8000-000000000401', 2, 'b', 'does b', 'answer'),
       ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000402', 1, 'a', 'does a', 'answer'),
       ('00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000402', 2, 'b', 'does b', 'answer');

select lives_ok(
  $$update public.agent_decision_options set chosen_at = now()
      where id = '00000000-0000-4000-8000-000000000411'$$,
  'the first choice on a single-select card is accepted');

select throws_ok(
  $$update public.agent_decision_options set chosen_at = now()
      where id = '00000000-0000-4000-8000-000000000412'$$,
  'P0001',
  'decision already has a chosen option',
  'a SECOND choice on a single-select card is refused, by message not just SQLSTATE');

select lives_ok(
  $$update public.agent_decision_options set chosen_at = now()
      where id = '00000000-0000-4000-8000-000000000421'$$,
  'multi-select: first choice accepted');

select lives_ok(
  $$update public.agent_decision_options set chosen_at = now()
      where id = '00000000-0000-4000-8000-000000000422'$$,
  'multi-select: SECOND choice also accepted — the positive control that isolates multi_select as the only difference');
```

⚠️ The last two are the **positive control**: without them, the refusal test cannot distinguish "the trigger reads `multi_select`" from "the trigger refuses everything".

- [ ] **Step 2: Re-derive the plan and run RED**

```bash
grep -cE '^select (ok|is|results_eq|lives_ok|throws_ok|has_table|has_column|col_is_pk|col_type_is)\(' supabase/tests/database/405-agent-decisions.test.sql
```

Expected: `18`. Update `plan(14)` → `plan(18)`. Then run; expected FAIL on the `throws_ok` (no trigger yet, so the second update succeeds and nothing is raised).

- [ ] **Step 3: Write the trigger migration**

```sql
-- Spec 405 U1 — single-select exclusivity. A partial unique index cannot do this:
-- an index sees only its own table's columns and multi_select lives on the parent.
-- The FOR UPDATE row lock is load-bearing — without it two concurrent taps both
-- read zero chosen options and both write.
create or replace function public.agent_decision_option_exclusive()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_multi boolean;
begin
  if new.chosen_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.chosen_at is not null then
    return new;  -- already chosen; not a new choice
  end if;

  select d.multi_select into v_multi
    from public.agent_decisions d
   where d.id = new.decision_id
     for update;

  if coalesce(v_multi, false) then
    return new;
  end if;

  if exists (
    select 1 from public.agent_decision_options o
     where o.decision_id = new.decision_id
       and o.chosen_at is not null
       and o.id <> new.id
  ) then
    raise exception 'decision already has a chosen option' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.agent_decision_option_exclusive() from public, anon, authenticated;

create trigger agent_decision_options_exclusive
  before insert or update of chosen_at on public.agent_decision_options
  for each row execute function public.agent_decision_option_exclusive();
```

⚠️ `coalesce(v_multi, false)` is deliberate — an unmatched `select into` leaves `v_multi` NULL, and a NULL would fall through the `if` and skip the exclusivity check. This is the RLS coalesce trap in trigger form.

- [ ] **Step 4: Apply, verify the object, run GREEN**

```bash
pnpm db:push
pnpm exec supabase db query --linked "select tgname from pg_trigger where tgrelid = 'public.agent_decision_options'::regclass and not tgisinternal"
```

Expected: `agent_decision_options_exclusive`. Then re-run the pgTAP; expected 18/18, no `not ok`.

- [ ] **Step 5: Mutation-check the trigger**

Commit first (`git diff --quiet -- supabase/ || { echo DIRTY; exit 1; }`). Then, in a **rollback-wrapped** transaction, replace `coalesce(v_multi, false)` with `v_multi` and confirm nothing changes (both arms still pass, proving the coalesce is untested), then instead delete the `raise exception` line and confirm the `throws_ok` reds **by message**. Restore, re-run 18/18, and `git status` to confirm the tree came back.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests/database/405-agent-decisions.test.sql
git commit -m "feat(decisions): single-select exclusivity trigger with parent row lock"
```

---

## Task 4: ADR 0087

**Files:**

- Create: `docs/decisions/0087-agent-decision-channel.md`
- Modify: `docs/decisions/README.md`

- [ ] **Step 1: Re-confirm 0087 is free**

```bash
ls docs/decisions/ | tail -3 && grep -oE "^\| 008[0-9]" docs/decisions/README.md | tail -2
```

Expected: highest file `0086-…`, highest index row `| 0086`. ⚠️ A directory listing is **branch-relative** and has produced a wrong ADR number in this repo before — check BOTH, on a tree created from `origin/main`.

- [ ] **Step 2: Write the ADR**

Title: `Agent→operator decisions have their own private channel`. Body states the binding rule and its two halves:

> The agent does not ask the operator a blocking question through `feedback_messages`. It writes an `agent_decisions` card, readable only by `super_admin`. **An unanswered card never becomes consent** — it escalates by age and never auto-acts.

Include the measured context (78 agent messages / 62 threads / 5 operator replies, last 2026-06-28; 45 of 62 threads unread; the submitter policy carries no `author_kind` filter) and note that it supersedes the auto-publish tier retired from `triage-feedback` on 2026-08-08.

- [ ] **Step 3: Add the index row** to `docs/decisions/README.md`, matching the existing column widths.

- [ ] **Step 4: Verify formatting**

```bash
pnpm exec prettier --check docs/decisions/0087-agent-decision-channel.md docs/decisions/README.md
```

Expected: `All matched files use Prettier code style!` ⚠️ Never `pnpm format` — it rewrites ~55 unrelated files.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions
git commit -m "docs(adr): 0087 — agent decisions get a private channel, silence is not consent"
```

---

## Task 5: Ship

- [ ] **Step 1: Full local gates**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm db:test
```

⚠️ Run these with `Git\bin` on PATH or `pnpm test` reds exactly 10 `ship-pr-*` tests deterministically — that is the shell, not your change. `pnpm db:test` must be **fully green**: `known-red.json` has been empty since #955, so any pgTAP red is yours or another lane's, and an unpinned red ejects every lane from the merge queue.

- [ ] **Step 2: Fresh-eyes review** — dispatch the `unit-reviewer` subagent over the full diff (`git diff origin/main...HEAD`). Address every finding, verifying each against the code before agreeing.

- [ ] **Step 3: Ship**

```bash
bash scripts/ship-pr.sh "feat(decisions): spec 405 U1 — the private decision inbox tables" "<body>"
```

⚠️ **Positional args** — a flag-style call silently titles the PR `--title` and drops the body. Read it back with `gh pr view <n> --json title,body`.

- [ ] **Step 4: Merge via the admin two-step** (danger path — the guard fails BY DESIGN)

```bash
gh pr merge <n> --disable-auto && gh pr merge <n> --squash --admin
```

Then verify `mergedAt` is set — the UI button only ENQUEUES, and `updatedAt` frozen at your own push means the command never ran.

- [ ] **Step 5: Close the loop** — move the lane block to `../LANES.archive.md`, refresh the STATUS line, mark U1 shipped in the spec's status line, and update the memory topic file.

---

## Self-Review

**Spec coverage.** §4.1 → Task 2's `agent_decisions` DDL. §4.2 → Task 2's options DDL + Task 3's trigger. §4.3 (revoke-first, drafts precedent, four postures + positive control) → Task 2 Steps 3 and 1. §5.3's ≤12 header CHECK → `agent_decisions_header_len`. §5.5 multi-select → Task 3's positive-control tests. §13.1's ADR → Task 4. §13.4's "keep `round`, add no `policy` column" → Task 2's DDL has `round` and no `policy`.

**Not covered here, by design:** §5's rendering, §6's dashboard card, §7's escalation, §8's digest, §9's component reuse, §12's skill change — those are U2–U5 and the already-shipped skill retirement.

**Type consistency.** `chosen_at` is the answer column in Task 2's DDL, Task 2's `has_column` pin, Task 3's trigger, and Task 3's tests. `agent_decision_option_exclusive()` is named identically in the migration, the `create trigger`, and Task 3 Step 4's verification query. The refusal message `decision already has a chosen option` is byte-identical in the `raise exception` and the `throws_ok`.

**⚠️ One thing to measure in Task 2, not assume.** `char_length` counts code points, so the ≤12 CHECK — lifted from AskUserQuestion's English-facing "max 12 characters" — is tighter for Thai, where vowels and tone marks are separate code points (`ผมเข้าใจผิด` is 11 code points for 8 visual clusters). **Before committing Task 2, run `select char_length('<3 or 4 realistic Thai headers>')` and confirm 12 is workable.** If it is not, widen the CHECK and record in spec §5.3 that the app's limit diverges from the SDK's for a measured reason — do not silently ship a constraint that refuses every real Thai header.
