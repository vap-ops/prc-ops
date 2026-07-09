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
