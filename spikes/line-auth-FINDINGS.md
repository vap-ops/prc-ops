# Spike — LINE custom-flow auth into a Supabase session

**Branch:** `spike/line-auth-custom-flow`
**Date:** 2026-05-23
**Status:** Implemented; pending operator live-test on Vercel.

## Question the spike answers

Can the app run its own LINE OAuth 2.1 flow, verify LINE's HS256-signed `id_token` server-side, and then mint a real Supabase Auth session for the resolved user — so that downstream code (RLS, `auth.uid()`, the ADR 0007 trigger, audit_log actor, `public.users` joins) continues to work unchanged?

This question came up because LINE signs ID tokens with **HS256** and Supabase's Custom OIDC Provider verifier accepts only **ES256/RS256**. Confirmed via Supabase auth logs: `failed to verify ID token: oidc: id token signed with unsupported algorithm, expected [ES256] got HS256`. `signInWithIdToken` is also dead — it only supports a fixed provider list, and the `custom:*` prefix routes through the same Supabase OIDC verifier that rejects HS256.

## TL;DR finding

**Yes**, with one caveat: there is no direct "admin mints a session for user X" API in supabase-js v2.105 / Supabase Auth v2026. The canonical workaround is **`auth.admin.generateLink({ type: 'magiclink' })` → `auth.verifyOtp({ token_hash, type: 'magiclink' })`**. Verified by reading the supabase-js types at `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` and corroborated by [Supabase Discussion #11854](https://github.com/orgs/supabase/discussions/11854) and [Razikus — admin login as user](https://medium.com/@razikus/supabase-admin-login-as-user-get-his-session-d35eedb50e75). The pattern is stable and used by many production deployments.

The spike implements the full flow end-to-end under `src/app/spikes/line-auth/`. If the operator's live test on Vercel shows a populated `auth_user_id` + matching `public_users_row` on the result page, the mechanism is proven.

## Files in this spike

| Path                                                                                        | Purpose                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/app/spikes/line-auth/start/route.ts](../src/app/spikes/line-auth/start/route.ts)       | GET handler that builds LINE's authorize URL, sets the `state` cookie, 302s to LINE.                                                                |
| [src/app/spikes/line-auth/callback/route.ts](../src/app/spikes/line-auth/callback/route.ts) | GET handler that validates state, exchanges code, verifies the HS256 id_token, provisions/locates the auth user, mints the session, 302s to result. |
| [src/app/spikes/line-auth/result/page.tsx](../src/app/spikes/line-auth/result/page.tsx)     | Server-rendered proof page. Shows `auth.uid()`, email, user metadata, and the matching `public.users` row.                                          |
| [proxy.ts](../proxy.ts)                                                                     | One-line **temporary** spike bypass — see Cleanup section.                                                                                          |

## Mechanism in detail

### Why generateLink + verifyOtp and not something cleaner

Searched and ruled out:

