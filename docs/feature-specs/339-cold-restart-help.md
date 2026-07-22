# Spec 339 — "ปิดแอปสนิท": in-app cold-restart help + a stale-bundle nudge

**Status:** operator directive 2026-07-22 — after spec 291's photo-delete shipped,
the field user could not see the new button until she fully closed and reopened
the PWA. Operator: "Can we visualize it in helper somewhere in app?" and chose
**both units**. CODE-ONLY, no schema.

## Problem

A deploy does not reach a running installed PWA. Two facts make this invisible to
the user:

1. **The app's own refresh button does not reload the app.** `RefreshButton`
   (spec 53, `src/components/features/common/refresh-button.tsx`) calls
   `router.refresh()` — its comment says "deliberately NOT a hard reload". It
   re-fetches server components; the client JS bundle in memory is untouched. So
   the one affordance a user reaches for cannot fix the one problem it looks like
   it should fix.
2. **iOS standalone PWA resume-from-background keeps its old in-memory bundle**
   (diagnosed 2026-07-16, memory `ios-pwa-stale-bundle-2026-07`). The service
   worker is NOT the cause — it caches only content-hashed `/_next/static/*`.
   Only a fresh app instance (kill-and-reopen) picks the new code up.

Today nothing in the app says any of this. The recovery is an oral instruction
passed person to person, and the SA is the one who has to pass it on.

A version-mismatch auto-reload was proposed on 2026-07-16 and **the operator
declined it**: a forced reload can interrupt a field worker mid-task. That
objection is about _forcing_, not about _telling_ — U2 below is the non-forcing
form.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **The illustrated card lives on `/settings` → เกี่ยวกับ, not `/sa/help`.** The stale-bundle class hits every role, and `/sa/help` is gated to `site_admin`/`super_admin`. `/settings` is reachable by every authenticated role (it uses `getClaims`, not `requireRole`) and already renders the `เวอร์ชัน {pkg.version}` row — the exact line a user is told to check. `/sa/help` gets a text-only card that points there. |
| D2  | **Zero-JS.** A native `<details>` inside the existing เกี่ยวกับ group card, same idiom as `HelpCard`. No `'use client'`, no new client bundle for a page that is mostly static.                                                                                                                                                                                                                                            |
| D3  | **One gesture illustration, two "how to get there" lines.** The card-flick gesture is identical on both platforms; only the way to open the app switcher differs. Drawing two near-identical phones would imply a difference that does not exist.                                                                                                                                                                          |
| D4  | **The card names the refresh button and says it is not enough.** The most likely wrong action is the one the app itself offers; the help is worthless if it does not pre-empt it.                                                                                                                                                                                                                                          |
| D5  | **U2 nudges, never reloads by itself.** A dismissible chip; the reload happens only on an explicit tap. This is what separates it from the declined 2026-07-16 proposal.                                                                                                                                                                                                                                                   |
| D6  | **U2 compares the CLIENT bundle's version against the SERVER's**, i.e. `NEXT_PUBLIC_APP_VERSION` (inlined into the bundle at build) vs `/api/health`'s `version` (whatever is deployed now). Equal → nothing renders. This needs no new endpoint and no schema.                                                                                                                                                            |
| D7  | **U1 ships before U2 and stands alone.** U2 can only ever help a client that already has U2's code — the first rollout still needs one manual cold restart, and a dismissed chip must leave the user somewhere to look. Both units add; neither removes an affordance, so the split is safe.                                                                                                                               |

## Unit U1 — the illustrated card (code-only)

- New server component `src/components/features/chrome/cold-restart-help.tsx`:
  a `<details id="cold-restart">` titled `แอปไม่อัปเดต? ปิดแอปสนิท`, containing
  - a warning line that the in-app รีเฟรช button is not enough,
  - an inline SVG of the app-switcher card flick (`currentColor` only — no raw
    hues; the design-doctrine guard bans palette literals),
  - one line each for iPhone (incl. the home-button variant) and Android (incl.
    the บังคับหยุด fallback),
  - the verification line: ตั้งค่า → เกี่ยวกับ → the version shown on this page.
- `src/app/settings/page.tsx` renders it inside the เกี่ยวกับ group card, below
  the version row, passing `pkg.version` (already imported there).
- `src/lib/sa/help-content.ts` gains a text-only `cold-restart` card pointing at
  `/settings`. `HelpCard` itself is NOT changed (it is steps-only by design).

**Failure modes / recovery**

| Mode                                                | User sees                                              | Recovery                                                       |
| --------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| User taps the in-app รีเฟรช and nothing changes     | the card's warning line names this exact case          | follow the steps below it                                      |
| User follows the steps and the version is unchanged | the verification line gives the expected value         | repeat; Android fallback = บังคับหยุด                          |
| Browser (not installed) user reads it               | steps mention the app switcher, which they do not have | out of scope for U1 — the browser reloads on navigation anyway |

## Unit U2 — the non-forcing update chip (code-only)

- Client component mounted in the app chrome: on mount and on
  `visibilitychange` → visible, fetch `/api/health` (no-store), compare
  `version` with `NEXT_PUBLIC_APP_VERSION`.
- Mismatch → render a dismissible chip: `มีเวอร์ชันใหม่ · แตะเพื่ออัปเดต`.
  Tap → `location.reload()`. Dismiss → silent for the rest of the session
  (`sessionStorage`).
- Never reloads on its own. Never blocks. Fetch failure → render nothing.

## Verification

- U1: unit test asserts the card's warning, both platform lines, the anchor id,
  and that the rendered version string is the one passed in; settings-hub render
  test still green; design-doctrine + ui-class-contracts guards green.
- U2: unit test drives equal / mismatch / fetch-failure / dismiss.
- Real-flow: dev-preview login → `/settings` → expand the card; U2 verified by
  serving a mismatched `/api/health` version.
