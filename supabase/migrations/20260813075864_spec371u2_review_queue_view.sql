-- Spec 371 U2 — one definition of "whose move is a pending work package".
--
-- U1 split /review into an actionable zone and a collapsed chase zone, but the
-- ภาพรวม hero and the nav badge kept counting bare status='pending_approval' and
-- so kept reporting a blended 70 where only 52 were the PM's move. Operator,
-- 2026-07-28: "Amount 70 items is misleading, how about separating them?"
--
-- A client head-count cannot express "the latest decision is an unanswered
-- needs_revision" — it is a top-1-per-group join against approvals plus an
-- existence check against audit_log. So the predicate moves into a view, and
-- every surface reads THAT: the page, the hero and the badge cannot disagree
-- about a number they all derive from one place.
--
-- security_invoker = true (the house pattern — all four existing public views
-- use it): the underlying RLS of work_packages / approvals / audit_log applies
-- to the CALLER. So the counts stay per-viewer, which is correct and load-
-- bearing — probed live 2026-07-28, a project_manager who is not a member of the
-- project sees 0 of the 70, while the project_directors who actually work this
-- queue see 70 (= 52 actionable + 18 awaiting).
--
-- Every reader of this view is in the PM tier, all of whom the audit_log
-- "internal privileged" policy admits; site_admin / procurement reach the two
-- wp rework events through the second policy. A caller who can read
-- work_packages but NOT the resubmit events would see a cured bounce as
-- awaiting_site — visible-but-mis-zoned, never leaked, and no such caller
-- reaches these surfaces today.
--
-- ADDITIVE: creates one view. No table, column, policy, RPC or grant on any
-- existing object is altered.

create or replace view public.work_package_review_queue
  with (security_invoker = true) as
  with latest as (
    -- Top-1 per WP. The (decided_at desc, id desc) tiebreak mirrors
    -- resubmit_work_package_evidence and selectLatestDecisionByWorkPackage, so
    -- the DB and the UI can never disagree about which decision is current.
    select distinct on (a.work_package_id)
           a.work_package_id, a.id, a.decision, a.decided_at, a.revision_reason
      from public.approvals a
     order by a.work_package_id, a.decided_at desc, a.id desc
  )
  select wp.id,
         wp.code,
         wp.name,
         wp.project_id,
         wp.updated_at,
         case
           when l.decision is distinct from 'needs_revision' then 'first_review'
           when exists (
             select 1
               from public.audit_log al
              where al.target_table = 'work_packages'
                and al.target_id = wp.id
                and al.payload ->> 'event' = 'wp_evidence_resubmitted'
                and al.payload ->> 'answers_decision_id' = l.id::text
           ) then 'ready_again'
           else 'awaiting_site'
         end as zone,
         -- Only meaningful on a bounce: the chase clock runs from the DECISION,
         -- not from queue entry (a bounced WP keeps its original updated_at).
         case when l.decision = 'needs_revision' then l.decided_at end as bounced_at,
         case when l.decision = 'needs_revision' then l.revision_reason end as revision_reason
    from public.work_packages wp
    left join latest l on l.work_package_id = wp.id
   where wp.status = 'pending_approval';

comment on view public.work_package_review_queue is
  'Spec 371 U2 — every pending_approval work package with the zone that says whose move it is: first_review (never reviewed, or an anomalous decided-but-queued row) / ready_again (bounced, the site has re-shot) / awaiting_site (bounced, still waiting on the site admin). The SSOT the /review page, the ภาพรวม hero and the nav badge all read, so their numbers cannot drift. Actionable = zone <> ''awaiting_site''. security_invoker: counts are RLS-scoped per viewer by design.';

-- The house grant hygiene: revoke from public AND anon (not anon alone — a bare
-- `revoke from anon` leaves the PUBLIC default grant in place), then hand SELECT
-- to authenticated only. The view carries no privileges of its own beyond this;
-- row visibility is still decided by the underlying tables' RLS.
revoke all on public.work_package_review_queue from public, anon;
grant select on public.work_package_review_queue to authenticated;
