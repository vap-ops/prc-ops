# v1 Go-Live & Dry-Run Checklist

This is the operator's runbook for taking the two pilot projects live and
validating them end-to-end. Work top to bottom, tick the boxes, don't
skip the cleanup section. Written for a solo non-developer operator —
every step is explicit; nothing is left to "you'll figure it out."

If a step looks risky and the runbook hand-waves it, **stop and ask
Claude in a focused session.** Better five minutes of clarification
than an irreversible mistake against production.

---

## 0. Current state

- **App** — live at https://prc-ops.vercel.app (Vercel, main branch
  auto-deploys).
- **PDF worker** — live on Railway. Root Directory = `/worker`; Watch
  Paths = `worker/**` (so a `/worker` change auto-redeploys); cron
  `*/5 * * * *` (the worker runs once per 5 min and exits).
- **Database** — Supabase project `btbfzhnvzruvxlgbeqnl`. Migrations
  in `supabase/migrations/`; applied to remote via `pnpm db:push`.
- **Pilots seeded** — two projects, each with 81 imported WPs:
  - `PRC-2026-001` — TFG Lam Sonthi
  - `PRC-2026-002` — TFG Kham Muang
- **Operator account** — Pattrawut (you) is `super_admin`. Every
  promotion, every cleanup SQL, every dashboard action below is your
  responsibility — there is no second admin in v1.
- **Auth** — LINE Login only (ADR 0012). New sign-ins are auto-created
  with role `visitor` (ADR 0010) and land on `/coming-soon` until you
  promote them.

---

## 1. Pre-go-live test-data cleanup ⚠️ **HIGHEST-RISK STEP**

> **STATUS — COMPLETE (verified live 2026-06-10).** Executed 2026-06-07 via
> the change-management emergency path and logged as `audit_log` row
> `56a4d80e-…` (`action='other'`; cited as the exemplar in
> `docs/policies/change-management.md` §1). Read-only audit 2026-06-10
> confirmed: WP-TEST-001 gone, zero child rows, zero reports rows, zero
> photo/PDF objects under the project prefix (only zero-byte
> `.emptyFolderPlaceholder` dashboard artifacts remain — cosmetic), all
> append-only block triggers re-enabled, PRC-2026-002 clean, and
> `db push --dry-run` reports "Remote database is up to date."
>
> **One out-of-inventory item found:** WP01 on PRC-2026-001 carries test
> photos by Pattrawut dated 2026-05-25 — one **visible Before photo** plus a
> During photo already tombstoned. Remove the visible one **in-app** (open
> WP01 as SA → Remove). No SQL — the append-only rows stay, as designed.

You uploaded test photos and ran test reports while validating the
build. That test data is sitting in the same tables as the real
pilot data and needs to be removed **before** real users start
relying on the pilots. Otherwise it will appear in reports, queues,
and the project's history.

### Why this is high-risk

`photo_logs` and `approvals` are **append-only** with `BEFORE
UPDATE OR DELETE` triggers that **raise on DELETE**. A plain
`delete from public.photo_logs where id = …` will fail with
`P0001: photo_logs is append-only`. Cleanup requires temporarily
disabling those triggers in a **single transaction** under a
**service-role / superuser context** in the Supabase SQL editor —
the only path that bypasses RLS and lets the DELETE through.

The work_packages → photo_logs FK is `ON DELETE CASCADE`, but
the cascade is from the database engine's perspective — the
trigger on `photo_logs` still fires on the CASCADE-driven DELETE
and still raises. So a "delete the WP and let it cascade" shortcut
**will also fail** unless the same trigger-disable wrap is in
place. Plan accordingly: disable the triggers, do every delete in
one transaction, re-enable, commit.

### Critical instruction — before composing the SQL

**Do NOT improvise destructive SQL from memory.** Open a focused
session with Claude and re-verify each of these against the live
schema in the current migrations before running anything:

1. The exact name of the `photo_logs` block-write trigger
   (`photo_logs_block_update`, `photo_logs_block_delete` — confirm
   in `supabase/migrations/20260524020000_create_photo_logs.sql`).
2. The exact name of the `approvals` block-write trigger (confirm
   in `supabase/migrations/20260524030000_create_approvals.sql`).
3. The work_packages → photo_logs FK behaviour (`ON DELETE
CASCADE`, confirm in
   `supabase/migrations/20260524020000_create_photo_logs.sql`).
