begin;
select plan(2);

-- ============================================================================
-- Spec 244 U2a / ADR 0068 (amended, Tier B) — the friction event vocabulary.
-- U1 shipped the session/navigation labels; U2 adds the five friction labels
-- (rage_tap, form_abandon, validation_error, upload_fail, js_error) to the
-- interaction_event_type enum via ALTER TYPE ADD VALUE (own enum-only migration,
-- ADR 0008 rule). U2a wires the first of them (js_error) in the client; the other
-- four are code-only follow-ups. This test pins the full label set + order so a
-- regression can't drop or reorder a value.
-- ============================================================================

select has_type('public', 'interaction_event_type', 'interaction_event_type enum exists');

select enum_has_labels(
  'public',
  'interaction_event_type',
  ARRAY[
    'session_start', 'heartbeat', 'session_end', 'route_view', 'feature_touch',
    'rage_tap', 'form_abandon', 'validation_error', 'upload_fail', 'js_error'
  ],
  'interaction_event_type carries the U1 session labels + the 5 U2 friction labels, in order');

select * from finish();
rollback;
