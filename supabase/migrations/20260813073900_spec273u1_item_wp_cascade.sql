-- Spec 273 U1 follow-up 3 — cascade board items when their WP is hard-deleted.
--
-- daily_work_plan_items.work_package_id defaulted to NO ACTION, so deleting an
-- empty leaf WP that sits on a draft board would fail the FK: delete_work_package
-- guards history (photos/labor/approvals/PRs/members/deps) but NOT the ephemeral
-- daily board, then runs a raw `delete from work_packages`. The board is
-- disposable intent — a deleted WP should drop from any board, never block the
-- delete. Forward-fix (073600 already applied — never edited in place).

alter table public.daily_work_plan_items
  drop constraint daily_work_plan_items_work_package_id_fkey,
  add constraint daily_work_plan_items_work_package_id_fkey
    foreign key (work_package_id) references public.work_packages(id) on delete cascade;
