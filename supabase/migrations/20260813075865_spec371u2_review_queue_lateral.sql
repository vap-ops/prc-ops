-- Spec 371 U2, fresh-eyes follow-up — two corrections to
-- public.work_package_review_queue. A NEW migration, never an edit to 075864:
-- an applied migration re-pushed silently no-ops.
--
-- 1. PERFORMANCE. The first cut computed `latest` as a whole-table
--    `distinct on (work_package_id) … from approvals`, so every read sorted and
--    scanned EVERY approvals row ever written — and under RLS paid a
--    can_see_wp() SECURITY DEFINER call per row — before joining down to the ~70
--    pending WPs. Measured under a real project_director JWT: the badge
--    head-count ran 195 ms vs 106 ms for the old bare-status count. That query
--    fires on every dashboard render AND every nav mount (SelfCountBadge in
--    BottomTabBar / HubNav), and its cost scaled with total approvals rather
--    than with the pending queue: ~3 s per navigation at 10k approvals.
--
--    The `id desc` third sort key made approvals_work_package_id_decided_at_idx
--    unusable for the old shape. A correlated LATERAL … LIMIT 1 can use it:
--    Index Scan, loops = (pending WPs), measured 136 ms, and the approvals term
--    becomes O(pending) instead of O(all approvals).
--
--    The tiebreak is UNCHANGED — (decided_at desc, id desc), matching
--    resubmit_work_package_evidence and selectLatestDecisionByWorkPackage — so
--    classification is byte-identical; only the plan differs.
--
-- 2. AN OVERCLAIMING COMMENT. 075864's comment said this view is "the SSOT the
--    /review page, the ภาพรวม hero and the nav badge all read". The hero and the
--    badge do; /review does NOT — it still re-derives the same predicate in
--    TypeScript (partitionReviewQueue). That comment lives in the live prod
--    catalog, so a reader would have been told a false invariant. Corrected
--    below to say what is actually true, and what closes the gap.
--
-- ADDITIVE: replaces the body + comment of the view created in 075864. No table,
-- column, policy, RPC or grant is touched, and the column list is unchanged, so
-- the existing grants and every reader keep working.

create or replace view public.work_package_review_queue
  with (security_invoker = true) as
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
    -- Correlated top-1: reads at most one approvals row per pending WP, via
    -- approvals_work_package_id_decided_at_idx. LEFT so a never-reviewed WP
    -- survives with a null decision and classifies as first_review.
    left join lateral (
      select a.id, a.decision, a.decided_at, a.revision_reason
        from public.approvals a
       where a.work_package_id = wp.id
       order by a.decided_at desc, a.id desc
       limit 1
    ) l on true
   where wp.status = 'pending_approval';

comment on view public.work_package_review_queue is
  'Spec 371 U2 — every pending_approval work package with the zone that says whose move it is: first_review (never reviewed, or an anomalous decided-but-queued row) / ready_again (bounced, the site has re-shot) / awaiting_site (bounced, still waiting on the site admin). Actionable = zone <> ''awaiting_site''. Read by the ภาพรวม hero (pending-summary.ts) and the nav badge, so those two counts cannot drift. NOTE: /review does NOT read this view yet — it re-derives the same rule in TypeScript (partitionReviewQueue in src/lib/approvals/review-queue.ts), so the predicate currently has two homes; spec 371 U3 retires the TypeScript one. security_invoker: counts are RLS-scoped per viewer by design.';
