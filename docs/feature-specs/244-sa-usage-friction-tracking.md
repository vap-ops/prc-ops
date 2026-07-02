# 244 — SA usage & friction tracking (Tier B)

**Status:** design approved (brainstorm 2026-07-01), spec pending operator review → plan.
**Requires:** ADR **0068** (amended 2026-07-01 — Tier B first; this is the current implementing spec).
**Supersedes focus of:** spec 240 (Tier-A audit_log process-mining — SHELVED per the ADR amendment).
**Research:** `docs/research/usage-data-use-cases-2026-07.md`.

---

## 1. Purpose

Measure **real app usage and friction of on-site site-admins (SA)** — low-tech,
mobile-PWA, field users — to do two things:

1. **Find who needs help** → a per-SA "check on them" list a supervisor acts on
   (phone/visit, ask what's bothering them).
2. **Find where the UX hurts** → a ranked per-screen friction map, so we improve UX
   where it actually matters.

**Support + UX improvement. Not a scoreboard, not productivity ranking, not
fraud/process mining.** `audit_log` is the wrong substrate (it sees only completed
domain actions, never screen time / opens / confusion) — this is **client-side
session + friction telemetry** (ADR 0068 Tier B), the `interaction_events` table.

## 2. Locked decisions (from brainstorm)

| #   | Decision                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Substrate = a NEW `public.interaction_events` table (ADR 0068 Tier B). **Never** `audit_log`.                                                         |
| D2  | Audience v1 = **`site_admin` on the PWA/`/sa` surfaces.** Widen to other roles later.                                                                 |
| D3  | Two outputs: (a) per-SA **needs-help list**; (b) per-screen **UX friction map**. Same data, two reads.                                                |
| D4  | Framing = **help, not surveillance** (protective, per ADR 0068 §5). PDPA-minimized. Offline-batched (field connectivity). Sampled + retention-capped. |
| D5  | Capture aggregate dimensions (counts, durations, route, event-type) — **not** full keystroke/content clickstreams.                                    |
| D6  | Retention: raw events 30–90 days → daily rollups via `pg_cron` → drop raw. Not append-forever.                                                        |

## 3. Data model

### 3.1 `public.interaction_events` (append-only, retention-managed)

| column        | type         | note                                                                                                                                                    |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | uuid pk      |                                                                                                                                                         |
| `actor_id`    | uuid → users | the SA (nullable pre-login)                                                                                                                             |
| `actor_role`  | user_role    | denormalized for cheap role-scoped reads                                                                                                                |
| `session_id`  | text         | client-generated per app session                                                                                                                        |
| `event_type`  | text/enum    | `session_start`·`heartbeat`·`session_end`·`route_view`·`feature_touch` (U1); `rage_tap`·`form_abandon`·`validation_error`·`upload_fail`·`js_error` (U2) |
| `route`       | text         | normalized route (no ids in the path)                                                                                                                   |
| `context`     | jsonb        | minimized: `{wp_id?, duration_ms?, from?, to?, error_code?, net_type?}`                                                                                 |
| `app_version` | text         | for release-segmenting                                                                                                                                  |
| `client_ts`   | timestamptz  | device time (offline)                                                                                                                                   |
| `created_at`  | timestamptz  | server receive time (default now())                                                                                                                     |

- **RLS:** insert by `authenticated` (own `actor_id` only); select by **`super_admin`
  only** (v1) **and a subject may select its own rows** (self-mirror, PDPA). No user UPDATE/DELETE. Retention DELETE runs via service-role
  cron only — so this is **not** the `audit_log` triple-lock (it is retention-managed).

### 3.2 `public.usage_daily` (rollup, cron-refreshed)

Per (`actor_id`, `day`): `sessions`, `active` (bool), `screen_time_ms` (Σ foreground),
`opens`, `routes_touched`. Feeds **DAU** (distinct active users/day) and **per-SA
screen-time**. Small, kept longer than raw.

## 4. Capture mechanics (client)

- **Session + screen-time:** a lightweight client module emits `session_start` on app
  foreground, a `heartbeat` every N seconds while `document.visibilityState === 'visible'`,
  and `session_end` on `visibilitychange→hidden`/`pagehide`. Screen-time = Σ visible
  intervals. **Caveat (documented, not a blocker):** PWA/mobile can't observe time while
  the app is fully closed; screen-time = _foreground time we can see_, which is exactly
  the engagement signal wanted.
- **Batched + offline-safe:** events buffer in an IndexedDB queue and flush in batches to
  an ingest route; survives intermittent field connectivity (reuses the offline-upload
  posture, ADR 0039).
- **Sampling:** client-side per `event_type` (heartbeat coarse; skip scroll/hover/mousemove).
- **Ingest:** `POST /api/telemetry` (or an RPC) inserts via the user's RLS server client
  (own rows only). Feature-flagged.

## 5. Consumers (reads)

- **Needs-help list (per SA)** — a _struggle/health_ read combining low engagement
  (few sessions / low screen-time / lapsing) + high friction (U2 signals) +
  task-abandonment → a supervisor surface: "these SAs may need a check-in." Protective
  copy; **no ranking, no per-person score shown to peers.**
- **UX friction map (per screen/flow)** — ranked routes/flows by rage-tap /
  abandon / error / upload-fail rate → a fix-list for the team. Aggregate, not per-person.

## 6. Units (test-first; each its own session per repo workflow)

- **U1 — event pipe + session/screen-time (the smallest useful slice).**
  `interaction_events` table + RLS + retention scaffold; the client session module
  (`session_start`/`heartbeat`/`session_end`/`route_view`) batched + offline; the
  `/api/telemetry` ingest; `usage_daily` rollup + cron; a minimal read = **DAU +
  screen-time per SA**. Verifies real numbers from field users. pgTAP (RLS: own-insert,
  self-select, no cross-read, no user delete) + vitest (session module timing, batch
  flush) + a read test.
- **U1c — widen audience to all internal roles (operator 2026-07-01; code-only, no
  schema).** The table/RLS/rollup are already role-agnostic (the DB stamps
  `actor_role`; `usage_daily` is keyed by `actor_id`). Move the `TelemetryProvider`
  mount from `/sa` to the **root layout**, gated by a pure `isTrackableRoute()` that
  excludes unauth/external surfaces (`/login`, `/coming-soon`, `/client`, `/portal`,
  and the `/` dispatcher) so every INTERNAL staff role is captured while the external
  `client`/`contractor` portals are not. The `/settings/usage` read drops the
  `site_admin`-only filter → shows all internal roles with a role label; reads stay
  `super_admin`-only.
- **U2 — friction capture on the core SA flow (photo capture → WP submit).**
  `rage_tap`, `form_abandon`, `validation_error`, `upload_fail`, `js_error` events on
  that flow. **Sliced:** **U2a (2026-07-01)** = add the 5 friction values to the
  `interaction_event_type` enum (own enum-only migration) + wire the FIRST signal =
  **`js_error`** (a global uncaught-error/unhandled-rejection handler on the
  root-mounted tracker → the telemetry pipe; gated by `isTrackableRoute`,
  message-only + stack-stripped + capped 25/session). The other four
  (`rage_tap`/`form_abandon`/`validation_error`/`upload_fail`) are code-only
  follow-ups (U2b+) that reuse these enum values.
  - **U2b-1 (2026-07-01, code-only) = `upload_fail` on the offline photo-upload
    queue (ADR 0039).** First, the architectural gap: `trackError` was reachable only
    inside `TelemetryProvider` (which emits js*error from its own window handlers), so
    feature components could not emit friction. Added a module-level bridge
    `src/lib/telemetry/friction.ts` (`setFrictionSink(tracker|null)` +
    `trackFriction(type, context)`): the provider registers its live tracker on start,
    clears it on stop/leave; `trackFriction` no-ops when no tracker is active (before
    consent / non-trackable routes / external portals), mirroring the js_error gate.
    `UsageTracker.trackFriction()` is capped 50/session (separate from the js_error 25
    cap). \*\*Signal = the \_permanent* give-up:** the queue never drops items, so its only
    terminal state is `isAuthzDenied` (RLS/403 — never sends); a transient offline
    failure is a legitimate retry, **not\*\* a give-up, so it is excluded (emitting there
    would flood + mislabel field connectivity as friction). Pure
    `pickUploadFailures(items, currentUserId, reported)` returns own-user (ADR 0039
    attribution), permanently-denied, not-yet-reported items; the `UploadQueueRunner`
    emits `upload_fail {kind}` once per stuck item per session (deduped via a
    `reportedFailuresRef` Set). PDPA-min: aggregate `{kind}` only.
  - **U2b-2 (2026-07-01, code-only) = `validation_error` on the photo-capture flow.**
    A code scout reshaped the slice (transparent): the planned pairing with the
    WP-submit form doesn't map — `submit-for-approval-control.tsx` has **no
    client-side validation** (server-gated only), and the app-wide convention is
    manual `useState` + disabled-submit (no react-hook-form/zod). The one genuine
    client-side validation failure on the **core SA flow** is the photo-capture
    **unsupported-file-type rejection** (`use-phase-capture.ts` `handleFiles`:
    `preparePhotoForUpload()` returns null for a non-image MIME → the existing Thai
    top-level error + `continue`). Emit `trackFriction("validation_error",
{ reason: "unsupported_file_type" })` there — **PDPA-min: a stable reason code
    ONLY, never the file name/content**; the tracker stamps the route. One emit per
    rejected file (tracker's 50/session cap bounds a loop). `form_abandon` **deferred
    to U2b-3** (a different surface — the defect-report textarea — plus a dirty→leave
    lifecycle detector = its own unit).
  - **U2b-3 (2026-07-01, code-only) = `form_abandon` (a reusable hook + first
    adopter).** New reusable client hook `src/lib/telemetry/use-form-abandon.ts` —
    `useFormAbandon(formId)` → `{ markDirty, markSubmitted }`; on **unmount** it emits
    `trackFriction("form_abandon", { form: formId })` **iff `dirty && !submitted`**
    (refs, not state, so marking never re-renders the form). Adopter = the **feedback
    form** (`feedback-form.tsx`): a **full-page inline form** where unmount =
    navigate-away = the clean abandon moment, and the highest-value form to know
    abandonment for (a started-but-unsent report = a lost user voice). `markDirty()`
    on the title + body onChange; `markSubmitted()` on submit success. **The core SA
    flow (photo-capture → WP-submit) has NO fillable text form**, so form_abandon
    needs a real form. **The defect-report form is a `BottomSheet` (toggled by state,
    does NOT unmount on close) → deferred** as a follow-up adopter that needs a
    sheet-close variant of the hook. **PDPA-min: a stable form id ONLY, never the
    typed content.**
  - **U2b-4 (2026-07-01, code-only) = `rage_tap` — the LAST friction capture
    signal.** New pure detector `src/lib/telemetry/rage-tap.ts` —
    `RageTapDetector(threshold=4, windowMs=700)`; `.tap(target, ts)` returns true
    **once per burst** when N taps hit the **same target** within the window (a
    different target / elapsed window starts a new burst). DOM-free (target + ts
    injected) so it's unit-testable + tunable; conservative defaults so a
    double/triple-tap never fires. Wired in `telemetry-provider.tsx`'s trackable
    effect (like the js_error listeners): a fresh detector + a capture-phase `window`
    `pointerdown` listener → on detection `trackerRef.current?.trackFriction("rage_tap")`
    (no-op until the tracker starts; removed on cleanup). **PDPA-min: NO context —
    route only** (tracker-stamped), no coordinates/target text. Accepted tradeoff:
    rapid legit tapping (a +/- stepper) may false-positive; the friction map (U4)
    reads aggregate per-screen rates so genuine jank still surfaces, and thresholds
    are tunable. **▶ With U2b-4 the 5-signal friction vocabulary
    (`js_error`/`upload_fail`/`validation_error`/`form_abandon`/`rage_tap`) is fully
    captured — next are the READ surfaces U3/U4.**
- **U3 — needs-help list.** Per-SA struggle read + supervisor surface (protective copy).
  - **U3 (2026-07-01, code-only) SHIPPED as an enrichment of the existing super_admin
    `/settings/usage` per-SA read** (D3a — the per-SA output; the page was already the
    protective "who might need help" view). `summarizeUsage(rows, windowDays,
frictionByActor?)` folds each person's **friction count** (over the 14d window)
    into their row + a `totalFriction`, still **sorted by name** (no ranking, ADR 0068
    §5). The page adds a 3rd RLS read of `interaction_events` (the 5 friction types,
    within the window), counts per actor in JS, and shows a gentle friction count per
    person + total. **Aggregation: raw RLS read + JS count** — friction is low-volume
    and this is a rarely-loaded super_admin page, so no rollup/index at beta scale
    (documented partial-index + aggregation-RPC scale-up path). super_admin-only;
    counts only, no event content.
- **U4 — UX friction map.** Per-screen friction ranking + a fix-list surface.
  - **U4 (2026-07-01, code-only) SHIPPED** as a new super_admin page
    `/settings/friction-map` (D3b) ranking SCREENS by friction count (aggregate across
    all users). Pure `src/lib/usage/friction-map.ts`: `normalizeRoute` collapses uuid +
    numeric segments to `:id` (the tracker captures the raw pathname with ids);
    `buildFrictionMap` groups friction by normalized route → per-route total + per-type
    breakdown, ranked by total desc. Page reads `interaction_events` (5 friction types
    in the window) via the RLS session client + renders the ranked fix-list with
    per-type chips. **v1 = ABSOLUTE friction count per screen; a per-view RATE (÷
    route_views) is deferred** (needs the high-volume route_view denominator aggregated
    server-side — partial index + RPC/rollup). Raw RLS read + JS group-by (friction is
    low-volume; rarely-loaded admin page). super_admin-only; counts only.
  - **▶ spec 244 v1 is now COMPLETE**: capture (U1 session/screen-time + U2 five
    friction signals) + both read outputs (U3 per-person needs-help · U4 per-screen
    friction map).
- **U5 — per-person activity timeline (operator 2026-07-02: "I need detailed info
  down to individual's logged activities").** Drill-down from the needs-help list:
  tapping a person on `/settings/usage` opens `/settings/usage/[actorId]` — their
  last 14 days as a day-grouped SESSION timeline: when they opened the app, how long
  each session lasted, which screens in what order, and any friction inline. Data =
  the existing `interaction_events` raw window (90d retention) — **no new capture**.
  - **Aggregation = a new RPC** `get_actor_timeline(p_actor_id uuid, p_days integer
default 14)` (migration `20260813057000`, additive). Why an RPC: the raw slice is
    heartbeat-dominated (~1 row/20s foreground; a heavy user ≈ thousands of rows per
    14d), so a raw PostgREST read would truncate at the page cap — sessions are
    grouped server-side instead. **SECURITY INVOKER** — RLS scopes the read:
    super_admin gets any actor; a non-super caller gets only their own rows
    (self-mirror-compatible). EXECUTE granted to `authenticated`, revoked from
    `anon`/`public`. Per `session_id`: `started_at` = min(created_at),
    `last_seen_at` = max(created_at), `duration_ms` = heartbeat count × 20000 (the
    same screen-time proxy as `refresh_usage_daily`), `screens` = jsonb
    `[{route, at}]` of `route_view` events in order, `friction` = jsonb
    `[{type, route, at}]` of the 5 friction types in order. Window = `created_at >=
now() - p_days` days (p_days clamped 1..90); sessions returned newest-first.
  - **Page** `/settings/usage/[actorId]`: super_admin-only (`requireRole`), RLS
    session client (no admin client). Day-grouped (Asia/Bangkok display timezone),
    newest day first; each session card = start time + duration + the screen sequence
    (consecutive duplicates collapsed, routes normalized via `normalizeRoute`) +
    friction chips with time. Protective copy (help-not-surveillance, ADR 0068 §5) —
    this is a "see what happened so you can help" read, never a scoreboard. Live data
    (reads raw events, so no rollup-cron lag). `DetailHeader` back chip →
    `/settings/usage` (a dynamic-segment page, auto-classified DETAIL by the
    nav-back guard); the person rows on `/settings/usage` become links here.
  - **Labels SSOT:** the friction-type Thai chip labels move from the friction-map
    page into `labels.ts` (`FRICTION_EVENT_LABEL`) — used by 2 surfaces now
    (ui-term-consistency rule).
  - **PDPA:** renders route paths + event types + timestamps only; the `context`
    jsonb is NOT rendered (friction chips show type + time, not payload). Reads stay
    super_admin-only; a subject calling the RPC on themselves sees only their own
    data (RLS), consistent with the self-mirror posture.
  - **Tests:** pgTAP `255` (function exists · invoker RLS scoping: super_admin reads
    a target actor, a subject reads self, a subject gets ZERO rows for another actor
    · anon cannot EXECUTE · duration math = heartbeats × 20000 · started_at/last_seen_at
    = min/max · screens ordered incl. the same-created_at client_ts tiebreak ·
    friction included · empty result for an actor with no events) + vitest
    `actor-timeline` pure helpers (day grouping incl. a UTC→Bangkok day-boundary
    case, consecutive-screen dedup with counts, newest-first ordering; time
    formatting is DELEGATED to `formatThaiTime`/`formatThaiDate` — the labels.ts
    SSOT formatters, already unit-tested — so no new formatter exists here).
  - **Review fixes folded in (adversarial 4-lens verify + reviewer, same PR):**
    (1) migration `20260813058000` (CREATE OR REPLACE, never editing the applied
    `057000` — the recorded-history drift lesson): batched ingest gives every event
    in one flush an identical `created_at` (one multi-row INSERT), so the screens /
    friction jsonb now order by `created_at, client_ts` — without the tiebreaker a
    real A→B tap sequence could render reversed and the consecutive-dedupe could
    show a wrong ×count. Displayed `at` stays server-stamped `created_at` (≤ one
    flush late — accepted). (2) `formatScreenTime` rounded minutes to 60 without
    carrying ("1 ชม. 60 นาที"); minutes now round first then split into hours
    (reachable with real heartbeat multiples, e.g. 7,180,000ms). (3) the page
    throws to the error boundary when the RPC read fails for a REAL actor —
    a transient failure must not render the "no activity" empty state (a false
    claim about a person on a needs-help view); a malformed id still 404s.
    (4) session sort uses plain codepoint comparison, not localeCompare (ICU
    orders '.' before '+', inverting a fraction-less second vs a fractional one).
  - **Phase 2 (a separate spec, NOT this unit): business-action feed** — what the
    person DID (photos uploaded, WP submits, approvals, store moves), read from the
    DOMAIN source tables (`photo_logs`, `approvals`, …) — NOT audit_log
    instrumentation (spec 240 stays shelved). Needs its own scout + spec before
    build.

## 7. Out of scope (YAGNI — list, don't build)

Tier-A audit_log process mining (spec 240, shelved). ~~Other roles beyond SA~~ (U1c
widened capture to all **internal** roles, 2026-07-01; the external `client`/`contractor`
portals stay out of scope). Full clickstream/keystroke capture. Gamification/levels/Nova. AI-agent substrate.
gsheet readout. In-app nudges to the user (v1 output is a **people list for a
supervisor**, per operator — the app does not act on the user). Surface as follow-ups.

## 8. Governance / risk

- **Danger-path:** U1 adds a table + RLS + `pg_cron` (migration) → operator-held under
  the fence; schema single-lane (claim in `LANES.md` with a migration ts).
- **PDPA / anti-surveillance (ADR 0068 §5):** minimized dimensions (no content/keystrokes);
  protective framing; retention windows enforced; subject self-mirror read. This monitors
  workers — the "help not surveillance" posture is mandatory.
- **U2a `js_error` message text:** stores the error name + message only — stack **stripped**,
  ≤300 chars, capped 25/session. The message string may _incidentally_ carry app-generated
  text; accepted as the standard error-telemetry tradeoff, mitigated by no-stack + bounded +
  `super_admin`-only read + 90d retention. Revisit (hash/redact) if a message is found to leak PII.
- **Performance:** capture must not slow the SA PWA — coarse heartbeat, batched flush,
  sampling; measure that the module adds negligible main-thread cost.
- **DB lessons:** additive migration; RLS own-row insert + self-select + no cross-read;
  pgTAP `plan(N)` + 42501 + anti-join; rollup refresh idempotent.

## 9. Resolved (operator, 2026-07-01)

1. **Reads = `super_admin` only** (v1; widen later). The needs-help list + usage reads
   admit `super_admin` (plus each subject's own self-mirror row). No PM/PD access yet.
2. **Consent = a one-time in-app notice** ("we measure app usage to improve it and help
   you"), acknowledged once per SA. Legitimate-interest basis for operational support;
   revisit with legal if scope widens.
3. **Retention = 90 days** raw events (changeable later); daily rollups kept longer.
4. **Heartbeat = 20s** while foreground (CC decision — balances screen-time fidelity vs
   volume/battery on low-end field phones); coarser sampling for other high-frequency events.
5. **Audience WIDENED to all internal staff roles (2026-07-01, U1c).** v1 was
   `site_admin`-only (D2); the operator chose to capture every internal role, not just
   on-site SAs. External tiers — the `client` portal (`/client`, spec 234) and the
   `contractor` portal (`/portal`, ADR 0062) — stay **excluded**. Reads remain
   `super_admin`-only + subject self-mirror.
