# ADR 0068 — App usage tracking & user leveling (two-tier capture)

**Status:** Proposed (2026-07-01)
**Extends:** 0004 (audit trail & immutability), 0049 (AI feature governance), 0051 (external partner access / PDPA posture)
**Spec:** `docs/feature-specs/240-usage-tracking-tier-a.md` (Tier-A v1)
**Research:** `docs/research/usage-data-use-cases-2026-07.md` (use-case catalog, cost, gsheet decision)

## Context

The operator wants to **track user app usage / interactions** and later **evaluate
user "levels"** — and, more broadly, open up the many things usage data enables
(process bottlenecks, financial controls, worker-welfare signals, the per-dept AI
agent substrate). The request is explicitly *gather-first*: capture interactions,
then derive consumers.

`audit_log` (ADR 0004) already records **server-side domain mutations** — login,
photo_upload, approve/reject, export, insert/update/delete — with actor, role,
target, payload, and `client_ts`. It does **not** record fine-grained UI behavior
(navigation, search, form steps, errors, dwell).

A 10-lens fan-out produced ~30 distinct purposes (see research note), which split
cleanly on one axis: what is derivable from `audit_log` **today** vs what needs a
**new** UI/session event stream. That axis drives the architecture.

## Decision

1. **Two tiers, built in order.**
   - **Tier A — derived analytics over the existing `audit_log`.** No new capture,
     ~฿0 marginal cost, low PDPA risk. Process-instance views (stitch rows by
     `target_id`/`target_table` into ordered lifecycles), `pg_cron`-refreshed rollup
     tables, surfaced in-app + via the existing Telegram channel. **Build first.**
   - **Tier B — a new generic `interaction_events` table** for UI/session telemetry,
     built **only once a Tier-A win earns it.** One generic append-only event table
     (actor, role, session_id, event_type, route, context jsonb, app_version,
     client_ts, created_at) behind a feature flag — **not** a bespoke pipe per
     purpose.

2. **Telemetry is separate from `audit_log` — never bolted onto it.** `audit_log`
   stays the legal/forensic SSOT for domain mutations: clean, append-forever, the
   ADR-0004 triple-lock. High-volume, lower-stakes UI events live in their **own**
   table with their **own** retention, sampling, and RLS. Conflating them pollutes
   the audit trail and inflates its size/cost.

3. **Tier-B retention, not append-forever.** Raw events live 30–90 days, roll up to
   daily aggregates via `pg_cron`, then raw is dropped. RLS: insert by
   `authenticated`; select by analyst roles only; **a subject may read its own rows**
   (self-mirror / PDPA). Retention deletes run via the service-role cron — so this is
   deliberately **not** the `audit_log` triple-lock.

4. **"Levels" are a derived consumer, not the capture layer.** A recomputable rollup
   reading `audit_log` (+ later `interaction_events`) + outcomes (approvals, rework).
   **Rate-based, never raw counts, never speed** (binds to the firm's own
   gamification research). The four lenses — proficiency (worker-dev), engagement
   state (adoption), the opt-in private "ผลงานของฉัน" surface (gamification), and a
   trust score that *suggests* access bumps (access-progression) — all read this
   rollup. Levels are **out of scope for Tier-A v1.**

5. **Governance (binding).**
   - **Anti-surveillance / electronic-whip:** never derive a per-person
     speed/volume/productivity score (a documented field-safety anti-pattern).
     Fatigue / lone-worker / overload purposes are framed **protective** ("check this
     person is OK") and routed to a welfare owner, never a ranking.
   - **Self-governance:** surface capture to the **subject first** (self-mirror)
     before any manager — PDPA transparency-by-design; lives the "designed for us"
     doctrine.
   - **PDPA minimization & consent:** capture the minimum dimension per purpose
     (aggregate counts/timings, not full clickstreams); attach consent/opt-out state
     to behavioral traces, especially anything fed to an AI model (training-data
     provenance). Read-side PII view-logging (DSAR ledger) is scoped to PII tables
     only — never a blanket read log.

6. **Phasing.** (1) audit-coverage patch — verify/emit missing `audit_log`
   transitions; (2) Tier-A views + rollups + cron; (3) readout (in-app worklist +
   Telegram digest); (4) prove value → the gate to Tier B; (5) `interaction_events`
   (flag-gated); (6) levels layer.

## Consequences

- **Tier-A v1 (spec 240) carries no new capture and ~฿0 cost** — derived SQL +
  `pg_cron` + read surfaces. Its one real precondition is **audit-log emission
  coverage**: some state transitions (e.g. receive→stock_in) may not currently write
  an `audit_log` row; this must be audited and patched (spec 240 U1) before
  process-instance views are reliable.
- **`interaction_events` (Tier B) is danger-path-adjacent** (new table, RLS, consent,
  AI-training provenance) and is held until pgTAP + a proven Tier-A win justify it.
- **Open sub-decision (operator/legal):** consent basis for behavioral capture —
  opt-in vs legitimate-interest. Operational/security telemetry may be
  legitimate-interest; behavioral/AI-training likely needs opt-in. Not v1-blocking.
- **Out of scope (YAGNI; surface as follow-up specs):** the Tier-B table itself, the
  levels layer, the AI-agent substrate consumers, the gsheet readout, per-PII
  read-ledger. This ADR commits only to the **capture architecture + Tier-A-first
  sequencing**, not to building every catalogued purpose.
