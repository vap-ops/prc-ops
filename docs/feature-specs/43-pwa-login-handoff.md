# Spec 43 — Device-code handoff login for the installed PWA

**Status:** built — 2026-06-12; awaiting migration push + operator
iPhone pass. Operator (after spec 42): "now,
the login button takes us to another login page where it requires
either QR login or email pass." LINE web login is unusable for
password-less LINE accounts; QR cannot be scanned by the same phone.
Design per ADR 0041 — read it first; this spec is the implementation
checklist.

## Scope

### 1. Migration `create_login_handoffs` + pgTAP file 28

Enum `login_handoff_status` (`pending`,`approved`,`consumed`). Table
`login_handoffs`: `id` uuid PK, `state` text unique not null,
`device_code` text unique not null, `status` default `pending`,
`user_email` text null, `created_at` default now(), `expires_at`
timestamptz not null. Revoke all from `authenticated, anon`; RLS
enabled, zero policies (ADR 0037 outbox posture). pgTAP pins: table +
enum shape, RLS on, no policies, no anon/authenticated privileges,
uniques, default.

### 2. `POST /auth/handoff/start`

Admin client: delete expired rows (`expires_at < now()` — the
opportunistic purge), insert `{state: 16B hex, device_code: 32B hex,
expires_at: now()+600s}`. Respond `{device_code, authorize_url}` where
`authorize_url` is the ADR 0012 authorize URL carrying the row's state
(no `disable_auto_login`, no state cookie). GET → 405.

### 3. Callback handoff branch (`/auth/line/callback`)

Token exchange + HS256 verify extracted to
`src/lib/auth/line-token-exchange.ts` (logic unchanged; both paths call
it). Branch order: valid state cookie → existing path untouched; else
pending unexpired `login_handoffs` row matching `?state` → exchange,
verify, provision (same idempotent createUser), then atomic
`UPDATE … SET user_email, status='approved' WHERE id=… AND
status='pending' AND expires_at > now()`; 0 rows → `oauth_failed`.
Redirect `/login?handoff=approved` — no session minted in the landing
context. Else → `oauth_failed` (today's behavior).

### 4. `POST /auth/handoff/poll`

Body `{device_code}`. Missing/expired/`consumed` → `{status:
"expired"}`. `pending` → `{status:"pending"}`. `approved` → atomic
claim to `consumed` (claim-loser → `expired`), `generateLink(magiclink,
user_email)` → `verifyOtp(token_hash)` on the SSR client (cookies land
on THIS response), read `users.role` (callback's retry helper),
respond `{status:"ok", redirect: roleHome(role)}`. Mint failure after
claim → `{status:"expired"}` (burned handoff; user retaps — ADR 0041
trade-off).

### 5. Login UI

- `StandaloneLoginButton` (`'use client'` — justification: fetch +
  window.open + poll loop): idle button (same visual classes) → start
  POST → `sessionStorage` the device_code → `window.open(authorize_url)`
  → waiting state ("เปิดแอป LINE เพื่อยืนยัน แล้วกลับมาที่หน้านี้") with
  ยกเลิก → poll every 2.5 s while visible + on visibilitychange/focus →
  `ok`: navigate to redirect (injectable `navigate` prop, default
  `window.location.assign`); `expired`: error state + retry. On mount,
  resume from sessionStorage (PWA reload survival). Stops at TTL.
- `LoginButton`: browser anchor (CSS-hidden in standalone, spec 42
  classes kept) + `StandaloneLoginButton` (CSS-shown only standalone).
  The `?standalone=1` anchor dies.
- `/auth/line/start`: spec-42 `disable_auto_login` branch REMOVED
  (dead path — standalone no longer routes through it). Named test
  updates in `line-start-route.test.ts`.
- Login page: `?handoff=approved` renders a success notice
  ("เข้าสู่ระบบสำเร็จแล้ว กลับไปที่แอปบนหน้าจอหลักได้เลย") — shown in
  the browser tab LINE dropped the user in.
- `proxy.ts` PUBLIC_PATHS += `/auth/handoff/start`,
  `/auth/handoff/poll`.

### 6. Types

`database.types.ts` gains `login_handoffs` hand-written pre-push (typed
admin client); reconcile with `pnpm db:types` post-push.

## Out of scope (recorded seams)

Poll rate limiting; confirm-tap binding hardening (ADR 0041); Android
pass (flow is platform-neutral — WebAPK standalone also benefits);
handoff for any future second OAuth provider.

## Verification checklist

- [ ] pgTAP file 28 green post-push (`pnpm db:test`).
- [x] Unit: line-token-exchange (ok / HTTP error / missing id_token /
      forged signature / unreachable endpoint).
- [x] Unit: handoff start route (codes returned, row inserted with
      matching state, purge issued, authorize URL params, no GET
      export, fail-closed insert error).
- [x] Unit: poll route — pending / expired / missing / consumed /
      claim-race-loss / malformed body / ok-with-redirect (+ profile
      write parity assertion).
- [x] Unit: resolveCallbackFlow precedence pins (cookie wins; pending
      unexpired row only; single-use).
- [x] Unit: StandaloneLoginButton — idle render, tap → start + open +
      waiting, resume-from-storage → navigate, expired → error, cancel.
- [x] Unit: LoginButton named updates (anchor + client slot; dead
      ?standalone=1 anchor pinned absent).
- [x] Unit: line/start named updates (flag tests removed, default pin
      stays).
- [x] `pnpm lint && pnpm typecheck && pnpm test` (395 unit); auth e2e
      8/8 chromium; production build green.
- [ ] Operator (acceptance): iPhone PWA → logout → login → LINE app
      one tap → return to PWA → signed in. No QR / password anywhere.
