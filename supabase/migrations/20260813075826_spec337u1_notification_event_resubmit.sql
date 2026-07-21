-- Spec 337 U1 — notification_event_type gains 'wp_evidence_resubmitted'.
--
-- As with feedback_submitted (…001700), wp_reopened (…010000) and
-- site_issue_reported (…075660): ALTER TYPE ADD VALUE cannot be used in the same
-- transaction that then references the new label, so the enum add is its OWN
-- migration, ahead of the migration (…075827) whose RPC enqueues it. Additive —
-- existing labels and their order are untouched, so the enum_has_labels pin
-- (pgTAP file 25) only needs the new label appended.
--
-- Fired by resubmit_work_package_evidence: the SA answered a needs_revision by
-- re-shooting and pressed ส่งตรวจอีกครั้ง. Recipient is the DECIDER who asked for
-- the re-shoot (a person, not the approval pool) — spec 337 F2.

alter type public.notification_event_type add value if not exists 'wp_evidence_resubmitted';
