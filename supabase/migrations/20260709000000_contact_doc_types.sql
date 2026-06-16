-- Spec 131 U1 — extend contact_doc_purpose with the rest of the DC onboarding
-- packet's document types. Today: id_card, bank_book. Add consent (signed PDPA
-- + background-check consent), house_registration (ทะเบียนบ้าน), insurance
-- (worker accident / ประกันสังคม), company_cert (หนังสือรับรอง), vat_cert
-- (ภพ.20), contract (สัญญา/ใบเสนอราคา).
--
-- ALTER TYPE ... ADD VALUE: own migration (cannot be used in the txn that adds
-- it; same split as add_six_new_user_roles). No pgTAP pin asserts the
-- contact_doc_purpose label set (grep-verified), so nothing downstream to fix.

alter type public.contact_doc_purpose add value if not exists 'consent';
alter type public.contact_doc_purpose add value if not exists 'house_registration';
alter type public.contact_doc_purpose add value if not exists 'insurance';
alter type public.contact_doc_purpose add value if not exists 'company_cert';
alter type public.contact_doc_purpose add value if not exists 'vat_cert';
alter type public.contact_doc_purpose add value if not exists 'contract';
