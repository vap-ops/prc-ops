# Spec 287 — `/api/health` liveness probe

**Status:** in progress (v1 wrap Sprint 2 U1)
**Source:** v1 GA gap register **G5** (no health / uptime probe — incident response is
"read three dashboards") · v1 wrap-up Sprint 2 ("see failure before users do").

## Problem

Nothing external can tell whether the deployed app is actually serving. An uptime
monitor (UptimeRobot / BetterStack / Vercel) needs a cheap, unauthenticated endpoint
to poll so a hard-down deploy pages someone instead of being noticed by a user.

## Decision

A single `GET /api/health` route handler returning HTTP **200** with a small JSON body:

```json
{ "status": "ok", "version": "<pkg.version>", "timestamp": "<ISO instant>" }
```

- **Liveness only.** No DB, no service-role client, no auth — so it stays **off the
  danger-path**, can be polled anonymously, and adds zero attack surface.
- `version` = `pkg.version` — the same source spec 246 stamps into feedback/telemetry
  (`src/app/feedback/actions.ts`) — so one poll also answers "which build is live?".
- `timestamp` = current ISO instant.
- `export const dynamic = "force-dynamic"` — the probe must reflect the live process,
  never a statically-cached response.

## Scope

- **IN:** the route handler, its unit test, this spec.
- **OUT (later units / operator):** DB/readiness checks (pull in the service-role
  client → danger-path), worker heartbeat, the uptime-monitor configuration itself,
  authentication.

## Verification

- `pnpm test tests/unit/health-route.test.ts` — green (seen red first).
- `pnpm lint && pnpm typecheck && pnpm test` — all green.
- Real-flow: `curl -s localhost:3000/api/health` on `pnpm dev` → `200` +
  `{"status":"ok","version":…,"timestamp":…}`.
