-- Spec 355 U1 (cont.) — the comment-required rule was ALSO enforced by a TABLE
-- CHECK (approvals_comment_required_when_negative), one layer below the RPC. Move
-- it in lockstep with decide_work_package (075849): the comment is required for
-- `rejected` only (needs_revision now carries a structured reason instead), and
-- revision_reason is present iff the decision is needs_revision.
--
-- Separate migration because 075849 was already applied — an edited-then-repushed
-- migration silently no-ops (never edit an applied migration).

alter table public.approvals drop constraint approvals_comment_required_when_negative;

-- The relaxed comment rule. Legacy rows all carried a non-empty comment (the old
-- check required it for every non-approved decision), so this validates against
-- existing data.
alter table public.approvals add constraint approvals_comment_required_when_rejected
  check (decision <> 'rejected' or (comment is not null and length(trim(comment)) > 0));

-- revision_reason is present iff the decision is needs_revision. NOT VALID: legacy
-- needs_revision rows predate the column (null revision_reason), and approvals is
-- append-only (INSERT-only, never UPDATEd), so only NEW rows are ever checked.
alter table public.approvals add constraint approvals_revision_reason_matches_decision
  check ((revision_reason is not null) = (decision = 'needs_revision')) not valid;
