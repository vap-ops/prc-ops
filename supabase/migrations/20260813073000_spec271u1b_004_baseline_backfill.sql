-- Spec 271 U1b / ADR 0075 D8 — PRC-2026-004 baseline v1 backfill.
--
-- Freezes the operator-approved 2026-07-06 schedule (331/331 dated งานย่อย)
-- as baseline v1 so the calibration pilot has an anchor. UNSCORED by design:
-- scoring_go_live stays NULL (D8 — 004 tunes thresholds/labels/coverage; the
-- first scored project is the next TFM-class build with U0 done on day one).
-- as_of = apply time: leaves whose derived actual_end predates it (e.g.
-- WP-01-06, completed 2026-06-30 against a plan written 2026-07-02) classify
-- as pre_baseline — displayed, never scored (§3).
--
-- proposed_by/approved_by NULL: migration-seeded system row (the operator
-- approved the plan in-session; U3's RPCs stamp real actors going forward).
-- Idempotent + environment-safe: no-op when 004 is absent or already has a
-- baseline. Data-only — no schema statements.

do $$
declare
  v_project uuid;
  v_baseline uuid;
  v_items int;
begin
  select id into v_project from public.projects where code = 'PRC-2026-004';
  if v_project is null then
    raise notice 'spec271u1b: PRC-2026-004 not present — skipping backfill';
    return;
  end if;
  if exists (select 1 from public.plan_baselines where project_id = v_project) then
    raise notice 'spec271u1b: baseline already present — skipping backfill';
    return;
  end if;

  insert into public.plan_baselines (project_id, version, kind, reason, scoring_go_live)
  values (v_project, 1, 'initial',
          'สแนปช็อตแผนตั้งต้นจากตารางงานที่อนุมัติ 2026-07-06 (โครงการนำร่องปรับเกณฑ์ — ไม่นับคะแนน)',
          null)
  returning id into v_baseline;

  insert into public.plan_baseline_items (baseline_id, work_package_id, planned_start, planned_end)
  select v_baseline, w.id, w.planned_start, w.planned_end
  from public.work_packages w
  where w.project_id = v_project
    and not w.is_group
    and w.planned_start is not null
    and w.planned_end is not null;

  get diagnostics v_items = row_count;
  raise notice 'spec271u1b: baseline v1 % created with % items', v_baseline, v_items;
end;
$$;
