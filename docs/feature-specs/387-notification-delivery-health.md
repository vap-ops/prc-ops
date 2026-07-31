# Spec 387 — Notification delivery health (ระบบส่งการแจ้งเตือนมีปัญหา)

- **Status:** U1 + U2 built 2026-07-31 (operator picked this over 384 U2 in-chat). Code-only, no schema.
- **Owner lane:** `tgbind` (see `../LANES.md`).
- **Related:** [386](386-telegram-self-serve-binding.md) found the outage this spec makes visible; ADR 0037 outbox; [283](283-system-integrity-console.md) is the console this deliberately does **not** use.

## 1. Problem

LINE push died org-wide on 2026-07-22 08:49 UTC with `429 {"message":"You have reached your monthly limit."}`. **404 outbox rows failed and nobody knew for ten days.** It surfaced only because the operator reported a different symptom — "the procurement manager isn't told about new purchase requests" — whose apparent cause (a routing gap) was real but not why she heard nothing.

Nothing in the product says the pipeline has stopped. Worse, the channel that would normally carry such an alert **is the one that breaks**, so the signal cannot be a push. It has to be a read the operator walks up to.

The quota resets on LINE's monthly cycle, so this will recur — silently — at the next boundary.

## 2. The metric is the design, and the obvious one is a trap

The instinctive tile is "last successful delivery: N ago". **This outbox cannot answer that question.** `rowOutcomeAfterPushes` stamps a row `sent` when `recipientCount === 0` (`drain-policy.ts:32`), so a row nobody could receive is indistinguishable from a delivered one.

Measured live 2026-07-31, on day ten of a total blackout:

```
max(sent_at) where status='sent'                          → 2026-07-30 03:15
max(sent_at) where status='sent' and last_error is null   → 2026-07-30 03:15
last GENUINE LINE delivery                                → 2026-07-21 22:58
```

A last-success tile would have read **"1 day ago"** throughout. It would have shown green for the entire outage.

So the signal keys on the **failure** side, which is unambiguous: a `failed` row exhausted its attempts and was definitively not delivered.

### 2.1 The threshold, from the live distribution

| week of | terminal | failed | rate                  |
| ------- | -------- | ------ | --------------------- |
| 06-29   | 330      | 0      | 0%                    |
| 07-06   | 614      | 0      | 0%                    |
| 07-13   | 456      | 0      | 0%                    |
| 07-20   | 584      | 256    | 44% ← quota hit 07-22 |
| 07-27   | 167      | 141    | 84%                   |

**Zero failures across 1,400 terminal rows in the three healthy weeks.** So `degraded = failed > 0` is not a 99%-fire-rate badge (the spec 375 `เกินกำหนด` defect) — any failure is genuinely abnormal, and this trigger would have fired on **day one** where a rate threshold would have waited. Re-run the table before trusting the threshold again; if a steady trickle of single-recipient 403s ever becomes normal, `degraded` needs a floor.

## 3. Where it renders — and where it deliberately does not

Spec 283 shipped `/settings/integrity`, which looks like the obvious home. It is not:

| route                 | views (21d) | distinct users            |
| --------------------- | ----------- | ------------------------- |
| `/settings/integrity` | **0**       | **0**                     |
| `/settings`           | 966         | 17 (super_admin: **231**) |

`/settings/integrity` is `requireRole(["super_admin"])` — an audience of two — and has not been opened once in three weeks. Putting the signal there is the spec 339 U1 failure exactly: a correct detector on a page nobody stands on is not a shipped feature. The **same super_admin** opens `/settings` 231 times in the same window.

So the notice renders on `/settings`, inside the existing การแจ้งเตือน group, **super_admin only** — they are the only person who can act on a dead channel, and the read needs the service-role client anyway.

## 4. Units

### U1 — the 429 honest-copy fix (code-only)

`sendTestNotification` mapped every non-403 failure to `ส่งข้อความทดสอบไม่สำเร็จ กรุณาลองใหม่`. A 429 is the **monthly quota**: it cannot succeed on a retry until the billing cycle rolls, so that message told every user to re-press a button guaranteed to refuse — live from 07-22 and still refusing ten days later. Now named, with what to do instead, and explicitly "pressing again now still won't send". The generic retry arm stays for genuinely transient failures, pinned by a positive control.

### U2 — the delivery-health notice (code-only)

- `src/lib/notifications/delivery-health.ts` — `summarizeDeliveryHealth` (pure, the piece worth pinning) + `loadDeliveryHealth(admin)`. Takes the client as a **parameter**, matching `readiness.ts`, so no `server-only` import crosses into a module the client graph might touch (the spec 371 U2 boundary lesson).
- `authenticated` holds **no grant on `notification_outbox`** (RLS on, zero policies), so the read uses the service-role seam. No migration.
- Best-effort: any failure returns `null` and the component renders **nothing**. A health signal that nags on its own probe failure is worse than the silence it replaced.
- The notice names the counts **and the verbatim `last_error`** — the cause is the actionable half, since a quota and a bad token need opposite responses — and states plainly that the reader cannot fix it by retrying.

⚠️ `src/lib/notifications/**` is a danger path, so this PR is operator-held by design. The file is placed where it belongs semantically rather than moved to dodge the guard.

## 5. Out of scope

Fixing the false-`sent` collapse itself (a drain change, and the honest fix is a per-recipient delivery ledger — see §6) · alerting anyone but super_admin · a push/email escalation (the channel is the thing that breaks) · historical charting · auto-remediation.

## 6. Follow-up worth its own spec

**The outbox cannot distinguish "delivered" from "had nobody to deliver to."** That is why §2's metric had to be chosen around it, and it also means `sent` counts overstate delivery in every report anyone builds on this table. The fix is a per-recipient outcome record; ADR 0037 accepted the per-row collapse deliberately, and spec 318 §5 re-accepted it, so reversing it is a decision, not a bug fix.

## 7. Acceptance

Not a green suite — the notice must be **visible to the operator on `/settings` today**, because the pipeline is degraded right now (218 failed of 244 terminal in the trailing 7 days). And it must **disappear on its own** once the channel recovers:

```sql
select count(*) filter (where status='failed') failed,
       count(*) filter (where status in ('sent','failed')) terminal
from notification_outbox where created_at > now() - interval '7 days';
```
