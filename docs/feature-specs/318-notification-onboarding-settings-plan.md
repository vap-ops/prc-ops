# Spec 318 Implementation Plan — Notification onboarding + settings

> **For agentic workers:** REQUIRED SUB-SKILL: use the repo `ship-unit` skill for every unit (lane claim → dependency gate-check → RED first → real-flow verify → fresh-eyes review → ship-pr.sh). Steps use checkbox (`- [ ]`) syntax for tracking. Spec: `docs/feature-specs/318-notification-onboarding-settings.md` (design locked 2026-07-14).

**Goal:** every user reachable on LINE (OA-friend detected + prompted at login) and in control (per-event mute), with project-scoped PM fanout and a complete automations registry.

**Architecture:** ride the existing ADR 0037 outbox unchanged; add (a) friendship detection in the existing LINE OAuth callback, (b) a greenfield `notification_preferences` table filtered at drain fan-out, (c) a catalog SSOT that feeds the settings UI and the registry docs.

**Tech Stack:** Next.js 16 App Router (server components default), Supabase (Postgres RLS + DEFINER RPCs), pgTAP, Vitest, LINE Login v2.1 + Messaging API.

## Global Constraints

- One unit = one PR via `scripts/ship-pr.sh`; U1 is auth-path danger-HELD (operator merges); U3/U5 additive-mig self-merge on green; U2/U4/U6 code/docs auto-merge.
- Schema single-lane: watermarks below assume `075795`/`075796`/`075797` — **re-read `../LANES.md` at each claim**; renumber if another lane claimed first.
- Never touch `LINE_CHANNEL_ID`/`LINE_CHANNEL_SECRET` env (2026-06-25 outage). U1's operator step is console-only (link OA to Login channel).
- All user-facing strings in Thai via `src/lib/i18n/labels.ts`; role sets only from `src/lib/auth/role-home.ts`; money/none here.
- Migrations: additive only; trigger-fn replaces sourced FROM LIVE (`pnpm exec supabase db query --linked "select pg_get_functiondef(...)"`), never from a migration file.
- After each mig: `pnpm db:push` → `pnpm db:types` → `pnpm db:test`.
- Guard pre-empts (from guard-trip map): new `src/components/features/notifications/` folder → component-folder allowlist; new `page.tsx` → nav-back-affordance STATIC_DETAIL + literal `DetailHeader`; labels SSOT assert; enum untouched (no enum guards).

---

### Task 0: Plan + index housekeeping (this PR)

**Files:**

- Create: `docs/feature-specs/318-notification-onboarding-settings-plan.md` (this file)
- Modify: `docs/feature-specs/README.md` (append index rows for 318 + 318-plan)

- [ ] **Step 1:** Append to the spec index table: `318 — notification onboarding + settings` and `318-plan`. Commit `docs(spec): 318 implementation plan`, ship docs-only PR, auto-merge.

---

### Task 1 (U1): Friendship detection — mig + bot_prompt + callback check

**Files:**

- Create: `supabase/migrations/20260813075795_spec318u1_line_oa_friend.sql`
- Create: `src/lib/auth/line-friendship.ts`
- Modify: `src/lib/auth/line-authorize-url.ts` (add bot_prompt)
- Modify: `src/lib/auth/line-token-exchange.ts` (expose accessToken)
- Modify: `src/app/auth/line/callback/route.ts` (step 7 write)
- Test: `tests/unit/line-friendship.test.ts`, `tests/unit/line-token-exchange.test.ts` (extend), `supabase/tests/database/318-line-oa-friend.test.sql`

**Interfaces:**

- Produces: `users.line_oa_friend boolean | null`, `users.line_oa_friend_checked_at timestamptz | null` (read-self via existing RLS); `fetchLineFriendFlag(accessToken: string): Promise<boolean | null>`; `LineExchangeResult` ok-variant gains `accessToken: string | null`.
- Consumed by: U2 reader, U4 readiness card.

- [ ] **Step 1: lane claim** — branch `spec318-u1-friend-detect` off latest main in `../prc-ops-318`; annotate LANES (claims `075795`).
- [ ] **Step 2: failing tests first** ("Writing failing test first"):

```ts
// tests/unit/line-friendship.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchLineFriendFlag } from "@/lib/auth/line-friendship";

afterEach(() => vi.unstubAllGlobals());

describe("fetchLineFriendFlag", () => {
  it("returns true when LINE says friendFlag true", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ friendFlag: true }), { status: 200 })),
    );
    await expect(fetchLineFriendFlag("tok")).resolves.toBe(true);
  });
  it("returns null on non-200 (never throws into login)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })));
    await expect(fetchLineFriendFlag("tok")).resolves.toBeNull();
  });
  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(fetchLineFriendFlag("tok")).resolves.toBeNull();
  });
  it("returns null on malformed body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ friendFlag: "yes" }), { status: 200 })),
    );
    await expect(fetchLineFriendFlag("tok")).resolves.toBeNull();
  });
});
```