4. The work_packages → approvals FK behaviour.
5. Whether there is any reports → projects FK dependency that
   would prevent a per-row delete on `reports` (confirm
   `supabase/migrations/20260525000000_create_reports.sql`).
6. The **bucket paths** for the test photos
   (`{project_id}/{wp_id}/…`) and the test PDFs
   (`{project_id}/{report_id}.pdf`) — confirm against
   `src/lib/photos/path.ts` and
   `worker/src/index.ts` respectively.

Once verified, compose the SQL inside a single `BEGIN; … COMMIT;`
block in the Supabase SQL editor, with `ALTER TABLE … DISABLE
TRIGGER USER;` at the top and `ENABLE TRIGGER USER;` at the
bottom. Storage object deletion is a separate operation (Storage
dashboard or `storage.objects` DELETE) and must happen **inside
the same maintenance window** so the bucket and the table stay
in sync.

This section deliberately **does not include the actual SQL**.
The SQL must be composed against the verified-live schema at
execution time. Treat composing it as a separate, deliberate
step with Claude's help in a focused session.

### What to remove (the verified inventory)

#### Project `PRC-2026-001` (TFG Lam Sonthi) — id `c2cc7c02-...`

##### Test work_package

- `WP-TEST-001` — id `eaa45bd1-2990-4097-8e9b-2041d0335760`

##### Children of `WP-TEST-001` to remove first (FK order: children → parent)

- **7 `photo_logs` rows** for this WP:
  - 4 real photos (one `storage_path` each, non-null):
    - `6ff81817…jpeg`
    - `eefd9a3a…png`
    - `a68bb0ed…png`
    - `f06cab29…jpeg`
  - 3 tombstones (`storage_path IS NULL`, `superseded_by` set):
    - `57fafbd9…`
    - `6260932e…`
    - `e333bee7…`
- **1 `approvals` row** for this WP:
  - `90cfa068…`

##### Storage objects to remove (the `photos` bucket)

- The 4 real photo objects under
  `c2cc7c02-…/eaa45bd1-…/` — the same 4 jpeg/png files
  enumerated above. Tombstones have no Storage object
  (`storage_path` is NULL by definition).

##### Then the parent

- The `WP-TEST-001` row itself.

##### Test reports (independent of the test WP — different parent path)

- **3 `reports` rows** for project `PRC-2026-001`:
  - `7887e9eb…`
  - `5bdbabc4…`
  - `1bda8473…`
- **3 PDF objects** in the `reports` bucket at
  `c2cc7c02-…/{report_id}.pdf` for those three report ids.

#### Project `PRC-2026-002` (TFG Kham Muang)

No known test data on this project. Re-verify before the cleanup
window by running, under super_admin in the SQL editor:

```sql
select id, code, name, status
  from public.work_packages
 where project_id = (select id from public.projects where code = 'PRC-2026-002')
   and (code ilike 'WP-TEST%' or name ilike '%test%');

select id, status, storage_path
  from public.reports
 where project_id = (select id from public.projects where code = 'PRC-2026-002');
```

If either returns rows, add them to the cleanup inventory **before
composing the SQL**.

### Order of operations

1. Open the maintenance window. Tell any active pilot user (none
   should exist yet at this stage — that's the point of doing
   this before onboarding) to hold.
2. In the Supabase SQL editor, run the re-verify queries above.
3. **Compose** the cleanup SQL in a focused session with Claude.
   The composed SQL must:
   - Wrap everything in `BEGIN; … COMMIT;`.
   - Temporarily `DISABLE TRIGGER USER` on `public.photo_logs`
     and `public.approvals`.
   - DELETE in this order: approvals → photo_logs → work_packages
     → reports.
   - Re-enable the triggers before commit.
4. Run the composed SQL. Read the row counts in the result tab —
   they must match the inventory exactly.
5. **Then** delete the storage objects in the Storage dashboard
   (or via a separate SQL block against `storage.objects`):
   the 4 photos in the `photos` bucket and the 3 PDFs in the
   `reports` bucket.
6. Verify clean: load `/sa`, click PRC-2026-001 — no
   `WP-TEST-001` in the WP list. Load `/pm/projects/<PRC-2026-001>/reports`
   — no reports listed.

