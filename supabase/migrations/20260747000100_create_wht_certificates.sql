-- Spec 149 U6 / ADR 0057 decision 9 — WHT (withholding tax) certificates.
--   wht_rates: income-type → standard Thai rate (percent). Skeleton seed — the
--     accountant confirms before go-live (like the COA skeleton).
--   wht_certificates: the PND document. direction = deducted (we withhold paying a
--     payee → we owe the Revenue Dept, issue PND3/53) or suffered (a client
--     withheld from us → a tax asset, already posted Dr WHT-prepaid at billing).
--
-- MONEY DOMAIN posture: RLS on, zero authenticated grant, written only by the
-- record RPC, admin-read behind requireRole(pm/super).

create type public.wht_direction as enum ('deducted', 'suffered');
create type public.wht_form      as enum ('pnd3', 'pnd53', 'pnd1');

create table public.wht_rates (
  income_type  text primary key,
  default_rate numeric(5,2) not null,
  label_th     text not null,
  constraint wht_rates_rate_range check (default_rate >= 0 and default_rate <= 100)
);
insert into public.wht_rates (income_type, default_rate, label_th) values
  ('service',      3, 'บริการ / จ้างทำของ'),
  ('professional', 3, 'ค่าวิชาชีพ'),
  ('rent',         5, 'ค่าเช่า'),
  ('transport',    1, 'ค่าขนส่ง'),
  ('advertising',  2, 'ค่าโฆษณา'),
  ('other',        3, 'อื่นๆ')
on conflict (income_type) do nothing;

create sequence public.wht_certificates_cert_no_seq;

create table public.wht_certificates (
  id              uuid primary key default gen_random_uuid(),
  cert_no         bigint not null default nextval('public.wht_certificates_cert_no_seq') unique,
  direction       public.wht_direction not null,
  tax_form        public.wht_form not null,
  supplier_id     uuid null references public.suppliers(id),
  contractor_id   uuid null references public.contractors(id),
  client_id       uuid null references public.clients(id),
  tax_id_13       text not null,
  income_type     text not null references public.wht_rates(income_type),
  base_amount     numeric(14,2) not null,
  wht_rate        numeric(5,2) not null,
  wht_amount      numeric(14,2) not null,
  pay_source_table text null,
  pay_source_id    uuid null,
  issued_date     date not null default current_date,
  note            text null,
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  constraint wht_certificates_tax_id   check (tax_id_13 ~ '^\d{13}$'),
  constraint wht_certificates_base_pos check (base_amount > 0),
  constraint wht_certificates_rate     check (wht_rate >= 0 and wht_rate <= 100),
  constraint wht_certificates_amount   check (wht_amount >= 0),
  constraint wht_certificates_src_len  check (pay_source_table is null or length(pay_source_table) <= 64),
  constraint wht_certificates_note_len check (note is null or length(note) <= 500)
);
alter sequence public.wht_certificates_cert_no_seq owned by public.wht_certificates.cert_no;

create index wht_certificates_supplier_idx   on public.wht_certificates (supplier_id);
create index wht_certificates_contractor_idx on public.wht_certificates (contractor_id);
create index wht_certificates_client_idx     on public.wht_certificates (client_id);
create index wht_certificates_direction_idx  on public.wht_certificates (direction);

alter table public.wht_rates        enable row level security;
alter table public.wht_certificates enable row level security;
revoke all on public.wht_rates        from anon, authenticated;
revoke all on public.wht_certificates from anon, authenticated;

comment on table public.wht_certificates is
  'Withholding-tax certificates (ADR 0057 decision 9). MONEY DOMAIN — zero grant. deducted: we withhold (Cr WHT-payable, issue PND3/53); suffered: client withheld from us (document; WHT-prepaid already posted at billing).';
comment on table public.wht_rates is
  'Standard Thai WHT rates by income type (percent). Skeleton seed — accountant confirms before go-live.';
