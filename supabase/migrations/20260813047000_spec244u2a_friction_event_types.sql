-- Spec 244 U2a / ADR 0068 (amended, Tier B) — add the five friction event types
-- to interaction_event_type. Enum-only migration (no dependent DDL): each value
-- is appended, none used here, so it is safe to apply ahead of the client code
-- that emits them (ADR 0008 rule — an enum ADD VALUE lives in its own migration).
-- U2a wires the first signal (js_error, a global uncaught-error handler → the
-- telemetry pipe); rage_tap / form_abandon / validation_error / upload_fail are
-- code-only follow-ups (U2b+) that reuse these values without more schema.

alter type public.interaction_event_type add value if not exists 'rage_tap';
alter type public.interaction_event_type add value if not exists 'form_abandon';
alter type public.interaction_event_type add value if not exists 'validation_error';
alter type public.interaction_event_type add value if not exists 'upload_fail';
alter type public.interaction_event_type add value if not exists 'js_error';
