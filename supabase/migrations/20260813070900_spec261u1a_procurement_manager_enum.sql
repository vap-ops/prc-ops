-- Spec 261 / ADR 0070 — add the `procurement_manager` role.
--
-- OWN migration, by necessity: Postgres forbids USING a new enum value in the
-- same transaction that ADDs it. The parity sweep + the four-item manager set
-- (which reference 'procurement_manager') live in the next migration
-- (20260813071000). Mirrors spec 260's audit-action split.
--
-- procurement_manager = a superset of `procurement` plus a manager-only set;
-- it is NOT a member of the project-manager tier (is_manager() is untouched).
-- Enum ordering is not load-bearing (ADR 0008); the value is appended last.

alter type public.user_role add value if not exists 'procurement_manager';
