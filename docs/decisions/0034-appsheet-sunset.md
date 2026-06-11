# ADR 0034 — AppSheet sunset: procurement moves in-app; image bridge cancelled

**Status:** Accepted — 2026-06-11. Source:
`docs/architecture-revision-2026-06.md` §3.1 + §6; operator granted
decision authority in chat ("you are allowed to make the calls").

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
   migration + checklist update.

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
