-- Spec 317 follow-up (operator ask 2026-07-14: "have you checked for those
-- inputs prior to our picker?") — normalize pre-picker free-text bank names to
-- the U7 THAI_BANKS canonical values so stored data matches what the picker
-- writes and the usage counter counts.
--
-- Audit across all three bank homes (workers.bank_name, contact_bank.bank_name,
-- staff_registration_bank.bank_name) found exactly ONE non-canonical variant:
-- 'ธนาคารกรุงเทพ' (longhand) on 2 rows, both the same person — canonical is
-- 'กรุงเทพ'. Every other stored value already matches the SSOT; contact_bank is
-- empty. Explicit exact-match mapping only (no prefix stripping — the อื่นๆ
-- free-text escape is a deliberate feature, unlisted banks must survive).

update public.workers
   set bank_name = 'กรุงเทพ'
 where bank_name = 'ธนาคารกรุงเทพ';

update public.staff_registration_bank
   set bank_name = 'กรุงเทพ', updated_at = now()
 where bank_name = 'ธนาคารกรุงเทพ';

update public.contact_bank
   set bank_name = 'กรุงเทพ', updated_at = now()
 where bank_name = 'ธนาคารกรุงเทพ';
