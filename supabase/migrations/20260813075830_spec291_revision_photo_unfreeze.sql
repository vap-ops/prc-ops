-- Spec 291 U1 amendment (feedback f2096ee4) — unfreeze photo deletes while the
-- reviewer's ให้แก้ไข (needs_revision) ask is outstanding.
--
-- Baseline (migration 075630, sourced LIVE 2026-07-22):
--   photo_wp_deletable(p_wp) = the WP's status NOT IN ('pending_approval','complete')
-- A submitted evidence set is frozen so a reviewer cannot be shown one set and
-- judge another. That stays.
--
-- The hole it left: `needs_revision` is the reviewer explicitly asking the SA to
-- re-shoot, and it LEAVES the WP at pending_approval (review/.../actions.ts —
-- only `approved`/`rejected` move the status). So the SA could ADD a corrected
-- photo but never REMOVE the wrong one, and the only cure that removed it was
-- `rejected` → rework (spec 337 F3), which charges a rework round to the WORK
-- when only the PHOTO was wrong.
--
-- Widened rule: a pending_approval WP is deletable again exactly while its
-- LATEST approvals row (max(decided_at) — the same top-1-per-WP idiom as
-- src/lib/approvals/latest-decision.ts) is 'needs_revision'. Any later decision
-- closes the window; `complete` is never unfrozen; a WP with no decision at all
-- stays frozen; a missing WP still fails closed via the outer coalesce.
--
-- The approver is NOT given a delete affordance — the reviewer asks, the
-- uploader fixes. This is a body-only CREATE OR REPLACE: signature, volatility,
-- SECURITY DEFINER, search_path and grants are unchanged.
--
-- Sole consumer (verified live): the `photo_logs insert by sa/pm/super` WITH
-- CHECK conjunct `(superseded_by IS NULL OR photo_wp_deletable(work_package_id))`,
-- so this widens the delete gate only — never an upload, never a read.

create or replace function public.photo_wp_deletable(p_wp uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select
       wp.status not in ('pending_approval', 'complete')
       or (
         wp.status = 'pending_approval'
         and (
           select a.decision
             from public.approvals a
            where a.work_package_id = wp.id
            order by a.decided_at desc
            limit 1
         ) = 'needs_revision'
       )
       from public.work_packages wp
      where wp.id = p_wp),
    false);
$function$;
