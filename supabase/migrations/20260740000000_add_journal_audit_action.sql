-- Spec 149 U3 / ADR 0057 — audit_action value for journal posting. Every journal
-- entry (manual, reversal, and from U4 subledger posters) audits as
-- 'journal_posted'; a reversal is identifiable by reversal_of in the payload +
-- the entry's reversal_of column. Enum-add isolation: its own migration. Both
-- enum_has_labels pins (pgTAP file 03 AND file 18) updated.

alter type public.audit_action add value if not exists 'journal_posted';
