# Break-glass runbook

**Status:** Binding. The append-only invariant (CLAUDE.md; ADR 0004) requires
the bypass procedure to live in the repo, not in anyone's memory.
**Applies to:** the live Supabase project — the append-only tables
(`audit_log`, `photo_logs`, `approvals`) and any destructive / irreversible
change to prod schema, data, or Storage.
**Audience:** the operator (super_admin). These are emergency procedures, run
by hand. Consolidates what was scattered across `go-live-checklist.md` §1/§6,
`docs/policies/change-management.md` §1, and the cleanup precedent (per the
2026-06 CEO review action list).

This is the glass you break only when the normal path cannot do the job. The
normal path is: **a migration, on a reviewed branch, merged via PR, applied
with `supabase db push`** (`change-management.md` §1). Append-only tables are
never edited at all in normal operation — corrections are appends (a new
`approvals` row supersedes the prior decision; a `photo_logs` tombstone
supersedes a photo, ADR 0015). Reach for this file only when a row genuinely
must be surgically changed, or a migration is genuinely destructive.

---

## Hard rules (read before either procedure)

1. **Operator-only.** Emergency / out-of-band changes are operator actions in
   the Supabase SQL editor, signed in as super_admin. Claude Code (CC) never
   runs them: `change-management.md` §1 keeps `git push`, merges, and
   out-of-band prod mutation operator-only. CC may _compose_ the SQL with you
   in a focused session and _verify after_, but the operator executes.