- [x] Re-verified trigger names + FK behaviour against current migrations _(re-verified 2026-06-10)_
- [x] Re-verified `PRC-2026-002` has no surprise test data _(live audit 2026-06-10: clean)_
- [x] Composed the cleanup SQL with Claude in a focused session
- [x] Ran the SQL — row counts matched the inventory _(2026-06-07; audit row `56a4d80e-…`)_
- [x] Deleted the 4 test photos from the `photos` bucket _(verified: 0 objects remain)_
- [x] Deleted the 3 test PDFs from the `reports` bucket _(verified: 0 objects remain)_
- [ ] Removed the stray WP01 Before photo in-app _(out-of-inventory find, 2026-06-10 — see STATUS note above)_
- [ ] Spot-checked `/sa` and `/pm/projects` — no test data visible

---

## 2. User onboarding & role promotion

### Mechanism

1. The real user visits **https://prc-ops.vercel.app/login** on
   their device (SAs on phone, PMs on laptop) and taps "Log in
   with LINE".
2. They complete LINE consent on their phone.
3. The app's callback handler creates an `auth.users` row, the
   trigger creates the matching `public.users` row, and the
   column default lands them at role `'visitor'` (ADR 0010).
4. They are redirected to `/coming-soon` and see a "your account
   exists; tools for your role are not yet live" message. **This
   is expected** — they have signed up, but you haven't promoted
   them yet.
5. You (super_admin) promote them with a SQL `UPDATE` in the
   Supabase SQL editor.

### How to find a newly-signed-in user

In the Supabase SQL editor:

```sql
select id, full_name, line_user_id, role, created_at
  from public.users
 order by created_at desc
 limit 20;
```

The newest rows (top of the result) are the people who just
signed in. Match them by `full_name` against the person who told
you they just logged in. `line_user_id` is the LINE `sub` claim —
useful as a tiebreaker if two people share a name.

### Promotion SQL (by id, the unambiguous form)

```sql
update public.users
   set role = 'site_admin'      -- or 'project_manager'
 where id = '<paste-the-uuid-here>';
```

**Always promote by `id`, never by `full_name` or `line_user_id`**
— `full_name` can collide; `id` cannot.

Roles for the v1 pilot:

| Role              | Who                                                                       |
| ----------------- | ------------------------------------------------------------------------- |
| `site_admin`      | The field people uploading Before/During/After photos.                    |
| `project_manager` | The people approving WPs and generating reports.                          |
| `super_admin`     | **You only** (Pattrawut). Don't promote anyone else to super_admin in v1. |

### Caveats to set expectations on

- **No in-app admin UI in v1.** Promotion is SQL-only and
  operator-run. An admin UI for visitor promotion is a v2
  candidate (ADR 0010 already flags it as a future unit).
- **Role-level access only, no project membership** (ADR 0013).
  Every `site_admin` sees every project. Every `project_manager`
  sees every project. This is fine for the two-project, single-
  team pilot. If you onboard an external PM later, the project
  membership upgrade is the trigger to switch to per-project
  scoping.
- **Never share the service-role key.** Promotion happens in the
  Supabase dashboard, signed in as you. Don't paste the
  `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` anywhere outside
  Vercel / Railway / your local machine.

### Roster snapshot — live audit 2026-06-10

| User               | Role        | Created    | Note                                                                       |
| ------------------ | ----------- | ---------- | -------------------------------------------------------------------------- |
| Pattrawut          | super_admin | 2026-05-23 | Operator ✓                                                                 |
| MMApichai (อภิชัย) | super_admin | 2026-05-28 | ⚠️ Runbook says Pattrawut only — demote to `project_manager` or record why |
| Natch.r 🙃         | super_admin | 2026-05-30 | ⚠️ Same                                                                    |
| Preston Inter      | site_admin  | 2026-05-25 | ✓                                                                          |
| Neno               | site_admin  | 2026-06-06 | ✓                                                                          |
| Nichap.            | visitor     | 2026-06-07 | Pending promotion (or intentionally parked)                                |
| นัด 🅽🅰︎🅳🅳🅰︎ 🧿     | visitor     | 2026-06-09 | Pending promotion (or intentionally parked)                                |

**No `project_manager` exists yet** — the §4 dry run requires one real PM.
Likely resolution: the two extra super_admins are the PM candidates; the §2
promotion SQL works for demotion too (`set role = 'project_manager'`), and
doing that resolves both findings at once. Operator's call.

### Checklist (per user)

