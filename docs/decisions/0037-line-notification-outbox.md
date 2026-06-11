# ADR 0037 — LINE notification outbox

**Status:** Accepted — 2026-06-11. Spec 32. Source:
`docs/architecture-revision-2026-06.md` §3.2 (operator granted decision
authority; LINE notifications promoted to the next feature slot).

## Context

Every workflow is a hand-off (SA uploads → PM must notice; PM decides →
SA must notice; PR raised → PM must notice; PR progresses → requester
must notice), and today "notice" means polling the app. All users are
LINE-identified (`users.line_user_id`, ADR 0012). The audit triggers
already _detect_ every transition; nothing _delivers_ them.

## Decision

### Outbox table (`public.notification_outbox`)

- Columns: `id`, `event_type` (enum `notification_event_type`:
  `wp_pending_approval | wp_decision | pr_created | pr_decision |
pr_progress | pr_cancelled`), `work_package_id` (FK, CASCADE),
  `purchase_request_id` (FK, CASCADE), `payload jsonb`, `status` (enum
  `notification_status`: `pending | sent | failed | expired`),
  `attempts int`, `last_error text`, `created_at`, `sent_at`.
- **Deliberately mutable** (drainer updates `status`/`attempts` —
  members/contractors precedent, ADR 0032/0033): an outbox is delivery
  state, not evidence. The _evidence_ stays in `audit_log`.
- **No user access at all:** privileges revoked from
  `authenticated`/`anon`, RLS enabled with zero policies. Writers are
  SECURITY DEFINER trigger functions; the only reader/updater is the
  drainer via the service-role client.

### Event capture — DB triggers, not app code

Triggers fire regardless of writer (app server action, admin client,
`appsheet_writer`) — the spec-25 lesson ("when a gate widens, grep all
layers") solved structurally. Four capture points:

1. `work_packages` AFTER UPDATE → `pending_approval` ⇒ `wp_pending_approval`.
2. `approvals` AFTER INSERT ⇒ `wp_decision`.
3. `purchase_requests` AFTER INSERT (status `requested`) ⇒ `pr_created`.
4. `purchase_requests` AFTER UPDATE WHEN status changed ⇒
   `pr_decision` / `pr_progress` / `pr_cancelled` by transition.

**Capture functions swallow their own failures** (`EXCEPTION WHEN
OTHERS → RAISE WARNING`) — a deliberate divergence from the audit
triggers, which fail the write. Rationale: audit is evidence (must not
be lost); notifications are best-effort (must never block a photo
upload or a decision). Payloads are snapshots of NEW-row fields only —
no joins in triggers; enrichment happens at drain time.

### Delivery — drainer route handler + LINE Messaging API

- `POST /api/notifications/drain`, authenticated by an
  `x-drain-secret` header against `NOTIFICATION_DRAIN_SECRET`.
- Env-gated: while `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` or the secret
  is unset the endpoint answers 503 and rows stay `pending` — the
  feature activates the moment the operator configures the channel
  (both env vars are `.optional()` so existing deploys keep booting).
- Per run: expire `pending` rows older than **24 h** (stale
  notifications are worse than none), take up to 50 oldest, enrich
  (WP code/name, PR number/item, display names), resolve recipients,
  compose Thai messages, push per-recipient
  (`https://api.line.me/v2/bot/message/push`).
- Recipient rules: `wp_pending_approval`/`pr_created` → all
  `project_manager` + `super_admin`; `wp_decision` → distinct photo
  uploaders of that WP; `pr_*` → the requester. Always: drop users
  without `line_user_id`, and drop the event's actor (no
  self-notification).
- Row outcome: any successful push (or zero resolvable recipients) ⇒
  `sent`; all pushes failed ⇒ `attempts+1`, `pending` until 3 attempts,
  then `failed` with `last_error`. Per-recipient failures (user hasn't
  friended the OA) never abort the run.
- **Claim semantics (amended in-build):** a run slower than the cron
  minute would let the next run re-read the same `pending` rows and
  double-send. The drainer claims its batch first (`pending` →
  `sending` + `claimed_at`, status-guarded UPDATE returns only the rows
  this run claimed); `sending` rows whose claim is older than 10 min
  are reclaimed to `pending` at the start of every run (crash
  recovery, attempts unchanged). `notification_status` gains `sending`
  in its own migration.

### Scheduling — pg_cron + pg_net, no new platform

`pg_cron` + `pg_net` extensions; `public.invoke_notification_drain()`
(SECURITY DEFINER) reads `notification_drain_url` +
`notification_drain_secret` from **Supabase Vault** and `net.http_post`s
the drainer; scheduled `* * * * *`. Missing Vault entries ⇒ silent
no-op, so the schedule is safe to ship before the operator configures
anything. This keeps the platform count at two (Vercel + Supabase) per
architecture-revision §3.3 — no Vercel-cron plan dependency, no new
worker.

### Operator-side (one-time, go-live checklist §8)

Create a LINE **Messaging API** channel (separate from the Login
channel), issue a long-lived channel access token, set the two Vercel
env vars, insert the two Vault secrets, and have users add the OA as
friend (push to a non-friend fails per-recipient and is counted).

## Rejected

- **Per-event app-code sends** — repeats the multi-layer gate problem;
  misses `appsheet_writer` writes entirely.
- **Vercel cron** — plan-dependent scheduling; pg_cron is already in
  the stack's platform budget.
- **Web Push** — wrong channel for this user base; recorded as a
  future fallback, not v1.

## Consequences

- New enums/table/triggers are additive; no existing table changes.
- **Deliberate breadth (review finding, recorded):** the PR capture
  trigger emits `pr_cancelled` on ANY transition into `cancelled`, while
  spec 32 §2 names only `approved→cancelled` (the only path that exists
  today, app-guarded). If a future cancellation path lands (e.g.
  requester self-cancel from `requested`), it will notify without a
  spec change — but note the cancellation AUDIT trigger is gated on
  `approved→cancelled`, so that future unit must widen audit too.
- LINE message quota is plan-dependent (operator picks the OA plan;
  volumes at pilot scale are tens/day).
- Recorded seams: per-user notification preferences/opt-out; LINE Flex
  message formatting; drain-on-write fast path (fire-and-forget fetch
  after server actions) if minute-latency ever matters.
