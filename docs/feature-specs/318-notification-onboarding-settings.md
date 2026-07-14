# Spec 318 — Notification onboarding + settings (การแจ้งเตือน)

- **Status:** design LOCKED (operator, in-chat 2026-07-14) — 4 forks decided: full scope · `bot_prompt=aggressive` · safety alerts locked-ON · org-wide fanout fix folded in.
- **Owner lane:** `318notif` (see `../LANES.md`).
- **Depends on:** ADR 0037 outbox (live), spec 277 P1a site-issue resolution precedent, spec 292 preference-storage precedents.
- **Related:** multi-project readiness audit P1 cluster E (fanout leak — resolved HERE, not in spec 311); `docs/automations.md` doctrine.

## 1. Problem

The notification pipeline (ADR 0037: `notification_outbox` → pg_cron every minute → `/api/notifications/drain` → LINE OA push via `@070vkizw`) is healthy — 1,140 sent in the last 14 days, 0 failed. But three structural gaps sit in front of it:

1. **OA friendship is invisible and unprompted.** `users.line_user_id` is minted at LINE login (27/28 users have it), but logging in does NOT make the user a friend of the OA — and only friends can receive pushes. Nothing in-app asks the user to add `@070vkizw` (the QR was sent manually to the pilot LINE group, per `go-live-checklist.md` §8); nothing detects whether they did. A push to a non-friend returns LINE 403, and the drain collapses outcomes per-row (`drain-policy.ts` — any one success marks the row `sent`), so an unreachable recipient inside a multi-recipient row leaves **no failure record at all**. Recipients with no `line_user_id` are silently dropped (`route.ts:409-416`). New self-registering technicians (specs 279/298) will never receive anything, and nobody will know.
2. **No per-user preferences.** No opt-out, no mute, no settings surface, no preference table (verified live: no `notification_preferences`-like table exists). All-or-nothing pushes → fatigue → the user's only lever is **blocking the OA**, which kills ALL notifications invisibly. `pr_progress` alone is 72% of all-time volume (919/1,270 rows) — the obvious fatigue driver.
3. **Registry gap.** `docs/automations.md` documents 2 automations (AUT-G1, AUT-SI1); the other 8 live notification event types are uncatalogued, violating the automation-documentation doctrine and blocking the future toggle hub.

## 2. Key unlock (verified against LINE docs 2026-07-14)

LINE Login has a native add-friend-at-login flow:

- Link the OA to the **Login channel** (`PRC_Ops_Login`, 2009971313) in the LINE Developers console (Basic settings → linked OA). Requires same provider — already true (both under Preston International).
- Add `bot_prompt=aggressive` to the authorize URL in `/auth/line/start` → LINE itself shows a dedicated "add friend" screen after consent, **only to users who are not already friends**.
- The callback receives `friendship_status_changed`; `GET https://api.line.me/friendship/v1/status` with the user's login access token returns `{"friendFlag": bool}`.

So friendship becomes **detectable and promptable at every login** with zero custom onboarding UI. The token endpoint already returns the access token in the existing exchange (`line-token-exchange.ts`); today only the id_token is consumed.

⚠️ **2026-06-25 incident guard:** this touches the LINE console but must NOT touch `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` in Vercel (editing those broke login org-wide once). The linked-OA step is additive console config on the existing Login channel; no env var changes anywhere in this spec.

## 3. Design

### 3.1 U1 — friendship detection (schema + auth callback) — ⚠ auth path, danger-HELD merge

