# Making PRC Ops feel like an app — options & recommendation (2026-06-11)

**Operator question:** "The app doesn't feel a lot like an app yet,
because it uses a browser — how do we take care of that? Not sure if
LINE Mini App will solve the problem."

**Short answer:** the "browser feel" and the "reach/login friction" are
two different problems. A **PWA install** (small work, ~1 day + device
testing) is what removes the browser chrome and puts a real icon on the
phone. A **LINE Mini App** does NOT remove the app-in-a-browser feel —
it moves the app _inside LINE_ (LINE's own header bar, with our domain
shown under the title until verified) — but it gives **zero-login
access** from LINE chats and rich menus, which is its own big win for
staff who live in LINE. They complement each other; neither replaces
the other. Store wrapper apps are not worth it for this team.

All facts below verified against official sources June 2026 (three-agent
research pass; sources in the research notes).

## Option 1 — PWA install (recommended first, iteration 5)

What users get: a real icon on the home screen; the app opens
**full-screen with no URL bar**, with a splash screen — on Android it
is literally installed as an APK (WebAPK). This is the direct fix for
"feels like a browser."

- Work: `app/manifest.ts` (built into Next.js), 192/512px + 180px
  icons, theme color, a minimal service worker (Android's install
  prompt still wants one). Roughly a one-day PR.
- iOS: no automatic prompt — users add via Share → "เพิ่มลงหน้าจอโฮม"
  once (a 30-second guided step at onboarding). iOS 26 (shipped fall 2025) now opens ANY home-screen site as a web app by default, which
  makes this path stronger than it's ever been.
- Login: LINE OAuth inside an installed PWA works (our cookies are
  first-party, set by our own server). Known iOS quirk: the LINE
  consent page opens in an in-app sheet and users may re-login once
  (PWA cookies are separate from Safari's). **Must be device-tested on
  a real iPhone before telling staff to install.**
- Caveat: a PWA **cannot be installed from LINE's in-app browser**.
  Links shared in LINE chat open in LINE's browser; appending
  `?openExternalBrowser=1` to links we send forces the real browser
  (official LINE URL scheme). Install instructions should use that.
- Push notifications: possible on installed PWAs (iOS 16.4+), but see
  Option 3 — LINE messages are the better channel for this team.

## Option 2 — LINE Mini App (yes, but for reach — not for app-feel)

A LINE Mini App is technically our same web app + the LIFF SDK
(`liff.init()`), registered on a Mini App channel. As of **2026-03-11
Thailand allows anyone to publish UNVERIFIED Mini Apps** (link-only
distribution: `https://miniapp.line.me/{liffId}`, QR, rich menu).

What it solves:

- **No login screen at all** — inside LINE the user is already
  authenticated; `liff.getIDToken()` hands us a LINE id_token our
  server already knows how to verify (same verify endpoint we use
  today). Integration cost is modest: accept the Mini App channel's ID
  as a second token audience, and **create the channel under our
  existing provider** so user IDs stay identical.
- Instant reach: tap from a chat message or the OA rich menu → app
  opens, already logged in.

What it does NOT solve:

- It opens **inside LINE** with LINE's native header (title + mandatory
  action button + close): it feels like a LINE service, not a
  standalone app. Unverified apps additionally show our raw domain
  under the title.
- **Home-screen shortcut, service messages (free push), and LINE
  search/Services listing require VERIFIED status** — and for Thailand
  verification is only open to channels under a **certified provider**
  (Thai DBD company certificate, TAX ID, matching legal-entity docs;
  ~5–7 business days for certification, then ~1–2 weeks review, no
  fee documented).
- LY Corp is folding LIFF into the Mini App brand (announced
  2025-02-12) — any new LINE integration should target a Mini App
  channel, not a legacy LIFF app.

## Option 3 — LINE notifications + rich menu (the notification channel)

Regardless of 1/2: the OA **rich menu** (free, up to 20 tap areas) is a
zero-cost launcher for site staff, and **Messaging API pushes** can
deep-link into the app/Mini App already-authenticated. Thailand OA
pricing: Free plan 300 msgs/mo; Basic 1,280 THB/mo for 15,000 (+0.10
THB each beyond). At ~50 staff × 2 work notifications/day ≈ 2,200
msgs/mo → Basic plan ≈ 1,280 THB/mo. ≤10 users can fit the free tier.
This is the natural future home of "งานใหม่รอตรวจ" / "คำขอซื้อได้รับการ
อนุมัติ" notifications (a future spec; needs the Messaging API channel

- user opt-in via the OA).

## Option 4 — real store apps (NOT recommended)

Apple rejects thin web wrappers (Guideline 4.2 "beyond a repackaged
website"); Capacitor's remote-URL mode is explicitly "not for
production." Google Play needs an org account (D-U-N-S) or a 14-day
12-tester gauntlet on personal accounts. Private distribution (managed
Play / Apple unlisted / ABM) is administratively disproportionate for
10–50 BYOD phones at a Thai contractor. Revisit only if the app someday
needs deep native features.

## Recommended sequence

1. **Iteration 5: ship the PWA** (manifest, icons, theme color, minimal
   SW) + a one-page Thai install guide (with the
   `?openExternalBrowser=1` escape) + real-iPhone test of the LINE
   login round-trip in standalone mode.
2. **When notifications are wanted:** LINE OA rich menu + Messaging API
   deep links (Basic plan ~1,280 THB/mo at full scale). Target a Mini
   App channel (unverified) at the same time so taps open zero-login.
3. **In parallel (paperwork, no code):** start LINE **certified
   provider** registration with the company's DBD documents — it
   unlocks verified Mini App status (home-screen shortcut, free service
   messages, no domain subtext) whenever we want it.

## Operator decisions needed (none block iteration 5)

- Approve the PWA unit (icons need a logo/brand mark — or I generate a
  simple "PRC" mark as placeholder).
- Whether/when to start certified-provider paperwork (needs company
  DBD certificate + TAX ID).
- Notification appetite (drives the OA plan cost: free ≤300 msgs/mo vs
  1,280 THB/mo Basic).
