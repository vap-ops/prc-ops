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
4. **Human-readable report date.** The PDF
   currently labels "Generated: <ISO 8601>"
   ([`worker/src/report.ts`](../worker/src/report.ts)).
   A locale-formatted date would read better
   for the pilot end-recipients. Tiny PR.
5. **Optional `worker/railway.toml`.**
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
