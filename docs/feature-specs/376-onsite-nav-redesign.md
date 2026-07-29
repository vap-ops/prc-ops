# Spec 376 — On-site nav redesign (SA · technician · DC workers · storekeeper hat · site owner)

**Status:** approved in chat 2026-07-30 (operator picked scope + all four decisions below).
**Origin:** operator 2026-07-30 — _"redesign nav system for on site users"_, the on-site
sibling of spec 349 (accounting nav). Scope chosen by the operator from the cohort list:
**site_admin · technician · DC workers (no login) · Storekeeper · Site Owner**.

---

## 1. Evidence (all live, measured 2026-07-30)

### 1.1 Who is on site

| Cohort | Users (active 14d) | Nav today |
| --- | --- | --- |
| site_admin | 6 (5) | 5 tabs at the ceiling: หน้าหลัก `/sa` · โครงการ `/projects` · ทีมงาน `/team` · จัดซื้อ `/requests` · ตั้งค่า |
| technician | 13 (7) | **No tab bar** (`tabsForRole` → null). One long scroll page `/technician` |
| ช่าง without a login | 17 of 31 `workers` rows unbound (roster = 28 PRC-daily "DC" + 3 subcon-tied; 14 bound) | Printed QR badge only |
| storekeeper | — not a role (17-value `user_role` enum has none) | — |
| site_owner | role exists, **0 users** | `roleHome` falls through to `/coming-soon` |

### 1.2 Where the traffic actually goes (route_view, 14d)

- **site_admin (5 users, ~5,700 views): ~4,000 live under the project world** — WP detail
  **2,386** · project hub **930** · `/projects` **448** (inflated by the U4 redirect double-log,
  the #846 lesson) · incoming **90+63** · muster **84** · store **11**. Then `/requests`+PR/PO
  detail ≈ **373** · `/team*` ≈ **252** · `/settings` **39**.
- **technician (6 active users): `/technician` = 13 views in 14 days.** The portal has no pull;
  the cohort's real daily touchpoint is their QR badge at morning muster (17/18 scans by QR on
  2026-07-26). Nav ordering is necessary but not sufficient here — the money/attendance pull is
  feature work, tracked elsewhere (spec 369 U1/U2 unlock, spec 374 sibling view).

### 1.3 Verified plumbing facts

- `saProjectsLandingTarget` (spec 313 U4) redirects a site_admin from `/projects` to
  `projectHref(currentProjectId)`; the tab href itself is static `/projects` **by that spec's
  own design**. The redirect double-logs route_views (one tap = two events) — that artifact is
  what produced the refuted #846 "395-visit leak".
- `can_see_project` (live body read 2026-07-30): `site_owner` sits in the **membership arm**
  (`project_members` row or `project_lead_id`), same as site_admin/PM. DB visibility for a
  site-owner home exists today; what does not exist is a roleHome, a tab set, and page-gate
  admission on the project surfaces (gate-check per page at build — `requireRole` sets are
  app-side and were NOT audited in this spec).
- `SA_TABS` / `PM_TABS` / `tabsForRole` live in `src/components/features/chrome/bottom-tab-bar.tsx`
  (client component, static constants consumed by the nav-law guards); hub strips in `hub-nav.tsx`;
  landing in `src/lib/auth/role-home.ts` (danger path).

## 2. Decisions (operator, 2026-07-30 chat)

- **D1 — Storekeeper is an SA hat, not a role — today.** No enum change, no new user. The
  redesign surfaces store work (รับของ · คลัง · เบิก · นับสต็อก) as one visible cluster inside
  the SA's project world. (คลัง = SA custody per doctrine; store-first directive unchanged.)
  **Forward-compat (operator 2026-07-30): storekeeper may become a real role later.** So U2
  gates the cluster through the store surfaces' EXISTING named gates/role sets — never an
  inline `role === "site_admin"` literal — and the cluster's doors point at the existing
  routes, so a future `storekeeper` enum value is a role-set add + tab set, not a rework.
- **D2 — Site Owner = site-oversight home.** Read-mostly view of their site: WP status, teams
  today, photos, issues. **This revises the parked spec 313 U6**: the site_owner half of U6
  (roleHome → `/expenses`) is superseded by this spec; the **auditor half of U6 stays parked
  and is untouched here**. Money surfaces stay reachable, not the landing.
- **D3 — Technician gets a real bottom tab bar** (operator chose this over the one-page
  reorder alternative): หน้าหลัก · ประวัติ · โปรไฟล์. The middle tab was proposed as เงิน;
  operator rejected the money word and picked **ประวัติ** (over ค่าแรง/รายได้) — no money
  term on a worker's screen. ⚠️ ประวัติ already names the WP-detail timeline tab (spec 363),
  a different sense on a different audience's surface — recorded as an accepted D4 exception;
  both label sites single-source from `labels.ts`.
