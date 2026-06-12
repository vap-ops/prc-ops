# Progress tracker

Tracks feature units per the workflow in `CLAUDE.md`. One section per unit.

---

## Unit: Claude Code infrastructure — skill + hook + coming-soon

- **Status:** Partially complete — items 1–3 done, items 4–6 blocked.
- **Started:** 2026-05-19
- **Items 1–3 completed:** 2026-05-19
- **Spec:** Provided inline by the operator. No `docs/feature-specs/NN-name.md`
  file exists for this unit.

### Done

1. **Skill** — `.claude/skills/supersede-pattern/SKILL.md` created.
2. **Hook** — `.claude/hooks/protect-audit-log.js` created (executable) and
   registered as a `PreToolUse` (`Write|Edit`) hook in `.claude/settings.json`.

Verification: hook blocks edits to audit_log migration paths (exit 2) for both
POSIX and Windows path forms, allows them when `CLAUDE_ALLOW_AUDIT_LOG_EDIT` is
set (exit 0), allows non-audit migrations, and fails open on malformed input.
`pnpm lint && pnpm typecheck && pnpm test` all pass (15/15 tests).

### Blocked — not implemented

Items 4–6 (the `/coming-soon` page, the post-login redirect, and the Playwright
E2E test) were **not implemented**. They depend on prerequisite work that does
not exist in the repo and is outside this unit's spec:

- **`user_role` enum.** The deployed enum is
  `('site_admin', 'pm', 'super_admin')`
  (`supabase/migrations/20260505143544_create_users.sql`), not the 8-role enum
  CLAUDE.md describes. `project_manager` and `procurement` — required by the
  redirect check and the E2E test — are not valid values.
- **No LINE auth flow.** `src/app/` has no auth callback, middleware, or login
  route. `src/lib/env.ts` marks the LINE vars optional ("Becomes required when
  LINE Login ships"); `src/lib/db/server.ts` notes middleware "will refresh
  sessions when it ships." There is no post-login redirect logic to extend.
- **No E2E auth pattern.** `tests/e2e/` contains only an unauthenticated
  page-load test; there is no user-seeding or auth-mocking pattern to follow.

Operator decision (2026-05-19): implement items 1–3 now and stop; handle the
enum/auth prerequisites as separate units before items 4–6.

### Decisions made

- **Hook path normalisation.** The spec's regex
  `supabase/migrations/.*audit[_-]?log.*` uses forward slashes; the operating
  environment is Windows, where tool `file_path` values use backslashes. The
  hook normalises `\` to `/` before matching so the specified regex works on
  both platforms. The regex itself is unchanged.
- **`.claude/settings.json`.** The file was auto-created by the harness with a
  `permissions` block during this session; the hook entry was merged in, the
  `permissions` block left intact. `settings.local.json` was not touched.
- **ESLint.** ESLint scans `.claude/` and flagged `require()` in the hook
  (`@typescript-eslint/no-require-imports`). The hook must be CommonJS
  (`package.json` has no `type`), so a single
  `eslint-disable-next-line` was added on that line — the narrowest fix,
  confined to the spec'd file.

### Open questions

- **LINE auth flow.** Items 4–6 assume "LINE OAuth is already wired" — it is
  not. The auth callback / middleware must exist first.
- **`users.display_name`.** Item 4's coming-soon page reads `display_name`; the
  deployed `users` table has `full_name`. To reconcile when item 4 is unblocked.
- **ESLint scope (out of scope — not actioned).** ESLint currently lints
  `.claude/`. Adding `.claude/**` to `globalIgnores` in `eslint.config.mjs`
  would be the principled fix, but is outside this unit's spec. Surfaced here
  per CLAUDE.md scope discipline.

### Resolved

- **`user_role` enum expansion.** Resolved by ADR 0008 and the Role enum
  expansion unit (2026-05-20) — the enum now has 9 values. See the unit below.
- **Supersede direction inconsistency.** Fixed 2026-05-20. ADR 0009 added to
  amend ADR 0004's read pattern (anti-join, not IS NULL). SKILL.md rewritten.
  ADR 0004 Status annotated. CLAUDE.md Supersede bullet updated.

---

## Unit: Role enum expansion (ADR 0008)

- **Status:** Complete — 2026-05-20.
- **Spec:** Provided inline by the operator.
- **ADR:** `docs/decisions/0008-role-enum-expansion.md`.

### Done

- The `user_role` enum was expanded from 3 to 9 values, deployed to the remote
  DB on 2026-05-20: `site_admin`, `project_manager` (renamed from `pm`),
  `super_admin`, `project_coordinator`, `procurement`, `technician`, `hr`,
  `subcon_manager`, `accounting` — the 8 PRC roles in CLAUDE.md plus the
  operational `super_admin` (see ADR 0008).
- Migrations applied to the remote DB:
  `20260520143000_rename_pm_role_to_project_manager.sql` and
  `20260520143100_add_six_new_user_roles.sql`.
- `src/lib/db/database.types.ts` regenerated from the live schema.
- pgTAP test `01-users.test.sql` updated to assert the 9 values; plan count
  unchanged at 12. `pnpm db:test` (5 files, 29 assertions) and
  `pnpm lint && pnpm typecheck && pnpm test` all pass.

### Decisions made

- In `01-users.test.sql`, the SQL comment labelling the `enum_has_labels`
  assertion ("...the three expected values") was updated to "...nine" so it
  stays consistent with the assertion below it. No other lines changed.

### Still blocked

Serving the unserved roles still depends on prerequisites outside this unit:

- **LINE auth flow** — no auth callback / middleware / login route exists yet.
- **`/coming-soon` redirect** — not implemented; depends on the auth flow.

---

## Unit: Supersede current-state query correction (ADR 0009)

- **Status:** Complete — 2026-05-20.
- **Spec:** Provided inline by the operator.
- **Entry:** ADR 0009 — Supersede current-state query correction (2026-05-20).

### Done

- Created `docs/decisions/0009-supersede-query-correction.md` amending ADR
  0004's current-state read pattern from `WHERE superseded_by IS NULL` to an
  anti-join.
- Rewrote `.claude/skills/supersede-pattern/SKILL.md` to teach the anti-join
  pattern.
- Annotated ADR 0004's Status line to reference ADR 0009.
- Updated the CLAUDE.md Supersede pattern bullet.

---

## Unit: LINE auth — PR 1 of 4: schema prep (ADR 0010)

- **Status:** Complete — 2026-05-22.
- **Started / completed:** 2026-05-22.
- **Spec:** `docs/feature-specs/01-line-auth.md` (PR 1 of 4 section).
- **ADR:** `docs/decisions/0010-visitor-default-role.md` — amends ADR 0007.
- **Phase 0 (LINE Developers + Supabase Custom OIDC Provider setup):**
  completed and verified by the operator before this PR. OAuth bounce to LINE
  confirmed working.

### Done

- Added `visitor` as the 10th value of `public.user_role`. Final enum order:
  `site_admin, project_manager, super_admin, project_coordinator, procurement,
technician, hr, subcon_manager, accounting, visitor`.
- Changed the `public.users.role` column default from `'site_admin'` to
  `'visitor'`. The `handle_new_user()` trigger function was not touched —
  it inserts only `id` and relies on the column default, so altering the
  column default was sufficient (spec branch B).
- Migrations applied to the remote DB:
  `20260522223813_add_visitor_role.sql` and
  `20260522223814_change_user_default_role.sql`. Split into two files
  because `ALTER TYPE ADD VALUE` cannot run in the same transaction as
  statements that use the new value (same pattern ADR 0008 established).
- `src/lib/db/database.types.ts` regenerated — now shows 10 enum values.
- pgTAP `01-users.test.sql` updated: `enum_has_labels` array extended to 10
  values, comment + descriptions updated to "ten", `col_default_is` now
  asserts `'visitor'`. Plan count unchanged at 12.
- `src/lib/env.ts`: removed the optional `LINE_CHANNEL_ID` and
  `LINE_CHANNEL_SECRET` fields and their "Becomes required when LINE Login
  ships" comment. LINE credentials live in Supabase's Custom OIDC Provider
  now, not in app env.
- `CLAUDE.md` Roles section: added `visitor` as a v1 default-state role
  beneath the 8 PRC roles; intro line rephrased to note "8 PRC roles plus
  a `visitor` default state for new signups". ADR 0007 Status annotated to
  reference ADR 0010.
- `pnpm db:test` (5 files, 29 assertions) and
  `pnpm lint && pnpm typecheck && pnpm test` (15/15) all pass.

### Decisions made

- **Default-role mechanism (spec branch A vs B).** The current `users.role`
  default is set by the column default on `public.users.role`
  (`20260505143544_create_users.sql:7`), not in the trigger function body
  (`handle_new_user()` inserts only `id`). The spec explicitly allowed
  altering the column default in that case; migration 2 is therefore
  `ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'visitor';` and
  the trigger function is untouched.
- **Phase 0 discovery — Supabase provider identifier is `custom:line`, not
  `line`.** The spec's PR 2 section currently calls
  `supabase.auth.signInWithOAuth({ provider: 'line', ... })`. PR 2 must
  use `'custom:line'` instead — Supabase prefixes custom-provider
  identifiers with `custom:`. This affects every `signInWithOAuth` call,
  the `/auth/callback` handler if it references the provider, and any
  test fixtures. Flag at the top of PR 2's branch.
- **Sibling pgTAP file fix.** `supabase/tests/database/02-users-trigger.test.sql`
  asserts that the auto-create trigger lands a row with role `site_admin`.
  That assertion is directly broken by the default change, so the
  expected value was updated to `'visitor'` to keep `pnpm db:test` green.
  The spec only named `01-users.test.sql`, but the spec's verification
  checklist requires `db:test` to pass — this is the minimum fix to
  satisfy that, and it's the same class of change as the spec's
  "Update any other assertion affected by the default change" line.

### Open questions

- **`CLAUDE.md` architecture section stale line.** Line ~150 in
  `CLAUDE.md` says "A trigger on `auth.users` insert auto-creates a
  `public.users` row (role defaults to `site_admin`). See ADR 0007." The
  default is now `visitor`, so the parenthetical is stale. Not updated in
  this PR (strict scope: spec named only the Roles section). One-word fix
  worth picking up in PR 2 or a tiny chore PR.
- **`.env.example` and the LINE channel secret (rotation REQUIRED —
  trigger condition met).** During this session, `git diff .env.example`
  showed local-only edits placing real-looking LINE values into the
  tracked template (`LINE_CHANNEL_ID=2009971313` and the real
  `LINE_CHANNEL_SECRET`). The operator reverted the file mid-session, so
  the tree at commit time matches `origin/main` — empty placeholders.
  The original open question said: rotate IF the values were ever
  committed anywhere. **2026-06-11 audit finding: they were — an earlier
  revision of this very tracker entry recorded the secret verbatim, and
  it sits in git history even after redaction.** The literal has been
  scrubbed from the current file (2026-06-11), but the rotation
  condition is met: rotate the channel secret in the LINE Developers
  console and update the live runtime env (Vercel `LINE_CHANNEL_SECRET`,
  per ADR 0012 — the custom flow DOES use it at runtime; this entry's
  original "no longer referenced by any application code" note described
  the pre-ADR-0012 OIDC plan and is itself stale).
- **`tests/unit/env.test.ts` vestigial assertion.** The test
  `does NOT throw when LINE_CHANNEL_ID and LINE_CHANNEL_SECRET are absent`
  still passes (Zod ignores undeclared env vars) but no longer
  corresponds to anything in the schema. Worth deleting in a tiny
  follow-up; not removed here to stay strictly within spec.
- **Admin UI for promoting visitors.** Manual SQL promotion is fine for
  the v1 pilot; will not scale past it. Tracked in ADR 0010's open
  questions. Future unit.

---

## Unit: LINE auth — PR 2 of 4: auth core

- **Status:** Complete — 2026-05-22.
- **Started / completed:** 2026-05-22.
- **Spec:** `docs/feature-specs/01-line-auth.md` (PR 2 of 4 section), with
  two operator-approved corrections applied at the top of the prompt:
  provider identifier is `custom:line` (not `line`), and the profile write
  uses the admin client (not the anon SSR client).

### Done

- `proxy.ts` at project root (Next.js 16 convention; not `middleware.ts`,
  not under `src/`). Uses `@supabase/ssr` `createServerClient` with the
  canonical `getAll`/`setAll` cookie pattern from the official
  `vercel/next.js/examples/with-supabase/lib/supabase/proxy.ts` template:
  `setAll` writes onto `request.cookies` and re-creates
  `supabaseResponse = NextResponse.next({ request })` before writing the
  same cookies onto `supabaseResponse.cookies`. `supabase.auth.getUser()`
  is invoked immediately after `createServerClient` with no intermediate
  code (the "do not run code between" warning is load-bearing — it
  prevents random sign-outs). Unauthenticated requests to anything other
  than `/`, `/login`, `/auth/callback` redirect to `/login`. Matcher
  excludes `_next/static`, `_next/image`, `favicon.ico`, and common image
  extensions.
- `/login` server component at `src/app/login/page.tsx`. Reads the
  session via `src/lib/db/server.ts`; if a user is present, looks up
  `users.role` and redirects to `/sa` (`site_admin`), `/pm`
  (`project_manager`), or `/coming-soon` (anything else). If
  unauthenticated, renders the dark-themed page with a `LoginButton` and
  optional error banner (codes: `oauth_failed`, `session_failed`,
  `unknown`). All error copy is generic — no provider error details leak.
- `LoginButton` client component at `src/app/login/login-button.tsx`.
  Creates a browser supabase client and calls
  `signInWithOAuth({ provider: "custom:line", options: { redirectTo:
${NEXT_PUBLIC_APP_URL}/auth/callback } })`. `NEXT_PUBLIC_APP_URL` comes
  from the existing zod-validated env so the redirect works on both
  localhost and Vercel — no hardcoded domain.
- `/auth/callback` route handler at `src/app/auth/callback/route.ts`.
  Validates `?code` / `?error`, calls `exchangeCodeForSession`, fetches
  the user, reads `users.role / line_user_id / full_name` via the
  RLS-respecting SSR client (the user can read their own row), retries
  on missing row (50ms × 3 attempts, for the trigger-race window), then
  redirects by role. Error paths redirect to
  `/login?error=oauth_failed` (missing/oauth error),
  `/login?error=session_failed` (exchange failure / no user), and
  `/login?error=unknown` (users row never appeared — also logged to
  `console.error`).
- **Profile write — admin client (per operator correction).** When
  `line_user_id` or `full_name` is currently NULL on the user's
  `public.users` row, the callback populates it via the service-role
  admin client (`src/lib/db/admin.ts`). The write is a single UPDATE
  scoped to `eq("id", user.id)` that only includes columns currently
  NULL — non-NULL values are never overwritten (an admin may have
  corrected them). Profile-write failures are non-fatal: they're
  `console.error`'d but the user is still redirected to their role
  destination.
- `/auth/logout` route handler at `src/app/auth/logout/route.ts`. POST
  signs out via the SSR client and 303-redirects to `/`. GET returns 405
  with `Allow: POST`. The 303 status is important — it forces the
  browser to follow with a GET, which keeps the redirect safe for both
  fetch-based and form-submit-based callers.
- `LogoutButton` at `src/components/auth/logout-button.tsx`. Plain
  server-rendered HTML form (`method="post" action="/auth/logout"`) with
  a submit button — no `"use client"`, no JS. Works in JS-disabled
  environments. Accepts a `label` prop, defaults to "Log out". Not
  mounted anywhere in this PR (PR 3 wires it into the role landings).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass.
  Build output shows the 5 expected routes: `/` (static), `/login`,
  `/auth/callback`, `/auth/logout`, `/_not-found`.

### Decisions made

- **Profile write uses the admin client (service role), not the
  RLS-respecting SSR client.** Per operator correction at the top of
  the PR 2 prompt: writing profile fields via the user's own session
  would require an RLS self-update policy. Such a policy would let an
  attacker who controlled their own session update any column they have
  write access to — including, in the worst case, fields that gate
  feature access. Using the admin client confines the write to the
  server-side callback handler, with no policy change, and lets us
  enforce the NULL-only rule in application code rather than RLS. The
  admin client bypasses RLS by design and is `server-only`, so it never
  reaches the browser bundle.
- **No RLS policy added or changed in this PR.** The existing
  "users read self" SELECT policy from `20260505143544_create_users.sql`
  is sufficient for the callback's role lookup (the SSR client reads
  the user's own row). The profile write goes through the admin client
  and so doesn't require a write policy at all.
- **`Provider` type cast through `unknown`.** supabase-js v2.105's
  `Provider` union does not list `custom:*` providers, but its JSDoc
  explicitly documents the `custom:` prefix and the `SignInWithIdToken`
  variant uses the `custom:${string}` template type. The narrowest cast
  that compiles under strict TS without `any` is
  `"custom:line" as unknown as Provider`. Confined to one constant
  (`LINE_PROVIDER`) in `login-button.tsx`. The callback handler uses the
  raw string `"custom:line"` only for an identity-array lookup, so no
  cast is needed there.
- **Logout uses HTTP 303 on the POST→GET redirect.** Plain
  `NextResponse.redirect(url)` defaults to 307 (preserves the method).
  A 307 after a POST would re-POST to `/`, which is wrong for a logout
  redirect. 303 forces a GET — the standard pattern for form-post
  redirects.

### Open questions

- **`public.users.email` column does not exist** (resolved as
  Option A — drop the email write). Spec section 5 said the profile
  write should populate `email` if NULL, but the column was never added
  in PR 1's schema work; `public.users` has only `id, role, full_name,
line_user_id, created_at, updated_at` per
  `20260505143544_create_users.sql` and the regenerated
  `database.types.ts`. The operator approved Option A: drop `email`
  from the profile write, ship `line_user_id` and `full_name` only.
  The user's email is still available at runtime via
  `auth.users.email` (read with `supabase.auth.getUser()`), so no
  information is lost — it just isn't denormalized into `public.users`.
  If a future feature needs to join on email, filter by email, or
  reference it from RLS, ship a tiny follow-up: one migration adding
  `email text`, one line in this callback to populate it. **The
  operative spec text in `01-line-auth.md` PR 2 step 3 and the
  callback's "Scope (in)" point 5 are stale on this point** — worth a
  one-line annotation if PR 2's spec is ever re-read by a future
  Claude session.
- **Verification by live OAuth bounce.** The OAuth handshake itself
  cannot be exercised in this environment (it requires hitting LINE's
  authorization endpoint in a real browser with Phase 0's channel).
  The operator will manually test the full flow after merge: load
  `/login` → click "Log in with LINE" → bounce to LINE → return to
  `/auth/callback` → land on `/sa` / `/pm` / `/coming-soon` per role →
  POST `/auth/logout` → land on `/`. PR 3's 404 destinations for the
  role landings (which don't exist yet) are expected during this PR's
  manual smoke.

---

## Unit: Bug fix — split env validation into client/server modules

- **Status:** Complete — 2026-05-23.
- **Started / completed:** 2026-05-23.
- **Spec:** Provided inline by the operator. No
  `docs/feature-specs/NN-name.md` — this is a bug-fix unit, not a feature.
- **Trigger:** Live testing of PR 2 (`feat/auth-core` → `main` `940f412`)
  white-screened the `/login` page on Vercel.

### Root cause

`src/lib/env.ts` defined a single merged `envSchema` (server + client) and
ran `parseEnv(process.env)` at module load. Client Components
(`src/lib/db/browser.ts`, `src/app/login/login-button.tsx`) imported the
exported `env` constant, which dragged the whole module — including the
server schema and its `SUPABASE_SERVICE_ROLE_KEY` validation — into the
browser bundle. In the browser, server-only vars are correctly
`undefined`, so the Zod parse threw "expected string, received undefined"
at first paint and the page never rendered. There was no `server-only`
guard on `env.ts`, so the bundler had no way to catch this at build time.

### Resolution

Split env validation into two modules. Build-time guarantee replaces
runtime hope: client components literally cannot import server vars
without breaking the build.

- `src/lib/env.ts` — client-safe. Validates `NEXT_PUBLIC_*` only. Exports
  `clientEnv`, `parseClientEnv`, and `ClientEnv`. No `server-only`
  directive — must be importable from Client Components.
- `src/lib/env.server.ts` — new. Starts with `import "server-only"`.
  Validates `SUPABASE_SERVICE_ROLE_KEY` only. Exports `serverEnv`,
  `parseServerEnv`, and `ServerEnv`. Any client-side import path that
  reaches this file fails the bundler (build break).

### Importers updated

- `src/lib/db/admin.ts` — imports both: `serverEnv.SUPABASE_SERVICE_ROLE_KEY`
  and `clientEnv.NEXT_PUBLIC_SUPABASE_URL`. The file is already
  `server-only`; importing `@/lib/env.server` is fine and gives a second
  layer of guarantee.
- `src/lib/db/server.ts` — `clientEnv` only (URL + anon key).
- `src/lib/db/browser.ts` — `clientEnv` only. This is the client-side
  importer that broke before; now it pulls a tree that contains zero
  references to server secrets.
- `src/app/login/login-button.tsx` — `clientEnv` only (`NEXT_PUBLIC_APP_URL`).
  This Client Component was the immediate crash site.
- `proxy.ts` — `clientEnv` only. Proxy runs in Node, but reads only
  `NEXT_PUBLIC_*` values (URL + anon key), so it doesn't need the server
  module.

### Tests

`tests/unit/env.test.ts` rewritten to call `parseClientEnv` and
`parseServerEnv` directly with crafted input objects — no more
import-side-effect tests. Coverage is broader than before: missing/empty
required vars, default applies when omitted, override is accepted,
malformed URLs rejected, separately on both client and server validators.
Test count: 15 → 17.

### Decisions made

- **`vi.mock("server-only", () => ({}))` is per-file, not global.** The
  test imports `@/lib/env.server`; `server-only`'s `index.js`
  unconditionally `throw`s in non-RSC contexts (vitest is Node + jsdom,
  no `react-server` export condition), so an import would crash at
  module load. The mock is the narrowest fix. If future test files
  exercise other `server-only` modules they can add the same one-line
  mock, or promote it into `src/test/setup.ts` if it becomes routine —
  not done here to keep this fix surgical.
- **Test file rewrite drops the vestigial `LINE_CHANNEL_*` assertion.**
  The old test asserted "does NOT throw when LINE_CHANNEL_ID and
  LINE_CHANNEL_SECRET are absent" — but those fields were removed from
  the schema in PR 1 and the test became meaningless. It can't survive
  the rewrite (there's no schema field to assert against), so it's gone.
  Previously flagged as a follow-up in the PR 1 tracker entry; resolved
  here as a consequence of the larger rewrite.
- **`server-only` in `admin.ts` was already present.** The bug was
  specifically about `env.ts` (which had no guard). Keeping
  `admin.ts`'s existing `import "server-only"` plus adding it to the
  new `env.server.ts` gives defense in depth: even if a future admin
  helper accidentally drops its own guard, it still can't reach the
  client bundle through the env module.

### Verification

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all pass.
  Tests: 17/17. Build: 5 routes (`/`, `/login`, `/auth/callback`,
  `/auth/logout`, `/_not-found`), no `server-only` violations reported.
- The build passing is the load-bearing check. If any client-side import
  path reached `@/lib/env.server`, the bundler would error on the
  `import "server-only"` statement; it didn't.
- The white-screen bug cannot be exercised in this environment (it
  required a real browser hitting the deployed `/login`). The operator
  will re-verify on Vercel after merge: load `/login`, confirm the page
  renders the LINE button without console errors.

### Open questions

None blocking. Surfaced for the record:

- **Should `server-only` be globally mocked in `src/test/setup.ts`?**
  Not done here (one test file needs it; a global mock affects every
  test run). Worth revisiting if a second test starts needing the same
  mock.

---

## Unit: Bug fix — inline NEXT*PUBLIC*\* vars into the client bundle

- **Status:** Complete — 2026-05-23.
- **Started / completed:** 2026-05-23.
- **Spec:** Provided inline by the operator.
- **Trigger:** After the env-split fix merged as `b4bc3fe`, the `/login`
  page still white-screened on Vercel with
  `NEXT_PUBLIC_SUPABASE_URL: expected string, received undefined`. The
  vars were correctly set in the Vercel dashboard and the build passed.

### Root cause

`src/lib/env.ts` ended with `export const clientEnv = parseClientEnv(process.env)`,
passing the whole `process.env` object to the parser. Next.js's client-side
env inlining only triggers on **literal** references like
`process.env.NEXT_PUBLIC_FOO` that the bundler can detect at parse time.
Passing `process.env` whole is opaque to the bundler — none of the
`NEXT_PUBLIC_*` values get inlined into the client bundle. At build time
the parse succeeds (Node has the full `process.env`); at runtime in the
browser, `process.env` is essentially empty and Zod rejects every
required `NEXT_PUBLIC_*` field.

This was a **pre-existing latent bug** that lived dormant in `env.ts`
since the file's creation. The merged-schema version (before the
client/server split) had the same defect — but no client component
imported it cleanly enough for it to surface. The env-split fix
(`b4bc3fe`) made `env.ts` properly importable from Client Components,
which exposed the latent bug instead of causing it.

### Fix

One-statement change in `src/lib/env.ts`: replace `parseClientEnv(process.env)`
with an object literal that references each `NEXT_PUBLIC_*` var by name:

```ts
export const clientEnv = parseClientEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
```

Schema and `parseClientEnv` signature untouched. Tests were unaffected
(they call `parseClientEnv` with crafted input objects, never via
`process.env` directly).

### Decisions made

- **`env.server.ts` left untouched.** The same pattern would be cosmetic
  there: server-only vars (`SUPABASE_SERVICE_ROLE_KEY`) are read at
  runtime from a real Node `process.env`, never inlined into a bundle.
  Per the spec's "do not over-engineer" guidance, no change.
- **Inlining confirmed by grep.** Spot-check after `pnpm build`:
  `grep -r -l "btbfzhnvzruvxlgbeqnl" .next/static` returned a client
  chunk hit (the Supabase project-ref from `db:link`). Before this fix
  that string would have been absent from `.next/static`.

### Verification

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all pass.
  Tests still 17/17 (no test changes needed; the spec's hypothesis held).
- Client-bundle inlining verified by grep against `.next/static`.
- Live `/login` verification on Vercel is the operator's manual step
  after merge — this is the bug's actual repro surface and cannot be
  exercised from a local Node `next build` alone.

### Open questions

None.

---

## Unit: LINE custom-flow auth spike (complete and removed)

- **Status:** Complete — spike merged 2026-05-23 as `c4e03a1` (#18);
  spike code removed 2026-05-23 in `chore/remove-line-auth-spike` once
  the operator confirmed the live test on a Vercel preview proved the
  mechanism end-to-end.
- **Spec:** Provided inline by the operator. Spike artifact at
  `docs/feature-specs/01-line-auth-FINDINGS.md` (moved from the
  spike's working file in `spikes/line-auth-FINDINGS.md` so the record
  survives the spike-code deletion).
- **Question answered:** Can the app run its own LINE OAuth 2.1 flow,
  verify LINE's HS256 id_token server-side, and mint a real Supabase
  Auth session for the resolved user? **Yes.**

### Done

- Spike implemented under `src/app/spikes/line-auth/` (start, callback,
  result routes) on `spike/line-auth-custom-flow`. Live-tested on a
  Vercel preview deployment.
- Live test (2026-05-23) returned `session_exists: true`, resolved
  `auth_user_id` to `623f2da5-…`, synthetic email
  `line_<sub>@line.local` worked, LINE profile captured in
  `user_metadata { provider: 'line', line_sub, name }`. The
  generateLink → verifyOtp pattern minted real Supabase session
  cookies and `supabase.auth.getUser()` resolved server-side.
- Spike code fully removed in this PR. The temporary
  `pathname.startsWith("/spikes/")` bypass in `proxy.ts` removed in the
  same commit (along with both `TEMPORARY spike bypass` comment lines).
  `proxy.ts` is back to its pre-spike protection logic: any
  unauthenticated request to anything other than `/`, `/login`, or
  `/auth/callback` is redirected to `/login`.
- Findings preserved at
  [docs/feature-specs/01-line-auth-FINDINGS.md](feature-specs/01-line-auth-FINDINGS.md)
  with the proven mechanism, the live-test evidence, the multi-env
  `redirect_uri` derivation, the real-bug discovery (see next unit),
  and the real-implementation recommendation.

### Real bug discovered (next unit) — RLS infinite recursion on `public.users`

The only failure in the live test was the result page's read of
`public.users`. The query returned
`"infinite recursion detected in policy for relation \"users\""`. The
Supabase session itself is valid (`auth.uid()` resolved correctly).
The cause is almost certainly the `super_admin full access on users`
policy in `supabase/migrations/20260505143544_create_users.sql` — it
self-joins `public.users` inside the `using` clause, which re-enters
the same policy. This blocks both the spike's result page and the real
auth implementation (which will need to read `users.role` after
`exchangeCodeForSession` / session mint to redirect by role).

**This is the next unit.** Fix lives in a dedicated PR (the spike
removal does not fix it). Expected shape: rewrite the super_admin
policy to use a `SECURITY DEFINER` helper that reads
`public.users.role` while bypassing RLS, instead of self-joining. Will
amend ADR 0007 because it changes how role checks compose.

### Decisions made

- **Findings doc preserved, not abandoned.** The spike's findings file
  was the deliverable feeding ADR 0011 and the real-impl PR. Moving it
  to `docs/feature-specs/01-line-auth-FINDINGS.md` (rather than letting
  it die with the spike branch) keeps the proven session-minting
  recipe, the live-test evidence, and the RLS-recursion discovery in
  the spec set where the next implementer will look.
- **LINE_CHANNEL_ID / LINE_CHANNEL_SECRET retained.** The spike read
  these directly from `process.env`. They graduate to the real
  implementation (which will reify them into `src/lib/env.server.ts`).
  **Do not remove from `.env.local` or Vercel.**
- **Top-level `spikes/` directory kept.** It still contains the
  unrelated `spikes/01-pdf-generation/` artifacts plus the
  `vitest.spike.config.ts` infrastructure. Only `spikes/line-auth-FINDINGS.md`
  was removed; `01-pdf-generation/` is unaffected.

### Pending

- ~~**ADR 0011** ("LINE auth via custom flow because Supabase OIDC
  rejects HS256")~~ — superseded note: ADR 0011 was instead assigned
  to the RLS role-helper fix (see next unit). The custom-flow ADR will
  be the **next available number** (ADR 0012) when the real
  implementation lands. The FINDINGS doc has been updated to reflect
  this renumbering.
- ~~**Real implementation** of the custom flow at `/auth/start` +
  `/auth/callback`~~ — still pending, but **no longer blocked** by the
  RLS recursion: see next unit.

---

## Unit: RLS infinite recursion on `public.users` (ADR 0011)

- **Status:** Complete — 2026-05-23.
- **Started / completed:** 2026-05-23.
- **Spec:** Provided inline by the operator. No
  `docs/feature-specs/NN-name.md` for this unit (it's a targeted
  DB-only bug fix). Background and discovery in
  [`docs/feature-specs/01-line-auth-FINDINGS.md`](feature-specs/01-line-auth-FINDINGS.md).
- **ADR:** [`docs/decisions/0011-rls-role-helper.md`](decisions/0011-rls-role-helper.md)
  — amends ADR 0007.

### Done

- Introduced **`public.current_user_role()`** — a SECURITY DEFINER,
  STABLE, `search_path`-pinned helper that returns the caller's own
  `public.user_role`. It bypasses RLS by design (which breaks the
  recursion); it is safe because it takes no parameters, returns only
  the caller's own row, has its `search_path` pinned to `public`, and
  is granted EXECUTE only to `authenticated`. The five safety
  conditions are spelled out in ADR 0011 so future reviewers have an
  explicit checklist for any change to the function.
- **Rewrote the recursive policy.** `super_admin full access on users`
  now uses `public.current_user_role() = 'super_admin'` in both
  `using` and `with check` instead of self-joining `public.users`.
  Same semantics, no recursion.
- **The "users read self" policy was not touched.** It never queried
  the table, so it never recurred.
- Migration:
  [`supabase/migrations/20260523213246_fix_users_rls_recursion.sql`](../supabase/migrations/20260523213246_fix_users_rls_recursion.sql).
  Existing `20260505143544_create_users.sql` was NOT edited
  (migrations are immutable history per CLAUDE.md); the fix ships as
  a forward migration that drops and recreates the policy.
- Applied to the remote DB via `pnpm db:push`. Types regenerated via
  `pnpm db:types` — only substantive change to
  `src/lib/db/database.types.ts` is the new
  `Functions.current_user_role: { Args: never; Returns: user_role }`
  surface; the rest of the diff is supabase-CLI vs prettier
  cosmetic formatting (semicolon stripping).
- ADR 0007 Status annotated with one line referencing ADR 0011 (same
  pattern ADRs 0009 and 0010 used).
- New pgTAP file
  [`supabase/tests/database/06-users-rls.test.sql`](../supabase/tests/database/06-users-rls.test.sql)
  with **7 assertions**:
  - **Catalog (2):** function exists; function is SECURITY DEFINER
    (`pg_proc.prosecdef`).
  - **Direct function call (2):** set jwt claim, call
    `current_user_role()` directly, assert the return value matches
    the seeded role for two different uuids — independent of the
    role-switch mechanics.
  - **REGRESSION GUARD (1, load-bearing):** `lives_ok` wrapping the
    exact `select from public.users where id = …` shape that
    previously raised `infinite recursion detected in policy for
relation users`, under `set local role authenticated` with the
    jwt claim set.
  - **Role visibility under RLS (2):** super_admin sees both seeded
    rows; non-super (site_admin) sees only its own row. Both also run
    under `set local role authenticated`.
- All 36 pgTAP assertions across 6 files pass (previously 29 across
  5 files). `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
  also all pass; 17/17 vitest tests.
- The bug logged in the previous unit ("Real bug discovered: RLS
  infinite recursion on `public.users`") is **resolved**.

### Decisions made

- **`current_user_role()` is the canonical role-check primitive
  going forward.** All future RLS policies that gate on the caller's
  role must call it instead of self-joining `public.users` — the same
  recursion failure would otherwise recur in any new policy. ADR 0011
  documents this as a project-wide rule, not just a one-off fix.
- **pgTAP auth-context pattern established.** Before this unit, no
  pgTAP test simulated an authenticated session. The new file uses
  `set local role authenticated` + `set local "request.jwt.claims" = …`
  (JSON form, durable across Supabase versions), with one-time
  grants on the runner's temp result buffer (`_tap_buf` and its
  `_tap_buf_ord_seq` sequence) so role-switched assertions can still
  record TAP output. `reset role` runs unconditionally before
  `finish()` — pgTAP wrappers absorb per-assertion failures into TAP
  output rather than raising, so the cleanup always reaches that
  line, and the rollback at end-of-test is the final belt-and-braces.
  This pattern is local to `06-users-rls.test.sql`; if future tests
  need it, lift the grants into the runner.
- **FINDINGS-doc ADR-number renumbering** ([`docs/feature-specs/01-line-auth-FINDINGS.md`](feature-specs/01-line-auth-FINDINGS.md)).
  That doc previously reserved "ADR 0011" for the future custom-flow
  ADR. ADR 0011 is now this RLS-helper ADR, so the FINDINGS doc was
  edited in this same commit to point the custom-flow ADR at the
  next available number (ADR 0012). Out-of-scope per strict reading
  of the spec, but in-scope as a direct consistency fix caused by
  this PR's number assignment — the same principle applied when
  PR 1's pgTAP changes adjusted an adjacent stale comment.

### Open questions

None blocking.

- **Performance note (for future review, not action):** the policy
  planner now executes one `current_user_role()` call per row tested
  against the super_admin policy. STABLE caching makes this trivial,
  but if a future hot path scans many rows under a super_admin
  session and shows up in slow-query logs, the fix is to add an
  index-aware variant or move role-gating into the application layer
  for that specific path. Not anticipated for v1 scale.

---

## Unit: ADR 0012 — adopt custom-flow LINE auth, revise spec 01 plan (docs-only)

- **Status:** Complete — 2026-05-23.
- **Started / completed:** 2026-05-23.
- **Spec:** Provided inline by the operator. No
  `docs/feature-specs/NN-name.md` — docs-only unit, no code.
- **ADR:** [`docs/decisions/0012-custom-flow-line-auth.md`](decisions/0012-custom-flow-line-auth.md)
  — supersedes [`docs/feature-specs/01-line-auth.md`](feature-specs/01-line-auth.md)
  decision #4. Does **not** annotate ADR 0007 (user model + trigger
  are unaffected; ADR 0011 already amended 0007 for the RLS helper).

### Done

- **ADR 0012 written.** Documents: (a) why the OIDC approach is dead
  (HS256 vs ES256/RS256, exact Supabase auth-log error quoted), (b)
  why `signInWithIdToken` is also unusable, (c) the proven mechanism
  in step order (LINE OAuth handshake → HS256 verify → admin
  `createUser` → `generateLink` → `verifyOtp` → role read → role
  redirect) with the exact session-minting code, (d) the locked
  route shape (`/auth/line/start`, `/auth/line/callback`, plain-link
  login button — no client-side Supabase call), (e) env: `LINE_CHANNEL_ID`
  and `LINE_CHANNEL_SECRET` graduate to `env.server.ts`, (f) safety
  conditions for the load-bearing pieces (state/CSRF, HS256
  `timingSafeEqual` + aud/iss/exp validation, admin client is
  server-only, `hashed_token` never reaches the browser, synthetic
  email is opaque), and (g) the operational LINE-allowlist policy.
- **Spec 01 revised in place** to match the new plan:
  - Status block updated with a 2026-05-23 revision line.
  - Decision #4 marked superseded with a one-line pointer to ADR 0012.
  - Decision #14 marked reversed by ADR 0012 (`LINE_CHANNEL_*` come
    back to env.server.ts in PR 2).
  - Phase 0 annotated: Step 0.2 (Supabase OIDC provider config) is
    unused — leave existing dashboard state in place but skip for
    new setups. Step 0.3 (LINE callback URL) rewritten to point at
    the app's `/auth/line/callback`, with the allowlist policy spelled
    out (multiple URLs allowed, no wildcards). Step 0.4 (verification)
    folded into PR 2's manual smoke (the original pre-PR-2 verify
    URL probed the dead OIDC path).
  - PR 1 marked **COMPLETE** with the merge commit referenced.
  - PR 2 fully rewritten for the custom flow: env additions, proxy
    `PUBLIC_PATHS` update, `/auth/line/start` + `/auth/line/callback`
    route handlers, `/auth/logout` unchanged, `LogoutButton` unchanged,
    login button replaced with a server-rendered link/form, dead
    OIDC code removal (`/auth/callback` + `login-button.tsx`'s
    `signInWithOAuth`), verification checklist rewritten.
  - PR 3 prerequisites and notes updated: now sits on top of PR 2's
    custom-flow session and ADR 0011's RLS helper. The homepage
    login button matches PR 2's plain-link pattern.
  - PR 4 test-helper option (A) updated: the helper uses the same
    admin `generateLink` + `verifyOtp` calls the production callback
    uses (programmatic replay of the last three steps), not an OIDC
    mock.
  - References section: ADRs 0010, 0011, 0012 added with links;
    findings doc cross-linked; the Supabase OIDC blog post kept but
    flagged as no-longer-applicable.

### Decisions made

- **No annotation of ADR 0007.** Spec was explicit, and 0007's
  content (the `auth.users` → `public.users` trigger + linkage) is
  unaffected by this ADR. 0007 is already annotated by ADR 0011 for
  the RLS-helper amendment, which is the appropriate place.
- **Original PR 2 text replaced, not struck-through.** The original
  PR 2 (OIDC-based) is partially preserved by the git history of
  this file. Keeping it inline as strikethrough would make the spec
  harder to read for the people who actually need to ship PR 2 next.
  Status block points at the revision date; the FINDINGS doc and
  ADR 0012 carry the deep historical context.
- **`jose` is recommended, `node:crypto` is acceptable** for HS256
  verification — spec PR 2 says so explicitly. The spike used
  `node:crypto`; real PR 2 may continue using it or switch to `jose`.
  Either way the safety conditions in ADR 0012 must be met.

### Dead code currently on main (to be removed in real PR 2)

The original (OIDC-based) PR 2 shipped to main in PR #15 (`940f412`)
and the env-split + env-inline fixes that followed (#16, #17) kept
that code building. The following files contain dead code that the
real PR 2 will delete or rewrite:

- `src/app/auth/callback/route.ts` — calls `exchangeCodeForSession`
  against the Supabase Custom OIDC Provider, which rejects LINE's
  HS256 `id_token`. Delete in PR 2.
- `src/app/login/login-button.tsx` — contains the client-side
  `signInWithOAuth({ provider: "custom:line" })` call. Replace with
  a plain server-rendered anchor or form pointing at
  `/auth/line/start`.
- `proxy.ts` `PUBLIC_PATHS` references `/auth/callback` — update to
  reference `/auth/line/start` and `/auth/line/callback` instead.

### Verification

- `pnpm lint && pnpm typecheck && pnpm test` all pass — docs-only
  change should not affect them, and confirmed locally.
- Build verified (no docs reference is consumed by a build step
  that would break on the renumbering).

### Open questions

None blocking.

- The Supabase Custom OIDC Provider configured in Phase 0 is dead
  state in the Supabase dashboard. Removing it is the operator's
  call; ADR 0012 does **not** instruct deletion (dashboard state is
  out of any PR's scope).
- The real PR 2 unit is now unblocked. The branch name suggested in
  the spec is `feat/auth-core-custom-flow` to distinguish it from
  the original `feat/auth-core` which shipped the OIDC code.

---

## Unit: LINE auth — real PR 2 of 4: custom-flow auth core (ADR 0012)

- **Status:** Complete — 2026-05-23.
- **Started / completed:** 2026-05-23.
- **Spec:** [`docs/feature-specs/01-line-auth.md`](feature-specs/01-line-auth.md)
  PR 2 section (rewritten in the prior unit per
  [ADR 0012](decisions/0012-custom-flow-line-auth.md)).
- **Branch:** `feat/auth-core-custom-flow`.

### Done

- **Env additions.** [src/lib/env.server.ts](../src/lib/env.server.ts)
  serverSchema now requires `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET`
  (both `z.string().min(1)`). Server-only — the env-split work from
  PR #16 keeps them out of the client bundle, and the existing
  `import "server-only"` guard fails the build if they're ever pulled
  into a client component.
- **`/auth/line/start`** at
  [src/app/auth/line/start/route.ts](../src/app/auth/line/start/route.ts) —
  GET route handler. Generates a 16-byte hex CSRF `state`, stores in an
  httpOnly+secure+sameSite=lax cookie scoped to `/auth/line` (max-age
  600s), builds LINE's authorize URL with `redirect_uri` derived from
  `request.nextUrl.origin` (multi-env safe per ADR 0012; both routes
  compute the same value on a given request so LINE's exact-match
  check passes), 302s to LINE.
- **`/auth/line/callback`** at
  [src/app/auth/line/callback/route.ts](../src/app/auth/line/callback/route.ts) —
  GET route handler implementing the full spike-proven flow:
  1. Validate state cookie vs query param; cookie is single-use
     (deleted regardless of outcome).
  2. Exchange `?code` at LINE's token endpoint
     (`https://api.line.me/oauth2/v2.1/token`).
  3. Verify the returned HS256 `id_token` via the helper below.
  4. Provision-or-locate via admin `createUser` with synthetic email
     `line_<sub>@line.local` (`email_confirm: true`, `user_metadata`
     captures `provider: 'line'`, `line_sub`, `name`). Duplicate-email
     errors (`email_exists` / `user_already_exists` / message contains
     "already") are treated as the idempotent "already provisioned"
     branch.
  5. Mint a session via `admin.generateLink({type:'magiclink'})` →
     `supabase.auth.verifyOtp({type:'magiclink', token_hash})` on the
     SSR server client — that client's `setAll` callback writes the
     `sb-*` cookies onto the route handler's response.
  6. Read `public.users.role` for the now-authenticated user with
     50ms × 3-retry backoff for the trigger-race window. Works
     unrecursively post-ADR-0011.
  7. NULL-only profile write via the admin client: populate
     `line_user_id` (= verified JWT `sub`) and `full_name` (= verified
     JWT `name`) only if currently NULL. Failure is logged and
     non-fatal — the user is signed in, the redirect proceeds.
  8. Redirect by role: `site_admin` → `/sa`, `project_manager` →
     `/pm`, anything else → `/coming-soon`.
- **HS256 verifier** at
  [src/lib/auth/verify-line-id-token.ts](../src/lib/auth/verify-line-id-token.ts) —
  isolated `server-only` module. Uses `node:crypto`'s `createHmac` +
  `timingSafeEqual`. Validates `alg === 'HS256'`, signature against
  channel secret, `iss === 'https://access.line.me'`,
  `aud === LINE_CHANNEL_ID`, `exp > now`, `iat <= now + 60s`,
  `sub` non-empty. Returns only `{ sub, name }`. Throws on any
  failure; the callback catches, logs server-side, and redirects to
  `/login?error=oauth_failed`.
- **proxy.ts `PUBLIC_PATHS`** updated to
  `["/", "/login", "/auth/line/start", "/auth/line/callback"]`. The
  old `/auth/callback` entry is gone. `/auth/logout` is POST-only and
  intentionally not public (the existing POST form authenticates
  through the user's session cookies; unauthenticated POSTs would
  redirect to `/login`, which is correct).
- **Login button rewritten.**
  [src/app/login/login-button.tsx](../src/app/login/login-button.tsx)
  is now a plain server-rendered `<a href="/auth/line/start">`. No
  `"use client"`, no `signInWithOAuth`, no `'custom:line'` reference,
  no browser Supabase client. Plain `<a>` (not `next/link`) so route
  prefetching can't accidentally trigger the OAuth state cookie set.
  Existing styling preserved.
- **Dead OIDC route deleted.**
  `src/app/auth/callback/route.ts` (the previous
  `exchangeCodeForSession` handler against the dead Supabase Custom
  OIDC Provider) is removed.
- **/auth/logout untouched** — the POST→signOut→303 redirect pattern
  works regardless of how the session was minted.
- **Test env synced.** Both `tests/unit/env.test.ts` and
  `vitest.config.ts` were updated to include `LINE_CHANNEL_ID` and
  `LINE_CHANNEL_SECRET` (otherwise the static
  `import "@/lib/env.server"` in the env test would throw at module
  load — server vars are validated at import time). Added 4 new
  parseServerEnv assertions (missing/empty for both LINE vars);
  total test count went from 17 → 21.

### Decisions made

- **HS256 verifier extracted to `src/lib/auth/verify-line-id-token.ts`.**
  The callback route is already ~200 lines of flow control; extracting
  the security-sensitive verifier keeps that route focused and
  isolates the trust boundary. The verifier is `import "server-only"`
  so it cannot reach a client bundle even by accident. `node:crypto`
  (not `jose`) per the spike's proven approach — ADR 0012 explicitly
  allows either.
- **All Supabase clients created inside the GET handler** (Fluid
  Compute requirement). Both `createClient` factories — `admin.ts`
  and `server.ts` — already return a new client per call with no
  module-scope state; the callback simply calls them inside its
  handler body. No module-scope client anywhere in the auth surface.
- **Plain `<a>`, not `next/link`, for the login button.** `next/link`
  can prefetch routes on hover; if a prefetched request hit
  `/auth/line/start`, the OAuth state cookie would be set and the
  302 followed — defeating the CSRF protection. Plain anchor avoids
  this entirely.
- **`/auth/logout` left as a protected route.** It's a POST-only form
  whose action requires an existing session to do anything useful;
  unauthenticated POSTs hit the proxy redirect to `/login`. That's
  correct behavior — no need to public-list it.
- **profile write checks `claims.name` truthiness, but `claims.sub`
  is unconditional.** The verifier guarantees `sub` is a non-empty
  string (it throws otherwise), so `if (row.line_user_id === null)`
  is sufficient — no extra guard. `name` is `string | null` (LINE
  may not always send it), so the assignment guards on it.

### Operator follow-up (post-merge)

The OAuth bounce can't be exercised here — operator must validate
the full flow on a Vercel preview deployment:

1. Confirm `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` are set in
   the Vercel environment (Production + Preview), **server-only** (no
   `NEXT_PUBLIC_` flag).
2. Confirm the LINE channel's "Callback URL" allowlist includes
   `https://<preview-host>/auth/line/callback` for the preview you're
   testing against (and production once merged).
3. Load `/login`, click "Log in with LINE", complete consent on
   LINE, expect to land on `/sa` / `/pm` / `/coming-soon` per the
   `public.users.role` value. PR 3 destinations 404 — that's
   expected; PR 3 fills them in.
4. POST `/auth/logout` (via the eventual nav button once PR 3 wires
   it in, or via curl with the session cookies), expect to land on
   `/`. Re-visiting `/sa` redirects to `/login`.

### Open questions

None blocking.

- **Branch naming.** `feat/auth-core-custom-flow` distinguishes this
  PR from the earlier `feat/auth-core` (which shipped the OIDC code
  that's deleted here). Recorded so the GitHub log stays legible.
- **Manual LINE allowlist policy.** Documented in ADR 0012 and the
  spec's revised Phase 0. No code change in this PR; it's purely
  operational.

---

## Unit: LINE auth — PR 3 of 4: role gating + landings

- **Status:** Complete — 2026-05-23.
- **Started / completed:** 2026-05-23.
- **Spec:** [`docs/feature-specs/01-line-auth.md`](feature-specs/01-line-auth.md)
  PR 3 section (revised by [ADR 0012](decisions/0012-custom-flow-line-auth.md)).
- **Branch:** `feat/auth-role-gating`.

### Done

- **`src/lib/auth/role-home.ts`** — single source of truth for the
  role → landing-path mapping. Exports `UserRole` (alias of the
  generated `Database["public"]["Enums"]["user_role"]`) and
  `roleHome(role): string`. `site_admin → /sa`,
  `project_manager → /pm`, anything else → `/coming-soon`.
- **`src/lib/auth/require-role.ts`** — Server-Component gate.
  `import "server-only"`. Creates the SSR client inside the function
  (no module-scope client — Fluid Compute requirement), `getUser()`,
  reads `users.role + full_name` for the authenticated user. Unauth
  → `redirect("/login")`. Row missing (defensive — post-login the
  ADR 0007 trigger ensures it's there) → `console.error` +
  `redirect("/login")`. Role not in `allowedRoles` →
  `redirect(roleHome(role))` (the not-allowed branch routes through
  the shared helper, so a `site_admin` who lands on `/pm` goes to
  `/sa`, never blanket-redirected to `/coming-soon`). Returns
  `{ id, role: UserRole, fullName: string | null }`.
- **`src/app/coming-soon/page.tsx`** — Server Component.
  Auth-required (the proxy already enforces this; the page double-
  checks defensively). For `site_admin` / `project_manager`, early
  `redirect("/sa")` / `redirect("/pm")` so they land where their
  tools live. All other roles render the page with greeting + role
  display name + the body paragraph from the spec + `LogoutButton`.
  Role-display-name map is hardcoded in the file and typed as
  `Record<Exclude<UserRole, "site_admin" | "project_manager">,
string>`, so adding/removing/renaming an enum value triggers a
  compile error here — no silent drift.
- **`src/app/sa/page.tsx`** — `requireRole(["site_admin"])`, then
  the spec's greeting + "Photo upload tools coming soon." +
  `LogoutButton`.
- **`src/app/pm/page.tsx`** — `requireRole(["project_manager"])`,
  greeting + "Approval queue coming soon." + `LogoutButton`.
- **`src/app/page.tsx` (homepage)** — Now async. Reads the session;
  if authenticated and the `public.users` row exists,
  `redirect(roleHome(role))`. Otherwise renders the original PRC Ops
  placeholder plus the existing `LoginButton` (reused — already a
  plain server-rendered `<a href="/auth/line/start">` from PR 2).
- **`src/app/login/page.tsx`** — refactored to use `roleHome` for
  the role-based redirect of already-authenticated visitors. Same
  semantics as before; one line of inline if/if/else replaced with
  `redirect(row ? roleHome(...) : "/coming-soon")`. The
  `?error=<code>` banner logic and the unauthenticated render are
  unchanged.
- **`src/app/auth/line/callback/route.ts`** — trivial refactor: the
  callback's `redirectByRole` helper now imports and calls
  `roleHome` instead of carrying its own copy of the role → path
  branching. Same input, same output, less code. Allowed by the
  spec as a trivial import-only change; not a behavior change.
- **`proxy.ts`** unchanged. `/sa`, `/pm`, `/coming-soon` are not in
  `PUBLIC_PATHS`, so the proxy already redirects unauthenticated
  requests to `/login` before they reach the page's own
  `requireRole` / inline check. Belt-and-suspenders: the page does
  its own auth check too, for paths that bypass middleware (e.g.,
  any future internal navigation that skips the proxy).
- **Build output verified.** `pnpm build` shows 9 routes: `/`,
  `/_not-found`, `/auth/line/callback`, `/auth/line/start`,
  `/auth/logout`, `/coming-soon` (new), `/login`, `/pm` (new),
  `/sa` (new). All dynamic except `/_not-found`. `pnpm lint`,
  `pnpm typecheck`, `pnpm test` (21/21) all pass.

### Redirect-loop analysis (every path traced; no cycles)

Notation: `→ /x` means HTTP redirect; `render` means terminal.

| Origin role                            | Path           | Outcome                                     |
| -------------------------------------- | -------------- | ------------------------------------------- |
| unauthenticated                        | `/`            | render homepage with login link             |
| unauthenticated                        | `/login`       | render login page                           |
| unauthenticated                        | `/sa`          | proxy → `/login` (then render)              |
| unauthenticated                        | `/pm`          | proxy → `/login` (then render)              |
| unauthenticated                        | `/coming-soon` | proxy → `/login` (then render)              |
| `site_admin`                           | `/`            | → `/sa` → render                            |
| `site_admin`                           | `/login`       | → `/sa` → render                            |
| `site_admin`                           | `/sa`          | render                                      |
| `site_admin`                           | `/pm`          | → `roleHome=/sa` → render                   |
| `site_admin`                           | `/coming-soon` | → `/sa` → render                            |
| `project_manager`                      | `/`            | → `/pm` → render                            |
| `project_manager`                      | `/login`       | → `/pm` → render                            |
| `project_manager`                      | `/sa`          | → `roleHome=/pm` → render                   |
| `project_manager`                      | `/pm`          | render                                      |
| `project_manager`                      | `/coming-soon` | → `/pm` → render                            |
| `visitor` (or any other unserved role) | `/`            | → `roleHome=/coming-soon` → render          |
| `visitor`                              | `/login`       | → `roleHome=/coming-soon` → render          |
| `visitor`                              | `/sa`          | → `roleHome=/coming-soon` → render          |
| `visitor`                              | `/pm`          | → `roleHome=/coming-soon` → render          |
| `visitor`                              | `/coming-soon` | render (no further redirect — load-bearing) |

No cycles. Every traversal terminates in at most one render after one
redirect. The load-bearing invariant is that `/coming-soon` does not
redirect for any non-SA/non-PM role; if it did (e.g., for `visitor`),
visitor at `/coming-soon` → `roleHome(visitor) = /coming-soon` would
loop. The early-return on `site_admin` / `project_manager` is the
only redirect on `/coming-soon`.

### Decisions made

- **`/coming-soon` role-display map is typed as `Record<Exclude<UserRole,
"site_admin" | "project_manager">, string>`.** Adding, removing, or
  renaming a role in the database enum will compile-fail this file
  rather than silently fall back to displaying the raw enum key. The
  fallback `?? role` is kept as a runtime safety net for genuine drift
  (e.g., the DB returning an unexpected string), but the type is the
  primary guarantee.
- **Callback refactored to use `roleHome` (trivial import-only).**
  The spec allowed it explicitly if low-risk. Eliminates the
  duplicated role → path branching; the spike-proven flow is otherwise
  unchanged. No behavioral difference; the role-string `as UserRole`
  cast is unchecked at runtime but the previous code's else-branch and
  `roleHome`'s else-branch both handle unexpected roles by routing to
  `/coming-soon` — identical fallback semantics.
- **Plain `<a>` for the homepage login link** — reused the existing
  `LoginButton` from PR 2. Same anti-prefetch reasoning as PR 2's
  decision (avoid `next/link` so route prefetching can't accidentally
  trigger the OAuth `state` cookie set on hover).
- **`requireRole` row-missing branch redirects to `/login`** rather
  than guessing a role. The ADR 0007 trigger guarantees the row
  exists post-login, so reaching this branch means something is
  badly broken (session valid, but no `public.users` row) and the
  safest user-visible action is to start over.

### Operator follow-up (post-merge)

The full role-gated flow can finally be tested end-to-end on a Vercel
preview:

1. Log in as a freshly-created LINE account. Expect to land on
   `/coming-soon` (role defaults to `visitor` per ADR 0010). Greeting
   uses the LINE display name; role label reads "Visitor"; logout
   button works and returns to `/`.
2. Promote yourself to `site_admin` via SQL
   (`UPDATE public.users SET role = 'site_admin' WHERE id = '<your-id>'`).
   Log out, log back in. Expect to land on `/sa` with "Site Admin"
   greeting.
3. Try the role mismatch paths: visit `/pm` as `site_admin` — should
   bounce to `/sa`. Visit `/coming-soon` as `site_admin` — should
   bounce to `/sa`. Visit `/sa` as `project_manager` — should bounce
   to `/pm`.
4. Log out from any of the landings. Expect to land on `/` and the
   homepage to show the login link (no longer redirecting since the
   session is gone).

### Open questions

None blocking.

- **`requireRole`'s `allowedRoles` parameter is `ReadonlyArray<UserRole>`.**
  This allows literal tuples (`["site_admin"]`) to be passed without
  TS complaining about widening. If a future caller wants to compose
  arrays dynamically, the readonly is still safe.
- **Real SA / PM features (photo upload, approval queue)** are
  out-of-scope per the spec; the current landings are placeholders.
  Tracked separately as future units.

---

## Unit: LINE auth — PR 4 of 4: unauthenticated-path E2E (auth unit complete for v1)

- **Status:** Complete — 2026-05-23.
- **Started / completed:** 2026-05-23.
- **Spec:** [`docs/feature-specs/01-line-auth.md`](feature-specs/01-line-auth.md)
  PR 4 section (rewritten in this PR — see "Scope decision" below for
  why the original plan was narrowed).
- **Branch:** `test/auth-e2e-unauthenticated`.

### Scope decision

The original spec's PR 4 planned option-(A) — mint Supabase sessions
in tests by replaying `admin.generateLink` + `verifyOtp` — to cover
authenticated role-routing. After PR 2 shipped, the implication
became clear: Playwright runs against the **linked remote Supabase
project** (no local DB per ADR 0006), so option (A) would write fake
users into the **production `auth.users` table** on every test/CI
run, and any test crash could orphan rows. PR 4 was therefore
narrowed to paths that need no session and write nothing. The
authenticated-path E2E work is **deferred** until a dedicated test
Supabase project exists; see "Deferred" below.

### Done

- **`tests/e2e/auth-unauthenticated.spec.ts`** — 8 cases:
  - `GET /sa` → 302 to `/login` (proxy protection)
  - `GET /pm` → 302 to `/login`
  - `GET /coming-soon` → 302 to `/login`
  - `GET /` → renders the PRC Ops placeholder with a "Log in with
    LINE" link pointing at `/auth/line/start`
  - `GET /login` → renders the LINE login link
  - `GET /login?error=oauth_failed` → generic error banner
  - `GET /login?error=session_failed` → generic error banner
  - `GET /login?error=unknown` → generic error banner
- **Assertions** use `expect(page).toHaveURL(…)` for redirects and
  `getByRole("link" | "alert" | "heading", { name })` for content,
  matching the existing `home.spec.ts` style and staying resilient
  to styling churn.
- **No session-minting / admin-client / DB-writing code** anywhere
  in the new test file — the entire purpose of the scope narrowing.
- **`tests/e2e/home.spec.ts` deleted.** It asserted
  `expect(page).toHaveTitle(/prc-ops/i)`, but the actual page title
  is still the Next.js scaffold default `"Create Next App"` —
  surfaced when chromium ran the suite locally. The new
  `auth-unauthenticated.spec.ts` has a stronger homepage assertion
  (heading + login link present, by role), so the old file was
  folded in and removed per the spec's "fold its assertion into the
  new spec and delete it" option. **Surfaced as a follow-up:** the
  app metadata in `src/app/layout.tsx` (`title: "Create Next App"`,
  `description: "Generated by create next app"`) is also still
  scaffold default. Tiny `chore` PR to set it to "PRC Ops" /
  matching copy. Not done here (out of scope for an E2E unit).
- **CI unchanged.** `.github/workflows/ci.yml` still runs only lint
  / typecheck / test. E2E is local-only via `pnpm test:e2e`. The
  test file's header documents the local-run requirement.
- **Spec PR 4 section rewritten** to reflect the deferral, with the
  list of 8 cases and the explicit "deferred to a future unit" note
  for authenticated-path E2E.

### LINE auth unit — overall status

PR 1 (schema, ADR 0010), PR 2 (custom-flow auth core, ADR 0012),
PR 3 (role gating + landings), and PR 4 (unauthenticated E2E) are
all complete and merged or pending the operator's manual push of
this branch. The auth unit is **complete for v1** modulo the
deferred authenticated-path E2E.

### Deferred (tracked as a future unit)

**Authenticated-path E2E + dedicated test Supabase project.**

- **Why deferred:** writing the option-(A) session-minting helper
  against the prod Supabase project would pollute prod
  `auth.users` with synthetic test users and risk orphaned rows on
  test crashes. Mitigating that responsibly needs a separate
  Supabase project for E2E.
- **What the deferred unit does:**
  1. Create a second Supabase project (call it
     `prc-ops-e2e`) with the same schema (apply existing
     `supabase/migrations/*` via `db:link` + `db:push`).
  2. Add `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`,
     `E2E_SUPABASE_SERVICE_ROLE_KEY` to local `.env.local` and the
     Vercel test environment (server-only).
  3. Either add a `playwright.config.ts` override that points the
     dev server at the e2e project, or fork the dev server into a
     `pnpm dev:e2e` script with the e2e env loaded.
  4. Add the test helper in `tests/e2e/helpers/auth.ts` that
     replays `admin.generateLink` + `verifyOtp` against the e2e
     admin client and returns session cookies.
  5. Write the authenticated test cases — visitor → `/coming-soon`;
     SA → `/sa`; PM → `/pm`; SA on `/pm` → `/sa`; PM on `/sa` →
     `/pm`; visitor on `/sa` → `/coming-soon`; logout flow.
  6. Wire E2E into CI at the same time (Playwright browsers +
     dedicated test env vars + `pnpm test:e2e` step).
- **Out of scope for v1** unless the operator decides the test
  coverage is worth the second-project setup cost.

### Verification

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all
  pass (21/21 unit tests; build shows the same 9 routes from PR 3 —
  no app code changed).
- **`pnpm test:e2e` ran here across all three configured browsers**
  (chromium, firefox, webkit; `playwright install` was invoked to
  fetch the firefox + webkit binaries). Final result: **24 / 24
  tests pass** (8 cases × 3 browsers).

  An initial run failed on firefox's three error-banner cases:
  `getByRole("alert")` matched both the login banner and Next.js's
  hidden route announcer (`<div role="alert"
id="__next-route-announcer__">`), tripping Playwright's strict-mode
  dual-match guard. Fix: kept `role="alert"` on the banner (correct
  a11y) and added a stable `data-testid="login-error"` to the
  element, switching the three error tests to
  `getByTestId("login-error")`. No app behavior change; selector-only.
  Documented inline in the spec file so the next person reading it
  understands the trade.

### Open questions

None blocking.

---

## Unit: Chore — stale role-default doc + app metadata

- **Status:** Complete — 2026-05-23.
- **Started / completed:** 2026-05-23.
- **Spec:** Provided inline by the operator. No
  `docs/feature-specs/NN-name.md` — small cleanup unit, no logic
  changes. Closes two follow-ups previously surfaced as "Open
  questions" / inline notes in earlier units.
- **Branch:** `chore/metadata-and-stale-doc`.

### Done

- **CLAUDE.md stale prose corrected.** The Architecture →
  "Database schema & immutability" bullet for `users` previously
  read "(role defaults to `site_admin`)" — left stale by ADR 0010
  which changed the column default to `visitor`. Flagged as a
  follow-up in the PR 1 (ADR 0010) unit's Open questions. Now
  reads "(role defaults to `visitor`). See ADR 0007 and ADR 0010."
  The Roles section (lines 73–85), which already names `visitor`
  correctly, was not touched.
- **`src/app/layout.tsx` app metadata replaced.** The
  create-next-app scaffold defaults (`title: "Create Next App"`,
  `description: "Generated by create next app"`) — flagged in the
  PR 4 (auth E2E) unit's Done section — are now
  `title: "PRC Ops"` and
  `description: "Construction project operations platform."` (matches
  the homepage copy in `src/app/page.tsx`). No other metadata fields
  added.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass.

### Open questions

None.

---

## Unit: projects table — first domain table (ADR 0013)

- **Status:** Complete — 2026-05-24.
- **Started / completed:** 2026-05-24.
- **Spec:** Provided inline by the operator. No
  `docs/feature-specs/NN-name.md` — locked design decisions specified
  in the prompt.
- **ADR:** [`docs/decisions/0013-project-access-model.md`](decisions/0013-project-access-model.md)
  — establishes the role-level access model for `projects` and, by
  extension, every domain table that hangs off it in v1
  (`work_packages`, `photo_logs`).
- **Branch:** `feat/projects-table`.

### Done

- **ADR 0013 written.** Documents the role-level (model C) decision,
  the falsifiable triggers that would require switching to membership
  (external PMs, subcontractor accounts, customer-review accounts,
  project count outgrowing trusted memory), the upgrade path that
  preserves all existing data and only tightens existing RLS policies,
  and the explicit commitment to build nothing v1 that would obstruct
  that upgrade. Cross-links ADR 0005 (v1 scope), 0007 (users), 0010
  (visitor default), 0011 (role-helper).
- **Migration**
  [`supabase/migrations/20260524000000_create_projects.sql`](../supabase/migrations/20260524000000_create_projects.sql)
  applied via `pnpm db:push`. Creates:
  - `public.project_status` enum: `active`, `on_hold`, `completed`,
    `archived` — no v1 logic gates on the value; it is accurate
    metadata for the future archive UX.
  - `public.projects` table: `id uuid pk default gen_random_uuid()`,
    `code text unique not null` (human-assigned `PRC-YYYY-NNN`,
    not DB-generated), `name text not null`,
    `status project_status not null default 'active'`,
    `created_at`, `updated_at` (both timestamptz, default `now()`).
  - `projects_set_updated_at` trigger BEFORE UPDATE → existing
    `public.set_updated_at()` function from
    `20260505143544_create_users.sql`. The function is **not**
    redefined.
  - RLS enabled. Three policies, all gated on
    `public.current_user_role()` (ADR 0011) — never self-joining
    `public.users`: - SELECT: `current_user_role() in ('site_admin',
'project_manager', 'super_admin')` - INSERT: `current_user_role() = 'super_admin'` - UPDATE: `current_user_role() = 'super_admin'` in both USING and
    WITH CHECK. - **No DELETE policy.** Load-bearing per ADR 0013 — projects are
    archived via status, never hard-deleted via the app.
- **Seed** [`supabase/seed.sql`](../supabase/seed.sql) created (no
  prior seed file existed). Inserts the two pilot projects
  (`PRC-2026-001 TFG Lam Sonthi`, `PRC-2026-002 TFG Kham Muang`) with
  `ON CONFLICT (code) DO NOTHING` for idempotence. Application
  mechanism documented in the file header (and below).
- Both seed rows applied to the linked DB and verified
  (`status='active'` on both).
- `pnpm db:types` regenerated
  [`src/lib/db/database.types.ts`](../src/lib/db/database.types.ts) —
  `projects` Row/Insert/Update + `project_status` enum
  (`["active","on_hold","completed","archived"]`) both present.
- **pgTAP** [`supabase/tests/database/07-projects.test.sql`](../supabase/tests/database/07-projects.test.sql)
  — 28 assertions covering:
  - Enum existence + exact labels (2).
  - Table shape — PK, column types, NOT NULL, defaults, UNIQUE on
    `code` (14).
  - `projects_set_updated_at` trigger exists (1).
  - RLS enabled (1).
  - Policy-cmd enumeration: exactly SELECT/INSERT/UPDATE — **no
    DELETE policy** (1).
  - Authenticated context with `set local role authenticated` +
    JWT-claims impersonation (pattern reused from
    [`supabase/tests/database/06-users-rls.test.sql`](../supabase/tests/database/06-users-rls.test.sql)
    including the `_tap_buf` grants):
    - super_admin can INSERT (1).
    - site_admin / project_manager INSERT denied with SQLSTATE 42501
      (2).
    - super_admin / site_admin / project_manager can SELECT (3).
    - visitor sees zero rows (1).
    - super_admin DELETE has no effect — row remains (1).
    - `set_updated_at` trigger advances `updated_at` on UPDATE (1).
- Full pgTAP suite: **7 files, 64 assertions, all green** (previously
  6 files / 36 assertions).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
  (21/21 vitest tests; 9 routes built — no app code changed).

### Decisions made

- **Migration timestamp.** UTC clock here returned `20260523172849`,
  which would sort _before_ the most recent existing migration
  (`20260523213246`). Used `20260524000000` instead to keep the
  filename-as-history monotonic with today's calendar date
  (2026-05-24). Migrations apply in filename-sorted order so a
  timestamp older than the existing latest would have caused the
  Supabase CLI to skip or mis-order it.
- **No-DELETE-policy verified two ways.** A schema-level assertion
  (`pg_policies.cmd` set on `projects` is exactly
  `{INSERT, SELECT, UPDATE}`) catches any future migration that adds
  a DELETE policy by accident. A functional assertion (super_admin
  DELETE leaves the target row in place) confirms the runtime
  behavior. Both because the contract is load-bearing.
- **`set_updated_at` trigger test uses a fixed past
  `updated_at = '2020-01-01'`** on the fixture row. `now()` returns
  `transaction_timestamp()`, which is frozen within a single
  transaction, so an INSERT + UPDATE in the same test transaction
  would otherwise share a timestamp and the trigger's effect would
  be unobservable. Asserting `updated_at > '2020-01-01'` after the
  UPDATE makes the trigger's effect visible regardless of when the
  test runs.
- **`throws_ok` four-argument form.** Three-argument
  `throws_ok(query, errcode, description)` does not exist — pgTAP
  treats the third argument as the expected error _message_, not a
  test description, so the assertion fails on the message-text
  mismatch even when the SQLSTATE matches. Used
  `throws_ok(query, errcode, null, description)` instead. Worth
  remembering for any future RLS-deny assertion.
- **`code` not auto-generated.** Per the locked design,
  `PRC-YYYY-NNN` codes are human-assigned. The two pilot codes are
  flagged in the seed file as provisional — the operator updates
  them via a super_admin UPDATE once the real project numbers are
  confirmed.

### Seed application mechanism (operator note)

`pnpm db:push` does **NOT** run `supabase/seed.sql`. Supabase only
runs seed files during `supabase db reset`, which this repo does not
use (no local Docker stack per ADR 0006). For this unit the seed was
applied via:

```
pnpm exec supabase db query --linked --file supabase/seed.sql
```

The script is idempotent (`ON CONFLICT (code) DO NOTHING`), so
re-running it is safe. Pasting the file's contents into the Supabase
SQL editor is an equivalent route. Documented in the seed file
header as well.

### Next domain unit

**work_packages.** Will reference `projects` via
`work_packages.project_id uuid not null references public.projects(id)`,
inherit the same role-level RLS pattern per ADR 0013 (read for
site_admin/project_manager/super_admin; writes scoped to whichever
roles author WPs in v1 — to be specified in that unit's prompt), and
land alongside the WP-import feature deferred from ADR 0002. The
membership-model upgrade documented in ADR 0013 remains **deferred**
— it is triggered by the appearance of external / non-team accounts,
not by a date.

### Open questions

None blocking.

- **Provisional project codes.** `PRC-2026-001` / `PRC-2026-002` are
  placeholders. The operator updates them to the real project
  numbers via a super_admin UPDATE once those are confirmed; the
  unique constraint on `code` prevents collisions.
- **Hard delete of a project.** If ever needed (incident response,
  data deletion request), requires a service-role context — a
  migration or a manual SQL session — because no DELETE policy
  exists. Intentional per ADR 0013; surfacing the operational
  detail.

---

## Unit: work_packages table — lean v1 child of projects

- **Status:** Complete — 2026-05-24.
- **Started / completed:** 2026-05-24.
- **Spec:** Provided inline by the operator. No
  `docs/feature-specs/NN-name.md` — schema-only unit. Access model
  inherited from [ADR 0013](decisions/0013-project-access-model.md);
  no new ADR required (the role-level decision already governs
  `work_packages`).
- **Branch:** `feat/work-packages-table`.

### Done

- **Migration**
  [`supabase/migrations/20260524010000_create_work_packages.sql`](../supabase/migrations/20260524010000_create_work_packages.sql)
  applied via `pnpm db:push`. Creates:
  - `public.work_package_status` enum:
    `not_started, in_progress, on_hold, complete, pending_approval`.
    `pending_approval` is present in the enum but **no v1 logic
    transitions to it** — that belongs to the future photo-upload
    unit. In this unit status is manual-only metadata.
  - `public.work_packages` table: `id uuid pk default
gen_random_uuid()`, `project_id uuid not null references
public.projects(id) on delete cascade`, `code text not null`,
    `name text not null`, `description text` (nullable),
    `status work_package_status not null default 'not_started'`,
    `created_at`, `updated_at` (timestamptz, default `now()`).
  - Composite unique constraint
    `work_packages_project_code_unique unique (project_id, code)` —
    a WP code is unique _within_ a project, not globally; two
    different projects may carry the same code.
  - Index `work_packages_project_id_idx on (project_id)`. The unique
    constraint already creates a leading-`project_id` index, so this
    is mostly redundant for selectivity — kept explicit so the FK
    lookup intent is visible and so a future change to the unique
    constraint cannot accidentally remove the index.
  - `work_packages_set_updated_at` trigger BEFORE UPDATE → existing
    `public.set_updated_at()` function from
    `20260505143544_create_users.sql`. The function is **not**
    redefined.
  - RLS enabled. Three policies, all gated on
    `public.current_user_role()` (ADR 0011) — never self-joining
    `public.users`: - SELECT: `current_user_role() in ('site_admin',
'project_manager', 'super_admin')`. - INSERT: `current_user_role() in ('project_manager',
'super_admin')`. - UPDATE: `current_user_role() in ('project_manager',
'super_admin')` in both USING and WITH CHECK. - **No DELETE policy.** Load-bearing — same archive-not-delete
    contract as `projects` (ADR 0013).
- `pnpm db:types` regenerated
  [`src/lib/db/database.types.ts`](../src/lib/db/database.types.ts) —
  `work_packages` Row/Insert/Update with FK relationship, and
  `work_package_status` enum
  (`["not_started","in_progress","on_hold","complete","pending_approval"]`)
  both present.
- **pgTAP** [`supabase/tests/database/08-work-packages.test.sql`](../supabase/tests/database/08-work-packages.test.sql)
  — 40 assertions covering:
  - Enum existence + exact labels (2).
  - Table shape — PK, every column's type, NOT NULL / NULL
    constraints, defaults (17).
  - Foreign key: `project_id` → `projects.id` (1).
  - Composite unique constraint on `(project_id, code)` (1).
  - `work_packages_set_updated_at` trigger exists (1).
  - RLS enabled (1).
  - Policy-cmd enumeration: exactly SELECT/INSERT/UPDATE — **no
    DELETE policy** (1).
  - Authenticated-context simulation (`set local role authenticated`
    - JWT claims + `_tap_buf` grants, pattern from
      [`06-users-rls.test.sql`](../supabase/tests/database/06-users-rls.test.sql)
      / [`07-projects.test.sql`](../supabase/tests/database/07-projects.test.sql)):
    * **INSERT:** super_admin + project_manager succeed (2);
      site_admin + visitor denied with SQLSTATE 42501 (2).
    * **Composite-unique behavior:** as super_admin, insert
      `WP-UNQ-001` under project A (lives_ok); duplicate insert
      under project A is rejected with SQLSTATE 23505
      (unique_violation); same code under project B succeeds (3).
      This is the key behavioral assertion proving the constraint is
      `(project_id, code)`, not `code` alone.
    * **SELECT:** super_admin / site_admin / project_manager see
      rows (3); visitor sees zero rows (1).
    * **UPDATE:** project_manager + super_admin succeed (assert row
      value changed) (2); site_admin attempt is silently filtered by
      the USING clause — assert row value unchanged from previous
      super_admin update (1).
    * `set_updated_at` trigger fired during the project_manager /
      super_admin UPDATEs — assert `updated_at > '2020-01-01'`
      baseline (1).
    * super_admin DELETE has no effect (row remains) (1).
- Full pgTAP suite: **8 files, 104 assertions, all green**
  (previously 7 files / 64).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
  (21/21 vitest tests; 9 routes built — no app code changed).

### Decisions made

- **Migration timestamp `20260524010000`.** UTC clock here returned
  `20260523181452`, which would sort _before_ the previous
  `20260524000000_create_projects.sql`. Used a UTC-tomorrow timestamp
  to keep filename-as-history monotonic with today's calendar date
  (2026-05-24 in the operator's tz) and the previous migration's
  ordering. Same workaround applied in the projects unit.
- **Negative UPDATE test asserts state, not error.** When a USING
  clause excludes all rows for a role, the UPDATE returns silently
  with 0 rows affected — no SQLSTATE is raised. The site_admin
  negative test therefore asserts that the row's `name` is unchanged
  after the attempted UPDATE, mirroring the no-DELETE-policy pattern
  from [`07-projects.test.sql`](../supabase/tests/database/07-projects.test.sql).
  `throws_ok` is only useful for WITH CHECK violations on INSERT /
  UPDATE-of-visible-row, where Postgres does raise 42501.
- **`ON DELETE CASCADE` on `project_id`.** ADR 0013 forbids hard
  deletes of projects through the app path (no DELETE policy on
  `projects` either), so this CASCADE is a _defensive consistency
  default_ for the case where a project is hard-deleted at the
  service-role layer (migration / console). The application never
  invokes this path. Documented inline in the migration.
- **Explicit `project_id` index alongside the composite unique.**
  PostgreSQL's unique constraint creates an index on
  `(project_id, code)`, which is also usable for `project_id`-only
  lookups. Keeping the standalone `work_packages_project_id_idx` is
  belt-and-braces: if a future migration changes the unique
  constraint's column order or removes the constraint entirely, the
  FK-lookup index survives.
- **`pending_approval` in the enum, but no transitions.** The enum
  value is shipped now so the future photo-upload unit's transition
  code is a behavior change rather than a schema migration. This
  unit builds zero logic on status — including no triggers that
  branch on it.

### Deferred (tracked as future units)

- **CSV import script (PR B).** The next domain unit. Will land
  alongside its own ADR documenting the import contract (column
  mapping, conflict handling for re-imports, idempotency, audit
  trail). No dependency added in this unit; the importer brings its
  own.
- **Rich WP model (cost, progress, subcon, QA, tasks, equipment,
  risk).** Explicitly out of v1 per the locked design. The current
  five-column WP is sufficient for the photo → approval → PDF flow.
  Additional columns / child tables land as the features that need
  them ship — adding nullable columns / sibling tables to the
  existing `work_packages` is a forward-compatible change.
- **Photo-driven status transitions.** When a photo is uploaded
  against a WP, the photo-upload unit will transition status to
  `pending_approval`; the approval unit will transition to
  `complete`. None of that is built here.
- **`photo_logs` table.** Will reference `work_packages.id`. Future
  unit, same role-level RLS pattern per ADR 0013.

### Open questions

None blocking.

- **Should the SELECT policy gate on visibility to the WP's parent
  project?** In v1 it doesn't matter — role-level access means every
  privileged user sees every project too. When membership is
  introduced (per ADR 0013's upgrade path), the WP SELECT policy
  will tighten to require either super_admin **or** membership in
  `project_members` keyed on `work_packages.project_id`. The
  current policy shape is forward-compatible with that change.
- **Is `description` worth its own column vs. deferring until
  needed?** Kept because it's free (a nullable text column with no
  index), the CSV import is likely to carry per-WP free text, and
  removing it later is harder than declining to populate it.

---

## Unit: work_packages CSV import script (ADR 0014)

- **Status:** Complete — 2026-05-24.
- **Started / completed:** 2026-05-24.
- **Spec:** Provided inline by the operator. Locked design decisions
  → captured verbatim in
  [`docs/decisions/0014-wp-import-contract.md`](decisions/0014-wp-import-contract.md).
- **ADR:** [`docs/decisions/0014-wp-import-contract.md`](decisions/0014-wp-import-contract.md)
  — references ADR 0013 (the WP access model the importer
  deliberately bypasses via the admin client).
- **Branch:** `feat/wp-import-script`.

### Done

- **Dependency added:** `papaparse@^5.5.3` (runtime) +
  `@types/papaparse@^5.5.2` (dev). The approved single new
  dependency. Picked over a hand-rolled CSV parser because real WP
  CSVs will eventually carry quoted fields, embedded commas /
  newlines, and UTF-8 (Thai project names) — all four properties
  papaparse handles correctly.
- **Pure validator**
  [`src/lib/wp-import/parse.ts`](../src/lib/wp-import/parse.ts) —
  `parseAndValidate(csvText, existingCodes): { rows, errors }`. No
  I/O — no DB calls, no filesystem reads. The split between this
  module and the CLI script is the load-bearing reason every
  validation rule is testable from a crafted string.
- **CLI script** [`scripts/import-wp.ts`](../scripts/import-wp.ts) —
  thin I/O shell. Reads argv (project code + file path), opens the
  CSV with `node:fs.readFileSync`, builds a local service-role
  Supabase client (see "Decisions made" — `src/lib/db/admin.ts`
  cannot be reused), looks up the project by code, fetches the
  existing WP codes for that project, calls the pure validator,
  reports all errors at once on failure, and batch-inserts on
  success. `status` is intentionally omitted from the insert
  payload — every imported row gets the column default
  `not_started` (per ADR 0014).
- **pnpm script** `import:wp` added:
  `tsx --env-file=.env.local scripts/import-wp.ts`. Node 20.6+ and
  tsx 4+ are required (the repo runs Node 22+ / tsx 4.21 — confirmed
  via `pnpm exec tsx --version`). `.env.local` is loaded by Node's
  built-in env-file mechanism, passed through by tsx; no new dotenv
  dependency was added.
- **Operator-facing template**
  [`data/work-packages-template.csv`](../data/work-packages-template.csv) —
  the three headers `code,name,description` with two example rows
  (no real pilot data) — and
  [`data/README.md`](../data/README.md) with the UTF-8 requirement
  ("Excel: Save as → CSV UTF-8", "Sheets: File → Download → CSV"),
  the one-file-per-project rule, the run command, the fail-all
  semantics, and a link to ADR 0014.
- **Unit tests**
  [`tests/unit/wp-import-parse.test.ts`](../tests/unit/wp-import-parse.test.ts) —
  13 cases against the pure validator. No DB or filesystem touched;
  every test crafts a CSV string and an existing-codes Set inline.
  Coverage:
  - **Happy path (5):** two valid rows; blank description → NULL;
    missing description column entirely → NULL; surrounding
    whitespace trimmed; header-only file → empty rows / empty errors.
  - **Validation rules (5):** missing code → error with row number;
    missing name → error; in-file duplicate → error on the
    duplicate row; existing-code conflict → error; multiple errors
    across rows collected in one run, in row order.
  - **papaparse robustness (3):** unknown extra columns ignored
    (`cost`, `subcon`, `qa` carried over from a richer sheet);
    quoted fields with embedded commas parsed correctly; Thai
    characters in UTF-8 round-trip cleanly.
- **Smoke check.** `pnpm import:wp` with no args loads cleanly via
  tsx, prints the usage banner, exits 1. Confirms the path-alias
  resolution (`@/lib/...`) works under tsx and that the
  `--env-file=.env.local` flag passes through correctly. No real
  import was run against the DB in this unit (per spec).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all
  pass. Vitest count: 21 → **34** (six test files now); build
  output unchanged (9 routes — the importer is a script, not a
  route).

### Decisions made

- **Local service-role client, not `src/lib/db/admin.ts`.**
  `admin.ts` starts with `import "server-only"`, which throws at
  module load outside the Next bundler — a plain `tsx scripts/...`
  invocation would crash before reaching `main()`. The script
  therefore builds its own client from `@supabase/supabase-js` +
  `process.env.NEXT_PUBLIC_SUPABASE_URL` +
  `process.env.SUPABASE_SERVICE_ROLE_KEY`. Same reasoning rules out
  `src/lib/env.server.ts` (also `server-only`). The script is small
  enough that the duplication is fine; the alternative would be
  carving the admin client into a server-only-free core, which is
  out of scope and would weaken the Next-side guard for the sake
  of a single script.
- **`.env.local` loaded via `--env-file`, not via a dotenv
  package.** Node 20.6+ + tsx 4+ support this natively; the repo's
  Node 22 / tsx 4.21 satisfies the requirement. No new dependency
  was added for env loading. If a future tooling shift breaks the
  `--env-file` path, falling back to a ~10-line manual `.env.local`
  loader inside the script (no new dep) is the safe move — but it
  is not needed today.
- **Pure validator lives in `src/lib/wp-import/parse.ts`, not
  alongside the script.** `src/lib/...` is the conventional home
  for reusable pure logic in this repo; the path alias `@/*` makes
  it importable by both the script (via tsx) and the test suite
  (via vitest's matching alias) without per-file relative paths.
  Future surfaces — e.g. an in-app drag-and-drop CSV importer for
  the back-office UI — can reuse the exact same validator.
- **papaparse `TooManyFields` / `TooFewFields` warnings are
  ignored.** They fire on rows whose value count differs from the
  header column count. Extra columns are part of the contract
  ("unknown columns ignored"), and the per-field checks
  (blank/missing `code`, blank/missing `name`) catch the
  too-few-fields case as a meaningful row-level error. Other
  papaparse errors (e.g. quoting failures) ARE surfaced as
  validation errors with the row number.
- **Row numbering is over non-empty data rows, 1-based.** Row 1 =
  first non-empty row after the header. `skipEmptyLines: true`
  means blank rows in the source don't shift the count, which
  matches what the operator sees when scrolling through a typical
  CSV (blank rows are visually skipped). Mentioned in the
  function's doc-comment so future readers understand the mapping.

### Operator follow-up (post-merge)

The end-to-end import path could not be exercised in this session —
running it would write to the linked DB. After merge, the operator
runs the importer against a real WP file:

```
pnpm import:wp PRC-2026-001 ./data/lamsonthi-wps.csv
```

Expected outcomes:

1. **Happy path:** "Imported N work_package(s) into PRC-2026-001
   (TFG Lam Sonthi)." All rows visible in the DB; status
   `not_started` on every row.
2. **Bad row:** "Import failed — N validation error(s) in …",
   followed by per-row error lines, then "No rows inserted. Fix
   the file and re-run." DB unchanged.
3. **Wrong project code:** `No project with code "X".` exit 1.

### Deferred (tracked as future units)

- **Photo logs (next domain unit).** Needs its own design session
  to cover the supersede pattern (already established in
  `.claude/skills/supersede-pattern`), the approval model
  (`pending_approval` → `complete` transitions on WPs, who can
  approve, audit-log entries), and the watermark-on-demand storage
  pattern from ADR 0003.
- **Back-office UI for WP CRUD.** The long-term successor to this
  CLI importer. Will likely also handle ongoing edits of imported
  WPs — the in-app surface for the "no upsert / sync" gap ADR 0014
  leaves open.
- **Upsert / bulk re-sync.** Explicitly v2; will need its own ADR
  with diff semantics, deletion handling, and audit-log entries.

### Open questions

None blocking.

- **Should the importer also re-print the operator's effective
  project lookup before inserting?** Currently it prints the
  result only on success. A "Importing N rows into PRC-2026-001
  (TFG Lam Sonthi) — confirm with [y/N]" prompt is a future
  ergonomics tweak if the operator wants a safety net; out of
  scope here per "don't add features beyond what the task
  requires."
- **Should `import:wp` also log to `audit_log`?** Skipped for v1
  per scope. The audit_log table is in place (ADR 0004) and could
  carry an `import` action; the right time to wire it is when the
  back-office UI lands and the full event surface is being
  designed end-to-end.

---

## Unit: Feature spec 02 — photos and approvals (docs-only)

- **Status:** Complete — 2026-05-24.
- **Started / completed:** 2026-05-24.
- **Spec written, no schema, no code.** Captures the locked design
  for the `photo_logs` and `approvals` tables so the build units
  that follow are mechanical.
- **Spec:** [`docs/feature-specs/02-photos-and-approvals.md`](feature-specs/02-photos-and-approvals.md).
- **Branch:** `docs/02-photos-and-approvals-spec`.

### Done

- New feature spec written, matching the structure of
  [`docs/feature-specs/01-line-auth.md`](feature-specs/01-line-auth.md)
  (Status → Goal → Locked design decisions → table specs → build
  plan → deferred / out of scope → references).
- All decisions from the design session captured:
  - **Grain and relationships** — one `photo_logs` row = one
    photo; FK to `work_packages`; `phase` enum (before / during /
    after) with multiple photos per phase allowed; approval is
    per-WP (not per-photo, not per-phase); WP reviewability is
    derived from "After photos exist," not stored.
  - **Photo storage** — `photo_logs` stores only `storage_path`,
    never image bytes; the Storage bucket itself is a separate
    later unit; originals stored unmodified, watermark rendered
    on-demand server-side.
  - **Append-only + tombstone-supersede** (the key architectural
    decision; ADR 0015 reserved for the build PR): triple-enforced
    exactly like `audit_log`; removal uses a tombstone (a
    superseding row with `storage_path IS NULL`); replacement =
    tombstone + new insert; current-state = ADR 0009 anti-join
    filtered to `storage_path IS NOT NULL`.
  - **`photo_logs` columns + RLS** — full column list with notes,
    triple-enforcement, INSERT for SA / PM / super, SELECT for the
    same set, no UPDATE / no DELETE policies. Tombstone row shape
    documented for clarity.
  - **`approvals` columns + RLS** — append-only event log (NOT
    supersede; "current decision" is the row with `max(decided_at)`
    per WP); CHECK constraint requiring a non-blank `comment` on
    `rejected` / `needs_revision`; INSERT for PM + super only (SA
    explicitly cannot approve); SELECT for SA + PM + super.
  - **Self-approval allowed in v1.** Separation-of-duties documented
    as an explicit future concern, not built.
  - **Build plan** — PR 1 (photo_logs + ADR 0015) first, PR 2
    (approvals) after. PR-shape detail covers migration columns,
    triple-enforcement layers, pgTAP assertion list (mirroring
    07 / 08), types regen, skill update.
  - **Deferred** — Supabase Storage bucket + signed URLs, watermark
    rendering, SA upload UI, `work_packages.status` auto-transition
    on first After photo, PM approval UI, PDF generation,
    separation-of-duties guard, all rich-photo metadata.
- `pnpm lint && pnpm typecheck && pnpm test` all pass (docs-only,
  nothing should be affected — confirmed).

### Decisions made

- **ADR 0015 is reserved for the PR 1 build unit, not written
  here.** Same pattern previous build units used (ADR 0010 written
  in the schema-prep PR; ADR 0011 written in the recursion-fix PR;
  ADR 0013 written in the projects-table PR). Writing the ADR in
  the build PR keeps the rationale close to the code that
  implements it, and avoids drift between the ADR and the migration
  if anything moves during the build.
- **`approvals` may or may not get its own ADR.** Folded into the
  build PR's description by default; flagged as worth a short ADR
  only if the CHECK-constraint contract or the SA-cannot-approve
  split surface anything material during the build. Spec records
  the call as "PR-time judgment," not pre-locked.
- **No CHECK constraint on `photo_logs` row shape pre-locked.** The
  obvious candidate is "real photos cannot themselves carry a
  `superseded_by`" (`storage_path IS NOT NULL AND superseded_by IS
NOT NULL` → reject). Discussed in the spec but left to the build
  PR to decide — the runtime cost is trivial, but it's a constraint
  worth justifying in the ADR rather than retrofitting later.
- **Indexing detail.** Partial index on `superseded_by WHERE
superseded_by IS NOT NULL` is locked (required by ADR 0009).
  `work_package_id` index is locked. The composite WP/phase index
  is not pre-locked — the build PR measures and decides.

### Next build unit

**PR 1 — `photo_logs` + ADR 0015.** Schema + triple-enforcement +
tombstone-supersede + pgTAP + types regen + skill update. Branch
name proposed in the spec is `feat/photo-logs-table` — finalized
when the PR is opened.

### Open questions

None blocking.

- **Index sizing.** The composite `(work_package_id, phase)` (or
  `(work_package_id, phase, created_at)`) index for `photo_logs` is
  left to the build PR to measure. The read-path for the upload UI
  is "list current photos for WP X, grouped by phase" — the right
  index is whatever makes that one query a sub-millisecond hit.
- **`uploaded_by` / `decided_by` FK target.** The spec records
  these as "likely FK → `public.users(id)`." The choice between
  `public.users(id)` and `auth.users(id)` is a build-PR detail —
  `public.users(id)` is the conventional choice for app-layer
  audit columns (`audit_log.actor_id` uses `auth.users(id)` because
  it's a system-level table) and aligns with how `decided_by`
  needs to participate in role checks via `current_user_role()`.

---

## Unit: photo_logs table — tombstone-supersede append-only (ADR 0015)

- **Status:** Complete — 2026-05-24.
- **Started / completed:** 2026-05-24.
- **Spec:** [`docs/feature-specs/02-photos-and-approvals.md`](feature-specs/02-photos-and-approvals.md)
  PR 1 section. The locked design (one row = one photo;
  triple-enforced append-only like `audit_log`; tombstone-supersede
  for removal; ADR 0009 anti-join + tombstone filter for current
  state; role-level RLS via `current_user_role()`) is implemented
  exactly as written, plus the well-formedness CHECK that the spec
  left to the build PR.
- **ADR:** [`docs/decisions/0015-photo-logs-tombstone-supersede.md`](decisions/0015-photo-logs-tombstone-supersede.md)
  — extends ADR 0004 (append-only / supersede write pattern) and
  ADR 0009 (anti-join read pattern). Inherits ADR 0013 (role-level
  access) and ADR 0011 (role helper).
- **Branch:** `feat/photo-logs-table`.

### Done

- **ADR 0015 written.** Documents the tombstone-supersede mechanism
  (removal = INSERT a tombstone with `storage_path NULL` and
  `superseded_by` set; replacement = tombstone + new INSERT = two
  appends), the well-formedness CHECK
  `((storage_path is null) = (superseded_by is not null))` and why
  the two malformed combinations are rejected, the
  anti-join + `storage_path IS NOT NULL` current-state read with a
  worked example (two photos uploaded, one tombstoned, query
  returns only the surviving photo), the triple-enforcement layers
  unchanged from ADR 0004, the inherited ADR 0013 role-level access,
  and the explicit transaction note for app code doing a
  "replacement" (two INSERTs are not atomic by default — wrap in a
  transaction if both must commit together). Cross-links ADRs 0004,
  0009, 0011, 0013, and feature spec 02.
- **Migration**
  [`supabase/migrations/20260524020000_create_photo_logs.sql`](../supabase/migrations/20260524020000_create_photo_logs.sql)
  applied via `pnpm db:push`. Creates:
  - `public.photo_phase` enum: `before`, `during`, `after`.
  - `public.photo_logs` table with columns
    `id uuid pk default gen_random_uuid()`,
    `work_package_id uuid not null references work_packages(id)
on delete cascade`,
    `phase photo_phase not null`,
    `storage_path text` (nullable — NULL = tombstone),
    `superseded_by uuid references photo_logs(id)` (nullable),
    `uploaded_by uuid not null references public.users(id)`,
    `created_at timestamptz not null default now()` (server-authoritative),
    `captured_at_client timestamptz` (UNTRUSTED device time),
    and the
    `photo_logs_path_supersede_well_formed`
    CHECK invariant from ADR 0015.
  - Partial index
    `photo_logs_superseded_by_idx ON (superseded_by) WHERE
superseded_by IS NOT NULL` (ADR 0009 anti-join requirement).
  - Index `photo_logs_work_package_id_idx ON (work_package_id)` for
    the standard "list photos for WP X" scope.
  - **Triple-enforcement** mirroring audit_log
    (`20260505143800_create_audit_log.sql`): - **Layer 1 (privilege):** `REVOKE ALL FROM authenticated,
anon; GRANT INSERT, SELECT TO authenticated`. Exact REVOKE
    target matches audit_log's. - **Layer 2 (RLS):** INSERT + SELECT policies only — no UPDATE
    policy, no DELETE policy. Both policies gate on
    `current_user_role() IN ('site_admin', 'project_manager',
'super_admin')` (ADR 0011 helper — never self-joins
    `public.users`). - **Layer 3 (trigger):** new function
    `public.photo_logs_block_write()` raises `P0001` with message
    `"photo_logs is append-only"`; bound to
    `BEFORE UPDATE` and `BEFORE DELETE` triggers on
    `photo_logs`. Same shape as `audit_log_block_write()`;
    defined as a separate function because the existing one
    hard-codes the audit_log message — not generic enough to
    reuse without changing audit_log's behavior, which the
    protect-audit-log hook forbids and CLAUDE.md immutability
    rules forbid anyway.
- **Types regen** via `pnpm db:types`. `database.types.ts` now
  exposes `photo_logs` Row/Insert/Update with relationships
  (`work_package_id` → `work_packages.id`, `superseded_by` → self,
  `uploaded_by` → `users.id`) and the `photo_phase` enum
  (`["before", "during", "after"]`).
- **pgTAP** [`supabase/tests/database/09-photo-logs.test.sql`](../supabase/tests/database/09-photo-logs.test.sql)
  — **48 assertions**, all green:
  - **Catalog (26):** enum existence + labels; table existence; PK
    - every column type / NOT NULL or NULL constraints + the `id`
      default; three FKs (`work_package_id` → `work_packages.id`,
      `superseded_by` → `photo_logs.id`, `uploaded_by` →
      `public.users.id`); CHECK constraint existence by name; both
      indexes existence by name.
  - **RLS config (2):** RLS enabled; policy-cmd set is exactly
    `{INSERT, SELECT}` — no UPDATE policy, no DELETE policy
    (load-bearing).
  - **REVOKE privileges (2):** authenticated lacks UPDATE; lacks
    DELETE.
  - **Trigger as last line of defense (2):** insert a fixture row
    as postgres (bypasses REVOKE + RLS), then assert UPDATE raises
    `P0001`/"photo_logs is append-only" and DELETE raises the same.
    Mirrors the audit_log immutability test exactly.
  - **CHECK constraint behavioral (4):** real photo
    (`storage_path` set, `superseded_by` NULL) lives; tombstone
    (`storage_path` NULL, `superseded_by` set) lives; both-NULL
    rejected with `23514`; both-set rejected with `23514`.
  - **Tombstone + anti-join current-state (2):** insert two real
    photos for an isolated WP/phase, then a tombstone superseding
    one. The anti-join + `storage_path IS NOT NULL` query returns
    exactly the surviving real photo (count = 1; id matches the
    un-tombstoned one — not the tombstoned photo, not the
    tombstone row itself). The worked example in ADR 0015 is the
    exact scenario this test encodes.
  - **RLS INSERT role gating (4):** super_admin / site_admin /
    project_manager succeed; visitor denied with `42501`.
  - **RLS SELECT visibility (4):** super_admin / site_admin /
    project_manager see rows; visitor sees zero.
  - **Phase enum + FK rejection (2):** invalid enum value
    rejected (`22P02`); non-existent `work_package_id` rejected
    (`23503`).
  - Setup uses the same authenticated-context simulation
    established in 06/07/08 (`set local role authenticated` +
    `set local "request.jwt.claims"` + the `_tap_buf` grants).
- Full pgTAP suite: **9 files, 152 assertions, all green**
  (previously 8 files / 104 assertions; this PR adds 1 file and
  48 assertions).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all
  pass (34/34 vitest tests; 9 routes built — no app code changed).

### Decisions made

- **CHECK constraint
  `((storage_path is null) = (superseded_by is not null))`
  added.** The spec left this to the build PR. The constraint
  forecloses both malformed combinations: a row with both NULL
  (neither photo nor tombstone — no application use) and a row
  with both set (real photo carrying a `superseded_by`, which
  would let a single row serve two roles and undermine the
  either-or the anti-join + tombstone filter relies on). Cost is
  one biexpression evaluated at INSERT; benefit is that the read
  pattern can trust that every row matches one of two shapes
  without defensive checks. Documented in ADR 0015 as the
  load-bearing well-formedness invariant.
- **Separate `photo_logs_block_write()` function, not reuse of
  `audit_log_block_write()`.** The existing function raises with
  the literal message `"audit_log is append-only"`. Reusing it
  on `photo_logs` would either misidentify the table in the
  error or require generalising the audit_log function to read
  `TG_TABLE_NAME`. That generalisation is a change to audit_log
  — blocked by `.claude/hooks/protect-audit-log.js` and by the
  CLAUDE.md immutability rule for `audit_log`. Defining a
  separate `photo_logs_block_write()` is the strictly-in-scope
  fix; the cost is one extra function definition; the benefit is
  audit_log's enforcement code stays untouched and the
  photo_logs error message correctly names the table.
- **Migration timestamp `20260524020000`.** Monotonic after the
  previous migration (`20260524010000_create_work_packages.sql`)
  per the same convention the projects and work_packages units
  used (calendar-day prefix `20260524` plus a within-day suffix).
- **No composite `(work_package_id, phase)` index in this PR.**
  The spec listed it as "build PR measures and decides." The
  current `work_package_id` index already covers WP-scoped
  reads; without a real consumer of the upload UI yet, there is
  no real query plan to measure against. Surfaced below as a
  follow-up that the photo-upload unit picks up.
- **`uploaded_by uuid not null references public.users(id)`.**
  Per spec note: `public.users(id)` is the conventional choice
  for app-layer audit columns. Not nullable because every
  upload AND every tombstone is performed by a known
  authenticated user — there is no anonymous write path.
- **`captured_at_client` is nullable, `created_at` is
  server-authoritative.** Per the locked design: device times
  may be wrong / time-shifted / spoofed; the schema records
  them and the application labels them as "device reported"
  wherever displayed. `created_at` (`default now()`) is the
  canonical event time for ordering, audit, and any
  "most-recent-decision-wins" rule.

### Follow-ups (deferred — surfaced for the next units)

- **`.claude/skills/supersede-pattern/SKILL.md` does not yet
  teach the tombstone variant.** The skill currently frames
  supersede as replacement-only. It must be extended to teach
  the tombstone shape, the `storage_path IS NULL` sentinel, the
  `WHERE storage_path IS NOT NULL` filter on current-state
  queries, and the well-formedness CHECK. **Not done in this
  PR** — deferred so the skill update lands alongside the first
  real consumer (the photo-upload UI unit), where the change
  can be reviewed against actual query/UI code rather than in
  the abstract.
- **Supabase Storage bucket.** `photo_logs.storage_path` is
  currently just text — references to paths that the Storage
  unit will make real. That unit ships the bucket policy, the
  signed-upload-URL minting endpoint, and storage-side RLS.
- **Composite `(work_package_id, phase)` index.** Add when the
  upload UI surfaces and the "list current photos for WP X,
  grouped by phase" hot path is real. Measure first; the
  partial-superseded_by + work_package_id indexes already in
  place may be sufficient.
- **Approvals table (PR 2 of feature spec 02).** The next
  domain unit. Will reference `work_packages.id` and follow the
  same role-level RLS pattern. CHECK constraint requiring a
  non-blank comment on `rejected` / `needs_revision`; INSERT
  for PM + super only (SA explicitly cannot approve); SELECT
  for SA + PM + super. Spec section already locks the design.
- **`work_packages.status` auto-transition on first After
  photo.** Belongs to the photo-upload UI unit, not this one.
  The enum value `'pending_approval'` is in place from the
  work_packages migration; only the trigger/behavior is
  deferred.

### Operator follow-up (post-merge)

This is a schema-only unit; nothing user-visible changes. The
operator's smoke check is purely DB:

1. `pnpm db:test` green (9 files, 152 assertions).
2. `select * from pg_policies where tablename = 'photo_logs'`
   shows exactly INSERT + SELECT policies (no UPDATE, no
   DELETE).
3. `select pg_get_triggerdef(oid) from pg_trigger where tgname
in ('photo_logs_block_update', 'photo_logs_block_delete')`
   shows both triggers bound to
   `public.photo_logs_block_write()`.

### Open questions

None blocking.

- **Should `photo_logs` carry an `audit_log` entry on each
  tombstone?** Probably yes — the supersede event is exactly
  the kind of write the audit_log is for. Out of scope here
  (the photo-upload UI is the right surface to wire it from,
  and `audit_action` already has the `photo_supersede`
  enum value). Tracked here so the photo-upload unit picks it
  up.
- **Should the trigger raise `42501` instead of `P0001`?**
  audit_log uses `P0001` with a custom message; this PR
  mirrors that exactly so the two append-only tables emit
  recognisably identical errors. If a future unit decides
  `42501` (insufficient_privilege) is the more honest error
  code for "this table refuses your write", both tables
  should change together.

---

## Unit: approvals table — append-only decision event log

- **Status:** Complete — 2026-05-24.
- **Started / completed:** 2026-05-24.
- **Spec:** [`docs/feature-specs/02-photos-and-approvals.md`](feature-specs/02-photos-and-approvals.md)
  PR 2 section. Implements the locked design exactly: one row =
  one decision event; pure chronological log (not supersede);
  current decision per WP = `max(decided_at)`; triple-enforced
  append-only like `audit_log` / `photo_logs`; INSERT restricted
  to PM + super_admin (SA explicitly cannot approve); SELECT for
  SA + PM + super_admin (SA reads `needs_revision` comments on
  WPs they uploaded to); comment required AND non-blank when
  decision is `rejected` or `needs_revision`.
- **ADR:** None. Spec 02 left this as optional; the approvals
  design is a conventional append-only event log (no novel
  decisions like photo_logs' tombstone) so the rationale lives
  in the migration SQL comments and this tracker entry. If
  separation-of-duties or current-decision-derivation is ever
  re-litigated, that's the right time to write one.
- **Branch:** `feat/approvals-table`.

### Done

- **Migration**
  [`supabase/migrations/20260524030000_create_approvals.sql`](../supabase/migrations/20260524030000_create_approvals.sql)
  applied via `pnpm db:push`. Creates:
  - `public.approval_decision` enum:
    `approved, rejected, needs_revision`.
  - `public.approvals` table:
    `id uuid pk default gen_random_uuid()`,
    `work_package_id uuid not null references work_packages(id)
on delete cascade`,
    `decision approval_decision not null`,
    `comment text` (nullable at column level; constrained by
    the CHECK below),
    `decided_by uuid not null references public.users(id)`,
    `decided_at timestamptz not null default now()`
    (server-authoritative — the canonical ordering key for
    "latest decision per WP").
  - **CHECK constraint
    `approvals_comment_required_when_negative`:**
    `decision = 'approved' OR (comment IS NOT NULL AND
length(trim(comment)) > 0)`. The `length(trim(comment)) > 0`
    half is load-bearing — it rejects whitespace-only comments
    on `rejected` / `needs_revision`, not just NULL. Future
    application code can trust the DB to reject blank-comment
    negatives without a parallel validation layer.
  - **Composite index** `(work_package_id, decided_at DESC)`.
    Serves both hot reads — "latest decision for WP X" (index
    seek + first entry) and "history for WP X" (range scan,
    pre-sorted) — without a sort step. A plain `work_package_id`
    index would also work; the composite was chosen because the
    extra column costs essentially nothing (one row per decision)
    and exactly matches the access pattern.
  - **Triple-enforcement** mirroring photo_logs
    (`20260524020000_create_photo_logs.sql`): - **Layer 1 (privilege):** `REVOKE ALL FROM authenticated,
anon; GRANT INSERT, SELECT TO authenticated`. Exact same
    REVOKE targets as photo_logs. - **Layer 2 (RLS):** INSERT + SELECT policies only — no
    UPDATE policy, no DELETE policy. Policies gate on
    `public.current_user_role()` (ADR 0011 helper): - INSERT: `current_user_role() IN ('project_manager',
'super_admin')` — `site_admin` CANNOT approve. This is the
    load-bearing access difference from `photo_logs`, where
    SA can upload. - SELECT: `current_user_role() IN ('site_admin',
'project_manager', 'super_admin')` — SA is in the read set
    so they can see `needs_revision` comments on WPs they
    uploaded to. - **Layer 3 (trigger):** new function
    `public.approvals_block_write()` raises `P0001` with
    message `"approvals is append-only"`; bound to
    `BEFORE UPDATE` and `BEFORE DELETE` triggers on
    `approvals`. Same shape as
    `photo_logs_block_write()` / `audit_log_block_write()`;
    defined as a separate function so the error correctly
    names the offending table.
- **Types regen** via `pnpm db:types`. `database.types.ts` now
  exposes `approvals` Row/Insert/Update with relationships
  (`work_package_id` → `work_packages.id`, `decided_by` →
  `users.id`) and the `approval_decision` enum
  (`["approved", "rejected", "needs_revision"]`).
- **pgTAP** [`supabase/tests/database/10-approvals.test.sql`](../supabase/tests/database/10-approvals.test.sql)
  — **45 assertions**, all green:
  - **Catalog (20):** enum existence + labels; table existence;
    PK + every column type / NOT NULL or NULL constraints + the
    `id` default; two FKs (`work_package_id` →
    `work_packages.id`, `decided_by` → `public.users.id`);
    CHECK constraint existence by name; composite index
    existence by name.
  - **RLS config (2):** RLS enabled; policy-cmd set is exactly
    `{INSERT, SELECT}` — no UPDATE policy, no DELETE policy.
  - **REVOKE privileges (2):** authenticated lacks UPDATE;
    lacks DELETE.
  - **Trigger as last line of defense (2):** insert a fixture
    row as postgres (bypasses REVOKE + RLS), then assert UPDATE
    raises `P0001`/"approvals is append-only" and DELETE raises
    the same. Mirrors the photo_logs immutability test exactly.
  - **Comment CHECK behavioral (7):** approved + NULL comment
    lives; approved + non-blank comment lives; rejected +
    non-blank comment lives; needs_revision + non-blank comment
    lives; rejected + NULL rejected with `23514`;
    needs_revision + NULL rejected; **rejected +
    whitespace-only comment rejected** (load-bearing — proves
    the `length(trim(…)) > 0` half is enforced, not just a
    NULL check).
  - **RLS INSERT role gating (4):** project_manager and
    super_admin succeed; **site_admin denied with `42501`**
    (load-bearing — SA cannot approve); visitor denied.
  - **RLS SELECT visibility (4):** super_admin / site_admin /
    project_manager see rows; visitor sees zero. The
    site_admin assertion is load-bearing for the
    needs_revision flow (SA reads the comment to know what to
    re-upload).
  - **History model (2):** isolated WP with two explicit
    `decided_at` timestamps (`now()` is frozen at
    `transaction_timestamp()` within the test transaction so
    explicit values are needed to disambiguate "latest").
    Insert `needs_revision` then `approved`; assert both rows
    persist (append-only event log, nothing is overwritten);
    assert `order by decided_at desc limit 1` returns the
    approved row (pins the current-decision query shape for
    the future PDF unit).
  - **Enum + FK rejection (2):** invalid enum value rejected
    (`22P02`); non-existent `work_package_id` rejected
    (`23503`).
  - Same authenticated-context simulation pattern as 06–09
    (`set local role authenticated` + `set local
"request.jwt.claims"` + the `_tap_buf` grants).
- Full pgTAP suite: **10 files, 197 assertions, all green**
  (previously 9 files / 152 assertions; this PR adds 1 file
  and 45 assertions).
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all
  pass (34/34 vitest tests; 9 routes built — no app code
  changed).

### Decisions made

- **No new ADR.** Spec 02 left this as optional; the design
  here is a conventional append-only event log without any
  novel mechanic on the level of photo_logs' tombstone. The
  rationale (event-log not supersede; current = latest by
  decided_at; comment-present-and-non-blank CHECK; SA in the
  read set but not the write set) is captured in the
  migration's SQL comment block and in this tracker entry. If
  separation-of-duties is ever lifted out of v1, that decision
  warrants its own ADR.
- **Composite `(work_package_id, decided_at DESC)` index, not
  plain `(work_package_id)`.** Both serve the access patterns;
  the composite removes the sort step from the "latest
  decision for WP X" hot path that the eventual PDF generator
  will run on every WP. Storage cost is negligible (one
  composite entry per decision, and decisions are sparse — at
  most a small handful per WP). If profile data later shows a
  plain index is enough, the composite can be replaced with
  zero application impact.
- **`comment` is nullable at the column level even though
  negative decisions require it.** The CHECK constraint
  encodes "required when negative"; a NOT NULL column would
  force `approved` rows to carry a non-meaningful empty
  string. The CHECK is the load-bearing rule; the column
  nullability is incidental.
- **`length(trim(comment)) > 0`, not just `comment IS NOT
NULL`.** The spec called out "required = present AND
  non-whitespace" explicitly. A NULL check alone would let
  `'   '` slip through. The trim-then-length form rejects
  empty strings, all-space strings, tabs, and newlines via
  one expression. The cost is one function call per INSERT —
  free at any realistic decision rate.
- **Separate `approvals_block_write()` function, not reuse of
  `audit_log_block_write()` or `photo_logs_block_write()`.**
  Same reasoning as for photo_logs: the existing functions
  hard-code their table name in the error message, so reuse
  would either misidentify the table or require generalising
  one of them. Three small near-identical functions is the
  strictly-in-scope choice; if a fourth append-only table
  ever ships, that's the time to refactor into a generic
  `raise_append_only(table_name text)`.
- **Migration timestamp `20260524030000`.** Monotonic after
  `20260524020000_create_photo_logs.sql` per the convention
  the prior units established (calendar-day prefix
  `20260524` plus a within-day suffix).

### v1 deferral (documented, not enforced)

- **Self-approval is acceptable in v1.** A
  `project_manager` who uploaded photos to a WP can still
  record an approval on that same WP. The team is small and
  trusted; adding a separation-of-duties guard would require
  either a tracking column on approvals or an EXISTS
  subquery against `photo_logs` in the INSERT policy. Both
  out of v1 scope per spec 02. The trigger to revisit is the
  appearance of any external / non-team account that could
  approve their own work — same trigger as the ADR 0013
  membership upgrade.

### Photos + approvals pair — overall status

[Feature spec 02](feature-specs/02-photos-and-approvals.md)
ships in two PRs: PR 1
([photo_logs + ADR 0015](decisions/0015-photo-logs-tombstone-supersede.md))
and PR 2 (this unit). **Both are complete.** The schema for
the photo → approval → PDF flow is now in place. What remains
to ship before PDFs can be generated:

- **Supabase Storage bucket + signed upload URLs.** The next
  unit. Makes `photo_logs.storage_path` reference real
  objects, and ships the upload-URL minting endpoint plus
  storage-side RLS.
- **SA upload UI** (the PWA Before / During / After surface
  that creates `photo_logs` rows).
- **Photo-driven WP status transition.** When the first
  After photo lands on a WP, `work_packages.status` →
  `pending_approval`. The enum value is already in place
  (work_packages migration); only the transition trigger /
  application logic is deferred.
- **PM approval UI** (the surface that produces
  `approvals` rows).
- **Watermark-on-demand rendering.** Originals stored
  unmodified; watermark rendered server-side at view /
  export time. ADR 0003 is the foundational doc; the
  rendering pipeline is its own unit.
- **PDF generation.** Filters on the latest
  `approvals.decision = 'approved'` per WP — the query
  shape pinned by this unit's history-model pgTAP
  assertion.

### Still-deferred follow-ups (carried forward from PR 1)

- **`.claude/skills/supersede-pattern/SKILL.md` tombstone
  update.** Still deferred; the skill change should land
  alongside the first real consumer (the photo-upload UI
  unit) so it can be reviewed against actual query/UI code
  rather than in the abstract.

### Operator follow-up (post-merge)

Schema-only unit; no user-visible behavior changes. Smoke
check is purely DB:

1. `pnpm db:test` green (10 files, 197 assertions).
2. `select * from pg_policies where tablename = 'approvals'`
   shows exactly INSERT + SELECT policies (no UPDATE, no
   DELETE).
3. `select pg_get_triggerdef(oid) from pg_trigger
where tgname in ('approvals_block_update',
'approvals_block_delete')` shows both triggers bound to
   `public.approvals_block_write()`.

### Open questions

None blocking.

- **Self-approval guard.** Tracked above as a v1 deferral.
  The schema is forward-compatible — adding an EXISTS
  subquery to the INSERT policy is a one-line policy
  tightening with zero application impact.
- **`audit_log` write on each decision.** Same question as
  for `photo_logs` tombstones: the decision event is exactly
  what the audit_log is for, and `audit_action` already
  carries `approve` / `reject` enum values. Right place to
  wire this is the approval UI unit, when the full event
  surface is being designed end-to-end. Not built here.

---

## Unit: photos Storage bucket — private, role-gated uploads

- **Status:** Complete — 2026-05-24.
- **Started / completed:** 2026-05-24.
- **Spec:** Provided inline by the operator; locked design from a
  design session. No new feature-spec file — the storage half is
  already documented under "Deferred / out of scope" in
  [`docs/feature-specs/02-photos-and-approvals.md`](feature-specs/02-photos-and-approvals.md)
  and this unit ships it.
- **ADR:** None. Conventional Supabase Storage setup; no novel
  design decisions worth their own ADR.
- **Branch:** `feat/storage-bucket`.

### Done

- **Migration**
  [`supabase/migrations/20260524040000_create_photos_bucket.sql`](../supabase/migrations/20260524040000_create_photos_bucket.sql)
  applied via `pnpm db:push`. Creates:
  - **`photos` bucket row** in `storage.buckets`: - `id = 'photos'`, `name = 'photos'`, `public = false`
    (private). - `file_size_limit = 26214400` (25 MiB) — comfortable for
    modern phone JPEGs / HEIC originals. - `allowed_mime_types = {image/jpeg, image/png, image/webp,
image/heic}` — the four image formats v1 needs. - `type` defaulted to `STANDARD` (the Supabase
    `storage.buckettype` enum value used for normal buckets). - INSERT uses `ON CONFLICT (id) DO NOTHING` so re-running
    the migration is a no-op. Reconfiguration in the future
    ships as its own explicit ALTER / UPDATE migration.
  - **Upload policy** on `storage.objects`,
    `"photos uploads by sa/pm/super"`: - `for insert`, `to authenticated` — does not apply to
    `anon` (no upload right) or `service_role` (bypasses RLS
    by design). - `with check (bucket_id = 'photos' and
public.current_user_role() in ('site_admin', 'project_manager',
'super_admin'))` — same role set as `photo_logs` INSERT,
    since the three privileged roles upload AND tombstone.
  - **No SELECT policy** on `storage.objects` for this bucket.
    Reads will be served via signed URLs minted by the service
    role (which bypasses Storage RLS) in the upload UI unit;
    the absence of a read policy keeps every read going
    through that application path.
  - **No UPDATE / no DELETE policies** on `storage.objects`.
    Append-only posture matching `photo_logs`. Tombstoned
    objects are LEFT in place for v1 — `photo_logs` tombstone
    rows are the source of truth for visibility; orphaned
    objects are a v2 cleanup concern.
- **Bucket row + policy verified** via direct SELECT against
  the linked DB (recorded in commit history of this session,
  not persisted as scripts):
  - `select * from storage.buckets where id = 'photos'`
    returns one row with the expected configuration.
  - `select policyname, cmd, roles, with_check from
pg_policies where schemaname = 'storage' and tablename =
'objects'` returns one row,
    `"photos uploads by sa/pm/super" INSERT {authenticated}`
    with the expected check expression.
- **Catalog-only pgTAP** at
  [`supabase/tests/database/11-photos-bucket.test.sql`](../supabase/tests/database/11-photos-bucket.test.sql)
  — **5 assertions**, all green:
  1. Bucket row exists with `id = 'photos'`.
  2. Bucket is private (`public = false`) — load-bearing.
  3. `file_size_limit = 26214400` (25 MiB).
  4. `allowed_mime_types` equals the exact 4-MIME array.
  5. INSERT policy `"photos uploads by sa/pm/super"` exists on
     `storage.objects` for the `authenticated` role.
     No auth-context simulation; behavioral RLS proof against
     `storage.objects` is deferred to the upload UI unit (which
     will exercise the policy through a real authenticated
     upload).
- Full pgTAP suite: **11 files, 202 assertions, all green**
  (previously 10 files / 197 assertions; this PR adds 1 file
  and 5 assertions).
- `pnpm db:types` regenerated — diff was purely cosmetic
  (Supabase CLI's emitter stripped semicolons; the
  `lint-staged` Prettier hook normalises them back on commit).
  No semantic change — Supabase CLI types the `public` schema
  only, so `storage.buckets` / `storage.objects` do not appear
  in the generated types. The Supabase JS client reaches the
  Storage API through `supabase.storage`, which has its own
  separate type surface.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all
  pass (34/34 vitest tests; 9 routes built — no app code
  changed).

### Decisions made

- **`public.current_user_role()` worked inside a
  `storage.objects` policy.** Verified: the policy applies and
  the helper resolves correctly when called from this context.
  The function is `SECURITY DEFINER` + STABLE + `search_path =
public`, so calling it from the storage schema is safe and
  does not introduce a new recursion vector — `storage.objects`
  RLS does not read `public.users`, and the helper reads
  `public.users` with RLS bypassed. The function is fully
  qualified in the policy expression to avoid any
  search-path ambiguity.
- **`to authenticated` clause on the policy.** The idiomatic
  Supabase storage-policy form. Confines the policy to the
  authenticated role; `anon` has no upload right and
  `service_role` bypasses Storage RLS by design — neither
  needs the policy to apply.
- **25 MiB file size limit (`26214400` bytes).** Modern phone
  JPEGs are typically 3–8 MB; HEIC originals can run larger
  (10–20 MB). 25 MiB is comfortable headroom without inviting
  casual abuse. Trivially raisable later via an ALTER
  migration if construction-quality cameras turn out to
  produce larger originals in practice.
- **Bucket configuration via user migration, not Dashboard.**
  Supabase managed instances grant the migration runner
  (`postgres` role) sufficient privilege to INSERT into
  `storage.buckets` and CREATE POLICY on `storage.objects`.
  `pnpm db:push` applied cleanly. Keeping the configuration in
  the migration file means the bucket definition is part of
  schema history — reproducible, reviewable, version-pinned.
- **`ON CONFLICT (id) DO NOTHING`**, not `DO UPDATE`. A `DO
UPDATE` form would silently overwrite a hand-applied bucket
  config (e.g. an emergency change made via the Dashboard);
  `DO NOTHING` preserves whatever the current bucket state is
  if re-applied. Future intentional reconfiguration ships as
  its own explicit migration.
- **Catalog-only pgTAP, no behavioral test.** The existing
  pgTAP harness simulates `public.users` auth context via
  `set local role authenticated` + `set local
"request.jwt.claims"`. Reaching the same level of
  simulation against `storage.objects` would need a real
  upload via the Storage API, which is out of scope here
  and naturally lands in the upload UI unit's test plan.
  Catalog-level guards (bucket row exists, policy exists with
  the right cmd + role) are still worth ~80% of the value
  with ~5% of the effort and zero added test infrastructure.
- **No `storage.objects` SELECT policy.** Read access will be
  served via signed URLs minted by the service role in the
  upload UI unit. The service role bypasses Storage RLS, so
  granting `authenticated` a broad SELECT here would be
  meaningless overlap at best and a leak at worst (signed
  URLs are the chosen auth mechanism; an RLS read carve-out
  would let any authenticated user enumerate objects through
  the Storage REST surface). Keeping the policy set
  intentionally narrow.

### Path convention (NOT enforced — documented for the upload UI unit)

The upload UI will mint paths of the shape
`{project_id}/{work_package_id}/{photo_log_id}.{ext}`. UUID-
based; no human-readable names. The bucket does not enforce
this — the application's signed-URL minting endpoint will.
`photo_logs.storage_path` records whatever path the
application chose; that column is the authoritative reference.

### Photos + approvals + storage — overall state

The schema layer for the photo → approval → PDF flow is now
complete:

- [photo_logs](decisions/0015-photo-logs-tombstone-supersede.md)
  table (PR 1 of feature spec 02).
- approvals table (PR 2 of feature spec 02).
- `photos` Storage bucket + upload policy (this PR).

Remaining work before PDFs ship:

- **SA upload UI.** Direct client → Storage upload via the
  signed-upload-URL endpoint; INSERT `photo_logs` row; render
  Before / During / After galleries. Will exercise the
  storage policy this PR ships and the photo_logs INSERT
  policy from PR 1. Will also wire the `photo_logs` tombstone
  flow (the supersede skill update lands here — still
  deferred).
- **Photo-driven `pending_approval` transition.** When the
  first After photo lands on a WP,
  `work_packages.status` → `pending_approval`. Enum value is
  in place; transition logic lives in the upload UI unit.
- **Signed-URL helper.** Server-side helper that mints
  short-lived signed URLs for the `photos` bucket using the
  service role. The watermark renderer (later) will sit in
  front of this helper.
- **PM approval UI.** Produces `approvals` rows.
- **Watermark-on-demand renderer.** Renders a watermark
  server-side at view / export time per ADR 0003.
  Originals in the bucket are never modified.
- **PDF generation.** Filters on the latest
  `approvals.decision = 'approved'` per WP.

### Still-deferred follow-ups (carried forward)

- **`.claude/skills/supersede-pattern/SKILL.md` tombstone
  update.** Still deferred to the SA upload UI unit.
- **Self-approval guard on approvals.** v1 deferral.
- **Orphan-object cleanup.** Tombstoned `photo_logs` rows
  leave their underlying `storage.objects` in place in v1.
  A v2 cleanup job (or scheduled function) walks orphan
  objects whose path's `photo_log_id` is tombstoned.

### Operator follow-up (post-merge)

Schema / config-only unit. No user-visible behavior changes.
Smoke check is purely catalog:

1. `pnpm db:test` green (11 files, 202 assertions).
2. `select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'photos'` returns the
   expected row.
3. `select policyname, cmd, roles from pg_policies where
schemaname = 'storage' and tablename = 'objects'` returns
   exactly one row,
   `"photos uploads by sa/pm/super" INSERT {authenticated}`.

### Open questions

None blocking.

- **Bucket configuration via Dashboard later.** The Supabase
  Dashboard's Storage UI can edit bucket settings out-of-band.
  If the operator changes settings there, the change is NOT
  reflected in migration history and the catalog-pgTAP guard
  will catch the drift. Right move on detection: ship a
  migration that re-applies the canonical values, or update
  the migration's spec if the drift is intentional.
- **Service-role key exposure for the signed-URL endpoint.**
  The upload UI unit will mint signed URLs using
  `SUPABASE_SERVICE_ROLE_KEY` from `src/lib/db/admin.ts`. That
  client is already `server-only` and reachable only from
  server code paths (RSC, route handlers). The unit that
  ships the endpoint should make sure the signed URL's TTL
  is short (single-digit minutes) and that the endpoint
  itself is auth-gated — neither belongs here.

---

## Unit: Feature spec 03 — SA upload UI (docs-only)

- **Status:** Complete — 2026-05-24.
- **Started / completed:** 2026-05-24.
- **Spec written, no code, no schema.** Captures the locked
  design for the SA photo upload UI so the build (planned as
  2 PRs) is mechanical.
- **Spec:** [`docs/feature-specs/03-sa-upload-ui.md`](feature-specs/03-sa-upload-ui.md).
- **Branch:** `docs/03-sa-upload-ui-spec`.

### Done

- New feature spec written, matching the structure of
  [`docs/feature-specs/01-line-auth.md`](feature-specs/01-line-auth.md)
  and [`02-photos-and-approvals.md`](feature-specs/02-photos-and-approvals.md)
  (Status → Goal → Context & platform → Locked design
  decisions → Build plan → Deferred → Recommendation →
  References).
- All decisions from the design session captured:
  - **Platform.** SA-facing PWA surface at `/sa/*` served by
    the same Next.js app PMs use; mobile-first; tolerates
    poor connectivity via per-photo retry; PM and super_admin
    admitted on the same routes (matches the photo_logs +
    bucket INSERT policies).
  - **Three-level drill.** Project list → flat,
    text-filterable WP list → photo screen with Before /
    During / After phase sections. Deliverable-grouping is
    explicitly v2 and not built here.
  - **Photo grain + current-state.** One row = one photo;
    current photos = ADR 0009 anti-join PLUS
    `storage_path IS NOT NULL` (the exact query the photo
    screen runs).
  - **Option C upload sequencing.** Client mints a UUID v4;
    that uuid is BOTH the Storage object key suffix AND the
    `photo_logs.id`. Order is **upload first, row insert
    second** so the only "orphan" failure mode is an
    object-without-row (invisible to the app, acceptable
    until v2 cleanup). The inverse — row-without-object —
    is never produced.
  - **Server actions for writes.** Storage upload is direct
    client → Storage (the bytes never pass through the Next
    server), but the `photo_logs` INSERT and the tombstone
    INSERT go through server actions
    (`addPhoto` / `removePhoto`) so validation is a single
    chokepoint.
  - **Photo-driven `pending_approval` transition.** When the
    first After photo lands on a WP whose status is
    `not_started | in_progress | on_hold`, the `addPhoto`
    action also transitions the WP to `pending_approval`.
    One-way for v1 (no regression on remove).
  - **OPEN IMPLEMENTATION QUESTION** flagged for PR 2 to
    resolve before writing code: the SA-triggered transition
    cannot run under the SA's session (work_packages UPDATE
    RLS admits only PM + super_admin). Spec enumerates three
    options — (a) admin-client escalation for just the
    status update, (b) widen work_packages UPDATE RLS to
    site_admin (discarded unless paired with a column-grant
    restriction), (c) a Postgres trigger on photo_logs that
    fires the status update under the table-owner privilege.
    PR 2 must surface one and stop for operator decision.
  - **Viewing photos.** Server-minted short-lived (60–300s)
    signed URLs against the private `photos` bucket using
    the service role; batched per-page (one round-trip for
    all photos on a WP); URLs are never cached / persisted.
    This is the "signed-URL read helper" the prior units
    deferred to the UI unit.
  - **Replacement.** ADR 0015's "two appends" rule —
    `removePhoto` + `addPhoto` — with the UI wrapping both
    behind a Replace button that surfaces partial failure
    (remove succeeded but add failed = old photo gone, UI
    prompts to retry the add).
- **Build plan (2 PRs):**
  - **PR 1 — navigation + read-only viewing.** Project list,
    WP list (filterable), photo screen with signed-URL
    thumbnail rendering. Exercises the read path.
  - **PR 2 — upload + remove + status transition.** Starts
    with the privilege-question resolution; ships the two
    server actions and the auto-transition.
- **Deferred** (documented): deliverable-grouping (v2),
  offline upload queue (v2), photo annotations / captions /
  ordering / EXIF, watermark rendering (later unit), PM
  approval UI, PDF generation, WP edits beyond status
  transition, atomic photo replacement (ADR 0015 explicitly
  deferred), orphaned-object cleanup (v2).
- **Recommendation** (not built here): if PR 2 picks option
  (c) for the privilege question, write ADR 0016 alongside
  the migration that adds the trigger — same pattern ADR
  0015 used. Options (a) and (b) are small implementation
  choices that fit a PR description without an ADR.
- `pnpm lint && pnpm typecheck && pnpm test` all pass
  (docs-only — confirmed below).

### Decisions made

- **No new ADR in this PR.** Same pattern as the photos +
  approvals spec write-up (spec 02): the ADR — if needed —
  lives in the build PR that exercises the decision, not in
  the spec doc. The status-transition privilege question
  (decision 15) might earn ADR 0016 in PR 2 if option (c)
  is chosen; flagged as a recommendation in the spec.
- **2-PR split, not 3 or 4.** The read-only viewing PR
  exercises the full read path (signed URLs, anti-join
  current-state, the three-level navigation) without
  touching any write surface. The write PR adds upload,
  remove, and the auto-transition together because they
  share the same server-action chokepoint and the same
  client UUID + path-derivation logic — splitting them
  further would duplicate machinery for two consecutive
  micro-PRs.
- **Same routes for SA / PM / super_admin.** Spec leans
  share-and-admit (the bucket and table policies admit all
  three roles, so the auth gate is "in the privileged set"
  rather than "is site_admin"). Final PR-time call; the
  spec doesn't lock it because the read-only PR can prove
  out either shape before the write PR commits.

### Open questions

None blocking — the spec itself is complete. The two
forward-looking flags:

- **Decision 15 (SA-triggered WP status transition
  privilege).** PR 2 picks one of options (a) / (b) / (c)
  and stops for operator decision before writing code. This
  is the single biggest implementation risk in the build —
  silently widening `work_packages` UPDATE RLS would be a
  significant security regression and is the wrong default.
- **Deliverable-grouping** as a v2 schema + import change.
  Trigger to revisit: SA / PM workflow research surfaces a
  real grouping need on the 80-WP scale that filter alone
  can't address.

### Next build unit

**PR 1 of feature spec 03 — `feat/sa-upload-nav-and-read`.**
Project list, filterable WP list, read-only photo screen
backed by signed URLs. No write surface yet.

---

## Unit: SA upload UI — PR 1 of 2: navigation + read-only photo viewing

- **Status:** Complete — 2026-05-24.
- **Started / completed:** 2026-05-24.
- **Spec:** [`docs/feature-specs/03-sa-upload-ui.md`](feature-specs/03-sa-upload-ui.md)
  PR 1 section.
- **Branch:** `feat/sa-upload-nav-and-read`.

### Done

- **Three-level navigation under `/sa/*`, all role-gated to
  `site_admin / project_manager / super_admin`** (matches the
  photo_logs and bucket INSERT policies per ADR 0015):
  - **`src/app/sa/page.tsx`** — replaces the previous "coming
    soon" placeholder. Lists every project the user can read
    (RLS scopes the result) as tappable cards: code (mono),
    name, and a status pill. Empty state when no projects.
    Retains the `LogoutButton` from the previous page in the
    header.
  - **`src/app/sa/projects/[projectId]/page.tsx`** — fetches
    the project (`notFound()` if unreadable / not present)
    and its work packages ordered by `code`. Renders the
    list via the small Client Component below. Back link to
    `/sa`.
  - **`src/app/sa/projects/[projectId]/work-package-list.tsx`** —
    Client Component (only client-side surface in PR 1). Local
    `useState` text filter; `useMemo` over `code`/`name`
    (case-insensitive `includes`). No debounce, no server
    search — spec locks ~80 WPs per project, in-memory filter
    is sufficient. Empty state distinguishes "no WPs in this
    project" from "no matches for current filter".
  - **`src/app/sa/projects/[projectId]/work-packages/[workPackageId]/page.tsx`** —
    photo screen. Fetches the WP (`notFound()` if unreadable;
    also rejects if `wp.project_id !== params.projectId`, so a
    crafted URL can't show a WP under a wrong project). Three
    `<PhaseSection>`s (Before / During / After), each showing
    the current photos as a 2- (sm: 3-) column grid of
    square-aspect thumbnails. Per-phase empty state. Back
    link to the WP list. **No write controls in PR 1.**
- **`src/lib/photos/current-photos.ts`** — current-photos
  read helper (ADR 0015 + ADR 0009):
  - **`getCurrentPhotosForWorkPackage(supabase, wpId)`** runs
    one SELECT `photo_logs` for the WP under the user's RLS
    context (SSR client) and returns photos grouped by phase.
  - **`selectCurrentPhotosByPhase(rows)`** is the pure-function
    core: builds the set of `superseded_by` values, filters out
    rows whose id is in that set (the ADR 0009 anti-join, JS
    side) AND rows whose `storage_path` is NULL (tombstones
    per ADR 0015), then groups the survivors by phase.
  - **Why JS-side filtering, not a single SQL anti-join.**
    PostgREST does not express `WHERE NOT EXISTS (…)` as a
    composable filter; the choices are an RPC, a server-side
    SQL view, or fetch-and-filter. At the WP scale the spec
    locks (≤30 photos per WP across all phases), fetching
    every row and filtering in JS is one round-trip, RLS still
    gates the read, and the load-bearing logic stays in a pure
    function that is trivial to unit-test.
- **`src/lib/photos/signed-urls.ts`** — `server-only`
  helper that batches signed-URL minting against the private
  `photos` bucket per ADR 0015 / spec 03 decision 17:
  - **`mintSignedUrlsForPhotos(photos)`** filters out
    tombstones (storage_path NULL — nothing to sign for),
    then calls `admin.storage.from('photos').createSignedUrls(
paths, 120)` once for every path the page needs. Returns
    a `Map<photoLogId, signedUrl>` the page reads when
    rendering thumbnails. One round-trip per page, never
    per thumbnail.
  - **TTL is 120s** — middle of the 60–300s window the spec
    allows. The page only needs the URL alive while the
    browser fetches the thumbnail; a leaked URL has very
    little value at 2-minute TTL.
  - **Uses the admin (service-role) client** because Storage
    has no SELECT policy on `storage.objects` (intentional —
    spec 02 / bucket migration). The application-layer
    authorisation is the `photo_logs` SELECT RLS the caller
    already passed; the admin client never reaches a client
    bundle (`server-only` directive + module is only imported
    from the photo screen Server Component).
- **shadcn primitives added via the CLI**
  (`pnpm dlx shadcn@latest add card input skeleton`) — three
  new files under `src/components/ui/` (card, input,
  skeleton). Only `Input` is actually used in PR 1 (in the
  WP filter); `Card` and `Skeleton` are pulled in for PR 2 /
  later units that the spec already names. No
  `package.json` change (the dlx pull was self-contained).
- **Plain `<img>`, not `next/image`, for thumbnails.** Using
  `next/image` with signed Supabase Storage URLs would
  require adding a `remotePatterns` entry in `next.config.ts`
  for the Storage host. PR 1 keeps the surface tight; PR 2 (or
  a follow-up that ships real photos) may revisit. Lazy
  loading is preserved via `loading="lazy"`. Inline
  eslint-disable for the `next/image` lint rule, narrowly
  scoped to the one `<img>` element.

### Tests

- **`tests/unit/current-photos.test.ts`** (5 assertions):
  - empty input → empty buckets;
  - groups real photos by phase;
  - excludes tombstones (storage_path NULL);
  - excludes superseded rows along an A→B→C replacement
    chain (only C is current);
  - the ADR 0015 worked example end-to-end (A uploaded, B
    uploaded, A tombstoned → only B remains).
  - Mocks `server-only` per the project's established
    test-file pattern.
- **No test added for `mintSignedUrlsForPhotos`.** The
  load-bearing logic is the Storage SDK call itself; the
  surrounding code (tombstone-skipping, result-map
  assembly) is mechanical and clearly typed. A meaningful
  test would require mocking `@supabase/supabase-js`'s
  storage chain end-to-end, which the spec explicitly says
  is unnecessary for PR 1: "No behavioral test needed for
  the Storage call in this PR." PR 2 may add tests when the
  server actions exercise this surface more substantively.

### Decisions made

- **Same `/sa/*` routes admit SA + PM + super_admin** (the
  spec leaned share-and-admit; PR 1 commits to it). Every
  page calls
  `requireRole(["site_admin","project_manager","super_admin"])`.
  PM lands on `/pm` after login and never reaches `/sa` in
  normal navigation, but if they (or super_admin) deep-link
  to a `/sa/*` URL the gate admits them, matching the table
  and bucket policies. PR 2's `addPhoto` server action will
  follow the same admit-set.
- **`notFound()` for unreadable / mismatched routes.** The
  WP page rejects a request where `wp.project_id` doesn't
  match the URL's `projectId` segment with `notFound()`
  (not a 403). The user is already authorised at the role
  level — the WP either exists under the project or it
  doesn't — so 404 is the right semantic. RLS-blocked rows
  also surface as `notFound()` because the select returns
  zero rows.
- **JS-side anti-join over server-side SQL.** The
  alternatives — an RPC function or a SQL view that wraps
  the anti-join — would each be a new migration and a new
  RLS surface. With the photo-per-WP ceiling the spec locks
  (~30), fetching every row for the WP and filtering in JS
  is one round-trip, RLS still gates the rows, and the
  pure filter function is trivially unit-testable. Worth
  revisiting only if a future query touches more rows or
  needs to project columns the JS filter doesn't already.
- **Plain `<a>` for the back links, not `next/link`.**
  Actually `next/link` is fine here (the back links don't
  set CSRF cookies the way `/auth/line/start` does). Used
  `next/link` everywhere for the prefetching benefit and
  the small reduction in full-page reloads.
- **WP filter is a single Client Component file** colocated
  with the project page (`work-package-list.tsx`) rather
  than promoted to `src/components/features/`. It is
  specific to this surface, has no callers elsewhere, and
  colocating it is consistent with Next.js App Router
  conventions for route-local children.

### Open questions

- **Decision 15 — SA-triggered WP status transition
  privilege.** Unresolved by design; PR 2 picks one of
  options (a) admin-client escalation, (b) widen
  `work_packages` UPDATE RLS to `site_admin` (likely
  discarded — see spec), or (c) DB trigger on `photo_logs`
  INSERT. **PR 2 must propose one and stop for operator
  decision before writing code.** This was deliberately
  left for PR 2 by the spec; PR 1 does not need it.
- **`next/image` for signed Supabase URLs.** Deferred to
  PR 2 (or a tiny follow-up) — would require adding the
  Storage host to `remotePatterns` in `next.config.ts`. PR
  1 uses plain `<img>` to avoid the config dependency in
  the first surface that touches signed URLs.
- **Live photo display unverified end-to-end.** No real
  photos exist in the `photos` bucket yet (uploads ship in
  PR 2). PR 1's photo screen will show "No before/during/
  after photos yet" empty states until PR 2 enables
  uploads. Live signed-URL rendering will be exercised the
  first time a real photo lands in the bucket — most
  likely during PR 2's manual smoke against a Vercel
  preview.

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 39/39 passing (5 new + 34 existing).
- `pnpm build` — succeeds. Build output shows the three new
  routes: `/sa`, `/sa/projects/[projectId]`,
  `/sa/projects/[projectId]/work-packages/[workPackageId]`
  alongside the existing 8.
- Authenticated UI E2E **not added** (the project's
  Playwright suite is unauthenticated-only so far; an
  authenticated E2E pattern is deferred infra per the LINE
  auth PR 4 notes). Manual smoke against a Vercel preview
  is the operator's verification step post-merge.

### Next build unit

**PR 2 of feature spec 03 — `feat/sa-upload-write`.** Must
open with the spec's decision 15 (SA-triggered WP status
transition privilege) — propose one of (a) / (b) / (c) and
stop for operator decision before writing the transition
code. Then ship `addPhoto` + `removePhoto` server actions
and wire the photo screen's add/remove controls.

---

## Unit: SA upload UI — PR 2 of 2: upload, removal, pending_approval transition

- **Status:** Complete — 2026-05-24. Feature spec 03 is now
  complete end-to-end.
- **Started / completed:** 2026-05-24.
- **Spec:** [`docs/feature-specs/03-sa-upload-ui.md`](feature-specs/03-sa-upload-ui.md)
  PR 2 section.
- **Branch:** `feat/sa-upload-write`.

### Resolved opener — spec 03 decision 15

The SA-triggered WP status transition uses **option (a) —
admin-client escalation INSIDE the upload server action**.
Rationale: smallest surface, the escalation is one guarded
UPDATE in one function, `work_packages` RLS unchanged, no
new migration / trigger / ADR required. The UPDATE is
narrow:

- only the `status` column;
- only to `'pending_approval'`;
- only when the WP's current `status` is
  `not_started | in_progress | on_hold` — enforced as a SQL
  `.in("status", TRANSITIONABLE_FROM_STATUSES)` clause on
  top of the JS predicate, so the rule lives in two
  independent layers and can't be widened by a future
  caller.

The admin client is otherwise NOT a general WP-update path —
this is the single guarded transition the spec authorised.
Option (b) (widen `work_packages` UPDATE RLS to `site_admin`)
was rejected as a strictly larger surface for no win; option
(c) (DB trigger) was rejected as out of proportion for one
transition.

### Done

- **`src/lib/photos/path.ts`** — pure path / input validators:
  - `PHOTO_EXTS = ['jpeg','png','webp','heic']` (matching the
    bucket's `allowed_mime_types`); `PhotoExt` is the union.
  - `isValidPhotoExt(value)` and `isValidUuid(value)` —
    type-narrowing guards; UUID regex catches the standard
    8-4-4-4-12 hex form. The UUID guard rejects path-traversal
    style inputs (`"../etc/passwd"`, a uuid with appended
    `/extra`).
  - `buildPhotoStoragePath(projectId, wpId, photoId, ext)` —
    canonical `{project_id}/{work_package_id}/{photo_id}.{ext}`
    builder; the single source of truth for the path shape on
    both client and server (the action reconstructs it from
    validated inputs and the WP's own `project_id`).
  - `mimeToPhotoExt(mime)` — maps `image/jpeg|png|webp|heic`
    to the canonical ext. The client derives ext from
    `file.type` (not from the file name), so casing /
    extension aliasing (`.JPG` → `image/jpeg`) can never
    produce a path the server would reject.
- **`src/lib/photos/transitions.ts`** —
  `shouldTransitionToPendingApproval(phase, currentStatus)`
  pure predicate + `TRANSITIONABLE_FROM_STATUSES` constant.
  Used by `addPhoto` to predicate the transition and by the
  SQL guard to enforce it in the UPDATE clause.
- **`src/lib/photos/tombstone.ts`** —
  `buildTombstoneRow({ workPackageId, phase, targetPhotoId,
uploadedBy })` returns an `INSERT` payload with
  `storage_path: null, superseded_by: targetPhotoId`. Pure
  so the row shape can be asserted against the ADR 0015
  well-formedness invariant `(path NULL) = (superseded_by
NOT NULL)` in unit tests.
- **`src/app/sa/projects/[projectId]/work-packages/[workPackageId]/actions.ts`** —
  server actions (file-scoped `"use server"`):
  - **`addPhoto({ workPackageId, phase, photoId, ext,
capturedAtClient? }): AddPhotoResult`** - validates uuid / phase / ext; - looks up the WP via the SSR client under the user's
    RLS context — if it can't read it, refuses without
    leaking whether the row exists; - reconstructs the canonical storage path from the
    validated inputs and the WP's own `project_id` — the
    client never sends a path string, so there is nothing
    to "verify"; - INSERTs the `photo_logs` row under the user's session
    (RLS admits SA/PM/super_admin per ADR 0015); - if and only if `shouldTransitionToPendingApproval`
    returns true, runs a single guarded UPDATE on
    `work_packages` via the admin client:
    `.update({ status: 'pending_approval' })
        .eq('id', wp.id)
        .in('status', TRANSITIONABLE_FROM_STATUSES)`.
    The IN clause is the load-bearing safety net — even
    if the JS predicate above were buggy, this UPDATE
    will still no-op on `pending_approval` and `complete`. - `revalidatePath('/sa/projects/.../work-packages/...')`
    after success; - returns `{ ok: true, photoId, transitioned } |
{ ok: false, error }` — discriminated so the UI can
    pattern-match without exception handling.
  - **`removePhoto({ photoLogId }): RemovePhotoResult`** —
    validates uuid; reads the target under the user's RLS
    (RLS-rejected reads surface as "not found", which is
    the right semantic); refuses if the target is already a
    tombstone (`storage_path === null`); also checks
    nothing else already supersedes it (defends against
    double-remove racing a stale UI); INSERTs the tombstone
    under the user's session; `revalidatePath` and return.
    **Removal does NOT change WP status** in v1 — the
    one-way rule the spec locked.
- **`phase-uploader.tsx`** — single Client Component owning
  the per-phase interactive surface (Add control, pending
  upload tiles with status, remove ✕ button on each existing
  thumbnail). Sequential uploads (one at a time per file
  picked) with per-photo status: `uploading → uploaded →
inserting → done` on the happy path; `upload-error`
  (Storage upload failed — retry re-uploads with the same
  uuid) or `insert-error` (Storage succeeded but the action
  failed — retry replays only the action; the object is
  already in Storage at the canonical path). After a
  successful action call, removes the pending tile and
  `router.refresh()` so the server re-renders with fresh
  signed URLs from the now-real `photo_logs` row.
- **Photo screen page** updated to render `<PhaseUploader>`
  instead of the read-only `<PhaseSection>`. Server data
  flow is unchanged — page still server-renders the WP
  fetch, the current-photos query, and the batched
  signed-URL minting; the uploader Client Component
  receives `{ id, url }[]` per phase and owns nothing
  beyond the local pending-upload state.
- **Path conventions on the wire.** File bytes go DIRECT
  from the browser to Storage (`supabase.storage
.from('photos').upload(path, file, { contentType,
upsert: false })`). Only metadata (workPackageId,
  phase, photoId, ext, capturedAtClient) flows to the
  server action. Admin client + service-role key never
  reach the browser bundle (the action module is
  `server-only`).
- **Orphan-recovery UX.** Per spec decision 9, an upload
  that succeeds but whose `photo_logs` insert fails
  produces an orphaned Storage object (invisible to the
  app). The UI surfaces this as
  `"Upload saved but failed to record — <error>"` with a
  Retry button that re-invokes ONLY the server action with
  the same uuid + path — succeeds on the second try, the
  row matches the existing object, no re-upload.

### Tests

- **`tests/unit/photo-write-helpers.test.ts`** (15 assertions):
  - `isValidPhotoExt`: accepts the four canonical exts,
    rejects `jpg` (must be normalised by the client),
    rejects unrelated / mis-cased / non-string values.
  - `isValidUuid`: accepts well-formed v4 uuids; rejects
    empty / mis-shaped / path-traversal style inputs;
    rejects non-strings.
  - `buildPhotoStoragePath`: canonical concat form.
  - `mimeToPhotoExt`: the four supported MIMEs map to their
    exts; everything else returns `null`.
  - `shouldTransitionToPendingApproval`: transitions ONLY
    when `phase='after'` AND status is in
    `{not_started, in_progress, on_hold}`; never on
    `before`/`during` regardless of status; never regresses
    `pending_approval` or `complete`.
  - `buildTombstoneRow`: produces `storage_path NULL,
superseded_by = targetId`; satisfies the ADR 0015
    `(path NULL) = (superseded_by NOT NULL)` invariant.

  No tests for the server-action wiring or Storage I/O —
  those are exercised by manual smoke against the deploy.
  The PURE decision logic (path, transition, tombstone) is
  unit-covered, which is the spec's specific ask.

### Decisions made

- **Option (a) escalation, with a SQL guard layered on top
  of the JS predicate.** The JS check
  (`shouldTransitionToPendingApproval`) decides whether to
  run the UPDATE at all; the `.in('status',
TRANSITIONABLE_FROM_STATUSES)` clause inside the UPDATE
  guarantees the rule even if the predicate is later
  broadened. Two independent layers, both ADR-0013-aware,
  no work_packages RLS change.
- **Photo INSERT under the user's session, transition via
  admin client.** The photo_logs INSERT goes through the
  SSR (anon-key + cookies) client so RLS is the
  authorisation primitive — it's the same RLS that admits
  uploads to the Storage bucket, so by construction
  anyone who could upload can also INSERT. The status
  UPDATE goes via the admin (service-role) client because
  `work_packages` UPDATE RLS does not admit `site_admin`.
  The two clients exist in the same action; the admin
  client is created locally inside the function and never
  exposed beyond it.
- **Sequential uploads, single file input.** Multi-file
  picks queue and process one at a time. Easier per-photo
  status; less bucket pressure; matches the "simple is
  fine" guidance in the spec.
- **Two retry paths.** Upload-error retries re-upload
  (the object isn't in Storage yet). Insert-error retries
  only the server action (the object IS in Storage at the
  canonical path; replaying the insert lets the row match
  the existing object without re-uploading bytes). This
  is the failure-mode story spec decision 9 specifies.
- **`<img>` thumbnails, not `next/image`.** Same call PR
  1 made — `next/image` against signed Supabase URLs
  would need a `remotePatterns` entry in `next.config.*`
  for the Storage host. Out of scope for this PR; if a
  future surface needs the optimization, ship the config
  alongside it.
- **`capture` attribute omitted on the file input.** With
  `accept="image/jpeg,image/png,image/webp,image/heic"`
  alone, mobile OSes prompt the user with both camera and
  gallery options. Adding `capture="environment"` would
  force camera on some devices and short-circuit the
  picker; omitting it is the friendlier default. Allowing
  HEIC matches the bucket's MIME allowlist.
- **`captured_at_client = file.lastModified`.** Best
  available client-side capture time without extra
  permissions. Untrusted (per the spec — the column is
  for display only), stored as ISO string. If the future
  PDF report wants a more authoritative timestamp it
  belongs server-side anyway.

### Open questions

- **Authenticated UI E2E still not added.** Same posture as
  PR 1: the project's Playwright suite is unauthenticated-
  only and an authenticated UI E2E pattern is deferred
  infra. Manual smoke against a Vercel preview is the
  verification step.
- **`next/image` remotePatterns for signed Storage URLs.**
  Still deferred. Plain `<img>` is fine for the v1 phone
  surface; revisit if a future surface needs the
  optimization (or if the LCP measurement says so).
- **Orphaned Storage objects from tombstones AND from
  failed inserts.** Per spec 02 / spec 03, orphan cleanup
  is a v2 concern. The bucket already accumulates orphans
  from every removed photo (tombstones leave bytes); the
  failed-insert path adds an even smaller stream. A
  scheduled function or manual sweep walks objects whose
  `photo_logs` row is missing-or-tombstoned and deletes
  them. Not a v1 blocker.
- **Supersede-pattern skill still deferred.**
  [`.claude/skills/supersede-pattern/SKILL.md`](../.claude/skills/supersede-pattern/SKILL.md)
  still teaches the replacement-only framing of the
  supersede pattern. ADR 0015 added the tombstone variant;
  feature spec 02 PR 1 noted the skill update as
  deferred; this PR is the first real consumer of the
  tombstone pattern in production code (`removePhoto` +
  `buildTombstoneRow`). Worth updating in a tiny
  follow-up so the skill catches up with the code.

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 54/54 passing (15 new + 39 existing).
- `pnpm build` — succeeds. All 11 routes compile,
  including the updated photo screen.
- **End-to-end behaviour against real Storage + a real WP
  is the operator's manual smoke** on a Vercel preview,
  per spec 03 PR 2 verification: upload one Before, one
  During, one After photo on a clean WP and confirm
  (i) all three appear as thumbnails, (ii) the WP's
  status flipped to `pending_approval` after the After
  upload (and not before), (iii) remove the After photo
  and confirm it disappears, (iv) confirm
  `photo_logs` has 4 rows for that WP (3 real + 1
  tombstone) and the anti-join returns 2 (Before +
  During — After tombstoned), (v) confirm
  `work_packages.status` did NOT regress from
  `pending_approval` after the After was removed (the
  rule is one-way for v1).

### Feature status

**Feature spec 03 — SA upload UI — is COMPLETE.** Both PRs
are in; SA + PM + super_admin can navigate projects → WPs →
photo screen, view current photos as signed-URL thumbnails,
upload new photos by phase, and remove photos via
tombstone. The first After photo on a `not_started |
in_progress | on_hold` WP transitions it to
`pending_approval` — the signal the PM approval UI will
key off.

### Next units (not started)

- **Supersede-pattern skill update** (tiny follow-up) —
  add the tombstone variant to
  [`.claude/skills/supersede-pattern/SKILL.md`](../.claude/skills/supersede-pattern/SKILL.md)
  now that `removePhoto` + `buildTombstoneRow` are in
  production. Cite ADR 0015 + the new helpers as the
  reference.
- **PM approval UI** — the surface that produces
  `approvals` rows for WPs at `pending_approval`. Separate
  unit, separate spec (feature spec 02 PR 2 territory).
- **Watermark-on-demand rendering** (ADR 0003).
- **PDF report generation** — filters on the latest
  `approvals.decision = 'approved'` per WP.

---

## Unit: PM approval UI

- **Status:** Complete — 2026-05-24. The end-to-end human
  flow (SA upload → PM approve) is now wired.
- **Started / completed:** 2026-05-24.
- **Spec:** Inline operator prompt; consumes
  [`docs/feature-specs/02-photos-and-approvals.md`](feature-specs/02-photos-and-approvals.md)
  approvals section + the patterns spec 03 PR 2
  established (option-(a) guarded transition, signed-URL
  viewing, Server Components + one Client form).
- **Branch:** `feat/pm-approval-ui`.

### Locked behaviour

- Review state is **derived** from the latest `approvals`
  row per WP (max `decided_at`). No `is_reviewable`
  column, no submission record — same shape spec 02
  already locked.
- The ONLY new automated status transition is the
  **approved → complete** flip on the parent WP. Mirrors
  spec 03 decision 15 option (a): a single guarded
  admin-client UPDATE inside the action,
  `status='complete'` only, only from `pending_approval`.
  `needs_revision` and `rejected` never change WP
  status — the WP stays at `pending_approval` and gets a
  new latest decision label.
- `/pm` is a **flat, cross-project queue** of every WP
  at `pending_approval`. Approved WPs are `complete` and
  fall off automatically. Each item shows project
  context + the latest-decision label
  (`Awaiting first review` / `Revision requested` /
  `Rejected`).
- `/pm/work-packages/[workPackageId]` is the review
  screen: project + WP context, current photos via the
  existing signed-URL helpers (READ-ONLY for PM),
  decision history newest-first with decider name +
  comment + timestamp, and a record-decision form.
- Routes are role-gated to `project_manager` /
  `super_admin`. Site admins cannot reach these pages
  (`requireRole` redirects them per `roleHome`); the
  `approvals` INSERT RLS already excludes `site_admin`
  as the load-bearing backstop.

### Done

- **`src/lib/approvals/predicates.ts`** — pure shared
  predicates: `commentRequiredFor`,
  `isCommentValid` (trim-non-empty mirror of the DB
  CHECK), `shouldTransitionToComplete` (mirrors
  `shouldTransitionToPendingApproval` from spec 03 PR 2),
  and the `APPROVAL_DECISIONS` constant the form's radio
  group depends on.
- **`src/lib/approvals/latest-decision.ts`** — three
  helpers:
  - `selectLatestDecisionByWorkPackage(rows)` — pure
    reducer, order-independent over the input, returns
    `Map<wpId, ApprovalRow>` of max-`decided_at` per WP.
  - `getLatestDecisionsForWorkPackages(supabase, wpIds)`
    — fetch + reduce; the queue's read.
  - `getDecisionHistoryForWorkPackage(supabase, wpId)` —
    full history newest-first; the review screen's read.
    Threading the `SupabaseClient<Database>` through
    these helpers is what gives the page typed enum rows
    (db/server.ts is not generic-typed; helpers like
    this are the codebase pattern for typed reads —
    mirrors current-photos.ts).
- **`src/app/pm/work-packages/[workPackageId]/actions.ts`**
  — `recordDecision` server action (file-scoped
  `"use server"`): uuid + decision + comment validation;
  explicit role check (SSR `users` row, role ∈
  `{project_manager, super_admin}`) on top of the
  approvals-INSERT RLS backstop; refuses if the WP isn't
  `pending_approval`; comment normalised (trim → null if
  blank); SSR-INSERT approvals; guarded admin UPDATE
  `status='complete'` only from `pending_approval`;
  `revalidatePath` for both `/pm` and the review screen;
  discriminated `{ ok, ... }` result.
- **`src/app/pm/page.tsx`** — replaces the placeholder
  with the queue. Two-query fetch (WPs at
  `pending_approval`, then `projects` keyed by id —
  matches the codebase pattern; no PostgREST join
  inflection) and per-item latest-decision label.
  Logout button retained.
- **`src/app/pm/work-packages/[workPackageId]/page.tsx`**
  — the review screen. Reuses
  `getCurrentPhotosForWorkPackage` +
  `mintSignedUrlsForPhotos` as-is (the photo_logs /
  bucket policies admit PM/super). Decision history with
  pill colour + decider name + timestamp + comment.
  Record-decision form rendered only when
  `status === 'pending_approval'`; otherwise a
  not-up-for-review notice.
- **`src/app/pm/work-packages/[workPackageId]/record-decision-form.tsx`**
  — Client Component. Native styled radios for the three
  decisions, shadcn `Textarea` for the comment,
  client-side validation gated by `isCommentValid`,
  submit disabled until valid. On success →
  `router.push('/pm')` + `router.refresh()`. On error →
  inline alert with the action's message.
- **shadcn primitive added** via the CLI: `textarea` —
  one new file at `src/components/ui/textarea.tsx`. The
  decision picker is native radios styled with Tailwind
  (one use site; `radio-group` would have been extra
  weight).

### Decider-name lookup

`public.users` SELECT under the SSR client is gated to
`users read self` plus the super_admin policy. A PM
reading another PM's name through their own session
returns zero rows. Options:

- **Add an RLS policy admitting PMs to read
  `users.full_name`.** Broadens row visibility for the
  whole table; out of this unit's scope and the prompt
  says "no RLS change."
- **Admin-client lookup, narrow** — exactly the shape
  [`src/lib/photos/signed-urls.ts`](../src/lib/photos/signed-urls.ts)
  established: the page is already past
  `requireRole(["project_manager","super_admin"])`, the
  input set is the decider ids appearing in this WP's
  approvals (RLS-readable for the PM), and the output is
  just display names. Pure application-layer auth +
  service-role data fetch.

Chose the latter. `fetchDeciderNames(ids)` lives inline
in the review page; the admin client is created
locally and never leaves the function. If more PM-
facing surfaces need cross-user name visibility later,
the cleaner long-term shape is an RLS policy admitting
privileged roles to read `users.full_name` — not more
admin-client sprinkles.

### Tests

- **`tests/unit/approvals-helpers.test.ts`** (14
  assertions):
  - `selectLatestDecisionByWorkPackage`: empty input;
    single-row WP; multi-row WP returns max-`decided_at`;
    order-independent over input; multiple WPs each get
    their own latest independently.
  - `commentRequiredFor`: only `rejected` and
    `needs_revision`.
  - `isCommentValid`: every (decision × null / empty /
    whitespace / real-text) combination, including the
    edge case of `approved` with a whitespace-only
    comment (accepted).
  - `shouldTransitionToComplete`: only true for
    `approved` + `pending_approval`; false for every
    other (decision × status) pair, including the
    non-regression cases (`approved` from `complete` or
    other non-pending statuses).
  - `APPROVAL_DECISIONS` constant shape — locks the
    alphabetised order the form's radio group depends
    on.
- 68/68 total tests passing (14 new + 54 from prior
  units).

### Decisions made

- **Two-query fetch instead of a PostgREST join.** The
  joined-relation typing inflated to an array in our
  setup; the codebase pattern (mirrored from
  current-photos.ts) is two simple queries plus a map.
  Cleaner types, identical round-trip cost at pilot
  scale.
- **Native radios styled with Tailwind, not shadcn
  `radio-group`.** One use site; adding the dep would be
  extra weight. Keyboard accessible via native
  semantics; matches the dark/zinc aesthetic from PR 1 +
  PR 2 of spec 03.
- **`status !== 'pending_approval'` shows a notice, not
  a redirect.** A PM landing on a WP that someone else
  just approved sees the full decision history and the
  new status without being booted out.
- **Comment normalised to NULL for approved with blank
  input.** The CHECK only requires non-blank text for
  negative decisions; storing `""` or `"  "` on
  approved would be noise.
- **`recordDecision` returns `{ transitioned }` on
  success** even though the form doesn't display it.
  Parity with `addPhoto`; future surfaces (toast,
  analytics) can consume it without changing the
  action's shape.

### Open questions

- **PM separation-of-duties** still open per spec 02 (a
  PM who uploaded photos to a WP can still approve that
  WP). Documented v1 gap; not enforced here.
- **Authenticated UI E2E** still not added — same
  posture as the SA UI PRs; operator's manual smoke on
  a Vercel preview against `WP-TEST-001` is the
  verification step.
- **`next/image` for signed URLs.** Plain `<img>` again
  to avoid the `remotePatterns` dependency in this PR;
  revisit when a surface needs the optimization.
- **Decider names via admin lookup.** Narrow and
  defensible. If broader PM ↔ PM name visibility is
  needed, the right move is an RLS policy admitting
  privileged roles to read `users.full_name`, not more
  admin-client lookups.

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 68/68 passing (14 new + 54 existing).
- `pnpm build` — succeeds. All 12 routes compile,
  including the new `/pm` and
  `/pm/work-packages/[workPackageId]`.
- **End-to-end behaviour against the live remote DB is
  the operator's manual smoke** on a Vercel preview:
  load `/pm`, see `WP-TEST-001` in the queue, open the
  review screen, see the photos + decision history +
  form; record a `needs_revision` (comment required, WP
  stays in queue with the "Revision requested" pill);
  then record an `approved` (WP flips to `complete` via
  the guarded admin UPDATE and drops off the queue).

### Feature status — human flow

**The SA upload → PM approve human flow is now COMPLETE
end-to-end.** SAs upload Before/During/After photos
against a WP; the first After photo flips the WP to
`pending_approval` (spec 03 PR 2); PMs see the WP in
their queue, review the photos, and record a decision;
`approved` flips the WP to `complete` (this unit). Every
decision is preserved in `approvals` as an append-only
event; the WP's "current decision" is the row with
max(`decided_at`).

### Next units (not started)

- **Supersede-pattern skill update** (still deferred —
  re-flagged). The tombstone variant has had production
  consumers since spec 03 PR 2;
  [`.claude/skills/supersede-pattern/SKILL.md`](../.claude/skills/supersede-pattern/SKILL.md)
  still teaches only the replacement framing.
- **Watermark-on-demand rendering** (ADR 0003) — the
  next reader-side concern now that the PDF report has
  approved rows to filter on.
- **PDF report generation** — filters on the latest
  `approvals.decision = 'approved'` per WP, joins the
  current photos, and lays them out. Approved WPs from
  this unit are its first real input.
- **PM separation-of-duties guard** — documented gap;
  may land alongside another approvals-related unit.

---

## Unit: reports table + private reports Storage bucket

- **Status:** Complete — 2026-05-25.
- **Started / completed:** 2026-05-25.
- **Spec:** Provided inline by the operator. Schema-only
  unit — the Railway PDF worker and the PM report UI
  are separate later units.
- **Branch:** `feat/reports-table`.

### Locked behaviour

- `reports` is a **job record** for async PDF
  generation. A PM inserts a row at
  `status='requested'`; a Railway worker (service role)
  picks it up, generates the PDF, uploads to the
  `reports` Storage bucket, and updates the row to
  `complete` (with `storage_path`) or `failed` (with
  `error`).
- **Mutable** table — NOT append-only. The worker
  rewrites `status`, `storage_path`, `error`,
  `updated_at` in place. Shape mirrors `projects`
  (set_updated_at trigger + role-level RLS via
  `current_user_role()`), **not** the photo_logs /
  approvals triple-enforcement.
- **Access model (ADR 0013):**
  - SELECT: `project_manager` + `super_admin`. **Not
    `site_admin`** — SAs don't consume reports in v1.
    Load-bearing visibility split.
  - INSERT: `project_manager` + `super_admin`. Initial
    state (`status='requested'`, `storage_path=null`,
    `error=null`) is enforced by column defaults.
  - **No UPDATE policy.** App users cannot mutate
    reports through their own session. The Railway
    worker uses the service role, which bypasses RLS
    by design — that is the only mutation path.
  - **No DELETE policy.** Same archive-not-delete
    posture as projects / work_packages.
- **Reports bucket:** private, 50 MiB ceiling,
  `application/pdf` only. **No** `storage.objects`
  policies for the bucket — service-role-only access
  (worker writes; PM-report UI will mint signed URLs
  server-side via service role). Mirrors the
  photos-bucket posture (no broad authenticated SELECT
  / INSERT policies).

### Done

- **Migration**
  [`supabase/migrations/20260525000000_create_reports.sql`](../supabase/migrations/20260525000000_create_reports.sql):
  - `create type public.report_status as enum
('requested','processing','complete','failed');`
  - `create table public.reports (id uuid pk,
project_id uuid FK projects ON DELETE CASCADE,
status report_status default 'requested',
storage_path text null, error text null,
requested_by uuid FK users, created_at timestamptz
default now(), updated_at timestamptz default
now());`
  - `reports_set_updated_at` trigger attached to the
    existing `public.set_updated_at()` function (NOT
    redefined).
  - Indexes: `reports_project_id_idx` (plain, for the
    future PM UI's "list reports for project X"
    query) and `reports_active_status_idx` (partial on
    `status WHERE status in
('requested','processing')` for the worker's
    poll-for-work hot path; storage cost bounded to
    the in-flight job queue, not the full report
    archive).
  - RLS enabled; INSERT + SELECT policies via
    `public.current_user_role()` per ADR 0011 (never
    self-joining `public.users`).
  - Private `reports` bucket (idempotent
    `on conflict (id) do nothing`), 50 MiB,
    `['application/pdf']` MIME allowlist. No
    `storage.objects` policies — service-role-only by
    design.
- **`pnpm db:push`** clean apply.
- **`pnpm db:types`** regenerated — `reports` and
  `report_status` appear in
  [`src/lib/db/database.types.ts`](../src/lib/db/database.types.ts).
  The Supabase CLI's output is no-semicolons /
  single-quotes; the file diff is large purely from
  formatting, with the real change being the new
  `reports` Tables entry and the `report_status` enum
  entry.
- **pgTAP test**
  [`supabase/tests/database/12-reports.test.sql`](../supabase/tests/database/12-reports.test.sql)
  (42 assertions, mirroring the 07/08 mutable-table
  pattern + the 11 bucket-catalog pattern):
  - **Catalog (B, 24):** enum exists + four labels;
    table shape; every column's type / NULL / default;
    both FKs; the `set_updated_at` trigger; both
    indexes (including the partial one).
  - **RLS (C, 2):** `relrowsecurity = true`;
    `pg_policies` for `reports` enumerates EXACTLY
    `[INSERT, SELECT]` — no UPDATE, no DELETE.
  - **INSERT (D, 4):** super_admin and PM `lives_ok`;
    site_admin and visitor `throws_ok` 42501.
  - **SELECT (E, 4):** super_admin and PM see ≥1 row;
    **site_admin sees 0** (the load-bearing
    visibility split); visitor sees 0.
  - **No app UPDATE (F, 1):** PM UPDATE under their
    own session affects zero rows; the fixture row's
    `status` remains `'requested'`. Same pattern
    07-projects uses for "no DELETE policy" — assert
    on row state, not on errors, since RLS-filtered
    UPDATEs are silent.
  - **No app DELETE (G, 1):** super_admin DELETE
    affects zero rows; the fixture remains.
  - **set_updated_at trigger (H, 1):** `reset role` to
    postgres (mirroring the Railway worker's
    service-role context, the only mutation path),
    UPDATE the fixture, assert `updated_at` moved
    past the seeded `2020-01-01`.
  - **Bucket catalog (I, 5):** bucket row exists; is
    private; 50 MiB ceiling; `['application/pdf']`
    MIME allowlist; **no** `storage.objects` policies
    whose name starts with `reports` (the
    absence-of-policies invariant for the
    service-role-only posture).
  - 244/244 assertions across 12 files passing.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm
build` all green. Vitest still 68/68 (no app code
  touched in this unit — the table will be consumed by
  the worker and the future PM-report UI).

### Decisions made

- **Mutable-table pattern, not append-only.** A reports
  row's whole reason to exist is to be updated by the
  worker (requested → processing → complete | failed +
  storage_path or error). Triple-enforcement (REVOKE +
  no policies + trigger-raise) would have prevented
  the worker from doing its job. Instead the worker
  runs as service role and bypasses RLS; app users get
  the narrow INSERT-and-read RLS that prevents direct
  tampering with in-flight jobs.
- **Partial index on active statuses.** The worker
  polls "give me a row at `requested` or `processing`"
  on every cycle; the index's WHERE clause filters out
  the terminal `complete` / `failed` rows so the
  index stays small as the report archive grows.
  Plain `(status)` would still answer the query, but
  would bloat to the size of the archive over time.
- **`reset role` to postgres for the trigger test.**
  App users cannot UPDATE the table (correct
  behaviour), so the trigger's effect is only
  observable in a context that bypasses RLS — which
  is exactly the worker's running context. Testing
  under `postgres` (the runner's outer role) is the
  closest faithful simulation that pgTAP can express.
- **`error` column, not `error_message` / `last_error`
  / a separate `report_failures` table.** Spec asked
  for a single column with a short reason for
  debugging; one text column is the right grain for
  "what should the operator see when they peek at this
  row?". A separate failures-log table would be
  over-engineering for v1.
- **`storage_path` is `text`, not `text not null` with
  a sentinel.** Mirrors `photo_logs.storage_path`'s
  shape: NULL is the "no object yet" state. Initial
  rows have it NULL; the worker fills it on success
  and never on failure.

### Open questions

- **Worker auth / retry / poison-pill.** Out of scope
  for this PR. The Railway worker (separate unit) will
  decide: how to claim a job (presumably an UPDATE
  WHERE status='requested' RETURNING…), the retry
  policy on transient failures, the cap on retry count
  before terminal `failed`, and what `error` text
  looks like for the PM-facing UI. None of these
  change the schema.
- **Per-PM visibility scoping.** v1's SELECT policy
  admits every PM to every report. Same posture as
  the rest of the v1 domain tables — if cross-PM
  isolation becomes a requirement (external PM,
  etc.), the membership upgrade in ADR 0013 covers
  it.
- **Bucket lifecycle / retention.** Generated PDFs
  accumulate forever in v1. A future cleanup unit (or
  Supabase Storage lifecycle rules) can age them out;
  no v1 blocker.

### Verification

- `pnpm db:push` — clean.
- `pnpm db:types` — `reports` + `report_status`
  present.
- `pnpm db:test` — 244/244 across 12 files (42 new).
- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 68/68 (no app code changes; the table
  has no callers yet).
- `pnpm build` — succeeds. 12 routes unchanged.

### Next units (not started)

- **Railway PDF worker** — a new `/worker`
  subdirectory in this repo, deployed to Railway.
  Polls `public.reports` for rows at
  `status='requested'` under the service role, claims
  a row (UPDATE → status `processing`), gathers the
  project's `complete` WPs + their current After
  photos (current-photos helper semantics,
  server-side), generates the PDF, uploads to the
  `reports` Storage bucket, and updates the row to
  `complete` with `storage_path` (or `failed` with
  `error`). Decides its own retry / poison-pill
  policy.
- **PM report UI** — "Generate report" button on a
  project surface (inserts a `reports` row); status
  display of in-flight + recent jobs for the project;
  signed-URL download when `complete` (server-minted
  via service role, short TTL, same shape as the
  signed-URL helper at
  [`src/lib/photos/signed-urls.ts`](../src/lib/photos/signed-urls.ts)).
- **Supersede-pattern skill update** — still
  deferred, re-flagged. Tombstone variant has had
  production consumers since spec 03 PR 2; the skill
  still teaches only the replacement framing.
- **Watermark-on-demand rendering** (ADR 0003) — once
  the PDF worker exists, the watermark renderer can
  sit in front of the same signed-URL helper as a
  transformation step.
- **v2 deferrals (re-flagged):** PM image-curation
  per report; deliverable-grouping of WPs in the PDF;
  multi-project reports; watermark; Before / During
  photos in the report (v1 PDF is After-only,
  matching the spec-02 "what was approved" framing).
- **PM separation-of-duties guard** — documented v1
  gap; may land alongside another approvals-related
  unit.

---

## Unit: PDF report worker — local-first, isolated `/worker`, PDFKit, atomic job claim

- **Status:** Code built — 2026-05-25. NOT yet deployed
  to Railway (that's the next unit). Operator will
  verify locally next.
- **Started / completed:** 2026-05-25.
- **Spec:** Provided inline by the operator (continuation
  of the prior `reports` table unit).
- **Branch:** `feat/pdf-worker`.

### Locked design recap

- `/worker` is an **isolated deployable** sibling of the
  Next app: own `package.json`, own `node_modules`, own
  `pnpm-lock.yaml`, own copy of `database.types.ts`. The
  worker does NOT import from the app's `src/` — Railway
  will deploy with Root Directory = `/worker` and files
  outside that won't be in the bundle.
- Service-role Supabase client built locally (same shape
  as [`scripts/import-wp.ts`](../scripts/import-wp.ts)
  — separate-process scripts don't import the Next-
  coupled, `server-only`-guarded `src/lib/db/admin.ts`).
- PDF library: **PDFKit** (programmatic — no headless
  browser, no Chromium dep).
- Execution model: **run-once-and-exit**. A single
  `run()` claims jobs until the queue drains, then
  exits 0. Cron-friendly shape for Railway's eventual
  scheduled invocation. NOT an always-on loop in this
  unit.
- Atomic job claim via Postgres `FOR UPDATE SKIP
LOCKED` wrapped in a SECURITY DEFINER function
  (`public.claim_next_report()`), invoked from the
  worker via `supabase.rpc('claim_next_report')`.
  supabase-js can't express `FOR UPDATE SKIP LOCKED`
  directly through PostgREST, so the RPC is the
  natural carrier.

### Done

- **Migration**
  [`supabase/migrations/20260525010000_claim_next_report.sql`](../supabase/migrations/20260525010000_claim_next_report.sql):
  `public.claim_next_report()` — SECURITY DEFINER,
  `search_path = public` pinned, RETURNS SETOF
  `public.reports`. Body is one UPDATE that picks a
  single eligible row via `select … where status =
'requested' order by created_at limit 1 for update
skip locked`, flips it to `processing` and bumps
  `updated_at`, RETURNing the claimed row. EXECUTE is
  REVOKEd from PUBLIC **and** from `authenticated, anon`
  (Supabase's default privileges grant new public
  functions EXECUTE to authenticated; the revoke from
  PUBLIC alone wasn't enough — discovered when the
  pgTAP "authenticated cannot execute" assertion
  failed first). Granted to `service_role` only.
- **pgTAP test**
  [`supabase/tests/database/13-claim-next-report.test.sql`](../supabase/tests/database/13-claim-next-report.test.sql)
  (10 assertions). Proves: function exists; is
  SECURITY DEFINER; `search_path = public` pinned;
  `authenticated` cannot execute (42501); FIFO claim
  by `created_at` across three calls; each claim
  flips its target to `processing`; a fourth call on
  an empty queue returns zero rows; a pre-existing
  `complete` row is never touched.
- **`pnpm db:push`** clean; **`pnpm db:types`**
  regenerated (the function now shows up in
  [`src/lib/db/database.types.ts`](../src/lib/db/database.types.ts)
  too — fine, app-side is read-only on it via
  type-only references); **`pnpm db:test`** 254/254
  across 13 files (10 new).
- **`/worker` subdirectory** — own project:
  - [`worker/package.json`](../worker/package.json)
    — `type: module`, `pnpm@10.33.0`, deps
    `@supabase/supabase-js` + `pdfkit`, dev deps
    `@types/node` + `@types/pdfkit` + `tsx` +
    `typescript` + `vitest`. Scripts: `start =
tsx src/index.ts` (Railway uses this; reads
    `process.env` directly), `dev = tsx
--env-file=../.env.local src/index.ts` (local
    convenience that shares the Next app's
    `.env.local`), `typecheck = tsc --noEmit`,
    `test = vitest run`.
  - [`worker/tsconfig.json`](../worker/tsconfig.json)
    — strict, `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes`, `noImplicitOverride`
    (matches root strictness). `target: ES2022`,
    `module: esnext`, `moduleResolution: bundler`,
    `types: ["node"]`.
  - [`worker/src/database.types.ts`](../worker/src/database.types.ts)
    — copy of the app's
    `src/lib/db/database.types.ts`. The dual-copy
    is required by Railway's Root-Directory =
    `/worker` deploy shape. The regen rule is
    documented in
    [`worker/README.md`](../worker/README.md): when
    the schema changes, run `pnpm db:types` at the
    root and then `cp src/lib/db/database.types.ts
worker/src/database.types.ts`.
  - [`worker/src/supabase.ts`](../worker/src/supabase.ts)
    — `createServiceRoleClient()` builds the
    service-role client from `process.env`
    (`SUPABASE_URL` falling back to
    `NEXT_PUBLIC_SUPABASE_URL` for local
    `.env.local` sharing; `SUPABASE_SERVICE_ROLE_KEY`).
    Throws clearly if either var is missing.
  - [`worker/src/report.ts`](../worker/src/report.ts)
    — pure PDFKit composition. NO I/O. Takes a
    `ReportInput` (project metadata + array of
    `{code, name, afterPhotos: Buffer[]}` for the
    complete WPs) and returns a PDF buffer. Header
    line per project, one page per WP with its
    After photos at `fit: [500, 500]`. WPs with
    zero After photos are skipped defensively even
    though `index.ts` also pre-filters them.
  - [`worker/src/index.ts`](../worker/src/index.ts)
    — the run-once entry point. Calls
    `claim_next_report()` in a loop; for each
    claimed job: fetches the project, its
    `complete` work_packages, every
    `photo_logs` row per WP (then filters to
    current After in JS — same anti-join +
    tombstone-filter shape as
    [`src/lib/photos/current-photos.ts`](../src/lib/photos/current-photos.ts),
    duplicated here because of the isolated-deploy
    constraint), downloads each photo from the
    `photos` bucket via the service-role client,
    builds the PDF, uploads to the `reports`
    bucket at `{project_id}/{report_id}.pdf`,
    and marks the row `complete` with the
    `storage_path`. On any error during a job,
    marks the row `failed` with a truncated
    error message and continues — one bad job
    can't kill the batch.
  - [`worker/tests/unit/report.test.ts`](../worker/tests/unit/report.test.ts)
    — 3 vitest unit tests against `buildReportPdf`:
    the output is a valid PDF buffer (starts with
    `%PDF`); a WP with no After photos is skipped
    (PDF size strictly smaller than the with-photo
    version); an empty project still produces a
    valid header-only PDF.
  - [`worker/vitest.config.ts`](../worker/vitest.config.ts)
    — minimal: node env, `tests/unit/**`.
  - [`worker/README.md`](../worker/README.md) —
    docs the run-once model, local-run command,
    required env vars, regen rule for
    `database.types.ts`, and the root-isolation
    surface.
- **Root isolation from `/worker`** (so the root
  `pnpm lint && typecheck && test && build` still
  passes and never touches the worker):
  - [`tsconfig.json`](../tsconfig.json) — added
    `"worker"` to `exclude`.
  - [`eslint.config.mjs`](../eslint.config.mjs) —
    added `"worker/**"` to `globalIgnores`.
  - [`.prettierignore`](../.prettierignore) — added
    `worker/`.
  - [`.gitignore`](../.gitignore) — added
    `/worker/node_modules`.
  - `vitest.config.ts` and the Next build don't
    need changes: the vitest `include` patterns
    already scope to `tests/unit/**` +
    `tests/integration/**` at the root, and
    Next.js routes from `src/app/`.
- **Verification:**
  - Worker: `pnpm exec tsc --noEmit` clean;
    `pnpm exec vitest run` 3/3 passing.
  - Root: `pnpm lint` clean; `pnpm typecheck`
    clean; `pnpm test` 68/68 (unchanged — no
    app code touched); `pnpm build` 12 routes
    succeeds; `pnpm db:test` 254/254 across 13
    files.

### Decisions made / things to report

- **pnpm vs npm for `/worker`.** Chose **pnpm**
  (consistent with the rest of the repo; the
  worker carries its own `pnpm-lock.yaml`).
  Installs use `pnpm install
--ignore-workspace` because the root
  `pnpm-workspace.yaml` (which exists for the
  `allowBuilds` config) would otherwise make
  pnpm treat the worker as part of the root
  workspace and skip the worker's local install.
  `--ignore-workspace` keeps the worker's
  install / lockfile fully separate. Documented
  in `worker/README.md`.
- **Root-isolation surface.** Listed above. The
  smallest possible set of changes that prevents
  the root tooling from picking up `/worker`: one
  `exclude` entry in `tsconfig`, one
  `globalIgnores` entry in eslint, one line in
  `.prettierignore`, one line in `.gitignore`.
  No restructuring of the root's pnpm workspace,
  no changes to `vitest.config.ts` (its include
  patterns are already scoped to `tests/`), no
  changes to Next.js config (routes come from
  `src/app/`).
- **Privilege denial discovered during pgTAP.**
  The first migration only had `revoke execute …
from public`. Supabase's default privileges
  additionally grant new public-schema functions
  EXECUTE to `authenticated`, so the denial
  assertion failed (no exception was raised; the
  RPC actually claimed a row from the test
  fixtures). Fixed by adding `revoke execute on
function public.claim_next_report() from
authenticated, anon` to the migration. The
  failing test's side-effect of consuming a row
  also masked the FIFO assertions — adding the
  revoke fixed all four failures in one go.
- **`database.types.ts` dual-copy + regen rule.**
  Required by the isolated-deploy shape; both
  copies must move together. Documented in the
  worker README and re-flagged here.
- **No Railway artifacts in this PR.** No
  `Dockerfile`, no `railway.toml` — those land
  with the deploy unit. The spec explicitly
  permitted a small marker file if helpful; we
  didn't add one because the worker's `pnpm
start` script + Railway's auto-detection of
  Node projects with a `package.json` should be
  enough to wire up the deploy without a config
  file in this unit.

### v2 deferrals (re-flagged)

- **Watermark on rendered photos** (ADR 0003) —
  originals are stored unmodified; the
  watermark layer sits between the worker and
  PDFKit, not before storage. Not built here.
- **Before / During photos in the PDF.** v1 is
  After-only — the "what was approved"
  framing from spec 02. Adding Before / During
  is a render-side change in `report.ts` plus
  matching fetches in `index.ts`.
- **PM image curation per report.** Today the
  worker takes every current After photo. Image
  curation (PM picks the subset that ships in
  this particular report) is its own data model
  change (likely a `report_photos` join table)
  - its own UI.
- **Deliverable-grouping of WPs.** Today every
  complete WP becomes its own page. Grouping
  WPs by deliverable / area / phase is a
  presentation-layer change once the WP data
  model carries the grouping field.
- **Stale-`processing` recovery.** If a worker
  process crashes mid-job, the row stays at
  `processing` forever. v2 should add either a
  reaper job (resurrect rows whose
  `updated_at` is older than some threshold) or
  a heartbeat column. Not built here.
- **Always-on worker loop.** The run-once shape
  is intentional — Railway cron drives it. If
  we need always-on later, that's a trivial
  while(true)+sleep wrapper around `run()`.

### Operator follow-up (next steps in chat)

1. Operator runs `cd worker && pnpm install
--ignore-workspace` (one time per machine),
   then `pnpm dev` to do a local end-to-end
   smoke against the linked Supabase project.
   Insert a `reports` row with `status =
'requested'` for an existing project that has
   `complete` WPs with current After photos,
   then run the worker, then check that the
   row is `complete` with a `storage_path`
   pointing at `{project_id}/{report_id}.pdf`
   in the `reports` bucket.
2. After local verification, the next unit
   wires up Railway: a small Dockerfile or
   `railway.toml` if needed, the env vars on
   Railway, the cron schedule.

### Next units (not started)

- **Railway deployment of the PDF worker** —
  the next unit. Dockerfile / `railway.toml`,
  env vars in Railway, cron schedule, optional
  log-drain wiring.
- **PM report UI** — "Generate report"
  button (inserts a `reports` row); status
  display of in-flight + recent jobs; signed-
  URL download when `complete`.
- **Supersede-pattern skill update** — still
  deferred; tombstone variant has had
  production consumers since spec 03 PR 2.

---

## Unit: PM report generation UI with status polling and download

- **Status:** Complete — 2026-05-25. **The v1
  in-app feature set is COMPLETE end-to-end:**
  SA upload → PM approve → PM generate + download
  PDF report.
- **Started / completed:** 2026-05-25.
- **Spec:** Provided inline by the operator.
- **Branch:** `feat/pm-report-ui`.

### Locked behaviour

- Reports are per-project (all complete WPs' current
  After photos — the worker already handles
  generation; this UI just requests + displays).
- Navigation: PM project list at
  [`/pm/projects`](../src/app/pm/projects/page.tsx)
  → per-project report surface at
  [`/pm/projects/[projectId]/reports`](../src/app/pm/projects/[projectId]/reports/page.tsx).
- Reports page: a project context card, a "Generate
  report" button, and a list of this project's
  reports (newest first) with status pills and
  per-row Download (when `complete`) / error
  message (when `failed`).
- Access: `requireRole(["project_manager",
"super_admin"])` on both pages. **`site_admin`
  is intentionally excluded** — matches the
  `reports` table SELECT/INSERT policy from the
  reports-table unit.
- Auto-poll while any visible report is `requested`
  or `processing`; STOPS as soon as every report
  is terminal. ~12s interval (the Railway cron
  cadence is ~5 min — 12s surfaces state changes
  within one screen-look without spamming).

### Done

- **Pure predicates** at
  [`src/lib/reports/predicates.ts`](../src/lib/reports/predicates.ts):
  `REPORT_IN_FLIGHT_STATUSES` (= `['requested',
'processing']`), `isReportInFlight(status)`,
  `canGenerateReport(existingStatuses)` (returns
  false iff any existing report is in-flight),
  `REPORT_STATUS_LABEL` (Queued / Generating /
  Ready / Failed). Same shape as
  `src/lib/approvals/predicates.ts` — predicate
  decides, server action reinforces.
- **Unit tests** at
  [`tests/unit/reports-predicates.test.ts`](../tests/unit/reports-predicates.test.ts)
  (10 assertions): in-flight set membership;
  every-terminal allows generate; any in-flight
  blocks generate; status label coverage and
  distinctness.
- **Server actions** at
  [`src/app/pm/projects/[projectId]/reports/actions.ts`](../src/app/pm/projects/[projectId]/reports/actions.ts):
  - **`generateReport({ projectId })`** — validates
    role + project exists (under user RLS) + the
    duplicate guard (fetches every report row for
    the project, applies `canGenerateReport`),
    then INSERTs a `reports` row under the user's
    SSR session (column defaults supply
    `status='requested'`, `storage_path=null`,
    `error=null`; RLS WITH CHECK gates the
    insert). Revalidates the reports page on
    success. Returns a discriminated `{ ok: true
} | { ok: false; reason: string }`.
  - **`getReportDownloadUrl({ reportId })`** —
    role check; reads the report under user RLS
    (the SELECT policy is the visibility
    contract); refuses if not `complete` /
    missing `storage_path`; otherwise mints a
    120s signed URL via the admin client against
    the private `reports` bucket. Mirrors
    [`src/lib/photos/signed-urls.ts`](../src/lib/photos/signed-urls.ts).
    Returns `{ ok: true; url: string } | { ok:
false; reason: string }`. The admin client
    never reaches the browser; only the URL
    string crosses.
- **`/pm/projects`** at
  [`src/app/pm/projects/page.tsx`](../src/app/pm/projects/page.tsx):
  Server Component. `requireRole(PM/super)`,
  lists projects under user RLS (code + name +
  status pill), each card links to that
  project's reports. Empty / error states match
  the existing `/pm` queue shape. Includes the
  nav strip from this unit's nav requirement.
- **`/pm/projects/[projectId]/reports`** at
  [`src/app/pm/projects/[projectId]/reports/page.tsx`](../src/app/pm/projects/[projectId]/reports/page.tsx):
  Server Component. Renders the project context
  card, the Generate button (with the
  initially-disabled hint computed server-side
  from `canGenerateReport`), and the reports
  list. Fetches reports under user RLS ordered
  by `created_at desc`.
- **Client components** in the same route folder:
  - [`generate-report-button.tsx`](../src/app/pm/projects/[projectId]/reports/generate-report-button.tsx)
    — calls `generateReport`, surfaces pending
    state and the duplicate-guard message, calls
    `router.refresh()` on success so the new row
    appears.
  - [`reports-list.tsx`](../src/app/pm/projects/[projectId]/reports/reports-list.tsx)
    — renders the per-report rows (status pill,
    created-at, Download or error text);
    auto-polls with `router.refresh()` while any
    visible report is in-flight, clearing the
    interval when the snapshot drains.
    Download click calls
    `getReportDownloadUrl` and `window.open`s
    the signed URL in a new tab.
- **Nav** — added a thin nav strip to
  [`src/app/pm/page.tsx`](../src/app/pm/page.tsx)
  pointing to `/pm/projects`, mirrored on both
  new pages with reciprocal links (Review queue
  ↔ All projects ↔ specific project's reports).

### Decisions made

- **Auto-poll approach (`router.refresh()` on
  interval).** A single `setInterval` in the
  reports-list client component re-renders the
  Server Component every 12 s while any visible
  report is in-flight; the Server Component
  re-fetches `reports` under the user's RLS, so
  the worker's status flips reach the screen
  without a manual reload. The interval is
  cleared as soon as the server snapshot shows
  no in-flight rows (and on unmount). Picked
  over a dedicated `/api/status` route to keep
  the surface small — the Server Component is
  already the authority on what the page
  displays; polling it directly avoids a
  parallel JSON surface that could drift.
- **Status-pill colours.** Reused the same
  palette as the approval pills (zinc for
  neutral / queued, amber for in-progress,
  emerald for terminal-success, red for
  failed). Keeps the two surfaces visually
  consistent.
- **No new shadcn primitives added.** The
  Generate button and Download button are
  plain `<button>` tags styled inline — matches
  the existing
  [`record-decision-form.tsx`](../src/app/pm/work-packages/[workPackageId]/record-decision-form.tsx)
  submit button style. The status pills are
  the same inline-pill pattern the `/pm` queue
  uses. Adding a shadcn `<Badge>` would have
  bought nothing concrete and forked the
  approval / report aesthetics.
- **Server-rendered "initially disabled" hint.**
  When the page loads with an in-flight report
  already present, the Generate button starts
  disabled with the duplicate-guard reason
  shown — saves a wasted server-action
  round-trip while the snapshot is stale. The
  server action is the load-bearing
  authoriser; the disabled hint is purely UX.
- **Signed-URL TTL is 120 s.** Mirrors
  `signed-urls.ts` for photos. Long enough for
  the browser to start the download after the
  user clicks; short enough that a leaked URL
  has limited value.
- **No image curation, no Before/During in the
  report.** Spec-locked v2.

### Feature status — full v1 flow

**SA upload → PM approve → PM generate +
download report is now COMPLETE end-to-end in
the app.** SAs upload Before/During/After
photos against a WP; the first After photo
flips the WP to `pending_approval`; PMs review
the photos and record a decision (`approved`
flips the WP to `complete`); PMs then
generate a per-project PDF report (worker
gathers the complete WPs' current After
photos, builds the PDF, uploads it); PMs
download the finished PDF via signed URL.
Every step is RLS-gated, audit-logged via
append-only / supersede semantics where
appropriate, and stays within the v1 role
matrix (no membership table; ADR 0013).

### Remaining v1 work (no in-app gap — these

are pilot-readiness + polish)

1. **Real WP-data import.** The CSV importer
   exists (`pnpm import:wp`) but the pilot's
   real two-project WP lists haven't been
   loaded yet.
2. **Real user onboarding.** Each pilot user
   logs in via LINE once so their `public.users`
   row gets created, then a super_admin
   promotes them to their role.
3. **End-to-end dry run with real Railway
   worker.** This unit's UI was verified
   locally against the worker run-by-hand
   (`cd worker && pnpm dev`); once the Railway
   cron is wired up the same UI should work
   untouched.
4. **Optional `worker/railway.toml`.**
   Reproducible deploy config alongside the
   Railway deployment unit. Not strictly
   necessary (Railway auto-detects Node), but
   worth committing for repeatability.

### v2 candidates (re-flagged + one new)

- **NEW: LINE profile picture / display name
  refresh via the LINE Login `profile` scope.**
  Add `profile` to the OAuth scope list at
  [`/auth/line/start`](../src/app/auth/line/start/route.ts);
  call LINE's `/v2/profile` (or read it from
  the ID token's `picture` claim if it's
  included with `profile` scope) in
  [`/auth/line/callback`](../src/app/auth/line/callback/route.ts);
  add an `avatar_url text` column to
  `public.users` and populate it NULL-only the
  same way `line_user_id` / `full_name` are
  populated today. Cosmetic polish — gives
  the approval queue and report-list surfaces
  a small avatar next to the decider's name.
  Not pilot-critical. **Source-technique
  caveat:** the original article describing
  this is a Messaging-API/bot + Google-Sheets
  pattern; only the Login-scoped profile
  fetch fits our OAuth architecture — the
  webhook / Sheets machinery does not apply
  here. Drop it from any future copy-paste.
- **Supersede-pattern skill update** — still
  deferred; tombstone variant has had
  production consumers since spec 03 PR 2.
- **Watermark on rendered photos** (ADR 0003).
- **Before / During photos in the PDF**
  (v1 report is After-only).
- **PM image curation per report** (subset
  selection before generate).
- **Deliverable-grouping of WPs** in the PDF.
- **Stale-`processing` recovery** for crashed
  workers.
- **Separation-of-duties guard** so a PM who
  uploaded photos to a WP cannot approve
  that WP themselves (documented v1 gap).

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — **78/78** (up from 68/68; the
  10 new assertions are the reports-predicates
  tests).
- `pnpm build` — 14 routes (was 12; added
  `/pm/projects` and
  `/pm/projects/[projectId]/reports`).
- End-to-end local verification by the
  operator: load `/pm` → "Projects & reports"
  link → click a project → "Generate report"
  → watch the auto-poll flip the row from
  Queued → Generating (when the worker runs
  locally) → Ready, then click Download and
  see the PDF.

---

## Unit: format report generated-date as human-readable

- **Status:** Complete — 2026-05-25. Worker-only
  polish. Auto-redeploys to Railway on push
  (Watch Paths = `worker/**`).
- **Started / completed:** 2026-05-25.
- **Spec:** Provided inline by the operator.
- **Branch:** `chore/report-date-format`.

### Done

- Extracted a tiny `formatGeneratedDate(date)`
  helper in
  [`worker/src/report.ts`](../worker/src/report.ts)
  using `Intl.DateTimeFormat('en-GB', { day:
'numeric', month: 'long', year: 'numeric',
timeZone: 'UTC' })` — yields strings like
  `"24 May 2026"` / `"1 June 2026"` (day,
  full month name, year; no time, no
  timezone label). The PDF header line now
  reads `Generated: 24 May 2026` instead of
  `Generated: 2026-05-24T18:40:38.171Z`.
- Two assertions appended to
  [`worker/tests/unit/report.test.ts`](../worker/tests/unit/report.test.ts)
  cover the formatter shape (`24 May 2026`,
  `1 June 2026`). Worker test count 3 → 5.
- No date library added (no dayjs / date-fns).
- Only the display changed — the timestamp
  source (`new Date()` in
  [`worker/src/index.ts`](../worker/src/index.ts))
  is untouched.

### Decisions made

- **Pinned `timeZone: 'UTC'` in the formatter.**
  The same `Date` must render to the same
  string regardless of which timezone the
  process runs in. Railway Linux containers
  default to UTC; local dev (Asia/Bangkok)
  doesn't. Without a pinned zone, a generate
  shortly after midnight UTC would render as
  one date on Railway and a different date if
  re-run locally. UTC is the safest portable
  choice and is documented in the helper's
  comment. If a future report-recipient
  audience prefers Asia/Bangkok, swapping the
  `timeZone` string is a one-line change with
  matching test updates.
- **Helper exported, not inlined.** Lets the
  format be asserted directly in the unit
  tests rather than parsing it back out of
  the PDF bytes.

### Verification

- `cd worker && pnpm exec tsc --noEmit` clean.
- `cd worker && pnpm exec vitest run` 5/5
  passing.
- Root: `pnpm lint && pnpm typecheck && pnpm
test && pnpm build` all green (worker is
  excluded from root tooling, so this is a
  no-op for the app — confirming it stays
  one).
- Operator verification: generate a fresh
  report after the Railway redeploy and
  check the PDF header.

---

## Unit: v1 go-live / dry-run checklist (docs-only)

- **Status:** Complete — 2026-05-26. Docs-only;
  no code, no schema.
- **Started / completed:** 2026-05-26.
- **Spec:** Provided inline by the operator.
- **Branch:** `docs/go-live-checklist`.

### Done

- New runbook at
  [`docs/go-live-checklist.md`](./go-live-checklist.md)
  — the operator's step-by-step for taking
  the two pilot projects live, validating
  end-to-end with real users, and signing
  off. Sections (in order): current state;
  pre-go-live test-data cleanup (highest-
  risk step); user onboarding & role
  promotion; per-project WP adjustments;
  the dry-run script (both approval paths +
  report download); known v1 limitations to
  communicate to pilot users; rollback /
  where-to-look notes; consolidated v2
  backlog.
- The **real pilot WP data is already
  loaded** for both projects (81 WPs each):
  - `PRC-2026-001` — TFG Lam Sonthi.
  - `PRC-2026-002` — TFG Kham Muang.
- The **outstanding test-data cleanup** is
  recorded in the checklist as the highest-
  risk step, with the verified inventory:
  `WP-TEST-001` id
  `eaa45bd1-2990-4097-8e9b-2041d0335760`
  under PRC-2026-001; its 7 `photo_logs`
  rows (4 real / 3 tombstones) listed by
  short id; its 1 `approvals` row
  `90cfa068…`; 3 test `reports` rows
  `7887e9eb…`, `5bdbabc4…`, `1bda8473…`; 4
  photo objects under
  `c2cc7c02-…/eaa45bd1-…/` in the `photos`
  bucket; 3 PDF objects in the `reports`
  bucket. PRC-2026-002 is presumed clean;
  the checklist's pre-cleanup verify step
  catches anything missed.

### Decisions made

- **Cleanup SQL is NOT in the checklist.**
  The `photo_logs` / `approvals` block-write
  triggers (P0001 on UPDATE/DELETE) plus
  the `work_packages → photo_logs` `ON
DELETE CASCADE` interaction mean a stale
  or loosely-remembered DELETE will fail in
  unexpected ways. The checklist describes
  WHAT to delete and the ORDER (children →
  parent, FK-safe), names the
  trigger-bypass requirement (`DISABLE
TRIGGER USER` inside a single
  `BEGIN/COMMIT` block under the Supabase
  SQL editor / service role), and routes
  the actual SQL composition to a focused
  session with Claude against the
  verified-live schema. Encoding the SQL
  into the doc would invite copy-paste of
  stale assumptions later.
- **Section ordering: cleanup BEFORE
  onboarding.** Onboarding real users
  before the test-data is removed would
  mean those users' first-touch screens
  carry test state (test WP in the SA
  list, test report in the PM list).
  Cleanup must precede onboarding so the
  first impression is clean.
- **LINE profile picture v2 candidate**
  consolidated into the doc's v2 backlog
  alongside the other deferred items. The
  source-technique caveat (the article it
  came from is a Messaging-API + Sheets
  pattern; only the Login-scoped profile
  fetch fits our OAuth architecture) is
  preserved verbatim.
- **No per-WP-divergence path in v1.** The
  importer is error-on-conflict
  (`src/lib/wp-import/parse.ts:70`); the
  checklist documents the
  add-new-codes-only path and explicitly
  flags bulk per-project WP edits as v2
  back-office territory.

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 78/78 (docs-only change;
  no test surface touched).

### Open questions

None blocking. Surfaced for the record:

- **Who runs the cleanup window?** Only
  the operator (super_admin). Schedule it
  for a quiet hour and treat it as a
  deliberate maintenance window.
- **When does the project-membership
  upgrade (ADR 0013) land?** Triggered by
  the first external account
  (PM/subcon/customer) — not by a
  calendar date. The checklist sets
  expectations on this so pilot users
  aren't surprised when an external joins
  later.

### Next units (not started)

The checklist's Section 7 is the canonical
v2 backlog. Re-listed here for completeness:

- Deliverable grouping in reports (schema +
  importer + PDF layout; source CSVs
  already carry `DeliverableID` D01–D30,
  ready to backfill).
- PM image curation per report.
- Multi-project reports.
- Watermark-on-demand rendering (ADR 0003).
- Before / During photos in reports.
- Stale-`processing` sweep for crashed
  worker jobs.
- LINE profile picture / display-name
  refresh via the Login `profile` scope.
- In-app admin UI for visitor promotion
  (ADR 0010 trigger).
- Airtable-like WP back-office + WP edit /
  remove UI.
- Separation-of-duties guard on approvals
  (documented spec-02 gap).
- Project-membership scoping (ADR 0013
  upgrade path) when the first external
  account joins.
- Optional `worker/railway.toml` for
  reproducible deploy config.
- Supersede-pattern SKILL tombstone
  update (re-flagged from spec 02 PR 1).

---

## Unit: SA status pills color-coded + "Hide completed" toggle

- **Status:** Complete — 2026-05-26. Two of
  the four operator-requested polish items
  done; the remaining two (a super_admin
  navigation hub, and user profile
  management — the latter needs its own
  design pass + likely an ADR for a
  column-scoped users write policy) are
  the next units.
- **Started / completed:** 2026-05-26.
- **Spec:** Provided inline by the operator.
- **Branch:** `feat/sa-status-colors-and-filter`.

### Done

- **Shared status-color helper** at
  [`src/lib/status-colors.ts`](../src/lib/status-colors.ts):
  `projectStatusPillClasses(status)` and
  `workPackageStatusPillClasses(status)`.
  Both are pure, typed, and exhaustive on
  the enum unions via a `const _exhaustive:
never = status` check in the default
  branch — adding a new enum value to the
  database fails TypeScript here, exactly
  where the map needs updating.
- **Palette identical to the existing PM
  pills** (zinc / amber / emerald) plus a
  fourth muted slot for `archived`. PM
  files were NOT touched — the helper just
  hard-codes the same class strings.
- **Project-status mapping:**
  `active` → zinc (resting default — most
  projects sit here, no reason for every
  row to scream); `on_hold` → amber
  (paused, needs attention); `completed` →
  emerald (positive terminal); `archived`
  → muted zinc (`border-zinc-800
bg-zinc-900 text-zinc-500`, drops back
  visually from active rows).
- **Work-package-status mapping:**
  `not_started` → zinc; `in_progress` /
  `on_hold` / `pending_approval` → amber
  (all three are "in flight" from the
  SA's perspective; the pill text label
  differentiates them precisely);
  `complete` → emerald.
- **Helper applied to**
  [`src/app/sa/page.tsx`](../src/app/sa/page.tsx)
  (project list — the status pill on each
  card) and
  [`src/app/sa/projects/[projectId]/work-package-list.tsx`](../src/app/sa/projects/[projectId]/work-package-list.tsx)
  (WP list — the per-row status pill).
- **"Hide completed" toggle** added next
  to the existing text-filter input on the
  WP list. **Default OFF** so nothing
  disappears unless the user opts in.
  Composes with the text filter: a WP is
  shown iff it matches the text query AND
  isn't hidden by the toggle. Empty-state
  copy picks the most specific message
  ("No work packages yet." / "All work
  packages are complete." / "No matching
  work packages."). Client-side state
  (this was already a Client Component),
  no URL or server round-trip.
- **Unit tests** at
  [`tests/unit/status-colors.test.ts`](../tests/unit/status-colors.test.ts)
  drive every enum value through both
  helpers (via the generated
  `Constants.public.Enums.*` arrays — adding
  a new enum value automatically extends
  the test surface), assert the unknown-
  value default path is non-empty, and pin
  the load-bearing palette choices
  (`complete` / `completed` → emerald;
  `on_hold` → amber; in-flight WP states
  → amber; `not_started` → zinc). 16 new
  assertions; total 78 → 94.

### Decisions made

- **Label `Record<string, string>`, not
  `Record<ProjectStatus, string>`.** The
  Supabase row's `status` column widens to
  `any` at the call site (column-list
  `.select(...)` doesn't preserve the
  enum union through to the React JSX in
  the same predictable way the WP list's
  typed props interface does), so a typed
  Record fails `noUncheckedIndexedAccess`
  on `record[any]`. The label map is
  decorative; the load-bearing
  exhaustiveness lives in the color
  helper. Kept the label map as the
  established `Record<string, string>`
  pattern the rest of the repo uses, and
  let the helper carry the strictness.
- **PM pills untouched.** The helper just
  emits the same Tailwind class strings
  the PM pills already use, so SA and PM
  match without restyling the PM
  surfaces. A future "extract the pill
  component" refactor can fold both
  sides in, but it's out of scope here.
- **Default OFF for "Hide completed"**
  per spec. The operator's principle
  (nothing disappears unless asked)
  matters more for an SA on a phone
  scanning their WPs than the
  power-user convenience of having
  completed ones already gone.
- **Three amber WP states is fine.**
  `in_progress` / `on_hold` /
  `pending_approval` all carry the same
  amber pill; the text label is the
  precise signal. Trying to invent a
  fourth color (yellow, orange) to
  separate them would fork from the PM
  palette and lose the consistency
  this unit is buying.

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean (after
  reverting the typed label record on
  sa/page.tsx — see decisions).
- `pnpm test` — **94/94** (78 → 94; 16
  new assertions for status-colors).
- `pnpm build` — 14 routes, unchanged.
- Operator visual verification: load
  `/sa`, see project pills colored;
  open a project, see WP pills colored;
  toggle "Hide completed" on a project
  with completed WPs, confirm they
  disappear (and reappear when off);
  cross-check `/pm` queue + reports
  list to confirm the SA and PM
  palettes match.

### Next units (not started — operator's

remaining polish items)

- **Super_admin navigation hub.** A
  small landing for the super_admin
  role (currently SAs land on `/sa`,
  PMs on `/pm`, super_admins go
  wherever their last destination
  was). Likely a `/super` route with
  cross-links to both `/sa` and `/pm`
  surfaces plus any admin-only future
  destinations.
- **User profile management** (display
  name, etc.). Needs its own design
  pass and likely an ADR for the RLS
  shape — letting a user update their
  own `public.users` row is a
  column-scoped write that doesn't
  exist in v1 (the current model is
  "admin-client writes from the
  callback, NULL-only"). The ADR
  must cover which columns are
  user-writable and which stay
  admin-only.

---

## Unit: super_admin operator hub on /coming-soon

- **Status:** Complete — 2026-05-26.
  Closes the third of four operator
  polish items. The last remaining
  item is **user profile management**
  (still needs its own design pass +
  ADR for a column-scoped
  `public.users` write policy).
- **Started / completed:** 2026-05-26.
- **Spec:** Provided inline by the
  operator.
- **Branch:** `feat/super-admin-hub`.

### Done

- Added a `super_admin` render branch
  to
  [`src/app/coming-soon/page.tsx`](../src/app/coming-soon/page.tsx).
  When the authenticated user's role
  is `super_admin`, the page now
  renders an **Operator console** hub
  with three labelled link cards:
  - `/sa` — "Site admin / Project
    list, work packages, photo
    upload."
  - `/pm` — "Approval queue / Work
    packages awaiting PM review."
  - `/pm/projects` — "Projects &
    reports / Generate and download
    project PDF reports."
- The existing `LogoutButton` stays
  at the bottom of the hub.
- Every other role (`visitor`,
  `project_coordinator`,
  `procurement`, `technician`, `hr`,
  `subcon_manager`, `accounting`)
  renders **exactly as before** —
  same generic "tools for your role
  aren't ready yet" copy + role label
  - logout. The branch falls through
    to the original render when
    `role !== "super_admin"`.
- Existing early-redirects unchanged:
  `site_admin` still redirects to
  `/sa`, `project_manager` still
  redirects to `/pm` — those roles
  never see this page.
- **Confirmed during the work that
  `/sa`, `/pm`, and `/pm/projects`
  already admit `super_admin` via
  their existing `requireRole()`
  guards** (`["site_admin",
"project_manager", "super_admin"]`
  on `/sa`; `["project_manager",
"super_admin"]` on `/pm` and
  `/pm/projects`). No `requireRole`
  change in this unit; the hub is
  purely a render branch.

### Decisions made

- **Hub lives at `/coming-soon`,
  not a new `/admin` route.**
  `roleHome("super_admin")` sends
  super_admins to `/coming-soon`
  today (per
  `src/lib/auth/role-home.ts`). A
  separate `/admin` route would
  duplicate the role-home plumbing
  and force every super_admin login
  redirect through a new code path;
  folding the hub into the existing
  `/coming-soon` branch keeps the
  diff to a single page file.
- **No `<OperatorHub>` component
  extraction.** Kept it as a local
  function in the same file —
  one use site, no reuse benefit,
  and pulling it into
  `src/components/` would fork the
  file structure for no gain.
- **Plain `next/link`, prefetching
  fine.** These are internal app
  links with no state-changing
  side effects; no need for the
  CSRF-shielded `<a>` pattern the
  login button uses.
- **No `requireRole` change.** The
  spec was explicit: STOP if any
  target didn't admit super_admin
  rather than relaxing auth. All
  three already admit it — verified
  by direct re-read of the
  `requireRole(...)` arrays.

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — **94/94** (no test
  surface touched; presentational
  change only).
- `pnpm build` — 14 routes,
  unchanged.
- Operator visual verification: log
  in as a super_admin LINE account,
  confirm the hub appears on
  `/coming-soon` with three
  working link cards + logout. Log
  in as a `visitor` LINE account
  (or any other unserved role),
  confirm the page renders the
  unchanged generic copy. Confirm
  SA / PM accounts still bounce to
  `/sa` / `/pm` and never see the
  hub.

### Next units (not started — last

operator polish item)

- **User profile management.**
  Display-name edit at minimum;
  possibly an avatar surface once
  the LINE-profile-scope v2 item
  lands. Needs an ADR for the RLS
  shape: today the model is
  "admin-client writes from the
  callback, NULL-only" with no
  user-write path on
  `public.users`. The ADR must
  specify which columns are
  user-writable (probably
  `full_name`) and which stay
  admin-only (`role`,
  `line_user_id`, `id`), then
  ship the matching UPDATE policy
  - server-action surface.

---

## Unit: v2 handoff / context-bridge document (docs-only)

- **Status:** Complete — 2026-05-26.
  Docs-only; no code, no schema.
- **Started / completed:** 2026-05-26.
- **Spec:** Provided inline by the
  operator.
- **Branch:** `docs/v2-handoff`.

### Done

- New "start here" doc at
  [`docs/v2-handoff.md`](./v2-handoff.md)
  — the context bridge for a fresh
  Claude chat (or future-you)
  picking up v2 work and the
  remaining go-live steps via the
  GitHub connector. Points to the
  authoritative docs
  (`CLAUDE.md`, ADRs, feature
  specs, `go-live-checklist.md`,
  this tracker) rather than
  duplicating them; captures only
  the things that aren't already
  written down anywhere else.
- Sections: current state (v1
  feature-complete + deployed; 81
  WPs per pilot; LINE channel
  published); outstanding go-live
  steps (pointing to checklist
  §§1–4); **operational gotchas
  discovered during the build**
  (the LINE-publish trap, the
  preview-host callback allowlist,
  the `pnpm install
--ignore-workspace` requirement,
  Railway Watch Paths auto-redeploy
  semantics, Railway's misleading
  auto-diagnosis when Root
  Directory wasn't `worker`, the
  branch-delete-no-leading-slash
  friction point, and the
  always-on cron note); the v2
  backlog with **profile-management
  written up in design detail**
  (full_name-only scope, the
  load-bearing WITH-CHECK
  privilege-escalation risk, three
  mechanism options analysed,
  lean = server-action via admin
  client (option b), open
  design-grilling questions,
  needs-ADR before building); and
  a how-to-work-in-v2 discipline
  recap (source-of-truth, workflow,
  architecture invariants).

### Why this doc exists

The build conversation surfaced
several things that were
load-bearing operationally but
**weren't recorded anywhere**:

- The LINE-channel publish trap
  (channel must be Published, not
  Developing, for non-tester users
  to authenticate). Discovered live
  during user onboarding; would
  have been an "unknown error from
  access.line.me" hunt for the
  next chat.
- The profile-management security
  analysis (RLS `WITH CHECK`
  validates the resulting row, not
  which columns changed → a naive
  self-update policy ships
  privilege escalation to
  super_admin). Done in
  conversation; no ADR yet because
  the unit hasn't been built; the
  analysis would have been
  re-derived from scratch
  otherwise.
- Operational gotchas around the
  worker (pnpm workspace
  interaction, Railway diagnostic
  noise) that don't justify their
  own ADR but would cost a future
  chat real time.

Capturing them in a single
referenced doc means the next
chat reads one file and is
oriented, instead of crawling 4000+
lines of tracker history.

### Decisions made

- **Point-to-don't-duplicate.** The
  go-live checklist and the ADR
  set are the canonical sources;
  the handoff doc links to them
  rather than restating their
  contents. Only the things that
  exist nowhere else (the gotchas
  - the profile-management design
    notes) are written in full.
- **Profile-management write-up
  belongs here, not in an ADR.**
  The ADR is written when the unit
  is built; this doc preserves the
  conversation-derived analysis so
  the ADR author isn't starting
  from scratch.

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — **94/94** (docs-only;
  no test surface touched).

### Closing notes

- 3 of 4 mid-go-live polish items
  shipped (SA status colors + Hide
  completed toggle; super_admin
  operator hub). Profile management
  is the 4th, deferred to v2 with
  design notes in
  [`docs/v2-handoff.md` §4](./v2-handoff.md).
- LINE Login channel is **published**
  — login is live for any LINE
  user, not just registered
  testers.
- Real WP data is loaded for both
  pilots (81 each); test-data
  cleanup is the highest-risk
  remaining step before pilot
  go-live.

---

## Unit: profile management — display-name self-edit (v2)

- **Status:** Complete (DB + code + tests; live browser checks pending operator).
- **Started:** 2026-06-07.
- **Completed:** 2026-06-07.
- **Spec:** [`docs/feature-specs/05-profile-management.md`](./feature-specs/05-profile-management.md) (Locked 2026-06-07; renumbered from spec 04 after deliverables claimed 04 on `main`).
- **ADR:** [`docs/decisions/0017-profile-self-edit.md`](./decisions/0017-profile-self-edit.md) (Accepted 2026-06-07; renumbered from ADR 0016 after deliverables claimed 0016 on `main`).
- **Branch:** `claude/crazy-jackson-aa151b` (rebased on `main` after PR #45 landed).

### Done

- Two migrations applied to remote:
  - `20260607143000_add_profile_update_audit_action.sql` — new `profile_update` value on `public.audit_action`.
  - `20260607143001_create_update_my_display_name.sql` — SECURITY DEFINER RPC exactly per ADR 0017 (one `text` param; hardcoded `where id = auth.uid()`; single-column SET; audit INSERT in the same statement; `revoke execute ... from public` + `grant execute ... to authenticated`).
- `src/lib/db/database.types.ts` regenerated via `pnpm db:types` (RPC signature + new enum value).
- `src/lib/profile/validate-display-name.ts` — pure UX validator (trim, empty/whitespace reject, >80 reject). The SQL function is the security authority; this mirrors its rules for inline UX only.
- `src/app/coming-soon/actions.ts` — `'use server'` action that resolves the session, validates, and calls the RPC on the **session (anon-key) client** (not admin). Returns a discriminated `{ ok, value | error }`.
- `src/app/coming-soon/display-name-form.tsx` — `'use client'` panel (justified: owns input state, pending state, inline error, transient "Saved" confirmation that only appears after an actual in-session save).
- Panel mounted on `/coming-soon` in both branches: the unserved-role tile and the `super_admin` `OperatorHub`.
- `supabase/tests/database/14-update-my-display-name.test.sql` — 13 assertions: catalog (exists, SECURITY DEFINER, `search_path` pinned, EXECUTE granted to `authenticated` + revoked from `public`), behaviour (trim, role-unchanged escalation guard, other-user untouched, empty/whitespace raises `22023`, >80 raises `22001`), audit (one `profile_update` row appended, payload `from`/`to`).
- `supabase/tests/database/03-audit-log-shape.test.sql` updated to expect `profile_update` in the `audit_action` enum (landmine called out in the unit briefing).

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean (after `pnpm db:types`).
- `pnpm test` — **103/103** (94 prior + 9 new validator tests).
- `pnpm db:test` — **266 / 267** pgTAP assertions pass, including all 13 new in test 14 and the updated 03. The one pre-existing failure (`11-photos-bucket.test.sql` "photos bucket is private") is unrelated to this unit — the live DB has `photos.public = true` while the migration declares `public = false`. Dashboard drift, predates this branch. See open questions.
- DB-level escalation probe (independent of the browser): under `set local role authenticated` with a `request.jwt.claims.sub` for a fresh visitor user, `UPDATE public.users SET role='super_admin' WHERE id=auth.uid()` updates **0 rows** and the role stays `visitor`. Confirms RLS blocks self-promotion at the layer the ADR claims.

### Open questions

- **Live browser checks pending operator** (laptop-only; cannot be run from this session): (1) edit name on `/coming-soon` as a visitor / self-promoted test user → "Saved" → reload → persists; (2) confirm an `audit_log` row was written for the change (DB query covers this — `select * from public.audit_log where action='profile_update' order by created_at desc limit 1`); (3) negative live check: `supabase.rpc('update_my_display_name', { p_full_name: '<81 chars>' })` from browser console errors at DB level (pgTAP test 14 assertion #11 already covers this server-side).
- **SA/PM unreachability (spec §"Known gap").** `/coming-soon` redirects `site_admin -> /sa` and `project_manager -> /pm`, so the two live pilot roles can't reach this panel. Their names come from LINE at first login — this is a correction gap, not a blocker. Follow-up trivial unit: mount the same component on `/sa` and `/pm`, or add a shared `/profile` route. **Not built here** per scope discipline. **[Resolved 2026-06-07 by spec 07 — `/profile` route. See unit at bottom of tracker.]**
- **Photos bucket is public on the live DB** (`storage.buckets.photos.public = true`). The migration `20260524040000_create_photos_bucket.sql` declares `public = false`; the live state was changed via the Supabase dashboard. This causes `11-photos-bucket.test.sql` assertion #2 to fail. **Pre-existing drift, unrelated to this unit.** Separate unit warranted: either flip the bucket back to private in the dashboard (security default per spec 02) or amend the migration + test if the public posture is intentional. Out of scope here.
- **`authenticated` role has UPDATE table privilege on `public.users`** (Supabase default), so the no-user-UPDATE-on-public.users invariant ADR 0007 / 0017 describe is upheld by RLS, not by GRANT. RLS denies (probe above confirms 0 rows updated). The privilege column-grant claim in earlier ADR copy could be tightened to reflect this — flagged but **not edited here** (would broaden the unit's diff into ADR-revision work).

---

## Unit: /profile route (universal display-name reach) + .claude/worktrees gitignore

- **Status:** Complete — 2026-06-07.
- **Started / completed:** 2026-06-07.
- **Spec:** [`docs/feature-specs/07-profile-route.md`](feature-specs/07-profile-route.md) (locked in this same unit).
- **ADR:** None — reuses ADR 0017's RPC unchanged; no new database surface.
- **Branch:** `feat/profile-route` (from `058d3fc` = `origin/main` after PR #48).

### Done

- **`.gitignore`** appended with `.claude/worktrees/` (local agent worktrees, never repo content). Verified `git ls-files .claude/worktrees/` was empty before adding — no tracked files to `git rm --cached`.
- **`docs/feature-specs/07-profile-route.md`** — verbatim locked spec per the unit briefing. Extends spec 05 / ADR 0017 with NO new ADR.
- **`src/components/features/display-name-form.tsx`** — moved here from `src/app/coming-soon/display-name-form.tsx` so both `/coming-soon` and `/profile` import from a single canonical location. One line changed inside: the action import switched from `./actions` → `@/app/coming-soon/actions`. The action itself stays at `src/app/coming-soon/actions.ts` — moving it would touch `revalidatePath('/coming-soon')` and the existing test coverage, which is OUT of scope. (The unit briefing explicitly authorized the form move as "the only refactor allowed if you move it".)
- **`src/app/coming-soon/page.tsx`** — `DisplayNameForm` import updated to the new path; `/profile` added as the 4th `HUB_LINKS` entry in the super_admin `OperatorHub`. The unserved-role-tile branch and the rest of the page unchanged.
- **`src/app/profile/page.tsx`** — Server Component. EVERY authenticated role can reach it including `visitor` (locked decision 1). Auth pattern mirrors `/coming-soon`: `createClient` → `auth.getUser` → `/login` if none; read `users.role + full_name` → `/login` if missing; render. Does NOT use `requireRole` — would bounce unserved roles to their `roleHome` and defeat the unit's purpose. Renders the existing `DisplayNameForm` and a "← Back" link computed via `roleHome(role)`. Reuses the dark-theme styling already used by `/coming-soon`.
- **Nav links added (matching existing styling):**
  - `src/app/sa/page.tsx` — "Profile" link in the header next to the LogoutButton.
  - `src/app/pm/page.tsx` — "Profile" link in the same header position.
  - `src/app/coming-soon/page.tsx` — `/profile` added to `OperatorHub`'s `HUB_LINKS` (4th entry).
- **`/coming-soon` inline panel preserved** — visitors keep inline edit (locked decision 4, no regression).
- **`tests/e2e/profile-unauthenticated.spec.ts`** — new Playwright suite mirroring `tests/e2e/auth-unauthenticated.spec.ts`: unauthenticated `GET /profile` redirects to `/login`. The TDD "failing first" artifact, written before `src/app/profile/page.tsx`.

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 12 files / 103 tests pass (unchanged — no new unit tests; form reuses existing coverage).
- `pnpm test:e2e` — the new redirect spec passes alongside the existing auth-unauthenticated suite.
- No migration → no `db push`, no `db:test` needed for this unit (spec 07 has zero SQL changes — only routing, docs, and gitignore).
- Live (deferred to operator on the laptop): visit `/profile` as each role; confirm edit + "Saved" + reload persistence; confirm "Back" returns to `roleHome(role)`; confirm the new "Profile" links from `/sa`, `/pm`, and OperatorHub work.

### Decisions made

- **Moved `DisplayNameForm` to `src/components/features/`** (allowed-refactor per the unit briefing): once the form is used by two routes, owning it under `src/components/features/` matches CLAUDE.md's "feature components live there" convention better than cross-importing from `/coming-soon`. Diff is small: one file move, one inner import update, one importer update.
- **No `requireRole` on `/profile`** — using it would bounce unserved roles to `roleHome(role)`, which for `visitor` is `/coming-soon`, defeating the unit's whole purpose. The page implements its own minimal auth check (mirroring `/coming-soon`'s pattern).
- **"← Back" target = `roleHome(role)`** — visitor → `/coming-soon`, SA → `/sa`, PM → `/pm`, super_admin → `/coming-soon`. Single source of truth, same helper used everywhere else.

### Resolved (spec 05 follow-up)

- **Spec 05's SA/PM unreachability open question** is resolved by this unit: SA and PM can now reach the display-name editor via the new "Profile" link on `/sa` and `/pm`. See spec 05's open questions section above (annotated inline as resolved).

### Open questions

None blocking. Surfaced for the record:

- The `.claude/worktrees/` gitignore add is purely defensive — PR #47's eslint `globalIgnores` change already prevents the worktree files from being linted. The gitignore prevents accidental `git add .` of worktree files in the future.

---

## Unit: LINE profile picture as avatar (self-view MVP)

- **Status:** Complete (code + tests; migration pre-merge; pgTAP 16 pending post-merge
  db push; live browser checks pending operator).
- **Started / completed:** 2026-06-08.
- **Spec:** [`docs/feature-specs/08-profile-image.md`](./feature-specs/08-profile-image.md) (Locked 2026-06-08).
- **ADR:** [`docs/decisions/0020-line-avatar.md`](./decisions/0020-line-avatar.md) (Accepted 2026-06-08; amends ADR 0007).
- **Branch:** `feat/line-avatar` (from `5f29ece` = `origin/main` after PR #50).

### Done

- **`supabase/migrations/20260608000000_add_line_avatar_url.sql`** — single
  `ALTER TABLE public.users ADD COLUMN line_avatar_url text;`. Applied
  post-merge (delegated per change-management policy).
- **`src/lib/db/database.types.ts`** — manually patched to add
  `line_avatar_url: string | null` to users Row/Insert/Update. Will be
  superseded by `pnpm db:types` after the delegated db push.
- **`src/lib/auth/verify-line-id-token.ts`** — `picture: string | null`
  added to `LineIdTokenClaims` and `RawJwtPayload`; parsed with the same
  defensive style as `name` (non-empty string → value, else null).
- **`src/lib/profile/resolve-avatar.ts`** — pure `resolveAvatar` (precedence
  uploaded > LINE > initials) + `getInitials` (first 1–2 words, uppercased,
  null-safe).
- **`src/components/features/avatar-surface.tsx`** — Server Component with
  plain `<img referrerPolicy="no-referrer" loading="lazy">` for uploaded/LINE
  (not next/image — avoids remote-domain allowlisting and referrer leakage)
  and initials `<span>` fallback. `uploadedUrl` prop is the future uploader
  plug-in point.
- **`src/app/auth/line/callback/route.ts`** — SELECT widened to include
  `line_avatar_url`; REFRESH-on-login write: `updates.line_avatar_url =
claims.picture` when it differs from stored value (handles initial set,
  refresh, and clear-to-null). `full_name`/`line_user_id` stay NULL-only.
  No audit row (system-owned field, like `line_user_id`).
- **`src/app/profile/page.tsx`** — SELECT widened; `<AvatarSurface>` rendered
  beside the page heading.
- **`src/app/coming-soon/page.tsx`** — SELECT widened; `<AvatarSurface>`
  rendered in both the unserved-role tile and the `OperatorHub` header.
- **`supabase/tests/database/16-users-line-avatar-url.test.sql`** — 3 pgTAP
  assertions: column exists, type text, nullable. These 3 fail pre-merge
  (migration not yet applied); all 273 prior assertions still pass.
- **`tests/unit/resolve-avatar.test.ts`** — 14 Vitest tests covering
  precedence and `getInitials` edge cases.
- **`tests/unit/verify-line-id-token.test.ts`** — 8 Vitest tests: picture
  parses to string when present, null when absent/null/non-string/empty;
  sub/name smoke.

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — **125/125** (103 prior + 14 resolve-avatar + 8 verify-line-id-token).
- `pnpm db:test` — **273 prior assertions pass; 3 new (file 16) fail pending
  migration apply.** This is expected pre-merge.

### Decisions made

- **REFRESH-on-login for `line_avatar_url`, NOT NULL-only.** LINE owns
  this field (reflects the user's current LINE account state). `full_name`
  is user-authored and user-correctable via the ADR 0017 RPC — its NULL-only
  callback semantics are correct. `line_avatar_url` has the opposite contract.
- **Plain `<img>` not `next/image`.** Avoids maintaining a `remotePatterns`
  allowlist for LINE CDN subdomains. `referrerPolicy="no-referrer"` prevents
  Referer header leakage. For the self-view use case this is the right call;
  cross-user display (future) will need a proxy.
- **No audit row for `line_avatar_url`.** System-sourced field; the user
  didn't author the change. Matches treatment of `line_user_id`.
- **`database.types.ts` manually patched.** The delegated post-merge
  `db push` + `pnpm db:types` will supersede the patch with the real
  generated output.
- **pgTAP in a new file (16), not bumping `01-users.test.sql`.** Avoids
  changing the plan count of a file that's not part of this unit's diff.

### Open questions

- **Post-merge delegated steps (for the operator to perform):**
  1. `supabase db push --linked` — applies `20260608000000_add_line_avatar_url.sql`.
  2. `pnpm db:types` — regenerates `src/lib/db/database.types.ts` (supersedes
     the manual patch; commit the regenerated file separately or as part of a
     post-merge fixup).
  3. `pnpm db:test` — all 276 assertions (including the 3 in file 16) should pass.
  4. Confirm: `select column_name from information_schema.columns
where table_schema='public' and table_name='users' and
column_name='line_avatar_url';` → returns one row.
- **User-uploaded avatar override (deferred — do NOT build without sign-off):**
  `avatar_url` column + private `avatars` bucket + own-folder storage RLS +
  `update_my_avatar_url` SECURITY DEFINER RPC + `AvatarUploader` client
  component. `AvatarSurface`'s `uploadedUrl` prop is the defined extension
  point. Revisit only if real-world usage shows users without LINE pictures
  who want a custom avatar. ADR 0018 and spec 06 remain reserved for the
  appsheet unit.

---

## Unit: getClaims local JWT verification (cut per-page Auth round-trip)

- **Status:** Complete — merged 2026-06-08 as PR #53 (`efccd92`, `perf(auth): swap getUser → getClaims on read-render path`). _Status backfilled 2026-06-10; the entry was left at "In progress" when the unit merged._
- **Started:** 2026-06-08.
- **Spec:** Inline brief from operator (no numbered feature spec — auth-perf change, not a domain feature).
- **ADR:** [`docs/decisions/0021-getclaims-local-jwt-verify.md`](./decisions/0021-getclaims-local-jwt-verify.md) (Accepted 2026-06-08).
- **Branch:** `feat/getclaims-perf` (from `9d0dcf7` = `origin/main` after PR #52).

---

## Unit: Purchasing — data layer (P1a)

- **Status:** Complete (code + tests; migration pre-merge; pgTAP 17 pending post-merge `db push`).
- **Started / completed:** 2026-06-08.
- **Spec:** [`docs/feature-specs/09-purchasing.md`](./feature-specs/09-purchasing.md) (Locked 2026-06-08).
- **ADR (new):** [`docs/decisions/0022-purchasing-domain.md`](./decisions/0022-purchasing-domain.md) (Accepted 2026-06-08).
- **ADR (updated):** [`docs/decisions/0018-appsheet-db-role.md`](./decisions/0018-appsheet-db-role.md) — DRAFT → Accepted (model A: direct DB role `appsheet_writer` over the Supabase Session Pooler). `purchase_requests` added to the grant matrix; P2 work, NOT this PR.
- **Branch:** `feat/purchasing-p1a` (from `efccd92` = `origin/main` after PR #53).

### Done

- **Step 0 drift check.** `supabase db push --dry-run --linked` reported "Remote database is up to date." Pre-existence check via `information_schema` / `pg_type` / `pg_roles` confirmed `public.purchase_requests`, enum `public.purchase_request_status`, and any `appsheet*` role did NOT pre-exist.
- **`supabase/migrations/20260608120000_create_purchase_requests.sql`** — lifecycle enum (`requested → approved | rejected → purchased → delivered`); single STATEFUL table with three column groups (requisition / approval / P2 purchase + delivery); six CHECK constraints (`pr_source_valid`, `pr_native_has_requester`, `pr_item_nonblank`, `pr_unit_nonblank`, `pr_quantity_positive`, `pr_reject_has_comment`); two indexes (`wp_idx`, `(status, requested_at desc)`); `updated_at` trigger reusing the existing `public.set_updated_at()`; three RLS policies (SELECT own-or-privileged, INSERT pinned to wp-readers + self + native source, UPDATE PM/super); explicit `revoke all` + `grant select, insert, update` to authenticated. No DELETE policy.
- **`supabase/tests/database/17-purchase-requests.test.sql`** — `plan(75)` covering catalog (enum + table + 22 columns + 3 FKs + 2 indexes + trigger), RLS configuration (enabled + exactly SELECT/INSERT/UPDATE policies), CHECK behavioural (6 negative + 1 positive: AppSheet flow `source='appsheet'` + null `requested_by` + email is permitted), INSERT RLS (SA self / SA foreign-requester denied / SA `source='appsheet'` denied / PM / super / procurement denied / visitor denied), SELECT RLS (SA1 sees own, NOT SA2's; PM / procurement / super see both; visitor sees nothing), UPDATE RLS + two-layer guard (PM `requested → approved`; PM `requested → rejected` with comment; SA / procurement no-op; guarded `WHERE status='requested'` returns 0 rows on an already-approved row; `set_updated_at` trigger moves `updated_at` forward), DELETE no-op for PM + super.
- **`src/lib/purchasing/validate-purchase-request.ts`** — pure `validateCreatePurchaseRequest` (trim + length + numeric positive + UUID shape, returns trimmed values); `PURCHASE_DECISIONS`, `isPurchaseDecision`, `commentRequiredForDecision`, `isDecisionCommentValid` predicates. Mirrors the DB CHECK rules.
- **`tests/unit/validate-purchase-request.test.ts`** — 21 Vitest tests: happy path, trim/preserve-internal-whitespace, empty / whitespace / non-positive / NaN / Infinity / bad-UUID rejection paths, fractional quantity accepted; predicate coverage for the two-valued decision space.
- **`src/app/requests/actions.ts`** — `createPurchaseRequest` (session-client INSERT with `requested_by = user.id`, `source = 'app'`; RLS enforces the pins) and `decidePurchaseRequest` (two-layer guarded UPDATE: JS predicate + `.eq('status','requested')` SQL clause; 0 rows ⇒ "not in requested state"). No admin client. `revalidatePath('/requests')`.
- **`src/lib/db/database.types.ts`** — manually patched to add `purchase_requests` table types and `purchase_request_status` enum. Will be superseded by `pnpm db:types` after the delegated post-merge `db push`.
- **Docs:** new spec 09, new ADR 0022, ADR 0018 updated (DRAFT → Accepted with the load-bearing connection-model question resolved and the grant matrix extended).

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean (manual `database.types.ts` patch in scope).
- `pnpm test` — **152/152** (131 prior + 21 new validator/predicate tests).
- `pnpm db:test` — **prior assertions still pass; 75 new (file 17) fail pending migration apply.** Expected pre-merge.

### Decisions made

- **Single STATEFUL table, not append-only and not supersede.** Purchasing is one logical record walking a known lifecycle; the auditability of decisions is preserved via `approved_by` / `decided_at` / `decision_comment` columns and (post-P1a) `audit_log` rows. Justified in ADR 0022 (Q1).
- **Dual-identity requester.** `requested_by` (FK) + `requested_by_email` + `source` discriminator. Native rows carry the FK; AppSheet rows (P2) carry the email. Enforced by `pr_source_valid` and `pr_native_has_requester` CHECKs. Justified in ADR 0022 (Q2).
- **v1 requester base narrowed to wp-readers.** SA / PM / super only. Owner decision 2026-06-07 from the diagnostic on `public.work_packages` SELECT — the requester pool starts where the WP read pool is. Broadening is a future unit. Justified in ADR 0022 (Q3).
- **Two-layer transition guard, not RLS column scoping.** The UPDATE policy admits PM / super to write at all; the action layer's JS predicate + `.eq('status','requested')` SQL clause does the transition gating. Mirrors `recordDecision`.
- **Procurement reads but does not write the decision.** Procurement is the back-office reviewer in v1; the decision write stays with PM / super (and AppSheet for purchase/delivery in P2).
- **`appsheet_writer` role name (rename in ADR 0018).** "\_writer" suffix makes the principal's purpose explicit alongside future read-only roles.
- **`database.types.ts` manually patched.** Same pattern as the line-avatar unit — `pnpm db:types` supersedes after the delegated post-merge `db push`.

### Open questions

- **Post-merge delegated steps (operator):**
  1. `supabase db push --linked` — applies `20260608120000_create_purchase_requests.sql`.
  2. `pnpm db:types` — regenerates `src/lib/db/database.types.ts` (supersedes the manual patch).
  3. `pnpm db:test` — all assertions including 75 in file 17 should pass.
  4. Confirm live: `select * from information_schema.tables where table_schema='public' and table_name='purchase_requests';` returns one row; `select polname from pg_policy where polrelid='public.purchase_requests'::regclass;` returns the three policy names.
  5. Re-run `supabase db push --dry-run --linked` — should return "Remote database is up to date."
- **Audit-log integration.** Whether decisions write an `audit_log` row. Strong lean toward yes; deferred to P1b so the action layer can attach the row in one place alongside the UI.
- **P1b (UI).** Routes / forms / list under `/requests`. Out of scope for this unit.
- **P2 (AppSheet writer role + grants + policies).** Role + per-table GRANTs + `TO appsheet_writer` policies on every table AppSheet touches, including `purchase_requests` (SELECT + INSERT + column-scoped UPDATE on the purchase / delivery columns). Out of scope for this unit; covered by ADR 0018's updated grant matrix.
- **`users.email` bridge.** Resolving an AppSheet `requested_by_email` back to a `public.users` display name. Future unit.

---

## Unit: Purchasing — native UI + decision audit logging (P1b)

- **Status:** Complete (code + tests; migration pre-merge; new pgTAP assertions pending post-merge `db push`).
- **Started / completed:** 2026-06-08.
- **Spec:** [`docs/feature-specs/09-purchasing.md`](./feature-specs/09-purchasing.md) (P1a spec — P1b implements the deferred UI + audit decision items listed in its "Scope — out" / "Open questions").
- **ADR:** [`docs/decisions/0022-purchasing-domain.md`](./decisions/0022-purchasing-domain.md) — closes the open question on `audit_log` integration (decisions DO write one audit_log row each).
- **Branch:** `feat/purchasing-p1b` (from `c967d5a` = `origin/main` after PR #55).

### Done

- **`supabase/migrations/20260608130000_add_purchase_request_decision_audit_action.sql`** — adds `purchase_request_decision` to the `public.audit_action` enum. Mirrors the `profile_update` migration shape exactly (ALTER TYPE ADD VALUE in its own file, separate from any statement that references the new value).
- **`src/lib/db/database.types.ts`** — manually patched: `purchase_request_decision` added to both the `audit_action` Enum type and the runtime `Constants.public.Enums.audit_action` array. Superseded post-merge by `pnpm db:types`.
- **`src/app/requests/actions.ts`** — extended `decidePurchaseRequest`: after the guarded UPDATE returns 1 row, writes one `audit_log` row via the session client (`action='purchase_request_decision'`, `actor_id=decider`, `target_table='purchase_requests'`, `target_id=PR.id`, `payload={work_package_id, decision, decider, comment}`). Mirrors the `profile_update` write target; non-rollback failure posture from `addPhoto`'s status-transition (`console.error` + continue — UPDATE is load-bearing, audit miss is a recoverable forensic gap). UPDATE `.select()` widened to include `work_package_id` for the payload. `revalidatePath('/pm/requests')` added so the PM queue drops the row after a decision. `createPurchaseRequest` untouched per scope.
- **`src/components/features/purchase-request-form.tsx`** — `"use client"` request-submission form. Mirrors `DisplayNameForm` shape (`useState` + `useTransition` + pure validator + pessimistic "Saved" + `router.refresh()`). WP picker populated from a `workPackages` prop (parent Server Component fetches under the caller's RLS on `work_packages`). Reuses `validateCreatePurchaseRequest` from P1a — no duplicate validation. Inline error strip. Disables submit when invalid; resets fields on success.
- **`src/components/features/purchase-request-decision.tsx`** — `"use client"` per-row Approve / Reject control. Comment textarea + two buttons. Reject button disabled until comment is non-blank (`isDecisionCommentValid('rejected', comment)` from P1a). On submit, calls `decidePurchaseRequest({ id, decision, comment })`, then `router.refresh()`. Pending state per-decision so the active button shows "Approving…" / "Rejecting…".
- **`src/app/requests/page.tsx`** — Server Component, `requireRole(["site_admin", "project_manager", "super_admin"])`. Two queries: readable WPs for the picker, caller's own purchase_requests for the "My requests" list (`requested_by = ctx.id`, newest first). WP code/name resolved via a second query keyed by `work_package_id`. Inline status pill (zinc/emerald/red/amber). Empty + error states for both sections. Header + profile/logout in the same shell as `/sa` / `/pm`.
- **`src/app/pm/requests/page.tsx`** — Server Component, `requireRole(["project_manager", "super_admin"])`. Queries `purchase_requests` where `status='requested'` oldest-first, joins WP code/name via a second query, resolves requester `full_name` via the admin client (precedent: `fetchDeciderNames` in `pm/work-packages/[workPackageId]/page.tsx`; PM cannot read other users via the session client per ADR 0011). Falls back to `requested_by_email` (AppSheet path, P2) then `"—"`. Empty + error states. Renders `PurchaseRequestDecision` per row.
- **Entry links** — `/pm` nav: added `Purchase requests →` and `Raise a request →` beside `Projects & reports →`. `/sa` landing: added a small nav row with `Raise a request →`. `OperatorHub.HUB_LINKS` (in `coming-soon/page.tsx`): added `/requests` and `/pm/requests` for super_admin.
- **`supabase/tests/database/03-audit-log-shape.test.sql`** — `enum_has_labels` array extended with `purchase_request_decision`. No plan() change.
- **`supabase/tests/database/17-purchase-requests.test.sql`** — new section I (Audit-log integration), plan `75 → 77`: PM-authenticated INSERT into `audit_log` with `action='purchase_request_decision'` succeeds (lives_ok); aggregate `count(*)` = 1 verifies the row is readable under the SELECT policy and targets the decided PR. Section comment renumbered (existing teardown was "I.", now "J.").

### Verification

- `pnpm lint` — clean.
- `pnpm typecheck` — clean (with the manual `database.types.ts` patch).
- `pnpm test` — **152/152** unchanged (no new TS unit tests — the decision-audit write is inline in the action; no new pure helper was extracted, so per CLAUDE.md scope discipline no new TS test was added).
- `pnpm db:test` — **deferred to post-merge.** The new pgTAP assertions require the new enum value in the linked DB, which can only be applied via `supabase db push --linked` after merge. Pre-merge run would correctly fail the modified `03-` (label-set mismatch) and the new I.1 in `17-`.
- **Component-test harness** — RTL + jsdom exists (`tests/unit/button.test.tsx`), but no precedent for testing `"use client"` forms that import server actions. Per CLAUDE.md scope discipline (don't add new testing patterns mid-unit), the form / decision component are not covered by component tests in this unit; pure-helper unit tests (already shipped in P1a) + typecheck carry the contract.
- **CLI pin** — `pnpm exec supabase --version` reports `2.98.1`, matching the `^2.98.1` floor in `package.json`. The future `pnpm db:types` regen will produce a canonical diff (no cosmetic CLI drift).
- **Routing matrix** (by construction, via `requireRole` + `roleHome`):
  - visitor / procurement / technician / hr / accounting / subcon_manager / project_coordinator → bounced from `/requests` and `/pm/requests` to `/coming-soon`.
  - site_admin → admitted to `/requests` (can submit), bounced from `/pm/requests` to `/sa`.
  - project_manager → admitted to both.
  - super_admin → admitted to both.
- **Reject-needs-comment** — client side: `Reject` button disabled when `!isDecisionCommentValid('rejected', comment)`. Server side: `decidePurchaseRequest` runs the same predicate; bypassing the disabled button returns `{ ok: false, error: "A comment is required when rejecting." }`.
- **One audit_log row per decision** — the action does exactly one `supabase.from('audit_log').insert(...)` after a successful UPDATE; the audit_log table is append-only (REVOKE + RLS + trigger per ADR 0004) so the row cannot be modified or removed by the application path.
- **Entry links** — `/pm` nav: `Review queue` (current) + `Projects & reports →` (`/pm/projects`) + `Purchase requests →` (`/pm/requests`) + `Raise a request →` (`/requests`). `/sa` nav: `Projects` + `Raise a request →` (`/requests`). `OperatorHub`: `/requests` and `/pm/requests` added to the link grid.
- `git status` — only intended files: 7 modified + 5 new (1 migration, 1 SC + 1 SC, 2 client components, plus the actions/types/tracker edits). No drift.

### Decisions made

- **Audit write mechanism = session-client INSERT.** The repo's only other app-originated audit_log write is inside the `update_my_display_name` SECURITY DEFINER RPC; that RPC issues a direct `INSERT INTO public.audit_log (...)` under the caller's session. For `decidePurchaseRequest` the same write target (direct INSERT) is used from TypeScript — the RLS policy `with check (true)` for authenticated + the `INSERT` GRANT both already admit it. A SECURITY DEFINER RPC was considered but rejected: it would force the audit into the same transaction as the UPDATE, which conflicts with the operator's instruction "do NOT fail the decision if the audit write fails" (mirroring `addPhoto`'s status-transition non-rollback posture).
- **`actor_role` left NULL.** The RPC populates it via `public.current_user_role()` (a free PL/pgSQL call). From TypeScript it would require an extra round-trip; `actor_id` is the load-bearing identity and the role can be derived from `users.role` post-hoc. Per scope discipline ("Do not add fields … beyond what the task requires"), kept minimal.
- **Payload shape.** `{ work_package_id, decision, decider, comment }` — matches the operator's "at minimum" list. `work_package_id` pulled from the UPDATE's `.select('id, work_package_id')` (replacing P1a's `.select('id')`) so no extra round-trip.
- **No new TS unit test.** No new pure helper was extracted; the audit write is a four-line direct INSERT inline in the action. Per CLAUDE.md scope discipline, no test added for code that doesn't have a discrete unit boundary.
- **Status pill helper inline in `/requests/page.tsx`.** Same precedent as `pm/page.tsx`'s `decisionPillClasses`. `status-colors.ts` was not extended because the purchase_request_status enum only appears on this one page in v1 (the PM queue is filtered to `status='requested'` and renders no pill).
- **Inline nav rows** for entry links on `/sa` and `/pm` rather than introducing a shared layout component. Mirrors the existing `/pm` nav shape exactly; introducing an abstraction for two more links would be premature.

### Open questions

- **Post-merge delegated steps (operator):**
  1. `supabase db push --linked` — applies both `20260608130000_…` (enum value) and `20260608130100_…` (trigger function + trigger).
  2. `pnpm db:types` — regenerates `src/lib/db/database.types.ts` (supersedes the manual patch; trigger functions don't appear in generated types — expected no-op for the trigger, plus the canonical enum extension).
  3. `pnpm db:test` — all assertions pass: `03-` enum_has_labels with 14 labels; `17-` section I (7 invariant assertions).
  4. `supabase db push --dry-run --linked` — should return "Remote database is up to date."
  5. `select tgname from pg_trigger where tgrelid='public.purchase_requests'::regclass;` — should include `purchase_requests_audit_decision` alongside `purchase_requests_set_updated_at`.
- **`users.email` bridge** — still future. P1b shows the email literally as a fallback (per the operator's spec for the requester column), but does not resolve it to a display name.
- **Audit row coverage.** P1b only audits decisions, not `createPurchaseRequest`. If audit-on-create becomes a v2 requirement, an INSERT-time trigger parallel to the decision trigger is the obvious extension point.

### Rework — audit mechanism: TS-side INSERT → atomic AFTER UPDATE trigger (2026-06-08, same day)

The initial P1b commit (`c0658ea`) wrote the audit row from TypeScript after the guarded UPDATE returned, with a non-rollback failure mode (console.error and continue). Operator review surfaced the problem: "an audit log you can't guarantee wrote is a weak audit log." Reworked the audit path to be atomic — written by an AFTER UPDATE trigger inside the same transaction as the decision. Now "exactly one row per decision, never on a non-transition" is a DB invariant testable in pgTAP, not a TS guarantee no test ever reached.

#### Done (rework)

- **`supabase/migrations/20260608130100_create_purchase_requests_audit_decision_trigger.sql`** — new migration adding `public.purchase_requests_audit_decision()` (SECURITY DEFINER, `set search_path = public`, mirrors `update_my_display_name`'s shape) and the matching `AFTER UPDATE ... FOR EACH ROW WHEN (OLD.status='requested' AND NEW.status IN ('approved','rejected'))` trigger. Body inserts one `audit_log` row with `action='purchase_request_decision'`, `actor_id=auth.uid()`, `actor_role=public.current_user_role()`, `target_table='purchase_requests'`, `target_id=NEW.id`, `payload={work_package_id, decision, comment, decided_by}`.
- **Separate migration file** — `ALTER TYPE ... ADD VALUE` (the prior 20260608130000) cannot share a transaction with statements that reference the new enum value, so the trigger lives in its own file/transaction. Same split pattern as the `profile_update` enum value + the `update_my_display_name` RPC.
- **`src/app/requests/actions.ts`** — `decidePurchaseRequest` audit INSERT block removed. `.select()` reverted from `'id, work_package_id'` to `'id'` (the `work_package_id` was only pulled for the audit payload; the trigger reads `NEW.work_package_id` directly from the row). `revalidatePath('/pm/requests')` retained (it's load-bearing for the PM queue's "row drops after decision" behavior, not audit-related). Header comment rewritten to point at the trigger.
- **`supabase/tests/database/17-purchase-requests.test.sql`** — section I replaced. Plan `77 → 82` (`75` original + 7 new invariant assertions). Fixture `a5555` added to section A (a fresh requested PR for the reject-transition test).
  - I.1 + I.2: PM transitions a2222 `requested → approved`; UPDATE lives; exactly one `audit_log` row exists with `action='purchase_request_decision'`, `target_id=a2222`.
  - I.3: that row's `actor_role` is `'project_manager'` — proves `current_user_role()` resolves under SECURITY DEFINER to the caller's identity, and that `actor_role` is non-null.
  - I.4 + I.5: PM transitions a5555 `requested → rejected with comment`; UPDATE lives; exactly one `audit_log` row for `target_id=a5555`.
  - I.6 + I.7: PM UPDATEs a4444 (already approved) touching `decision_comment` only (status unchanged); UPDATE lives; zero `audit_log` rows for `target_id=a4444` — proves the WHEN clause precision (the trigger does NOT write on a non-transition UPDATE).

#### Verification (rework)

- `pnpm lint` — clean.
- `pnpm typecheck` — clean (no types change; the manual `database.types.ts` patch from the prior commit is still in scope and unchanged — triggers don't appear in generated types).
- `pnpm test` — **152/152** unchanged (no TS unit tests touched — the action is shorter, but no new pure helper appeared).
- `pnpm db:test` — still deferred to post-merge. Pre-merge run would correctly fail file 17 section I (new assertions require the trigger to exist in the linked DB) and file 03 (label-set mismatch from the prior commit).
- **CLI pin** — `pnpm exec supabase --version` reports `2.98.1`, unchanged.

#### Decisions made (rework)

- **Trigger, not RPC.** Two viable shapes for atomic audit + UPDATE: (a) wrap both in a SECURITY DEFINER RPC and have the action call the RPC; (b) put the audit in an AFTER UPDATE trigger on `purchase_requests`. Chose (b): it preserves the existing two-layer guard at the SQL level (`.eq('status','requested')`) without re-implementing it inside an RPC, and it lets the WHEN clause encode the transition contract declaratively. Option (a) would have required moving the guard into PL/pgSQL, duplicating the application-side check.
- **`SECURITY DEFINER` even though authenticated already has INSERT on `audit_log`.** Decouples the trigger's write path from the caller's privilege set. The append-only `audit_log` grant matrix admits `authenticated` and `anon` today; future writers (an internal maintenance role, a P2 service role) may not have direct INSERT. SECURITY DEFINER makes the trigger correct under any caller that can run the UPDATE. ADR 0011 safety checklist applies: pinned `search_path = public`, no row-selecting parameters (trigger functions never take parameters), single INSERT side effect, no GRANT EXECUTE needed (trigger functions are not directly callable).
- **`auth.uid()` and `public.current_user_role()` resolve to the caller under SECURITY DEFINER.** `auth.uid()` reads a GUC (`request.jwt.claims`) which is session-scoped, not role-scoped. `current_user_role()` is itself SECURITY DEFINER and reads `users.role WHERE id = auth.uid()` — so it returns the caller's role. Same forensic-identity shape as the `update_my_display_name` RPC's audit INSERT.
- **`WHEN` clause owns the transition contract.** Two halves: `OLD.status = 'requested'` (only the initial decision boundary ever fires the trigger — a future P2 AppSheet UPDATE from `approved → purchased` never matches), and `NEW.status IN ('approved','rejected')` (the two native decision outcomes from `validate-purchase-request.ts`). Together they encode the entire "this is a decision" predicate in the database.
- **Atomic posture chosen, the non-rollback note retracted.** The earlier P1b shape mirrored `addPhoto`'s status-transition non-rollback posture, which was wrong for an audit log. A decision that can't be audited must not commit. The trigger raising — for any reason — rolls back the UPDATE; the action's existing error path surfaces it to the user.
- **Plan count breakdown** — `82 = 75 (P1a baseline) + 7 (new section I)`. The earlier `77` reflected the now-superseded TS-INSERT-shape assertions (lives_ok + count of a manual INSERT) — replaced wholesale, not preserved.

#### Open questions (rework)

- **Post-merge delegated steps (operator) — updated:**
  1. `supabase db push --linked` — applies both new migrations.
  2. `pnpm db:types` — regenerates types. Expected diff vs. the manual patch: none (the trigger isn't in generated types; the enum value already matches).
  3. `pnpm db:test` — file 03 + file 17 sections A–I all pass.
  4. `select tgname, tgenabled from pg_trigger where tgrelid='public.purchase_requests'::regclass and not tgisinternal;` — should list `purchase_requests_set_updated_at` (BEFORE UPDATE) and `purchase_requests_audit_decision` (AFTER UPDATE), both enabled (`tgenabled='O'`).
  5. `supabase db push --dry-run --linked` — "Remote database is up to date."
- **`users.email` bridge** — unchanged (still future).
- **Audit row coverage** — same (createPurchaseRequest still not audited; an INSERT-time trigger would now be the natural extension point if needed).

---

## Unit: Purchasing — AppSheet writer role, derive/audit triggers (P2)

- **Status:** Complete — merged 2026-06-08 as PR #57 (`ab9cc3f`); post-merge migrations applied to the linked DB; `pnpm db:test` **409/409** (363 prior + 46 file 18, recorded in `b4adf79`). _Entry backfilled 2026-06-10 from git history — the unit shipped without a tracker entry._
- **Spec:** [`docs/feature-specs/09-purchasing.md`](./feature-specs/09-purchasing.md) P2 scope + [`docs/feature-specs/06-appsheet-role.md`](./feature-specs/06-appsheet-role.md).
- **ADR (new):** [`docs/decisions/0025-appsheet-purchase-delivery-write-path.md`](./decisions/0025-appsheet-purchase-delivery-write-path.md) (Accepted 2026-06-08) — supersedes ADR 0018's source-gated SELECT and INSERT-now grant-matrix entries.
- **Commits:** `ab9cc3f` (PR #57), then direct-to-main follow-ups `b4adf79` (post-P2 test fixes + two-tier restructure), `c84f302` (Tier-2 smoke script), `9448c9c` (Tier-2b throwaway-requisition rework).

### Done

- **Migration `20260608140000`** — `ALTER TYPE` ×2: `purchase_request_purchase` + `purchase_request_delivery` added to `audit_action`.
- **Migration `20260608140100`** — `CREATE ROLE appsheet_writer` (noinherit, **nologin**); SELECT grant; column-scoped UPDATE grant on the 7 fact columns (`supplier`, `order_ref`, `amount`, `purchased_at`, `delivered_at`, `received_by`, `delivery_note`); two `TO appsheet_writer` RLS policies gated `status IN ('approved','purchased','delivered')`; INSERT seam marked `-- future:`.
- **Migration `20260608140200`** — BEFORE UPDATE derive/guard trigger: fact-column null→non-null advances `status` (`approved→purchased`, `purchased→delivered`); illegal moves raise `P0001`; corrections (no null→non-null transition) pass with status unchanged.
- **Migration `20260608140300`** — AFTER UPDATE SECURITY DEFINER audit trigger: `session_user` captured as `payload.principal`; `actor_id`/`actor_role` NULL (no JWT); WHEN clause disjoint from P1b's decision trigger — no double-audit possible.
- **pgTAP** — file 18 new (plan 46 after restructure); file 17 plan 82→87 (count-independent policy checks after P2's two new policies); file 03 `enum_has_labels` extended with the two new actions.
- **Two-tier test strategy discovered and adopted** (`b4adf79`): `SET SESSION AUTHORIZATION` is infeasible on Supabase (postgres is not superuser; the db-query API blocks transaction-local GRANT-to-self). Tier 1 = pgTAP as postgres (trigger logic, grant matrix, policy quals, audit columns); Tier 2 = out-of-band smoke under a real `appsheet_writer` login at enablement (RLS row visibility, 42501 denials, principal capture). ADR 0025's testing note rewritten as the binding doctrine.
- **Tier-2 smoke ritual committed** — `supabase/scripts/smoke/appsheet_writer_p2.sql` (`c84f302`), wrapped `BEGIN…ROLLBACK`; Tier-2b principal check reworked (`9448c9c`) to use a dedicated throwaway requisition created + approved through the native app, left in `purchased` state (no ad-hoc reset — change-management §1 applies to any later removal).
- **`docs/go-live-checklist.md` §2a added** — AppSheet writer activation ritual: set password out-of-band, psql connectivity over the Session Pooler, smoke script (all `[PASS]`), Tier-2b principal assertion.

### Verification

- Post-merge `pnpm db:test` **409/409**, all files green (recorded in `b4adf79`'s commit body). Migrations confirmed applied to the linked remote DB.

### Open questions / remaining

- **Operator activation pending** — go-live checklist §2a: password, psql smoke, Tier-2b. The role stays NOLOGIN until then.
- Wiring the actual AppSheet app to the Session Pooler happens after §2a sign-off.
- `users.email` bridge and the AppSheet-originated INSERT seam — still future units.

---

## Unit: Go-live §1 — cleanup verification + SQL composition (session-only, no production code)

- **Status:** Complete — 2026-06-10, in two acts. Act 1: the focused session go-live-checklist §1 prescribes — re-verified all six runbook items against migrations and composed the pre-flight + self-aborting destructive SQL (chat-only; never committed, per the compose-at-execution-time doctrine). Act 2: a live read-only audit (sanctioned by change-management.md — "inspect, audit, verify") revealed **the cleanup had already been executed 2026-06-07** via the policy's emergency path (audit_log `56a4d80e…`, cited as the exemplar in change-management.md §1), so the composed destructive block was retired unused — its identity assertions would have correctly refused to run against the already-clean DB.

### Verified against migrations (all six §1 runbook items)

- `photo_logs` block triggers: `photo_logs_block_update` / `photo_logs_block_delete` (BEFORE, FOR EACH ROW, raise P0001) — `20260524020000`.
- `approvals` block triggers: `approvals_block_update` / `approvals_block_delete` — `20260524030000`.
- `work_packages → photo_logs` and `→ approvals` FKs: both `ON DELETE CASCADE` (trigger still fires on cascade-driven DELETE, confirming the runbook's disable-wrap requirement).
- `reports.project_id → projects` is `ON DELETE CASCADE`; **nothing references reports**; no block triggers on reports → per-row DELETE unobstructed.
- Bucket paths: photos `{project_id}/{wp_id}/{photo_log_id}.{ext}` (`src/lib/photos/path.ts`); report PDFs `{project_id}/{report_id}.pdf` (`worker/src/index.ts:128`).

### New facts the runbook inventory predates (purchasing landed 2026-06-08, after §1 was written)

- `purchase_requests.work_package_id → work_packages` is `ON DELETE CASCADE` — a test requisition referencing WP-TEST-001 would cascade-delete silently. The composed destructive block **asserts zero** such rows and aborts otherwise.
- The pre-flight script lists **all** `purchase_requests` rows so any test requisitions from P1b validation can be identified; cleaning those is a separate follow-up decision, not part of the composed block.
- `photo_logs.superseded_by` self-FK is default NO ACTION (end-of-statement check) → a single-statement DELETE of all 7 rows is legal.
- No `FORCE ROW LEVEL SECURITY` anywhere → the SQL editor's postgres (table-owner) context deletes once the two append-only trigger pairs are disabled.
- All four `purchase_requests` triggers are UPDATE-only — nothing fires on DELETE, so a cascade would write no audit rows.

### Decisions made

- The destructive block is **self-aborting**: identity assertions (project code + WP code + WP id must agree) and per-DELETE `GET DIAGNOSTICS` count checks raise on any mismatch with the §1 inventory (7 photo_logs / 4 real / 1 approval / 3 reports / 0 purchase_requests), rolling back everything including the trigger disables. If it commits, the counts matched — no eyeballing required.
- `audit_log` untouched, as always. Audit rows referencing deleted test entities remain as forensic residue by design.

### Addendum — live-state audit (2026-06-10, same session)

Read-only audit over `supabase db query --linked` (Management API, postgres context) plus `supabase db push --dry-run --linked`. Findings:

- **§1 COMPLETE.** WP-TEST-001 row gone; 0 photo_logs / 0 approvals for it; 0 reports rows on PRC-2026-001; 0 photo objects and 0 PDFs under the project prefix (only zero-byte `.emptyFolderPlaceholder` dashboard artifacts remain — cosmetic); all append-only block triggers enabled (photo_logs 2, approvals 2, audit_log 3); PRC-2026-002 clean; maintenance audit row `56a4d80e…` (`action='other'` @ 2026-06-07) present. Drift check: "Remote database is up to date."
- **§2a COMPLETE except one attestation.** `appsheet_writer` has LOGIN; password-set compliance audit row dated 2026-06-08; Tier-2b throwaway requisition `fcf4179d…` sits at `purchased` with both expected audit rows — `purchase_request_decision` (native approve) and `purchase_request_purchase` whose `payload->>'principal' = 'appsheet_writer'` (the exact Tier-2b assertion), re-verified live 2026-06-10. The smoke script's `[PASS]` lines roll back by design and cannot be confirmed from the DB — operator attests that box.
- **Out-of-inventory test data found:** WP01 (PRC-2026-001) carries 3 photo_logs by Pattrawut @ 2026-05-25 — one visible Before photo, plus a During photo already tombstoned. Removable **in-app** (SA Remove control appends a tombstone); no SQL needed.
- **Role roster findings:** 3 × super_admin (Pattrawut + MMApichai + Natch.r) vs the runbook's "Pattrawut only"; **0 × project_manager** (the §4 dry run needs one); 2 × site_admin (Preston Inter, Neno); 2 × visitor pending (Nichap., นัด). Likely resolution: demote the two extra super_admins to `project_manager` — fixes both findings at once; operator's call.
- **Usage state:** approvals 0, reports 0 → the §4 dry run has not started. WPs 81/81 per pilot (template intact).

### Remaining to launch (operator-only items)

1. §2 roster: resolve the super_admin × 3 finding; promote or park the 2 visitors; ensure at least one real `project_manager` exists.
2. §1 tail: remove the stray WP01 Before photo in-app, then tick the §1 spot-check box.
3. §2a tail: tick the smoke-script `[PASS]` box if the script was run (the Tier-2b evidence says the ritual happened); wire the actual AppSheet app to the Session Pooler.
4. §3: confirm both pilots really want the exact 81-WP template.
5. §4: the dry run with one real SA + one real PM — the main remaining gate.
6. §5: communicate v1 limitations; sign off and date the checklist.

---

## Unit: WP-centric purchase requests, mobile form fix, phase relabel (spec 10)

- **Status:** Complete — 2026-06-11.
- **Spec:** [`docs/feature-specs/10-wp-centric-requests-ui.md`](./feature-specs/10-wp-centric-requests-ui.md) (Locked 2026-06-11 from the operator's chat brief: "WP is the main place we deal with things").
- **Branch:** `feat/wp-centric-requests-ui` (stacked on `claude/distracted-ptolemy-554622` / PR #58).

### Done

- **Item 1 — Unit field overflow (mobile).** `purchase-request-form.tsx` Quantity/Unit row: flex children gained `min-w-0`, inputs gained `w-full min-w-0` (text inputs have an intrinsic min-width that `flex-1` alone cannot shrink past — the Unit input was pushed off-screen at phone widths). Item-description input got `w-full min-w-0` for the same reason.
- **Item 2 — requests are raised FROM the WP.**
  - SA photo screen + PM WP review screen: `Raise purchase request →` header link to `/requests?wp=<id>`.
  - `/requests` accepts `?wp=`: valid UUID + readable under RLS → form pinned to that WP (static `code · name` line, no picker); param present but unresolvable → "Work package not found." strip + guidance card; no param → guidance card only. "My requests" list unchanged in all modes.
  - `PurchaseRequestForm` prop: `workPackages` list → single `workPackage`; `<select>` and `workPackageId` state removed. Server action, validator, RLS untouched.
  - Entry links relabelled to match (`/sa` + `/pm` navs and the OperatorHub `/requests` card → "My requests"; hub hint now says new requests start from a work package).
- **Item 3 — "Before" → "Preparation"** (display-only). Both `PHASES` arrays (SA photo screen, PM WP page) relabelled; the label prop already flows into `PhaseUploader` / `PhaseGallery`. `photo_phase` enum, storage paths, and the PDF worker untouched.

### Verification

- `pnpm lint` — clean. `pnpm typecheck` — clean. `pnpm test` — **152/152** unchanged.
- No diff under `supabase/`, `src/app/requests/actions.ts`, or `src/lib/purchasing/` (spec 10 checklist).
- UUID shape check reuses `isValidUuid` from `@/lib/photos/path` (already unit-tested) — no new pure helper, hence **no new unit test** (P1b precedent; posture recorded in spec 10).
- Post-deploy eyeball (operator, phone): form at `/requests?wp=…` fits the viewport; WP screens show Preparation / During / After.

### Decisions made

- **Picker removed, not kept alongside.** The operator's brief rejects the "request outside then select WP" flow outright; keeping a parallel picker would preserve exactly the UX being retired. Bare `/requests` keeps the "My requests" list and points users at the WP screens.
- **Link-out to a pinned form rather than embedding the form on WP screens** — one form, one route, no duplicated submit surface; the WP context travels in the URL.
- **"not found" and "not allowed" intentionally indistinguishable** on `/requests?wp=` (`maybeSingle()` under RLS) — no information leak about WP existence outside the caller's read set.

### Open questions

- None blocking. If users later want the form inline on the WP screen itself (zero navigation), that is a follow-up spec.

---

## Unit: Deliverable-grouped WP list — UI (spec 11)

- **Status:** Complete — 2026-06-11.
- **Spec:** [`docs/feature-specs/11-deliverable-grouped-wp-list.md`](./feature-specs/11-deliverable-grouped-wp-list.md) (Locked 2026-06-11 from the operator's chat brief). Consumes spec 04 Phase 1 (ADR 0016 schema, live since 2026-05-31).
- **Branch:** `feat/deliverable-grouped-wp-list` (from `2773ad2` = `origin/main` after PR #59).

### Done

- **Writing failing test first** — `tests/unit/group-work-packages.test.ts` (8 cases) written and run RED (module absent), then GREEN after the helper landed. First unit in a while with a genuine pure seam.
- **`src/lib/deliverables/group-work-packages.ts`** — pure, generic `groupWorkPackagesByDeliverable(wps, deliverables)`: groups ordered `sort_order` asc tie-broken by `code`; WP input order preserved within groups; zero-WP deliverables omitted; null/unknown `deliverable_id` → final `deliverable: null` "Ungrouped" group (mirrors spec 04 Phase 3's PDF bucket rule).
- **`work-package-list.tsx` reworked** — deliverable sections with full-width header buttons (chevron, `code · name`, right-aligned `n WPs` + `k complete` summary, `aria-expanded`/`aria-controls`, ≥44px touch target). **Collapsed by default** (the landing view is the deliverable overview). Active text query force-expands matching groups without mutating the user's collapse state; groups emptied by query/hide-completed disappear. **Zero deliverables ⇒ the exact pre-grouping flat list** (today's live state).
- **`/sa/projects/[projectId]/page.tsx`** — WP select gains `deliverable_id`; new `deliverables` query ordered by `sort_order`; snake→camel mapped at the boundary.
- PM queue untouched per spec (short pending-approval list).

### Verification

- New test: RED before implementation, GREEN after. `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` **160/160** (152 prior + 8 new).
- No diff under `supabase/` — schema already live; no migration.

### Blocked prerequisite surfaced (operator decision needed)

- **The live `deliverables` table is empty** (verified read-only 2026-06-11: 0 rows, 0/162 WPs linked) — the grouped view stays in degraded flat mode until **spec 04 Phase 2** (importer/backfill) runs. Phase 2 is blocked on the operator's real source CSVs: the in-repo `data/work-packages-template.csv` is a 3-column example without deliverable columns, so the importer contract (column names for DeliverableID / name / order) cannot be written until the operator shares a real header or file. Question put to the operator in-session.

### Open questions

- ~~Spec 04 Phase 2 importer mini-spec — pending the operator's CSV header/file.~~ Resolved same day: the source is the operator's AppSheet master Google Sheet; Phase 2 implemented as a committed seed (next unit).
- Expand-all/collapse-all and collapse-state persistence — deliberately out of scope; revisit after field feedback.

---

## Unit: Deliverables backfill — spec 04 Phase 2 (seed)

- **Status:** Complete — 2026-06-11. The seed was applied to the live DB on 2026-06-10 (UTC, per `deliverables.created_at`); post-apply verification passed 2026-06-11 — see the live-state refresh unit below. (An earlier revision of this entry read "live apply pending operator approval"; that was stale.)
- **Spec:** [`docs/feature-specs/04-deliverable-grouping.md`](./feature-specs/04-deliverable-grouping.md) Phase 2 section, rewritten in place from "importer sketch" to the as-implemented seed contract.
- **Branch:** `feat/deliverables-backfill` (from `84fea5c` = `origin/main` after PR #60).

### Done

- **Source located and verified.** The operator's AppSheet master Google Sheet (id `18Q8mr1eCpDcYMjIF0a8ygen…`, shared in-session) — tab 1 = deliverables master (D01–D30, Thai names, `DeliverableOrder` 1–30, single `PJ0001` project key), tab 2 = WP master (WP01–WP81 → DeliverableID).
- **Version guard — the critical finding.** The sheet's later tabs carry a **different plan revision** (a `D00` deliverable, ~124 WPs, and WP codes that collide with different meanings — tab 5's `WP01` is a different task than tab 2's `WP01`). Live WP names were checked against tab 2 before generation (`WP01 งานปักฝัง` … `WP81 งานส่งมอบ`, identical on both pilots; no `WP00` in the DB) — tab 2 is the version the DB was seeded from; later tabs excluded.
- **`supabase/seed-deliverables.sql`** — generated programmatically from the sheet (no manual transcription of 111 Thai rows): 30-deliverable upsert `on conflict (project_id, code) do update` (deliberate deviation from seed.sql's `do nothing` — re-runs converge name/sort_order on the file of record), cross-joined to both pilot projects; 81-row WP→deliverable UPDATE joined on `(code, project_id)`; single transaction; trailing verification SELECT (expect **60 / 162 / 0**).
- Generation-time validation: 30 unique codes, orders exactly 1–30, 81 unique WP codes, zero mappings to unknown deliverables.

### Decisions made

- **Seed, not importer.** Spec 04's sketch deferred the contract to pickup; at pickup the source is a Google Sheet (not CSVs) and the dataset is fixed and one-shot for two identically-templated pilots. Committed idempotent seed via the established `supabase db query --linked --file` channel (seed.sql precedent) beats speculative importer tooling. Recorded in spec 04 Phase 2.
- **Apply step is operator-gated.** Data mutation against prod — per change-management posture, the run happens on explicit approval after the PR merges (asked in-session). Re-runnable thereafter.

### Verification

- `pnpm lint` / `pnpm typecheck` / `pnpm test` — unaffected surfaces (SQL + docs only); suite stays 160/160.
- Post-apply: the seed's count SELECT must read 60 / 162 / 0; then `/sa/projects/<id>` renders the deliverable groups (spec 11 UI lights up with zero code changes).

### Open questions

- pgTAP catalog coverage for `deliverables` (spec 04 "known gap") — still deferred; natural slot is a future file 19 when any deliverables-touching migration next ships.
- Spec 04 Phase 3 (PDF grouping by deliverable) — unstarted; genuinely unblocked as of 2026-06-10 (seed applied and verified live).

---

## Unit: /requests back nav + deliverable progress + ui-ux-pro-max pass (spec 12)

- **Status:** Complete — 2026-06-11.
- **Spec:** [`docs/feature-specs/12-back-nav-and-deliverable-progress.md`](./feature-specs/12-back-nav-and-deliverable-progress.md) (Locked 2026-06-11 from the operator's three-item chat brief).
- **Branch:** `feat/back-nav-deliverable-progress` (from `9c5d49a` = `origin/main` after PR #61).

### Done

- **Item 1 — back navigation on `/requests`.** New sub-nav strip (same pattern as `/pm/requests`): pinned mode links `← Back to work package` → `/sa/projects/{project_id}/work-packages/{id}` (WP lookup gains `project_id`; the SA WP screen admits sa/pm/super so the target is valid for every form-capable role); bare mode links `← Back` → `roleHome(ctx.role)`. Lucide `ArrowLeft`, `min-h-10` hit area.
- **Item 2 — deliverable progress.** Writing failing test first: `tests/unit/derive-deliverable-progress.test.ts` (7 cases) RED → GREEN. Pure `src/lib/deliverables/derive-progress.ts`: `complete` iff all WPs complete, `not_started` iff all not_started (or empty), else `in_progress`; `percent = round(100·complete/total)`. Group headers now show a status pill (reusing `workPackageStatusPillClasses` + the WP status labels), a `k/n WPs` count, and a thin `role="progressbar"` strip (emerald on zinc-800, aria-valuenow/min/max + label). **Computed from the UNFILTERED membership** so headers stay truthful while query / hide-completed are active (component memoizes a full-list grouping alongside the filtered one).
- **Item 3 — ui-ux-pro-max applied (bounded).** The installed skill's database was queried directly (its Python runner needs an interpreter this box lacks; the CSVs are the data). Applied: predictable back nav (High), progress indicators (Medium), ≥44px-class touch targets (High), `motion-reduce:transition-none` on the chevron rotation and bar width (High), explicit `cursor-pointer` on header buttons (Tailwind v4 preflight no longer sets it), retained `focus-visible` rings, lucide-only icons. Deliberately NOT applied: whole-app restyle, h-10 input sample (app-wide h-9 convention outranks it). Boundary recorded in spec 12.

### Verification

- New test RED before the helper existed, GREEN after. `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` **167/167** (160 prior + 7 new).
- No diff under `supabase/`.

### Open questions

- Whole-app ui-ux-pro-max design-system pass (styles/palette/typography beyond these two surfaces) — separate unit if the operator wants it.
- Deliverable progress on PM screens / PDFs — spec 04 Phase 3 territory.

---

## Unit: Live-state refresh, tracker repairs, types regen (session-only audit + housekeeping)

- **Status:** Complete — 2026-06-11.
- **Spec:** None — orientation/housekeeping session, not a feature unit. All DB access read-only (sanctioned by `change-management.md` — "inspect, audit, verify"); no schema, Storage, or role changes.

### Verified live (read-only, `supabase db query --linked`)

- **Spec 04 Phase 2 seed IS APPLIED** — applied 2026-06-10 (UTC, per `deliverables.created_at`): 60 deliverables (30 per pilot, `sort_order` 1–30 each), 162/162 WPs linked, 0 unlinked — the seed contract exactly. The backfill unit's "live apply pending operator approval" status above was stale and has been corrected in place. The spec 11/12 deliverable-grouped UI is therefore live-fed (no longer in degraded flat mode).
- **WP01 (PRC-2026-001) stray Before photo still visible** (1 current-state row) — the §1-tail in-app removal is still pending (operator).
- **Roster unchanged since the 2026-06-10 audit:** 3 × super_admin, 2 × site_admin, 2 × visitor, **0 × project_manager** — §2 roster resolution and the §4 dry run still need a real PM.
- **Dry run not started:** approvals 0, reports 0. purchase_requests 1 = the known Tier-2b throwaway (`fcf4179d…`, `purchased`).

### NEW finding — PDF worker silently garbles Thai (confirmed by repro; gates a meaningful §4 dry run)

- Repro (throwaway script through `buildReportPdf` with a Thai project + WP name; not committed): the worker produces a PDF with **no error**, but the content stream dumps the raw Thai codepoints into a single-byte WinAnsi hex string — PDF viewers render Latin mojibake. PDFKit's built-in Helvetica cannot encode Thai; **every live WP and deliverable name is Thai**; reports=0 means this path has never run against real data.
- Failure mode is **silent success**: the §4 dry-run report would generate, upload, and deliver garbage — no failed job to notice.
- Fix shape: embed a Thai font (e.g. Sarabun / Noto Sans Thai) via `doc.registerFont` in `worker/src/report.ts`; failing worker test first using real Thai strings (the existing worker test uses only English names — a test blind spot). **Recommended next dev unit** — the only dev-actionable item on the go-live critical path. Needs a small locked spec first, per workflow.

### Repairs in this commit

- **Tracker merge-conflict corruption fixed:** two stray `<<<<<<< HEAD` markers (auth-spike unit "Pending" section; projects-table open questions) and one spliced stale block (`=======` … `>>>>>>> origin/chore/remove-line-auth-spike` — spike-era ADR-0011 notes duplicated inside the v2-handoff unit) removed. Content loss: none — the removed block duplicated notes already resolved in the custom-flow auth-core unit.
- **LINE channel secret scrubbed from this file.** The PR-1 unit's open-questions bullet had recorded the secret verbatim — meaning that bullet's own rotation trigger condition ("rotate IF the values were ever committed anywhere") is **met**; the literal remains in git history even after redaction. Operator: rotate in the LINE Developers console and update Vercel `LINE_CHANNEL_SECRET` (a live runtime secret — token exchange + ID-token verification in `/auth/line/callback`, per ADR 0012).
- **`src/lib/db/database.types.ts` regen committed** (separate chore commit): two `audit_action` enum values from the merged ADR-0025 migrations (`purchase_request_purchase`, `purchase_request_delivery`) existed in the live schema — and in live audit rows — but in no committed copy of the types file. The post-merge `pnpm db:types` had been run on 2026-06-10 but never committed (found as uncommitted drift in the main checkout; regenerated fresh + prettier-formatted). The worker's copy (`worker/src/database.types.ts`) is still stale (no `deliverables` table, no `work_packages.deliverable_id`) — refresh it inside the next worker unit per the `worker/README.md` regen rule.

### Housekeeping

- Deleted six fully-merged local branches after verifying each tip's tree byte-identical to its squash commit on main: `feat/wp-centric-requests-ui` (#59), `feat/deliverable-grouped-wp-list` (#60), `feat/deliverables-backfill` (#61), `feat/back-nav-deliverable-progress` (#62), `claude/laughing-austin-87688b` (#57), `claude/lucid-edison-137cc7` (#56).
- `origin/claude/distracted-ptolemy-554622` (PR #58) verified byte-identical to squash commit `7c8512b` — fully merged; left in place (remote deletion is a push-side op for the operator's browser/laptop flow).
- Deleted untracked `test-out.txt` (a pgTAP output dump from 2026-06-08) from the repo root.
- Committed directly to main per the operator's standing instruction for this session ("merge auto, don't need to ask").

### Open questions / handoff

- **Operator (go-live, unchanged):** roster (≥ 1 real PM; likely demote the two extra super_admins), WP01 photo removal in-app, smoke-script `[PASS]` attestation + wiring the real AppSheet app to the Session Pooler, §3 template confirmation, §4 dry run, §5 sign-off. **NEW:** rotate the LINE channel secret (above). **NEW:** the §4 dry run is not meaningful until the Thai-font fix lands — the report PDF step would silently produce mojibake.
- **Dev next-unit queue (recommended order):**
  1. **Thai-font fix in the PDF worker** — small, scoped, go-live-critical; worker-local TDD (worker is excluded from root suite and CI — verification checklist must include worker-local `pnpm typecheck && pnpm test`).
  2. **Spec 04 Phase 3 (PDF deliverable grouping)** — data-unblocked but **spec-blocked**: the Phase 3 section is a deliberate stub with no verification checklist. The mini-spec must lock: progress counts in group headers or not (changes the worker fetch from complete-only to all-WPs — `derive-progress.ts` needs full membership), page-break semantics, empty-group rule, within-group order, Ungrouped label language, and the helper-reuse mechanism (the worker cannot import app `src/` — copy per the `selectCurrentAfterPhotos` precedent in `worker/src/index.ts`).
  3. **Docs refresh unit:** `docs/v2-handoff.md` (frozen 2026-05-26 — lists shipped profile-management and deliverable work as future backlog; calls completed go-live §1/§2a "outstanding"), `README.md` (says Next.js 15 vs actual 16; ADR table stops at 0005 of 25; structure/commands stale), CLAUDE.md Roles section (omits `super_admin` entirely; its "non-SA/PM → /coming-soon" rule contradicts the shipped super_admin operator hub), and the supersede-pattern SKILL tombstone variant (deferred 6×).

---

## Unit: Thai-capable font in the PDF report worker (spec 13)

- **Status:** Complete — 2026-06-11 (started and completed same session, immediately after the live-state refresh unit above).
- **Spec:** [`docs/feature-specs/13-thai-pdf-font.md`](./feature-specs/13-thai-pdf-font.md) — written this session, locked by the operator's "Proceed as planned, then merge" instruction (the plan named this unit, the font approach, and the types rider explicitly).
- **Branch:** committed directly to main per the same instruction.

### Done

- **Writing failing test first** — new Thai-rendering test in `worker/tests/unit/report.test.ts`, run RED on the WinAnsi path (no `/FontFile2`, Helvetica BaseFont) before any implementation, GREEN after.
- **`worker/fonts/Sarabun-Regular.ttf`** (90 KB TrueType, SIL OFL 1.1, `OFL.txt` alongside; source: `google/fonts` repo `ofl/sarabun/`) committed. `worker/src/report.ts` reads it once at module scope (`import.meta.url`-relative — CWD-independent under Railway Root Directory `/worker`), registers it per document, and selects it for **all** text. Sizes/layout untouched.
- **Rider per spec:** `worker/src/database.types.ts` refreshed from the app copy (byte-identical post-copy; the worker copy had predated `deliverables`, `work_packages.deliverable_id`, `purchase_requests`, and the ADR-0025 `audit_action` values).

### Adversarial verification (3-lens skeptic pass before merge)

- **Correctness lens — found a real test weakness, fixed pre-merge.** The first version of the Thai test searched the whole inflated PDF for `Sarabun`/`0E42` — empirically shown to be satisfiable by the WinAnsi nibble-dump itself and by a constructed partial regression (header in Sarabun, WP sections in Times-Roman passed all four original assertions). Hardened: the codepoint check is now anchored inside the `/ToUnicode` CMap stream (`beginbfchar`/`beginbfrange`), and **every** `/BaseFont` entry in the document must be (subset-)Sarabun. Hardened test re-proven GREEN with the fix and RED against the stashed pre-fix implementation.
- **Deployment lens — pass.** `*.ttf` not gitignored; git's binary heuristic protects it from autocrlf (TTF magic `00 01 00 00`); tsx runtime ships `fonts/` as-is (no build step to strip it); lint-staged patterns don't touch `.ttf`.
- **Spec-compliance lens — tracker entry + sample-PDF evidence were the gaps;** both closed (this entry; before/after sample PDFs delivered to the operator in-session: mojibake repro, then correct Thai via embedded subset font).

### Verification (spec 13 checklist)

- New Thai test RED before implementation, GREEN after — and re-proven both ways after hardening. ✔
- Worker-local `pnpm typecheck` clean; `pnpm test` **6/6** (5 prior + Thai). ✔
- Repro decode shows embedded subset font (`/BaseFont /XXXXXX+Sarabun-Regular`, `/FontFile2`) + ToUnicode CMap with Thai codepoints; visual sample sent to operator. ✔
- Root `pnpm lint && pnpm typecheck && pnpm test` — 167/167, unaffected. ✔
- No diff under `supabase/` or app `src/`. ✔
- `report.ts` "Deferred to v2" list untouched (deliverable grouping stays deferred to spec 04 Phase 3). ✔

### Decisions made

- **Sarabun over Noto Sans Thai** — the de-facto Thai document face with full Latin coverage, so a single Regular face serves the whole report (current layout uses no bold).
- **Font buffer loaded at module scope** — the one static-asset exception to `report.ts`'s "no I/O" rule, documented in the module header.
- **`.gitattributes` (`*.ttf -text`) deliberately NOT added** — suggested by the deployment skeptic, but out of spec scope; git's NUL-byte heuristic is verified sufficient. Surfaced here per scope discipline; fold into a future hygiene unit if desired.

### Open questions

- The Thai regression guard lives in the worker-local suite only (worker is excluded from root tooling and CI by design) — any future report change needs the worker-local `pnpm test` run, as the spec checklist already requires.
- §4 dry-run sequencing is back in the operator's hands: the report path now renders Thai correctly, so the flat-layout dry run can proceed ahead of spec 04 Phase 3.

---

## Unit: Spec 13 parallel-draft reconciliation (docs-only merge)

- **Status:** Complete — 2026-06-11. No code delta; docs only.
- **What happened:** two sessions picked up dev-queue item 1 (Thai PDF font) in parallel. This branch (`claude/objective-hawking-8c4aab`) drafted its own spec 13 (commit `3fad6d9`) and stopped for operator lock per workflow; the other session wrote, locked ("Proceed as planned, then merge"), implemented, and committed spec 13 directly to main (`f1497f4`, unit above) before this branch's lock arrived. No implementation code was ever written on this branch.
- **Resolution:** merged main into the branch; the implemented spec-13 file and tracker unit stand wholesale; the superseded draft survives only in branch history. Draft-vs-shipped deltas recorded so they aren't lost:
  - **Bold headings** — the draft proposed Sarabun Bold for project/WP headings; the shipped spec locks one Regular face, layout untouched, bold explicitly out of scope. Stays out unless the operator requests it as a future micro-unit.
  - **Test mechanism** — the draft proposed `pdfjs-dist` text-extraction (reader-visible assertion); the shipped tests assert ToUnicode-CMap-anchored Thai codepoints + every `/BaseFont` subset-Sarabun, hardened against a constructed false-green. Equivalent protection for this regression, zero added dependency. No action.
- **Independent re-verification on the merged tree (this session):** worker-local `pnpm typecheck` clean + `pnpm test` 6/6; root `pnpm lint && pnpm typecheck && pnpm test` 167/167; fresh Thai sample PDF generated through `buildReportPdf` (WP01 "งานปักฝัง" + tone-mark-heavy strings) and delivered to the operator for visual confirmation.

---

## Unit: Thai-first UI + UX coherence pass — iteration 1 of the whole-app upgrade (spec 14)

- **Status:** Complete — 2026-06-11.
- **Spec:** [`docs/feature-specs/14-thai-first-ui.md`](./feature-specs/14-thai-first-ui.md) — written this session from the operator's three-point chat brief (UX not intuitive / AppSheet is the back office / Thai users → Thai UI; "Upgrade the system as a whole, design a better version each time"), locked by that brief. Iteration 1 of a standing multi-session mandate.
- **Branch:** committed directly to main per the operator's standing merge instruction.

### Done

- **Writing failing test first** — `tests/unit/i18n-labels.test.ts` RED (module absent) → GREEN; later extended RED → GREEN again for the invalid-date guard. 9 cases: every enum totally covered with distinct Thai labels (driven off the generated `Constants` arrays, so a new enum value fails here first), Buddhist-era + Asia/Bangkok determinism incl. a date rollover, raw-string degradation on unparseable input.
- **`src/lib/i18n/labels.ts`** — central Thai label maps (WP status, project status, purchase status, photo phase, approval decision, user role) replacing the five duplicated per-file STATUS_LABEL maps, plus `formatThaiDateTime` (explicit `th-TH-u-ca-buddhist`, pinned `Asia/Bangkok`) replacing the two divergent per-file `formatDateTime` helpers (one server-locale, one browser-locale — a latent SSR/CSR mismatch, now gone). `REPORT_STATUS_LABEL` translated in place in `predicates.ts` (existing home; its distinctness test is copy-agnostic).
- **Every user-facing string in `src/` is now Thai** — all screens (landing, login, coming-soon + operator hub, profile, SA ×3 levels + uploader, PM queue/review/projects/reports/requests, /requests), all server-action error strings, validators, form labels/placeholders, empty states, pills, aria-labels, `window.confirm`, avatar alt. Latin kept per spec: PRC Ops, LINE, codes, PDF, file-format names, the digit 80.
- **Sarabun webfont + `lang="th"`** — `next/font/google`, subsets thai+latin, weights 400/500/600 (non-variable font — weight mandatory), `--font-sans` token swap; Geist Mono retained for codes. Matches the PDF font (spec 13) for brand coherence. Metadata: title template `%s — PRC Ops`, Thai description, per-page Thai titles.
- **`src/app/not-found.tsx` + `src/app/error.tsx`** — localized 404 and error boundary (`'use client'` on error.tsx is required by Next.js for error boundaries — that is the justification). `notFound()` calls no longer fall through to the built-in English page.
- **AppSheet flow copy (spec E)** — /requests guidance card + status hint now state the true lifecycle: raise from the WP screen → the PM decides (a rejection always carries a comment) → on approval, procurement takes over in the back office; สั่งซื้อแล้ว / ได้รับของแล้ว update automatically from the back-office record and cannot be set in-app. Wording respects ADR 0025 truthfulness rules (no claim that procurement sees pre-approval rows; no cross-user visibility claim).
- **Pill consistency (spec F)** — the three hardcoded-zinc status pills (SA photo screen, PM review screen, /pm/projects) now use the shared `workPackageStatusPillClasses` / `projectStatusPillClasses` helpers.
- Tests updated with the copy they assert (spec'd): `validate-display-name` (/ว่าง/, digit 80 kept), `validate-purchase-request` (Thai field-term regexes), `auth-unauthenticated` e2e (LINE button + three login banners).

### Adversarial verification (4-lens skeptic pass before merge)

- **Thai-native lens** — caught a garden-path sentence ("…สถานะส่งคำขอแล้ว" misparses; now "คำขอนี้ได้รับการพิจารณาไปแล้ว"), a glossary mix on the hub hint (ตรวจ vs อนุมัติ domains; now "พิจารณาคำขอซื้อที่รออนุมัติ"), and the spec-E copy omitting WHO approves (now names ผู้จัดการโครงการ in both card and hint). Wording nits applied: spacing on the landing tagline, รอตรวจ uniformity, หน้างาน (not งานหน้างาน), ศูนย์ควบคุม terminology closed, login subtitle เพื่อเข้าใช้งาน.
- **Completeness lens — pass.** No surviving repo-string English; exempt Latin intact; titles + `lang="th"` verified.
- **Locked-behavior lens — pass.** Routes/redirects/pinned-form modes/grouping semantics/enums/RLS/supabase/worker untouched; h-9 input convention retained. Its nit (formatThaiDateTime dropped the replaced formatters' invalid-date guard, silently changing the failure mode) was fixed test-first.
- **Spec-compliance lens** — tracker entry (this) and the 12th page title were the findings; see decisions.

### Verification (spec 14 checklist)

- New label/date tests RED before the module existed, GREEN after. ✔
- `pnpm lint` / `pnpm typecheck` / `pnpm test` — **176/176** (167 prior + 9 new). ✔
- `pnpm build` — passes; Sarabun resolves; 16 routes + static `/_not-found`. (No `.env.local` on this machine — server env supplied as process-local placeholders for page-data collection only; nothing written to disk.) ✔
- `pnpm test:e2e` — **27/27** across chromium/firefox/webkit with the Thai assertions. ✔
- English-remnant sweep — clean (see lens above). ✔
- No diff under `supabase/` or `worker/`; no enum/route/redirect change. ✔

### Decisions made

- **No i18n library, single-language Thai** — hardcoded Thai + central label maps per the established "enum values are storage keys, labels are presentation" doctrine (spec 10). A library would violate library discipline without buying anything for a single-locale app.
- **Buddhist-era dates, pinned to Asia/Bangkok** — what Thai users read everywhere; pinning locale + calendar + zone makes server and client renders identical (the old formatters disagreed).
- **Sarabun over the skill's Noto Sans Thai suggestion** — brand coherence with the spec-13 PDF font.
- **12th page title added beyond spec G's 11** — `ตรวจรายการงาน` on the PM WP-review route; the spec list omitted that route (an enumeration gap, not a scope decision). Recorded here per scope discipline rather than silently absorbed.
- **Date test asserts containment (era year, Thai month, wall clock), not the exact string** — exact `Intl` output varies across ICU builds; the containment set still pins era + zone determinism.
- **`Method Not Allowed` (logout GET) and DB-raised SQL messages untouched** — protocol/DB surfaces per spec carve-outs.

### Open questions / iteration-2 queue (from the UX audit + this unit's review)

- Raw Supabase Storage error text (English) can still reach the upload tile (`phase-uploader.tsx` passes `uploadError.message` through; pre-existing shape, spec carve-out) — convert to fixed Thai + console.error the raw message.
- `global-error.tsx` for root-layout throws (built-in English page theoretically reachable; segment `error.tsx` doesn't cover the root layout).
- Structural UX items deliberately deferred to iteration 2+: palette/theme identity + outdoor light theme, shared app-header refactor (three-pattern split), super_admin hub as a real route, photo tap-to-enlarge on review screens, toasts/themed confirm dialogs, progressive disclosure on /pm/requests, requested-at + rejection-comment display, queue ordering by wait time, `loading.tsx` skeletons, PWA manifest/icons/theme-color.
- Docs refresh unit (v2-handoff, README, CLAUDE.md roles) still queued from the 2026-06-11 audit.

---

## Unit: Purchasing visibility + review ergonomics — iteration 2 of the whole-app upgrade (spec 15)

- **Status:** Complete — 2026-06-11 (code + tests; live browser checks pending operator).
- **Spec:** [`docs/feature-specs/15-purchasing-visibility-review-ergonomics.md`](./feature-specs/15-purchasing-visibility-review-ergonomics.md) — iteration 2 under the operator's standing chat brief; scope drawn from spec 14's recorded iteration-2 queue. UI layer only — no DB/RLS/enum/route/redirect change.
- **Branch:** committed directly to main per the operator's standing merge instruction (commit local-only; push is laptop-only per CLAUDE.md).

### Done

- **Writing failing test first** — `tests/unit/status-colors.test.ts` (extended) + `tests/unit/photo-lightbox.test.tsx` (new) RED (10 failures: helper + component absent) → GREEN after implementation. 15 new assertions total.
- **A. Requester feedback loop on `/requests`** — the my-requests query now also reads `decision_comment, decided_at, purchased_at, supplier, delivered_at, received_by, delivery_note` (own-row SELECT already admits them; ADR 0022). Rows render ขอเมื่อ on every card; rejected → red block เหตุผลที่ไม่อนุมัติ + the PM's mandatory comment + พิจารณาเมื่อ; approved → อนุมัติเมื่อ; purchased/delivered → สั่งซื้อเมื่อ (+ ผู้ขาย); delivered → ได้รับของเมื่อ (+ ผู้รับของ) + `delivery_note`. The AppSheet back office's work is now _visible_ to the requester instead of a bare pill flip. `amount` deliberately NOT displayed (open question below).
- **B. `/pm/requests`** — each queue row shows ขอเมื่อ `formatThaiDateTime(requested_at)` (field was fetched but never rendered).
- **C. `/pm` queue ordered by wait time** — `updated_at` asc (status flip to pending_approval is the last app write to a queued WP) with `code` tiebreak, replacing code-order; rows show เข้าคิวเมื่อ. The recorded iteration-2 "queue ordering by wait time" item.
- **D. Photo tap-to-enlarge** — new `src/components/features/photo-lightbox.tsx` (`'use client'`: open/close state + document Escape listener). `ZoomablePhoto` consumed by the PM review `PhaseGallery` and the SA `phase-uploader` `Thumbnail` (remove × overlay retained). Closes on backdrop/ปิด/Escape; clicking the photo doesn't dismiss. No portal — no transformed ancestors on consuming screens.
- **E. `loading.tsx` skeletons** — shared `src/components/features/page-skeleton.tsx` (server component, sr-only กำลังโหลด…) + nine route `loading.tsx` files (/sa, /sa/projects/[id], SA WP photo screen, /pm, /pm/requests, /pm/projects, reports, PM WP review, /requests).
- **F. Fixed-Thai Storage upload error** — `phase-uploader.tsx` tile shows อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง; raw SDK message → `console.error` only. Closes the spec-14 carve-out.
- **G. `src/app/global-error.tsx`** — root-layout error boundary ('use client' + own `<html lang="th">`/`<body>` per Next.js; inline styles because the root layout's font vars aren't mounted). Same copy family as `error.tsx`.
- **H. `purchaseRequestStatusPillClasses`** centralized in `src/lib/status-colors.ts` (PILL_RED named constant added); `/requests`'s inline map deleted — the last inline pill map in `src/` is gone.

### Verification (spec 15 checklist)

- New tests RED before implementation, GREEN after. ✔
- `pnpm lint` / `pnpm typecheck` / `pnpm test` — **191/191** (176 prior + 15 new). ✔
- `pnpm build` — 17 routes incl. static `/_not-found`; all nine `loading.tsx` compile. (No `.env.local` on this machine — process-local placeholder env for page-data collection only, nothing written to disk; same posture as spec 14.) ✔
- `pnpm test:e2e` — **27/27** chromium/firefox/webkit. ✔
- No diff under `supabase/` or `worker/`; no enum/route/redirect change; `/pm` order is the only query-order change. ✔
- Null-fact rendering on `/requests`: every conditional line is truthiness-guarded; `formatThaiDateTime` only ever receives non-null values. ✔

### Decisions made

- **`amount` not displayed on `/requests`** — the requester _can_ read it via the own-row SELECT policy (RLS is row-level, not column-level), but showing purchase amounts to every requester is a money-visibility policy the operator hasn't made. Display withheld; recorded here rather than silently shipped.
- **`updated_at` as queue-entry proxy on `/pm`** — no "entered queue at" column exists; the status flip is the last app-path write to a queued WP, so `updated_at` is accurate today. If a future unit adds app-path WP writes that touch queued rows, revisit (a dedicated timestamp or the first `after` photo_log would be the honest upgrade).
- **No portal for the lightbox** — `position: fixed` escapes the tiles' `overflow-hidden` because no consuming screen has a transformed ancestor; a portal would add complexity for no current gain. If a transform ever lands on those trees, move the overlay to a portal.
- **No focus trap in the lightbox** — Escape/backdrop/button close is shipped; full focus management (trap + return) joins the themed-dialog item in the iteration-3 queue rather than half-shipping here.
- **`prettier --write` side effect reverted** — a blanket format pass reflowed the untouched shadcn `button.tsx` (stale pre-printWidth-100 formatting); reverted to keep the diff scoped. Note for future units: format only the files you touched (lint-staged covers commits).

### Open questions / iteration-3 queue

- **`amount` display policy on `/requests`** — operator decision: show purchase amounts to requesters, to PMs only, or not at all (note: the column is already readable via the API regardless — this is display policy, not access policy).
- Structural UX items still queued from spec 14: shared app-header refactor (three-pattern split), palette/theme identity + outdoor light theme (wants operator input), super_admin hub as a real route, themed confirm dialogs/toasts (replaces `window.confirm`; would carry the lightbox focus-trap work), progressive disclosure on `/pm/requests`, PWA manifest/icons/theme-color (needs icon assets).
- Docs refresh unit (v2-handoff, README, CLAUDE.md roles) still queued from the 2026-06-11 audit.
- Live browser checks pending operator: (1) `/requests` as an SA with a rejected request → comment block renders; (2) a purchased/delivered row (AppSheet-written facts) renders dates/supplier/receiver; (3) tap a review photo → lightbox; Escape and backdrop close it; (4) throttle the network → skeletons appear on route loads.

---

## Unit: spec 16 design draft — purchase-request enrichment (docs-only; awaiting operator lock)

- **Status:** LOCKED 2026-06-11 — operator answered Q1–Q4 in-session: **Q1** AppSheet image viewing REQUIRED (→ new P3 capability-URL bridge + ADR 0027; token lives in a 1:1 side table so the attachments table stays strictly append-only and rotation is a plain service-role UPDATE); **Q2** requester may REMOVE attachments while pending (→ tombstone-supersede per ADR 0015, INSERT-only, current-state via two security_invoker views); **Q3** images + links only; **Q4** no late badge. A second adversarial pass on the post-lock deltas found and FIXED before commit: two SQL **name-capture blockers** in the locked policy snippets (the tombstone subquery self-captured `superseded_by`; the storage-policy subquery's `name` bound to `work_packages.name` — both now table-qualified, with pgTAP pins on the qualified text), the **Supabase default-privilege revoke-all-first** requirement (incl. views + token table), a composite-FK hardening (same-parent/same-kind tombstones DB-enforced), role gates added to the attachment INSERT + storage policies (demoted-visitor parity with the parent), TRUNCATE added to the block-write trigger, the P3 route reads the `_appsheet` view via admin client (kills the hand-rolled anti-join trap) with `timingSafeEqual` + `Cache-Control: no-store`, the smoke ritual gains a positive-path upload probe, and the tombstone/approval TOCTOU race is recorded as accepted.
- **Next session:** write ADR 0026 → implement P1 (dates + unit picker), then P2 (attachments), then ADR 0027 → P3 (bridge) as separate units.
- **Spec:** [`docs/feature-specs/16-purchase-request-enrichment.md`](./feature-specs/16-purchase-request-enrichment.md) - iteration 3 of the standing whole-app-upgrade brief: unit dropdown + free-text other, needed_by, eta (AppSheet-written), reference image/link attachments.
- **Method:** 12-agent design pass - 5 constraint readers (data layer / app UX / storage precedent / AppSheet mechanics / guardrails), 3 design lenses (minimal-diff, security-first, workflow-first), 1 synthesis, 3 adversarial skeptics (RLS-security, AppSheet-compat, repo-discipline). All verified findings folded into the draft:
  - [major] attachments table now TRIPLE-enforced append-only (block-write trigger added; two layers were claimed as "immutable" - audit_log/photo_logs precedent requires three).
  - [major] storage upload policy is PATH-BOUND to the caller's own pending request (project_id + PR id segments verified in WITH CHECK) - the photos bucket's role-only looseness must not carry over to a client-built path.
  - [major] recovery-expander projectId data flow corrected (pinned query already selects project_id; the own-rows WP lookup is the one that must add it).
  - eta audited in ONE canonical shape (case-3 correction diff only; bundled-transition gap recorded as the accepted pre-existing posture); grant + audit amendment in one migration; function body AND trigger WHEN both amended (dual hard-coded column lists verified at 20260608140300).
  - Tier-2 smoke amendments phase-tagged with an operator fixture protocol (no vacuous-pass on an empty attachments table); AppSheet read-only column config for needed_by made a REQUIREMENT (42501-wholesale trap); protect-audit-log hook claim corrected (path-regex only); ADR 0026 must carry in-place back-pointer edits (ADR 0018 matrix, ADR 0022 x2, ADR 0025); verified-by-checklist posture sentence added for non-pure surfaces; late-ETA badge gated behind operator Q4 (amount-display precedent).
- **Next:** operator answers Q1-Q4 (or accepts defaults) -> write ADR 0026 -> implement P1 (dates + unit picker) then P2 (attachments) as separate units.

---

## Unit: app-shell structural refactor (spec 17, iteration 4)

- **Status:** Complete — 2026-06-11 (operator-authorized autonomous block; "merge auto" standing instruction).
- **Spec:** [`docs/feature-specs/17-app-shell-refactor.md`](./feature-specs/17-app-shell-refactor.md) — behavior-preserving extraction of AppHeader, StatusPill, ErrorNotice/EmptyNotice, approvalDecisionPillClasses/reportStatusPillClasses, fetchDisplayNames.

### Done

- **Writing failing test first** — RED evidence: `pnpm exec vitest run` over the three test surfaces exited 1 with 10 failures before any module existed (helpers + components absent); GREEN 51/51 immediately after implementation; full suite **216/216** (191 prior + 25 new).
- **AppHeader** (`src/components/features/app-header.tsx`) — replaces the six hand-rolled hub headers (/sa, /pm, /pm/requests, /requests, /pm/projects, reports). Each page's existing width (2xl/3xl), kicker, greeting-vs-title, and profile-link presence pass through as props — the historical inconsistencies are preserved, now visible as props (normalization = recorded iteration-5 operator question).
- **StatusPill** — **10 consumers** (the spec's original nine-site inventory missed the SA WP photo-screen header pill; enumeration gap caught by the adversarial pass and recorded per the spec-14 "12th page title" precedent, then converted).
- **ErrorNotice/EmptyNotice** — all standard-geometry notice sites (7 error + 11 empty, incl. the four text-zinc-500 overrides). The two small-size error variants stay local by design.
- **approvalDecisionPillClasses + reportStatusPillClasses** in `status-colors.ts` — the last two pill maps outside the declared home (pm/page local fn, PM WP DECISION_CLASSES, reports-list STATUS_PILL_CLASSES) deleted.
- **fetchDisplayNames** (`src/lib/users/display-names.ts`, server-only) — consolidates the byte-identical fetchRequesterNames/fetchDeciderNames admin-client helpers; call-site fallback chains and dedupe untouched.

### Adversarial verification (3-lens workflow over the uncommitted diff)

- **Fidelity lens — pass.** Programmatic check: every Thai string in deleted-vs-added lines byte-matches (21 distinct strings, balanced counts); executed the project's real `cn()` against every palette constant — outputs byte-identical to the old literal class attributes; all six headers structurally identical.
- **Behavior lens — pass.** No route/redirect/query change; helper consolidation verbatim; no client/server boundary break (build is the conclusive check). One stale comment found → fixed.
- **Discipline lens** — findings all folded in: the logout flex-div wrap + console.error wording added to the spec's recorded-delta list; the 10th pill site converted + recorded; the AppHeader title-override test strengthened (now passes title AND fullName, asserts title wins); RED→GREEN evidence recorded here; `docs/app-feel-options.md` committed separately (not bundled into the refactor commit).

### Verification (spec 17 checklist)

- New tests RED → GREEN. ✔ `pnpm lint`/`typecheck`/`test` — 216/216. ✔ `pnpm build` — 17 routes unchanged. ✔ `pnpm test:e2e` — 27/27. ✔ No diff under `supabase/`/`worker/`. ✔ Recorded deltas only (5 listed in the spec checklist). ✔ Touched routes serve on the dev server (auth-gated pages stream the loading shell then redirect — pre-existing spec-15 streaming behavior, browser lands on /login per e2e). ✔

### Open questions / iteration-5 queue

- **Header normalization (operator):** should /pm/projects + reports gain the โปรไฟล์ link, and should the 2xl/3xl container split unify? Now a one-prop change per page.
- Row-link card extraction (3 near-identical sites + 1 variant) — recorded candidate, not done.
- Nav-strip extraction — strips genuinely differ; revisit only if a fourth pattern appears.
- PWA unit (manifest/icons/SW) — queued; see `docs/app-feel-options.md` for the locked-in recommendation and the operator decisions it needs.

---

## Unit: docs refresh 2026-06-11 (docs-only)

- **Status:** Complete - 2026-06-11 (autonomous block). Closes the "docs refresh unit" queued since the 2026-06-11 audit.
- **Done:** README modernized (Next.js 16, Thai-first + purchasing + worker described, structure block corrected to feature-specs/ + supabase/ + worker/, the stale 5-row ADR table replaced with a where-to-start-reading list); v2-handoff gains a dated "State refresh 2026-06-11" section 0 (everything shipped since 2026-05-26, current test surface, the merge-auto convention) while sections 1-5 are kept as history; CLAUDE.md schema sentence updated from "five v1 tables" to the current table list with ADR pointers.
- **Verification:** docs-only; `pnpm lint` (prettier via lint-staged on commit) and no src/ diff.

---

## Unit: supersede-pattern skill tombstone update (skill-only)

- **Status:** Complete - 2026-06-11 (autonomous block). Closes the ADR 0015 follow-up queued since 2026-05-24 ("skill teaches replacement-only framing").
- **Done:** `.claude/skills/supersede-pattern/SKILL.md` now teaches the tombstone variant per ADR 0015: payload-NULL sentinel (generalized to multi-payload tables like the spec-16 attachments design), mandatory well-formedness CHECK, two-filter current-state read (anti-join + tombstone filter, with the canonical SQL), two-append replacement + transaction note, orphan-accepted Storage posture, the table-qualified-outer-reference policy hazard from the spec-16 review, tombstone test requirements, and ADR 0015 added to sources of truth. Frontmatter triggers extended (tombstone, attachments, remove photo).
- **Why now:** spec 16 P2 (attachment removal) loads this skill; it must teach the right pattern before that unit starts.

---

## Unit: UX coherence + PWA installability (spec 18, iteration 5)

- **Status:** Complete — 2026-06-11 (operator brief: "revise uxui"; merge-auto standing instruction).
- **Spec:** [`docs/feature-specs/18-ux-coherence-pwa.md`](./feature-specs/18-ux-coherence-pwa.md) — header normalization (profile link everywhere, hub width unification), shared HubNav with the consistent 4-item PM / 2-item SA sets, themed ConfirmDialog replacing window.confirm, PWA manifest/icons/SW/theme-color.

### Done

- **Writing failing test first** — RED: 3 new test files failed module-absent (hub-nav, confirm-dialog, manifest); GREEN after implementation. The app-shell-primitives update is a relaxation (prop removal), recorded honestly — it could not break first. Final suite **232/232** (216 prior + 16 new incl. the canonical nav-set pins).
- **A. Header normalization** — `showProfileLink` prop deleted (โปรไฟล์ on every hub incl. /pm/projects + reports); hubs unified to `max-w-2xl` (/pm, /pm/requests, /requests narrowed from 3xl).
- **B. HubNav** — canonical `PM_HUB_NAV` (4 items) / `SA_HUB_NAV` (2 items) exported beside the component and pinned by test; every PM hub now shows all four destinations (was 2-of-4 on two pages); arrows dropped; min-h-11 tap targets.
- **C. ConfirmDialog** — replaces `window.confirm` on photo removal (English browser chrome with raw origin — the least app-like moment). Same overlay language as the lightbox; Escape/backdrop/ยกเลิก cancel; initial focus on cancel; `aria-labelledby` on the message. Spec 16 P2 reuses it for attachment removal.
- **D. PWA installability** — `manifest.ts` (Thai, standalone, zinc-950 theme), generated PRC placeholder icons (192/512/apple-180 — replace PNGs with the real logo any time), network-only `sw.js` + production-gated registration, `viewport.themeColor`. Verified live on the dev server: `/manifest.webmanifest` 200 with correct fields, icons serve, theme-color/manifest/apple-touch-icon tags emitted.

### Adversarial verification (3-lens workflow over the uncommitted diff)

- **UX/locked-behavior lens — pass.** No destination lost vs the deleted nav strips; /requests spec-12 back-bar untouched (both modes); reports back-nav intact; ConfirmDialog message byte-identical to the old confirm string; zero leftover `max-w-3xl` on converted pages; no route/redirect/query change.
- **PWA/client lens — pass** with minors, all fixed: dialog now closes BEFORE the serialize guard (a second photo's confirm is never a silent dead button); focus effect split from the Escape-listener effect (parent re-renders no longer yank focus); `aria-labelledby` added. Icons byte-inspected (PNG headers + visual).
- **Discipline lens — pass.** Canonical nav sets now test-pinned per its suggestion; the removal-serialization guard recorded as deliberate (one tombstone round-trip at a time — old window.confirm allowed concurrent removals).

### Decisions made

- **Removals serialize** — while one removal's server action is in flight, confirming another is a no-op (dialog still closes). Deliberate change from the synchronous-confirm era; prevents interleaved tombstone writes from one screen.
- **Skeleton width left at 3xl** — `page-skeleton.tsx` now mismatches the 2xl hubs (pre-existing partial mismatch made consistent-in-the-wrong-direction by this unit). Per the discipline lens: recorded as a follow-up, not absorbed (one-class change next iteration).
- **No focus trap / focus-restore in ConfirmDialog** — beyond spec C's contract; joins the lightbox's recorded a11y follow-up (one shared dialog-foundation pass).

### Verification (spec 18 checklist)

- RED → GREEN per above. ✔ lint/typecheck/test — 232/232. ✔ build — manifest + apple-icon routes emitted, route table otherwise unchanged. ✔ e2e — 27/27. ✔ Manifest/icons/SW fetched live; icon visually inspected. ✔ Locked behaviors intact (lens 1). ✔ No diff under `supabase/`/`worker/`. ✔

### Open questions / iteration-6 queue

- `page-skeleton.tsx` width → `max-w-2xl` (one-class follow-up).
- Dialog-foundation a11y pass: focus trap + focus restore shared by ConfirmDialog + ZoomablePhoto.
- Real logo to replace the placeholder icon PNGs (paths/sizes stay).
- Operator install test: real-iPhone LINE-login round-trip in standalone mode, then the Thai install guide (app-feel doc step 1).
- Still queued: palette/outdoor theme (operator-visible), /pm/requests progressive disclosure, row-link extraction, LINE notification unit (`?openExternalBrowser=1` belongs there).

---

## Unit: iteration-6 design - spec 16 addendum + spec 19 draft (docs-only)

- **Status:** Designs committed 2026-06-11. Spec 16 Addendum LOCKED by the operator brief (site-wide purchase visibility - explicit reversal of the 2026-06-07 isolation decision; priority/critical-level enum). Spec 19 DRAFT (bottom tab bar locked by the "navigation still confusing" brief; the /pm/requests-into-/requests merge is RECOMMENDED, one operator veto gates it).
- **Specs:** [`16-purchase-request-enrichment.md` Addendum](./feature-specs/16-purchase-request-enrichment.md), [`19-bottom-tabs-nav.md`](./feature-specs/19-bottom-tabs-nav.md).
- **Adversarial pass (1 skeptic over both docs):** 2 majors fixed pre-commit - the naive prefix active-tab rule would have double-lit tabs on every /pm/projects/\* page (now longest-prefix-wins, single aria-current, test-pinned), and the signed-URL exposure radius in spec 16 item (f) contradicted A1 the day it shipped (amended in place). 9 minors folded: enumerated src/ artifacts the visibility flip invalidates (incl. the hub-nav test toEqual pins), pgTAP F.2 flip wording, ADR-0026 in-place pointers at the reversed isolation paragraph, migration rename folded into SS6, nulls-last confusion dropped, SS8 Thai strings for priority, cross-doc ordering reconciliation (spec 19 SS4 supersedes A1's requested_at desc), permanentRedirect(308) + SA-landing delta + dead revalidatePath, super_admin tab set + per-page mounting.
- **Implementation order (next sessions):** ADR 0026 -> spec 16 P1 (now incl. visibility + priority) -> P2 -> ADR 0027 -> P3; spec 19 SS1-SS3 any time after operator answers the SS4 veto question.

---

## Unit: bottom tab bar + purchasing-surface consolidation (spec 19, iteration 6 nav)

- **Status:** Complete — 2026-06-11 (operator approved the spec; §4 merge proceeded — operator reply raised no veto; merge-auto standing instruction).
- **Spec:** [`docs/feature-specs/19-bottom-tabs-nav.md`](./feature-specs/19-bottom-tabs-nav.md).
- **Note:** §4 ships with requested_at-only band ordering; the priority band joins when spec-16 P1 lands. /requests keeps the SA in-page heading until addendum A1 widens visibility.

### Done

- **Writing failing test first** — RED: new `tests/unit/bottom-tab-bar.test.tsx` failed module-absent, and the `hub-nav.test.tsx` `toEqual` pins broke against the four-item constants (the named UPDATE-test). GREEN after implementation; final suite **240/240** (232 prior + 8 net new).
- **§1 BottomTabBar** — phone-only fixed bottom bar (safe-area padded for the PWA), role-aware `SA_TABS` (3) / `PM_TABS` (4, super uses PM), longest-prefix active rule (exactly one `aria-current`, test-pinned at a nested path + zero on cross-surface), mounted per-page on all 9 authenticated surfaces with `pb-20 sm:pb-0`.
- **§2** — HubNav strip and the header โปรไฟล์ link are now desktop-only (one affordance per viewport).
- **§4 merge** — `/requests` is the single purchasing surface: pending rows first (oldest-first queue) with inline decision controls + ขอซื้อโดย line for pm/super, decided history below newest-first; role-conditional heading; `PM_HUB_NAV` → 3 items; operator-hub link updated; dead `revalidatePath` removed.

### Decisions made

- **Route handler instead of page-level `permanentRedirect`** (spec-text deviation, improvement): a page redirect streams as HTTP 200 under `/pm`'s `loading.tsx` Suspense boundary — browsers navigate but the promised 308 never hits the wire. `/pm/requests/route.ts` + `NextResponse.redirect(…, 308)` delivers a REAL 308 (verified live on the dev server); the segment's `loading.tsx` deleted (route handlers don't stream).
- **No band heading in the merged list** (skeptic note): the old รออนุมัติ heading and queue-empty notice have no direct equivalent; pending-first ordering carries the signal. A รออนุมัติ band label / "queue clear" note for pm/super is a recorded one-liner follow-up if the operator misses it.
- **Unbounded fetch recorded:** PM/super now fetch all rows with no limit; acceptable at pilot scale — pagination joins spec-16 P1's ordering rework.

### Adversarial verification (3-lens workflow)

- **Security lens — pass.** SA visibility unchanged (RLS own-rows; `fetchDisplayNames` gated behind `isDecider`); a forged SA decide call is refused by the RLS UPDATE policy (0 rows → "already decided", audit trigger never fires); the 308 route leaks nothing and the proxy still gates it; the partition sort proven chronologically correct; tie-breaking in the prefix rule impossible by construction.
- **UX/locked lens — pass.** Spec-12 back-bar and spec-10 pinned-form intact; spec-18 §B amendment note added; stale comments fixed.
- **Discipline lens** — its major was this missing completion record; written now.

### Verification (spec 19 checklist)

- RED → GREEN per above. ✔ lint/typecheck/test — **240/240**. ✔ build (route table: /pm/requests now a route handler). ✔ e2e — **27/27**. ✔ Live: `/pm/requests` returns HTTP **308 → /requests** on the dev server. ✔ No diff under `supabase/`/`worker/`. ⏳ Phone-width visual pass (tab bar/safe-area/active states) — auth-gated, placeholder env cannot log in; **pending operator on the next production deploy** (unit pins + e2e cover behavior).

### Open questions / iteration-7 queue

- รออนุมัติ band label or queue-clear note for pm/super (one-liner, if wanted).
- Decided-history pagination (joins spec-16 P1).
- Carried: skeleton width one-liner, dialog a11y foundation, real logo, palette/outdoor theme, LINE notification unit.

---

## Unit: spec 16 P1 - dates, priority, unit picker, site-wide visibility (ADR 0026)

- **Status:** Complete - 2026-06-11 (schema half committed 9578a09 mid-unit; code half this entry). Supabase CLI linked from this machine this session (operator chose option 1; an access token was already present - `pnpm db:link` succeeded; remote migration list verified in sync at 20260608140300).
- **Spec:** [`docs/feature-specs/16-purchase-request-enrichment.md`](./feature-specs/16-purchase-request-enrichment.md) P1 + Addendum; ADR 0026 written this unit with in-place pointer edits to ADR 0018/0022/0025.
- **Plan:** ADR -> migrations x3 -> adversarial SQL review -> db:push -> db:types -> pgTAP 17/18 updates -> db:test -> code test-first (units, formatThaiDate, validator, priority pill, form, /requests) -> full gate -> final adversarial pass -> commit.
- **Note:** the addendum asked for a pointer edit inside applied migration 20260608120000 - REFUSED as written (applied migrations are checksummed/immutable); ADR 0026 carries the supersession instead. Recorded as a correction to the addendum.

### Done (code half)

- **Writing failing test first** — RED: `purchaseRequestPriorityPillClasses` cases failed export-absent in `tests/unit/status-colors.test.ts`; the `purchase_request_priority` map row failed in `tests/unit/i18n-labels.test.ts`. GREEN after implementation. (The pure-module tests — units list, formatThaiDate, validator neededBy/priority — shipped RED→GREEN inside the schema commit.) Final suite **260/260** (240 prior + 20 net new across both halves).
- **§1 unit picker** — `<select>` of the 25 `COMMON_UNITS` + `อื่น ๆ (ระบุเอง)` sentinel revealing a free-text input; derived `unit` string feeds the unchanged validator/action/DB contract; sentinel never persisted by the form; select counts toward `userTyped`.
- **§2 needed_by** — date input with Bangkok-today soft floor (`bangkokToday()` mirrors the validator clock); card fact line `ต้องการรับของภายใน {formatThaiDate}`.
- **§3 eta** — fact line `คาดว่าจะได้รับของ {formatThaiDate}` on approved|purchased only (hidden once delivered, Q4 no-badge); footer gains the back-office update sentence.
- **A1 site-wide visibility** — `.eq(requested_by)` filter removed; requester line (name → email → em-dash via `fetchDisplayNames`) for EVERY viewer; ของฉัน/ทั้งหมด filter chips (active chip `aria-current`, `min-h-10` tap targets, pinned `?wp=` survives the toggle); empty-state wording switches on the chip; stale own-rows comments rewritten. ADR 0026 name-exposure sentence amended to record the email-fallback radius (security-lens finding).
- **A2 priority** — `purchaseRequestPriorityPillClasses` (critical red / urgent amber / normal zinc, ปกติ renders no pill); ความเร่งด่วน select defaulting ปกติ; pending band ordering critical → urgent → normal then requested_at asc; `PURCHASE_REQUEST_PRIORITY_LABEL` map pinned total/Thai/distinct.
- **Typed server client (discovered blocker, minimal fix)** — `createServerClient` in `src/lib/db/server.ts` had NO `<Database>` generic: every server-side query row has been silently `any` since the file was written (downstream casts masked it; the strict `Record<PurchaseRequestPriority, number>` band map exposed it). One-line generic added — empirically zero blast radius (full gate green), type-level only, no runtime/auth change. Without it the spec's new columns could only flow to the UI as `any`, violating the repo TS rule. `browser.ts` and `admin.ts` have the same gap — recorded below, NOT fixed (out of unit path).

### Decisions made / recorded deviations

- **ของฉัน chip is server-side** (`?mine=1` via searchParams) — deviation from A1's "client-side filter chip" wording; zero-client-JS pattern of the rest of the page, no `'use client'` island needed.
- **Priority band sort is in-process**, not A2's `order by priority desc, requested_at asc` — one fetch serves both bands' opposite date orders (pending asc within band, decided history desc), which a single SQL ORDER BY cannot.
- **Priority control is a native `<select>`**, not A2's "segmented" select — same iOS-Safari/LINE-browser rationale §1 records for the unit dropdown; flag if the operator wants real segments.
- **`select(...)` is the named 19-column list** per A1 — an interim `select("*")` workaround (with a wrong justification comment) turned out to be an artifact of the untyped client and was removed once the generic landed.
- **ระบุหน่วย visible label** added above the other-unit input (spec lists only the placeholder) — a11y-consistent with every other field's label.
- **Spec-19's decided-history pagination deferral re-recorded:** spec 16 P1's ordering rework shipped WITHOUT pagination (spec 16 does not ask for it) — still open, see queue.

### Adversarial verification (3-lens, over the uncommitted diff)

- **UX/locked-behavior lens — FAIL → fixed.** Major: the filter chips dropped a live `?wp=` (pinned-mode form unmounted, typed input destroyed, spec-12 back-bar flipped) — fixed, chips now carry the pinned id. Minors fixed: `aria-current` on the active chip (spec-19 precedent), chip tap target `min-h-8` → `min-h-10`. Thai strings hex-verified byte-exact vs §8/A2; Q4 eta rule, comparator correctness, form ergonomics, spec-10/12/15/19 locked behaviors all confirmed.
- **Discipline lens — FAIL → resolved.** Completeness 100% (every P1 requirement traced). Its select("*") major was *refuted with evidence\* (the named select genuinely failed typecheck — but because of the untyped client, which the lens probe missed by typing its own probe client; the real fix was the generic, after which the named select compiles). Its missing-tracker-records major is satisfied by this entry. Honest residual it flagged: nothing pins the pending-band ordering — a regression there is invisible to `pnpm test` (queued).
- **Security lens — pass-with-minors.** fetchDisplayNames radius exactly ADR 0026 (server-only, id-scoped, RLS-admitted rows only); `?mine` can only narrow, never widen; hostile action invocations gain nothing (validator + INSERT policy + CHECKs); `<Database>` generic confirmed type-level only. Minors/nits queued below; ADR 0026 email-fallback amendment made in-place.

### Verification (spec 16 §11 checklist, P1 items)

- ADR 0026 merged before P1 code incl. in-place back-pointers. ✓ New unit tests RED→GREEN per phase. ✓ lint/typecheck/test — **260/260**. ✓ db:push → db:types → db:test — **428 pgTAP assertions, 0 failures** (17→100, 18→52, incl. visibility flip, qual pin, priority pins, eta grant/audit pins). ✓ build (route table unchanged). ✓ e2e — **27/27**. ✓ Locked behaviors intact (UX lens). ✓ No dashboard changes. ✓ ⏳ Tier-2 smoke re-run + AppSheet column config (`needed_by` + `priority` read-only, go-live §2a) — **operator step before AppSheet next touches these views**.

### Open questions / iteration-8 queue

- **Server-side length caps for `unit`/`item_description`** (security minor): client maxLength is the only bound today; a hostile authenticated insert can bloat the now site-wide /requests SSR. Validator + CHECK follow-up.
- Type the **browser.ts / admin.ts** Supabase clients (`<Database>` generic) — same silent-`any` gap as server.ts had; one line each plus whatever it surfaces.
- **Pending-band ordering has no unit test** — extract the comparator to a pure module or pin via component test.
- Sentinel literal `__other__` is persistable via a direct action call (cosmetic only); non-string `neededBy` in a forged action payload 500s instead of returning the error union (fail-closed) — both validator hardening one-liners if wanted.
- Decided-history pagination (re-recorded from spec 19).
- Carried: ของฉัน band label/queue-clear note, dialog a11y foundation, real logo, palette/outdoor theme, LINE notification unit, skeleton width one-liner.
- **Next per spec-16 implementation order:** P2 (attachments — load `.claude/skills/supersede-pattern` first) → ADR 0027 → P3.

---

## Unit: sun-readable redesign — light theme + nav identity (spec 20, iteration 8)

- **Status:** Complete - 2026-06-11 (operator brief: "ui is bland and hard to identify anything, due to colors, contrasts, sizes; redesign navigation as well; most users are on site, in the sun"). Spec-16 P2 deferred one iteration — the operator brief takes the slot; closes the palette/outdoor-theme item carried since iteration 3.
- **Spec:** [`docs/feature-specs/20-sun-readable-redesign.md`](./feature-specs/20-sun-readable-redesign.md) — written this unit from the brief; amended in place by the adversarial pass (see below).

### Done

- **Writing failing test first** — RED: sun-fill palette pins (status-colors ×2) and the tab-bar indicator/bg-white/size-6 pin failed against the dark theme; GREEN after implementation. Three legacy dark pins (ErrorNotice/EmptyNotice classes, manifest `#09090b`) updated to the new values at identical assertion strength — the spec-sanctioned named UPDATE-tests. Final suite **263/263**.
- **Theme flip** — every authenticated + public surface goes `bg-zinc-950` dark → white ground / near-black ink per the §3 recipe table (~30 files; three agents swept SA/PM/misc surfaces, purchasing surfaces done in-session). Two recorded dark exceptions: ConfirmDialog + lightbox scrims/chrome. LINE login button untouched (brand).
- **Status identity** — five PILL slots become solid saturated fills (`status-colors.ts`); StatusPill geometry up to `px-3 py-1 text-sm font-semibold`; notices light; skeleton zinc-200.
- **Nav redesign** — BottomTabBar: white bar + shadow, size-6 icons, text-xs labels, active = blue-700 + visible top indicator bar (replaces the emerald tint); HubNav: text-sm light strip, current page = blue underline + semibold ink; AppHeader: blue kicker (the brand moment), text-xl heading, blue โปรไฟล์ link. Sets/hrefs/active rule/aria byte-unchanged.
- **PWA chrome** — manifest + viewport `#ffffff`; `html { color-scheme: light }` opts out of Chrome Android force-dark (adversarial-pass addition).
- **Live verification** — /login inspected on the dev server: white ground (`rgb(255,255,255)`), ink text, 30px h1, theme-color meta `#ffffff`, manifest white. Auth-gated pages not visually exercisable on this machine (no login) — **operator outdoor phone pass is the acceptance step**; preview screenshot tool was wedged (renderer), DOM-level checks used instead.

### Adversarial verification (3-lens) — and fixes landed pre-commit

- **Contrast/a11y lens — FAIL → fixed.** Computed real Tailwind-v4 ratios: PILL_EMERALD white-on-emerald-600 was **3.67:1 (AA fail)** → fill bumped to emerald-700 (5.37:1); PILL_MUTED zinc-500-on-zinc-100 4.39:1 → zinc-600 (7.02:1); focus rings were same-hue-on-same-fill (1.0:1, invisible) → `ring-offset-2` added at every solid-fill site; `color-scheme: light` added. Spec §0's "blue-700 ≈ 8.6:1" was a v3-era number — corrected to 6.82:1 with the trade-off recorded.
- **UX/locked-behavior lens — pass-with-minors, fixed.** Copy/routes/aria verified byte-identical (className-residue diff check); all locked behaviors intact. Fixed: pending-tile labels got white plates (ink over dark photos was ~2.3:1), download button's opacity-fade disabled state → explicit gray, back-link treatment unified to blue-700 across surfaces, SA local h1s → text-xl.
- **Discipline lens — pass-with-minors.** Spec §1a's "local pill literals on PM pages" claim was FALSE (all three pages already used the shared helpers) — spec amended in place. No unreported scope creep beyond the judgment calls below.

### Decisions made / recorded deviations (spec §3 judgment calls)

- White-on-emerald-700/red-600 pills sit at 5.37/4.76:1 — AA-pass but under the 7:1 sun floor; accepted: hue + semibold label carry identification, darker fills kill the hue. Same posture for blue-700 actions (6.82:1).
- Purchase-request form card uses `bg-zinc-50` (not the card recipe's white) so its white inputs keep an edge against the card.
- Filter-chip pattern extended to the hide-completed checkbox label (work-package-list); checkbox accent-blue-700; selected radio cards = blue-50 tint (record-decision-form); OperatorHub kicker on coming-soon shares the blue kicker treatment; emerald meta texts (บันทึกแล้ว, ได้รับของเมื่อ) → emerald-700 medium; progress fill emerald-600 (2.89:1 vs track — non-text, aria + count carry it; recorded shortfall).
- Thumbnail remove button = solid destructive red (the lightbox close stays dark per §1d) — asymmetric by design: one floats on photos inside a dark viewer, the other on a light tile grid.
- ConfirmDialog destructive confirm keeps a red ring (+offset) — red identity on the destructive control; everything else rings blue.

### Verification (spec 20 §8 checklist)

- RED → GREEN per above; suite **263/263**. ✓ §8 greps: dark survivors = the two scrim exceptions + lightbox chrome + `text-zinc-950` on amber/LINE fills; mid-gray survivors are placeholders/disabled/dividers/PILL_MUTED only. ✓ No route/copy/aria/item-set change (class-residue diff). ✓ build + e2e **27/27**. ✓ No diff under `supabase/`/`worker/`. ✓ Manifest/viewport white, served live. ✓ 3-lens pass recorded above. ⏳ **Operator: outdoor phone pass** (the real acceptance test) on next deploy.

### Open questions / iteration-9 queue

- Sub-44px tap targets in phase-uploader (retry ~22px, remove 28px) + reports breadcrumb/header text-xs links — geometry pass for gloved hands.
- ZoomablePhoto focus ring clipped by `overflow-hidden` (pre-existing, now blue) — joins the dialog-foundation a11y pass.
- Spinner track on the red remove button ~1.8:1 (shared one-class spinner) — give Spinner a className prop or a white variant.
- Dark/night-shift toggle (tokens make it cheap) — operator decision.
- Carried: spec-16 P2 attachments (next per implementation order), length caps, browser/admin client typing, pending-band ordering test, pagination, ของฉัน band label, real logo, LINE notification unit, skeleton width.

## Spec 21 - urgency segmented control (2026-06-11)

Status: COMPLETE. Priority select replaced with a fieldset of 3 native radios styled as h-11 segmented buttons (sr-only inputs, label-as-button). Selected-only coloring: normal=zinc-700, urgent=amber-500, critical=red-600; unselected stay neutral outline. Same priority state, no validator/enum/DB change. Test-first: tests/unit/purchase-request-form-priority.test.tsx (default normal checked; selecting critical unchecks rest). lint/typecheck/test all green (265 tests). Also shipped same-day, pre-spec: mobile stacking fix for date/priority row (5bdacf7) and appearance-none on the date input to stop iOS width overflow (d28816a). Open question: request list ships pills already; consider same segmented control on any future edit form.

## Spec 22 - order tracking stepper + on_route status (2026-06-11)

Status: COMPLETE. Part A (DB): on_route enum value (after purchased) + shipped_at fact column granted to appsheet_writer; derive trigger maps purchased+shipped_at => on_route, delivery guard widened to purchased|on_route (skip stays legal per ADR 0027); audit: purchased->on_route as action 'update' with transition payload (no new audit_action value); RLS stage gates widened - WITHOUT this the derive transition violates WITH CHECK (caught pre-push). pgTAP file 19 (16 asserts) + file 17 enum pin updated; suite 444 asserts green post-push. Types regenerated. Part B (UI): PurchaseRequestTracker server component (5 stages, rejected red terminal + muted rest, skipped on_route renders done-without-date, ETA under delivery stage while undelivered), mounted on every /requests card; on_route label + sky-700 pill. 271 unit tests green. OPERATOR TODO: expose shipped_at editable in AppSheet column config + re-run Tier-2 smoke ritual (appsheet_writer_p2.sql). Open question: requester-visible courier/tracking-no fields (future spec).

## Spec 23 - delivery-confirmation photos (2026-06-11)

Status: COMPLETE. DB: shipped the locked spec-16 P2 attachments architecture (table + checks + composite FK + token side table + triple-enforced append-only + \_current/\_appsheet security_invoker views + private pr-attachments bucket with path-bound upload policy) PLUS the ADR 0028 purpose discriminator and delivery-confirmation branches (table INSERT policy + storage policy). Fix-forward during pgTAP: the tombstone-target subquery self-referenced the table inside its own policy -> 42P17 recursion; cured with SECURITY DEFINER helper pr_attachment_tombstone_target_ok (20260614100300), ADR 0011 precedent. pgTAP files 20 (52 asserts incl role-sim) + 21 (bucket); suite 503 asserts green. UI: DeliveryPhotoUploader on delivered cards (direct-to-bucket upload + metadata action addDeliveryConfirmationPhoto), creator-only tombstone removal (AttachmentRemoveButton + removePurchaseRequestAttachment), signed-URL thumbnails via mintSignedUrlsForAttachments, ZoomablePhoto reuse. Pure modules attachment-path + validate-attachment test-first. 277 unit tests green. NOTE: spec-16 P2 reference-attachment UI is now app-code-only (DB shipped here); P3 bridge ADR renumbered 0029. OPERATOR TODO: re-run Tier-2 smoke (script updated for on_route [2c] probe this session); spec-16 P2 operator fixture protocol applies when reference UI ships. Open question: pgTAP storage positive-path upload probe is owned by the smoke ritual, not pgTAP (runner has no storage API).

## Spec 16 P2 UI - reference attachments (2026-06-11)

Status: COMPLETE (DB shipped under spec 23). New action addPurchaseRequestAttachment (per-kind validation, server-rebuilt path, purpose=reference). PurchaseRequestAttachmentStager: deferred mode in the create form (staged chips -> flush(prId) after createPurchaseRequest; failures keep chips with retry + amber note beside the saved confirmation; flushedIdRef enables post-flush retry) and immediate mode in the เพิ่มรูปหรือลิงก์ details-expander on own requested cards. /requests cards render รูปอ้างอิง thumbnails + ลิงก์อ้างอิง anchors (noopener noreferrer nofollow, truncated) for every status; creator-only ลบ while requested. One attachments query for ALL visible requests split by purpose/kind; single signed-URL batch. Form gains required projectId prop (priority test updated). 277 unit green; no schema change. NEXT: P3 AppSheet image bridge (ADR 0029) is now unblocked end-to-end. Verified-by-checklist posture per spec 16 §7 for stager/action wiring (pure seams carry the tests).

## super_admin navigation fix (2026-06-11)

Status: COMPLETE. Operator report: 'superadmin has a weird navigation'. Root cause: roleHome() only knew site_admin/project_manager, so super_admin fell into the /coming-soon default — post-login redirect (LINE callback, /login, /), the /profile back link, and the bare /requests back link all bounced a fully-privileged role to the 'tools not ready' page. Fix: super_admin → /pm (consistent with the tab bar giving super the PM set, spec 19). Test-first: tests/unit/role-home.test.ts pins all served + unserved roles. 279 unit tests green.

## Incident: AppSheet EMAXCONNSESSION (2026-06-11)

Operator screenshot: AppSheet app failed to load — 'max clients reached in session mode, pool_size: 48' on projects + users reads. Diagnosis: AppSheet data source pointed at the SESSION pooler (5432, per go-live checklist Step 2 wording); Supavisor session pools are per-DB-user with a 48-client cap, and AppSheet's parallel sync burst exhausted appsheet_writer's pool. pg_stat_activity showed ZERO held appsheet_writer backends at diagnosis time — burst, not a leak; nothing to terminate; no prod change made. Fix: operator repoints AppSheet to the TRANSACTION pooler (6543). Checklist Step 2 now documents the port split (5432 = smoke ritual only). Raising session pool_size is not viable (already near the compute tier's max_connections). Open question: if AppSheet misbehaves on transaction mode (prepared-statement quirks), revisit — fallback is a dedicated session pool budget discussion.

## PM work-package visibility (2026-06-11)

Status: COMPLETE (option 1 of 2). Operator: 'why PM cannot see WP?' Root cause: navigation gap, not RLS — the PM journey went project list -> reports directly; WPs only reached PMs via the รอตรวจ queue. Fix: the reports page nav strip gains a รายการงาน link to /sa/projects/{id} (already PM-authorized; already the WP review screen's spec-12 back-target). Verified-by-checklist (page link; no pure seam). 279 tests green. Open question: option 2 (a real /pm/projects/{id} hub with WP list + reports tab) if the operator wants PM-styled WP browsing later.

## Spec 24 - photo receipt completes delivery (2026-06-11)

Status: COMPLETE. Operator: 'when status is on_route, users on site can attach images, then we know delivery is complete.' ADR 0030 (amends 0028's delivered-only gate): confirmation-photo INSERT + storage branches widened to on_route|delivered; new AFTER INSERT SECURITY DEFINER trigger purchase_request_attachments_complete_delivery sets delivered_at + received_by (users.full_name) on an on_route parent — existing derive trigger advances status, existing audit trigger writes purchase_request_delivery (principal 'authenticator' = app path, recorded in ADR 0030). purchased rows still deny confirmation photos (flow starts at on_route; open question whether skip-path needs app-side completion). pgTAP 20 plan 52->60; suite 511 green. UI: uploader + photo section on on_route cards; footer copy rewritten (photo confirmation sentence; removed the now-false 'cannot edit in app' claim for delivery). 279 unit green.

## Nav coherence fixes (2026-06-11)

Status: COMPLETE. Operator reports: (1) tab highlight disappears inside tab details — root cause: PM/super on /sa/\* cross-surface paths matched no PM tab (spec 19 accepted this; now reversed by operator). Fix: TabItem gains optional match[] prefixes; PM โครงการ claims /sa; longest-prefix-wins still guarantees exactly one lit tab. bottom-tab-bar test updated (named UPDATE: cross-surface pin flipped) + 2 new cases. (2) Tab roots showed กลับ on mobile where the tabs ARE the nav — /profile back link and the bare /requests back strip are now desktop-only (pinned /requests keeps its contextual spec-12 back-bar everywhere). Audit found no other offenders (other back affordances are contextual: กลับไปหน้ารายการงาน, โครงการทั้งหมด). 281 unit green. Noted, not changed: reports-page nav strip duplicates the รอตรวจ tab destination on mobile — harmless, contextual.

## Spec 25 - WP-inline purchase status, own-row badge, on_route upload fix (2026-06-11)

Status: COMPLETE. Three operator items: (1) BUG: photo upload at on_route failed — addDeliveryConfirmationPhoto's status check still demanded 'delivered' (outlived the ADR 0030 policy widening; bytes uploaded, metadata insert refused). Widened to on_route|delivered. Lesson: when a policy gate widens, grep ALL layers (policy, storage policy, action, UI render condition) — the action layer was missed. (2) WP detail screen now renders คำขอซื้อของงานนี้ — its purchase requests with pill + tracker inline + link to /requests?wp= (operator: status must show inside the WP). (3) Site-wide /requests rows carry a ของฉัน badge when requested_by = viewer. Page-level changes verified-by-checklist; 281 unit green.

## Spec 26 - request card slimming (2026-06-11)

Status: COMPLETE. Operator: card takes too much space. Audit: the stepper (spec 22) already encodes stage dates + ETA, so the standalone อนุมัติเมื่อ / คาดว่าจะได้รับของ / สั่งซื้อเมื่อ / ได้รับของเมื่อ lines were pure duplication (up to 4 text lines per decided card). Removed; supplier + receiver (facts the tracker does NOT carry) fold into one compact line; ขอเมื่อ drops to date-only. Kept: rejection block, needed_by, delivery note, attachments. 281 unit green. Separate-DB question answered in chat (assessment: NO — same-DB; schema gaps listed as iteration queue: cancellation status, PR running number, suppliers table, line items, partial deliveries, courier fields).

## Spec 27 - cancellation + PR running number (2026-06-11)

Status: COMPLETE. ADR 0031. DB: cancelled enum value (after rejected, own migration); cancelled_at/by/reason facts + pr_cancel_shape CHECK; pr_number bigint sequence-fed, backfilled chronologically (requested_at order), NOT NULL+UNIQUE+default; cancellation audit trigger (action 'update', transition payload — third no-new-audit-action use). pgTAP file 22 (15 asserts incl. PM cancel lives / SA statement affects 0 rows / audit payload); enum pins updated in files 17 AND 19 (19's pin was missed first run — lesson: grep ALL enum_has_labels pins when adding a value). Suite 526 green. App: ยกเลิกแล้ว label, muted pill, tracker cancelled state (approve stays green, rest muted — administrative close, test-first), cancelPurchaseRequest action (decide-pattern two-layer guard), ยกเลิกคำขอ button on approved cards (decider-only), PR-XXXX mono prefix on /requests + WP-inline cards. 283 unit green. OPERATOR TODO (BLOCKING for AppSheet saves): mark pr_number, cancelled_at, cancelled_by, cancellation_reason READ-ONLY in AppSheet column config, then re-run Tier-2 smoke. Open seam: requester self-cancel RPC; cancellation-reason UI prompt.

## Spec 28 - WP detail redesign: owner/team, attention strip, responsive IA (2026-06-11)

Status: COMPLETE. ADR 0032 (extends ADR 0013 - membership is display metadata, NEVER an access gate; first deliberately-mutable domain table, justification recorded). Part A DB: work_packages.owner_id + work_package_members (PK wp+user, RLS: staff read / PM+super write with added_by pin; real DELETEs); pgTAP file 23 (15 asserts); suite 541 green; types regenerated. Part A UI: fetchAssignableStaff (admin client, names only; users has NO email column - uuid-head fallback), 3 assignment actions (RLS-relay pattern), WpAssignmentPanel (PM/super details-expander: owner select + member add/remove), header chips ผู้รับผิดชอบ + ทีม (4 names + overflow count). Part B: header summary line (รูป X/3 ช่วง + คำขอซื้อ Y ค้าง), attention strip under header (latest needs_revision=amber / rejected=red w/ comment+decider+date - the SA could never see WHY work bounced on this page before), description details-block (column existed, never shown). Part C: md+ two-column grid (photos 1.6fr left; description/purchasing/history right rail; phone keeps single column photos-first), approval history details (all decisions, pills + comments + names). 283 unit green. Telegram icon convention also adopted this session (memory). Open question: งานของฉัน WP-list filter now one query away.

## Spec 29 - create-form embeds in WP detail (2026-06-11)

Status: COMPLETE. Operator: two WP links (สร้างคำขอซื้อ + ดูรายละเอียดคำขอซื้อทั้งหมด) pointed at the SAME URL (/requests?wp=X) and creating a request teleported users out of the โครงการ tab. Site map drawn in chat. Fix: PurchaseRequestForm now mounts inside the WP detail right rail as a สร้างคำขอซื้อ details-expander (component already took workPackage+projectId props — zero form changes); duplicate header link removed; list link renamed ดูในแท็บคำขอซื้อ → plain /requests (explicit tab switch). /requests?wp= pinned mode remains functional but NO in-app link produces it — recorded seam (candidate for removal in a future cleanup spec). 283 unit green.

## Spec 30 (partial) - WP page zone headers + link removal (2026-06-11)

Status: items 1+2 COMPLETE; item 3 (contractor owners) awaiting operator decision. 1) ดูในแท็บคำขอซื้อ link removed (operator). 2) WP detail gets three zone headers (icon + bold + heavy underline rule): รูปถ่ายงาน (Camera) / คำขอซื้อ (ShoppingCart: create expander + list) / ข้อมูลงาน (FileText: description + approval history) — fixes 'everything looks like the same category'. คำขอซื้อของงานนี้ h2 absorbed into the zone header. 283 unit green. PENDING DECISION (item 3): operator says มอบหมายงาน should assign WP OWNERS = outsiders (subcontractor crews) — needs contractors master table; question asked whether spec-28 internal owner/team stays alongside or is replaced.

## Spec 31 - contractor WP owners (2026-06-11)

Status: COMPLETE. ADR 0033 (supersedes ADR 0032's user-owner UI; operator decision 'Replace' — WPs are executed by outsider crews without logins). DB: contractors master (name nonblank CHECK, phone, created_by pin; PM/super insert+update, NO delete policy — referenced contractors stay forever) + work_packages.contractor_id; pgTAP 24 (12 asserts), suite 553 green; types regenerated. App: assignment-actions reworked (createContractor + setWorkPackageContractor), WpAssignmentPanel reworked (contractor select + inline เพิ่มผู้รับเหมาใหม่ create-and-assign), header line ผู้รับเหมา {name · tel-link}; spec-28 user-owner UI removed — owner_id + work_package_members DORMANT (cleanup candidates at v2, ADR 0033); fetchAssignableStaff now unused by pages (kept — future user pickers). 283 unit green.

## Spec 31 amendment + layout fixes (2026-06-11)

Status: COMPLETE. Operator screenshot (desktop): 1) WP page wasted side space — header/attention/grid wrappers gain lg:max-w-6xl (+ lg:gap-8). 2) SA could not add/assign ผู้รับเหมา — contractors INSERT/UPDATE policies widened to staff (sa/pm/super); assignment moved to SECURITY DEFINER RPC set_work_package_contractor (writes contractor_id ONLY — widening the WP UPDATE policy would hand SA every column); p_contractor_id DEFAULT NULL fix-forward so typegen marks it optional (clearing = omit arg). pgTAP 24 rewritten (14 asserts incl. visitor 42501 + SA-direct-update-still-filtered); suite 555 green. 3) Form cramped in the narrow right rail — date/priority row sm:flex-row removed (viewport variants lie about CONTAINER width; the form's primary home is the rail since spec 29). Lesson: prefer container-relative layout for components that move between containers. 283 unit green.

## Unit: architecture revision doc — entrepreneur lens (2026-06-11)

- **Status:** COMPLETE (doc-only, advisory). Operator brief: "revise the architecture of this app; think like an entrepreneur, not just technical."
- **Deliverable:** [`docs/architecture-revision-2026-06.md`](./architecture-revision-2026-06.md) — strategic assessment of the whole system by business criteria (cost/month, ops burden per change, engagement, sellability, moat).

### Key positions taken (all pending operator sign-off — §6 of the doc)

1. **AppSheet = rented ground.** Stop investing: cancel the unwritten ADR 0029 image bridge, build the in-app procurement surface + suppliers table instead (derive triggers are already writer-agnostic per ADR 0025; `procurement` role waits in the enum), demote AppSheet to read-only, then retire. Kills the per-schema-change operator tax, the Tier-2 write smoke, the EMAXCONNSESSION incident class, and the licence line.
2. **LINE notification outbox promoted to next feature slot** — audit triggers already detect every hand-off event; they just don't deliver. Outbox table + drainer + LINE Messaging API channel.
3. **Railway retired when touched** — PDF on-demand (route handler spike first) or Edge Function; end-state two platforms.
4. **Tenancy decided on purpose:** instance-per-customer for now + tenant-clean discipline + spin-up runbook; multi-tenant schema deferred until customer #2 is real.
5. Migration rehearsal stage (preview branch/scratch project) before destructive pushes; photo client-side downscale question raised; crew capability-URL uploads parked as v2 differentiator; dormant owner_id/work_package_members cleanup listed.

### Open questions

- The four §6 operator decisions (AppSheet sunset, notifications next, tenancy posture, photo downscale).
- No code/schema/test change this unit; suites untouched (555 pgTAP / 283 unit as of a42f083).

## Spec 32 - LINE notification outbox (2026-06-11)

Status: COMPLETE (operator activation pending — checklist §8). Operator granted decision authority ("you are allowed to make the calls"); ADRs 0034 (AppSheet sunset, ADR-0029 bridge CANCELLED), 0035 (instance-per-customer tenancy + tenant-clean rule), 0036 (client downscale becomes the stored original — implementation spec later) recorded the four §6 calls, then the architecture-revision §3.2 priority shipped as spec 32 + ADR 0037.

DB (3c46e22 + 5f4b8be): notification_event_type + notification_status enums, notification_outbox (deliberately mutable delivery state; privileges revoked + RLS with zero policies), four SECURITY DEFINER capture triggers (WP→pending_approval, approvals INSERT, PR INSERT, PR status transitions incl. derive-driven) — failure-SWALLOWING by design (RAISE WARNING; notifications must never block a photo/decision/AppSheet write — recorded divergence from audit triggers). Drain schedule: pg_cron + pg_net every minute → invoke_notification_drain() reads notification_drain_url/secret from Vault, silent no-op until configured. In-build adversarial finding: minute-cron overlap could double-send → claim state (pending→sending + claimed_at, status-guarded UPDATE; 10-min reclaim pass) shipped as spec amendment, enum value in its own migration (spec-27 precedent). pgTAP file 25 (26 asserts incl. role-sim capture paths, derive-driven transition, WHEN-guard negative, cron-job pin); suite 581 green post-push; types regenerated.

App: pure modules test-first (payload narrow, compose-notification Thai copy via central label maps + PR-padding, resolve-recipients with actor-exclusion/no-self-notify + dedupe, drain-policy expiry/reclaim/attempt outcomes, line-push wrapper) — 27 new unit tests, suite 310 green. Drain route handler POST /api/notifications/drain: x-drain-secret gate, 503 not_configured until env set (verified LIVE on dev server: 503 + {"error":"not_configured"}), reclaim→expire→claim→enrich (batched: WP codes, PM pool, photo uploaders, line ids)→compose→per-recipient push→outcome writes. env.server.ts gains LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NOTIFICATION_DRAIN_SECRET (both optional ON PURPOSE — deploys boot unconfigured); .env.example documented. Queued-item pulled forward as dependency: admin.ts gains <Database> generic (typed outbox queries) — surfaced exactly one stale cast (addPhoto .in() as-unknown-as removed). browser.ts typing still queued.

OPERATOR TODO (activation, checklist §8): create LINE Messaging API channel (separate from Login channel), long-lived token → Vercel env ×2 + redeploy, Vault secrets ×2, users friend the OA (QR), acceptance probe (After photo → PM LINE push ≤1 min).

Open questions / seams: per-user notification preferences/opt-out; Flex message formatting; drain-on-write fast path; Web Push fallback; notification history UI; LINE OA message-quota plan choice (operator); failed-row resend tooling. Carried queue unchanged (tap targets, length caps, browser client typing, pending-band ordering test, pagination, ของฉัน band label, real logo, LINE-notification unit NOW DONE, skeleton width). NEXT per ADR 0034: in-app procurement surface + suppliers table (AppSheet write parity → demote to read-only).

### Spec 32 adversarial verification (3-lens workflow) — fixes landed pre-commit

- **Blast-radius + discipline lens — MAJOR, fixed:** `.env.example` shipped the two optional vars as empty assignments; dotenv loads `VAR=` as "" and `.optional()` rejects "" → every fresh "copy .env.example" local boot (and a blank Vercel value) would crash env validation at import time. Fixed both ends: `optionalNonEmpty` preprocess (empty→absent) in env.server.ts + lines commented out in .env.example + 3 new env.test.ts cases (the existing per-var missing/empty pattern now covers the new vars).
- **Blast-radius minors, fixed:** photo_logs uploader enrichment included tombstone rows (uploaded_by = REMOVER per ADR 0015) → `.not("storage_path","is",null)`; no maxDuration on a 50×N-push route → `export const maxDuration = 60`; PostgREST 1000-row cap on the uploader query → loud warn when hit (pilot volumes far below).
- **Security minors, fixed:** drain secret now compared via sha256+timingSafeEqual; LINE 5000-char text limit enforced by truncation in pushLineMessage (an oversized user comment was a deterministic 400 → burned all 3 attempts → actor-controlled notification suppression) + unit test; pgTAP file 25 hardened +11 asserts (plan 37): authenticated UPDATE/DELETE denial, anon denial, policies_are ZERO, EXECUTE denial on invoke_notification_drain for anon+authenticated (PostgREST RPC exposure pin), all four capture functions SECURITY DEFINER + pinned search_path, pr_created WHEN-guard negative, and the headline failure-swallowing posture PROVEN (outbox renamed away inside the transaction → WP write still lands, zero rows captured).
- **Discipline:** payload.ts (5th pure module) had no tests → notification-payload.test.ts added (key mapping, type-narrowing drops, malformed input); recorded here as declared addition alongside the admin.ts typing pull-in. pr_cancelled trigger breadth (any→cancelled vs spec's approved→cancelled) recorded in ADR 0037 as deliberate, with the audit-widening caveat for any future self-cancel unit.

Final suite state: 318 unit / 592 pgTAP / 27 e2e, typecheck+lint clean, drain endpoint live-probed 503 not_configured pre-activation.

## ADR 0034 amendment - atrophy model (2026-06-11)

Operator asked for hybrid pros/cons before AppSheet retirement; evidence pass (2-agent inventory) found the hybrid sounder than the architecture-revision urgency credited: AppSheet write surface = 9 fact columns on ONE table (decide/cancel/create/delivery-by-photo already in-app), derive/audit/notification triggers writer-agnostic, grid bulk-entry value unquantifiable yet (operator: "cannot determine"). ADR 0034 amended: parity build proceeds (in-app purchase/shipment form + suppliers still NEXT) but parity does NOT auto-demote — both paths coexist; demotion when audit_log principal split shows in-app carrying >80-90% of fact-writes for several weeks, or on forcing event (customer #2 / next AppSheet outage). Column freeze + 3 open TODOs unchanged. Volume question converted to measurement (audit principal field) instead of a bet.

## Spec 33 - in-app purchase/shipment recording + suppliers master (2026-06-11)

Status: COMPLETE. ADR 0038 (amends ADR 0025 sole-writer + ADR 0026 eta-AppSheet-only). The ADR-0034-amendment parallel path: AppSheet untouched, zero AppSheet config needed; audit principal now measures which surface back office uses (atrophy model).

DB (4844963 + review-fix commit): suppliers master (contractors mirror — nonblank name, created_by pin, staff read incl. procurement, back-office write pm/procurement/super, NO delete) + purchase_requests.supplier_id FK (analytics link; supplier text stays as RPC-written name snapshot for display/AppSheet continuity). record_purchase + record_shipment SECURITY DEFINER RPCs (role gate, stage guards approved+unpurchased / purchased+unshipped, supplier-name snapshot, amount>0, order_ref<=80). Existing derive/audit/spec-32-notify triggers do ALL the rest — zero new triggers; pgTAP 26 proves end-to-end chain (approved→purchased→on_route walk, purchase audit row, shipment transition audit row, 2 pr_progress outbox rows).

App: validate-record-purchase + isBackOfficeRole pure modules test-first (RED confirmed pre-impl); createSupplier/recordPurchase/recordShipment actions (RPC relays, decide-pattern error unions, 42501/P0001 Thai mapping); PurchaseRecordForm (supplier select + inline เพิ่มผู้ขายใหม่ create-and-pick, order_ref/amount/eta) on approved cards; PurchaseRequestShip (confirm) on purchased cards; both gated isBackOffice; footer copy now names both paths. 325 unit green.

### Adversarial verification (3-lens) — fixes landed pre-commit

- Security: table-level INSERT/UPDATE grants let SA set supplier_id at INSERT and PM desync the supplier snapshot via direct UPDATE → migration 20260616000400 column-scopes authenticated to exactly the create/decide/cancel column sets; fact columns are now RPC/AppSheet-only at the privilege layer. pgTAP pins both denial paths + RPC secdef/search_path + anon EXECUTE denials.
- Blast radius: record_purchase wiped AppSheet-pre-set order_ref/amount/eta when params omitted (eta wipe audit-INVISIBLE — purchase payload has no eta) → migration 20260616000300 coalesce semantics + pgTAP preserved-eta probe. Form: supplier duplicate after revalidate (dedupe), silent amount loss on badInput (validity check).
- Discipline (FAIL → fixed): procurement role cannot reach /requests (requireRole excludes; roleHome → /coming-soon) — recorded as deferred seam in spec+ADR, NOT silently widened (needs requireRole+roleHome+tab-set spec together); record_shipment role gate + shipment audit row were untested (added); createSupplier missing phone-length server check (added); this tracker entry itself (was missing at review time).

Suite state: 325 unit / 27 e2e / pgTAP 26 files (34 asserts in file 26) — db:test rerun after the two review-fix migrations push. Open seams: procurement-role onboarding spec, in-app fact corrections (audited RPC), bulk/grid mode (usage-data-driven), supplier merge/dedup, spend analytics, AppSheet supplier_id backfill. OPERATOR: nothing required — feature is live for PM/super on next deploy; AppSheet keeps working unchanged.

### Spec 33 post-push fix-forward

File 17 G.7/G.8 pinned the superseded spec-16 P1 posture (table-level eta UPDATE grant) and failed against the column-scope migration — rewritten as named UPDATE-tests asserting the ADR 0038 reversal (super_admin direct eta UPDATE now 42501; no case-3 diff from a denied write; appsheet eta-audit coverage lives on in file 18 + smoke [4a]). File 26 plan corrected to 35. Final suite: 627 pgTAP / 325 unit / 27 e2e, all green. Lesson re-learned from spec 27: when a posture flips, grep ALL pgTAP files that PIN the old posture, not just enum pins.

## Spec 34 - client photo downscale (2026-06-11)

Status: COMPLETE (operator phone pass = acceptance, spec §3). Implements ADR 0036: the downscaled file IS the original; max 2000px long edge, JPEG 0.8; downscale is an optimization NEVER a gate — every failure path (HEIC on non-Safari, decode/encode errors, toBlob null) uploads the original unchanged; small files pass through with EXIF intact (orientation correct either way: re-encode bakes orientation via createImageBitmap imageOrientation:'from-image', passthrough keeps EXIF).

Built: src/lib/photos/downscale.ts (computeDownscaleTarget PURE + preparePhotoForUpload browser seam) + photoExtToMime in path.ts — RED confirmed pre-impl, 11 unit tests. Integrated in ALL THREE uploaders at the ext-derivation point (ext flips to jpeg on re-encode BEFORE path building): phase-uploader (PendingUpload now stores prepared blob + lastModifiedMs scalar — no raw File in state; retries reuse prepared bytes), attachment stager, delivery uploader. No DB/storage diff.

### Adversarial verification (2-lens) — fixes landed pre-commit

- Transparent PNG/WebP over the cap re-encoded onto a BLACK background (canvas default substrate under toBlob jpeg) → white fill before drawImage.
- REAL race (stager deferred mode): awaiting prepare BEFORE staging the chip meant a create-form submit during a slow phone decode flushed without the in-flight photo — orphaned 'staged' chip, and a SECOND submission would have attached it to the WRONG purchase request. Fix: chips stage synchronously as 'preparing' (new status + กำลังเตรียมรูป… display), prepare jobs tracked in a ref, flush() awaits outstanding prepares THEN reads a fresh items ref (the closure's items is stale after an await — itemsRef pattern).
- createImageBitmap orientation made explicit (imageOrientation:'from-image' — old Firefox/WebViews don't default to it); ext! assertions narrowed; stager header comment de-drifted; rounding test now exercises a genuinely fractional edge (3000×1000 → 667).

Suite: 336 unit / 27 e2e green; pgTAP untouched (627). OPERATOR (acceptance): fresh camera photo on a test-safe WP → renders correctly oriented; Storage object ~hundreds of KB not MB (dashboard read-only check). Open seams: Web Worker offload (with the offline-queue spec), HEIC polyfill, quality/size UI, retroactive processing (never — append-only).

## Spec 35 - offline-tolerant upload queue, WP phase photos (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance: airplane mode -> photo -> banner -> close browser -> signal -> reopen -> photo lands). ADR 0039. A selected phase photo is never lost: persisted to IndexedDB at selection (survives crash/close/navigation, iOS + Android — NO Background Sync dependency), uploads live exactly as before on good signal, global UploadQueueRunner (root layout; banner รอส่งรูป N รูป only when items wait) drains leftovers on mount/online/visibility/event/backoff (5s·2^n cap 5min).

Architecture: replay is IDEMPOTENT end-to-end so live-path/runner/multi-tab overlap is harmless BY DESIGN — bytes 409 ⇒ alreadyExists ⇒ advance; addPhoto gains a 23505 replay path. Pure core (processQueue/QueueStore/classify/backoff) test-first vs in-memory store — 15 unit tests; IDB store + runner are browser seams (house posture). Items NEVER auto-dropped (evidence); attempts only widen backoff.

### Adversarial verification (2-lens, verdict FAIL -> all fixed pre-commit)

- MAJOR (security): the 23505 verify originally checked id-exists only — photo ids are readable role-wide, so a forged replay with a foreign photo id (e.g. a before-photo id + phase='after') would return ok AND flip the WP to pending_approval with zero after photos. Verify now requires the FULL replayed identity (id + work_package_id + phase + canonical storage_path).
- MAJOR (shared device): queue items now carry userId; the runner SKIPS foreign/ownerless items (uploaded_by is append-only — misattribution is uncorrectable). Post-logout blob persistence recorded in ADR 0039 as an accepted tradeoff; discard UI = seam.
- MAJOR (live-path resilience): addPhoto invocation throw (the exact flaky-signal case) stuck the tile and ABORTED the multi-file loop (remaining files never queued — silent loss) -> try/catch in insertOne + per-iteration isolation in handleFiles. Queue I/O (quota/private-mode IDB) wrapped non-fatal — the safety net can't break the live pipeline.
- MAJOR (idempotency gap): live uploadOne wasn't 409-tolerant — a runner/live overlap left a permanently-failing retry tile; now classifies alreadyExists and proceeds.
- Minors: banner staleness (notify after live remove; lock-unavailable branch refreshes count + short retry), pass-failure now reschedules (30s) instead of freezing, dead nowMs dep removed, projectId dropped from the persisted item (fileName kept for the discard seam, recorded), header lifecycle comment updated.

Suites: 349 unit / 27 e2e green; pgTAP untouched (627); no DB schema diff (addPhoto change is app-layer only). Open seams: reference/delivery photo queueing, manual discard UI, SW Background Sync, Web Worker downscale. OPERATOR: phone acceptance pass for specs 34+35 together (one outdoor session covers both).

## Spec 36 - iteration-9 debt batch (2026-06-12)

Status: COMPLETE. Six carried items closed, one resolved-as-stale, zero schema diff. (1) browser.ts <Database> generic — ALL three Supabase clients now typed; surfaced nothing. (2) Server-side length caps in validateCreatePurchaseRequest (item_description 500 / unit 40, test-first; the iteration-8 security minor) — DB CHECKs still queued pending a prod data-length check. (3) comparePendingRequests extracted to src/lib/purchasing/pending-order.ts + 3 pinning tests (/requests sort path now byte-equivalent but tested). (4) Tap targets: retry button min-h-11; remove button rebuilt as 44px transparent hit square around the 28px disc INSIDE tile bounds — reviewer caught that the first attempt (after:-inset-2) was clipped by the tile's overflow-hidden; lesson: hit-area pseudo-element tricks die under overflow-hidden ancestors. (5) Spinner className variant; white track on the red button (~1.8:1 -> fixed). (6) ZoomablePhoto focus-visible:ring-inset (ring was fully clipped). Stale: reports breadcrumb links already min-h-11 since nav-coherence. Suites: 354 unit / 27 e2e green. Still queued: DB CHECK caps, dark toggle (operator), real logo (asset), dialog a11y foundation, pagination.

## Spec 37 - offline queue for all photo kinds + manual discard (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance, spec §2). Closes both ADR 0039 seams: the loss-proof queue now covers reference attachments and delivery-confirmation photos (not just WP phase photos), and the รอส่งรูป banner expands into a per-item list with confirm-guarded ลบ — the ONLY way an item leaves the queue without landing.

Architecture: QueuedPhoto generalized to discriminated QueuedUpload (phase_photo | reference_attachment | delivery_photo); bucket + metadata action follow the kind; the pure core stays kind-agnostic (runner's insertMeta dispatches). Legacy spec-35 items normalize to phase_photo on read (IDB schemaless — no version bump). Both attachment actions gained the identity-complete 23505 replay (id + parent + kind + purpose + canonical path). Stager queues at runItem time (flush covers deferred mode once the parent exists); userId threaded through PurchaseRequestForm at both hosts. Test-first: 5 new core tests (mixed-kind dispatch, normalization, bucket map, discard race).

### Adversarial verification (2-lens, FAIL -> all fixed pre-commit)

- MAJOR: addPurchaseRequestAttachment's status gate ran before the 23505 verify, so a replay whose insert LANDED but whose response was lost could never confirm after the PM decided — the queue item retried forever for a photo that was already live. Fixed: decided-parent path runs the identity-complete existence check first (read-only); never-landed items on decided parents are refusable BY DESIGN — the reference window closes at decision time (recorded in spec + ADR; discard is the designed out).
- Discard raced an in-flight pass: processQueue's put-backs could resurrect (or send) a just-discarded item. Fixed: QueueStore.has() re-checks before every put-back (pinned by unit test); confirm copy now promises only un-sent deletion.
- Shared-device hole in the NEW surface: the discard list let any device holder (incl. logged-out on /login) see and delete other users' un-sent evidence — contradicting the ADR 0039 skip-foreign stance. Fixed: foreign items render read-only without fileName (รูปของผู้ใช้อื่น — รอเจ้าของเข้าสู่ระบบ).
- Deferred-mode queueing was dead code (userId never threaded to the create form) — silent loss on flush-with-bad-signal survived. Fixed: userId through PurchaseRequestForm at /requests + WP page.
- Delivery failure copy said "ลองใหม่" which would make users re-pick under a NEW uuid → duplicate rows when both landed. Copy now says queued-will-auto-send. a11y: role=status moved off the details element onto the count span (live region must not swallow disclosure semantics/buttons); summary marker restored.

Suites: 359 unit / 27 e2e green; pgTAP untouched (627); no schema diff. OPERATOR: the specs 34+35 phone pass extends to 37 (airplane-mode delivery photo -> banner -> reopen -> lands + auto-completes delivery per ADR 0030). Open seams: SW Background Sync, Web-Worker downscale, link-attachment queueing (deliberately out).

## Spec 38 - re-skin: Refined Utility + brand band (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance). Operator brief: "app looks very generated, buttons/blocks look like an old app"; direction picked under delegated authority from /design-preview options = ก (refined utility) + ข's brand band. Diagnosis doc: docs/design-directions-2026-06.md; spec: 38-reskin-refined-utility.md (the locked class map IS the spec).

Shipped: AppHeader becomes the one dark surface — slate-900 brand band with PRC Ops wordmark (amber accent) + kicker + white heading; LogoutButton gains dark variant (light default untouched on profile/coming-soon). Page sweep (3 parallel agents, disjoint sets, 25 files): zinc-50 page wash under white rounded-xl shadow-sm cards, rounded-lg controls with shadow-xs, border-zinc-300→200 on cards/panels, primary buttons gain shadow + active:translate-y-px. Untouched by design: status pills (sun identity), BottomTabBar, login, scrims, manifest/theme. /design-preview + proxy entry deleted (was temporary). Agents' skip-notes reviewed — all judicious (blue/red-semantic buttons, radio labels, chip rows left alone).

Adversarial lens (computed oklch→WCAG ratios): band pairings all pass big (white/slate-900 17.8:1, amber-400 wordmark 10.4:1, dark logout 14.7:1); ONE regression caught and fixed pre-commit — sweep rule 7 dropped form-field borders to zinc-300 (1.48:1 boundary, 1.4.11 + sun lineage) → 15 field borders restored to zinc-400 via field-only markers (min-w-0/appearance-none); secondary buttons keep zinc-300 (label-identified). Locked-behavior check: zero href/copy/aria/structure changes; pins survived untouched (status-colors/tab-bar/manifest). INFO noted for a future spec: white PWA themeColor now seams against the slate band in installed view.

Suites: 359 unit / 27 e2e green; no DB diff. Lesson: tag-scoped regex dies on JSX arrow-function attributes (onChange={(e) => …} contains '>') — use class-combination markers for element-scoped sweeps. OPERATOR: look at the live deploy (any page) — this is the acceptance pass; say "darker/lighter/rounder/flatter" and adjustment rounds are cheap.

## Spec 39 - on-demand report generation + stale-report reaper (2026-06-12)

Status: COMPLETE (operator acceptance: click สร้างรายงาน -> พร้อมดาวน์โหลด in seconds; Railway logs keep saying "No jobs"). ADR 0040 — revision-doc §3.3 executed in the ADR-0034 atrophy shape: fast path ships alongside the worker; Railway retires by finding nothing.

DB (9a85bfb + amendment): reap_stale_reports() + pg_cron report-reaper \*/5 — closes the documented v1 wedge (stuck 'processing' blocked a project's reports forever). Review amendment (20260617000200): reaper ALSO flips stale 'requested' (>15 min = nothing is processing the queue) — without this, pausing the Railway cron would re-open the wedge for rows the fast path failed to claim; WITH it, pausing Railway is safe any time. pgTAP file 27 (13 asserts: security pins, both stale kinds reaped with distinguishing messages, fresh/terminal untouched, cron pin).

App: worker pipeline PORTED (worker/ byte-untouched — Railway Watch Path + it stays the fallback): build-pdf.ts (same locked layout; Sarabun as a base64 server-only module — fs reads don't survive serverless bundling), run-report-job.ts (claim-assumed runner; every error marks failed + full stack to server log, worker parity). generateReport fast path: insert (unchanged) -> admin claim_next_report (same atomic RPC = app+worker can never double-build) -> runReportJob; every failure mode degrades to the sweeper/reaper. pdfkit pinned ^0.17.2 (review: 0.19 layout drift vs the fallback would make fast-path/worker PDFs differ) + serverExternalPackages. maxDuration=60 on the reports page; button catch degrades a platform timeout to a soft message (reaper recovers server-side). Production build green.

Recorded deviations + decisions: after-photos filter REUSES src/lib/photos/current-photos.ts instead of porting the worker's duplicate (equivalent semantics — worker only adds the phase filter, applied at the call site here; covered by current-photos.test.ts); spec checklist amended accordingly. Known accepted shape: claim_next_report is global FIFO, so a PM's click may build an older queued report from another project first — correct (FIFO) and invisible at pilot volume; their own row is claimed by the next click/sweep. Page copy updated (ไม่กี่วินาที). PDF smoke test runs under @vitest-environment node (fontkit Buffer checks fail across the jsdom realm) and pins the embedded Sarabun by name (PDFKit subsets glyphs, so size is no pin). Suites: 362 unit / 27 e2e / pgTAP 640 expected post-push. OPERATOR: try a report; MAY pause the Railway cron whenever — it is now safe; deleting the service + worker/ dir = future cleanup spec.

## Spec 40 - re-skin round 2, operator feedback (2026-06-12)

Status: COMPLETE (acceptance = operator eye on deploy). Feedback: width unused on most pages, blue buttons unprofessional, deliverable/WP hierarchy unreadable. Fixes: (1) desktop width pass — lg:max-w-5xl across hub/list pages (header/nav/content move together), WP detail to xl:max-w-7xl, card lists go lg:grid-cols-2 (width buys DENSITY not stretched cards); AppHeader/HubNav prop unions widened. (2) Primary fills bg-blue-700 → bg-slate-900 brand dark (hover slate-800), blue outlines → slate, /requests chips + hide-completed toggle follow; links/rings/tab-accent/login/pills deliberately stay. Contrast UP (17:1 vs 6.8:1). (3) work-package-list: deliverable group = one elevated card, header = amber-bar + slate-50 band + bold slate-900 name, WP rows divided+contained inside (ring-inset focus, 56px targets); flat mode keeps cards. Reviewer pass clean. 362 unit / 27 e2e. Note for next rounds: operator look-feedback loop is the acceptance mechanism — keep rounds small and shippable.

## Spec 41 - page width unification (2026-06-12) + SESSION CLOSE

Status: COMPLETE. One canonical PAGE_MAX_W (src/lib/ui/page-width.ts, the WP-detail scale) across every content page's header/nav/content; AppHeader/HubNav prop = typeof PAGE_MAX_W — drift is now a TYPE ERROR. Exceptions recorded: login/profile/coming-soon stay max-w-md (single-card forms). Named UPDATEs: hub-nav + app-shell-primitives test pins. 362 unit / 27 e2e.

### Session 2026-06-11 -> 06-12 summary (architecture-revision sprint)

Shipped: revision doc + ADRs 0034-0040 + specs 32-41 (LINE notification infra, in-app purchasing + suppliers, photo downscale, offline queue x2, debt batch, re-skin x3 + width canon, on-demand reports + reaper). Suites end-state: 362 unit / 640 pgTAP / 27 e2e, all green; prod build green. Revision scoreboard: AppSheet atrophy LIVE, notifications BUILT, Railway OPTIONAL (pause-safe), brand identity established. OPERATOR QUEUE at close: re-skin eyeball rounds (feedback loop = design acceptance), LINE activation (checklist §8, ~15 min), 3 AppSheet column TODOs (saves break until done), ONE outdoor phone pass (specs 34+35+37), try an instant report, optional Railway cron pause. NEXT-SESSION CANDIDATES: more look-feedback rounds, procurement-role onboarding (needs a real user), Railway/worker deletion cleanup (after fast-path history), partial deliveries/line items (on demand), queued smalls (DB CHECK caps, dark toggle, real logo asset, dialog a11y, pagination, PWA themeColor seam).

## Spec 42 - PWA standalone LINE re-login, iOS (2026-06-12)

Status: COMPLETE (operator iPhone pass = acceptance). Operator report: installed PWA loses login after logout; LINE re-login bounces through the LINE app to the system browser, session lands in the wrong cookie jar (iOS standalone jar is separate; CSRF state cookie also splits, so the browser-side callback dies oauth_failed). Fix per spec 42: disable_auto_login=true on the authorize URL for iOS standalone launches (verified against LINE Login v2.1 docs — keeps the whole flow in the PWA's in-app overlay via LINE web login), CSS-toggled standalone login anchor (?standalone=1, display-mode arbitrary variants, no 'use client' — ADR 0012 plain-anchor shape preserved), header logout CSS-hidden in standalone (profile-page logout stays, reachable via bottom tab). Android untested — flag is iOS-UA-gated to avoid regressing the shared-jar WebAPK flow.

Test-first: 3 new route tests (tests/unit/line-start-route.test.ts — env.server mocked at module level since serverEnv validates at import), 2 LoginButton tests, 1 AppHeader logout-wrapper pin. Playwright note: role-based locators ignore the display-hidden second anchor (a11y tree), so the existing e2e href pin survives untouched — 8/8 auth e2e green on chromium. Suites: 368 unit / lint / typecheck green; no DB diff.

Recorded limitation + seam: LINE accounts with no registered email/password cannot complete the web login form (mitigation: browser login -> reinstall PWA; site data copies into the container at install). Real fix if it bites = one-time handoff code minting the session in the PWA via the existing generateLink/verifyOtp machinery (spec 42 out-of-scope section). Supabase inactivity timeout must stay "never" (operator check, no code). OPERATOR: iPhone acceptance pass — install PWA, logout, log back in via LINE web login without leaving the app.

## Spec 43 - device-code handoff login for the installed PWA (2026-06-12)

Status: BUILT - awaiting migration push + operator iPhone pass. Operator hit spec 42's recorded limitation within minutes (LINE web login = QR or email/password; both unusable). ADR 0041: device-code handoff. PWA login tap -> POST /auth/handoff/start issues {state, device_code} row (login_handoffs, 10-min TTL, outbox zero-access posture) -> LINE auth with auto-login RESTORED (one-tap in LINE app) -> callback validates state against the DB row instead of the cookie (resolveCallbackFlow precedence: valid cookie always wins = browser path byte-equivalent), binds user_email + claims stash, status approved, shows return-to-app notice -> PWA polls /auth/handoff/poll, which atomically claims (approved->consumed) and mints the session onto the poll response via the ADR 0012 generateLink/verifyOtp pair - sb-\* cookies land in the PWA's own jar. Profile write parity (NULL-only + avatar refresh) runs at poll time from the stashed claims. Spec 42 items 1-2 reverted (disable_auto_login + ?standalone=1 anchor dead); logout hiding stands.

New surfaces: migration 20260618000100 + pgTAP file 28 (16 asserts), src/lib/auth/{line-authorize-url,line-token-exchange,handoff-flow}.ts (exchange/verify extracted - both callback paths verify identically), /auth/handoff/{start,poll} routes, StandaloneLoginButton ('use client' justified: fetch + window.open + poll orchestration; useSyncExternalStore for sessionStorage resume - react-hooks/set-state-in-effect rejects the mount-setState pattern, lesson banked), login page handoff=approved notice, proxy PUBLIC_PATHS +2. database.types.ts hand-extended pre-push; reconcile with pnpm db:types post-push. Suites: 395 unit / auth e2e 8/8 / prod build green; pgTAP file 28 pending db:push. Security notes recorded in ADR 0041: device_code never in URLs, single-use via atomic claim, claim-before-mint burn tradeoff, uniform expired answers, device-grant phishing class accepted for internal user base (confirm-tap = hardening seam). Seams: poll rate limiting, Android pass.
