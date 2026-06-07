# ADR 0021: Cut per-page Auth round-trip — `getClaims()` on the read-render path

## Status

Accepted — 2026-06-08.

Sits alongside ADR 0007 (`public.users` keyed to `auth.users`) and
ADR 0012 (custom LINE auth flow). Does not amend either — it changes
how the session is **verified on the render path**, not who the user
is or how they sign in.

## Context

Every protected page render in v1 calls `supabase.auth.getUser()` to
prove who the caller is before reading `public.users`. `getUser()` makes
a **synchronous HTTPS round-trip to the GoTrue Auth server** (the
project's `/auth/v1/user` endpoint) for every render. On `/sa`, `/pm`,
`/pm/projects`, `/profile`, and `/coming-soon` this fires on every
navigation, and on every Server Action that re-renders. The latency
is the single biggest contributor to perceived sluggishness on a
warm session — a 200–400 ms tax per click before any of our own
queries run.

The project has been migrated to an **asymmetric ECC P-256 signing
key**. Confirmed in the Supabase dashboard 2026-06-08: current signing
key is ECC P-256, the previous HS256 key is retained for legacy
verification only. This is a precondition for the change in this ADR.

`supabase-js` ships `auth.getClaims()` (2.105.2 installed; see
`node_modules/@supabase/auth-js/.../GoTrueClient.d.ts:2393`):

> Extracts the JWT claims present in the access token by first verifying
> the JWT against the server's JSON Web Key Set endpoint
> `/.well-known/jwks.json` which is often cached, resulting in
> significantly faster responses. Prefer this method over `getUser()`
> which always sends a request to the Auth server for each JWT.
>
> If the project is using asymmetric JWT signing keys, the verification
> is done **locally without a network request** using the WebCrypto
> API.

So with the dashboard already on ECC P-256, `getClaims()` verifies
signatures locally against a cached JWKS — no per-render Auth-server
round-trip — and returns the same trustable identity (`claims.sub`)
that the caller would have got from a GoTrue user lookup.

### Why not `getSession()`

`getSession()` is fast (reads the cookie store) but **does not verify
the JWT signature**. Its own type comments state the returned user
object "must not be trusted" from an insecure storage medium (cookies),
and the SDK 2.x release notes explicitly steer authorization decisions
away from it. Using it on the render path would weaken the authn
guarantee in exchange for the same latency win `getClaims()` already
delivers. Rejected.

### Why not leave `getUser()`

It's the right call **for writes** (Server Actions that mutate
`public.users` or anything else where the latest server-side user
state matters) and **for the middleware** (one authoritative
refresh-and-validate per request). Leaving it on every render path is
the latency tax this ADR removes.

## Decision

Swap `supabase.auth.getUser()` → `supabase.auth.getClaims()` **only on
the frequent read-render path**:

| File                           | Was         | Becomes       |
| ------------------------------ | ----------- | ------------- |
| `src/lib/auth/require-role.ts` | `getUser()` | `getClaims()` |
| `src/app/profile/page.tsx`     | `getUser()` | `getClaims()` |
| `src/app/coming-soon/page.tsx` | `getUser()` | `getClaims()` |

The user id is read from `claims.sub` (the verified JWT subject).
`getClaims()` returns one of three discriminated shapes:

```
{ data: { claims, header, signature }, error: null }   success
{ data: null,                          error: AuthError }  verify failed
{ data: null,                          error: null }       no session
```

Both failure shapes collapse to `redirect("/login")` via a `if (!data)`
check — the gate **fails closed** on every non-success branch (no
session, expired token, tampered signature, missing kid, JWKS fetch
error).

### What stays on `getUser()` (explicit)

