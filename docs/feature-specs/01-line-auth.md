# Feature Spec 01: LINE Login Authentication

## Status

Draft — 2026-05-20
Revised 2026-05-23: PR 1 schema work merged. Decision #4 (integration mechanism) superseded by [ADR 0012](../decisions/0012-custom-flow-line-auth.md) — see custom-flow implementation in PR 2 below. Decision #14 reversed by the same ADR. RLS recursion blocker fixed by [ADR 0011](../decisions/0011-rls-role-helper.md).

## Goal

Wire LINE Login as the sole authentication method for PRC Ops. After signing in, users land at a role-appropriate destination (SA home, PM home, or `/coming-soon` for everyone else). New users default to a `visitor` role and require manual promotion by a `super_admin`.

This spec covers the full end-to-end auth surface: manual prerequisites (LINE Developers console + Supabase Custom Provider configuration), the schema change introducing the `visitor` role, the auth implementation (middleware, callback, login, logout), role gating, and Playwright E2E coverage.

LIFF (LINE Front-end Framework, for technicians inside the LINE app) is deferred to v2 per locked v1 scope.

## Locked design decisions

These were settled in conversation before drafting. They are not open for re-litigation during implementation. If implementation pressure suggests changing any of these, STOP and surface it — do not improvise.

1. **LINE Login is the sole auth method.** No email/password fallback. No Google, Apple, or GitHub. Both site admins (PWA) and project managers (web) authenticate the same way.
2. **Signup is open.** Anyone with a LINE account can complete the OAuth flow and end up with a row in `public.users`.
3. **New users default to `visitor`.** A `visitor` is an authenticated LINE user awaiting role assignment. Their only permitted destination is `/coming-soon`. Promotion to a real role is manual (a `super_admin` updates `users.role` via SQL or, eventually, an admin UI).
4. ~~**Integration mechanism: Supabase Custom OIDC Provider.**~~ **Superseded by [ADR 0012](../decisions/0012-custom-flow-line-auth.md) — custom flow (app-handled LINE OAuth + admin session minting).** Supabase's Custom OIDC Provider rejects LINE's `id_token` because LINE signs with HS256 and Supabase's OIDC verifier requires ES256/RS256. `signInWithIdToken` is also unusable for the same reason. Adopted mechanism: the app runs LINE's OAuth handshake itself, verifies the HS256 `id_token` server-side, provisions/locates an `auth.users` row via the admin client, and mints a Supabase session via `admin.generateLink({ type: 'magiclink' })` + `verifyOtp`. See ADR 0012 for the full mechanism and [`./01-line-auth-FINDINGS.md`](./01-line-auth-FINDINGS.md) for the live evidence.
5. **Login UX:**
   - One shared `/login` route for all roles.
   - "Log in with LINE" button is reachable from `/login` and from the homepage `/`.
   - Already-authenticated users who visit `/login` are redirected to their role's home (`/sa`, `/pm`, or `/coming-soon`).
6. **Callback sequence:** LINE redirects to `/auth/callback`. Handler exchanges the code for a Supabase session, sets the cookie, looks up `users.role`, redirects by role.
7. **Role-based redirects after login:**
   - `site_admin` → `/sa`
   - `project_manager` → `/pm`
   - All other roles (including `visitor`, `super_admin`, `project_coordinator`, `procurement`, `technician`, `hr`, `subcon_manager`, `accounting`) → `/coming-soon`
