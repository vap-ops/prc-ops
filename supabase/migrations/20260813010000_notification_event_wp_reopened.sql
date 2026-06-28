-- Spec 218 U5 — notify the SA when a WP is reopened for a defect.
--
-- The reopen flips a complete WP to 'rework' (spec 144/216/217). No notification
-- fired on it (the existing triggers cover →pending_approval and approval inserts;
-- the needs_revision/rejected ping is already the wp_decision event → uploaders).
-- Add the event-type value in its OWN migration — Postgres requires an enum value
-- be committed before it's used (the trigger that inserts it lands in the next
-- migration). Mirrors the spec-201 feedback_submitted enum-add convention.

alter type public.notification_event_type add value 'wp_reopened';
