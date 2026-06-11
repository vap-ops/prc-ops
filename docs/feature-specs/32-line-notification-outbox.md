# Spec 32 — LINE notification outbox

**Status:** locked — 2026-06-11. ADR 0037 (binding design). Origin:
architecture-revision-2026-06 §3.2; operator granted decision authority.

## 0. Locked design

Push notifications for workflow hand-offs, delivered to LINE. DB
triggers capture events into `notification_outbox`; a secret-gated
route handler drains the outbox through the LINE Messaging API;
pg_cron + pg_net invoke it every minute via Vault-stored URL/secret.
Everything ships env-gated: zero behavior change until the operator
configures the Messaging channel (§7).

## 1. Scope

**In:**

- Migration A: `notification_event_type` + `notification_status`
  enums, `notification_outbox` table (mutable-by-design, zero user
  access), four SECURITY DEFINER capture trigger functions
  (failure-swallowing) per ADR 0037, index `(status, created_at)`.
- Migration B: `pg_cron` + `pg_net` extensions,
  `invoke_notification_drain()` (Vault-read, silent no-op when
  unconfigured), `cron.schedule('notification-drain', '* * * * *', …)`.
- pgTAP file 25: table shape, enum labels, RLS/privilege denial for
  authenticated, each capture trigger fires with the right
  `event_type` + payload, actor fields captured.
- Pure modules (test-first): `compose-notification.ts` (Thai message
  text per event), `resolve-recipients.ts` (ADR 0037 rules incl.
  actor exclusion + missing-line-id drop), `drain-policy.ts`
  (expiry/attempt predicates), `line-push.ts` (fetch wrapper).
- Route handler `POST /api/notifications/drain`: header secret check,
  503 when unconfigured, expire pass, batch of 50, enrichment queries
  via admin client, per-recipient push, row outcome updates, JSON
  counts response.
- `env.server.ts`: `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` +
  `NOTIFICATION_DRAIN_SECRET`, both optional. `.env.example` entries.
- Go-live checklist §8: operator setup runbook.

**Out (recorded seams):** per-user preferences/opt-out, Flex messages,
drain-on-write fast path, Web Push fallback, notification history UI,
admin resend tooling.

## 2. Event → recipients → message (locked table)

| event_type            | trigger source                     | recipients                         | message (Thai, composed at drain)                           |
| --------------------- | ---------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `wp_pending_approval` | WP status → `pending_approval`     | all PM + super_admin               | งานรอตรวจ: {code} {name}                                    |
| `wp_decision`         | approvals INSERT                   | distinct photo uploaders of the WP | ผลการตรวจ {code}: {APPROVAL_DECISION_LABEL} (+comment)      |
| `pr_created`          | PR INSERT                          | all PM + super_admin               | คำขอซื้อใหม่ PR-{n}: {item} ({qty} {unit})                  |
| `pr_decision`         | PR `requested→approved/rejected`   | requester                          | คำขอซื้อ PR-{n}: {PURCHASE_REQUEST_STATUS_LABEL} (+comment) |
| `pr_progress`         | PR `→purchased/on_route/delivered` | requester                          | คำขอซื้อ PR-{n}: {PURCHASE_REQUEST_STATUS_LABEL}            |
| `pr_cancelled`        | PR `approved→cancelled`            | requester                          | คำขอซื้อ PR-{n} ถูกยกเลิก (+reason)                         |

Universal rules: drop recipients without `line_user_id`; drop the
event actor (decided_by / cancelled_by / approver — no
self-notification); zero remaining recipients ⇒ row is `sent`
(processed, nothing to deliver).

Payloads are NEW-row snapshots only (no joins in triggers). Drain-time
enrichment joins WP code/name and `pr_number` and resolves names via
the admin client.

## 3. Failure posture (locked)

- Capture functions wrap their body in
  `EXCEPTION WHEN OTHERS THEN RAISE WARNING … RETURN NEW` — a
  notification must never block a photo upload, a decision, or an
  AppSheet write. Divergence from audit triggers is deliberate
  (ADR 0037).
- Drain: any successful push ⇒ `sent`; all failed ⇒ attempt++, retry
  next minute, `failed` at 3 attempts with `last_error`.
- Expiry: `pending` older than 24 h ⇒ `expired` before each drain
  batch (protects against a backlog flood when the operator first
  configures the channel).
- `invoke_notification_drain()` returns silently when Vault entries
  are missing; the drain endpoint returns 503 when env is missing.

## 4. Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green (new unit tests
      for compose / resolve / drain-policy / line-push RED first).
- [ ] `supabase db push --dry-run` clean before work; migrations
      pushed only after commit to `main` (change-management policy).
- [ ] `pnpm db:test` green including new file 25; post-push
      `pnpm db:types` regenerated.
- [ ] Manual probes (SQL editor, read-only): a PR INSERT and a WP
      `pending_approval` UPDATE each produce one `pending` outbox row.
- [ ] Drain endpoint answers 503 without env config (prod-safe
      pre-activation); 401 on wrong secret.
- [ ] `cron.job` lists `notification-drain`; no errors in
      `cron.job_run_details` while unconfigured.

## 5. Operator activation (full runbook in go-live checklist §8)

1. LINE Developers console: create **Messaging API** channel under the
   same provider; issue long-lived channel access token.
2. Vercel env: `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`,
   `NOTIFICATION_DRAIN_SECRET` (generate 32+ random chars). Redeploy.
3. Supabase Vault: secrets `notification_drain_url` =
   `https://prc-ops.vercel.app/api/notifications/drain`,
   `notification_drain_secret` = same value as Vercel.
4. Users add the OA as friend (QR in LINE console) — push to
   non-friends fails per-recipient and is counted, not fatal.
5. Acceptance: upload an After photo on a test-safe WP → PM phone gets
   LINE message within ~1 minute.
