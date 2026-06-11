# v2 Handoff & Context Bridge

**Audience.** A new Claude chat (or future-you) picking up after v1
deploy. This is the **start-here** document — read it before the
progress tracker. It captures current state, what still has to happen
before the pilot is truly live, gotchas discovered during the build
that aren't recorded anywhere else, and the v2 backlog (with one
item — **profile management** — written up in design detail because
the analysis was done in conversation and needs to survive).

This doc **points to authoritative docs rather than duplicating
them.** For full detail follow the links:

- [`CLAUDE.md`](../CLAUDE.md) — project rules, workflow, architecture
  invariants. Binding.
- [`docs/decisions/`](./decisions/) — ADRs 0001–0015. Binding; read
  before building.
- [`docs/feature-specs/`](./feature-specs/) — locked feature specs;
  spec 01 (LINE auth), 02 (photos + approvals), 03 (SA upload UI)
  are the v1 set.
- [`docs/go-live-checklist.md`](./go-live-checklist.md) — the
  authoritative operator runbook for the remaining go-live steps.
- [`docs/progress-tracker.md`](./progress-tracker.md) — per-unit
  history. Long; this doc summarises.

---

## 0. State refresh — 2026-06-11 (read this, then the tracker tail)

Sections 1–5 below describe the **2026-05-26** state and are kept for
history. Shipped since then (each with a numbered spec + tracker entry;
the tracker tail is authoritative):

- **Deliverable grouping** — schema + backfill + grouped SA WP list +
  per-group progress (specs 04/11/12, ADR 0016).
- **Profile management** — `/profile` route, display-name self-edit via
  SECURITY DEFINER RPC, LINE avatar (specs 05/07/08, ADR 0017/0020/0021).
- **Purchasing domain** — `purchase_requests` end-to-end: SA/PM raise
  from the WP screen, PM decides, AppSheet back office records
  purchase/delivery via the `appsheet_writer` DB role with derived
  status + SECURITY DEFINER audit (specs 09/10, ADR 0018/0022/0025).
- **Thai-first UI** — every user-facing string Thai, Sarabun webfont,
  central label maps + Buddhist-era date formatting; Thai-capable PDF
  (specs 13/14).
- **Iteration 2** — purchasing visibility (rejection comments,
  back-office facts on `/requests`), queue wait-time ordering, photo
  lightbox, route loading skeletons (spec 15).
- **Iteration 4** — shared app-shell components (AppHeader, StatusPill,
  notices, central pill maps, `fetchDisplayNames`) — behavior-preserving
  refactor (spec 17).
- **Spec 16 locked, not yet built** — purchase-request enrichment
  (unit dropdown, needed_by, AppSheet-written eta, image/link
  attachments, AppSheet image bridge). Next implementation chain:
  ADR 0026 → P1 → P2 → ADR 0027 → P3.
- **App-feel decision doc** — `docs/app-feel-options.md` (PWA vs LINE
  Mini App vs store wrappers; PWA recommended first).

Test surface now: **216 Vitest unit tests, 27 Playwright e2e, 20 pgTAP
files** (`pnpm db:test` against the linked remote for current counts).
Operational conventions that changed: the operator's standing
**"merge auto"** instruction (commit to `main`, push allowed; `main`
auto-deploys on Vercel) and per-unit specs written from operator chat
briefs (specs 14–17 precedent).

## 1. Current state (2026-05-26)

**v1 is FEATURE-COMPLETE and DEPLOYED.** The full flow works
end-to-end in production:

> SA uploads Before / During / After photos (PWA at `/sa/*`) → the
> first After photo flips the WP to `pending_approval` → PM reviews
> & records a decision at `/pm/*` (`approve` flips the WP to
> `complete`) → PM generates a per-project PDF report at
> `/pm/projects/[id]/reports` (autonomous Railway worker, cron
> `*/5`) → PM downloads via short-TTL signed URL.

### Where everything lives

| Layer                     | Where                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| App                       | Vercel — https://prc-ops.vercel.app — `main` auto-deploys.                                                     |
| Worker                    | Railway — isolated `/worker` subdir, Root Directory = `worker`, Watch Paths = `worker/**`, cron `*/5 * * * *`. |
| Database / Auth / Storage | Supabase Singapore region, project ref `btbfzhnvzruvxlgbeqnl`.                                                 |
| Auth                      | LINE Login only (ADR 0012 — custom flow, not OIDC). Channel is **published**.                                  |

