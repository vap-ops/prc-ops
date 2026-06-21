# Beta-readiness checklist (current app)

The operator's runbook for launching a **beta** on the _current_ app. Supersedes
`go-live-checklist.md` (which described the v1 alpha pilot, before GL accounting,
Nova, project onboarding, WP paste, and the งวด lifecycle shipped). Work top to
bottom. For anything that touches destructive SQL or the DB, open a focused
session with Claude first — see `docs/break-glass.md`.

> **Scope of this beta:** the **core construction-ops flow** — projects → work
> packages → งวดงาน → photos → approval → reports, plus labor capture and
> purchasing. The money back-office (GL `/accounting`, Nova coins) is
> **deliberately operator-only** for this beta (see §2). Beta users are internal
> staff (site admins + project managers).

---

## 0. Current state (confirm before you start)

- **App** — https://prc-ops.vercel.app (Vercel, `main` auto-deploys).
- **PDF worker** — Railway, cron every 5 min.
- **Database** — Supabase project `btbfzhnvzruvxlgbeqnl`, **PRO tier** (upgraded
  2026-06-21 → managed daily backups + no auto-pause).
- **Auth** — LINE Login only. New sign-ins are `visitor` → land on
  `/coming-soon` until promoted.
- **Tests green as of 2026-06-21:** vitest 200/1324, pgTAP 114/2186/0, build OK.

---

## 1. Data safety (Pro is on — verify, don't assume)

- [ ] **Confirm daily backups are visible** — Supabase dashboard → Database →
      Backups. You should see dated daily snapshots. (Base Pro = daily; up to
      ~24h loss between snapshots.)
- [ ] **Decide on PITR** — point-in-time recovery is a _separate paid add-on_
      (~US$100/mo). For an internal beta, daily snapshots are usually enough.
      Skip unless you want sub-day recovery.
- [ ] **Storage is NOT in the DB backup** — the `photos` / `reports` buckets
      aren't covered by the daily DB snapshot. For beta, accept this risk OR do a
      periodic manual bucket export. (A restored DB 404s its photos if a bucket
      is lost.)
- [ ] **Run the restore drill once** — `docs/backup-restore-drill.md`, on a
      scratch target, to prove a snapshot actually restores. Recommended before
      real data piles up; not a hard blocker now that daily backups exist.

---

## 2. Beta scope — confirm the money surfaces stay dark

Already enforced in code (spec 166) — just confirm:

- [ ] **GL `/accounting`** is operator-only — a `project_manager` opening it
      bounces, and settings → การเงิน shows no บัญชี link for them. (Re-enable for
      PMs only after the accountant config — COA / WHT / PEAK — is done.)
- [ ] **Nova `/nova`** is operator-only — beta users see only a greyed
      "coming soon" preview.
- [ ] **ค่าจ้าง `/payroll`** IS available to managers (kept on purpose) — fine.
- [ ] Project / WP pages show no budget / cost / coin figures to SA/PM (enforced;
      spot-check one WP as a PM).

---

## 3. Roster + roles

In the Supabase SQL editor (signed in as you), list the roster:

```sql
select id, full_name, role, created_at
  from public.users
 order by created_at desc;
```

- [ ] **Exactly one `super_admin` (you).** The last audit (2026-06-10) found
      THREE. Demote each extra with
      `update public.users set role = 'project_manager' where id = '<uuid>';`
- [ ] **At least one real `project_manager`** for the beta (approves WPs,
      generates reports).
- [ ] **Site admins** (`site_admin`) for the field people uploading photos.
- [ ] Promotion mechanics + the find-the-new-user query: see
      `go-live-checklist.md` §2 (unchanged — SQL-only, by `id`, never share the
      service-role key).

---

## 4. Project membership ⚠️ NEW — required, or PMs see nothing

Visibility is now **membership-scoped** (spec 143): a `project_manager` /
`site_admin` only sees projects they're a **member** of. (Operator/super_admin
sees all.) So for each beta project:

- [ ] Open the project → **ตั้งค่าโครงการ** (project settings, gear icon) → the
      **team** section → add each SA and PM who should work that project. (In-app,
      PM/super — no SQL.)
- [ ] Verify: that PM logs in → the project appears in their list. If a project
      is missing for someone, they're not a member yet.

---

## 5. Smoke test the CURRENT app (one real SA + one real PM, real devices)

Pick one beta project. Don't test as yourself in two roles if you can avoid it.

### 5a. Project setup (PM/operator)

- [ ] Create or open the project; the **onboarding checklist** guides setup
      (dates/lead, budget, team, work packages, **งวดงาน**, client).
- [ ] **Add work packages** — paste from your sheet via **วางรายการงาน**
      (`WP-001⇥name` lines). Confirm they appear.
- [ ] **Create งวดงาน** — **วางรายการงวด** (`D01⇥name` lines) or **เพิ่มงวด**.
- [ ] **Map งาน → งวด** — the amber **"N งานยังไม่อยู่ในงวด → จัดกลุ่ม"** banner →
      select งาน → assign. Confirm the "ตามงวดงาน" grouping looks right.
- [ ] **Edit a งวด** — rename, reorder (▲▼), open its detail page, and (on an
      empty test งวด) remove งาน → delete. Confirm each works.

### 5b. Field upload (SA, phone)

- [ ] SA logs in at /login → lands on `/sa` → picks the project → a WP.
- [ ] Adds Before / During / After photos; thumbnails appear.
- [ ] Remove + re-add one photo (tombstone-supersede) works.
- [ ] First After photo flips the WP to `pending_approval`.

### 5c. PM review

- [ ] WP appears on the PM's `/review` queue within ~1 min.
- [ ] Request-revision path: comment → SA re-uploads → PM sees the new photo.
- [ ] Approve path: WP flips to `complete`, leaves the queue.

### 5d. Labor + purchasing

- [ ] SA/PM logs a labor day on a WP (spec 46) — saves, shows in the WP.
- [ ] Raise a purchase request on a WP → it appears on `/requests` → PM
      approves → record purchase / delivery. (Mechanics unchanged from
      go-live-checklist.)

### 5e. Report

- [ ] PM generates a report (`/projects/<id>/reports`) → status Queued →
      Ready within ~5 min → downloads → PDF opens with correct header/date and
      one page per complete WP.

### Sign-off

- [ ] Every step worked with real users on real devices; no end-user touched SQL.

---

## 6. Tell beta users (known limitations)

- New sign-ins land on `/coming-soon` until you promote + add them to a project.
- Reports = After photos of complete WPs only; no watermark — don't share
  photos publicly (signed URLs are short-lived but the frame is the original).
- Report generation is async (~5 min); don't spam Generate.
- GL / Nova are not part of this beta (operator-only).
- งวด money/dates (billing link) is not built yet (spec 165 U5, future).

---

## 7. If something breaks — where to look

| Surface             | Logs                                         |
| ------------------- | -------------------------------------------- |
| App (SSR/actions)   | Vercel → Deployments → latest → Runtime Logs |
| Worker (PDF/cron)   | Railway → service → Logs                     |
| DB (auth/RLS/query) | Supabase → Logs Explorer                     |

Rollback posture: the app is append-only where it matters (photos tombstone,
decisions supersede). For any destructive fix, `docs/break-glass.md`.

---

## 8. LINE notifications (optional for beta)

If you want PM push notifications during beta, activate per
`go-live-checklist.md` §8 (Messaging API channel + Vercel env + Vault secrets).
Dormant until done — nothing breaks without it.

---

## Sign-off

- [ ] §1 backups confirmed (+ restore drill run, ideally)
- [ ] §2 money surfaces confirmed dark
- [ ] §3 roster cleaned (one super_admin, real PM, SAs)
- [ ] §4 every beta user added to their project(s)
- [ ] §5 smoke test passed end-to-end
- [ ] §6 limitations communicated

Date beta went live: **\_\_\_\_\_\_\_\_\_\_**