2. **Human go-ahead, in-session, naming the specific action.** Neither
   procedure starts on model confidence. "I'm ≥95% sure" is **not** a trigger
   and never will be. The trigger is an explicit human instruction in the
   session that names the exact action ("delete the 7 `photo_logs` rows for
   `WP-TEST-001`", "drop column X from table Y"). No named go-ahead → stop.
3. **Compose against the verified-live schema, never from memory.** Re-confirm
   every trigger name, FK behaviour, and row id against the current migrations
   at execution time (`go-live-checklist.md` §1 "Critical instruction"). Do not
   improvise destructive SQL.
4. **The dashboard SQL editor is for diagnostics and these two procedures
   only** — never routine mutation (`change-management.md` §1).

---

## Procedure A — Append-only RUNTIME bypass (surgical correction)

Use when a row in `audit_log`, `photo_logs`, or `approvals` genuinely must be
UPDATEd/DELETEd in prod and the append/supersede path cannot express the fix
(e.g. test-data cleanup, a corrupt row). The exemplar is the 2026-06-07
go-live §1 test-data cleanup — logged as `audit_log` row `56a4d80e-…`
(`action='other'`), cited in `change-management.md` §1.

### Why a plain DELETE/UPDATE fails

Each table is append-only, triple-enforced (ADR 0004; the three
`create_*` migrations):

1. **Privilege** — `REVOKE ALL … FROM authenticated, anon`; only
   `INSERT`(+`SELECT`) granted. `service_role` keeps its privileges.
2. **RLS** — INSERT + SELECT policies only; no UPDATE policy, no DELETE policy.
3. **Trigger** — a `BEFORE UPDATE OR DELETE` trigger raises `P0001`, catching
   even `service_role` / superuser. This is the layer Procedure A must disable.

So a plain `delete from public.photo_logs where …` fails with
`P0001: photo_logs is append-only`. The trigger is the only thing standing in
the way once you are super_admin, and it must be disabled — briefly,
transactionally — to let the statement through.

### The block triggers (re-confirm against the migrations before running)

| Table        | Block-write triggers                                                           | Function                          | Source migration                       |
| ------------ | ------------------------------------------------------------------------------ | --------------------------------- | -------------------------------------- |
| `audit_log`  | `audit_log_block_update`, `audit_log_block_delete`, `audit_log_block_truncate` | `public.audit_log_block_write()`  | `20260505143800_create_audit_log.sql`  |
| `photo_logs` | `photo_logs_block_update`, `photo_logs_block_delete`                           | `public.photo_logs_block_write()` | `20260524020000_create_photo_logs.sql` |
| `approvals`  | `approvals_block_update`, `approvals_block_delete`                             | `public.approvals_block_write()`  | `20260524030000_create_approvals.sql`  |

(`audit_log` additionally blocks `TRUNCATE`; `photo_logs`/`approvals` block
UPDATE+DELETE only.)

### FK cascade caveat

`work_packages → photo_logs` and `work_packages → approvals` are
`ON DELETE CASCADE`. The cascade-driven DELETE on the child **still fires the
child's block trigger and still raises** (`go-live-checklist.md` §1). A
"delete the WP and let it cascade" shortcut fails unless the child tables'
triggers are disabled in the same window. Disable triggers on every table the
operation will touch — directly or by cascade.

### Steps

1. **Confirm the go-ahead** (Hard rule 2): a named, in-session human
   instruction for this specific correction. Open a maintenance window; make
   sure no pilot user is mid-action.
2. **Re-verify** the trigger names, FK behaviour, and the exact target row ids
   against the current migrations and a read-only `SELECT` in the SQL editor.
   Compose the SQL with CC in a focused session; do not improvise.
3. **Run one guarded transaction** in the Supabase SQL editor as super_admin.
   Disable the user triggers at the top, make the enumerated change, **write
   the mandatory audit row**, re-enable the triggers before commit. Shape (not
   copy-paste — compose against the verified schema):

   ```sql
   begin;

   -- Disable on every table the change touches (incl. cascade targets).
   alter table public.photo_logs disable trigger user;
   alter table public.approvals  disable trigger user;

   -- The surgical change — enumerated ids only, never a broad predicate.
   delete from public.approvals  where id in ('…');
   delete from public.photo_logs where id in ('…');

   -- MANDATORY audit row (audit_log INSERT is granted — no trigger-disable
   -- needed for this INSERT). action='other'; payload says what and why.
   insert into public.audit_log (action, target_table, payload)
   values (
     'other', 'photo_logs',
     jsonb_build_object(
       'event', 'break-glass append-only correction',
       'what',  'deleted N test photo_logs + M approvals for WP-…',
       'why',   'pre-go-live test-data cleanup, operator-authorised <date>',
       'at',    now()
     )
   );

   -- Re-enable BEFORE commit, so any failure rolls back to triggers-on.
   alter table public.approvals  enable trigger user;
   alter table public.photo_logs enable trigger user;

   commit;
   ```

   `ALTER TABLE … DISABLE TRIGGER USER` is the mechanism the 2026-06-07
   exemplar used (`go-live-checklist.md` §1) — it disables the user-defined
   block triggers for the transaction; the `ENABLE` restores them. Keep it a
   single `BEGIN; … COMMIT;` so a mid-way error leaves the triggers enabled.

4. **Read the row counts** in the result tab — they must match the verified
   inventory exactly. If anything is off, you are still inside the transaction:
   do not `COMMIT` — `ROLLBACK`.
5. **Storage objects are separate** — see the warning under Procedure B.
   Photos/PDFs in the `photos` / `reports` buckets are deleted as a distinct
   operation (Storage dashboard or a `storage.objects` DELETE) **inside the
   same maintenance window** so table and bucket stay in sync
   (`go-live-checklist.md` §1).
6. **Fix-forward migration follow-up (mandatory).** A runtime bypass is
   out-of-band by definition. Per `change-management.md` §1, a migration must
   follow so git realigns with prod and `db push --dry-run` returns to
   "Remote database is up to date." The `audit_log` row is the record that the
   out-of-band action happened; the migration is how the repo catches up.

> The append-only INSERT path is **not** a break-glass action: tombstoning a
> photo (ADR 0015) or recording a superseding `approvals` row is the _normal_
> way to "undo", and needs none of the above.

---

## Procedure B — DESTRUCTIVE / irreversible MIGRATION

Use for any migration that destroys or rewrites data irreversibly: `DROP TABLE`
/ `DROP COLUMN`, a destructive `ALTER` (type change with cast loss, `NOT NULL`
backfill that discards), a mass `DELETE`, or a `TRUNCATE`-equivalent.
CLAUDE.md's own framing: one bad migration is existential. The three floors
below are non-negotiable and ordered.

### Floor 1 — Verified `pg_dump` backup (the floor you control)

The production project's Postgres PITR tier and the Storage-bucket backup
posture are an **unverified gap** in this repo (CEO review §"Verify the backup
floor"; architecture-revision §"Confirm PITR / backup tier"; the uxui bundle
notes "nothing in the repo proves PITR tier or photo-bucket backups exist").
Until a restore drill proves PITR, a fresh manual dump is the only backup you
have actually verified. Take it immediately before the destructive apply.

- **Operator-run — cannot be delegated to CC.** `pg_dump` needs the DB
  password, and **the DB password must never appear in a Claude Code prompt**
  (or any chat, git, or migration — `change-management.md` §2 tracks where
  secrets live; `go-live-checklist.md` §2 "never share the service-role key").
  The operator runs `pg_dump` themselves from their own shell.
- **Same-version-or-newer `pg_dump`.** The client `pg_dump` must be the same
  major version as the server, or newer — an older client cannot reliably dump
  a newer server.
- **Connect via the session pooler, port 5432** (the session-mode port, per
  the `go-live-checklist.md` §2a port split — 5432 = session pooler, 6543 =
  transaction pooler; a dump wants session mode).
- Write the dump to a known, durable location and note the timestamp. Shape
  (operator's shell; the password is supplied out-of-band, e.g. via
  `PGPASSWORD` in the environment, never inline in a prompt):

  ```sh
  pg_dump --format=custom --no-owner \
    "postgresql://postgres:<password-from-your-vault>@<session-pooler-host>:5432/<db>" \
    --file "prc-ops-$(date +%Y%m%d-%H%M%S).dump"
  ```

  Confirm the file exists and is non-trivial in size before proceeding.

### Floor 2 — Preview-branch rehearsal

Rehearse the destructive migration on a throwaway copy before it touches prod
data — a Supabase preview branch or a cloned instance — and confirm the
outcome (row counts, that the app still reads, that a restore works). This is
the binding "preview-branch rehearsal for destructive/backfill migrations" the
CEO review puts into `change-management.md`. Never let prod be the first place
the statement runs.

### Floor 3 — The change-management gate

The destructive change still goes through the normal gate
(`change-management.md` §1): **one timestamped migration → reviewed PR → merge
to `main` → `supabase db push`**, then **verify post-apply** with `pnpm db:test`
(and/or a targeted read) and report. CC may run `db push` only for an
already-merged migration and must verify after; the operator owns merge and
`git push`. No dashboard SQL editor for the mutation itself.

### Storage is NOT covered by Postgres PITR — its own backout plan

Postgres PITR and `pg_dump` cover the **database only**. Supabase **Storage
objects (the `photos` and `reports` buckets) are not in either** — a restored
database still points `photo_logs.storage_path` at objects that a destructive
Storage operation already deleted, with no way to bring them back. The repo
already treats Storage as separate shared state (`change-management.md` §1
lists buckets explicitly; `go-live-checklist.md` §1 deletes Storage objects as
a distinct step). **Any destructive change that touches Storage needs its own
backout plan** — e.g. copy the affected objects out of the bucket first, or
snapshot the bucket — because no DB backup will restore a deleted photo.

---

## Editing-side guard: `CLAUDE_ALLOW_AUDIT_LOG_EDIT`

Distinct from the runtime trigger bypass above. `.claude/hooks/protect-audit-log.js`
is a PreToolUse hook that **blocks `Write`/`Edit` on any `audit_log` migration
file** (path matching `supabase/migrations/.*audit[_-]?log.*`) so the
append-only migration is not changed by accident (ADR 0004). It guards the
**source file**, not the database.

- **When it applies:** any time you legitimately must author or amend an
  `audit_log` migration (e.g. a fix-forward migration after Procedure A that
  touches `audit_log`). Set the env var for that edit:
  `CLAUDE_ALLOW_AUDIT_LOG_EDIT=1`. The hook fails open on any internal error,
  so it never blocks unrelated work.
- **What it is not:** it does not touch triggers, privileges, RLS, or any live
  data. Setting it does not bypass the append-only enforcement in the DB —
  that is Procedure A. The two are independent: the hook gates _editing the
  migration file_; the triggers gate _writing the rows_.

---

## References

- `docs/policies/change-management.md` — §1 the rule + the emergency exception
  (the `56a4d80e-…` exemplar), §"Who runs `db push`", §4 remediation.
- `docs/go-live-checklist.md` — §1 the test-data cleanup procedure (the
  disable-trigger-in-a-transaction exemplar) + §2a port split + §6 rollback.
- ADR 0004 (audit / three-layer immutability), ADR 0015 (photo_logs
  tombstone-supersede), ADR 0019 (revoke user UPDATE), ADR 0006 (no-Docker DB
  testing; `pnpm db:test` is the post-apply verify runner).
- `supabase/migrations/20260505143800_create_audit_log.sql`,
  `20260524020000_create_photo_logs.sql`,
  `20260524030000_create_approvals.sql` — the exact trigger / REVOKE / RLS
  posture.
- `.claude/hooks/protect-audit-log.js` — the `CLAUDE_ALLOW_AUDIT_LOG_EDIT`
  override.
