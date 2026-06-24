# Spec 193 — in-app feedback (bug report / feature request)

**Why:** the operator wanted users to report bugs / request features from inside the
app, **designed so CC has enough to fix or build without a round-trip.**

## Design

A `ความช่วยเหลือ` row in `/settings` → `/feedback` (a settings sub-surface, back chip
→ /settings; `getClaims` so every authenticated role can file one). The form
(`FeedbackForm`) asks for the minimum a person will actually complete, and
auto-attaches the high-value triage context so they never type it:

- **type** — `แจ้งปัญหา` (bug) / `ขอฟีเจอร์` (feature), a segmented toggle.
- **title** — one line, required.
- **details** — one textarea whose placeholder changes by type (bug: what you did →
  expected → actual; feature: what you want + why). Operator chose the guided single
  field over fully-structured boxes (lower friction, still structured).
- **screen** — optional, user-named "related screen/menu".
- **auto-captured** (the part that makes a report actionable): `role_snapshot` (most
  bugs are role/RLS-gated — which role hit it), `app_version` (which code state, from
  `package.json` server-side), `user_agent` (mobile vs desktop), best-effort
  `page_path` (the referrer).

## Storage / security

- mig `20260813000000`: `feedback` table (+ `feedback_type` / `feedback_status` enums).
  Writes via `submit_feedback` definer (stamps `submitted_by` + `role_snapshot` from
  the session; `app_version` / `user_agent` passed by the server action). RLS: the
  submitter reads their own (to see status), `super_admin` reads all; everyone else
  none. `status` (open → in_progress / done / declined) is the triage lifecycle.
- pgTAP `208`: submit + the server-side role stamp, RLS read scoping, execute lockdown.

## How CC reads submissions

CC triages by querying the table with the linked CLI (admin):

```
pnpm exec supabase db query --linked --file <sql>
```

with e.g. `select created_at, type, status, role_snapshot, app_version, user_agent,
title, screen, page_path, body from public.feedback where status = 'open' order by
created_at desc;` — every row carries enough to locate the code (screen / page_path
/ role) and act.

## Deferred

- An in-app `super_admin` review list (today CC reads via `db query`).
- Screenshot attachment (storage bucket + RLS) — would help UI bugs.
- A status-update RPC (mark triaged/done) + a Telegram ping on new feedback.
