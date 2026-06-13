# Spec 85 — Contacts v2 Unit 3: bank info (money-isolated)

Contacts v2, Unit 3. DB-only, additive. Bank details for the parties we pay (contractors, suppliers, service_providers). Operator decision: **PM/back-office only — site_admin cannot see it**, same money-isolation as `workers.day_rate`.

## Design — a separate `contact_bank` table (not columns on the masters)

Bank info goes in a dedicated table with **zero `authenticated` access** (RLS enabled, no policies, no grants) → only the service-role admin client and the SECURITY DEFINER write RPC touch it. This is stronger and simpler than adding money columns to the three masters: those carry a **table-level** `grant select` (the spec-46 C3 reality), so a bank column there would be readable unless we revoked the table grant and re-granted every non-bank column per table — a 3× maintenance footgun (a forgotten column silently drops from reads). A separate no-grant table has no such footgun and cannot leak.

Three **typed** nullable FKs (`contractor_id`, `supplier_id`, `service_provider_id`) with a CHECK that **exactly one** is set — this is typed + validated (NOT a mixed-content/polymorphic reference column, which CLAUDE.md forbids). A partial unique index per FK = one bank row per contact.

```
contact_bank(
  id, contractor_id?, supplier_id?, service_provider_id?,
  bank_name, bank_account_no, bank_account_name,
  updated_by → users, updated_at,
  CHECK exactly-one-target, length CHECKs)
RLS enabled; REVOKE ALL from anon, authenticated; NO policies, NO grants.
```

## Write — `set_contact_bank` SECURITY DEFINER RPC

PM/super gate (42501 else, like `set_worker_day_rate`); takes the three optional target ids (exactly one) + the three bank fields; `nullif(btrim(...),'')`; **upsert** (update the target's row, else insert); `updated_by = auth.uid()`. `revoke execute from public, anon; grant execute to authenticated` (the gate is inside). Called on the **user session** (needs `auth.uid()` / `current_user_role()`), never the admin client.

## Read

Service-role admin client only, behind `requireRole(PM_ROLES)` — wired in Unit 5 (the detail page). No authenticated read path exists by design.

## Tests

NEW pgTAP `45-contact-bank.test.sql`: table exists + RLS enabled; `has_table_privilege(authenticated, SELECT/INSERT)=false` (zero access); exactly-one-target CHECK rejects 0 and 2 targets; `set_contact_bank` — SA call → 42501; visitor → 42501; PM upserts (insert then update same target = one row, updated values); partial-unique (a second insert for the same contractor via raw owner insert → 23505). db:types regen reconcile byte-exact (table + the function).

## Verification

`pnpm lint && pnpm typecheck && pnpm test && pnpm build` + `pnpm db:test` green.
