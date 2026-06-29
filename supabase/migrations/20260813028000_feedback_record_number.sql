-- Operator request (2026-06-29) — a human-readable running code per feedback
-- record. The UUID primary key is unusable as a reference in conversation /
-- triage ("a unique key like this is hard to determine"), so each report gets a
-- short running number rendered FB-0007.
--
-- Mirrors the PR/PO running-number pattern exactly (see
-- 20260614120100_purchase_requests_cancellation_pr_number.sql): a dedicated
-- sequence feeds a NOT NULL UNIQUE bigint, backfilled in created_at order so the
-- codes read chronologically (FB-0001 = the oldest report). The column-scoped
-- INSERT path (the submit_feedback SECURITY DEFINER RPC) does not name
-- feedback_number, so the sequence default feeds every future row and callers
-- can't override it. Rendered FB-0007 by the formatFeedbackNumber SSOT
-- (src/lib/feedback/format-id.ts). Additive + non-destructive.

create sequence public.feedback_number_seq;

alter table public.feedback add column feedback_number bigint;

with numbered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.feedback
)
update public.feedback f
   set feedback_number = numbered.rn
  from numbered
 where numbered.id = f.id;

select setval(
  'public.feedback_number_seq',
  coalesce((select max(feedback_number) from public.feedback), 0) + 1,
  false
);

alter table public.feedback
  alter column feedback_number set not null,
  alter column feedback_number set default nextval('public.feedback_number_seq'),
  add constraint feedback_feedback_number_uniq unique (feedback_number);

alter sequence public.feedback_number_seq
  owned by public.feedback.feedback_number;
