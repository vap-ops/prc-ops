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
- **`.env.example` and the LINE channel secret (resolved at commit time,
  rotation question open).** During this session, `git diff .env.example`
  showed local-only edits placing real-looking LINE values into the
  tracked template (`LINE_CHANNEL_ID=2009971313` and
  `LINE_CHANNEL_SECRET=c3f9c353bd79d591483934770d4db569`). The operator
  reverted the file mid-session, so the tree at commit time matches
  `origin/main` — empty placeholders. **Open question for the operator:**
  if those values were ever committed/pushed/shared anywhere (the file
  was open in the IDE; secret may have been visible in screenshots,
  Claude chat transcripts, or git stashes), rotate the LINE channel
  secret in the LINE Developers console and re-paste into Supabase's
  Custom OIDC Provider. After this PR these env vars are no longer
  referenced by any application code (removed from `env.ts`), so the
  only remaining concern is leak, not runtime.
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