- `signInWithIdToken` — fixed provider list (Apple/Google/Azure/Facebook/Kakao); the `custom:${string}` template still goes through Supabase's OIDC verifier that rejected LINE's HS256.
- `setSession(access_token, refresh_token)` — no admin API produces tokens for an arbitrary user; tokens only come from a signed-in flow.
- Custom Access Token Hook — augments claims on an _existing_ session; doesn't mint one.
- Direct admin-mints-session API — **does not exist** as of 2026-05. Open feature request: [Discussion #11854](https://github.com/orgs/supabase/discussions/11854).

`generateLink({ type: 'magiclink', email })` returns:

```ts
{
  data: {
    properties: {
      action_link: string; // full email link, not used here
      email_otp: string; // raw OTP, not used here
      hashed_token: string; // <-- this is what we want
      redirect_to: string;
      verification_type: "magiclink";
    }
    user: User; // the auth.users row for `email`
  }
}
```

Then `verifyOtp({ type: 'magiclink', token_hash })` called on the SSR server client establishes a real session. The SSR client's `setAll` callback writes the `sb-*` cookies onto the route handler's response via `cookies()` from `next/headers`. A subsequent server-side `supabase.auth.getUser()` sees the user; RLS works; `auth.uid()` is the auth user's id.

### HS256 verification without a JWT library

No `jose` / `jsonwebtoken` in the dep tree (verified by `pnpm ls`). Per the operator's directive, the spike does HS256 verification using **`node:crypto`** only — `createHmac` for the signature, `timingSafeEqual` for the comparison, and `Buffer.from(..., 'base64url')` for the segment decoding (available on Node 16+; the project is on Node 22). Implementation lives inline in `callback/route.ts` (~50 lines). Validates `alg=HS256`, `iss=https://access.line.me`, `aud=LINE_CHANNEL_ID`, `exp > now`, `iat <= now + 60s`, and that `sub` is a non-empty string.

This is fit for a spike but not what production should ship. See "Real-implementation recommendation" below.

### User provisioning

Deterministic synthetic email `line_<sub>@line.local`. On every login, the callback calls `admin.createUser({ email, email_confirm: true, user_metadata: { provider: 'line', line_sub, name } })`. Duplicate-email errors (`email_exists` or `user_already_exists`) are treated as "user already provisioned" — continue silently. Other createUser errors fail loud with plain-text diagnostics. The PR 1 trigger on `auth.users` insert auto-creates the matching `public.users` row with role `visitor` (per ADR 0010), so the result page should see exactly one matching row.

### State / CSRF

`state` is a 16-byte hex string from `crypto.randomBytes(16).toString('hex')`. Stored in an httpOnly, `secure`, `sameSite=lax` cookie scoped to `/spikes/line-auth`, max-age 600s. Callback verifies and deletes it. On mismatch, returns plain-text 400 with both values for diagnostics.

## What surprised me

1. **No direct admin-session API in 2026.** I expected one to exist by now. It still doesn't. The community-blessed workaround is the only path.

2. **`generateLink` for `magiclink` returns the User object too**, which makes provisioning + session minting one round-trip cheaper than I feared (no need to `getUserByEmail` between createUser and generateLink).

3. **The proxy.ts middleware would block the spike paths.** The original spec said the spike was self-contained under `/spikes/...`, but proxy.ts redirects every unauthenticated request to `/login` regardless of path. A first-login user has no Supabase session yet — that's the whole point — so the spike was unreachable until the temporary bypass was added. This is exactly the class of finding spikes exist to surface.

4. **The supabase-js `Provider` type's JSDoc documents `custom:` prefix** but the union doesn't include it — irrelevant for this spike (we're not using `signInWithOAuth`), but it would have been the natural attempted-fix-first path if we hadn't already established custom OIDC is dead for LINE.

5. **LINE's `name` claim** is delivered in the id_token payload directly, not via a separate userinfo call. No need to hit `/v2/profile` unless we want the picture URL.

## Real-implementation recommendation

If the operator wants to ship this as the real LINE auth (replacing the failed Custom OIDC Provider integration), here's the shape I'd recommend. Treat this as a starting point for the real spec / ADR, not as a finished design.

### Architecture

- **Replace** the current `src/app/auth/callback/route.ts` (which uses `exchangeCodeForSession` against the dead Custom OIDC Provider) with the same shape this spike uses: state check → LINE token exchange → HS256 verify → admin upsert → `generateLink` + `verifyOtp`.
- **Replace** `LoginButton.signInWithOAuth({ provider: 'custom:line' })` with a plain `<a href="/auth/start">` (or POST form) that hits a route analogous to `/spikes/line-auth/start`.
- **`/auth/start`** and **`/auth/callback`** stay as the only public-by-design auth surface. **Remove** the `pathname.startsWith("/spikes/")` proxy bypass at the same time the spike code is deleted.
- **Reify** `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` into `src/lib/env.server.ts` (server-only — they must never reach the client bundle). The spike reads `process.env` directly because the spec scoped that out; real implementation needs zod-validated env.
- **Use `jose`** for production JWT verification, not hand-rolled `node:crypto`. The spike's inline verifier is correct as written but is the kind of code that should live behind a library boundary in prod. `jose` is the modern, tree-shakable, Auth.js-blessed choice.

### Schema follow-ups (not part of the spike's scope, but worth flagging)

- **`auth.users.email` becomes a synthetic identifier**, not a real address. This may surprise anyone who reads it later; consider whether to use `phone` instead, or document the convention.
- **`public.users.line_user_id`** already exists from the PR 1 schema — the real callback should populate it on first login (the existing `/auth/callback`'s "NULL-only profile write" pattern via the admin client transfers directly here).
- **`auth.users.user_metadata.provider`** is set to `'line'` by the spike. Real impl should use a stable convention (`'line'` vs `'custom:line'` vs `'oidc:line'`) and document it.

### ADR

Once the operator validates the spike works on Vercel, this finding turns into an ADR (likely 0011) titled something like "LINE auth via custom flow because Supabase OIDC rejects HS256". It should:

1. Document why Supabase Custom OIDC Provider doesn't work (HS256 vs ES256/RS256).
2. Document the generateLink + verifyOtp mechanism and its risks.
3. Supersede the relevant sections of `docs/feature-specs/01-line-auth.md` that assume Supabase native OIDC was the path.
4. Note the synthetic-email convention.

## Cleanup required

This spike includes one **non-throwaway security-sensitive change** (the proxy bypass) that **must** be removed when the spike is deleted. Tracking it here so it doesn't get forgotten:

1. **Delete the spike routes** under [src/app/spikes/line-auth/](../src/app/spikes/line-auth/) — `start/`, `callback/`, `result/` and the parent `spikes/` directory if no other spike lives there.
2. **Remove the `pathname.startsWith("/spikes/")` line from [proxy.ts](../proxy.ts).** The comment above it is marked `TEMPORARY spike bypass — REMOVE when spike/line-auth-custom-flow is deleted`. **This line is a security hole if it outlives the spike** — any future route mistakenly placed under `/spikes/` would be unauthenticated. Delete it the moment the spike is gone, even if the real implementation is not yet merged.
3. **Remove `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET`** from `.env.local` and the Vercel environment **if** the real implementation does not promote them (it should — they're needed for the same flow at the real `/auth/...` paths). If the real impl uses different env var names, drop the spike ones to avoid leaving stale secrets in env stores.
4. **Delete this findings file** ([spikes/line-auth-FINDINGS.md](./line-auth-FINDINGS.md)) once the ADR captures the relevant decisions, or leave it in `spikes/` as a frozen reference — per CLAUDE.md, spike artifacts are "validated once, then frozen", so retention is fine. Either way, don't reference it from production code.

The cleanup PR should land in a single commit titled something like `chore: remove line-auth spike after ADR 0011 lands`.
