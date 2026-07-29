-- Spec 374 U2 — public_holidays: the app's first holiday model (display-only).
-- Reference data for the attendance calendar (วันหยุด cell tint + ทำงานวันหยุด
-- chip). NO pay semantics — holiday pay rules are explicitly parked (operator
-- ruling 2026-07-29). Seeded with the B.E. 2569 (2026) government-calendar
-- list, cross-checked against two published sources 2026-07-29; substitution
-- days (ชดเชย) carry their own rows. Writes are migration-only for now: RLS has
-- a SELECT policy and nothing else, and the table grant is read-only, so no
-- app path can mutate it (a management UI is a deliberate non-goal until asked
-- for).

create table public.public_holidays (
  holiday_date date primary key,
  name_th text not null
);

alter table public.public_holidays enable row level security;

-- Reference data: any signed-in user may read (the calendar renders for the
-- roster audience today, but the data itself is public-calendar fact).
create policy "public_holidays readable by authenticated"
  on public.public_holidays
  for select
  to authenticated
  using (true);

-- Belt over braces: even with RLS write-policy-less, keep the table grant
-- read-only for app roles (writes happen as the migration role only).
revoke all on table public.public_holidays from public, anon, authenticated;
grant select on table public.public_holidays to authenticated;

insert into public.public_holidays (holiday_date, name_th) values
  ('2026-01-01', 'วันขึ้นปีใหม่'),
  ('2026-01-02', 'วันหยุดพิเศษ (ตามมติ ครม.)'),
  ('2026-03-03', 'วันมาฆบูชา'),
  ('2026-04-06', 'วันจักรี'),
  ('2026-04-13', 'วันสงกรานต์'),
  ('2026-04-14', 'วันสงกรานต์'),
  ('2026-04-15', 'วันสงกรานต์'),
  ('2026-05-01', 'วันแรงงานแห่งชาติ'),
  ('2026-05-04', 'วันฉัตรมงคล'),
  ('2026-05-11', 'วันพืชมงคล'),
  ('2026-05-31', 'วันวิสาขบูชา'),
  ('2026-06-01', 'ชดเชยวันวิสาขบูชา'),
  ('2026-06-03', 'วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ พระบรมราชินี'),
  ('2026-07-28', 'วันเฉลิมพระชนมพรรษา พระบาทสมเด็จพระเจ้าอยู่หัว'),
  ('2026-07-29', 'วันอาสาฬหบูชา'),
  ('2026-07-30', 'วันเข้าพรรษา'),
  ('2026-08-12', 'วันแม่แห่งชาติ'),
  ('2026-10-13', 'วันนวมินทรมหาราช'),
  ('2026-10-23', 'วันปิยมหาราช'),
  ('2026-12-05', 'วันพ่อแห่งชาติ / วันชาติ'),
  ('2026-12-07', 'ชดเชยวันพ่อแห่งชาติ'),
  ('2026-12-10', 'วันรัฐธรรมนูญ'),
  ('2026-12-31', 'วันสิ้นปี');
