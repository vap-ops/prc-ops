-- Spec 161 U6a / ADR 0060 §4 — the Nova shop is the coin SINK. A redemption is a
-- SPEND (a negative coin_posting) — a new posting category, so coin_source gains
-- 'shop_redemption'. The earn-sources (profit_share / savers_bonus / behavior_bonus)
-- stay; this is the first SINK source. Its own migration: a new enum value cannot be
-- used in the same transaction it is added (the ADR-0008 enum-add lesson) — the shop
-- that uses it lands in 20260770000100.

alter type public.coin_source add value if not exists 'shop_redemption';
