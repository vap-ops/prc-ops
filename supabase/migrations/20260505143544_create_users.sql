-- 1. Enum type for user roles
create type public.user_role as enum ('site_admin', 'pm', 'super_admin');

-- 2. Users table
create table public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         public.user_role not null default 'site_admin',
  full_name    text,
  line_user_id text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 3. RLS enabled, with a self-read policy and a super-admin all-access policy
alter table public.users enable row level security;

create policy "users read self"
  on public.users for select
  using (auth.uid() = id);

create policy "super_admin full access on users"
  on public.users for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'super_admin'
    )
  );

-- 4. Trigger to auto-create public.users on auth.users insert
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. updated_at maintenance trigger
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();
