# ADR 0041: Device-code handoff for standalone PWA login

## Status

Accepted — 2026-06-12. Amends ADR 0012 (custom LINE flow) with a second,
cookie-less state channel for flows started inside the installed PWA.
Supersedes spec 42's `disable_auto_login` approach (items 1–2 of that
spec; the logout-hiding item stands).

## Context

The installed iOS PWA (`display: standalone`) has a cookie jar separate
from Safari. LINE's auto-login deep-links into the native LINE app,
which reopens our callback in the **system browser** — the minted
session and the ADR 0012 CSRF state cookie both end up in the wrong
jar, so re-login from inside the PWA cannot complete there.

Spec 42 forced LINE's _web_ login (`disable_auto_login=true`) to keep
the flow inside the PWA. Operator testing immediately hit the recorded
limitation: LINE's web login offers QR (useless on the same phone) or
email/password (often never registered). The one-tap LINE-app login is
the only login most users can actually perform.

## Decision

Adopt a device-code handoff (OAuth Device Authorization Grant shape,
adapted): let the OAuth flow complete **wherever LINE drops it**, and
let the PWA **pick the session up by polling**, in its own cookie jar.

1. **`login_handoffs` table** — server-only handshake state:
   `state` (unique), `device_code` (unique), `status`
   (`pending → approved → consumed` enum), `user_email` (the ADR 0012
   synthetic `line_<sub>@line.local`), `expires_at` (10 min). Zero user
   access: privileges revoked, RLS enabled with no policies (outbox
   posture, ADR 0037); all access via the service-role client.
   Deliberately mutable — handshake state, not evidence. Expired rows
   are purged opportunistically on each handoff start (no cron).
2. **`POST /auth/handoff/start`** — generates `state` + `device_code`,
   inserts the row, returns `{device_code, authorize_url}`. The
   authorize URL is ADR 0012's, with the row's `state` and **no**
   `disable_auto_login` — the LINE-app jump is desired again.
3. **Callback branch** (`/auth/line/callback`) — if the state cookie
   validates, the ADR 0012 browser path runs unchanged. Otherwise, if
   `?state` matches a `pending`, unexpired handoff row, run the same
   exchange → HS256 verify → provision steps, then atomically bind
   (`user_email`, `status='approved'` `WHERE status='pending' AND
expires_at > now()`) and redirect to `/login?handoff=approved`
   ("success — return to the app"). **No session is minted in the
   landing context.** Anything else → `oauth_failed` as today.
4. **`POST /auth/handoff/poll`** — body `{device_code}`. `pending` →
   `{status:"pending"}`. `approved` + unexpired → atomic claim to
   `consumed` (UPDATE … WHERE status='approved'; claim-loser gets
   `expired`), then mint the session **onto this response** via the
   ADR 0012 `generateLink(magiclink)` → `verifyOtp(token_hash)` pair —
   the `sb-*` cookies land in the PWA's jar — read the role and return
   `{status:"ok", redirect: roleHome(role)}`. Missing / expired /
   consumed → `{status:"expired"}`.
5. **Client** — the login page's standalone slot becomes a small
   `'use client'` component (justified: fetch + `window.open` + poll
   orchestration cannot be server-rendered): tap → start → open the
   authorize URL → poll every ~2.5 s (plus visibility/focus events,
   resume from `sessionStorage` if the PWA reloads) → navigate to the
   returned redirect. Browser login stays the ADR 0012 plain anchor.

## Why this is safe

- **State validation is preserved**, moved from cookie to DB row for
  handoff flows: single-use (status flip is atomic), 10-min TTL, and
  unguessable (16 random bytes). The cookie path is untouched.
- **`device_code` is the session-collection secret**: 32 random bytes,
  never in a URL (POST bodies only), known only to the initiating PWA
  context, single-use via the `consumed` claim.
- **No privileged data crosses the gap.** The callback binds only the
  synthetic email; the poll mints via the same admin-side
  `generateLink`/`verifyOtp` mechanism ADR 0012 already trusts, and the
  hashed token still never reaches any browser.
- **Claim-before-mint:** a mint failure after the claim burns the
  handoff (user restarts login) rather than risking a replayable
  approved row. Recorded trade-off.
- **Inherited device-grant risk (accepted, recorded):** as in any
  device-code flow, a victim who completes LINE login on an
  attacker-initiated authorize URL would bind their identity to the
  attacker's `device_code`. Standard OAuth has the same login-CSRF
  class; mitigations here are the short TTL, LINE's own consent screen,
  and the app's internal-user base (new identities land as `visitor`,
  ADR 0010). Hardening seam if ever needed: a confirm tap on the
  callback page before binding.

## Consequences

- One new table + two route handlers + one client component; the
  browser login path is byte-equivalent in behavior.
- The token exchange + HS256 verification move to a shared lib
  (`src/lib/auth/line-token-exchange.ts`) used by both callback paths —
  the security-sensitive verifier itself (ADR 0012 §3) is unchanged.
- `users.email`-style mixed-reference concern: `user_email` stores the
  ADR 0012 synthetic identifier rather than a FK — deliberate, so the
  poll can `generateLink` without an admin user lookup; rows live
  minutes.
- `proxy.ts` PUBLIC_PATHS grows by the two handoff routes.
- Polling is unauthenticated and unthrottled at pilot scale (a wrong
  device_code reveals only "expired"); rate limiting is a recorded
  seam.