Extend `line-token-exchange` tests: token response `{ id_token, access_token }` → result `accessToken === "access_token value"`; response missing `access_token` → `accessToken === null` (still ok:true). Extend the authorize-url test: `bot_prompt=aggressive` present.

- [ ] **Step 3: run tests, verify FAIL** — `pnpm test tests/unit/line-friendship.test.ts` → module not found.
- [ ] **Step 4: implement**

```ts
// src/lib/auth/line-friendship.ts
// Spec 318 U1 — OA friendship probe (LINE Login "linked OA" feature).
// Called from the OAuth callback with the USER's login access token.
// null = unknown (API error / malformed) — callers must treat null as
// "don't update", never as "not friend". Never throws: a friendship
// probe must never break login.
const FRIENDSHIP_STATUS_URL = "https://api.line.me/friendship/v1/status";

export async function fetchLineFriendFlag(accessToken: string): Promise<boolean | null> {
  try {
    const response = await fetch(FRIENDSHIP_STATUS_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { friendFlag?: unknown };
    return typeof json.friendFlag === "boolean" ? json.friendFlag : null;
  } catch {
    return null;
  }
}
```

`line-authorize-url.ts` — after the `scope` param:

```ts
// Spec 318 U1 — LINE renders an add-friend screen for the linked OA
// (@070vkizw) to non-friends only; friends never see it. Requires the
// OA linked to this Login channel in the LINE console (operator step).
url.searchParams.set("bot_prompt", "aggressive");
```

`line-token-exchange.ts` — ok-variant `{ ok: true; claims: LineIdTokenClaims; accessToken: string | null }`; parse:

```ts
  const json = (await response.json()) as { id_token?: unknown; access_token?: unknown };
  ...
  const accessToken = typeof json.access_token === "string" ? json.access_token : null;
  return { ok: true, claims, accessToken };
```

`callback/route.ts` — extend the step-6 select with `line_oa_friend, line_oa_friend_checked_at`; extend the step-7 `updates` type with `line_oa_friend?: boolean; line_oa_friend_checked_at?: string;` and after the `line_synced_at` line:

```ts
// Spec 318 U1 — OA-friendship refresh-on-login (linked-OA probe). null =
// probe failed → keep the stored value (never degrade a known state).
const friendFlag = exchange.accessToken ? await fetchLineFriendFlag(exchange.accessToken) : null;
if (friendFlag !== null) {
  updates.line_oa_friend = friendFlag;
  updates.line_oa_friend_checked_at = new Date().toISOString();
}
```

Migration:

```sql
-- spec 318 U1 — OA-friendship flag, refreshed at every LINE login by the
-- OAuth callback (service-role write; users grants unchanged: read-self RLS).
alter table public.users
  add column line_oa_friend boolean,
  add column line_oa_friend_checked_at timestamptz;
comment on column public.users.line_oa_friend is
  'spec 318: friendFlag from LINE friendship/v1/status at last login; null = never probed';
```

pgTAP `318-line-oa-friend.test.sql` (plan(4)): both columns exist with correct types; `has_table_privilege('authenticated','public.users','UPDATE')` still false (posture unchanged); enum untouched.

