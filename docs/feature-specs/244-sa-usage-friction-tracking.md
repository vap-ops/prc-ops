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

| #   | Decision                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Substrate = a NEW `public.interaction_events` table (ADR 0068 Tier B). **Never** `audit_log`.                                                |
| D2  | Audience v1 = **`site_admin` on the PWA/`/sa` surfaces.** Widen to other roles later.                                                        |
| D3  | Two outputs: (a) per-SA **needs-help list**; (b) per-screen **UX friction map**. Same data, two reads.                                       |
| D4  | Framing = **help, not surveillance** (protective, per ADR 0068 §5). PDPA-minimized. Offline-batched (field connectivity). Sampled + retention-capped. |
| D5  | Capture aggregate dimensions (counts, durations, route, event-type) — **not** full keystroke/content clickstreams.                            |
| D6  | Retention: raw events 30–90 days → daily rollups via `pg_cron` → drop raw. Not append-forever.                                               |

## 3. Data model

### 3.1 `public.interaction_events` (append-only, retention-managed)

| column        | type          | note                                                                 |
| ------------- | ------------- | -------------------------------------------------------------------- |
| `id`          | uuid pk       |                                                                      |
| `actor_id`    | uuid → users  | the SA (nullable pre-login)                                          |
| `actor_role`  | user_role     | denormalized for cheap role-scoped reads                             |
| `session_id`  | text          | client-generated per app session                                     |
| `event_type`  | text/enum     | `session_start`·`heartbeat`·`session_end`·`route_view`·`feature_touch` (U1); `rage_tap`·`form_abandon`·`validation_error`·`upload_fail`·`js_error` (U2) |
| `route`       | text          | normalized route (no ids in the path)                                |
| `context`     | jsonb         | minimized: `{wp_id?, duration_ms?, from?, to?, error_code?, net_type?}` |
| `app_version` | text          | for release-segmenting                                               |
| `client_ts`   | timestamptz   | device time (offline)                                                |
| `created_at`  | timestamptz   | server receive time (default now())                                  |

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
  the app is fully closed; screen-time = *foreground time we can see*, which is exactly
  the engagement signal wanted.
- **Batched + offline-safe:** events buffer in an IndexedDB queue and flush in batches to
  an ingest route; survives intermittent field connectivity (reuses the offline-upload
  posture, ADR 0039).
- **Sampling:** client-side per `event_type` (heartbeat coarse; skip scroll/hover/mousemove).
- **Ingest:** `POST /api/telemetry` (or an RPC) inserts via the user's RLS server client
  (own rows only). Feature-flagged.

## 5. Consumers (reads)

- **Needs-help list (per SA)** — a *struggle/health* read combining low engagement
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
- **U2 — friction capture on the core SA flow (photo capture → WP submit).**
  `rage_tap`, `form_abandon`, `validation_error`, `upload_fail`, `js_error` events on
  that flow.
- **U3 — needs-help list.** Per-SA struggle read + supervisor surface (protective copy).
- **U4 — UX friction map.** Per-screen friction ranking + a fix-list surface.

## 7. Out of scope (YAGNI — list, don't build)

Tier-A audit_log process mining (spec 240, shelved). Other roles beyond SA (v1 is SA
only). Full clickstream/keystroke capture. Gamification/levels/Nova. AI-agent substrate.
gsheet readout. In-app nudges to the user (v1 output is a **people list for a
supervisor**, per operator — the app does not act on the user). Surface as follow-ups.

## 8. Governance / risk

- **Danger-path:** U1 adds a table + RLS + `pg_cron` (migration) → operator-held under
  the fence; schema single-lane (claim in `LANES.md` with a migration ts).
- **PDPA / anti-surveillance (ADR 0068 §5):** minimized dimensions (no content/keystrokes);
  protective framing; retention windows enforced; subject self-mirror read. This monitors
  workers — the "help not surveillance" posture is mandatory.
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