- **`proxy.ts` (middleware).** Runs once per HTTP request, refreshes
  the session cookies, performs the authoritative GoTrue check. The
  per-render path runs many times per request and is the latency
  problem. Middleware stays on `getUser()`. The SSR cookbook
  ([Supabase SSR/Next.js guide](https://supabase.com/docs/guides/auth/server-side/nextjs))
  recommends keeping `getUser()` here.
- **Server Actions that write** (`updateDisplayName` in
  `src/app/coming-soon/actions.ts`). Infrequent. Authoritative
  GoTrue check before a mutation is a defensive cost worth paying.
  Optional follow-up if call volume becomes interesting.
- **Auth callback** (`src/app/auth/line/callback/route.ts`).
  Authentication itself — not a read-render path. Untouched.

## Failure-mode analysis (why this is safe)

The only thing `getClaims()` weakens versus `getUser()` is the
**server-side revocation horizon**: if a token is revoked mid-life,
`getClaims()` keeps treating it as valid until its `exp`. `getUser()`
would catch this because GoTrue refuses to return a user for a revoked
token.

The trade-off is acceptable here because:

1. **Token TTL is 1 hour** (Supabase Auth default). Revocation
   horizon ≤ 1h.
2. **Token refresh runs in the middleware**, which uses `getUser()`.
   A refresh after revocation would fail and propagate immediately.
3. **DB-layer authority is unchanged.** RLS policies and the
   SECURITY DEFINER RPCs (ADR 0011, ADR 0017) gate every read and
   write at the database. A stale-but-still-`exp`-valid token cannot
   reach a row it shouldn't — RLS is the authoritative authz layer,
   not the application's user check.
4. **No data mutation depends on this gate alone.** Writes go through
   Server Actions (still on `getUser()`) or the auth callback. Reads
   are gated by RLS.

Combined: the worst case is a revoked-mid-session user can see the
same pages they could see immediately before revocation, for up to
1 hour, with the same RLS-enforced row access — no privilege
escalation, no write capability they didn't already have.

### Tampered / forged tokens fail closed

`getClaims()` returns `{ data: null, error: AuthError }` on signature
mismatch, expired token, wrong issuer, missing kid, or JWKS fetch
failure. The single `if (!data) redirect("/login")` check covers all
of them. No path exists where a forged or expired token returns
`data: { claims }`.

### JWKS cache freshness

The asymmetric public key is fetched from
`/.well-known/jwks.json` and cached. The cache is invalidated on
signing-key rotation (Supabase publishes the new key under a new
`kid`). The first request after rotation may pay a one-time JWKS
fetch; steady state is local-only.

## Verification

- `pnpm lint` / `typecheck` / `test` — green (`require-role.test.ts`
  added, asserts `getClaims` is called and `getUser` is not, all
  failure shapes route to `/login`).
- **Live after deploy** (operator):
  1. Valid session → pages render normally.
  2. No session → still redirected to `/login` on protected routes.
  3. Tampered / expired token → rejected → `/login` (signature
     verification fails locally).
  4. Click latency before vs after on a warm session — expect sub-
     second on the same network.

## Consequences

**Positive**

- Eliminates a 200–400 ms HTTPS round-trip on every protected page
  render and on every `requireRole()` call. The most-trafficked
  routes (`/sa`, `/pm`, `/pm/projects`) compound that win across
  navigations.
- Identity check is cryptographic, not network-trusted. The page
  trusts only a signature it verified locally against a cached
  public key.
- One clear seam between "fast local verify" and "authoritative
  remote check": render-path = `getClaims()`, middleware + writes
  = `getUser()`.

**Negative**

- Server-side revocation horizon ≤ 1h on the render path. Acceptable
  per the failure-mode analysis above.
- The check now depends on the project being on an asymmetric signing
  key. A future rotation back to symmetric HS256 would silently
  re-introduce the round-trip (since `getClaims()` falls back to a
  network call when the key is symmetric) — performance regression,
  not security regression. Flagged for the migration runbook.

**Neutral**

- No schema change. No migration. No RLS change. No dashboard action
  (the signing-key migration was already done, separately, before this
  ADR).
- supabase-js version unchanged. The method is shipping in 2.105.2.

## Open questions

- **Server Actions on `getUser()` — long-term posture.** The
  display-name update action is the only write surface today. If more
  ship, evaluate whether `getClaims()` is appropriate there too (a
  successful write through a revoked-but-not-expired token is still
  blocked by RLS, but the ergonomics of "writes are authoritative"
  may be worth preserving). Out of scope here.
- **HS256 fallback warning.** If the dashboard's current signing key
  is ever flipped back to HS256, `getClaims()` will start sending
  network requests again. A lint or runtime warning that surfaces
  the active `alg` would catch a silent regression. Tracked as a
  follow-up, not in this unit.

## References

- ADR 0007 — Users and Auth (the identity contract this ADR's
  `claims.sub` flows from)
- ADR 0011 — RLS role helper / SECURITY DEFINER checklist (DB-layer
  authority that remains unchanged)
- ADR 0012 — Custom LINE auth flow (where the session JWT originates)
- ADR 0017 — Profile self-edit (writes still go through `getUser()`)
- [`supabase.auth.getClaims()` JS reference](https://supabase.com/docs/reference/javascript/auth-getclaims)
- [Supabase JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Setting up SSR Auth for Next.js (Supabase)](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Supabase blog — Introducing JWT Signing Keys](https://supabase.com/blog/jwt-signing-keys)
