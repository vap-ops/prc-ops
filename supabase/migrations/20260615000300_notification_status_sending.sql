-- Spec 32 / ADR 0037 (amended) — claim state for the drain race.
--
-- pg_cron fires the drainer every minute; a run that outlives the minute
-- (large batch × per-recipient pushes) would let the next run re-read the
-- same `pending` rows and double-send. The drainer therefore CLAIMS its
-- batch (`pending` → `sending`) before pushing. Enum value gets its own
-- migration (spec-27 precedent: new enum values are never used in the
-- migration that adds them).

alter type public.notification_status add value if not exists 'sending' before 'sent';
