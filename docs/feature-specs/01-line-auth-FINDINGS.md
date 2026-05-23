# Feature Spec 01 — LINE custom-flow auth findings (from removed spike)

**Source spike:** `spike/line-auth-custom-flow` — merged as `c4e03a1` on 2026-05-23; spike code removed in `chore/remove-line-auth-spike` once the live test proved the mechanism. This document preserves the spike's findings for ADR 0011 and the real-implementation PR. Read alongside [`01-line-auth.md`](./01-line-auth.md) — that spec's decision #4 (Supabase Custom OIDC Provider) is superseded by the mechanism described here.

**Status:** Mechanism **PROVEN** by Vercel preview live test on 2026-05-23 (see "Live test result" below). One **real bug** was discovered during that test and is tracked as the next unit — see "Real bug discovered: RLS infinite recursion on `public.users`".

## Why a custom flow at all

LINE Login cannot use Supabase's Custom OIDC Provider: LINE signs ID tokens with **HS256**, and Supabase's OIDC verifier accepts only **ES256/RS256**. Confirmed via Supabase auth logs:

```
failed to verify ID token: oidc: id token signed with unsupported algorithm,
expected [ES256] got HS256
```

`signInWithIdToken` is dead for the same reason — it only supports a fixed provider list (Apple/Google/Azure/Facebook/Kakao), and the `custom:${string}` template still routes through the same OIDC verifier. So Supabase Auth, while it remains the foundation (RLS, `auth.uid()`, the ADR 0007 trigger, audit log actor all depend on it), needs LINE to be wired in by the app, not by Supabase's OIDC machinery.

## Proven mechanism

```
  /auth/start              LINE                       /auth/callback
       │                    │                              │
       │  1. 302 to LINE    │                              │
       │  authorize URL,    │                              │
       │  state cookie set  │                              │
       │ ──────────────────▶│                              │
       │                    │                              │
       │                    │  2. user signs in            │
       │                    │  3. 302 back with            │
       │                    │     ?code &state             │
       │                    │ ────────────────────────────▶│
       │                    │                              │
       │                    │      4. verify state         │
       │                    │      5. POST to LINE         │
       │                    │         /oauth2/v2.1/token   │
       │                    │      6. verify HS256         │
       │                    │         id_token (channel    │
       │                    │         secret as HMAC key)  │
       │                    │      7. admin.createUser     │
       │                    │         (idempotent)         │
       │                    │      8. admin.generateLink   │
       │                    │         {type: 'magiclink'}  │
       │                    │      9. verifyOtp            │
       │                    │         {type: 'magiclink',  │
       │                    │          token_hash}         │
       │                    │      → SSR cookies set       │
       │                    │     10. 302 to role landing  │
```

**Exact session-minting calls.** There is no direct admin-mints-session API in supabase-js v2.105 / Supabase Auth 2026; this was verified against `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts` and corroborated by [Supabase Discussion #11854](https://github.com/orgs/supabase/discussions/11854) (open feature request) and [Razikus — "admin login as user"](https://medium.com/@razikus/supabase-admin-login-as-user-get-his-session-d35eedb50e75). The canonical workaround:

```ts
// 7. Provision/locate the auth user (idempotent on synthetic email)
const { error: createErr } = await admin.auth.admin.createUser({
  email: `line_${lineSub}@line.local`,
  email_confirm: true,
  user_metadata: { provider: "line", line_sub: lineSub, name: lineName },
});
// createErr code 'email_exists' / 'user_already_exists' → already provisioned, continue.

// 8. Mint a session for that user.
const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: `line_${lineSub}@line.local`,
});
const hashedToken = linkData.properties.hashed_token;

// 9. Verify the token on the SSR client so its setAll callback writes the
//    sb-* session cookies onto the route handler's response.
const supabase = await createServerSupabase();
const { data: sessionData, error: verifyErr } = await supabase.auth.verifyOtp({
  type: "magiclink",
  token_hash: hashedToken,
});
```

After `verifyOtp` returns, `supabase.auth.getUser()` on subsequent server-side requests returns the user, `auth.uid()` works in RLS, and the trigger from ADR 0007 has already auto-created the matching `public.users` row.

**Alternatives ruled out:**

- `signInWithIdToken` — fixed provider list; `custom:*` still hits Supabase's HS256-rejecting verifier.
- `setSession(access_token, refresh_token)` — no admin API produces tokens for an arbitrary user.
- Custom Access Token Hook — augments claims on an _existing_ session; doesn't mint one.

## Multi-environment `redirect_uri` derivation

Both `/start` and `/callback` derive `redirect_uri` from the incoming request's own origin:

```ts
const redirectUri = `${request.nextUrl.origin}/auth/callback`;
```

Not from `process.env.NEXT_PUBLIC_APP_URL`. `NEXT_PUBLIC_APP_URL` is set once per Vercel project and points at the production domain — Preview deployments would compute the wrong `redirect_uri` and fail LINE's exact-match check. Deriving from the request origin makes the flow work on production, every long-lived Vercel preview, and `localhost`, with no per-environment env juggling.

Both routes compute the value the same way on a given request, so they're guaranteed identical (which LINE's token endpoint requires — `redirect_uri` in the code exchange must match the value sent to authorize). The `state` cookie is also same-origin since both routes are on the same host, so `sameSite=lax` continues to work without changes.

