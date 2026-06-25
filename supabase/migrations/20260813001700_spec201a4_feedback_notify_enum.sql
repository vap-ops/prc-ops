-- Spec 201 awareness arc A4 — LINE push for feedback (ADR 0037 notification outbox).
--
-- Add the feedback_submitted event type to notification_event_type. ALTER TYPE ADD
-- VALUE can't be used in the same transaction that then references the new label, so
-- the enum add is its OWN migration, ahead of the trigger migration (…001800) that
-- enqueues it. Additive: existing labels and their order are untouched, so every
-- enum_has_labels pin only needs the new label appended (file 25).

alter type public.notification_event_type add value 'feedback_submitted';