- [ ] User logged in once at /login and landed on /coming-soon
- [ ] Found their `public.users` row via the listing query
- [ ] Ran the `UPDATE` with their `id`
- [ ] Confirmed: they reload `/login` → lands on `/sa` or `/pm`

Repeat for every pilot user.

---

## 2a. AppSheet writer activation & smoke test

> **STATUS — COMPLETE except one attestation (verified live 2026-06-10).**
> Password was set 2026-06-08 with the compliance audit row
> (`payload.event = 'set appsheet_writer password'`); the role now has
> LOGIN. Tier-2b ran end-to-end on 2026-06-08: throwaway requisition
> `fcf4179d-…` ("SMOKE TEST — … safe to leave") was approved through the
> native flow (`purchase_request_decision` audit row) and purchased by a
> real `appsheet_writer` session — its `purchase_request_purchase` audit
> row reads `principal = 'appsheet_writer'`, re-verified live 2026-06-10.
> Only the smoke script's `[PASS]` output cannot be verified from the DB
> (the script rolls back by design) — tick that box yourself if you ran it.
> Next integration step (outside this checklist): point the actual AppSheet
> app at the Session Pooler with these credentials.

The `appsheet_writer` DB role ships `NOLOGIN`. After `pnpm db:push` merges the
Purchasing P2 migrations, the operator must set a password out-of-band (the
password must **never** appear in git or migrations — see ADR 0018 § Password
handling) and then run the smoke ritual below to confirm the integration path
end-to-end.

### Step 1 — Set the password (Supabase SQL editor, as super_admin)

```sql
alter role appsheet_writer with login password '<generate-a-secret>';
insert into public.audit_log (action, target_table, payload)
values ('other', null,
  jsonb_build_object('event', 'set appsheet_writer password', 'at', now()));
```

Generate the password with a password manager — never reuse credentials from
other roles. Record the hash out-of-band (e.g. in your team vault). The audit
log insert is the compliance record that the action was taken.

### Step 2 — Confirm connectivity (psql via Session Pooler)

```bash
psql "postgresql://appsheet_writer:<password>@<supabase-session-pooler-host>:5432/<db-name>"
```

A successful `psql` prompt means the role is NOLOGIN→LOGIN transition worked.

### Step 3 — Run the smoke script

```bash
psql "postgres://appsheet_writer:<password>@<session-pooler-host>:5432/<db-name>" \
  -f supabase/scripts/smoke/appsheet_writer_p2.sql
```

The script is the committed, re-runnable Tier-2 ritual (see ADR 0025 § Testing
note). It is wrapped in `BEGIN … ROLLBACK` — no production data is changed.

What it proves (things pgTAP cannot verify from its postgres session):

| Check  | What it verifies                                                                |
| ------ | ------------------------------------------------------------------------------- |
| `[1]`  | RLS visibility: `requested`/`rejected` rows are invisible                       |
| `[2a]` | Purchase transition: setting `purchased_at` auto-advances status to `purchased` |
| `[3a]` | `UPDATE status` → 42501                                                         |
| `[3b]` | `UPDATE item_description` → 42501                                               |
| `[3c]` | `INSERT` → 42501                                                                |

**Expected output: every labelled line reads `[PASS]`.** Any `[FAIL]` line
requires investigation before sign-off. The `[MANUAL][2b]` line is
informational — it is handled in Step 4 below.

### Step 4 — Verify audit principal (Tier-2b, one-time)

`appsheet_writer` has no `SELECT` on `audit_log`, so the principal-capture
assertion (`payload->>'principal' = 'appsheet_writer'`) is not automatable
within the script. Run the **Tier-2b** steps at the end of
`supabase/scripts/smoke/appsheet_writer_p2.sql` — the file has the exact SQL
and sub-steps. In summary:

1. In the **native app**: create a new purchase requisition with
   `item_description = 'SMOKE TEST — appsheet_writer principal check — safe to leave'`
   and approve it through the native PM review flow. Do not use an existing
   pilot requisition — smoke data must not commit onto a real row.
2. As **`appsheet_writer` in psql**: commit the purchase UPDATE on that row
   (no `ROLLBACK`). The exact SQL is in the script.
3. As **`super_admin`** in the SQL editor: assert `principal = 'appsheet_writer'`
   in the `audit_log` row for that `target_id`. Expected result is in the script.

**No reset step.** Leave the throwaway requisition in its `'purchased'` state —
it is self-identifying test data. Do not reverse it with an ad-hoc SQL-editor
`UPDATE`: that violates `change-management.md §1` and writes a spurious audit
row. If it must be removed later, use the controlled service-role path from
§1 of this checklist.

