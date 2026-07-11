-- Spec 296 U1a — new staff document purpose for the bank-passbook photo.
-- Kept in its own migration so the value is committed before 075700 references
-- 'book_bank' as an enum literal (approve floor, doc hardening) in the next file.
alter type public.staff_doc_purpose add value if not exists 'book_bank';