- [ ] **Step 5:** `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (318 file green, 03/18 pins green) → `pnpm test` + `pnpm lint` + `pnpm typecheck` all green.
- [ ] **Step 6: real-flow verify** — dev-preview login roundtrip (memory `dev-preview-login` is magiclink-based and skips LINE; so: `curl -s -o /dev/null -w '%{redirect_url}' localhost:3000/auth/line/start` → assert `bot_prompt=aggressive` in the authorize redirect; friendship write path verified by unit tests + the operator's next real login — state this honestly in the PR).
- [ ] **Step 7: fresh-eyes review** (cavecrew-reviewer, full diff, model opus) → address findings.
- [ ] **Step 8: ship** — `scripts/ship-pr.sh`; PR body includes the **operator console step**: LINE Developers → provider Preston International → `PRC_Ops_Login` (2009971313) → Basic settings → "Linked OA" → select `@070vkizw`. **PR is danger-HELD (auth path) — 🔔 operator merges.** Do NOT wait for merge: continue to U3 (independent).

---

### Task 2 (U2): Readiness banner (code-only; builds after U1 mig is LIVE — needs db:types)

**Files:**

- Create: `src/lib/notifications/readiness.ts`
- Create: `src/components/features/notifications/readiness-banner.tsx`
- Modify: `src/app/profile/page.tsx`, `src/app/sa/page.tsx`, `src/app/technician/page.tsx`, `src/app/dashboard/page.tsx` (render banner near top of body)
- Modify: `src/lib/i18n/labels.ts` (banner copy)
- Modify: component-folder allowlist test (new `notifications` folder)
- Test: `tests/unit/notification-readiness-banner.test.tsx`

**Interfaces:**

- Consumes: `users.line_oa_friend` (U1).
- Produces: `loadNotificationReadiness(supabase): Promise<{ lineLinked: boolean; friendFlag: boolean | null; checkedAt: string | null }>` (own-row read, best-effort null on error); `OA_ADD_FRIEND_URL = "https://line.me/R/ti/p/@070vkizw"`; `<NotificationReadinessBanner readiness={...} />` — renders **only when `friendFlag === false`** (null = unknown → render nothing).

- [ ] **Step 1: failing component test first** — renders CTA link href `OA_ADD_FRIEND_URL` when friendFlag false; renders nothing when true; renders nothing when null.
- [ ] **Step 2:** implement reader + banner (amber notice card, app tokens, `data-testid="notif-readiness-banner"`), wire into the 4 pages (server components — fetch readiness in-page via existing supabase server client; render banner above the first content section).
- [ ] **Step 3:** labels: `NOTIF_READINESS_TITLE = "เปิดรับการแจ้งเตือน"`, `NOTIF_READINESS_BODY = "เพิ่มเพื่อน LINE @070vkizw เพื่อรับแจ้งเตือนงานของคุณ"`, `NOTIF_ADD_FRIEND_LABEL = "เพิ่มเพื่อน"`.
- [ ] **Step 4:** suites + guards green; browser-verify as super_admin (flag null → no banner) + flip own row's flag false via db query → banner shows → revert row.
- [ ] **Step 5:** fresh-eyes → ship (code-only auto-merge).

---

### Task 3 (U3): Preferences — table + RPC + catalog SSOT + drain filter

**Files:**

- Create: `supabase/migrations/20260813075796_spec318u3_notification_preferences.sql`
- Create: `src/lib/notifications/notification-catalog.ts`
- Create: `src/lib/notifications/preference-filter.ts`
- Modify: `src/app/api/notifications/drain/route.ts` (muted-keys fetch + per-row filter)
- Test: `tests/unit/notification-catalog.test.ts`, `tests/unit/preference-filter.test.ts`, `supabase/tests/database/318-notification-preferences.test.sql`

**Interfaces:**

- Produces: table `notification_preferences(user_id, event_type, enabled, updated_at, pk(user_id,event_type))`; RPC `set_notification_preference(p_event notification_event_type, p_enabled boolean)`; `NOTIFICATION_CATALOG: readonly NotificationCatalogEntry[]` where `NotificationCatalogEntry = { event; label; description; category; audience(role): boolean; locked }`; `LOCKED_NOTIFICATION_EVENTS`; `filterMutedRecipients(recipients: string[], eventType: NotificationEventType, mutedKeys: ReadonlySet<string>): string[]` (locked events bypass the filter); muted key format `` `${userId}:${eventType}` ``.
- Consumed by: U4 page.

- [ ] **Step 1: failing tests first.** Catalog: every `notification_event_type` enum value (from `database.types.ts` Enums) has exactly one entry (lockstep); `site_issue_reported` is the only locked entry. Filter: mutes matching key; ignores non-matching; locked event returns recipients untouched even when key present.
- [ ] **Step 2: migration** (claims `075796`):

```sql
-- spec 318 U3 — per-user notification mute. Absence of a row = ON.
create table public.notification_preferences (
  user_id uuid not null references public.users (id) on delete cascade,
  event_type public.notification_event_type not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_type)
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select on public.notification_preferences to authenticated;
create policy notification_preferences_read_own on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.set_notification_preference(
  p_event public.notification_event_type,
  p_enabled boolean
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- spec 318 locked set: safety alerts cannot be muted.
  if p_event = 'site_issue_reported' then
    raise exception 'event is locked' using errcode = '22023';
  end if;
  insert into public.notification_preferences (user_id, event_type, enabled)
  values ((select auth.uid()), p_event, p_enabled)
  on conflict (user_id, event_type)
  do update set enabled = excluded.enabled, updated_at = now();
end $$;
revoke all on function public.set_notification_preference(public.notification_event_type, boolean) from public, anon;
grant execute on function public.set_notification_preference(public.notification_event_type, boolean) to authenticated;
```

pgTAP `318-notification-preferences.test.sql` (fixture-scoped, ~14 asserts): table + pk + RLS enabled; authenticated has SELECT but NOT insert/update/delete; anon has nothing; RPC as fixture user upserts (insert then flip); `site_issue_reported` raises 22023; anon execute revoked; own-rows policy blocks reading another fixture user's row.

- [ ] **Step 3:** `db:push` → `db:types` → `db:test`.
- [ ] **Step 4: catalog + filter implementation.** Category labels + order in labels.ts (`NOTIF_CATEGORY_*`). Audience mapping (role sets from role-home, never literals): `wp_pending_approval`/`pr_created` → PM_ROLES; `wp_decision`/`wp_reopened` → photo-uploader roles (site_admin + PM_ROLES); `pr_decision`/`pr_progress`/`pr_cancelled` → PR-raising roles (site_admin + procurement roles + PM_ROLES); `feedback_submitted` → super_admin only; `site_issue_reported` → PM_ROLES + procurement_manager (locked). Confirm each set at build against the actual gate used by the originating surface (dependency gate-check).
- [ ] **Step 5: drain wiring.** In enrichment (once per batch):

```ts
// Spec 318 U3 — per-user mutes. Only deviations are stored (enabled=false
// rows); absence = ON, so one small unconditional read covers the batch.
const { data: mutedRows, error: mutedError } = await admin
  .from("notification_preferences")
  .select("user_id, event_type")
  .eq("enabled", false);
if (mutedError) {
  console.error("[notifications/drain] preference fetch failed", mutedError.message);
  return NextResponse.json({ error: "enrichment_failed" }, { status: 500 });
}
const mutedKeys = new Set((mutedRows ?? []).map((r) => `${r.user_id}:${r.event_type}`));
```

In the deliver loop, immediately after `resolveRecipients(...)`:

```ts
const deliverable = filterMutedRecipients(recipients, row.event_type, mutedKeys);
```

…and `lineTargets`/`telegramTargets` map over `deliverable` instead of `recipients`.

- [ ] **Step 6:** suites green; real-flow verify = insert own mute row via RPC (db query as fixture impractical → use dev server action later in U4; here: service-role seed row + run drain against a synthetic pending row targeted at self, assert no push + row sent; delete seed).
- [ ] **Step 7:** fresh-eyes → ship (additive mig, self-merge on green).

---

### Task 4 (U4): `/settings/notifications` page

**Files:**

- Create: `src/app/settings/notifications/page.tsx`, `src/app/settings/notifications/actions.ts`, `src/components/features/notifications/preferences-form.tsx` (client island — toggle interactivity)
- Modify: `src/app/settings/page.tsx` (การแจ้งเตือน row in the account block, after the /profile Link)
- Modify: `src/lib/i18n/labels.ts` (page labels)
- Modify: `tests/unit/nav-back-affordance.test.ts` (STATIC_DETAIL + `settings/notifications`)
- Test: `tests/unit/notification-preferences-form.test.tsx`, `tests/unit/settings-notifications-actions.test.ts`

**Interfaces:**

- Consumes: U2 `loadNotificationReadiness` + banner pieces; U3 catalog + RPC + prefs select.
- Produces: server actions `saveNotificationPreference(event, enabled)` (calls RPC, revalidates `/settings/notifications`) and `sendTestNotification()` (reads own `line_user_id`; `pushLineMessage` direct — spec-212 sample-push precedent; Thai error strings when token unset / no line_user_id / push fails).

- [ ] **Step 1: failing tests first** — form renders one toggle per catalog entry passed; locked entry renders disabled+on with hint; toggle calls action with `(event, enabled)`. Actions: locked event → error return (no RPC call); test push without line_user_id → Thai error.
- [ ] **Step 2: page.** Gate = any authed user (getClaims pattern; visitor included — they can receive nothing today but the readiness card still applies). Compose: `DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า"` → readiness card (reuse U2 reader; show LINE ✓ row, OA-friend row with เพิ่มเพื่อน link when false / "จะตรวจสอบเมื่อเข้าสู่ระบบครั้งถัดไป" when null, ส่งข้อความทดสอบ button) → grouped toggles: catalog entries where `audience(role)`, grouped by category order, current values from own-rows select (absent = on).
- [ ] **Step 3:** guards: nav-back STATIC_DETAIL entry; settings hub row (Bell icon); labels.
- [ ] **Step 4:** suites green; **browser real-flow**: dev-preview super_admin → /settings → การแจ้งเตือน → flip `pr_progress` off → row appears in DB (`enabled=false`) → flip on → row `enabled=true`; locked row unclickable; ส่งข้อความทดสอบ → expect Thai error for dev-preview (no line_user_id) — correct behavior; zero console errors.
- [ ] **Step 5:** fresh-eyes → ship (code-only auto-merge).

---

### Task 5 (U5): Fanout scoping — project-scoped PM resolution

**Files:**

- Create: `supabase/migrations/20260813075797_spec318u5_pr_created_project_payload.sql` (replace `purchase_requests_notify_created` fn FROM LIVE, payload + `'project_id', new.project_id`)
- Modify: `src/lib/notifications/resolve-recipients.ts` (context: `pmIds` → `orgWidePmIds` (PD + super only) + new `eventProjectPmIds`; wp_pending_approval/pr_created union them; empty project-PM list falls back to the FULL legacy pool via new context field `legacyPmPoolIds` — see transition note)
- Modify: `src/app/api/notifications/drain/route.ts` (WP select adds `project_id`; generalize the project-PM resolution beyond site-issue rows: union of site-issue payload projectIds + wp_pending_approval WP projects + pr_created payload projectIds; org-wide pool query = PD + super roles)
- Test: `tests/unit/resolve-recipients.test.ts` (extend), `supabase/tests/database/318-pr-created-payload.test.sql`

**Interfaces:**

- Consumes: existing `projectPmRecipients` machinery (spec 277, `site-issue-recipients.ts`).
- Produces: `RecipientContext` = `{ orgWidePmIds; eventProjectPmIds; legacyPmPoolIds; wpUploaderIds; superIds; siteIssueProjectPmIds; siteIssueRolePoolIds }`.

**Transition rule (must hold):** a row whose project cannot be resolved (pre-deploy queue rows without payload project_id, or a WP-less PR) resolves to the LEGACY full PM pool — never drop deliveries mid-transition. Test this case explicitly.

- [ ] **Step 1: failing tests first** — wp_pending_approval with eventProjectPmIds=[a] orgWidePmIds=[d,s] → [a,d,s]; pr_created same minus requester; unresolvable project (eventProjectPmIds=[] AND no projectId) → legacyPmPoolIds; scoped PM of another project NOT included.
- [ ] **Step 2:** migration: fetch live fn body (`select pg_get_functiondef('public.purchase_requests_notify_created'::regproc)`), re-create verbatim + `'project_id', new.project_id` in the jsonb payload. pgTAP: insert fixture PR → outbox row payload has project_id (fixture-scoped, cleanup by rollback).
- [ ] **Step 3:** drain rewiring + resolve-recipients rewrite; all existing resolve tests updated to the new context shape.
- [ ] **Step 4:** `db:push`/`db:types`/`db:test`; suites green; real-flow: synthetic wp_pending_approval outbox row for a project whose only PM-tier member is dev-preview → drain → assert delivered set (log) excludes an unrelated scoped PM (verify via drain response counts + outbox row sent), clean up rows.
- [ ] **Step 5:** fresh-eyes → ship (additive mig, self-merge on green). Update multi-project audit memory: cluster E CLOSED.

---

### Task 6 (U6): automations.md registry fill

**Files:**

- Modify: `docs/automations.md` — add **AUT-N1…AUT-N8** (wp_pending_approval, wp_decision, wp_reopened, pr_created, pr_decision, pr_progress, pr_cancelled, feedback_submitted) in the AUT-SI1 shape; content from the catalog SSOT; each entry's **toggleable** = "per-user mute via /settings/notifications (spec 318 U3/U4); site-wide pause = drainer env vars"; AUT-SI1 gains a note: locked against per-user mute.

- [ ] **Step 1:** write entries (trigger = the exact DB trigger + migration ref from spec §investigation; recipients = post-U5 scoped rules). Docs-only PR, auto-merge. Update progress-tracker; archive lane when all units merged.

## Self-review (done at write time)

- Spec coverage: §3.1→Task 1 · §3.2→Task 2 · §3.3→Task 3 · §3.4→Task 4 · §3.5→Task 5 · §3.6→Task 6. Readiness-card Telegram row (operator Q) folded into Task 4 Step 2 via readiness reader (add `telegramLinked` boolean — one extra own-row col select). ✔
- Placeholders: none; audience sets marked "confirm at build" are dependency-gate checks, not TBDs. ✔
- Type consistency: `fetchLineFriendFlag`/`accessToken`/`filterMutedRecipients`/`RecipientContext` names consistent across tasks. ✔