- Migration (claims next free watermark per `../LANES.md` at build time — `075795`+ as of design day; 317-U2 holds `075793`, an equipment hotfix `075794`): `alter table public.users add column line_oa_friend boolean, add column line_oa_friend_checked_at timestamptz;` Nullable = never checked. No RLS change (users already read-self; writes stay service-role).
- `/auth/line/start`: append `bot_prompt=aggressive` to the authorize URL.
- `/auth/line/callback`: after token exchange, call the friendship-status API with the user access token; always refresh both columns (the `line_synced_at` precedent). **Failure-swallow** — a friendship-check error must never block login.
- **Operator one-time step (🔔):** LINE Developers console → `PRC_Ops_Login` → link OA `@070vkizw`. Exact click-path documented in the PR description at build time.
- Files: `src/app/auth/line/start/route.ts`, `src/app/auth/line/callback/route.ts`, `src/lib/auth/line-token-exchange.ts` (expose access_token), new `src/lib/auth/line-friendship.ts`.
- Guard note: `src/app/auth/**` is danger-path (widened by #463) → U1 PR is operator-merge.

### 3.2 U2 — readiness surfaces (code-only)

- `NotificationReadinessBanner` (server component): renders only when `line_oa_friend === false` (strict — `null` means "not yet checked", don't nag; the flag populates at the user's next login). Copy: เปิดรับการแจ้งเตือน + add-friend link `https://line.me/R/ti/p/@070vkizw`. Placement: `/profile` + role homes (`/sa`, `/technician`, `/dashboard`) — final placement list at plan stage.
- Non-friends keep seeing the aggressive prompt at each login until they add — that IS the onboarding funnel; banner is the in-app reinforcement.

### 3.3 U3 — preferences (schema)

- New table `notification_preferences (user_id uuid references users, event_type notification_event_type, enabled boolean not null, updated_at timestamptz not null default now(), primary key (user_id, event_type))`.
  - **Absence = ON** (opt-out model). A row records an explicit choice only.
  - RLS enabled; `grant select` to authenticated with an own-rows SELECT policy (`user_id = auth.uid()`); INSERT/UPDATE/DELETE revoked from authenticated/anon — writes RPC-only.
  - `set_notification_preference(p_event notification_event_type, p_enabled boolean)` SECURITY DEFINER, self-only upsert, `revoke ... from anon, public` (spec 284 lesson).
  - **Locked set:** `site_issue_reported` (safety/access/equipment alerts) cannot be muted — RPC raises; UI shows greyed-ON. pgTAP asserts the refusal.
- **Drain integration:** in `route.ts` enrichment, one service-role batch read of preferences for all candidate user ids, filter per event **before** the contact-mapping step (the `route.ts:409` filter point). A muted recipient is an intentional drop — logged nowhere, by design.
- **Catalog SSOT** `src/lib/notifications/notification-catalog.ts`: per event_type → Thai label, description, category, eligible-role sets (imported from `role-home.ts` SSOTs, never hardcoded), `locked` flag. Categories: งานของฉัน (`wp_decision`, `wp_reopened`) · การอนุมัติ (`wp_pending_approval`, `pr_created`) · คำขอซื้อของฉัน (`pr_decision`, `pr_progress`, `pr_cancelled`) · ระบบ (`feedback_submitted`) · เหตุร้ายแรง (`site_issue_reported`, locked). Completeness lockstep test: every `notification_event_type` enum value has a catalog entry (the file-25 enum-lockstep pattern).

### 3.4 U4 — `/settings/notifications` page (code-only)

- Entry: `การแจ้งเตือน` row in the hand-written account block on `/settings` (beside Appearance/ThemeToggle) — all roles. Label in `labels.ts`.
- Page (DetailHeader → back to `/settings`):
  1. **Readiness card** (top): LINE login ✓ (always, they're logged in) · OA friend ✓ / ✗ + เพิ่มเพื่อน button / "ยังไม่ทราบ — จะตรวจเมื่อเข้าสู่ระบบครั้งถัดไป" when null · **ส่งข้อความทดสอบ** button → server action direct `pushLineMessage` to own `line_user_id` (spec 212 sample-push precedent — bypasses the outbox, no schema).
  2. **Toggles** grouped by category, filtered to events the caller's role can actually receive (catalog `eligibleRoles`); locked rows greyed-ON with hint.
- Known guard trips (pre-empt per guard-trip map): `nav-back-affordance` STATIC_DETAIL + literal `DetailHeader` string; labels-from-SSOT assert; new `src/components/features/notifications/` folder allowlist; `settings-sections` matrix only if a config-section entry is used instead of the hand-written row.

### 3.5 U5 — fanout scoping (schema) — the folded P1 cluster E fix

Today `wp_pending_approval` + `pr_created` push to ALL PM-tier users org-wide (`route.ts:155-163`, `resolve-recipients.ts:47`) — a cross-project content leak past RLS, and noise that preferences would otherwise have to paper over.

- Fix (follows the spec 277 `site_issue_reported` resolution precedent): resolve project-scoped PMs (project lead + PM-tier `project_members` of the event's project); `project_director` + `super_admin` stay org-wide pools. Exact pool composition confirmed at plan stage against `site-issue-recipients.ts`.
- `pr_created` payload gains `project_id` → replace the capture trigger fn (**new migration, body sourced from LIVE**, per db-migration lessons). `wp_pending_approval` derives project via the WP row the drain already fetches.
- Additive-mig class → self-merge on green under the standing grant.

### 3.6 U6 — automations registry (docs-only)

- Document all 9 notification event types in `docs/automations.md` (AUT-N1…N9 shape: id · name th/en · trigger · condition · recipients · toggleable → "per-user via spec 318 preferences" · status · spec/code ref), plus the preference layer itself and the locked set. Content generated from the catalog SSOT so page and registry cannot drift.

## 4. Unit order, sizing, lanes

| Unit | Class | Merge path | Points |
|---|---|---|---|
| U1 friendship detect | mig + auth path | **HELD** (auth danger-path) 🔔 + operator console step | 3 |
| U2 readiness banner | code-only | auto-merge | 2 |
| U3 prefs schema + drain filter | mig | self-merge on green (additive grant) | 5 |
| U4 settings page | code-only | auto-merge | 5 |
| U5 fanout scoping | mig (trigger replace) | self-merge on green | 3 |
| U6 automations.md | docs-only | auto-merge | 1 |

≈19 pt. Order U1→U2→U3→U4→U5→U6, but U3/U4/U5 do not depend on U1 (readiness card degrades to "ยังไม่ทราบ" while the flag is null). Schema lane serializes U1/U3/U5 watermarks (`075795`+ as of design day — ALWAYS re-verify against LANES at each claim; 317 holds through `075794`).

## 5. Out of scope (explicit)

- In-app notification feed/center; web push / PWA notifications; Telegram self-serve linking (stays operator-set `telegram_chat_id`); quiet hours; digests/throttling (even for `pr_progress` — preferences are the v1 valve); the n8n-style operator automation hub (doctrine: documented now, built later); per-recipient delivery ledger (the per-row collapse stays — friendship detection makes it mostly moot, accepted residual); interpreting push 403 as an unfriend signal (flag refresh at next login is enough for v1).

## 6. Risks / notes

- **LINE console = auth keystone.** Linked-OA step is additive; never touch `LINE_CHANNEL_*` env (2026-06-25 outage precedent).
- Friend flag is login-fresh only — a user who unfriends mid-session keeps `true` until next login; pushes to them fail per current retry semantics. Accepted.
- `bot_prompt=aggressive` shows a full-screen prompt to non-friends on every login until they add or explicitly skip — intended nudge, revisit if operator hears complaints.
- Preferences filter at drain-time fan-out (outbox has no recipient column) — the outbox row itself is never suppressed; only delivery targets shrink.
- PDPA: `line_oa_friend` is minimal-footprint personal data on `users` (read-self only).