### Checklist

- [x] Password set in Supabase SQL editor; audit log row inserted _(2026-06-08; role has LOGIN)_
- [x] psql connection as appsheet*writer succeeded *(implied by the committed Tier-2b purchase)\_
- [ ] Smoke script: all checks returned `[PASS]`, no `[FAIL]` lines _(not DB-verifiable — operator attests)_
- [x] Tier-2b: throwaway requisition created + approved via native app _(`fcf4179d-…`, 2026-06-08)_
- [x] Tier-2b: audit row confirmed `principal = 'appsheet_writer'` _(re-verified live 2026-06-10)_

---

## 3. Per-project WP adjustments (if needed)

Both pilots got the **same 81-WP template** from the seed import.
If a pilot needs WPs different from that template, here are the
v1 options and limits.

### What's possible in v1

- **Adding new WP codes to a project.** Prepare a CSV containing
  **only the new codes** (NOT the existing ones — the importer
  rejects the whole file on any conflict, see below), then:
  ```sh
  pnpm import:wp PRC-2026-00X path/to/new-codes-only.csv
  ```
  This appends new WPs into the existing project.

### What's NOT possible in v1 (and how to do it anyway)

- **Re-importing to update existing WPs.** The importer is
  **error-on-conflict** (`src/lib/wp-import/parse.ts:70`): if a
  CSV row's code already exists for the target project, the
  importer fails the whole file with `code "…" already exists for
this project` and inserts nothing. Updating an existing WP
  through the import path is **not supported in v1**.
- **Editing a WP's name / description / code.** No in-app UI.
  This is a manual SQL `UPDATE` against `public.work_packages`
  in the Supabase dashboard (super_admin only). For a one-off
  fix, fine. For a bulk re-do, this is back-office territory.
- **Removing a WP.** No in-app UI. Same SQL caveats as the
  test-data cleanup (Section 1) apply: if any `photo_logs` /
  `approvals` rows exist for that WP, you'll hit the append-only
  triggers and need the same disable-trigger / wrap-in-transaction
  approach.

### When to flag for v2

If a pilot needs **bulk WP divergence** from the template
(different WPs per site, not just additions), this is effectively
a v2 / back-office concern. The Airtable-like WP back-office
listed in Section 7 is the right venue. Don't try to do bulk
edits via SQL in v1.

### Checklist

- [ ] Each pilot's WP list matches what the project actually needs
- [ ] If additions were made: CSV contained ONLY new codes; import succeeded
- [ ] If edits / removals are needed but skipped: flagged for v2

---

## 4. Dry run

The validation step. Do this with **one real SA and one real PM**
(not yourself in two roles, if at all possible — testing with two
real humans on real devices catches the issues you can't see in a
local browser).

Pick **one real WP** on `PRC-2026-001` (or `…-002`) as the dry-run
target. Note its code so you can find it again across screens.

### Script

1. **SA upload — Before / During / After**
   - SA opens https://prc-ops.vercel.app/login on phone, logs in
     with LINE.
   - Lands on `/sa`. Picks the pilot project.
   - Picks the target WP.
   - Adds at least one **Before** photo. Confirms the thumbnail
     appears within a few seconds.
   - Adds at least one **During** photo. Confirms thumbnail.
   - Adds at least one **After** photo. Confirms thumbnail.
   - **Sanity:** taps the per-photo remove control on one photo
     (then re-uploads it) — confirms the tombstone-supersede
     mechanism works in the UI.

   - [ ] SA reached the photo screen, uploaded all three phases
   - [ ] Remove + re-add round-trip worked

2. **WP flips to `pending_approval`**
   - The first **After** photo upload should auto-flip the WP's
     `status` to `pending_approval` (spec 03 PR 2).
   - PM opens `/pm` — the WP appears in the review queue. **If
     it doesn't appear within a minute, stop and investigate
     before continuing.**

   - [ ] WP shows up on the PM's `/pm` queue

