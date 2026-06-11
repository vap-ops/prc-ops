-- Spec 32 / ADR 0037 (amended) — claim timestamp for the drain race.
--
-- `claimed_at` is set when the drainer claims a batch (`pending` →
-- `sending`). A drainer that dies mid-run leaves rows in `sending`; the
-- next run reclaims any `sending` row older than 10 minutes back to
-- `pending` (attempts unchanged — a crash is not a push failure).

alter table public.notification_outbox add column claimed_at timestamptz;
