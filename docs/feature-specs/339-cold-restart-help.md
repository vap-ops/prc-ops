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

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **The illustrated card lives on `/settings` → เกี่ยวกับ, not `/sa/help`.** The stale-bundle class hits every role, and `/sa/help` is gated to `site_admin`/`super_admin`. `/settings` is reachable by every authenticated role (it uses `getClaims`, not `requireRole`) and already renders the `เวอร์ชัน {pkg.version}` row — the exact line a user is told to check. `/sa/help` gets a text-only card that points there.                                                                                                                                                                                                                                                                                                                                      |
| D2  | **The card is zero-JS; the freshness verdict is one small client island.** The `<details>` and all copy are server-rendered (same idiom as `HelpCard`). The single exception is `AppVersionCheck`, and the exception is the point — see D8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D3  | **One gesture illustration, two "how to get there" lines.** The card-flick gesture is identical on both platforms; only the way to open the app switcher differs. Drawing two near-identical phones would imply a difference that does not exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D4  | **The card names the refresh button and says it is not enough.** The most likely wrong action is the one the app itself offers; the help is worthless if it does not pre-empt it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D5  | **U2 nudges, never reloads by itself.** A dismissible chip; the reload happens only on an explicit tap. This is what separates it from the declined 2026-07-16 proposal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D6  | **U2 compares the CLIENT bundle's version against the SERVER's**, i.e. `NEXT_PUBLIC_APP_VERSION` (inlined into the bundle at build) vs `/api/health`'s `version` (whatever is deployed now). Equal → nothing renders. This needs no new endpoint and no schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D7  | **U1 ships before U2 and stands alone.** U2 can only ever help a client that already has U2's code — the first rollout still needs one manual cold restart, and a dismissed chip must leave the user somewhere to look. Both units add; neither removes an affordance, so the split is safe.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D8  | **The "did it work?" check must NOT be the page's server-rendered version.** Caught by fresh-eyes before ship: `/settings` renders `เวอร์ชัน {pkg.version}` from the server on every request, so a device stuck on an old bundle is already shown the NEW number. Telling a user to check it is worse than saying nothing — it certifies a failed restart as a success. The only value that actually goes stale is `NEXT_PUBLIC_APP_VERSION`, inlined into the client bundle at build time, so `AppVersionCheck` reads it in an effect (identical server/client passes, no hydration mismatch) and compares its semver part against the deployed prop. Three honest states: stale · current · unknown (the var is optional in dev/test and must claim neither). |
| D9  | **Platform copy names controls by function, not by shape, and claims nothing unverified.** "ปุ่มสี่เหลี่ยม" is wrong on Samsung One UI (square-ish key = home, recents = the three-bar key), and the Android `ตั้งค่า → แอป → บังคับหยุด` fallback is not reliably reachable for a WebAPK install — both dropped. The refresh button is located ("มุมบนขวาของหน้าอื่น ๆ") because `/settings` itself renders neither `AppHeader` nor `DetailHeader`, so it is not on the page the card is on.                                                                                                                                                                                                                                                                   |

## Unit U1 — the illustrated card (code-only)

- New server component `src/components/features/chrome/cold-restart-help.tsx`:
  a `<details id="cold-restart">` titled `แอปไม่อัปเดต? ปิดแอปสนิท`, containing
  - a warning line that the in-app รีเฟรช button is not enough,
  - an inline SVG of the app-switcher card flick (`currentColor` only — no raw
    hues; the design-doctrine guard bans palette literals),
  - one line each for iPhone (incl. the home-button variant) and Android,
  - `AppVersionCheck` (the one client island, D8) as the closing verdict line.
- `src/app/settings/page.tsx` renders it inside the เกี่ยวกับ group card, below
  the version row, passing `pkg.version` (already imported there).
- `src/lib/sa/help-content.ts` gains a text-only `cold-restart` card pointing at
  `/settings`. `HelpCard` itself is NOT changed (it is steps-only by design).

**Failure modes / recovery**

| Mode                                            | User sees                                                 | Recovery                                                       |
| ----------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| User taps the in-app รีเฟรช and nothing changes | the card's warning line names this exact case             | follow the steps below it                                      |
| User follows the steps and it did not take      | the verdict line still reads "เครื่องนี้ยังใช้เวอร์ชัน …" | repeat — the line is re-read after every restart               |
| Browser (not installed) user reads it           | steps mention the app switcher, which they do not have    | out of scope for U1 — the browser reloads on navigation anyway |

## Unit U2 — the non-forcing update chip (code-only)

- Client component mounted in the app chrome: on mount and on
  `visibilitychange` → visible, fetch `/api/health` (no-store), compare
  `version` with `NEXT_PUBLIC_APP_VERSION`.
- Mismatch → render a dismissible chip: `มีเวอร์ชันใหม่ · แตะเพื่ออัปเดต`.
  Tap → `location.reload()`. Dismiss → silent for the rest of the session
  (`sessionStorage`).
- Never reloads on its own. Never blocks. Fetch failure → render nothing.

### U2 refined 2026-07-23 — split by cohort (operator decision)

The 2026-07-16 objection behind D5 was about _forcing a field worker mid-task_.
That objection does not hold for the **unapproved** cohort: a `visitor` sitting on
a pre-approval screen (`/register/technician`, `/register/office`, or the visitor
branch of `/coming-soon`) has no task in flight, and is the exact population the
spec-343 registration-cliff fix cannot reach unless their PWA is running it. So
U2 splits:

- **U2a — auto-reload, UNAPPROVED only (SHIPPED 2026-07-23).** New client island
  `RegisterFreshnessGate` mounted on the three pre-approval routes (visitor branch
  of `/coming-soon` only). On mount and on `visibilitychange → visible` it fetches
  `/api/health` (no-store), compares `version` with the semver part of
  `NEXT_PUBLIC_APP_VERSION`, and `location.reload()`s on mismatch. Loop-guarded via
  `sessionStorage(app-freshness-reloaded-for=<deployed>)` (reload at most once per
  deployed version), never fires while a text input is focused, and is scoped by
  route placement so an approved user is never reloaded — the `/coming-soon`
  super_admin OperatorHub and the approved-unserved card stay gate-free and keep
  U1's passive line. Operator confirmed the reload-flash on resume is acceptable
  for this cohort. Decision logic is a pure `shouldReload()`; route wiring is
  source-pinned.
- **U2b — the non-forcing chip, APPROVED users (still owed).** The dismissible
  `มีเวอร์ชันใหม่ · แตะเพื่ออัปเดต` chip above stays the design for approved users,
  where forcing a reload could discard in-flight work. Not yet built; U1's passive
  `AppVersionCheck` line on `/settings` is the interim signal.

## Verification

- U1: unit test asserts the card's warning, both platform lines, the anchor id,
  and that the rendered version string is the one passed in; settings-hub render
  test still green; design-doctrine + ui-class-contracts guards green.
- U2: unit test drives equal / mismatch / fetch-failure / dismiss.
- Real-flow: dev-preview login → `/settings` → expand the card; U2 verified by
  serving a mismatched `/api/health` version.
