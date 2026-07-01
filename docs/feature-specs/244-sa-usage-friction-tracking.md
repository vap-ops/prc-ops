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
    failure is a legitimate retry, **not** a give-up, so it is excluded (emitting there
    would flood + mislabel field connectivity as friction). Pure
    `pickUploadFailures(items, currentUserId, reported)` returns own-user (ADR 0039
    attribution), permanently-denied, not-yet-reported items; the `UploadQueueRunner`
    emits `upload_fail {kind}` once per stuck item per session (deduped via a
    `reportedFailuresRef` Set). PDPA-min: aggregate `{kind}` only. ▶ next: **U2b-2**
    `validation_error` + `form_abandon` on the WP-submit + photo forms; **U2b-3\*\*
    `rage_tap` (global rapid-repeat-tap heuristic).
- **U3 — needs-help list.** Per-SA struggle read + supervisor surface (protective copy).
- **U4 — UX friction map.** Per-screen friction ranking + a fix-list surface.

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