### Pilot data

- Real WP data is **already imported** for both pilots: 81 WPs each
  into `PRC-2026-001` (TFG Lam Sonthi) and `PRC-2026-002` (TFG
  Kham Muang).
- Both pilots share the same WP template.
- Source CSVs carry `DeliverableID` (D01–D30) per WP; **dropped on
  import** but preserved in the source files for a v2 deliverable-
  grouping backfill (see §4).

### Test surface

| Suite                                  | Count                                                                |
| -------------------------------------- | -------------------------------------------------------------------- |
| pgTAP (`pnpm db:test`)                 | **254 across 13 files** — every table's RLS + triggers + invariants. |
| App unit (`pnpm test`)                 | **94** — pure helpers + form / list logic.                           |
| Worker unit (`cd worker && pnpm test`) | **5** — PDF composition + date formatter.                            |

### Operator polish items (mid-go-live)

The operator surfaced four polish gaps during go-live verification.
**Three shipped, one deferred:**

| Item                                                    | Status                    |
| ------------------------------------------------------- | ------------------------- |
| SA status-pill color-coding (shared `status-colors.ts`) | ✅ shipped                |
| SA "Hide completed" WP toggle                           | ✅ shipped                |
| super_admin operator hub on `/coming-soon`              | ✅ shipped                |
| **User profile management (display name)**              | ⏸ deferred to v2 — see §4 |

---

## 2. Outstanding BEFORE the pilot is truly live

These are **operational**, not v2 — they're the final
human-in-the-loop steps. The authoritative runbook is
[`docs/go-live-checklist.md`](./go-live-checklist.md). The
checklist's Sections 1–4 are the load-bearing ones; the summary
below is just so the next chat knows what's pending without
re-reading the whole runbook.

1. **Test-data cleanup** — **highest-risk step.** The append-only
   triggers on `photo_logs` and `approvals` raise `P0001` on any
   UPDATE/DELETE; the `work_packages → photo_logs` `ON DELETE
CASCADE` doesn't save you because the trigger still fires on
   the cascade. Cleanup requires `DISABLE TRIGGER USER` inside a
   single `BEGIN/COMMIT` block under the Supabase SQL editor,
   composed against the verified-live schema. **Do GUIDED with
   Claude, not solo-improvised.** Inventory: `WP-TEST-001`
   (`eaa45bd1-2990-4097-8e9b-2041d0335760`) + its 7 photo_logs
   (4 real / 3 tombstones) + its 1 approval + 3 test reports on
   PRC-2026-001 + 4 Storage objects in the `photos` bucket + 3
   PDFs in the `reports` bucket. Full detail in checklist §1.

