# 390 — Per-channel notification switches (เลือกช่องทางการแจ้งเตือน)

**Status:** draft · **Owner:** CC · **Created:** 2026-08-03

Operator, 2026-08-03: _"I get noti on line and telegram at the same time, where can I set them up, I want to be able to switch them on/off"_.

---

## 1. The finding — it is not a bug, it is an unbuilt preference

The drain does not CHOOSE a channel. It fans out over one recipient list, unconditionally:

- `src/app/api/notifications/drain/route.ts:514` — `filterMutedRecipients(...)` produces one `deliverable` id list.
- `:515-517` — `lineTargets` = every deliverable user holding a `line_user_id`.
- `:518-522` — `telegramTargets` = every deliverable user holding a `telegram_chat_id`, gated only on `TELEGRAM_BOT_TOKEN`.
- `:555-575` — the LINE loop, then the Telegram loop. The second runs **in addition to**, never instead of, the first.
- `:577-583` — the row is `sent` if ANY push landed (`anySuccess`).

So a user bound to both channels receives every notification **twice**, by construction. There is no dedupe, no preference and no primary-channel concept anywhere in the pipeline.

This is not an oversight introduced by [386](386-telegram-self-serve-binding.md) — that spec named it and scoped it out (§ "per-channel preferences are excluded; `notification_preferences` is per-event and channel-agnostic"). The exclusion was correct at the time: **one** user held both bindings and the LINE channel was dead. Both facts have since changed.

### 1.1 The population is real, spans four roles, and is not a constant

Live, 2026-08-03 (`public.users`):

| line | telegram | users |
| ---- | -------- | ----- |
| ✓    | ✓        | **4** |
| ✓    | —        | 36    |
| —    | —        | 1     |

The four dual-bound users are `super_admin` · `technician` · `project_director` · `procurement_manager` — one from each tier, not a cluster of test rows. The fill-rate discipline that killed [375](375-sa-home-movement-sort.md)'s ranking idea (a column whose every row holds one value) does **not** kill this one: the axis varies.

### 1.2 Why the complaint arrived now

LINE has recovered. Outbox: **0 `failed` / 74 `sent` since 2026-08-01**, the monthly quota roll. The newest failure of any kind is **2026-07-31 10:59:51Z**, `LINE 429: {"message":"You have reached your monthly limit."}`. Through the 07-22 → 07-31 blackout the dual-bound users were receiving Telegram only — the duplication was invisible because one arm was refusing everything. Both arms now work, so both arms deliver.

⚠️ **Quote the window, not a bare count.** The obvious 4-day query returns `sent 76 · failed 17 · pending 1` — the 17 are all the pre-roll quota failures, and a first draft of this section read them as zero. The honest statement is the one above: the cut is the **quota roll**, not "the last N days".

⚠️ **This means the acceptance check below must not be read during another blackout.** A "no more duplicates" report from a period when LINE is quota-dead proves nothing.

---

## 2. The decision — a channel-level pair, not a per-event × per-channel matrix

Rejected: extending `notification_preferences` to `(user_id, event_type, channel)`. It is more expressive and worse: the catalog carries 12 event types, so an office user would face **24 switches on a phone**, and the operator's actual complaint has no per-event shape — they do not want the approval ping on Telegram and the PR ping on LINE, they want **one channel**.

Chosen: a channel-level preference, orthogonal to the existing per-event mute. Two switches maximum, at the top of the page that already owns this subject.

### 2.1 Shape mirrors spec 318 U3 exactly

New table, same contract as `notification_preferences` (`supabase/migrations/20260813075797_spec318u3_notification_preferences.sql`):

- **absence of a row = ON.** Only deviations are stored, so shipping changes nobody's behaviour on day one.
- **own-rows RLS for reads**, `select` granted to `authenticated`.
- **writes are RPC-only** — `authenticated` gets no insert/update/delete grant.

Not chosen: two booleans on `public.users`. `authenticated` holds **no UPDATE grant on `users` at all** ([386](386-telegram-self-serve-binding.md) §1.3), so that route needs a DEFINER RPC anyway and buys nothing, while widening a table every session reads.

### 2.2 The floor: a user may not switch off their last reachable channel

