# Spec 386 — Telegram self-serve binding (เชื่อม Telegram ด้วยตัวเอง)

- **Status:** design LOCKED on the two operator forks (in-chat 2026-07-31) — **new dedicated bot** · nudge audience = **office users**. **U1 shipped** ([#900](https://github.com/vap-ops/prc-ops/pull/900), mig `075888`) · **U5 shipped** ([#907](https://github.com/vap-ops/prc-ops/pull/907)). **U2/U3/U4 blocked on U0** — the three `TELEGRAM_*` env vars are confirmed absent from Vercel prod as of 2026-08-01 (§8.1). Rollout plan: §8.
- **Owner lane:** `tgbind` (see `../LANES.md`).
- **Reverses:** [spec 318](318-notification-onboarding-settings.md) §5, which put "Telegram self-serve linking (stays operator-set `telegram_chat_id`)" explicitly out of scope. Read 318 first — its per-user `notification_preferences` model (§3.3) is the contract this channel must respect, and its readiness surface (§3.2/§3.4) is where this one lands.
- **Depends on:** ADR 0037 outbox · the Telegram push wrapper `src/lib/notifications/telegram-push.ts` (live since 2026-06-26) · spec 318 `NotificationReadiness`.
- **Related:** [386 is the channel half of what PR #896 routed](https://github.com/vap-ops/prc-ops/pull/896) — that PR made `procurement_manager` a `pr_created` recipient, and the routing is inert until a channel delivers.

## 1. Problem — measured live 2026-07-31, §1.2 re-measured 2026-08-01, re-measure before quoting

### 1.1 The channel that was supposed to be the fallback has never run

`TELEGRAM_BOT_TOKEN` is **not set in the Vercel prod env**. Not "probably" — the outbox proves it:

- `notification_outbox` holds **zero rows all-time** whose `last_error` begins `Telegram`.
- **68 `wp_pending_approval` rows have FAILED since 2026-07-22**, every one with a LINE error.
- The single `telegram_chat_id` holder is `super_admin` ⇒ in `PM_ROLES` ⇒ in `orgWidePmIds` ⇒ a recipient of **every one of those 68** (`resolve-recipients.ts` `wp_pending_approval` → `approvalPool`), and `notification_preferences` shows he muted `pr_created` **only**.

So if the token were set, each of those rows must have produced either a Telegram **success** (⇒ the row is `sent`) or a Telegram **failure** (⇒ a `last_error` starting `Telegram`). Neither exists. The 2026-06-26 activation note in `docs/progress-tracker.md` lists two steps — set a `telegram_chat_id` (done, once, by hand) and add `TELEGRAM_BOT_TOKEN` to Vercel (never done).

⚠️ **`status='sent'` is not evidence of delivery and was deliberately not used as any.** `rowOutcomeAfterPushes` returns `sent` when `recipientCount === 0` (`drain-policy.ts:32`), so a row with no resolvable recipient is indistinguishable from a delivered one. The 24 `wp_decision` rows marked `sent` during the outage are exactly that case — a different user muted `wp_decision`, leaving the row with nobody to push to.

### 1.2 LINE cannot reach the people who decide

Nine days of `LINE 429 {"message":"You have reached your monthly limit."}` (first 2026-07-22 08:49 UTC, still failing 2026-07-31 04:05) is the acute problem, and it is the operator's plan-vs-volume call, not this spec's. The chronic problem is worse and survives the quota reset — **a non-friend of the OA cannot be pushed at all**, and friendship is inverted against need:

| Tier                                                                                                             | users | OA friend | NOT friend | never probed |
| ---------------------------------------------------------------------------------------------------------------- | ----- | --------- | ---------- | ------------ |
| **Office** (super_admin, project_director, project_manager, procurement_manager, procurement, accounting, legal) | 17    | **1**     | 6          | 10           |
| technician                                                                                                       | 13    | **11**    | 1          | 1            |
| site_admin                                                                                                       | 5     | 1         | 2          | 2            |

_(Re-measured live 2026-08-01; the 07-31 draft read office 16 / never-probed 9 and site_admin 6 / never-probed 3. Org total is 40 either way — visitor 4, client 1. Do not inherit these; re-run the query.)_

All 14 OA friends org-wide are 11 technicians + 1 accounting + 1 site_admin + 1 visitor — unchanged on the re-measure. **Zero** among super_admin, project_director, project_manager, procurement_manager, procurement, legal.

⭐ **This is the finding that sets the audience.** For the office tier Telegram is not a fallback behind LINE — it is the only channel with a path to working. For technicians LINE already works and a Telegram nag would be noise. (`line_oa_friend` is login-fresh; `null` = never probed since spec 318 U1, so "never probed" is _unknown_, not _unreachable_ — the honest read is 1 confirmed reachable out of 17, not 16 confirmed unreachable.)

### 1.3 Binding is operator-only, so the fallback rescues almost nobody

**1 of 40 users** has a `telegram_chat_id`, set by hand in SQL. There is no app path to set one and no app path to clear one:

```
has_table_privilege('authenticated','public.users','UPDATE')            → false
has_column_privilege('authenticated','public.users','telegram_chat_id','UPDATE') → false
has_column_privilege('authenticated','public.users','telegram_chat_id','SELECT') → true
```

The only UPDATE policy on `users` is `super_admin full access`, and `authenticated` holds no table grant to exercise even that. So **both** binding and unbinding require a `SECURITY DEFINER` RPC — this is why the spec starts with a migration rather than a page.

And on `/settings/notifications` the Telegram row renders only for the already-linked (`readiness.telegramLinked ? <ReadyRow ok …/> : null`), so the 39 unlinked users are shown nothing at all — no status, no affordance, no explanation.

## 2. The binding problem, and why it takes this shape

Telegram never hands an application a chat id. It hands one to a **bot**, and only once the user has messaged that bot. So binding is unavoidably a round trip through Telegram:

```
app: mint one-time token for the signed-in user
  → deep link  https://t.me/<bot>?start=<token>
  → user taps START in Telegram
  → bot receives  /start <token>  with message.chat.id
  → server resolves token → user, writes users.telegram_chat_id
```

Two hard constraints from the Bot API (verified against the docs 2026-07-31, not from memory):

- **The `start` payload is ≤ 64 characters, `A-Z a-z 0-9 _ -` only.** base64url of 32 random bytes is 43 characters — fits with room, and 256 bits of entropy is the right floor because _possession of the token is what proves identity_.
- **`setWebhook(secret_token)` makes Telegram send `X-Telegram-Bot-Api-Secret-Token`** (1–256 chars, same alphabet). That header is the webhook's **only** authentication. Nothing in the update body is trustworthy — anyone can POST a JSON blob claiming any `chat.id`.

### 2.1 Why a dedicated bot (operator decision 2026-07-31)

`getMe` on the token in `.telegram.env` returns **`VAP CC Bot` / @VAPTest_bot** (id 8389705696) — Claude Code's own progress bot, and its `TELEGRAM_CHAT_ID` is byte-identical to the `telegram_chat_id` on the operator's `users` row. A direct `sendMessage` to it succeeds today (message_id 821, 2026-07-31), so bot and chat id are both valid.

Reusing it was rejected for a reason stronger than the name: **`setWebhook` is exclusive per bot**, so pointing the app's webhook at that bot means the app receives every message the operator sends to their own CC progress bot. A dedicated bot keeps the two apart. Cost: one BotFather session.

### 2.2 Rejected alternatives

- **Telegram Login Widget** — avoids a public endpoint and returns a signed payload, but needs a browser session logged into Telegram and a domain bound via `/setdomain`. The audience is on phones with the Telegram _app_; the deep link is one tap there and the widget is not.
- **`getUpdates` polling from the existing per-minute cron** — avoids a new public endpoint, but needs an update-offset store, is mutually exclusive with `setWebhook`, and turns a 2-second binding into a ≤60-second one while the user stares at the screen.

## 3. Design

### 3.1 U0 — operator, blocks delivery for everything below

1. **BotFather** → create the bot → hand over the token and the `@username`.
2. **Vercel prod** → set `TELEGRAM_BOT_TOKEN` (the new bot's), `TELEGRAM_WEBHOOK_SECRET` (32 random base64url chars), `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` → redeploy.
3. Run `setWebhook` once against `<app>/api/telegram/webhook` with that secret (a documented one-liner in the U2 PR body, not an app feature).

⚠️ Until step 2, binding still _works_ and the fill rate still moves — the drain simply keeps skipping the Telegram pass. Do not read a moving fill rate as proof of delivery.

### 3.2 U1 — token store + the three RPCs (schema, mig `20260813075888`)

New `public.telegram_link_tokens`:

| column                             | notes                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token text` PK                    | `check (token ~ '^[A-Za-z0-9_-]{32,64}$')` — the Bot API alphabet, enforced in the DB so a future caller cannot mint a token the deep link would silently mangle |
| `user_id uuid`                     | `references users(id) on delete cascade`                                                                                                                         |
| `created_at` / `expires_at`        | `check (expires_at > created_at)`; TTL **15 minutes**                                                                                                            |
| `consumed_at` / `consumed_chat_id` | single-use; kept for the trail, not read by the app                                                                                                              |

RLS enabled with **no policies** and `revoke all … from public, anon, authenticated` — the table is reachable only through the RPCs and the service role. Partial index on `(user_id) where consumed_at is null`.

`users` gains `telegram_linked_at timestamptz` (nullable) and a **partial unique index on `telegram_chat_id where not null`**. Safe to create: exactly one non-null value exists today.

Three `SECURITY DEFINER` functions, all `set search_path = public, pg_temp` (the house shape, per `set_notification_preference`), all `revoke all … from public, anon` — `public` as well as `anon`, or PUBLIC keeps EXECUTE by default:

- **`start_telegram_link() returns text`** — `grant execute to authenticated`. Self-scoped on `auth.uid()` (raises 42501 when unbound; `coalesce`-hardened, per the RLS self-check trap). Deletes the caller's unconsumed tokens (mint = rotate, so an abandoned link dies immediately), inserts a fresh one, returns it. Token = `rtrim(translate(encode(gen_random_bytes(32),'base64'),'+/','-_'),'=')`.
- **`consume_telegram_link_token(p_token text, p_chat_id text) returns jsonb`** — **`grant execute to service_role` only**; revoked from `authenticated` as well as `anon`/`public`, because this is the function that writes an identity link and its only legitimate caller is the webhook. Returns `{"ok":true,"display_name":…}` or `{"ok":false,"reason":"invalid_or_expired"|"chat_already_linked"}`. `chat_already_linked` fires when the chat id belongs to a **different** user — a shared Telegram account would otherwise deliver one person's notifications to another. Re-binding the same user's own chat is idempotent and succeeds.
- **`unlink_telegram() returns void`** — `grant execute to authenticated`. Clears `telegram_chat_id` + `telegram_linked_at` for `auth.uid()` and deletes their unconsumed tokens. One tap, no confirmation dialog: it is reversible in two taps.

pgTAP `386-telegram-link.test.sql` — table shape and the CHECKs; RLS on with zero policies; `has_function_privilege` **false** for `anon` on all three and for `authenticated` on `consume_…` (the house pattern from `100-anon-exec-definer-harden`, which resolves PUBLIC through role inheritance — _not_ an `information_schema.role_routine_grants` count, which has no PUBLIC arm and reads "safe" either way); role-switched happy path, expired token refused, replayed token refused, foreign chat refused. **Every refusal assert is paired with a positive control** — a fresh valid token through the same caller must succeed, or the file cannot tell "the guard works" from "nothing works".

### 3.3 U2 — the webhook (danger path: `src/app/api/**` — operator merge, no override)

`POST /api/telegram/webhook`:

1. 401 unless `X-Telegram-Bot-Api-Secret-Token` matches `TELEGRAM_WEBHOOK_SECRET` under a **constant-time** compare (the `secretMatches` sha256+`timingSafeEqual` helper the drain already uses — same shape, hashed both sides so lengths normalise).
2. 503 when the env is unconfigured, mirroring the drain's `not_configured` posture, so a deploy without the secret rejects rather than accepts.
3. Extract `message.text` and `message.chat.id`. Anything that is not `/start <token>` gets a friendly "กดปุ่มเชื่อมบัญชีในแอปก่อน" reply and a 200 — **never a 4xx**, or Telegram retries and eventually disables the webhook.
4. `consume_telegram_link_token` via the **admin** client. Reply in-chat with copy that matches the outcome honestly:
   - ok → `เชื่อมบัญชีสำเร็จ — <ชื่อ> จะได้รับการแจ้งเตือนทางนี้` (naming the account is the proof they bound the right one)
   - `invalid_or_expired` → retryable, and says how: `ลิงก์หมดอายุ กลับไปที่แอปแล้วกดเชื่อมอีกครั้ง`
   - `chat_already_linked` → **permanent**, so no `ลองใหม่`: `แชทนี้ผูกกับบัญชีอื่นอยู่แล้ว` + what to do instead (unlink on the other account).
5. Identity comes **only** from the token. The payload's `from.id`, `chat.username` and any `user_id`-shaped field are never read for authorisation.

### 3.4 U3 — the settings surface (code-only)

On `/settings/notifications`, the Telegram row stops being linked-only:

- **unlinked** → status row + `เชื่อม Telegram` button → server action calls `start_telegram_link()` → opens `https://t.me/<username>?start=<token>`. One line of copy naming what gets stored (the chat id), which is the PDPA notice at the point of collection.
- **linked** → ✓ row (existing `NOTIF_TELEGRAM_ROW`) + `ส่งข้อความทดสอบ` (the `sendTestNotification` precedent, Telegram arm) + `ยกเลิกการเชื่อม`.

`NotificationReadiness` already carries `telegramLinked`; `readinessFromUserRow` stays the pure builder. New labels go in `labels.ts` (shared SSOT — additive only).

⚠️ Out of scope for U3 and worth its own line: `sendTestNotification` currently maps every non-403 LINE failure to `ส่งข้อความทดสอบไม่สำเร็จ กรุณาลองใหม่`. Under the live 429 that is a "try again" on a refusal that cannot succeed until the monthly cycle rolls — the honest-copy class. Fix it in the same file or spawn it; do not widen U3's scope silently.

### 3.5 U4 — the nudge (code-only)

The honest place is the surface LINE already uses — `NotificationReadinessBanner`, not a new banner. Today it renders on `friendFlag === false` alone. It gains a second, **role-scoped** arm: an **office** user who is neither an OA friend nor Telegram-linked is offered the Telegram bind.

`TELEGRAM_NUDGE_ROLES` lives in `src/lib/notifications/`, **not** `role-home.ts` (that file is a danger path and this is not a permission set — nothing is granted or denied by it). Members, decided per role rather than copied from a set built for another purpose: `super_admin`, `project_director`, `project_manager`, `procurement_manager`, `procurement`, `accounting`, `legal`, plus `hr` and `project_coordinator` — office desks with zero live users today, included so the first person given one is nudged rather than silently skipped. Excluded: `technician` and `site_admin` (on-site, and LINE reaches them), `site_owner` / `auditor` (governance tier, spec 376), `contractor` / `subcon_manager` / `client` (external), `visitor` (unassigned).

Pinned by an **exhaustive-domain** test over every `user_role` value asserting the positive set is EXACTLY that list — so a new enum value reds the guard in the _add_ direction too, not just the widen direction. 17 enum values live today.

## 4. Unit order, sizing, merge path

| Unit                            | Class                                | Merge path                         | Points |
| ------------------------------- | ------------------------------------ | ---------------------------------- | ------ |
| U0 bot + env + `setWebhook`     | operator                             | —                                  | —      |
| U1 token store + 3 RPCs + pgTAP | mig `075888` (additive)              | standing-grant self-merge on green | 5      |
| U2 webhook route                | **danger path** `src/app/api/**`     | **operator merge**                 | 5      |
| U3 settings bind/unbind/test    | code-only                            | auto-merge                         | 4      |
| U4 role-scoped nudge            | code-only                            | auto-merge                         | 3      |
| U5 onboarding roster            | code-only (`src/lib/notifications/`) | **operator merge** (danger path)   | 3      |

U1 does not depend on U0 — the token store is bot-agnostic. U2 cannot be real-flow verified before U0.

### 3.6 U5 — the onboarding roster (code-only)

Operator, 2026-07-31: _"where do I track the status who is onboarding to this feature?"_ — the honest answer was **nowhere**. §6's fill rate is the acceptance number, but a number is not a chase list.

Home is `/settings/roles`: already `requireRole(["super_admin"])`, already lists every user, and — unlike the integrity console — **alive: 46 views / 2 users / last opened today**. It gains a per-person reachability chip plus a counts header.

Four states, and the third is the load-bearing one:

| state         | meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `telegram`    | `telegram_chat_id` bound                                     |
| `line`        | confirmed OA friend                                          |
| **`unknown`** | **`line_oa_friend is null` — never probed, NOT unreachable** |
| `none`        | confirmed non-friend, unbound                                |

`line_oa_friend` refreshes only at LINE login (spec 318 U1), so **16 of 40 users sit at null right now** (re-measured 2026-08-01; 15 at U5's ship). Rendering those as a failure would send the operator chasing people who may already be fine, so `unknown` is its own arm and is styled **neutrally**, never as a warning.

⚠️ **The roster measures BINDING, not delivery.** While `TELEGRAM_BOT_TOKEN` is unset the drain skips Telegram entirely, so a green chip would imply a message that never left the building. The page reads `serverEnv.TELEGRAM_BOT_TOKEN` and renders an explicit "the bot is not configured" line until U0 lands.

Both columns carry an `authenticated` SELECT grant and the super_admin RLS policy already permits the all-users read, so this stays on the session client — no admin seam, no migration.

## 5. Out of scope (explicit)

Group chats and channels (private chats only) · Telegram as a _reply_ surface (approve-from-chat: an authorisation surface with none of the app's gates) · per-channel preferences (spec 318's `notification_preferences` is per-event and channel-agnostic; a user who binds Telegram gets the events they have not muted, and that is the contract) · migrating LINE recipients off LINE · a delivery ledger · surfacing outbox health in-app (a real gap — see §7).

## 6. Acceptance — a fill rate, not a green suite

```sql
-- before: 1 of 40. Office tier: 1 of 17 -- and that 1 is the operator's own
-- hand-set row, so the office tier has ZERO self-served bindings. Both counts
-- must move. (Re-measured live 2026-08-01; the 07-31 draft said office 0,
-- which was wrong: the single bound user is super_admin, i.e. office tier.)
select count(telegram_chat_id) linked, count(*) total from users;
select count(telegram_chat_id) filter (where role::text in
  ('super_admin','project_director','project_manager','procurement_manager',
   'procurement','accounting','legal')) office_linked
from users;
```

`linked` must move off **1** after U3+U4 ship. If it does not, the nudge is in a place nobody stands (the spec 339 U1 lesson — a correct detector on `/settings`, a page opened 70 times against 810 `/sa` visits) and the next unit is placement, not more copy.

Delivery is a **separate** acceptance and needs U0:

```sql
select status, count(*), max(created_at), max(last_error)
from notification_outbox where created_at > now() - interval '3 days' group by 1;
```

A row whose recipients include a Telegram-linked user must stop being `failed` while LINE is still 429. Zero `Telegram …` values in `last_error` after U0 means the pass still is not running.

## 7. Risks / open items

- **The LINE quota resets on a monthly cycle**, so this may appear to self-heal around 08-01 and blow again mid-month, silently — nothing in the app surfaces the outbox failure rate. A push-delivery health tile is the obvious follow-up and is _not_ in this spec.
- **A new public endpoint** is the real cost of U2. Its blast radius is bounded to "write a chat id onto the user who minted a valid unexpired token", and the token is the only identity input.
- **PDPA:** `docs/policies/privacy-policy.md` already says the app stores a "Telegram id if the user opts into Telegram notifications" and lists Telegram as a processor — the policy is written _ahead_ of the code, so no policy change is owed. What is owed is the collection-point notice in U3 and the one-tap unlink in U1/U3, both specified above.
- **Consumed tokens are never pruned.** `telegram_link_tokens` keeps its consumed rows as the binding trail; at this volume that is a rounding error, but it is a retention surface, so if a prune ever ships it belongs beside the existing `notification_outbox` retention pass, not as its own cron.
- **A bound chat is a device, not a person.** Unlink exists for the leaver/lost-phone case; there is no admin-side unbind in this spec (super_admin can already UPDATE `users`).

## 8. Rollout & onboarding

U1 (token store + RPCs) and U5 (the roster) have shipped. The channel still delivers nothing, and **1 of 40 users is bound** — re-verified live 2026-08-01. This section is how the remaining distance gets closed, and it is deliberately light: the audience is 17 people.

### 8.1 The four phases

| Phase           | Who      | Effort      | What                                                                          | Done when                                                                      |
| --------------- | -------- | ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **P0 ACTIVATE** | operator | ~10 min     | BotFather → 3 Vercel env vars → one `setWebhook` call (§3.1)                  | An outbox row's `last_error` **can** start `Telegram` (today zero ever have)   |
| **P1 BUILD**    | CC       | ~1 session  | U2 webhook · U3 settings row · U4 nudge                                       | The three PRs are merged; U2 is a danger-path operator merge                   |
| **P2 APPLY**    | 17 users | ~2 min each | nudge → tap `เชื่อม Telegram` → `START` in Telegram → the bot names them back | §6's `linked` count moves off 1                                                |
| **P3 CHASE**    | operator | weekly      | Work the `none` bucket on `/settings/roles` (U5)                              | `none` is empty or explained; `unknown` is left alone until those users log in |

**P0 is the only hard blocker, and it is confirmed outstanding.** Verified in the Vercel UI 2026-08-01: project `prc-ops` → Settings → Environment Variables holds **9 variables** (`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ID`, `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`, `NOTIFICATION_DRAIN_SECRET`, `NEXT_PUBLIC_APP_URL` ×2, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and the **Shared** tab reads _"No shared variables linked"_. None of the three `TELEGRAM_*` variables exists at either level. This is §1.1's outbox inference confirmed by direct observation.

⚠️ **P1 does not wait on P0.** U3 and U4 are code-only and can ship first — binding will write real rows and the fill rate will really move. What will not happen is delivery. Do not read a moving fill rate as proof the channel works (§3.1).

### 8.2 Design decisions

**D1 — No onboarding wizard.** 17 people, two taps. A wizard is a surface nobody opens: spec 339 U1 put a correct detector on `/settings` and measured **70 views against 810 on `/sa`**. The right weight is the in-app nudge (U4) + the settings row (U3) + one handout. Anything more is a surface to maintain and a place for copy to go stale.

**D2 — The real drop-off is one step _before_ binding.** Everything in §3 assumes the user already has Telegram. Thailand is a LINE country; friending an OA needs zero install, whereas Telegram needs the app, a phone number and an SMS code. **We cannot measure this** — nothing on our side can tell an office user who has Telegram from one who does not, and the roster's `none` bucket cannot distinguish "has not bound yet" from "has never had the app". So the instructions **fork on it in step 1** — a whole install-and-signup block that most readers skip in one line, and that the rest of them cannot proceed without. It is first because it is the step that actually loses people; the binding half is the easy part.

**D3 — Instruction placement, ranked.** ① The in-app U4 banner and the U3 helper line — zero distribution cost, always current, and they render where the user already is. ② The handout, operator-sent, whose only real job is D2's install step; the binding half is a courtesy. ③ **Not** a `/help` page — that is D1's wizard wearing a different hat.

**D4 — The bot naming the account back is the proof step, not decoration.** On a shared or borrowed phone, `START` binds whichever Telegram account is signed in on that device — which need not be the person holding it. The reply `เชื่อมบัญชีสำเร็จ — <ชื่อ>` is the **only** signal that tells the user they bound the right identity, and it is the reason §3.3 step 4 returns `display_name` from the RPC rather than a bare `ok`. Keep it.

### 8.3 The handout — U3's copy acceptance, **not yet sendable**

⛔ **Do not send this to anyone yet.** It describes buttons that do not exist. Per the prose gate-check rule, every label below is a factual claim about an affordance on screen; today most of them are claims about U3's _intended_ output. It ships here as **U3's copy acceptance criteria** — U3 renders exactly these strings, then the handout is prod-verified, then it goes out.

Gate-checked against the live tree at `origin/main` `efb4b177` (2026-08-01):

| Handout string               | Status today                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `ตั้งค่า → การแจ้งเตือน`     | ✅ live — `NOTIF_SETTINGS_LABEL`                                                  |
| ปุ่ม `เชื่อม Telegram`       | ❌ **owed by U3** — no such label exists                                          |
| `✓ เชื่อม Telegram แล้ว`     | ✅ live as `NOTIF_TELEGRAM_ROW` — but renders **only when already linked** (§1.3) |
| `ส่งข้อความทดสอบ`            | ⚠️ **the live label is `ส่งข้อความทดสอบเข้า LINE`** — see below                   |
| `ยกเลิกการเชื่อม`            | ❌ **owed by U3** — no such label exists                                          |
| `เชื่อมบัญชีสำเร็จ — <ชื่อ>` | ❌ **owed by U2** (§3.3 step 4)                                                   |

⚠️ **The test button is a real defect the handout exposes, and it widens U3 by one line.** `NOTIF_TEST_BUTTON` is `ส่งข้อความทดสอบเข้า LINE` and `sendTestNotification` has only a LINE arm — so a Telegram-bound office user who follows step 3 today presses a button that pushes to LINE, where they are not an OA friend, and gets a failure. §3.4 already asks U3 for the Telegram arm; it must **also rename the label channel-neutral** (and `NOTIF_TEST_SENT`, which says `เปิด LINE`). Either U3 does that, or the handout's step 3 is wrong on the day it is sent.

---

> **เชื่อม Telegram เพื่อรับแจ้งเตือนจากระบบ PRC Ops**
>
> ตอนนี้ทีมออฟฟิศส่วนใหญ่ยังไม่ได้เพิ่มเพื่อน LINE OA ของบริษัท
> ระบบจึงส่งแจ้งเตือนไปไม่ถึง ขอให้เชื่อม Telegram แทน ใช้เวลาราว 2 นาที
>
> **── ขั้นที่ 1 · ถ้ายังไม่มี Telegram (มีแล้วข้ามไปขั้นที่ 2)**
>
> 1. เปิด App Store (iPhone) หรือ Play Store (Android) ค้นหาคำว่า Telegram
> 2. ติดตั้ง เปิดแอป แล้วกด Start Messaging
> 3. ใส่เบอร์มือถือของท่าน รอรหัสทาง SMS แล้วใส่รหัส
> 4. ใส่ชื่อ-นามสกุล กด Next เป็นอันเสร็จ
>
> **── ขั้นที่ 2 · เชื่อมกับระบบ**
>
> 1. เปิดแอป PRC Ops
> 2. ไปที่ ตั้งค่า → การแจ้งเตือน
> 3. กดปุ่ม เชื่อม Telegram
> 4. แอป Telegram จะเปิดขึ้นเอง กดปุ่ม START ที่ด้านล่างจอ
> 5. บอทจะตอบกลับว่า "เชื่อมบัญชีสำเร็จ — <ชื่อของท่าน>"
>    ⚠️ ถ้าชื่อที่ขึ้นไม่ใช่ของท่าน แปลว่าเชื่อมผิดบัญชี กรุณาแจ้งกลับ
>
> **── ขั้นที่ 3 · ตรวจสอบว่าใช้ได้จริง**
>
> กลับมาที่ ตั้งค่า → การแจ้งเตือน จะเห็น ✓ เชื่อม Telegram แล้ว
> กด ส่งข้อความทดสอบ แล้วดูว่าข้อความเข้า Telegram หรือไม่
>
> **── หมายเหตุ**
>
> - ระบบเก็บเฉพาะรหัสห้องแชท (chat id) ไว้ส่งแจ้งเตือนเท่านั้น ไม่เห็นข้อความอื่นของท่าน
> - ยกเลิกได้ตลอดเวลาที่ ตั้งค่า → การแจ้งเตือน → ยกเลิกการเชื่อม
> - ลิงก์เชื่อมมีอายุ 15 นาที ถ้าหมดอายุ ให้กด เชื่อม Telegram ใหม่อีกครั้ง

---

The หมายเหตุ block is not filler — it is the §7 PDPA obligation discharged at the point of collection (what is stored, that it is revocable, and how), stated in the same place the user acts.

### 8.4 Running both asks in one announcement

The same 16 office users are also LINE-OA non-friends, and **that** onboarding is one tap with no install — `NOTIF_ADD_FRIEND_LABEL` already ships and works today. Adding one sentence pointing at it costs nothing and gives the office tier two channels instead of one. It does not change this spec's audience or scope; it is a note for whoever writes the announcement.

### 8.5 Acceptance

§6 is unchanged and remains the measure: `linked` must move off **1**. If it does not after U3+U4 are live, the next unit is **placement, not more copy** — and D1 is what says so in advance, so that conclusion cannot be argued away after the fact.

- ⚠️ **`line_oa_friend = null` for 16 users is unknown, not unreachable.** Every count in §1.2 should be re-run before it is quoted anywhere; the flag refreshes at each login.