**Operational cost:** the LINE channel's "Callback URL" allowlist must contain every origin we want to exercise (production, every long-lived preview, `localhost` if used). LINE doesn't support wildcards, so each is a manual addition. Ephemeral preview URLs (one per PR) cannot be allowlisted at scale — pick a stable preview URL for testing and add only that.

## HS256 verification

LINE's ID token is HS256 (symmetric, HMAC-SHA256 keyed with the channel secret). The spike verified it inline with `node:crypto` only — no JWT library was added:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyLineIdToken(token, channelSecret, channelId) {
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  if (header.alg !== "HS256") throw new Error(`unexpected alg: ${header.alg}`);

  const expected = createHmac("sha256", channelSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = Buffer.from(signatureB64, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("signature mismatch");
  }

  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  // Validate: iss === 'https://access.line.me', aud === LINE_CHANNEL_ID,
  // exp > now, iat <= now + 60s, sub is a non-empty string.
  return payload;
}
```

This is correct as written but the real implementation should swap to **`jose`** for the JWT verification — production crypto belongs behind a library boundary, and `jose` is the modern (Node 18+), tree-shakable, Auth.js-blessed choice.

## Live test result (2026-05-23, Vercel preview)

Operator clicked `/spikes/line-auth/start` on the preview deployment, completed the LINE consent screen, and landed on `/spikes/line-auth/result`. The page rendered:

```json
{
  "session_exists": true,
  "auth_user_id": "623f2da5-...",
  "auth_email": "line_<line-sub>@line.local",
  "auth_user_metadata": {
    "provider": "line",
    "line_sub": "<the LINE sub claim>",
    "name": "<the LINE display name>"
  },
  "get_user_error": null,
  "public_users_row": null,
  "public_users_error": "infinite recursion detected in policy for relation \"users\""
}
```

**What this proves:**

- LINE OAuth handshake works against our channel.
- HS256 `id_token` verification with `node:crypto` works against a real LINE-signed token.
- `admin.createUser` provisions the `auth.users` row (and the ADR 0007 trigger fires, creating the matching `public.users` row — confirmed via the Supabase dashboard out-of-band).
- `admin.generateLink({ type: 'magiclink' })` returns a usable `hashed_token`.
- `verifyOtp({ type: 'magiclink', token_hash })` on the SSR client mints a Supabase session and sets the `sb-*` cookies — `session_exists: true` and the resolved `auth_user_id` are the proof.
- The synthetic-email convention (`line_<sub>@line.local`) is durable across logins (no duplicate-key errors observed; the duplicate-detection branch in the callback triggered on the second login attempt as expected).
- LINE's `name` claim arrives in the `id_token` payload directly — no separate `/v2/profile` call needed.

**What this surfaced as a real bug (separate from the spike):** see the next section.

## Real bug discovered: RLS infinite recursion on `public.users`

The only failure in the live test was reading `public.users` from the result page. `supabase.from("users").select("...").eq("id", user.id).maybeSingle()` returned the error `"infinite recursion detected in policy for relation \"users\""`. The session is valid — `supabase.auth.getUser()` succeeded and returned the right `auth_user_id` — but the row read fails at the RLS layer.

This is **not** a spike-specific issue. It will block the real auth implementation in exactly the same way: the real `/auth/callback` reads `users.role` after `exchangeCodeForSession` to decide where to redirect, and the existing `/login` server component does the same to redirect already-authenticated visitors. Both paths will hit this error the moment they're exercised against the live database.

**Likely cause** (from reading `supabase/migrations/20260505143544_create_users.sql:14-34`): the `super_admin full access on users` policy joins `public.users` back to itself —

```sql
create policy "super_admin full access on users"
  on public.users for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'super_admin'
    )
  );