2. **User onboarding + role promotion.** Each real user logs in
   once at `/login` via LINE → auto-created as `visitor` (ADR 0010) → super_admin promotes to `site_admin` /
   `project_manager` via SQL `UPDATE`. **There is no in-app
   admin UI in v1** (that's a v2 candidate). Promotion is
   always by `id`, never by `full_name`. Checklist §2.

3. **End-to-end dry run** with one real SA on phone and one
   real PM on web. Test BOTH approval paths (needs_revision →
   SA re-upload → re-review; and a straight approve). Confirm
   the report generates within ~5 min, downloads correctly, and
   shows the human-readable date in the PDF header. Checklist §4.

### Note for the operator (super_admin)

You currently land on `/coming-soon` (per `roleHome("super_admin")`).
That page now shows the **operator hub** (added in the
super_admin-hub unit) with links to `/sa`, `/pm`, `/pm/projects` +
logout. Use it as the launch point for testing. To exercise the
SA / PM tools as a real-feeling user you can either:

- Self-promote via SQL (`update public.users set role =
'site_admin' where id = '<your-uuid>'`) for a session, OR
- Promote a real pilot user and observe their session.

---

## 3. Operational gotchas discovered during the build

**These are NOT recorded anywhere else in the repo.** They were
learned during deploy / verify and would be expensive to
rediscover. Capturing them here so the next chat doesn't burn
hours.

### LINE channel must be **PUBLISHED**, not "Developing"

While a LINE Login channel is in **Developing** status, **only
registered testers** can complete the OAuth flow. A non-tester
new user hits a generic "unknown error" on `access.line.me`
**before** the app's callback is ever reached — so no app-side
log will show anything, and the failure looks like an app bug
when it isn't.

The fix is one click: **Publish** the channel in the LINE
Developers console. The app's authorize URL, `redirect_uri`,
callback allowlist, and `channel_id` were all already correct;
**publish status was the only blocker.** If a non-tester
account is failing at the LINE consent screen with no app log,
check publish status first.

### LINE callback allowlist is per-host

The LINE channel's "Callback URL" allowlist must contain the
**exact** production callback:
`https://prc-ops.vercel.app/auth/line/callback` (it does).
Vercel preview deployments have different hosts (`prc-ops-…vercel.app`);
**previews need their own allowlist entries** to test auth on a
preview before promoting to production. Don't assume the
preview's URL is allowlisted — it usually isn't.

### Worker installs need `--ignore-workspace`

The repo has a root `pnpm-workspace.yaml` (for `allowBuilds`).
Plain `pnpm install` inside `/worker` walks up to that
workspace and absorbs the worker, skipping the local install
and the local lockfile. **Always use `pnpm install
--ignore-workspace`** inside `/worker`. Documented in
[`worker/README.md`](../worker/README.md); repeated here so a
new chat doesn't trip over it.

### Worker deploy auto-triggers from `worker/**`

Railway's Watch Paths is set to `worker/**`, so **any push that
touches `/worker` auto-redeploys.** A push that touches only
the Next app does not redeploy the worker. The worker reads
env from Railway's injected vars (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`); local runs use `pnpm dev` which
forwards `--env-file=../.env.local`. Both paths land in
`process.env` so the worker code doesn't care which.

### Railway's auto-diagnosis can mislead

While the worker service was briefly building from the **repo
root** (before Root Directory was set to `worker`), Railway's
build diagnostics suggested adding the Next app's
`LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` env vars to the
worker — those were missing from the root-rooted build's env
checks. **Wrong fix.** The worker doesn't use them. The real
fix was setting **Root Directory = `worker`** so Railway built
only the isolated subproject. If Railway suggests env vars
that don't appear anywhere in `/worker/src/**`, suspect the
Root Directory setting before adding the var.

### Branch deletes — name has NO leading slash

`git branch -d feat/some-name`, **not** `git branch -d
/feat/some-name`. Repeated friction point during this build.
Just noting it so the next chat doesn't have to.

### Railway cron runs every 5 min 24/7

Cheap (worker exits in ~2 s when no jobs claimable), but
unnecessary before the pilot actually starts. Can be paused in
the Railway dashboard until go-live without code changes.

---

## 4. v2 backlog

The **canonical list** is [`docs/go-live-checklist.md` §7](./go-live-checklist.md#7-post-pilot--v2-backlog).
The summary below is the same set with one item — **profile
management** — written up in design detail because the analysis
was done in conversation during the build and needs to survive.

### Profile management — DESIGN NOTES (needs an ADR before building)

The deferred 4th polish item. The next v2 unit; pulling it out
because the security analysis is load-bearing and isn't recorded
in the tracker or any ADR yet.

#### Goal

Let a user edit their own **display name** (`full_name`). v1
scope = `full_name` only. `role` and `line_user_id` are
**never** user-editable. `avatar_url` is a separate v2 item
(LINE Login `profile` scope) that could extend the same write
path later.

#### Scenario to confirm in v2

Likely the surface needs to be reachable by **any authenticated
user, including a not-yet-promoted `visitor`** — a visitor
landing on `/coming-soon` should be able to correct their
display name (it's a common reason for the operator to need
their name visible before they're promoted). This implies the
write path is reachable by EVERY role, including ones that
have no other in-app capability — so it must be airtight.

#### The security risk (load-bearing — read this carefully)

Today there is **deliberately no user-write path to
`public.users`**. The existing model (per ADR 0007, ADR 0012, and
the PR 2 callback code):

- **Reads:** RLS lets a user SELECT their own row.
- **Writes:** the **auth callback** writes `full_name` /
  `line_user_id` via the **admin client** (NULL-only — never
  overwrites existing values). The only writer is server-side.

Adding self-edit is **the first user-writable path into the
most security-sensitive table in the schema.** The trap to
avoid:

> **Postgres RLS `WITH CHECK` validates the resulting row, NOT
> which columns changed.** A naive self-update policy like
> `USING (id = auth.uid()) WITH CHECK (id = auth.uid())` lets a
> user `UPDATE public.users SET role = 'super_admin' WHERE id
= auth.uid()` — the resulting row still satisfies `id =
auth.uid()`, the policy admits it, **privilege escalation
> ships.**

Column restriction must come from **somewhere other than the
policy's `WITH CHECK` alone.**

#### Three mechanisms analysed

**(a) Column-level GRANT + RLS self-update policy.**

```sql
grant update (full_name) on public.users to authenticated;
create policy "users self-update name"
  on public.users for update
  using      (id = auth.uid())
  with check (id = auth.uid());
```

Postgres column privileges enforce which columns are writable;
an `UPDATE public.users SET role = …` is rejected at the
**privilege layer** before RLS even runs. Pure-RLS, fully
DB-enforced.

**(b) Server action via admin client, hard-coded to set only
`full_name`. NO new RLS self-update policy. (The lean.)**

The table stays **write-locked from user sessions, unchanged
from today.** A new server action — role-gated to "any
authenticated user" with `id = auth.uid()` — calls the admin
client to `UPDATE public.users SET full_name = $1 WHERE id =
auth.uid()`. The single server action is the **only** writer,
and only ever touches `full_name`. The admin client lives
behind `server-only`; the column list is a literal in the
action's body.

Matches the existing pattern (auth callback already writes
`full_name` / `line_user_id` via admin client, NULL-only).
**Smallest risk surface:** no user-reachable write policy to
get wrong; no column-grant to drift; no RPC to leak. If a
future caller wants to update something else, they have to
write a new action — they can't accidentally include a column
in an existing action's payload.

**(c) SECURITY DEFINER RPC.**

```sql
create function public.update_my_display_name(p_full_name text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.users set full_name = p_full_name where id = auth.uid();
$$;

grant execute on function public.update_my_display_name(text) to authenticated;
revoke execute on function public.update_my_display_name(text) from public;
```

Users get EXECUTE on the function, not UPDATE on the table.
Also airtight, also DB-enforced. The same hygiene checklist as
ADR 0011's `current_user_role()` applies (search_path pinned,
SECURITY DEFINER, no parameters that select rows, EXECUTE
revoked from PUBLIC + authenticated allowed).

#### Recommendation carried into v2

**Lean (b)** — server action via admin client, no new RLS
self-update policy. Smallest deviation from the current "no
user-write path" stance and matches the callback pattern
already in production.

Whichever mechanism is chosen, the unit **needs an ADR amending
the "no user-write path to `public.users`" stance** from ADR
0007 / ADR 0012. The ADR must name:

- Which columns are user-writable (`full_name`).
- Which stay admin-only (`role`, `line_user_id`, `id`,
  `created_at`, `updated_at`).
- The chosen mechanism + the reason the other two were
  rejected.
- The audit posture (write the change to `audit_log`?).

Open design-grilling questions for the v2 unit (not blockers,
but worth resolving before coding):

- **Where does the profile UI live?** Options: a new
  `/profile` route reachable by every authenticated role; a
  small panel on `/coming-soon` (the visitor surface today);
  a setting in the operator hub for super_admin. The
  visitor-edits-on-/coming-soon scenario is the most
  user-friendly answer, but a separate `/profile` is more
  discoverable for promoted users.
- **Optimistic UI or pessimistic?** The change is small; a
  pessimistic round-trip with a "Saved" toast is fine.
- **Length / character constraints?** Pick a sensible max
  (e.g. 80 chars) so the column doesn't grow unbounded
  values; trim whitespace; reject empty.

### Other v2 candidates (brief — full notes in checklist §7)

| Item                                                                | Notes                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deliverable grouping in reports**                                 | Schema + importer + PDF layout change. Source CSVs already carry `DeliverableID` D01–D30 — ready to backfill.                                                                                                                           |
| **PM image curation per report**                                    | New `report_photos` join table + curation UI before generate.                                                                                                                                                                           |
| **Multi-project reports**                                           | A single PDF covering several projects.                                                                                                                                                                                                 |
| **Watermark-on-demand rendering** (ADR 0003)                        | Sits between worker and PDFKit. Originals stay unmodified.                                                                                                                                                                              |
| **Before / During photos in reports**                               | v1 is After-only; render + fetch change only.                                                                                                                                                                                           |
| **LINE profile picture / display-name refresh via `profile` scope** | Add `avatar_url text` on `users`, populate NULL-only via the callback. **Source-technique caveat:** the original reference is a Messaging-API + Google-Sheets pattern; only the Login-scoped profile fetch fits our OAuth architecture. |
| **In-app user / role admin UI**                                     | Replaces the SQL promotion step from go-live §2. ADR 0010 already flags this as the scaling trigger.                                                                                                                                    |
| **Airtable-like WP back-office + WP edit UI**                       | Bulk WP edit / remove gap from go-live §3.                                                                                                                                                                                              |
| **Separation-of-duties guard on approvals**                         | Documented spec-02 v1 gap. EXISTS subquery against `photo_logs` in the approvals INSERT policy, or an `uploaded_by` tracking column.                                                                                                    |
| **Stale-`processing` report sweep**                                 | Reaper for reports whose `updated_at` is older than (say) 15 min. Currently no recovery for crashed worker runs.                                                                                                                        |
| **Project-membership scoping**                                      | ADR 0013 upgrade path — triggered the moment an external account joins.                                                                                                                                                                 |
| **Supersede-pattern SKILL tombstone update**                        | `.claude/skills/supersede-pattern/SKILL.md` still teaches replacement-only framing; needs the ADR 0015 tombstone variant.                                                                                                               |
| **Optional `worker/railway.toml`**                                  | Reproducible deploy config; Railway auto-detect handles the current setup.                                                                                                                                                              |

---

## 5. How to work in v2 (carry the discipline forward)

The build discipline that produced v1 is what kept the merge log
clean, the test surface honest, and the architecture coherent.
**Carry it forward.**

### Source of truth

- **The repo is the source of truth; `main` is canonical.** When in
  doubt, read the code, not the docs.
- Before building anything, read in order: relevant ADRs
  ([`docs/decisions/`](./decisions/) 0001–0015 — all binding), the
  relevant feature spec ([`docs/feature-specs/`](./feature-specs/)),
  this handoff doc, and the most recent tracker entries. Existing
  ADRs override defaults.

### Workflow per unit (unchanged from v1)

1. **Stress-test the spec first** — bring it into a conversation,
   surface the weak parts, lock decisions. The locked-design
   block at the top of each spec is what survives.
2. **Write a precise Claude Code prompt.** Always names the docs
   to read. Always has scope-in / scope-out. Always has a
   verification checklist. Always has an "if-blocked" clause
   asking for confidence%.
3. **Implement on a feature branch, commit, do NOT push.**
   Operator pushes, reviews the PR in the browser,
   squash-merges, deletes the branch, syncs `main`. Merges are
   **laptop-only**.
4. **`/clear` at unit boundaries** so the next conversation
   starts on a clean context.
5. **Verify live** before trusting "it builds." For UI changes,
   actually open the page. For worker changes, run the worker
   locally end-to-end against the linked DB.

### Architecture invariants (non-negotiable)

- **RLS on every table**, gating via
  `public.current_user_role()` (ADR 0011) — **never self-join
  `public.users`** in a policy (recursion).
- **Append-only triple-enforced tables are sacred:**
  `audit_log`, `photo_logs`, `approvals`. Three layers:
  REVOKE + RLS without UPDATE/DELETE + `BEFORE UPDATE OR
DELETE` trigger that raises P0001. Bypass requires
  `DISABLE TRIGGER USER` inside a single transaction.
- **`photo_logs` uses tombstone-supersede** (ADR 0015):
  removal is an INSERT with `storage_path IS NULL` and
  `superseded_by` set; replacement is two appends. Current-
  state read is the ADR 0009 anti-join PLUS `storage_path
IS NOT NULL`.
- **No `any`.** Use `unknown` and narrow.
- **Server Components by default.** `'use client'` requires a
  justification.
- **New architectural decisions get an ADR before
  implementation.** The first user-write path to
  `public.users` (the profile-management unit) is exactly
  this kind of decision.

### File / route conventions

- Path alias `@/*` → `src/*`.
- `src/components/ui/` — shadcn primitives only.
  `src/components/features/` — feature components.
- TypeScript strict + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes` + `noImplicitOverride`.
- Migrations are immutable history once merged. Fix-forward
  with a new migration; don't edit applied ones.

### When something feels risky

The CLAUDE.md "When blocked" protocol is load-bearing: output
what you tried, what failed, what you'd do next, and a
**confidence percentage**. Then wait. The test-data cleanup
in go-live §1 is the canonical example — if any cleanup-SQL
sketch is anything less than ~95% confidence, it stops and
re-verifies.
