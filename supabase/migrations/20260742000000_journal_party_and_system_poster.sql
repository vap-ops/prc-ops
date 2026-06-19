-- Spec 149 U4b / ADR 0057 — make the journal engine drainer-ready:
--   (1) posted_by nullable — a system/automated post (the U4c drainer, an
--       appsheet-sourced event) has no human actor. Manual entries
--       (post_journal_entry) still pin auth.uid(); the source row + the
--       'journal_posted' audit row carry provenance regardless.
--   (2) the typed party dimension on journal_lines (ADR 0057 decision 6): nullable
--       FKs, one per party kind — NOT a mixed-content reference column. A line
--       attributes to at most one party (by construction in the posters).

alter table public.journal_entries alter column posted_by drop not null;
comment on column public.journal_entries.posted_by is
  'The human who caused the entry, or NULL for a system/automated post (U4 drainer / appsheet-sourced). Manual entries pin auth.uid().';

alter table public.journal_lines
  add column supplier_id        uuid null references public.suppliers(id),
  add column contractor_id      uuid null references public.contractors(id),
  add column client_id          uuid null references public.clients(id),
  add column equipment_owner_id uuid null references public.equipment_owners(id);

create index journal_lines_supplier_idx        on public.journal_lines (supplier_id);
create index journal_lines_contractor_idx      on public.journal_lines (contractor_id);
create index journal_lines_client_idx          on public.journal_lines (client_id);
create index journal_lines_equipment_owner_idx on public.journal_lines (equipment_owner_id);

comment on column public.journal_lines.supplier_id is
  'Party dimension (ADR 0057 decision 6) — at most one of supplier/contractor/client/equipment_owner is set per line.';
