-- Spec 81 — notes-everywhere reaches the master tables. Adds an editable
-- backup-capture note to clients, suppliers, contractors (the two latter were
-- DEFERRED in specs 74/75 for lack of an edit screen — spec 81 builds the
-- /pm/masters screen, so they land now).
--
-- Posture (the specs 71–75 doctrine): per-entity `note text`, app cap 1000,
-- DB CHECK 2000 (abuse backstop). `note` is presence data, not money — it is
-- readable through each table's existing table-level `grant select`, and
-- writable by extending the column-scoped INSERT/UPDATE grants. NO RLS policy
-- is dropped or created: the note rides each table's existing UPDATE/INSERT
-- policy, so the eval-once doctrine (pgTAP file 40) is untouched.

-- clients ---------------------------------------------------------------------
alter table public.clients add column note text;
alter table public.clients
  add constraint clients_note_len check (note is null or length(note) <= 2000);
grant insert (note) on public.clients to authenticated;
grant update (note) on public.clients to authenticated;
comment on column public.clients.note is
  'Operator backup-capture note (notes-everywhere, spec 81). Mutable presence data; readable via the table SELECT grant, not money.';

-- suppliers -------------------------------------------------------------------
alter table public.suppliers add column note text;
alter table public.suppliers
  add constraint suppliers_note_len check (note is null or length(note) <= 2000);
grant insert (note) on public.suppliers to authenticated;
grant update (note) on public.suppliers to authenticated;
comment on column public.suppliers.note is
  'Operator backup-capture note (notes-everywhere, spec 81). Mutable presence data; readable via the table SELECT grant, not money.';

-- contractors -----------------------------------------------------------------
alter table public.contractors add column note text;
alter table public.contractors
  add constraint contractors_note_len check (note is null or length(note) <= 2000);
grant insert (note) on public.contractors to authenticated;
grant update (note) on public.contractors to authenticated;
comment on column public.contractors.note is
  'Operator backup-capture note (notes-everywhere, spec 81). Mutable presence data; readable via the table SELECT grant, not money.';
