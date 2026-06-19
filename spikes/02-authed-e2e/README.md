# Spike 02: Authenticated Playwright session (cookie injection)

## Question

Today there is **no authenticated e2e**. The only Playwright specs
(`tests/e2e/auth-unauthenticated.spec.ts`, `profile-unauthenticated.spec.ts`)
prove redirects for logged-**out** users. Every auth-gated page is "verified by
operator eyeball." This spike proves the mechanism for an **authenticated**
Playwright session so the real harness can be built:

> Can we obtain a session for one super_admin test user via the service-role
> admin client, hand it to Playwright as the `@supabase/ssr` 0.10.2 session
> (cookie injection, no production surface), and land on an auth-gated page
> rendering **authenticated** content (not redirected to `/login`)?

The login UI itself **cannot** be scripted: ADR 0012 runs a custom LINE OAuth
flow (LINE signs HS256 id_tokens, the app verifies them and mints a Supabase
session itself). So there is no username/password form for Playwright to drive.
Injecting a session is the only viable path.

## Result

**Mechanism PROVEN. End-to-end GREEN is BLOCKED on this machine — no real
Supabase credentials present.** Detail:

| Piece                                                                  | Status                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Exact `@supabase/ssr` 0.10.2 cookie shape (name / encoding / chunking) | ✅ proven from installed source + a cred-free encode demo          |
| Cookie-injection harness (seed → mint → storageState → test)           | ✅ built, strict-typecheck + lint clean                            |
| `pnpm lint && pnpm typecheck && pnpm test` unaffected by the spike     | ✅ green                                                           |
| The ONE authed Playwright test going green on `/projects`              | ⛔ **blocked**: `.env.local` holds placeholders, no project to hit |

This machine's `.env.local` was filled with `placeholder-*` values on
2026-06-11 (header says so) because no real secrets were available on the cloud
PC. The harness's credential guard detects exactly this and stops loud:

```
[spike-02] NEXT_PUBLIC_SUPABASE_URL looks like a placeholder ("https://placeholde…").
This spike mints a real session against a real project — point .env.local at prod
or a preview-branch DB (see README "Open decisions" — which DB e2e runs against).
```

The blocker is **credentials, not the mechanism**: see "Confidence" at the end.

## (1) The exact `@supabase/ssr` 0.10.2 cookie / session shape

Read from the pinned package on disk (not from memory). Citations are
`node_modules/.pnpm/...`-hoisted; paths below are the logical module paths.

### Cookie name

```
sb-<projectRef>-auth-token
```

`projectRef` = the first DNS label of the Supabase URL host.
`@supabase/supabase-js` `SupabaseClient.ts:295`:

```js
const defaultStorageKey = `sb-${baseUrl.hostname.split('.')[0]}-auth-token`;
```

So `https://btbfzhnvzruvxlgbeqnl.supabase.co` → cookie name
`sb-btbfzhnvzruvxlgbeqnl-auth-token`. None of `src/lib/db/{browser,server}.ts`
nor `proxy.ts` override `cookieOptions.name`, so this default is what the app
reads and writes.

### Value encoding

`@supabase/ssr` `createServerClient.js:14` defaults `cookieEncoding: "base64url"`.
With that default, `cookies.js` writes:

```js
// cookies.js:7
const BASE64_PREFIX = "base64-";
// cookies.js:156-158 (setItem) and :310-313 (applyServerStorage)
encoded = BASE64_PREFIX + stringToBase64URL(value);
```

where `value` is `JSON.stringify(session)` — the supabase-js session object
(`{ access_token, token_type, expires_in, expires_at, refresh_token, user }`).
So the cookie value is:

```
base64-<base64url(JSON.stringify(session))>
```

### Chunking

`@supabase/ssr` `utils/chunker.js`:

```js
exports.MAX_CHUNK_SIZE = 3180;
```

`createChunks` measures `encodeURIComponent(value).length`. If it is ≤ 3180, a
**single** cookie named `sb-<ref>-auth-token` is written. If larger, it is split
into `sb-<ref>-auth-token.0`, `sb-<ref>-auth-token.1`, … (combined back on read
via `combineChunks`). Any harness MUST handle the multi-cookie case.

### Cookie attributes

`@supabase/ssr` `utils/constants.js` `DEFAULT_COOKIE_OPTIONS`:

| attribute  | value                               |
| ---------- | ----------------------------------- |
| `path`     | `/`                                 |
| `sameSite` | `lax`                               |
| `httpOnly` | **`false`**                         |
| `maxAge`   | `400 * 24 * 60 * 60` (400 days)     |
| `domain`   | _unset_ (host-only; localhost here) |