3. **PM review — both paths**
   - **Path (a) — needs_revision:**
     - PM opens the WP from the queue. Sees Before / During /
       After photos. Sees the empty decision history.
     - Selects "Request revision", writes a real comment
       ("retake the After photo with better lighting" or
       similar), submits.
     - PM goes back to `/pm`. The WP is still in the queue, now
       labelled "Revision requested".
     - SA reopens the same WP on their phone (no logout
       required; their session is still live), adds a new
       **After** photo (and optionally tombstones the old one).
     - PM reopens the WP. Sees the new After photo. Sees the
       prior "Revision requested" decision in the history.
   - **Path (b) — approve:**
     - PM selects "Approve" and submits.
     - The WP's status flips to `complete` and it leaves the
       `/pm` queue.

   - [ ] Path (a): needs_revision recorded; SA re-uploaded; PM saw the new photo
   - [ ] Path (b): approve flipped the WP to `complete`; it left the queue

4. **PM report — generate + download**
   - PM opens `/pm/projects` → picks the pilot project →
     `/pm/projects/<id>/reports`.
   - Clicks "Generate report". The new row appears with status
     **Queued**.
   - **Wait up to 5 minutes** (the Railway cron interval). The
     row's status auto-updates: Queued → Generating → **Ready**.
     The page polls every ~12 s while in-flight; no manual
     reload needed.
   - Clicks "Download PDF". The signed URL opens in a new tab;
     the PDF opens (desktop) or downloads (mobile).
   - Opens the PDF. Confirms:
     - Header has the project code + name.
     - "Generated: <D Month YYYY>" reads as a human-readable
       date (e.g., "26 May 2026"), NOT an ISO timestamp.
     - One page per complete WP, with that WP's After photos.
     - The just-approved WP from step 3 is included.

   - [ ] Report generated within ~5 min, no errors
   - [ ] PDF downloaded; header, date format, and WP coverage all correct

### Sign-off criteria

Every step above worked with real users on real devices, with no
manual SQL by the end users (only the operator touches SQL, and
only for cleanup / promotion / per-project adjustments).

- [ ] All four numbered steps completed end-to-end
- [ ] No end-user needed your help with SQL or dashboards
- [ ] Dry-run participants signed off informally ("looks good")

---

## 5. Known v1 limitations — communicate these to pilot users

Set expectations before the pilot starts. None of these are bugs;
they are conscious v1 scope cuts.

- **Reports include only After photos of complete WPs.** No
  deliverable grouping; no PM image curation; one page per
  complete WP. (v2 candidates — see Section 7.)
- **No watermark on photos.** Photos are stored unmodified and
  shown unmodified. (v2.)
- **Report generation is async, up to ~5 minutes.** The "Generate
  report" button queues a job; the Railway worker picks it up on
  its 5-min cron and processes it. The page auto-updates when the
  PDF is ready. **Don't keep clicking Generate** — the duplicate
  guard refuses a new generate while a previous one is in-flight.
- **No in-app user management.** New sign-ins land on
  `/coming-soon` until the operator promotes them. There is no
  "invite a user" or "change role" UI.
- **No in-app WP editing / removal.** WP additions are CSV-only;
  edits and removals are manual SQL by the operator. Bulk WP
  changes are v2 back-office work.
- **`rejected` decisions are handled out-of-band.** The app
  records the decision; resolving it (PM contacts the SA / site
  owner, work re-plans) happens outside the app. The WP just sits
  with `rejected` as its latest decision until a follow-up
  decision is recorded.
- **No project-level scoping yet.** Every SA / PM sees every
  project. Fine for the two-pilot internal-team scale. Becomes a
  problem the moment an external account joins — see ADR 0013
  for the planned upgrade.

---

## 6. Rollback / safety notes

The app is **additive and append-only where it matters**:

- A wrong photo is removed by the in-app **Remove** action, which
  appends a tombstone (`storage_path IS NULL`, `superseded_by` set)
  — the original row is preserved for audit. The thumbnail
  disappears from the SA / PM screens; the PDF report skips it.
  No data is destroyed.
- A wrong decision is **superseded** by the next decision. Every
  decision is preserved in `approvals`. The current state is
  always the row with `max(decided_at)` for the WP.
- A wrong report is left alone; just generate a new one. The old
  PDF stays in the bucket but the PM list shows the new one too.
  (Bucket cleanup is a future housekeeping task, not pilot-blocking.)

### If something breaks — where to look

| Surface                               | Logs / dashboard                                                  |
| ------------------------------------- | ----------------------------------------------------------------- |
| App (frontend / SSR / server actions) | Vercel dashboard → Deployments → latest → "Runtime Logs".         |
| Worker (cron, claim, PDF, upload)     | Railway dashboard → service → "Logs" tab. Cron runs show up here. |
| Database (auth, queries, RLS)         | Supabase dashboard → Logs Explorer (Postgres / API / Auth).       |

