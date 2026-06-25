-- Feedback 1c700df6 (procurement) — the item catalog (ทะเบียนวัสดุ, spec 175)
-- had only masonry_tools (เครื่องมืองานปูน) for tooling. Procurement asked for a
-- group covering machinery / general tools (grinders, drills, etc.), and a reply
-- was published promising it. This adds that group to the item_category enum.
--
-- Additive ENUM value: its blast radius is typecheck-enforced (the exhaustive
-- Record<item_category, string> ITEM_CATEGORY_LABEL plus the consumers that
-- iterate its keys) plus one pgTAP pin (119). No table/RLS/RPC change — the
-- catalog form, list, filter, PR picker and store picker all derive their
-- category set from the label record, so the new value surfaces everywhere.
--
-- Own migration ON PURPOSE: Postgres forbids using a new enum value in the same
-- transaction that adds it, and `supabase db push` wraps each migration file in
-- one transaction. Nothing here references the new value, so this stands alone.

alter type public.item_category add value 'machinery_tools' after 'masonry_tools';