`site_issue_reported` (ปัญหาหน้างานร้ายแรง) is **locked ON** and unmutable — enforced in three layers today (the UI, the server action, and `set_notification_preference`'s `22023`). A channel switch that could reach zero would silently defeat that lock: the event would still be "enabled" and would still reach nobody.

So `set_notification_channel_preference` refuses (`22023`) a disable that would leave the caller with **no enabled channel that could actually deliver**.

🚨 **"Could actually deliver" is NOT the same as "bound", and a first draft of this spec got it wrong in a way that would have shipped the exact bug the floor exists to prevent.** The fact-check caught it against live rows: of the four dual-bound users, the **`procurement_manager` has `line_oa_friend = false` with `line_oa_friend_checked_at` set** — a _verified_ non-friend, and LINE returns 403 to a non-friend. A boundness floor would have let that user disable Telegram, seen `line_user_id is not null`, called it protected, and left them at **zero real delivery** — including for the locked safety event. Org-wide the flag runs **15 true · 10 false · 15 null**, so this is a quarter of the LINE-bound roster, not an edge case.

The floor's reachability predicate is therefore:

- **Telegram** reachable ⇔ `telegram_chat_id is not null`.
- **LINE** reachable ⇔ `line_user_id is not null` **and `line_oa_friend is not false`**.

`null` counts as reachable on purpose: `line_oa_friend` is refreshed only at LINE login, so `null` means _never probed_, not _unreachable_ — [386](386-telegram-self-serve-binding.md) U5's load-bearing lesson, and treating it as a failure here would refuse the switch for 15 people we have no evidence against.

⚠️ **Stated limit, not a guarantee:** a `true` flag can be stale (the user unfriended after their last login), so the floor bounds the damage rather than eliminating it. §2.3 does not get to assume a live channel always exists — it gets to assume the app never _knowingly_ left the user at zero.

The refusal is not a trap for a Telegram-bound user: unlinking is one tap and drops them out of the floor's scope entirely. ⚠️ **It IS terminal for a LINE-only user, and that is deliberate.** The fact-check confirmed there is **no path anywhere — app, RPC or trigger — that clears `line_user_id`**; every write is NULL-only-set (`auth/line/callback/route.ts:303`, `auth/handoff/poll/route.ts:103`), and unfriending the OA happens inside LINE without telling us. So a LINE-only user's single switch is permanently on. That is not a new restriction — it is precisely the guarantee `site_issue_reported`'s lock already makes, expressed one layer down, and the switch says so rather than pretending to be operable.

⭐ **The floor has a back door that the RPC alone cannot close, and it is the whole reason U1 touches an existing function.** A user can disable LINE (legal — Telegram is still on), then **unlink Telegram**. The floor never fires, because unlinking is a different RPC, and the user lands on: LINE bound, LINE disabled, Telegram gone = **zero reachable channels, arrived at through two individually-legal steps**. `unlink_telegram` is therefore `create or replace`d to clear the caller's channel-preference rows when unlinking would leave them with no enabled bound channel. Self-healing, one statement, and it keeps "a control that removes a signal must re-home it" true across the pair.

### 2.3 A locked event does NOT bypass the channel filter

`filterMutedRecipients` lets locked events through the per-event mute (`preference-filter.ts:19`). The channel filter deliberately does **not** copy that.

The reason is §2.2's floor — but stated at the strength the floor can actually carry: a user can never _knowingly_ be switched down to zero deliverable channels, so a locked event always has a channel the app has no evidence against. Bypassing would therefore buy nothing real, while resurrecting the duplicate for exactly the event class the operator is least likely to want twice.

⚠️ **The earlier wording of this section — "a locked event always has at least one live channel" — was a guarantee the floor cannot make** (a `line_oa_friend = true` flag can be stale). Kept here as the correction, because the sentence read as settled and would have justified the wrong design.

---

## 3. Units

### U1 — schema (this PR, with the spec)

Migration `20260813075895` (live head at claim: `20260813075894`):

1. `create type public.notification_channel as enum ('line','telegram')`.
2. `public.notification_channel_preferences (user_id uuid → users on delete cascade, channel, enabled boolean not null, updated_at timestamptz default now(), primary key (user_id, channel))`, RLS on, `revoke all … from anon, authenticated` then `grant select to authenticated`, own-rows read policy.
3. `set_notification_channel_preference(p_channel, p_enabled)` — DEFINER, `search_path = public, pg_temp`, self-scoped on `auth.uid()`, upsert; raises `42501` unauthenticated and `22023` when the disable would breach the §2.2 **reachability** floor (LINE counts only when `line_oa_friend is not false`). `revoke all … from public, anon` + `grant execute … to authenticated` (the house pattern — `revoke … from public`, not anon-only).
4. `create or replace function public.unlink_telegram()` — behaviour otherwise unchanged, plus the §2.2 back-door close. Verified live before replacing: **one zero-arg overload**, plain `SECURITY DEFINER` function, body = auth guard + the two-column update + a delete of unconsumed tokens. `create or replace` is the right instrument; a second function would leave the old one reachable.

pgTAP `supabase/tests/database/390-notification-channels.sql`:

- table exists, RLS enabled, no insert/update/delete grant to `authenticated`;
- `has_function_privilege('anon', …, 'EXECUTE')` is **false** for the setter (the house form — [363](363-wp-detail-sa-nav.md) U2a's lesson: `role_routine_grants` has no PUBLIC arm and cannot fail on the real hazard);
- a bound-both user disables one channel → row stored;
- the **floor fires**: the same user disabling the second channel raises `22023`, _paired with a positive control_ — the first disable in the same transaction SUCCEEDS, so a green result cannot mean "the RPC refuses everything";
- the **reachability arm fires**: a user bound to both but carrying `line_oa_friend = false` is refused when disabling **Telegram**, while an otherwise-identical user with `line_oa_friend = true` is allowed. Two fixtures differing in exactly one column — otherwise the assert cannot distinguish the reachability floor from the boundness floor it replaced, which is the whole finding;
- `line_oa_friend is null` behaves as **reachable** (the same disable succeeds) — pinned, because "null is not a failure" is the rule most likely to be silently inverted by a later `= true` refactor;
- unlinking with the remaining channel disabled clears the preference rows.

Fixture users are seeded inside the transaction and rolled back. **No assertion touches a global count** of any app-written table.

### U2 — the drain filter and the switches (separate PR)

Not splittable from each other: the UI alone is a switch that lies (says off, still delivers — the honest-copy class), and the drain alone is a preference nobody can set.

- `src/lib/notifications/channel-preference-filter.ts` — pure: `filterChannelTargets(userIds, channel, disabledKeys)`, keyed `${userId}:${channel}` (the `mutedKey` shape).
- `drain/route.ts` — one extra batch fetch of `enabled=false` channel rows (beside the existing muted-key fetch), applied at `:515-522` before contact mapping. `recipientCount` follows automatically.
- `/settings/notifications` — a `ช่องทางการแจ้งเตือน` group above the per-event list, one switch per **bound** channel (an unbound channel has nothing to switch). A switch the floor cannot let the user turn off renders on + inoperable with a hint saying why — the shape `preferences-form.tsx:34,79,92,97` already uses for a locked entry. ⚠️ That shape is **`aria-disabled` plus the early-return handler guard**, not the HTML `disabled` attribute; mirror it as-is rather than inventing a `disabled` prop the house style does not use.
- The hint must name the real reason, not a generic one: "your only channel" and "LINE cannot reach you — you are not an OA friend" are different problems with different fixes, and the page already renders the add-friend CTA for the second.
- New labels in `src/lib/i18n/labels.ts`.

⚠️ `src/lib/notifications/**` is a **danger path** — U2 is grant-merged or operator-merged, never auto-merge.

---

## 4. Acceptance — a fill rate, and a re-read of §1.2

1. `select channel, enabled, count(*) from public.notification_channel_preferences group by 1,2` — empty means the switches were built and nobody used them; a week of zero across four dual-bound users says the page is not where they looked.
2. Duplicates stop **while LINE is healthy**. Re-run the §1.2 outbox query first, scoped to the quota roll — a quiet channel is not a fixed one, and the raw 4-day count still carries 17 pre-roll failures.
3. The four dual-bound users, by role, are the population — re-measure it at ship time rather than inheriting the table in §1.1 ([375](375-sa-home-movement-sort.md)'s rule: a number that crosses into a new document gets re-run). Re-measure `line_oa_friend` with it: the reachability floor is only as good as that distribution, and it moves at every LINE login.
4. **Nobody ends up at zero.** `select u.id from users u where <no reachable enabled channel>` must return **empty** after real use. A non-empty result means the floor has a hole, and it is the one failure of this feature that is silent from the user's side — they simply stop hearing from the app.

## 5. Out of scope

- Per-event × per-channel routing (§2).
- A quiet-hours / digest mode.
- **Teaching the DRAIN about `line_oa_friend`.** The floor consults it; `drain/route.ts:515-517` still maps `lineTargets` on `line_user_id` alone, so the 10 verified non-friends keep collecting 403s. Harmless (a 403 is one failed push, and `anySuccess` covers a user who has another channel) but wasteful, and it silently inflates the failure counters [387](387-notification-delivery-health.md) keys on. Deliberately not folded in here: it changes delivery for users who never touched a switch, which is a different unit with a different acceptance.
- Fixing what `sent` means in `notification_outbox` — [387](387-notification-delivery-health.md) §6 already owes that its own spec, and this change does not make the collapse worse.