### Known unhandled cases

- **Report stuck in `processing`.** If a worker run crashes mid-
  job, the row stays at `processing` forever — the v1 worker has
  **no stale-job sweep** (it's a v2 candidate). Workaround: ask
  the PM to **generate a new report**; the duplicate guard will
  refuse until you manually clear the stuck row in SQL
  (`update public.reports set status = 'failed', error = 'stuck;
manually cleared' where id = '…';` under super_admin).
- **No watermark, so do not share photos publicly.** A leaked
  signed-URL leaks the original frame. Signed URLs are 120 s TTL
  but plan accordingly.

---

## 7. Post-pilot / v2 backlog

All deferred items in one place, so you don't have to re-derive
them later. None of these block the pilot.

### Reports / PDF

- **Deliverable grouping.** Source CSVs carry `DeliverableID`
  (D01–D30) per WP — schema doesn't yet (the v1 work_packages
  import drops it). Add a `deliverable_id` column on
  `work_packages`, extend the importer, change the PDF layout to
  group WPs by deliverable.
- **PM image curation per report.** Today the worker takes
  every current After photo. Curation = PM picks a subset
  before generating. Needs a `report_photos` join table + a
  curation UI.
- **Multi-project reports.** A single PDF covering several
  projects (e.g., a quarterly summary).
- **Watermark on rendered photos** (ADR 0003). Sits between
  the worker and PDFKit. Originals stay unmodified.
- **Before / During photos in reports.** v1 is After-only —
  matches the "what was approved" framing of spec 02. Adding
  Before/During is a render-side change in
  `worker/src/report.ts` + matching fetches in `index.ts`.
- **Stale-`processing` sweep.** A reaper that resurrects
  reports whose `updated_at` is older than (say) 15 min.

### Auth / users / admin

- **LINE profile picture + name refresh** via the LINE Login
  `profile` scope. Add an `avatar_url text` column to
  `public.users`; populate it NULL-only the same way
  `line_user_id` / `full_name` are populated today. Cosmetic
  polish — small avatar next to decider name on approval
  history + report list. Source-technique caveat: the original
  reference is a Messaging-API + Google-Sheets pattern; only
  the Login-scoped profile fetch fits our OAuth architecture.
- **In-app admin UI for visitor promotion.** Replace the SQL
  promotion step from Section 2 with a super-admin-only
  `/admin/users` route. ADR 0010 already flags this as the
  scaling trigger.
- **Airtable-like WP back-office + WP edit UI.** The bulk WP
  edit / remove gap from Section 3. Bigger surface — likely a
  small admin app rather than a single screen.
- **Separation-of-duties guard on approvals.** Today a PM who
  uploaded photos to a WP can also approve that WP. Documented
  v1 gap in spec 02; lift it with an EXISTS subquery against
  `photo_logs` in the approvals INSERT policy, or a new
  `uploaded_by` tracking column on approvals.

### Per-project scoping

- **Project membership** (ADR 0013 upgrade path). Triggered the
  moment an external PM, subcontractor account, or
  customer-review account is onboarded. The role-level RLS the
  app uses today tightens to role-plus-membership without a
  schema restructure.

### Tooling / infra

- **Optional `worker/railway.toml`** for reproducible deploy
  config. Railway's auto-detect handles the current setup, but
  pinning it makes the deploy contract reviewable.
- **Supersede-pattern skill update.** The
  `.claude/skills/supersede-pattern/SKILL.md` still teaches the
  replacement-only framing; it needs the ADR 0015 tombstone
  variant + `storage_path IS NULL` sentinel + well-formedness
  CHECK. Re-flagged from spec 02 PR 1.

---

## Sign-off

Once every checkbox above is ticked, the v1 pilot is live.

- [ ] Section 1 — test-data cleanup done
- [ ] Section 2 — every real pilot user is logged in and promoted
- [ ] Section 2a — AppSheet writer activated and smoke-tested
- [ ] Section 3 — WP lists per pilot are correct
- [ ] Section 4 — dry run completed end-to-end with real users
- [ ] Section 5 — limitations communicated to pilot users
- [ ] Section 6 — rollback / where-to-look notes shared with anyone
      else who might be on-call

Date pilot went live: **\*\***\_\_**\*\***