`httpOnly: false` matters: Playwright can read/inject these cookies directly.

### Empirical confirmation (cred-free)

`node spikes/02-authed-e2e/cookie-shape-demo.mjs` runs a representative session
through the library's **own** encode functions. Observed:

```
=== small session ===          (raw JSON 861 B → encoded 1155)
cookie name        : sb-abcdefghijklmnop-auth-token
value prefix       : base64-eyJhY2Nlc3NfdG9rZ…
chunk count        : 1
chunk cookie names : sb-abcdefghijklmnop-auth-token

=== large session ===          (raw JSON 4072 B → encoded 5437)
cookie name        : sb-abcdefghijklmnop-auth-token
chunk count        : 2
chunk cookie names : sb-abcdefghijklmnop-auth-token.0, sb-abcdefghijklmnop-auth-token.1
```

A real ECC-P256 session (ADR 0021) typically lands in **one** cookie; heavy
`user_metadata` or a legacy HS256 token pushes it to `.0`/`.1`.

## (2) Mechanism used, and why

**Cookie injection via a library-written session — no app route, no prod
surface.** Concretely (`seed-session.ts`):

1. **Ensure** one marked test user (`e2e+super@prc-ops.test`) exists and is
   `super_admin`, using the service-role admin client (bypasses RLS,
   idempotent). super_admin is chosen because per ADR 0056 / spec 143 it sees
   every project with **no** `project_members` seeding — the green test needs
   zero fixtures.
2. **`admin.auth.admin.generateLink({ type: "magiclink" })`** → a one-time
   `hashed_token`. This is exactly the prod LINE-callback path (ADR 0012 step 5),
   minus LINE.
3. **An in-memory `createServerClient` calls `verifyOtp(hashed_token)`.** That
   makes the **library** write the real `sb-<ref>-auth-token` cookie(s) into a
   cookie jar we control — we never hand-encode the cookie, so the encoding is
   correct by construction and survives library upgrades.
4. **Hand those cookies to Playwright** as a `storageState`, retargeted at the
   app origin (`localhost`). `global-setup.ts` writes `.auth/super.json`;
   `playwright.config.ts` loads it via `use.storageState`.

### Why this works against the running app (the load-bearing detail)

`proxy.ts` (middleware) calls **`supabase.auth.getUser()`** on every request —
an authoritative GoTrue round-trip. So a forged or hand-faked token would be
rejected there. The injected cookie passes **because it is a genuine session**
issued by the project's own GoTrue (via `generateLink`+`verifyOtp`). The
render path then uses `getClaims()` (ADR 0021, local JWKS verify), which also
accepts the genuine token. Cookie injection is therefore sufficient **without
any code change** — the only requirement is real credentials and the
service-role admin client (already trusted server-side in prod per ADR 0012).

### Why NOT a flag-gated test-login route (recommended fallback only)

A `/test-login` route that mints a session behind an env flag is the usual
alternative. It is **not** recommended as primary because:

- It adds a code path under `src/` (out of scope for this spike) that mints
  sessions — a production attack surface that must be provably dead in prod.
- Cookie injection needs **zero** app changes and reuses the exact prod
  session-mint primitives.

Keep the flag-gated route as a fallback for two specific futures: (a) running
authed e2e in an environment with **no** service-role key (e.g. CI) but with a
deployed preview, or (b) needing to exercise the **LINE callback** itself rather
than skip it. Recommend it then; do not build it now.

## (3) Open decisions for the real harness

1. **Which Supabase DB does authed e2e run against?** (single-prod-project
   posture). Options:
   - **Prod auth** — simplest, but every run writes a test user into prod
     `auth.users` and any test writes hit prod tables (RLS-scoped, but real).
     Needs disciplined teardown. The prod project is on Supabase **FREE** tier
     (no PITR/branching) — so a "preview-branch DB" is not free here.
   - **Dedicated throwaway/preview project** — isolated `auth.users`, safe to
     wipe, but a second project to provision + keep schema-synced.
     **Recommendation:** a dedicated non-prod project (or a gated test schema);
     do **not** mint test users into prod on every run. This is the first ADR
     question.
2. **Test-user / role matrix + spec-143 seeding.**
   - `super_admin` — no `project_members` rows needed (sees all). ✅ this spike.
   - `project_manager` / `site_admin` — membership-scoped (ADR 0056): need
     `project_members` rows seeded against known project ids or they see nothing.
   - `project_coordinator` / `procurement` / `super_admin` — broader scopes.
   - Decide the fixture set (projects + memberships) each role's tests assume,
     and where it lives (seed SQL vs admin-client setup).
