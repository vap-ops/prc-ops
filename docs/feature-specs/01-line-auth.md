# Feature Spec 01: LINE Login Authentication

## Status

Draft — 2026-05-20

## Goal

Wire LINE Login as the sole authentication method for PRC Ops. After signing in, users land at a role-appropriate destination (SA home, PM home, or `/coming-soon` for everyone else). New users default to a `visitor` role and require manual promotion by a `super_admin`.

This spec covers the full end-to-end auth surface: manual prerequisites (LINE Developers console + Supabase Custom Provider configuration), the schema change introducing the `visitor` role, the auth implementation (middleware, callback, login, logout), role gating, and Playwright E2E coverage.

LIFF (LINE Front-end Framework, for technicians inside the LINE app) is deferred to v2 per locked v1 scope.

## Locked design decisions

These were settled in conversation before drafting. They are not open for re-litigation during implementation. If implementation pressure suggests changing any of these, STOP and surface it — do not improvise.

1. **LINE Login is the sole auth method.** No email/password fallback. No Google, Apple, or GitHub. Both site admins (PWA) and project managers (web) authenticate the same way.
2. **Signup is open.** Anyone with a LINE account can complete the OAuth flow and end up with a row in `public.users`.
3. **New users default to `visitor`.** A `visitor` is an authenticated LINE user awaiting role assignment. Their only permitted destination is `/coming-soon`. Promotion to a real role is manual (a `super_admin` updates `users.role` via SQL or, eventually, an admin UI).
4. **Integration mechanism: Supabase Custom OIDC Provider.** LINE is not a native Supabase provider. As of April 2026, Supabase supports custom OIDC providers in the dashboard. PKCE is enabled by default. We use this mechanism — not a hand-rolled OAuth flow, not Supabase native (it doesn't exist for LINE).
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
14. **`src/lib/env.ts` cleanup:** Remove `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` optional fields. They were forward-looking placeholders from before Supabase Custom OIDC Providers shipped. LINE credentials now live in Supabase's dashboard, not your app's env.

## Implementation plan: 4 PRs

This unit splits into 4 PRs to keep each one reviewable in under 20 minutes and to keep merge risk low. The split is deliberate — combining any two of these creates a review surface too large for a non-developer operator working solo.

PRs ship strictly in this order. Each PR's prerequisites are the previous PRs.

---

### Phase 0: Manual prerequisites (no code; you do this in browser dashboards)

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

**Step 0.2 — Add Custom OIDC Provider in Supabase:**

1. Open the Supabase dashboard, navigate to your prc-ops project.
2. Authentication → Sign In / Providers → scroll to **Custom Providers** section.
3. Click **New Provider**.
4. Configure:
   - **Provider type:** OIDC
   - **Identifier:** `line` (this is the string you'll pass to `signInWithOAuth({ provider: ... })`)
   - **Display name:** LINE
   - **Issuer:** `https://access.line.me`
   - **Client ID:** the Channel ID from Step 0.1
   - **Client secret:** the Channel secret from Step 0.1
   - **Scopes:** `openid profile email` (request email; tolerate missing)
   - **Email optional:** `true` (allows sign-in without email)
   - **PKCE:** leave default (enabled)
5. Save. Supabase will generate a **Callback URL** that looks like `https://<project-ref>.supabase.co/auth/v1/callback`. Copy this exact URL.

**Step 0.3 — Configure callback URL in LINE:**

1. Back in LINE Developers console, your channel's LINE Login Settings tab.
2. Add the Supabase callback URL from Step 0.2 to "Callback URL" field.
3. Save.

**Step 0.4 — Verify:**

In a fresh browser session, navigate manually to:

`https://<your-project-ref>.supabase.co/auth/v1/authorize?provider=line`

You should be redirected to LINE's login screen. Do not complete the login — just verify the redirect happens. If it does, Phase 0 is complete.

If you get an error from LINE ("Channel not allowed" or similar), the channel ID/secret or callback URL is misconfigured in either system. Fix before proceeding.

**Phase 0 deliverable:** confirm to the operator when Phase 0 is complete. Do not start PR 1 until Phase 0 is verified.

---

### PR 1 of 4: Schema — visitor enum + trigger update + ADR 0010

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

### PR 2 of 4: Auth core — middleware, callback, login, logout

**Branch:** `feat/auth-core` (created from main _after_ PR 1 merges)

**Prerequisites:** PR 1 merged. Phase 0 verified.

**Scope (in):**

1. **Middleware/proxy at project root.** Per CLAUDE.md's Next.js 16 note: the file is `proxy.ts` at the project root (not `middleware.ts`). It uses `@supabase/ssr` to refresh the session on every request and redirects unauthenticated users away from protected routes.

   Public routes (do not require auth): `/`, `/login`, `/auth/callback`. Static assets and Next.js internals are bypassed via the matcher config.

   All other routes require an authenticated session. Unauthenticated requests to protected routes are redirected to `/login`.

2. **`/login` route at `src/app/login/page.tsx`** (Server Component):
   - Reads the session via `src/lib/db/server.ts`
   - If already authenticated: redirect by role to `/sa`, `/pm`, or `/coming-soon`
   - If unauthenticated: render a minimal login page with a single "Log in with LINE" button
   - The button is a Client Component (`src/app/login/login-button.tsx`) that calls `supabase.auth.signInWithOAuth({ provider: 'line', options: { redirectTo: <full URL to /auth/callback> } })`
   - Accept optional `?error=<code>` query param and display a banner. Error codes: `oauth_failed`, `session_failed`, `unknown`. Keep messages generic — do not leak provider error details.
   - Use existing dark theme (zinc-950 background, zinc-100 text, plain Tailwind, no shadcn for this PR)

3. **`/auth/callback` route at `src/app/auth/callback/route.ts`** (Route Handler):
   - Reads `?code=<...>` from query string. If absent or `?error=<...>` is present, redirect to `/login?error=oauth_failed`.
   - Calls `supabase.auth.exchangeCodeForSession(code)`. If it fails, redirect to `/login?error=session_failed`.
   - On success: read the user from the resulting session, query `public.users` for `role` and `full_name`.
   - If `users` row doesn't exist (race with the `on_auth_user_created` trigger), wait briefly (50ms × 3 retries) and re-query. If still missing, redirect to `/login?error=unknown` and log server-side.
   - Once role is known, redirect:
     - `site_admin` → `/sa`
     - `project_manager` → `/pm`
     - all others → `/coming-soon`
   - Update `public.users` with `line_user_id` (= JWT `sub`), `full_name` (= JWT `name`), `email` (if present in the JWT) — only if these fields are currently NULL. Do not overwrite if the user has been edited. This handles the case where the trigger created a minimal row and we're populating profile data from the first login.

4. **`/auth/logout` route at `src/app/auth/logout/route.ts`** (Route Handler, POST only):
   - Calls `supabase.auth.signOut()`
   - Clears session cookies
   - Redirects to `/`
   - GET requests return 405 Method Not Allowed (logout must be a POST to prevent CSRF via image tags)

5. **Logout button helper** at `src/components/auth/logout-button.tsx` (Client Component):
   - Renders a button that POSTs to `/auth/logout` (form submission, no JS fetch — survives JS-disabled environments)
   - Accepts a `label` prop, defaults to "Log out"
   - Used in PR 3's nav shell

**Scope (out):**

- `/sa` and `/pm` routes — placeholders in PR 3
- `/coming-soon` — PR 3
- Homepage login button — PR 3
- Tests — PR 4
- Profile picture handling — not part of v1
- Logout from LINE globally — never (hostile UX)
- Any RLS policy changes
- Do NOT push or PR — operator handles those manually

**Verification checklist:**

- [ ] Branch created from up-to-date main
- [ ] `proxy.ts` exists at project root (not under `src/`)
- [ ] Public routes work logged-out (`/`, `/login`, `/auth/callback`)
- [ ] Protected routes redirect logged-out users to `/login`
- [ ] `/login` page renders with LINE button when unauthenticated
- [ ] `/login` redirects to role home when already authenticated (manually test this by hitting `/login` while logged in)
- [ ] Clicking the LINE button initiates the OAuth flow (you reach LINE's actual login screen)
- [ ] After successful LINE login, you're redirected to the right destination by role
- [ ] Logout button POSTs to `/auth/logout`, clears session, lands on `/`
- [ ] After logout, visiting any protected route redirects to `/login`
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] Manual test: full login → land somewhere → logout → repeat. No errors in server logs.
- [ ] Progress tracker updated
- [ ] Commit message: `feat: wire LINE auth via Supabase Custom OIDC Provider`

**If blocked:** common blockers — `@supabase/ssr` API drift (verify against current docs), proxy.ts vs middleware.ts naming (Next.js 16 specific), cookie issues across local/Vercel (different domains), LINE callback URL mismatch between LINE console and Supabase.

---

### PR 3 of 4: Role gating + landings + homepage login

**Branch:** `feat/auth-role-gating` (from main, after PR 2 merges)

**Prerequisites:** PR 2 merged. You can log in and out, but logged-in users land at 404s (`/sa` and `/pm` don't exist; `/coming-soon` doesn't exist).

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

### PR 4 of 4: Playwright E2E

**Branch:** `test/auth-e2e` (from main, after PR 3 merges)

**Prerequisites:** PR 3 merged. The full auth flow works end-to-end manually.

**Scope (in):**

1. **Test infrastructure decisions to make before writing tests** — this is a Phase 0 within PR 4:
   - LINE OAuth cannot be cleanly automated in CI. Two options:
     - **(A)** Mock the Supabase callback by directly creating sessions via the service-role key (bypassing LINE entirely). Tests cover everything _after_ the OAuth bounce.
     - **(B)** Use a dedicated test LINE account with stored credentials. CI uses real LINE auth. Slower, more fragile.
   - **Recommended: A.** B is real-world but the maintenance burden of a real LINE account in CI is not worth it for v1.
   - If A is chosen, write a helper in `tests/e2e/helpers/auth.ts` that uses the service-role admin client to: create a test user in `auth.users`, ensure the `public.users` row exists with the desired role, return cookies that simulate a logged-in session.
   - This helper is gitignored from non-test contexts and must NEVER be used outside `tests/e2e/`.

2. **Test cases** at `tests/e2e/auth.spec.ts`:
   - Unauthenticated user visits `/sa` → redirected to `/login`
   - Unauthenticated user visits `/pm` → redirected to `/login`
   - Unauthenticated user visits `/coming-soon` → redirected to `/login`
   - Unauthenticated user visits `/` → sees the homepage with a login button
   - Unauthenticated user visits `/login` → sees the LINE login button
   - Authenticated `site_admin` user visits `/login` → redirected to `/sa`
   - Authenticated `project_manager` user visits `/login` → redirected to `/pm`
   - Authenticated `visitor` user visits `/login` → redirected to `/coming-soon`
   - Authenticated `site_admin` user visits `/pm` → redirected to `/sa`
   - Authenticated `project_manager` user visits `/sa` → redirected to `/pm`
   - Authenticated `visitor` user visits `/sa` → redirected to `/coming-soon`
   - Logout flow: authenticated user POSTs to `/auth/logout` → redirected to `/` → re-visiting `/sa` redirects to `/login`
   - Error banner: visiting `/login?error=oauth_failed` shows the error banner with generic copy

3. **Update CI workflow** at `.github/workflows/ci.yml` (per CLAUDE.md, CI currently only runs `lint`, `typecheck`, `test` — it does NOT run E2E). Decision: leave CI as-is for this PR. The new E2E tests run locally only. We'll add E2E to CI when we have the dedicated test infrastructure (separate Supabase project for E2E). For now, document in the test file's header that they require a clean local DB state.

4. **Update progress tracker:** mark all 4 PRs of the LINE auth unit as complete.

**Scope (out):**

- E2E in CI (deferred until separate test DB exists)
- Testing the actual LINE OAuth bounce (deferred indefinitely — too fragile)
- Real load testing or performance benchmarks
- Do NOT push or PR — operator handles those manually

**Verification checklist:**

- [ ] Branch created from up-to-date main
- [ ] Test helper for service-role session creation works
- [ ] All 13 test cases pass locally via `pnpm test:e2e`
- [ ] Existing tests still pass: `pnpm lint && pnpm typecheck && pnpm test`
- [ ] Progress tracker updated
- [ ] Commit message: `test: Playwright E2E for LINE auth flows`

**If blocked:** common blocker — the service-role session injection technique drifted between Supabase versions. If it doesn't work, fall back to option (B) only with explicit approval. Do not skip E2E.

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
- ADR 0010 (to be written in PR 1) — Visitor default role amends ADR 0007
- Supabase Custom OIDC Providers docs: https://supabase.com/blog/custom-oauth-oidc-providers
- LINE Login OIDC: https://developers.line.biz/en/docs/line-login/integrate-line-login/
- `@supabase/ssr` for App Router: https://supabase.com/docs/guides/auth/server-side/nextjs
