-- Spec 271 U1a / ADR 0075 — enum registrations for the baseline + variance
-- layer, in their own file BEFORE first use (house rule for enum values).
--
-- plan_baseline_kind (D3): initial = the committed v1 anchor · rebaseline =
-- operational re-plan (does NOT move the anchor) · scope_change = PD/super
-- approved diff whose listed leaves re-anchor.
--
-- variance_class mirrors the spec §3 ordered decision table 1:1 — the U2a TS
-- union must stay label-identical (a pgTAP enum pin holds this side).

create type public.plan_baseline_kind as enum ('initial', 'rebaseline', 'scope_change');

create type public.variance_class as enum (
  'unplanned',               -- ไม่มีแผน (either planned date NULL)
  'no_evidence',             -- ยังไม่มีข้อมูล (neutral grey, never red)
  'completed',               -- anchor exists → slip = actual_end − planned_end
  'completed_undated',       -- complete, no reconstructable anchor (legacy/import)
  'never_started_past_end',  -- ไม่ได้เริ่ม เลยกำหนดจบ (strongest triage signal)
  'late_start',              -- เลยกำหนดเริ่ม
  'late',                    -- ช้ากว่าแผน (started, past planned_end)
  'at_risk',                 -- ใกล้ครบกำหนด
  'on_track'                 -- ตามแผน
);
