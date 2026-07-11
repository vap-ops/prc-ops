# Automations registry

Single source of truth for every **automated / triggered** behaviour in the
system — scheduled jobs, notifications, auto-fills, AI drafts, threshold pills,
and any other "it happens on its own" logic. The operator directive
(automation-documentation doctrine, 2026-07-07) is: document each automation
**now**, in a consistent shape, so a future n8n-like automation-settings hub can
read this catalogue and let the operator see, toggle, and tune them. Design each
automation toggle/config-ready rather than hardcoded-forever. **Do not build the
hub yet** — just keep this registry accurate as automations ship.

Each entry uses this shape (mirrors an n8n workflow: trigger → condition →
action):

- **id** · **name (th / en)** · **trigger** (event) · **condition** ·
  **action** · **target / recipients** · **config params** ·
  **toggleable?** (default on/off) · **status** (planned / live) ·
  **backing spec + code ref**

Append each new automation below. Keep newest-relevant grouping loose; the id is
the stable handle.

---

## AUT-G1 — Storage-bucket backup to Google Drive

- **name (th / en):** สำรองไฟล์คลังขึ้น Google Drive / Storage backup to Google Drive
- **trigger:** scheduled — nightly, **00:30 UTC** daily (Railway cron
  `30 0 * * *` invoking `pnpm backup` in the worker).
- **condition:** both `GDRIVE_SA_KEY` and `GDRIVE_FOLDER_ID` are set. If either
  is missing the job logs `drive backup: not configured, skipping` and no-ops.
- **action:** lists every object in the five Supabase Storage buckets
  (`photos`, `reports`, `po-attachments`, `pr-attachments`,
  `feedback-attachments`), mirrors each into Google Drive under
  `<FOLDER_ID>/<bucket>/<object path>` (nested folders created as needed),
  uploading objects that are **missing or size-changed** (add/update only —
  **never deletes** in Drive). Writes `<FOLDER_ID>/last-run.json` as the
  operator-visible heartbeat: `{ timestamp, buckets: {name: {files, uploaded,
bytes}}, errors }`. Per-file errors are logged and counted, not fatal.
- **target / recipients:** Google Drive folder `GDRIVE_FOLDER_ID` (may be a
  Workspace Shared Drive; the service account must be a member of it).
- **config params:** `GDRIVE_SA_KEY` (service-account JSON — raw or base64),
  `GDRIVE_FOLDER_ID` (target Drive folder id). Bucket list and the `30 0 * * *`
  schedule are the tunable knobs (schedule lives in Railway's cron config).
- **toggleable?** yes — default **off until configured**. Unset either env var
  to disable; the run becomes a logged no-op.
- **status:** live (code shipped; activates once the operator sets the two env
  vars + adds the Railway cron).
- **backing spec + code ref:** V1/GA gap G1 (T0 data-safety floor,
  memory `v1-ga-gap-analysis-2026-07`) · `worker/src/backup-drive.ts` ·
  `worker/tests/unit/backup-drive.test.ts`.

---

## AUT-SI1 — Serious site-issue PM alert

- **name (th / en):** แจ้งเตือน PM เมื่อมีปัญหาหน้างานร้ายแรง / Serious site-issue PM
  alert
- **trigger:** DB `AFTER INSERT` on `public.site_issues` (trigger
  `site_issues_notify_serious`) enqueues one `notification_outbox` row; the
  outbox drainer (`POST /api/notifications/drain`, invoked every minute by
  pg_cron → pg_net) delivers it. Built on the notification outbox (spec 32 /
  ADR 0037), not a parallel path.
- **condition:** `issue_type IN ('safety','access','equipment')` — the
  **serious-set SSOT is the trigger WHEN clause**; `weather` / `other` enqueue
  nothing. Forward-only (AFTER INSERT — issues filed before this shipped are
  never retro-alerted).
- **action:** `notify_site_issue_reported()` (SECURITY DEFINER,
  failure-swallowed — a notification must never block `report_site_issue`)
  writes one outbox row (`event_type = 'site_issue_reported'`, the issue's WP id
  on the row, `{project_id, issue_type, reported_by}` in payload). The drainer
  composes the Thai message
  `⚠️ ปัญหาหน้างาน (<type>): <project> · <WP>` + `แจ้งโดย <reporter>` + a deep link
  to `/projects/<project_id>`, and pushes it via LINE (+ Telegram if configured).
- **target / recipients:** operator-locked 2026-07-11 — the issue's **project
  PM** (project lead + PM-tier `project_members`, resolved from `project_id`) +
  every **`project_director`** (role-wide) + every **`procurement_manager`**
  (role-wide). Deduped; the reporter is excluded (no self-ping); a project with
  no PM still alerts the director + procurement pools.
- **config params:** `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` +
  `NOTIFICATION_DRAIN_SECRET` (required — else the drainer answers 503 and rows
  sit `pending`), `TELEGRAM_BOT_TOKEN` (optional second channel),
  `NEXT_PUBLIC_APP_URL` (deep-link base). Recipients need a `line_user_id`
  and/or `telegram_chat_id` to actually receive. The serious-set and the
  recipient rule are the tunable knobs (both currently changed via a
  migration / code change).
- **toggleable?** yes — default **on** once the outbox drainer is configured.
  Pause just this alert (no deploy):
  `alter table public.site_issues disable trigger site_issues_notify_serious;`
  (re-enable with `enable trigger`). Issues keep filing; they simply stop
  enqueuing alerts. Unset the drainer env vars to pause all notifications.
- **status:** live (shipped spec 277 P1a PR3).
- **backing spec + code ref:** spec 277 P1a
  (`docs/feature-specs/277-work-category-visual-identity.md`) · migrations
  `…075660` (enum `site_issue_reported`) + `…075670` (trigger) ·
  `src/lib/notifications/{resolve-recipients,compose-notification,site-issue-recipients,payload}.ts`
  · `src/app/api/notifications/drain/route.ts` · pgTAP
  `supabase/tests/database/294-site-issue-notify.test.sql`.
