# ADR 0012: LINE auth via custom app-handled flow (supersedes spec 01 decision #4)

## Status

Accepted — 2026-05-23

Supersedes decision #4 of [`docs/feature-specs/01-line-auth.md`](../feature-specs/01-line-auth.md) ("Integration mechanism: Supabase Custom OIDC Provider"). The mechanism in that decision is unusable for LINE; this ADR adopts the custom flow proven in the line-auth spike (see [`docs/feature-specs/01-line-auth-FINDINGS.md`](../feature-specs/01-line-auth-FINDINGS.md)).

This ADR does **not** amend ADR 0007 — that ADR describes the `auth.users` ↔ `public.users` linkage and trigger, which are unaffected. ADR 0011 (RLS role helper) is the prerequisite that unblocked the role read after session mint; this ADR builds on it.

## Context

Spec 01 decision #4 chose Supabase's Custom OIDC Provider feature (April 2026) as the integration mechanism for LINE Login. That decision is unworkable in practice:

- **LINE signs ID tokens with HS256** (HMAC-SHA256, symmetric, channel-secret-keyed). This is documented LINE behavior and is fixed by their platform.
- **Supabase's OIDC verifier accepts only ES256 / RS256** (asymmetric). It rejects HS256 outright. Confirmed on production via the Supabase auth log:

  ```
  failed to verify ID token: oidc: id token signed with unsupported algorithm,
  expected [ES256] got HS256
  ```

- **`signInWithIdToken` is also unusable.** Its `provider` field accepts a fixed list (`apple | azure | facebook | google | kakao`) plus a `custom:${string}` template — but the `custom:` path still routes through the same Supabase OIDC verifier that rejects HS256. There is no path through the supabase-js native APIs that accepts a LINE ID token.

The line-auth spike (`spike/line-auth-custom-flow`, merged as `c4e03a1` on 2026-05-23; code removed in `f082c8f`) proved end-to-end that an alternative custom flow works on production. The findings — including the proven session-minting calls, the redirect-URI derivation strategy, and the live test result — are preserved in [`docs/feature-specs/01-line-auth-FINDINGS.md`](../feature-specs/01-line-auth-FINDINGS.md).

**Strategy choice.** Two architectural responses to the OIDC dead-end were considered:

- **(A) Replace Supabase Auth entirely** with a self-hosted session store, custom JWT signing, etc. Rejected — every piece of v1 (RLS via `auth.uid()`, the ADR 0007 trigger, ADR 0011's role helper, the audit_log actor model) is built on Supabase Auth. Replacing it is a multi-month rewrite with no benefit to the actual problem (LINE OAuth).
- **(B) Keep Supabase Auth as the foundation; the app does LINE OAuth itself and bridges into a Supabase session.** Adopted. The app handles the OAuth 2.1 handshake against LINE directly, verifies the HS256 ID token, then uses the Supabase admin client to provision-or-locate an `auth.users` row and mint a real Supabase session for it. Every downstream Supabase mechanism continues to work unchanged.

## Decision

Adopt the custom flow proven by the spike. The mechanism, in order:

1. **App-initiated authorize.** A server-side route handler (`/auth/line/start`) builds LINE's authorize URL — `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=<LINE_CHANNEL_ID>&redirect_uri=<origin>/auth/line/callback&state=<random>&scope=openid%20profile` — sets a CSRF `state` cookie (httpOnly, secure, sameSite=lax, path `/auth/line`, max-age 600s), and 302s to LINE. `redirect_uri` is derived from `request.nextUrl.origin`, not from an environment variable, so the flow works identically on production, every Vercel preview, and `localhost`.

2. **Code exchange at LINE.** LINE redirects back to `/auth/line/callback?code=…&state=…`. The handler verifies the `state` cookie matches the `state` parameter, then POSTs to LINE's token endpoint `https://api.line.me/oauth2/v2.1/token` with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, and `client_secret`. The `client_secret` is the LINE channel secret, read from server-only env. The response includes an `id_token` (LINE-signed JWT, HS256).

3. **ID token verification.** Verify the `id_token` server-side:
   - Algorithm header must be `HS256`.
   - HMAC-SHA256 of `header.payload` keyed with `LINE_CHANNEL_SECRET` must equal the signature segment. Compared with `crypto.timingSafeEqual` (constant-time — protects against timing oracles even though this path is server-only).
   - `iss` claim must equal `https://access.line.me`.
   - `aud` claim must equal `LINE_CHANNEL_ID`.
   - `exp` must be > now; `iat` must be ≤ now + a small clock-skew tolerance.
   - `sub` must be a non-empty string (this is LINE's user identifier).
   - `name` (if present) is extracted from the payload directly; no separate `/v2/profile` call.

   Implementation choice: `jose` is the preferred library for production (modern, tree-shakable, Auth.js-blessed). Inline `node:crypto` is acceptable if the dependency boundary is unwanted, but the safety conditions above must still be met explicitly.

4. **Provision or locate the auth user.** Using the admin (service-role) Supabase client, call `auth.admin.createUser({ email: 'line_<sub>@line.local', email_confirm: true, user_metadata: { provider: 'line', line_sub, name } })`. The synthetic-email convention (`line_<sub>@line.local`) is the durable identifier on first login and stays stable across logins. `email_exists` / `user_already_exists` error codes are treated as the "already provisioned" branch — continue silently. The ADR 0007 trigger creates the matching `public.users` row automatically; ADR 0010's default makes that row's role `visitor` until a super_admin promotes it.

5. **Mint the Supabase session.** Supabase has no first-class admin-mints-session API as of supabase-js v2.105 ([Discussion #11854](https://github.com/orgs/supabase/discussions/11854)). The canonical workaround:

   ```ts
   const { data: linkData } = await admin.auth.admin.generateLink({
     type: "magiclink",
     email: `line_${sub}@line.local`,
   });
   const supabase = await createServerSupabase();
   await supabase.auth.verifyOtp({
     type: "magiclink",
     token_hash: linkData.properties.hashed_token,
   });
   ```

   `verifyOtp` called on the SSR server client writes `sb-*` session cookies onto the route handler's response via `cookies()` from `next/headers`. After this call, `supabase.auth.getUser()` on subsequent server-side requests returns the user; `auth.uid()` in RLS resolves correctly; the rest of the Supabase Auth ecosystem (refresh, signOut) works as for any other Supabase login.

6. **Role read + profile write + redirect.** With the session established, the callback reads `public.users.role` via the SSR client. Post-ADR-0011 (RLS role helper), this read no longer recurses. The callback then writes `line_user_id` (= JWT `sub`) and `full_name` (= JWT `name`) to `public.users` via the admin client, NULL-only (never overwrite). Finally it redirects by role: `site_admin` → `/sa`, `project_manager` → `/pm`, all others (including `visitor`) → `/coming-soon`.

### Locked route shape

- **`/auth/line/start`** — initiator. Server-only route handler. Public (must be reachable while unauthenticated).
- **`/auth/line/callback`** — callback. Server-only route handler. Public.
- **Login button** — a plain server-rendered link or form pointing at `/auth/line/start`. **No client-side Supabase call.** The `'custom:line'` provider string and the client-side `signInWithOAuth` in the dead OIDC implementation are not used.
- **Logout** — unchanged from the previous PR 2: POST to `/auth/logout`, server clears session via `supabase.auth.signOut()`, 303-redirect to `/`. GET returns 405.

These paths are LINE-specific by design. If a future provider is added, it gets its own route prefix (`/auth/google/...`, etc.), not a shared `/auth/callback` overload.

### Environment variables

`LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` graduate from spike config to first-class server env. They live in `src/lib/env.server.ts`'s zod schema as required strings (boot fails if either is missing). Both are server-only — the env-split work in PR #16 prevents them from reaching the client bundle, and the OAuth + HS256 verification only runs server-side anyway.

The original spec 01 decision #14 told PR 1 to remove these vars from `env.ts` (because OIDC was going to hold the secrets in Supabase's dashboard, not in the app). PR 1 did remove them. This ADR reverses that: they come back to env, but server-only this time.

### LINE Developers console — operational change

The LINE channel's "Callback URL" allowlist must point at the **app**, not at Supabase. Every origin we want to exercise (production, every long-lived Vercel preview, `localhost` if used) needs its `/auth/line/callback` URL added. LINE accepts multiple callback URLs per channel; LINE does not support wildcards.

The previously-configured Supabase OIDC Provider (the `custom:line` provider in the Supabase dashboard from Phase 0) is unused under this ADR. Leaving it in place is harmless (we never call into it); removing it is the operator's call. **This ADR does not instruct deletion.**

## Why this is safe

The mechanism is more code than a native provider, so each load-bearing security check is itemized:

1. **State (CSRF).** A 16-byte random `state` is set in an httpOnly, secure, sameSite=lax cookie before the redirect to LINE, and verified strictly on callback. Mismatch → terminate the flow with a generic error; do not proceed to token exchange.
2. **HS256 verification.** Algorithm is asserted (no `alg: none` or algorithm confusion); signature is computed with the channel secret and compared `crypto.timingSafeEqual`; `aud`, `iss`, `exp`, and `iat` are all validated. A token forged without the channel secret cannot pass.
3. **`admin` client is server-only.** It is gated by `import "server-only"` ([src/lib/db/admin.ts](../../src/lib/db/admin.ts)) and reads `SUPABASE_SERVICE_ROLE_KEY` from `env.server.ts` (likewise `server-only`). Any client-side import path that reaches it fails the build (env-split work in PR #16).
4. **`generateLink` hashed token never reaches the browser.** It is consumed by `verifyOtp` inside the same callback handler. The only thing the browser ever sees is the resulting `sb-*` session cookies, which are standard Supabase session cookies and which Supabase itself protects.
5. **Synthetic email is opaque.** `line_<sub>@line.local` is never a deliverable address. We do not send mail to it. The `email_confirm: true` on createUser is correct because LINE has already authenticated the user — there is nothing to confirm. It would be wrong (and a real risk) if we ever tried to use the synthetic email for password reset, but we do not.
6. **No claim trust beyond verification.** LINE's `sub` and `name` are the only claims used; both are verified to come from a token signed by LINE before they enter `auth.users.user_metadata`. We do not promote any claim into a privileged column.

## Consequences

**Positive**

- Works with LINE — the goal that the OIDC approach could not meet.
- Supabase Auth remains the foundation. RLS, `auth.uid()`, `auth.users` triggers, the audit log actor model, ADR 0011's helper, and every future feature that depends on Supabase sessions all keep working unchanged.
- Server-side-only OAuth. No client-side Supabase call is needed to start auth; the login UI is a plain anchor or form. Smaller client bundle, simpler CSP story.
- Multi-environment friendly. `redirect_uri` derived from `request.nextUrl.origin` means production, preview, and localhost all work without per-env env vars.
- Adds zero new infrastructure (no new services, no new daemons, no new cron). All the new code is route handlers.

**Negative**

- More app code than a native provider. ~200 lines for `/start`, `/callback`, the verification helper, and the env additions. Each line is a potential bug.
- The app now custom-verifies a JWT and mints sessions. This is the security-sensitive surface that the safety section above lists explicitly. Reviewers must treat changes to `/auth/line/callback` and the HS256 verifier with the same care as RLS policy changes (analogous to the ADR 0011 SECURITY DEFINER review note).
- Synthetic email convention is a mild hack. Anyone reading `auth.users.email` later will see addresses that look like email but aren't. Documented here and in the FINDINGS doc so the convention isn't surprising.
- LINE allowlist drift. Every long-lived deployment URL needs to be added to the LINE Developers console manually. Ephemeral preview URLs (one per PR) cannot all be added; document a single stable "preview" URL in the runbook.

**Neutral**

- Logout flow unchanged (`POST /auth/logout` → `signOut` → 303 to `/`).
- proxy.ts unchanged in shape; only the `PUBLIC_PATHS` set changes (adds `/auth/line/start`, `/auth/line/callback`; removes the obsolete `/auth/callback` when the dead route handler is deleted).
- Role-gating helpers (`requireRole`, the `/coming-soon` page, the `/sa` / `/pm` placeholders planned for PR 3) sit on top of this flow's session unchanged.
- LINE_CHANNEL_ID / LINE_CHANNEL_SECRET continue to exist in `.env.local` and Vercel — they were retained after spike cleanup explicitly for this real-implementation work.

## Documentation handling

- [`docs/feature-specs/01-line-auth.md`](../feature-specs/01-line-auth.md) decision #4 is annotated with a one-line pointer to this ADR. Decision #14 is annotated to note `LINE_CHANNEL_*` come back to env (server-only). Phase 0 is updated to reflect the new LINE callback URL. The PR 2 section is rewritten to describe the custom-flow implementation. PR 3 and PR 4 sections get small updates noting they now sit on top of the custom-flow session and ADR 0011's RLS helper. PR 1 is marked complete.
- [`docs/feature-specs/01-line-auth-FINDINGS.md`](../feature-specs/01-line-auth-FINDINGS.md) already references this ADR by number; no further change needed there.
- ADR 0007 is **not** annotated by this ADR. Its content (user model + trigger) is unaffected. ADR 0011 already annotated 0007 for the RLS-helper amendment.

## Open questions

None blocking. Surfaced for future ADR process:

- **`jose` adoption.** If the implementation uses inline `node:crypto` rather than `jose`, that's a defensible choice for v1 but should be revisited when a second JWT-handling code path enters the project. Tracked here so the next reviewer doesn't have to rediscover it.
- **`auth.users.email` vs. `auth.users.phone` as the LINE identity anchor.** Email won (simpler, matches the existing `email_confirm` API). If a future product surface wants real email (e.g., for password reset of admin accounts), the design needs adjustment — possibly a second auth provider for admins.
- **Custom Access Token Hook for role claims.** If a future hot path benchmarks `current_user_role()` (ADR 0011) as a real cost, the alternative is to inject role into the JWT via Supabase's Custom Access Token Hook. Not anticipated for v1 scale.

## References

- ADR 0007 — Users and Auth (foundational; unmodified by this ADR)
- ADR 0010 — Visitor default role (the role new LINE signups receive after this flow runs)
- ADR 0011 — RLS role-check helper (the prerequisite that unblocks role reads after session mint)
- [`docs/feature-specs/01-line-auth.md`](../feature-specs/01-line-auth.md) — the operative spec; decision #4 superseded by this ADR
- [`docs/feature-specs/01-line-auth-FINDINGS.md`](../feature-specs/01-line-auth-FINDINGS.md) — the spike's findings, including the live test result and the exact session-minting code
- [Supabase Discussion #11854](https://github.com/orgs/supabase/discussions/11854) — the open feature request for a direct admin-mints-session API (the absence of which forced the `generateLink` + `verifyOtp` workaround)
- LINE Login OIDC docs — `https://developers.line.biz/en/docs/line-login/integrate-line-login/`
- LINE ID token verification — `https://developers.line.biz/en/docs/line-login/verify-id-token/`
