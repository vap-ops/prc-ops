-- Spec 263 / ADR 0071 — add the `site_owner` + `auditor` roles.
--
-- OWN migration, by necessity: Postgres forbids USING a new enum value in the
-- same transaction that ADDs it. These two values are BEHAVIOR-FREE this unit —
-- no route, no gate, no RLS policy, no role-set membership references them here
-- (both fall through roleHome() to /coming-soon). A later unit's migration may
-- reference them safely once this one has committed. Mirrors spec 261 U1a's and
-- spec 260's committed-before-use enum split.
--
-- site_owner ≈ the ADR 0060 Head Technician who owns one site's work; auditor
-- oversees N sites (read-across). Both are reserved forward-compat values; what
-- they DO is later specs (ADR 0071 §1). Enum ordering is not load-bearing
-- (ADR 0008); the values are appended last.

alter type public.user_role add value if not exists 'site_owner';
alter type public.user_role add value if not exists 'auditor';