- **D4 — SA keeps her 5 tabs; no reshuffle.** The redesign fixes seams (D5, U1, U2), it does
  not move tabs. เช็คชื่อ stays under ทีมงาน + the muster cockpit (313 U1 already did the move).
- **D5 — the no-login ช่าง cohort's "nav" = the printed-QR entry map**, not screens. One
  documented map of every QR landing + the one known entry bug (shared-phone register QR,
  §3.4). **Clarified with the operator: these are the SAME people as the technician cohort,
  pre-login** — a `workers` row without a `user_id` binding (17 of 31 today). The register QR
  is the bridge: scanning it turns a badge-only ช่าง into a `technician` user, so U4's
  interstitial is also the on-ramp guard for U3's audience.

## 3. Design per cohort

### 3.1 site_admin

**U1 — โครงการ tab resolves straight to her project hub.** Replace the tab-path redirect hop
with a server-computed href: the app layout (which already knows role) resolves the SA's
current project and hands `BottomTabBar`/`HubNav` a per-user โครงการ href
(`/projects/:id`); the tab's `match` keeps `/projects` so lighting still covers the full
project world and the `?view=all` hub. The `/projects` redirect itself **stays** (other doors
into the hub still funnel), but the tab — the high-frequency path — stops paying the RSC
round-trip and stops double-logging telemetry.
⚠️ Build traps: `SA_TABS` is a static constant pinned by `nav-law-strip-superset` and the
lighting tests — a dynamic href needs the guard reworked deliberately, never weakened; the
strip (rule 2) must carry the same resolved destination; 0-project SA falls back to `/projects`
(the resolver's own null branch).

**U2 — the storekeeper cluster on the project hub.** One grouped คลังหน้างาน section on
`/projects/:id`: รับของ (incoming deliveries — 153 views/14d, this IS the storekeeper's real
work) · คลัง (store, on-hand + equipment view) · นับสต็อก. เบิก stays on `/sa` (the 375 U3
custody pair — actions live where the actor starts; the destinations live here). Rejected
alternative in §5. Labels from `labels.ts` SSOT (`STORE_LABEL` = คลัง exists — check every new
term against it).

### 3.2 technician (D3)

**U3 — `TECHNICIAN_TABS` + route split.** Today `/technician` is one Server Component stacking
e-card, QR, assigned work, wage, bank, consents, receipts. Split:

- **หน้าหลัก `/technician`** — QR badge card first (the daily physical artifact), then the
  spec-350 assigned-work card, then the e-employee card.
- **ประวัติ `/technician/history`** (new route) — wage history, receipts, bank, pending-bank.
  Moves the `WorkerPortalSections` money half. Label per D3 (operator: not เงิน).
- **โปรไฟล์ `/profile`** — already exists for all authed users (carries the QR too); the tab
  claims it (`tabsForRole` currently returns null for technician, so no lighting conflict).

`tabsForRole("technician")` returns the new set; nav-law guards gain the role's cases
(strip-superset: technician needs a `hubNavForRole` arm too — desktop parity, rule 2).
⚠️ The move must not orphan any section currently on the page (the §2 "half that removes a
signal" rule): every section keeps exactly one home across the two routes.

### 3.3 ช่าง without a login (D5)

**U4 — QR entry map + the shared-phone fix.**

- Spec section (this doc, §6) = the canonical map of printed-QR landings: badge QR → muster
  scan (SA's cockpit reads it) · register QR → `/register` onboarding · contractor poster QR
  (spec 365) → poster page. Any new printed QR must add a row here.
- The one live entry bug, already on the owed list: **a register QR scanned on a shared phone
  carrying someone else's session lands in that account with no form and no explanation**
  (real 328-pilot risk). Fix = a lightweight interstitial on the register landing when a
  session exists AND the session's identity ≠ a fresh registrant: name whose session this is +
  ออกจากระบบเพื่อสมัคร button. Code-only.

### 3.4 site_owner (D2)

**U5 — landing + tabs, no new page.** The project hub already IS the site dashboard (WPs,
photos, teams, schedule). So:

- `roleHome("site_owner")` → resolver like the SA's: single project (via `project_members` /
  `project_lead_id`) → `/projects/:id`; zero projects → `/projects` hub (safe empty).
- `SITE_OWNER_TABS = [โครงการ /projects, ตั้งค่า]` (the COORDINATOR_TABS shape) +
  `hubNavForRole` arm — never promote a role's home without its chrome (the 313 U6 lesson ①).
- **Page-gate audit is part of the unit:** enumerate every `/projects/:id/*` surface's
  `requireRole`/gate set and decide admit-vs-refuse for site_owner explicitly (read surfaces
  admit; write affordances stay out — read-mostly by D2). An inherited "DB already allows it"
  is not page admission.
- Onboarding note: a site_owner user needs a `project_members` row (or lead) or every project
  read returns empty — the resolver's zero-project branch is the guard, and the /team add
  picker already offers site_owner (`PROJECT_TEAM_STAFF_ROLES`).
- ⚠️ Not browser-verifiable via view-as unless `site_owner` joins `ASSUMABLE_ROLES` (own
  `src/lib/auth/**` decision, same blocker 313 U6 recorded). Verify with a throwaway user or
  pin by guards + gate tests.

## 4. Units (each = one ship-unit PR; order = value)

| Unit | What | Files (indicative) | Risk |
| --- | --- | --- | --- |
| U1 | SA โครงการ tab direct-resolve | `bottom-tab-bar.tsx` · `hub-nav.tsx` · app layout · `projects-landing.ts` · nav guards | ⚠️ nav SSOT, guard rework |
| U2 | Project-hub คลังหน้างาน cluster | `projects/[projectId]/page.tsx` (hub body) · `labels.ts` | low |
| U3 | Technician tab bar + `/technician/history` split | `bottom-tab-bar.tsx` · `hub-nav.tsx` · `technician/**` · nav guards | medium |
| U4 | Shared-phone register interstitial + QR map | `register/**` landing | low |
| U5 | site_owner roleHome + tabs + page-gate audit | `role-home.ts` (**danger**) · `bottom-tab-bar.tsx` · `hub-nav.tsx` · project page gates | ⚠️ danger-path, operator-merge |

U1 and U3 both touch `bottom-tab-bar.tsx`/`hub-nav.tsx` — serialize (U1 first). U5 is
independent but danger-held.

## 5. Rejected / refuted (do not re-propose)

- **A 6th SA tab (or a swapped tab) for คลัง** — 5-tab ceiling is law; store = 11 views/14d
  does not out-rank any incumbent. The hat is surfaced inside the project world (U2).
- **Technician option A (one page, section chips)** — presented with rec, operator chose B.
- **A new site-owner dashboard page** — the hub is the dashboard; a parallel page would fork
  the WP list surface.
- **SA home project card** — shipped #846, **reverted #849**, operator: redundant with the
  bottom bar. U1 is the sanctioned form of that intent.
- **"395 visits leak to /projects"** — refuted 2026-07-30; an RSC redirect logs origin AND
  destination, one tap = two events. Never read consecutive route_views as taps without
  checking for `redirect(`.

## 6. Printed-QR entry map (canonical, D5)

| QR artifact | Lands | Session state handled? |
| --- | --- | --- |
| Worker badge (printed / digital) | Muster cockpit scan — payload `workers.id`, no navigation on the worker's own phone | n/a (SA's device scans) |
| Register QR (site poster) | `/register` onboarding | ⚠️ U4 — stale foreign session shows the interstitial |
| Contractor poster QR (spec 365, `/team/poster?...`) | Registration pre-bound to the firm | same interstitial (U4 covers both) |
| Equipment item QR/NFC (spec 370) | `/equipment/scan?item=<uuid>` | gated `EQUIPMENT_MOVE_ROLES` (SA device) |

## 7. Acceptance (fill-rate queries, not green suites)

- U1: site_admin `route_view` on bare `/projects` collapses to ~`?view=all` traffic only
  (today 448/14d, mostly redirect echo).
- U3: `/technician*` views move off 13/14d; the ประวัติ route registers > 0 within a week of
  a wage payment landing.
- U4: zero repeat of the "logged into someone else's account" report class at the next
  onboarding batch.
- U5: once the first site_owner user exists — session_start → `/projects/:id` reaches, and
  every project read returns rows (membership row present).

## 8. Build-time traps carried from the doctrine

`labels.ts` = SSOT for every new Thai term (additive, serialize with any live lane) ·
shared constants for tab hrefs must live in leaf modules (no `server-only` — the #817 RSC
lesson) · every nav unit updates `nav-law-strip-superset` + `nav-back-affordance` +
site-map.md **deliberately, never weakens** · prose that instructs users (help cards touched
by U3's split) gate-checks against the component at build · re-measure every number in §1
at each unit's ship gate (the metrics WILL move — U1 itself changes the §7 baseline).