8. **Logout:** Button in app shell. Clears Supabase session, redirects to `/`. Does NOT log out from LINE globally (that would be hostile UX).
9. **Session lifetime:** Supabase defaults — 1-hour access token, 30-day refresh token. No remember-me checkbox; behavior is always "remember."
10. **Profile data stored from LINE:**
    - `line_user_id` (= LINE's `sub` claim) — required, used as identity anchor
    - `full_name` (= LINE's `name` claim) — stored as-is
    - `email` if present — LINE may or may not return it; tolerate missing
    - Do NOT store profile picture URL (LINE rotates these; they break)
11. **Error handling:** If the LINE callback fails (user denies permission, token exchange fails, network drops), redirect back to `/login` with an error banner. No dedicated `/auth/error` page.
12. **Route protection — two layers:**
    - **Middleware (proxy.ts at project root, Next.js 16 convention):** refreshes session, redirects unauthenticated users away from protected routes. Does NOT check role. Public routes: `/`, `/login`, `/auth/callback`. Everything else requires authentication.
    - **Role gating (in each route's server component):** `/sa/*` requires `site_admin`, `/pm/*` requires `project_manager`, `/coming-soon` redirects SA/PM to their proper home if they land there by accident.
13. **Schema changes required before any auth code:**
    - Add `'visitor'` to the `user_role` enum (10th value)
    - Update the `on_auth_user_created` trigger to default new `public.users` rows to `'visitor'` instead of `'site_admin'`
    - Both changes ship in one PR
    - Requires ADR 0010 (amends ADR 0007 — same pattern as ADR 0009 amending 0004)
14. ~~**`src/lib/env.ts` cleanup:** Remove `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` optional fields.~~ **Reversed by [ADR 0012](../decisions/0012-custom-flow-line-auth.md).** PR 1 did remove these from `env.ts` as originally specified. The custom flow runs LINE OAuth and HS256 verification **in the app**, so both vars are required server-side again. PR 2 re-introduces them into `src/lib/env.server.ts` (zod-required, server-only; the env-split fix from PR #16 keeps them out of the client bundle).

## Implementation plan: 4 PRs

This unit splits into 4 PRs to keep each one reviewable in under 20 minutes and to keep merge risk low. The split is deliberate — combining any two of these creates a review surface too large for a non-developer operator working solo.

PRs ship strictly in this order. Each PR's prerequisites are the previous PRs.

---

### Phase 0: Manual prerequisites (no code; you do this in browser dashboards)

**Revised 2026-05-23 per [ADR 0012](../decisions/0012-custom-flow-line-auth.md).** The original Phase 0 also walked the operator through configuring a Supabase Custom OIDC Provider for LINE. That provider is now **unused** — the app runs LINE OAuth itself. The Phase 0 steps below are kept for history but annotated where they no longer apply. The only currently-load-bearing step is **Step 0.1** (creating the LINE channel and noting its credentials) plus the **revised Step 0.3** (which now points the LINE callback URL at the app, not at Supabase).

These must be complete before PR 1 is even started. Claude Code cannot do these — they involve clicking around in LINE Developers and Supabase consoles.

**Step 0.1 — Create LINE Login channel:**

1. Open https://developers.line.biz/console/ and sign in (use a LINE account that will be the project's owner — probably yours).
2. Create a new provider if needed (e.g., "VAP Solutions"). Then create a new channel of type **LINE Login**.
3. Fill in channel name (e.g., "PRC Ops"), description, app type (Web app), and required fields.
4. Once created, note these values from the channel's Basic Settings tab — you'll paste them into Supabase later:
   - **Channel ID** (a numeric string)
   - **Channel secret** (a long alphanumeric string)
5. In the channel's "OpenID Connect" tab, ensure OIDC is enabled.
6. Note the LINE OIDC endpoint URLs (these are fixed and the same for every LINE Login channel):
   - Authorization endpoint: `https://access.line.me/oauth2/v2.1/authorize`
   - Token endpoint: `https://api.line.me/oauth2/v2.1/token`
   - JWKS endpoint: `https://api.line.me/oauth2/v2.1/certs`
   - Issuer: `https://access.line.me`
   - Userinfo endpoint: `https://api.line.me/v2/profile`
7. Do NOT set the callback URL in LINE yet — you'll do that in Step 0.3 after Supabase generates it.

**Step 0.2 — ~~Add Custom OIDC Provider in Supabase~~ (UNUSED per ADR 0012; skip for new setups):**

The originally-specified Supabase Custom OIDC Provider configuration is unused under the custom-flow auth adopted in ADR 0012. If you already created the provider during the OIDC attempt, leave it in place (harmless; the app never calls into it) — **do not delete it**, since dashboard state changes are out of any PR's scope. For new setups, skip this step entirely; the LINE credentials live in `src/lib/env.server.ts` instead, populated by Vercel + `.env.local` as `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET`.

**Step 0.3 — Configure callback URL in LINE (REVISED per ADR 0012):**

1. In the LINE Developers console, open the channel's LINE Login Settings tab.
2. Add the **app's** callback URL to the "Callback URL" field — the path is `/auth/line/callback` and the origin is whichever environment you want LINE login to work on:
   - Production: `https://<your-app-host>/auth/line/callback`
   - Every long-lived Vercel preview you want to test from: `https://<that-preview-host>/auth/line/callback`
   - Local dev (if used): `http://localhost:3000/auth/line/callback`
3. LINE accepts multiple callback URLs per channel; add each as a separate entry. **LINE does not support wildcards** — ephemeral per-PR preview URLs cannot all be allowlisted; pick one stable preview URL for testing.
4. (Legacy, only if Step 0.2 was completed during the OIDC attempt) The Supabase-side callback `https://<project-ref>.supabase.co/auth/v1/callback` can stay in the LINE allowlist — it does nothing now, but removing it is operator's choice.
5. Save.

**Step 0.4 — Verify (REVISED per ADR 0012):**

Verification is now folded into PR 2's manual smoke test on the live deploy. There is no useful pre-PR-2 verification of LINE auth — the app code that actually exercises the channel doesn't exist until PR 2 ships. The original `<project-ref>.supabase.co/auth/v1/authorize?provider=line` check verified the dead OIDC path and no longer applies.

The only Phase 0 invariant that must hold before PR 2 starts: **`LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` are set correctly in `.env.local` (for local dev) and in the Vercel environment (server-only — do not check the `NEXT_PUBLIC_` box)**.

**Phase 0 deliverable:** confirm to the operator when Phase 0 is complete. Do not start PR 1 until Phase 0 is verified.

---

### PR 1 of 4: Schema — visitor enum + trigger update + ADR 0010 — **COMPLETE**

**Status:** ✅ Merged 2026-05-22 (PR #14, commit `86ea03d`). ADR 0010 written; visitor role added as the 10th enum value; column default on `public.users.role` changed from `'site_admin'` to `'visitor'`; `LINE_CHANNEL_*` removed from `env.ts` (later reversed in PR 2 per [ADR 0012](../decisions/0012-custom-flow-line-auth.md)).

**Branch:** `feat/auth-schema-prep`

**Scope (in):**

1. **ADR 0010** at `docs/decisions/0010-visitor-default-role.md`:
   - Status: Accepted, amending ADR 0007
   - Context: Open signup model introduces "authenticated but unassigned" state
   - Decision: Add `visitor` to enum; change trigger default
   - Consequences positive/negative/neutral

2. **Annotate ADR 0007's Status section** with one new line:

```
   Amended by ADR 0010 (visitor default role, 2026-05-21).
```

3. **Migration 1** at `supabase/migrations/<timestamp>_add_visitor_role.sql`:

```sql
   ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'visitor';
```

4. **Migration 2** at `supabase/migrations/<timestamp+1>_change_user_default_role.sql`:
   Update the `on_auth_user_created` trigger so the inserted `public.users` row defaults `role` to `'visitor'` instead of `'site_admin'`. Implementation depends on current trigger SQL — locate it via `git grep on_auth_user_created` and modify in place via DROP TRIGGER + CREATE OR REPLACE FUNCTION + CREATE TRIGGER. Migrations are split because `ALTER TYPE ADD VALUE` cannot run in the same transaction as code that uses the new value.

5. **Apply migrations:** `pnpm db:push`

6. **Regenerate types:** `pnpm db:types` — `database.types.ts` should now show 10 enum values.

7. **Update pgTAP test** at `supabase/tests/database/01-users.test.sql`:
   - Update `enum_has_labels` array from 9 → 10 values (in enum order)
   - Update description from "nine expected values" → "ten expected values"
   - Update the `col_default_is` assertion: default is now `'visitor'`, not `'site_admin'`
   - Update any other assertion affected by the default change

8. **Remove `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` from `src/lib/env.ts`:** delete those two optional fields from `serverSchema`. They were placeholders; Supabase handles LINE credentials now.

9. **Update CLAUDE.md role list:** add `visitor` to the role enum table, with phase "v1 (default for new signups; awaits manual promotion)".

10. **Update progress tracker:** mark PR 1 as in progress at start, complete at end. Note ADR 0010 as a new completed unit.

**Scope (out):**

- No auth code (no middleware, no callback, no login page)
- No `/coming-soon` page
- No application code changes besides env.ts and CLAUDE.md
- No RLS policy changes (no policies use `visitor` yet)
- Do NOT push or PR — operator handles those manually

**Verification checklist:**

- [ ] Branch `feat/auth-schema-prep` created from up-to-date main
- [ ] ADR 0010 created with proper structure
- [ ] ADR 0007 Status annotated (one line added; rest of 0007 unchanged)
- [ ] Both migrations created with correct timestamp prefixes
- [ ] `pnpm db:push` succeeds (both migrations apply cleanly)
- [ ] `pnpm db:types` regenerates with 10 enum values
- [ ] pgTAP test updated; `pnpm db:test` passes (no parser-bug noise, all assertions green)
- [ ] env.ts no longer references LINE*CHANNEL*\*
- [ ] CLAUDE.md role list shows 10 values
- [ ] `pnpm lint && pnpm typecheck && pnpm test` all pass
- [ ] Progress tracker updated
- [ ] All changes staged and committed with message: `feat: add visitor role and change default (ADR 0010 amends ADR 0007)`
- [ ] No push, no PR

**If blocked:** report and stop. Common blockers: migration fails on remote DB; trigger SQL is in an unexpected format; existing users in the DB would be affected (they shouldn't be — the default only applies to new inserts).

---

### PR 2 of 4: Custom-flow auth core — `/auth/line/start`, `/auth/line/callback`, logout, login UI

**Rewritten 2026-05-23 per [ADR 0012](../decisions/0012-custom-flow-line-auth.md).** The original PR 2 (Supabase OIDC + client-side `signInWithOAuth({ provider: 'custom:line' })` + `/auth/callback` `exchangeCodeForSession`) shipped to main as the initial implementation. It is dead code under the OIDC dead-end; this PR replaces it with the custom-flow implementation proven in the line-auth spike. Read [`./01-line-auth-FINDINGS.md`](./01-line-auth-FINDINGS.md) for the spike's exact mechanism and live test result.

**Branch:** `feat/auth-core-custom-flow`

**Prerequisites:**

- PR 1 (schema, ADR 0010) **merged** — already done.
- [ADR 0011](../decisions/0011-rls-role-helper.md) (RLS role helper) **merged** — already done. Without it the role read after session mint raises `infinite recursion detected in policy for relation users`.
- Phase 0 revised — the LINE channel's "Callback URL" allowlist must contain the app's `/auth/line/callback` URL for every origin you want to test (see revised Step 0.3 above).

**Scope (in):**

1. **Env config.** Add `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` to `src/lib/env.server.ts`'s zod schema as required strings (`z.string().min(1)`). Both server-only (the env-split work from PR #16 keeps them out of the client bundle). Boot fails if either is missing.

2. **proxy.ts.** Update `PUBLIC_PATHS` to `["/", "/login", "/auth/line/start", "/auth/line/callback"]`. Remove the now-obsolete `/auth/callback` entry. No structural change to the proxy itself — same `getAll`/`setAll` cookie pattern, same matcher.

3. **`/auth/line/start` route handler** at `src/app/auth/line/start/route.ts` (`GET`):
   - Reads `LINE_CHANNEL_ID` from `serverEnv` (env.server.ts).
   - Derives `redirect_uri` from `request.nextUrl.origin` — never from `NEXT_PUBLIC_APP_URL`. Multi-env safe per ADR 0012; same as the spike.
   - Generates 16-byte hex `state` via `crypto.randomBytes(16).toString('hex')`. Stores in an httpOnly, secure, `sameSite=lax` cookie scoped to `path: "/auth/line"`, `max-age: 600`.
   - Builds the LINE authorize URL: `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=<channelId>&redirect_uri=<origin>/auth/line/callback&state=<random>&scope=openid%20profile`.
   - 302 redirect to that URL.

4. **`/auth/line/callback` route handler** at `src/app/auth/line/callback/route.ts` (`GET`):
   - Reads `?code`, `?state`, `?error` from `request.nextUrl.searchParams`.
   - Verifies the `state` cookie matches `?state`. Deletes the cookie on success or mismatch (single-use). Mismatch → 400 with a generic message; do **not** proceed to token exchange.
   - If LINE returned `?error` or `?code` is missing → redirect to `/login?error=oauth_failed`.
   - POSTs to LINE's token endpoint `https://api.line.me/oauth2/v2.1/token` with `application/x-www-form-urlencoded` body: `grant_type=authorization_code`, `code`, `redirect_uri` (derived the same way as `/start` — must match exactly), `client_id`, `client_secret`. On non-2xx → `/login?error=oauth_failed`, log the response body server-side.
   - Verifies the returned `id_token`. HS256 with `LINE_CHANNEL_SECRET` as the HMAC key; comparison via `crypto.timingSafeEqual` (constant-time); `iss === 'https://access.line.me'`; `aud === LINE_CHANNEL_ID`; `exp > now`; `iat <= now + 60s`; `sub` is a non-empty string. Use **`jose`** (preferred) or inline `node:crypto` (the spike's approach). On verification failure → `/login?error=oauth_failed`.
   - Provisions or locates the auth user via the admin (service-role) client: `admin.auth.admin.createUser({ email: 'line_<sub>@line.local', email_confirm: true, user_metadata: { provider: 'line', line_sub, name } })`. `email_exists` and `user_already_exists` are treated as "already provisioned, continue"; any other error → `/login?error=unknown`, log server-side. The ADR 0007 trigger creates the matching `public.users` row automatically with role `visitor` (ADR 0010 default).
   - Mints the Supabase session: `admin.auth.admin.generateLink({ type: 'magiclink', email })` → `properties.hashed_token`, then `supabase.auth.verifyOtp({ type: 'magiclink', token_hash })` on the SSR server client. The SSR client's `setAll` callback writes `sb-*` cookies onto the response via `cookies()` from `next/headers`. On either-call failure → `/login?error=session_failed`.
   - Reads `public.users.role` (and `line_user_id`, `full_name` for the NULL-only profile write) via the SSR client. If the row is missing — race with the `on_auth_user_created` trigger — retry 3× with 50ms backoff. Still missing → `/login?error=unknown`, log server-side. (Post-ADR-0011 the read no longer recurses; this retry is purely for the trigger-race window.)
   - **Profile write (admin client, NULL-only):** for each of `line_user_id` (← verified JWT `sub`) and `full_name` (← verified JWT `name`) that's currently NULL, UPDATE via the admin client. Never overwrite non-NULL. Same pattern as PR #15's previous callback.
   - Redirects by role: `site_admin` → `/sa`, `project_manager` → `/pm`, every other role (including `visitor`, `super_admin`, etc.) → `/coming-soon`.

5. **`/auth/logout` route handler** at `src/app/auth/logout/route.ts`. **Unchanged from the existing implementation on main** (works regardless of how the session was minted): POST calls `supabase.auth.signOut()`, 303-redirects to `/`. GET returns 405 with `Allow: POST`.

6. **`LogoutButton`** at `src/components/auth/logout-button.tsx`. **Unchanged.** Plain server-rendered POST form, no `"use client"`. Re-used by PR 3's landings.

7. **Login button (replaces dead client-side `signInWithOAuth`).** Delete or rewrite `src/app/login/login-button.tsx`. The replacement is a **plain server-rendered** anchor or form pointing at `/auth/line/start`. **No `"use client"`. No `signInWithOAuth`. No `'custom:line'` reference.** Either:
   - Anchor: `<a href="/auth/line/start" className="…">Log in with LINE</a>` directly in the `/login` Server Component, or
   - Form: `<form action="/auth/line/start" method="get"><button type="submit">Log in with LINE</button></form>` if a button-shaped element is preferred for styling consistency.

8. **`/login` page** at `src/app/login/page.tsx` — minor revision. Server Component reads the session via `src/lib/db/server.ts`; if authenticated, reads `users.role` (now works under ADR 0011's helper) and redirects to `/sa`, `/pm`, or `/coming-soon`. Otherwise renders the page with the new server-rendered LINE button. Optional `?error=<code>` banner with generic copy (`oauth_failed`, `session_failed`, `unknown`). Dark theme (zinc-950 / zinc-100, plain Tailwind, no shadcn).

9. **Remove dead OIDC code.**
   - Delete `src/app/auth/callback/route.ts` (the old `exchangeCodeForSession` handler — points at the dead OIDC provider).
   - Confirm `src/app/login/login-button.tsx` no longer contains `signInWithOAuth` or the `'custom:line'` string.
   - `proxy.ts` `PUBLIC_PATHS` no longer references `/auth/callback`.

10. **Error handling philosophy** (unchanged): user-visible error banners on `/login` carry generic strings only. Detailed diagnostics go to `console.error` server-side and only there. Token bodies, JWT payloads, and the `hashed_token` from `generateLink` are never logged.

**Scope (out):**

- `/sa`, `/pm`, `/coming-soon` pages and the `requireRole` helper — PR 3.
- Homepage login button — PR 3.
- Tests — PR 4.
- Profile picture handling — not in v1.
- LINE-wide logout (we only clear the Supabase session) — never; hostile UX.
- Custom JWT claims via Supabase Auth Hooks — not needed; role is read from `public.users`, not from the access token.
- Any RLS policy change — none required; ADR 0011's helper is already in place.

**Verification checklist:**

- [ ] Branch from up-to-date main
- [ ] `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` in `src/lib/env.server.ts` (zod-required; boot fails on missing)
- [ ] `proxy.ts` `PUBLIC_PATHS` is `["/", "/login", "/auth/line/start", "/auth/line/callback"]`; old `/auth/callback` removed
- [ ] `/auth/line/start` builds the LINE authorize URL with a `state` cookie, derives `redirect_uri` from `request.nextUrl.origin`, 302s to LINE
- [ ] `/auth/line/callback` validates state, exchanges code at LINE, verifies HS256 `id_token` (alg + signature via `timingSafeEqual` + iss + aud + exp + iat + sub), provisions/locates via admin client, mints session via `generateLink` + `verifyOtp`, reads role, NULL-only profile-write via admin, redirects by role
- [ ] `src/app/auth/callback/route.ts` deleted (dead OIDC handler)
- [ ] `src/app/login/login-button.tsx` replaced with a plain server-rendered link/form (no `"use client"`, no `signInWithOAuth`, no `'custom:line'`)
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Manual end-to-end test on a Vercel preview: load `/login` → click LINE button → complete LINE consent → land on `/sa` / `/pm` / `/coming-soon` per role → POST `/auth/logout` → land on `/`. No errors in the Vercel function logs. (PR 3 destinations will 404 until that PR ships — that's expected.)
- [ ] Progress tracker updated
- [ ] Commit message: `feat: wire LINE auth via custom flow (ADR 0012)`

**If blocked:** common blockers —

- LINE callback URL not allowlisted for the test environment's origin (LINE Developers console → channel → LINE Login Settings → Callback URL).
- HS256 signature mismatch — usually the channel secret in env doesn't match the LINE channel (e.g., quoted/escaped, or pasted with whitespace).
- `verifyOtp` fails despite a valid `hashed_token` — verify the SSR client is the one with `cookies()` from `next/headers` (not the admin client; the admin client doesn't manage user sessions).
- Role read returns the "infinite recursion" error — ADR 0011 hasn't merged into the environment you're testing against; re-pull and apply the migration.

---

### PR 3 of 4: Role gating + landings + homepage login

**Branch:** `feat/auth-role-gating` (from main, after PR 2 merges)

**Prerequisites:** PR 2 (custom-flow auth core, [ADR 0012](../decisions/0012-custom-flow-line-auth.md)) merged. ADR 0011 (RLS role helper) merged. You can log in and out via `/auth/line/start` → LINE → `/auth/line/callback` → role redirect; the role redirect currently lands at 404s (`/sa`, `/pm`, `/coming-soon` don't exist) — this PR fills those in.

**Note for the homepage update + `requireRole` helper:** both read `public.users.role` via the SSR client. That read works without recursion because ADR 0011's `public.current_user_role()` is already in place. No additional RLS work in this PR.

**Note for the homepage's login button:** match PR 2's pattern — a plain server-rendered anchor or form pointing at `/auth/line/start`. No client-side Supabase call, no `signInWithOAuth`.

**Scope (in):**

1. **Role-checking helper** at `src/lib/auth/require-role.ts`:
   - Exports an async function `requireRole(allowedRoles: UserRole[]): Promise<UserContext>` for use in Server Components
   - Reads the session via `src/lib/db/server.ts`
   - If unauthenticated: redirect to `/login` (defensive — middleware should have caught this, but belt-and-suspenders for any route the middleware misses)
   - Reads `users.role` for the authenticated user
   - If role is in `allowedRoles`: return `{ id, role, fullName, email }`
   - If role is NOT in `allowedRoles`: redirect to `/coming-soon` (or to the user's actual home if they have one — see special case below)
   - Special case: a `site_admin` hitting `/pm/*` is redirected to `/sa`, not `/coming-soon`. Similarly for the reverse. This prevents legitimate users from getting bounced to the "your tools are coming" page when they just typed the wrong URL.

2. **`/coming-soon` page** at `src/app/coming-soon/page.tsx` (Server Component):
   - Uses `requireRole`-style logic but inverted: requires authentication but redirects SA/PM to their actual home if they land here
   - For visitor and all other roles, renders a minimal page:
     - Heading: `Hi, {fullName || "there"}`
     - Subheading: `You're signed in as {Role Display Name}`
     - Body paragraph: `PRC Ops is rolling out features in phases. Tools for your role aren't ready yet — we'll let you know when they go live. For now, please continue using your current process.`
     - Logout button (using `LogoutButton` from PR 2)
     - No CTAs, no fake progress bars, no roadmap commitments
   - Role display name map (hardcoded in this file):
     - `visitor` → "Visitor"
     - `super_admin` → "Super Admin"
     - `project_coordinator` → "Project Coordinator"
     - `procurement` → "Procurement"
     - `technician` → "Technician"
     - `hr` → "HR"
     - `subcon_manager` → "Subcontractor Manager"
     - `accounting` → "Accounting"

3. **`/sa` placeholder** at `src/app/sa/page.tsx`:
   - Calls `requireRole(['site_admin'])`
   - Renders: `Hi, {fullName}. You're signed in as Site Admin. Photo upload tools coming soon.`
   - Logout button
   - This is a placeholder; real SA features are future units

4. **`/pm` placeholder** at `src/app/pm/page.tsx`:
   - Same shape as `/sa` but for `project_manager`
   - Renders: `Hi, {fullName}. You're signed in as Project Manager. Approval queue coming soon.`
   - Logout button

5. **Homepage update** at `src/app/page.tsx`:
   - Currently shows the static placeholder from the earlier homepage PR
   - Add a "Log in with LINE" button below the existing copy
   - Button is a Client Component (reuse the one from `/login` if reasonable, otherwise create a thin wrapper)
   - If user is already authenticated (read session in the Server Component portion), redirect by role _instead_ of rendering the page. This prevents authenticated users from seeing the marketing copy.

6. **Update `src/app/login/page.tsx` from PR 2:**
   - Confirm the role-based redirect for already-authenticated users matches the same logic now used on the homepage. They should share the same redirect helper if practical.

**Scope (out):**

- Tests — PR 4
- Real SA or PM features (photo upload, approval queue) — future units
- Admin UI for promoting visitors — future unit, possibly v2
- RLS policy changes — no policies use roles yet, so nothing to change
- Do NOT push or PR — operator handles those manually

**Verification checklist:**

- [ ] Branch created from up-to-date main
- [ ] `/coming-soon` renders correctly for visitor/other roles
- [ ] `/coming-soon` redirects SA → `/sa` and PM → `/pm`
- [ ] `/sa` renders for site_admin; redirects PM → `/pm` and visitor → `/coming-soon`
- [ ] `/pm` renders for project_manager; redirects SA → `/sa` and visitor → `/coming-soon`
- [ ] Homepage `/` shows login button when unauthenticated
- [ ] Homepage `/` redirects authenticated users to role home
- [ ] Manual end-to-end test: log in as a visitor (new LINE account or one not yet promoted) → land on `/coming-soon` → see correct copy → logout works
- [ ] Manual end-to-end test: promote yourself to `site_admin` via SQL (`UPDATE public.users SET role = 'site_admin' WHERE id = '<your_id>'`) → log out → log in → land on `/sa`
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Progress tracker updated
- [ ] Commit message: `feat: role-based routing and coming-soon page for unserved roles`

**If blocked:** common blocker — the role-redirect helper has subtle infinite-loop potential (e.g., visitor at `/coming-soon` should NOT trigger another redirect). Test paths carefully.

---

### PR 4 of 4: Playwright E2E — **scoped to unauthenticated/protection paths only**

**Revised 2026-05-23.** The original PR 4 plan called for option (A) (mint Supabase sessions via the same `admin.generateLink` + `verifyOtp` recipe the production callback uses) so the suite could cover authenticated role-routing. After PR 2 shipped, the implication of that plan became unworkable: Playwright runs against the **linked remote Supabase project** (no local DB per ADR 0006), so option (A)'s helper would write fake users into the **production `auth.users` table** on every test run, and a crashed test would orphan rows. PR 4 is therefore narrowed to the cases that need no session and write nothing.

**Branch:** `test/auth-e2e-unauthenticated`

**Prerequisites:** PR 3 merged. The unauthenticated paths reach a stable terminal state without ever touching the DB.

**Scope (in):**

1. **`tests/e2e/auth-unauthenticated.spec.ts`** with these cases — all run logged out, no session, no DB writes:
   - `GET /sa` → redirects to `/login` (proxy protection)
   - `GET /pm` → redirects to `/login` (proxy protection)
   - `GET /coming-soon` → redirects to `/login` (proxy protection)
   - `GET /` → renders the PRC Ops placeholder with a "Log in with LINE" link pointing at `/auth/line/start`
   - `GET /login` → renders the LINE login link (anchor to `/auth/line/start`)
   - `GET /login?error=oauth_failed` → error banner with generic copy
   - `GET /login?error=session_failed` → error banner with generic copy
   - `GET /login?error=unknown` → error banner with generic copy

   Assertions use `expect(page).toHaveURL(…)` for redirects and `getByRole("link" | "alert" | "heading", …)` for content (resilient to styling churn).

2. **CI: unchanged.** `.github/workflows/ci.yml` continues to run only `lint`, `typecheck`, `test`. E2E is local-only via `pnpm test:e2e`. Wiring E2E into CI is its own infra unit (needs Playwright browsers + a running dev server + the right env vars and a test Supabase project). The new spec file's header notes the local-run requirement.

3. **No session-minting / admin-client / DB-writing test code anywhere.** If any test idea needs auth, it belongs in the deferred unit below.

**Deferred to a future unit (NOT done here):**

- **Authenticated-path E2E.** Visitor → `/coming-soon`, SA → `/sa`, PM → `/pm`, the role-mismatch redirects (SA on `/pm` → `/sa`, etc.), and the logout flow. Together with the test helper that programmatically mints sessions via `admin.generateLink` + `verifyOtp`. **Prerequisite:** a dedicated test Supabase project (separate `project-ref` from prod) so test data lives in its own `auth.users` table and a crashed test cannot orphan rows in production. The work shape is the option-(A) plan from the original spec; the only thing that changed is the prerequisite. Tracked in the progress tracker.

**Scope (out):**

- Authenticated-session tests (see "Deferred" above).
- Real LINE OAuth bounce in tests (deferred indefinitely — too fragile).
- E2E in CI (deferred with the authenticated-path work).
- Do NOT push or PR — operator handles those manually.

**Verification checklist:**

- [ ] Branch `test/auth-e2e-unauthenticated` created from up-to-date main
- [ ] `tests/e2e/auth-unauthenticated.spec.ts` covers the 8 cases above
- [ ] No session-minting / admin-client / DB-writing code in the test file
- [ ] `tests/e2e/home.spec.ts` left as-is (or trivially updated if stale — report which)
- [ ] `pnpm test:e2e` passes locally (the operator runs this on their laptop; the author of the PR confirms the tests compile and the spec is correct)
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Progress tracker updated: this PR done, authenticated-path E2E logged as the deferred unit
- [ ] Commit message: `test: Playwright E2E for unauthenticated auth-protection paths`

**If blocked:** the most likely blocker is that the dev server fails to start during `pnpm test:e2e` because `.env.local` is missing or has stale Supabase / LINE vars. Verify env vars before chasing a Playwright-config bug.

---

## Open questions surfaced during design

1. **Multi-device login for SA on shared site devices.** SA users may share a tablet across shifts. Session lifetime of 30 days means once-logged-in stays logged in indefinitely. This is fine for v1 (small pilot, known users) but is a real issue at scale. Track for v2: add a "log out everywhere" admin action, or shorten refresh tokens for `site_admin` role specifically.

2. **Admin UI for promoting visitors.** v1 ships with manual SQL promotion. By the time the second pilot expands, this won't scale. Future unit: build a `/admin` route accessible only to `super_admin` that lists visitor users and lets the admin assign roles.

3. **What happens if a LINE channel is deleted or rotated?** All existing sessions become unusable. Mitigation: don't delete the channel. Document this in operational runbook (not in code).

4. **Profile picture support.** Deliberately deferred. If needed later, store our own avatars in Supabase Storage rather than caching LINE's rotating URLs.

5. **LIFF for technicians.** Out of v1 scope. When v2 ships LIFF, the LINE channel will need additional configuration (LIFF endpoint URL, additional scopes). Not anticipated to require an auth rewrite — LIFF uses the same OIDC flow.

## References

- ADR 0004 — Audit log immutability and supersede pattern (write rule)
- ADR 0007 — Users and auth (foundational user model)
- ADR 0008 — Role enum expansion to 9 values
- ADR 0009 — Supersede current-state query correction
- [ADR 0010](../decisions/0010-visitor-default-role.md) — Visitor default role (amends ADR 0007) — written and merged in PR 1
- [ADR 0011](../decisions/0011-rls-role-helper.md) — RLS role-check helper to break self-referential policy recursion (amends ADR 0007) — prerequisite for PR 2
- [ADR 0012](../decisions/0012-custom-flow-line-auth.md) — LINE auth via custom app-handled flow (supersedes decision #4) — adopted in PR 2
- [`01-line-auth-FINDINGS.md`](./01-line-auth-FINDINGS.md) — line-auth spike findings; the live evidence that the custom flow works end-to-end
- Supabase Custom OIDC Providers docs (no longer applicable — kept for historical reference): https://supabase.com/blog/custom-oauth-oidc-providers
- LINE Login OIDC: https://developers.line.biz/en/docs/line-login/integrate-line-login/
- LINE ID token verification: https://developers.line.biz/en/docs/line-login/verify-id-token/
- `@supabase/ssr` for App Router: https://supabase.com/docs/guides/auth/server-side/nextjs
- [Supabase Discussion #11854](https://github.com/orgs/supabase/discussions/11854) — open feature request for a direct admin-mints-session API; the absence of which drives the `generateLink` + `verifyOtp` mechanism
