-- Spec 16 P1 / ADR 0026 Decision A — three new purchase_requests columns.
--
--   needed_by  date  — requester-set at INSERT (wanted-arrival date).
--                      No now()-relative CHECK: it would invalidate rows
--                      over time and break dump/restore; the >= today
--                      rule is validator-only UX.
--   eta        date  — appsheet_writer-only fact column (expected
--                      arrival). The grant + audit amendment ship in
--                      20260613100100 so eta is never writable while its
--                      corrections are unaudited.
--   priority   enum  — requester-set at INSERT. Declared in the order
--                      normal < urgent < critical: enum comparison uses
--                      declaration order, so `ORDER BY priority DESC`
--                      puts critical first with no extra machinery.
--
-- A plain CREATE TYPE may be used in the same transaction as the column
-- that references it — the two-migration split discipline (130000/130100,
-- 140000/140300) applies only to ALTER TYPE ... ADD VALUE.
--
-- Writer scoping: authenticated INSERT on purchase_requests is
-- table-level, so needed_by/priority need no grant change. PM/super
-- remain technically able to write all three via the open UPDATE policy
-- (two-layer-guard extension, recorded in ADR 0026); no server action
-- exposes them. appsheet_writer gets NO privilege on needed_by/priority —
-- its protected set grows to 5 (pgTAP-pinned in 18, smoke-asserted).

create type public.purchase_request_priority as enum ('normal', 'urgent', 'critical');

alter table public.purchase_requests
  add column needed_by date,
  add column eta date,
  add column priority public.purchase_request_priority not null default 'normal';

comment on column public.purchase_requests.needed_by is
  'Requester-set wanted-arrival date (spec 16). Insert-only in v1; no DB date-floor CHECK by design (ADR 0026).';
comment on column public.purchase_requests.eta is
  'Expected arrival. Intended write path: appsheet_writer column grant (20260613100100). The app never writes it; PM/super technical writability and INSERT-time seedability are the recorded two-layer-guard posture (ADR 0026).';
comment on column public.purchase_requests.priority is
  'Requester-set urgency (spec 16 addendum). Enum declaration order normal<urgent<critical is the sort order.';