3. **Teardown / isolation of test users.** `createUser` is idempotent but
   accumulates rows. Decide: delete-by-pattern (`e2e+*@prc-ops.test`) after the
   run, an ephemeral DB per run, or a stable reused fixture user. Tie to
   decision 1.
4. **Keep the service-role key OUT of CI.** CI runs `lint` + `typecheck` +
   `test` only (per CLAUDE.md) and must stay that way. Authed e2e is a
   **local/operator** activity. If authed e2e is ever automated, run it against
   the non-prod project with the service-role key as a masked secret in a
   **separate** workflow, never the PR CI job. This spike reads the key only
   from local `.env.local`; nothing service-role is committed.

## (4) Draft ADR outline

> **ADR 00NN — Authenticated e2e session strategy**
>
> **Status:** Proposed
>
> **Context:** No authed e2e exists; auth-gated pages are eyeball-verified. The
> LINE OAuth UI cannot be scripted (ADR 0012). Sessions are standard
> `@supabase/ssr` 0.10.2 cookies (`sb-<ref>-auth-token`, `base64-` + base64url
> JSON, chunked > 3180 B). Single-prod-project, Supabase FREE tier.
>
> **Decision:** Authed e2e obtains sessions by **minting via the service-role
> admin client** (`generateLink` magiclink → `verifyOtp` on an in-memory ssr
> client) and **injecting the library-written cookies** as a Playwright
> `storageState`. No app route is added. Authed e2e runs **locally / operator,
> against `<non-prod project — decision 1>`**, excluded from PR CI; the
> service-role key lives only in local env.
>
> **Alternatives considered:**
> - _Flag-gated `/test-login` route_ — adds a prod session-mint surface; kept as
>   fallback for keyless/CI or LINE-callback coverage.
> - _Drive the real LINE UI_ — impossible (ADR 0012, HS256 + custom flow).
> - _Trust `getSession()` / stub auth_ — weakens the authn guarantee (ADR 0021
>   §"Why not getSession"); rejected.
> - _`signInWithPassword` + hand-encoded cookie_ — reproduces the library's
>   encoding/chunking by hand; fragile across upgrades; rejected.
>
> **Consequences:** Reuses prod session-mint primitives; zero app change; needs
> a test-user/role + `project_members` fixture matrix (decision 2) and teardown
> (decision 3). Revocation/refresh behave as for any real session.

## How to run

```sh
# one time
pnpm install
pnpm exec playwright install chromium

# put REAL Supabase creds in .env.local (NOT the placeholders this machine ships):
#   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon jwt>
#   SUPABASE_SERVICE_ROLE_KEY=<service-role jwt>   # local only, never committed/CI

# cred-free shape proof (works anywhere):
node spikes/02-authed-e2e/cookie-shape-demo.mjs

# the authed test (needs real creds; auto-starts `pnpm dev`):
npx playwright test --config spikes/02-authed-e2e/playwright.config.ts
```

**GREEN looks like:** `global-setup` logs
`[spike-02] storageState for e2e+super@prc-ops.test -> …/.auth/super.json (N cookie(s): sb-…-auth-token)`,
then the single test `GET /projects renders authenticated (not redirected to
/login)` passes — `/projects` rendered, no `/login` redirect, no LINE login
link present.

## Files

- `seed-session.ts` — cred guard, idempotent test-user + super_admin seeding,
  and `mintStorageState()` (the cookie-injection core). Local-only; never
  imported by the app.
- `global-setup.ts` — Playwright globalSetup. Parses `.env.local`
  (dependency-free), mints, writes `.auth/super.json`.
- `authed.e2e.ts` — the ONE authed test. Named `*.e2e.ts` so the vitest spike
  glob never runs it under vitest.
- `playwright.config.ts` — dedicated config (own `testDir`, `globalSetup`,
  `storageState`); keeps the spike out of the default `pnpm test:e2e` suite.
- `cookie-shape-demo.mjs` — cred-free encode demo. `.mjs` so `tsc` skips it.
- `.auth/` — gitignored. Holds the minted session (a real token) — never commit.

> Spike tests are NOT part of `pnpm test` / `pnpm test:e2e` / CI. Validated once,
> then frozen — same posture as spike 01.

## Confidence

**~90%** that this goes green on the first run once real creds are in
`.env.local`. Reasoning: the cookie shape is read from the pinned source and
confirmed by the encode demo; the session-mint path (`generateLink`+`verifyOtp`)
is the *same* path ADR 0012 already runs in prod; and the middleware's
`getUser()` accepts the session precisely because it is genuine. Residual 10%:
the exact authed-content assertion on `/projects` (kept deliberately loose —
"not `/login`" + "no LINE login link") and whatever DB the operator points at
having a reachable schema for the super_admin render.
