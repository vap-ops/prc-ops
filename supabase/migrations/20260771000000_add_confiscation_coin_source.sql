-- Spec 161 U6b / ADR 0060 §6 + decision c — confiscation is a forfeit (a negative
-- coin_posting), distinct from a shop spend, so coin_source gains 'confiscation' (the
-- second SINK source). Its own migration: a new enum value cannot be used in the same
-- transaction it is added (the enum-add lesson) — confiscate_coins (which uses it)
-- lands in 20260771000100.

alter type public.coin_source add value if not exists 'confiscation';
