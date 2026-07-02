-- Spec 248 M1 — the defect photo phase.
--
-- ALTER TYPE ... ADD VALUE must commit before the value is usable, so the
-- enum growth is its own migration (precedent: 20260813006000 after_fix;
-- db-migration lesson: enum-add rides alone). Everything that USES the value
-- (column, trigger, policies) lands in 20260813060000.

alter type public.photo_phase add value if not exists 'defect';
