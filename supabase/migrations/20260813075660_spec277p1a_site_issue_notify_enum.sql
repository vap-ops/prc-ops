-- Spec 277 P1a PR3 — serious-site-issue PM alert (AUTOMATION #1, ADR 0037 outbox).
--
-- Add the site_issue_reported event type to notification_event_type. As with
-- feedback_submitted (…001700) and wp_reopened (…010000): ALTER TYPE ADD VALUE
-- cannot be used in the same transaction that then references the new label, so
-- the enum add is its OWN migration, ahead of the trigger migration (…075670)
-- that enqueues it. Additive — existing labels and their order are untouched, so
-- the enum_has_labels pin (pgTAP file 25) only needs the new label appended.

alter type public.notification_event_type add value 'site_issue_reported';
