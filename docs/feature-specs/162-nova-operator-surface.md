# Spec 162 — Nova operator surface

The first **visible Nova surface**. Stage 0 + spec 161 built the coin ledger
([spec 160](160-worker-ecosystem-foundation-stage-0.md) U2: `coin_postings` /
`coin_balance` / `post_coins`) and the economics dials — all backend, invisible. This
spec makes Nova real on screen, starting **operator-side** (the settings hub already
carries a HELD "Nova" coming-soon row).

**Operator-only for v1.** Coins are `super_admin`-read (RLS), **invisible to external
DCs** (ADR 0060 §4), and ADR 0061's **gift-first** rule says a worker's first Nova
experience must not be the opaque coin. So the worker-facing Nova waits; this is the
operator's Nova **console**.

## U1 — `/nova` operator console (THIS unit)

A `requireRole(["super_admin"])` page that makes the ledger tangible: see every
worker's coin balance, the recent postings, and **award** coins (so the operator can
create the first Nova activity now, before the automatic earn-rules of spec 161
U5/U6 exist).

- **`/nova` page** (Server Component, `super_admin`): reads via the RLS server client
  (the super_admin session sees all `coin_postings`). Two reads batch — active
  `workers` (id, name, level) + `coin_postings` (id, worker_id, source, amount,
  reason, occurred_at, newest first). Derives **per-worker balances** (group + sum)
  and the **recent ledger** in JS. Empty state until the operator awards.
- **`awardCoins(workerId, source, amount, reason)` server action** — `super_admin`
  only (validates shape + role, then calls the `post_coins` RPC, which is itself
  super_admin-gated); maps errors to Thai; `revalidatePath('/nova')`.
- **`NovaAwardForm`** client component — worker picker + source picker
  (`coin_source`, default `behavior_bonus` — discretionary recognition) + amount +
  reason → `awardCoins`. **Note (anti-favoritism, ADR 0060 §5):** a manual award is
  discretionary; it is the operator's **interim** recognition tool. The
  pillar-clean automatic earn-rules (profit-share settlement U5, saver's bonus U6)
  are the real path — this seeds Nova while they're built.
- **`COIN_SOURCE_LABEL`** (SSOT, `src/lib/nova/coin-source.ts`) — Thai labels for the
  three sources, used by the form **and** the ledger (≥2 surfaces → single-sourced).
- **Settings hub**: for `super_admin`, the HELD "Nova" coming-soon row becomes a real
  link to `/nova`; other roles keep the coming-soon row (Nova is operator-only here).

Nova branding (the gamification identity, spec 93 lineage). Coins are **points** (no
baht peg, ADR 0060 build decision) — displayed as "เหรียญ Nova", not baht.

### U1 TDD

**vitest** `nova-award-form.test.tsx`: the award button is disabled until a worker +
a positive amount + a reason are present; a valid submit calls `awardCoins` with the
chosen worker/source/amount/reason and resets on success; an action error surfaces
inline.

### U1 Scope — OUT

- Worker-facing Nova (the portal / gift-first bundle) — later, gated on the
  Internal-invite step + the gift bundle (savings/EWA).
- Automatic earn-rules (profit-share settlement, saver's bonus) — spec 161 U5/U6.
- Editing / reversing a posting from the UI (a reversal is a negative award via the
  same form; no row edits — the ledger is append-only).
- Leaderboards / cross-worker ranking (ADR 0060: no toxic comparison; private,
  rate-based — the gamification design constraint).
