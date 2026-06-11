# ADR 0034 — AppSheet sunset: procurement moves in-app; image bridge cancelled

**Status:** Accepted — 2026-06-11. **Amended same day — retirement is
now usage-driven ("atrophy model"), not scheduled; see Amendment.**
Source: `docs/architecture-revision-2026-06.md` §3.1 + §6; operator
granted decision authority in chat ("you are allowed to make the
calls").

## Context

AppSheet is the procurement back office (ADR 0018/0025), coupled raw to
the production schema via the `appsheet_writer` DB role. Recurring
costs observed in production use: manual column configuration per
schema change (saves break until done — two blocking TODOs were open
when this was decided), a manual Tier-2 smoke ritual per change, one
production incident (EMAXCONNSESSION pooler exhaustion, 2026-06-11),
per-user licence fees, and a planned unit (ADR 0029 image bridge) whose
only purpose was to deepen the coupling. Meanwhile the app already has
the hard part: ADR 0025's derive trigger converts purchase/delivery
facts → status regardless of writer, and the `procurement` role has
been in the enum since ADR 0008.

## Decision

1. **The ADR 0029 AppSheet image bridge is CANCELLED** before being
   written or built. The number 0029 stays reserved/unused. The
   capability-token table that shipped with spec 23 stays in place —
   it is the natural seam for a future crew capability-URL feature
   (architecture-revision §3.6), not for AppSheet.
2. **Purchase/delivery fact-writing moves in-app** (next feature units
   after spec 32): forms gated to `procurement`/`super_admin`, writing
   the same fact columns AppSheet writes today. Write mechanism
   (SECURITY DEFINER RPC vs RLS policies) is decided in that unit's
   ADR, amending ADR 0025.
3. **The suppliers table ships in-app from day one** — it is never
   added to AppSheet.
4. **No further AppSheet column additions or grants.** New facts/
   columns are in-app-only from now on.
5. After the in-app surface reaches write parity, **AppSheet is demoted
   to read-only viewer** (write grants revoked from `appsheet_writer`),
   then retired when the operator stops using it. Revocation is its own
   migration + checklist update. _(Superseded by the Amendment below:
   demotion is no longer automatic at parity.)_

## Amendment — 2026-06-11 (atrophy model)

Operator asked for a pros/cons weighing of the hybrid before
retirement; the evidence pass (chat, 2026-06-11) showed the hybrid is
sounder than the original urgency credited: AppSheet writes only 9
fact columns on one table, the derive/audit/notification triggers are
writer-agnostic (spec 24's dual delivery path + spec 32's capture
triggers already treat multiple writers as normal), and the grid/bulk
entry surface may have real value at back-office volumes nobody can
quantify yet. Operator could not determine the volume question and
delegated the call.

**Revised posture — retirement by atrophy, not by decree:**

- Points 1–4 above stand unchanged (bridge cancelled, in-app
  procurement surface gets built, suppliers in-app only, AppSheet
  column set frozen).
- **Parity does NOT auto-demote AppSheet.** Once the in-app
  purchase/shipment form ships, both write paths coexist — the
  architecture already supports this safely.
- **The volume question answers itself by measurement:** every fact
  write records its principal in `audit_log` (`appsheet_writer` vs the
  app path). Demote to read-only when the in-app share of
  purchase/delivery fact-writes stays ≳80–90% over several consecutive
  weeks — or immediately on a forcing event: a second customer signs
  (instance-cloning cost) or another AppSheet-caused outage.
- The three currently-open AppSheet column TODOs are cleared once
  (saves are broken until then regardless of this ADR).
- If usage shows back office genuinely prefers the grid (batch entry),
  a future in-app bulk/table-entry mode is the answer — specced then,
  not preemptively.

## Consequences

- Operator stops paying the per-schema-change configuration tax and
  the Tier-2 _write_ smoke ritual once parity lands (read smoke remains
  while AppSheet is a viewer).
- The two currently-open AppSheet column TODOs (pr_number/cancellation
  read-only marking; shipped_at exposure) remain necessary until
  parity — AppSheet is still the write path today.
- `appsheet_writer` role, its grants, and the `_appsheet` views remain
  untouched until the parity unit; this ADR changes direction, not
  current behavior.
- The go-live checklist's AppSheet sections gain a sunset note when the
  parity unit ships.
