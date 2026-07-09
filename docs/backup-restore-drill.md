# Backup & restore drill

**Status:** Operator runbook. Binding intent, manual execution.
**Why this exists:** `docs/break-glass.md` (destructive-migration floor) and any
`DROP`/mass-`DELETE` migration both assume a backup you can actually restore —
and that assumption has never been tested (the 2026-06 CEO review calls this the
highest value-per-effort item, and notes "nothing in the repo proves the PITR
tier or photo-bucket backups exist"). This drill proves it, end to end, on a
**scratch** target — and writes down the real RPO/RTO so the next destructive
change is taken with eyes open.

> **Run this:** once now (to establish the floor), then quarterly, and ALWAYS
> before a destructive/backfill migration (`docs/break-glass.md` Procedure B).

---

## The one thing to understand first: there are TWO data stores

| Store                | What's in it                                                                                                        | Covered by Postgres PITR / `pg_dump`? |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Postgres DB**      | projects, work_packages, photo_logs **rows** (incl. `storage_path` text), approvals, labor, purchases, audit_log, … | ✅ Yes                                |
| **Supabase Storage** | the actual **photo image files** (`photos` bucket) and **PDF reports** (`reports` bucket)                           | ❌ **NO — separate.**                 |

A restored database gives you back every _row_, including `photo_logs.storage_path`
— but that path points at an **object in the `photos` bucket**. If the bucket
was lost, the row survives and the image is gone (a 404). **So a real recovery =
DB restore + Storage intact.** This drill tests both, separately, and the "open a
photo" step at the end is what proves they line up.

---

## Safety rules (read before touching anything)

1. **NEVER restore in place onto production.** Supabase PITR's "restore" rewinds
   the project itself. This drill restores into a **scratch** target (a throwaway
   project or a branch) — never `btbfzhnvzruvxlgbeqnl` (prod). If a screen warns
   it will overwrite the current database, **stop**.
2. **The DB password never goes into a Claude Code prompt** (or any chat / git /
   migration). It lives in your vault + the Vercel/Railway/CLI configs only
   (`change-management.md` §2). You run the shell commands here yourself; Claude
   can compose the _verification queries_, not hold the password.
3. **Read-only until Part 4.** Parts 1–3 only inspect + dump; nothing on prod
   changes. Part 4 only writes to the scratch target.
4. If a step looks risky and this runbook hand-waves it, **stop and ask Claude in
   a focused session** before proceeding (same rule as the go-live checklist).

---

## ✅ Current state: the project is on the Supabase PRO tier (upgraded 2026-06-21)

This changes what Part 1 will find, so know it going in (confirm exact current
limits at supabase.com/pricing — they shift):

- **Managed daily DB backups exist.** Pro includes **scheduled daily backups**, so
  Part 1 will show dated snapshots — your DB **RPO is up to ~24 h** (you can lose a
  day between snapshots). Note the retention (how many are kept).
- **PITR is a separate, optional add-on** (~US$100/mo) for sub-day recovery. For an
  internal pilot, daily snapshots are usually enough — skip PITR unless you need to
  recover to a specific minute.
- **Storage still has NO managed backup — on any tier.** The `photos` / `reports`
  buckets are **not** in the daily DB snapshot; Pro does nothing for them. The
  manual/automated **Storage export (Part 3) is your ONLY photo backup.**
- **No auto-pause** on Pro (Free paused after ~7 days idle; that risk is gone).

**What this means concretely:** the DB now has a managed floor (daily snapshots),
but **the photos do not** — so the Storage export (Part 3) and proving you can
actually restore (Part 4) are the load-bearing steps. `break-glass.md` Procedure
B's "fresh dump first" still applies before any destructive migration.

### Backup posture (supersedes the 2026-06-19 "defer Pro" decision — Pro is now on)

The earlier call to stay on Free and defer Pro is **done**: the project was upgraded
to **Pro** on 2026-06-21 (daily backups + no auto-pause). What remains of the floor:
**(a)** prove a restore actually works (this drill, never yet run), and **(b)** back
up the Storage buckets, which Pro does not cover — keep an **off-Supabase copy**
(team Google Drive folder, URL in the operator's vault, NOT in git) so a
project-level incident can't take the photos with it.

Two things worth watching:

- **Photos > DB.** Photos are the irreplaceable site evidence and have **no managed
  backup on any tier**; the Storage export (Part 3) matters more than the DB dump.
- **Storage capacity.** Construction photos fill a bucket fast (even downscaled,
  spec 34). If the `photos` bucket nears its limit, **uploads start failing** —
  watch Storage % (dashboard → **Settings → Usage**).

### Interim weekly procedure (every week until automated)

1. **Part 2** — `supabase db dump --linked` → save the `.sql` file(s).
2. **Part 3** — export the `photos` (and `reports`) bucket objects.
3. Drag both into the **team Google Drive backup folder**, in a **dated
   subfolder** (e.g. `2026-06-19/`). Keep ~the last 4–8 weeks; prune older.
4. **Quarterly (and before any destructive migration):** run **Part 4** — restore
   the latest Drive copy into a scratch DB and open a photo. A backup in Drive
   you've never restored is a hope, not a backup.

> **Automation (future, deferred by the 2026-06-19 decision):** a scheduled
> Railway-worker job can do steps 1–3 on a cron, pushing to Drive via a Google
> service account (operator provides a service-account JSON as a Railway secret +
> shares the Drive folder with the service-account email). Removes the
> weekly-memory dependency — build it when the manual cadence proves annoying or
> the project count grows.

> Your org's project cap may mean the Part 4 scratch target is a **local Postgres**
> or a temporarily-created throwaway project rather than a second paid one.

---

## Part 1 — Verify the DB backup floor exists (5 min, read-only)

Supabase dashboard → project **prc-ops** (`btbfzhnvzruvxlgbeqnl`) →
**Database → Backups**.

1. **Is Point-in-Time Recovery (PITR) enabled?** It's a paid add-on; it may be
   OFF. Note what you see:
   - **PITR ON** → note the **retention window** (e.g. 7 days). That window is
     your DB **RPO ceiling via PITR** — a problem older than the window is not
     PITR-recoverable.
   - **Only daily backups** (no PITR) → your DB RPO is up to **24 h** (you can
     lose a day). Note the retention (how many daily backups are kept).
   - **Nothing** → the manual dump in Part 2 is your ONLY DB backup. Flag this
     loudly in Part 5.
2. Note the **most recent successful backup timestamp**. If backups are failing
   or stale, that is finding #1 — fix before relying on anything else.

- [ ] PITR status recorded (on/off + retention window)
- [ ] Daily-backup retention recorded
- [ ] Most-recent-backup timestamp recorded (and it's recent)

---

## Part 2 — Take a verified manual dump (the floor you control)

Independent of whatever Part 1 found, take a fresh logical dump now. This is the
copy you control and the one `break-glass.md` Procedure B requires before a
destructive migration.

**Connection string:** dashboard → **Project Settings → Database → Connection
string → "Session pooler" (URI)**. It looks like
`postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres`.
Copy it; substitute your DB password for `[PASSWORD]`. **Port 5432 = session
pooler** (the dump wants session mode; 6543 transaction mode is for the app —
`go-live-checklist.md` §2a port split).

**Easiest (Supabase CLI — already linked, no password in a prompt):**

```sh
# from the repo root; the linked CLI carries the credentials.
supabase db dump --linked -f "prc-ops-db-$(date +%Y%m%d-%H%M%S).sql"           # schema + roles
supabase db dump --linked --data-only -f "prc-ops-data-$(date +%Y%m%d-%H%M%S).sql"
```

**Or raw `pg_dump`** (your own shell; supply the password out-of-band, e.g. via
`PGPASSWORD`, never inline in a chat):

```sh
pg_dump --version    # MUST be >= the server's major (Supabase = Postgres 15+); older client cannot dump a newer server
PGPASSWORD='<from-your-vault>' pg_dump \
  --format=custom --no-owner --no-privileges \
  --file "prc-ops-$(date +%Y%m%d-%H%M%S).dump" \
  "postgresql://postgres.[ref]@aws-0-[region].pooler.supabase.com:5432/postgres"
```

**Verify the dump is real (don't trust a zero-byte file):**

```sh
ls -lh prc-ops-*.dump            # non-trivial size
pg_restore -l prc-ops-*.dump | head   # lists the archive's contents (custom-format dumps)
# for the .sql CLI dumps: open it, confirm it has CREATE TABLE public.work_packages etc.
```

- [ ] Dump taken and written to a known, durable location (NOT just the cloud PC's temp)
- [ ] `pg_dump`/CLI version is same-major-or-newer than the server
- [ ] Dump verified non-empty and listable (`pg_restore -l` or eyeball the SQL)
- [ ] Dump file stored somewhere that survives the cloud PC (vault / external drive / separate cloud)

---

## Part 3 — Storage backup posture (the photos the DB can't restore)

Dashboard → **Storage**. Buckets in play: **`photos`** (private, `public=false`)
and **`reports`** (generated PDFs).

1. **Does Storage have any backup?** Supabase Storage is **not** in the Postgres
   PITR/daily backups. Check whether your plan/setup has Storage backups or an
   export. On most setups **there is none by default** — if so, that's the
   biggest gap and the honest answer is "photos have NO backup."
2. **Sample-pull a real photo now** (proof the bucket serves + a manual copy):
   download a few objects from `photos/` (and a PDF from `reports/`) to durable
   storage. Even a periodic manual export is a real RPO improvement over zero.
3. **Decide the posture** (record it in Part 5):
   - **None** → accept the risk explicitly, OR
   - **Periodic export** → a scheduled copy of the `photos` bucket out of
     Supabase (script/cron), OR
   - **Provider Storage backup** → if your plan offers it, enable it.

- [ ] Confirmed whether Storage backups exist (yes/no + what)
- [ ] Pulled a sample of `photos/` + `reports/` objects to durable storage
- [ ] Storage backup posture decided + written down

---

## Part 4 — The actual restore drill (gold standard — prove it works)

The point of the whole exercise: a backup you've never restored is a hope, not a
backup. Restore into a **scratch** target and read real data back out.

**Pick a scratch target (NOT prod):**

- **Easiest:** create a **new throwaway Supabase project** (free tier is fine).
  Grab ITS connection string (same dashboard path, that new project).
- **Or:** a Supabase **branch** (if branching is enabled), or a local Postgres.

**Restore the Part-2 dump into the scratch target:**

```sh
# custom-format dump:
PGPASSWORD='<scratch-project-password>' pg_restore --no-owner --no-privileges \
  --dbname "postgresql://postgres.[scratch-ref]@aws-0-[region].pooler.supabase.com:5432/postgres" \
  prc-ops-*.dump
# .sql CLI dump: psql "<scratch-uri>" -f prc-ops-db-*.sql   (then the data-only file)
```

**Verify business data came back** (scratch project's SQL editor, read-only):

```sql
select
  (select count(*) from public.projects)       as projects,
  (select count(*) from public.work_packages)  as work_packages,
  (select count(*) from public.photo_logs)     as photo_log_rows,
  (select count(*) from public.approvals)      as approvals,
  (select count(*) from public.audit_log)      as audit_rows;
```

Compare against prod (run the same query on prod, read-only). Numbers should
match the dump's point in time.

**OPEN A PHOTO from the restored copy** (the end-to-end proof — DB ⨯ Storage):

```sql
-- in the SCRATCH project: grab a real photo's stored path
select id, work_package_id, storage_path
  from public.photo_logs
 where storage_path is not null
 limit 1;
```

Take that `storage_path` and try to actually retrieve the object from the
`photos` bucket:

- If you restored Storage too (or the prod bucket still exists), the object
  resolves → **full recovery proven**.
- If the bucket is gone and there's no Storage backup, the path 404s → you've
  just measured your real photo RPO (Part 3's gap, made concrete).

**Time it.** Note how long Part 4 took start-to-finish — that's your observed
**RTO** (how long recovery actually takes).

- [ ] Restored the dump into a scratch target (NOT prod)
- [ ] Row counts match the dump's point in time
- [ ] Pulled a `photo_logs.storage_path` and attempted to open the object
- [ ] Photo opened (full recovery) **OR** confirmed the photo gap + its RPO
- [ ] RTO (wall-clock to restore) recorded
- [ ] **Deleted the scratch project/branch** when done (don't leave a prod copy lying around)

---

## Part 5 — Record the result (and close the loop)

Write the findings down so the next person (and the next destructive migration)
inherits the truth, not a guess.

1. **Record** (in your ops notes / vault): PITR on/off + window, daily-backup
   retention, **DB RPO**, **photo RPO**, observed **RTO**, and any failures.
2. **Audit row** — log that the drill ran (it's a real ops event):
   ```sql
   insert into public.audit_log (action, target_table, payload)
   values ('other', null,
     jsonb_build_object('event','backup_restore_drill','date', '<date>',
       'pitr', '<on/off + window>', 'db_rpo','<…>', 'photo_rpo','<…>', 'rto','<…>',
       'gaps','<…>'));
   ```
3. **If gaps were found** (no PITR, no Storage backup), decide + schedule the fix.
   The retention/Storage backup decision belongs in
   `docs/policies/change-management.md` once settled (the CEO review wants the
   preview-branch rehearsal + Storage posture written in as binding).
4. **`break-glass.md` Procedure B** can now reference a _proven_ floor rather
   than an assumed one.

- [ ] RPO/RTO + gaps recorded in ops notes
- [ ] `audit_log` drill row written
- [ ] Gap fixes (if any) scheduled
- [ ] Backup posture promoted into `change-management.md` if a standing policy was decided

---

## Cadence

- **Now** — establish the floor (this run).
- **Quarterly** — re-run Parts 1–4 (catches silent backup failures + config drift).
- **Before any destructive/backfill migration** — Part 2 (fresh dump) is the
  non-negotiable minimum (`break-glass.md` Procedure B).