```

The `select 1 from public.users` inside the policy re-enters the same policy → infinite recursion. The standard fix is to compute the role outside RLS (via a `SECURITY DEFINER` function or by storing the role in a JWT claim) and reference _that_ in the policy instead of self-joining `public.users`.

**Next unit** (the cleanup PR explicitly defers this): fix the RLS recursion in a dedicated PR. The fix is small (rewrite the super_admin policy to use a `SECURITY DEFINER` helper that reads `public.users.role` bypassing RLS) but warrants its own ADR amendment to ADR 0007 because it changes how role checks compose. The real-auth implementation PR depends on this being fixed first.

## Real-implementation recommendation

When the operator builds the real LINE auth (replacing the failed Custom OIDC Provider integration):

### Architecture

- **Replace** `src/app/auth/callback/route.ts` (currently uses `exchangeCodeForSession` against the dead Custom OIDC Provider) with the shape proven here: state check → LINE token exchange → HS256 verify → admin upsert → `generateLink` + `verifyOtp`.
- **Replace** `LoginButton.signInWithOAuth({ provider: 'custom:line' })` with a plain `<a href="/auth/start">` (or POST form) hitting a new route shaped like the spike's `/start`.
- Keep `/login` and `/auth/callback` as the public auth surface (they already are in `PUBLIC_PATHS`). Add `/auth/start` to `PUBLIC_PATHS`. **No `/spikes/` bypass** — that's already gone in this cleanup PR.
- **Reify `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` into `src/lib/env.server.ts`** (server-only, zod-validated, throws at boot if missing). The spike read `process.env` directly because the spec scoped that out; real code should validate.
- **Use `jose`** for production JWT verification, not hand-rolled `node:crypto`.
- **Keep `redirect_uri` derived from `request.nextUrl.origin`**, not from env. Document the LINE allowlist policy in the ADR.

### Schema follow-ups

- **`auth.users.email` becomes a synthetic identifier**, not a real address. Document the `line_<sub>@line.local` convention.
- **`public.users.line_user_id`** exists from PR 1 schema — the real callback should populate it on first login (NULL-only profile write via admin client, the same pattern from the prior PR 2).
- **`auth.users.user_metadata.provider`** = `'line'` (the spike's choice). Real impl should pick a stable string and document it.

### ADR

This file feeds **ADR 0011** ("LINE auth via custom flow because Supabase OIDC rejects HS256"). The ADR should:

1. Document why Supabase Custom OIDC Provider doesn't work (HS256 vs ES256/RS256, confirmed against live Supabase auth logs).
2. Document the `generateLink` + `verifyOtp` mechanism and its known limitation (no first-class admin-mints-session API; this is the supported workaround).
3. Document the synthetic-email convention.
4. Supersede [`01-line-auth.md`](./01-line-auth.md) decision #4 ("Integration mechanism: Supabase Custom OIDC Provider").
5. Note that the RLS recursion fix (separate PR + amendment to ADR 0007) is a prerequisite for the real implementation.

## Status of cleanup tasks from the original spike

All resolved by `chore/remove-line-auth-spike`:

- ✅ Spike routes under `src/app/spikes/line-auth/` deleted (start, callback, result).
- ✅ Original `spikes/line-auth-FINDINGS.md` deleted; content preserved in this file.
- ✅ `pathname.startsWith("/spikes/")` removed from `proxy.ts` along with the two `TEMPORARY spike bypass` comments — the only proxy "public" check is back to `PUBLIC_PATHS.has(pathname)`.
- ⏸️ `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` **retained** in `.env.local` and Vercel — the real implementation needs them. They graduate from spike config to real env.
