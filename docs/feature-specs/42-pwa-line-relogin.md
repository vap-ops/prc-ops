# Spec 42 — PWA standalone LINE re-login (iOS)

**Status:** shipped — 2026-06-12; **items 1–2 superseded same day by
spec 43 / ADR 0041** (operator hit the web-login limitation
immediately — QR/email-password is unusable for most users). Item 3
(logout hiding) stands. Operator: "Adding to home is
problematic due to LINE login. It works fine until user logout
(intentionally or not). Logging back in requires redirect, then LINE
takes the user back to the browser again, and that login session is
separated from the one on home." iOS observed; Android untested.

## Problem

The installed PWA (`display: standalone`, spec 18) has its own cookie
jar on iOS, separate from Safari. It works right after install because
iOS copies site data into the PWA container at install time. After a
logout or session loss, re-login from inside the PWA breaks:

1. Login button navigates to `access.line.me` (out of scope → in-app
   browser overlay inside the PWA — this part is fine).
2. LINE **auto-login** deep-links into the native LINE app.
3. After consent, the LINE app opens the callback URL in the **system
   browser**, not the PWA. The `sb-*` session cookies land in Safari's
   jar; the PWA stays logged out.
4. The CSRF `state` cookie from `/auth/line/start` lives in the PWA
   jar, so the browser-side callback fails state validation
   (`oauth_failed`) — the flow dies entirely.

LINE Login v2.1 supports `disable_auto_login=true` on the authorize
endpoint: auto login (the LINE-app jump) is disabled; the user gets
LINE's web login (SSO if available, else email/password). With the
whole flow kept in the in-app overlay, the redirect back to the
in-scope callback returns to the PWA window and cookies land in the
PWA jar. Verified against LINE docs 2026-06-12
(developers.line.biz/en/docs/line-login/integrate-line-login/).

## Scope — three changes

### 1. `LoginButton` — standalone-aware href (CSS only, stays server-rendered)

Render **two** plain anchors (ADR 0012: plain `<a>`, no prefetch),
toggled by the `display-mode: standalone` media query via Tailwind
arbitrary variants — no `'use client'`:

- Default anchor → `/auth/line/start`, gets
  `[@media(display-mode:standalone)]:hidden`.
- Standalone anchor → `/auth/line/start?standalone=1`, gets
  `hidden [@media(display-mode:standalone)]:inline-flex`.

Same label and visual classes on both.

### 2. `/auth/line/start` — append `disable_auto_login=true` (iOS standalone only)

When the request has `?standalone=1` **and** the User-Agent matches
`/iPhone|iPad|iPod/`, append `disable_auto_login=true` to the
authorize URL. Everything else unchanged.

iOS-only on purpose: Android WebAPK PWAs share Chrome's cookie jar, so
the existing auto-login flow lands a usable session there; forcing web
email login on Android would be a UX regression. (iPadOS desktop-UA
edge case accepted — phone-first app.)

### 3. `AppHeader` — hide logout in standalone

Wrap the header `LogoutButton` in a
`[@media(display-mode:standalone)]:hidden` container. Reduces
accidental logouts in the PWA, where re-login is the expensive path.
Deliberate logout stays available: `/profile` (reachable from the
bottom tab โปรไฟล์) keeps its logout button. `LogoutButton` component
itself unchanged.

## Out of scope (recorded seams)

- **One-time handoff code** (login completes in browser → short-lived
  code typed into the PWA mints the session there via the existing
  `generateLink`/`verifyOtp` machinery). Build if password-less LINE
  users get stuck on the web login screen.
- Supabase session lifetime: dashboard inactivity timeout must stay
  "never" (default). Operator check, no code.
- `prompt=login`, Android refinements — untested platform, revisit
  after an Android pass.

## Limitation (recorded)

Users who never registered an email/password with LINE cannot complete
the web login form. Mitigation today: log in via browser, reinstall
the PWA (data copied at install). The handoff-code seam is the real
fix if this bites.

## Verification checklist

- [x] Unit: start route without `standalone=1` → authorize URL has no
      `disable_auto_login` (pins current behavior).
- [x] Unit: `standalone=1` + iOS UA → `disable_auto_login=true`
      present; state cookie still set.
- [x] Unit: `standalone=1` + Android UA → param absent.
- [x] Unit: LoginButton renders both anchors with correct hrefs and
      display-mode classes.
- [x] Unit: AppHeader logout wrapper carries the standalone-hidden
      class; profile page logout untouched.
- [x] `pnpm lint && pnpm typecheck && pnpm test` green (368 unit);
      auth e2e spec 8/8 on chromium (role locators ignore the
      display-hidden anchor — no strict-mode violation).
- [ ] Operator (acceptance): on iPhone PWA, logout → log back in via
      LINE web login → session lands in the PWA without leaving it.
