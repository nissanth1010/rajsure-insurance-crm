-- RajSure Insurance CRM — Supabase schema
-- Run this in Supabase SQL Editor before using the CRM.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'RajSure User',
  phone text,
  role text not null default 'staff' check (role in ('admin','staff')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  address text,
  date_of_birth date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  insurance_type text not null default 'car' check (insurance_type in ('car','health')),
  status text not null default 'new' check (status in ('new','contacted','follow_up','quotation','won','lost')),
  source text,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  expected_premium numeric(12,2),
  next_follow_up date,
  notes text,
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  policy_number text not null unique,
  insurance_type text not null check (insurance_type in ('car','health')),
  provider text,
  start_date date,
  expiry_date date,
  premium numeric(12,2),
  payment_status text not null default 'pending' check (payment_status in ('paid','pending','partial','overdue')),
  renewal_status text not null default 'active' check (renewal_status in ('active','due_soon','expired','renewed')),
  vehicle_number text,
  vehicle_model text,
  sum_insured numeric(14,2),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  due_at timestamptz not null,
  type text not null default 'call' check (type in ('call','whatsapp','email','meeting','other')),
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  note text,
  assigned_to uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_id is not null or lead_id is not null)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.policies(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  paid_on date not null default current_date,
  mode text,
  reference text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  policy_id uuid references public.policies(id) on delete cascade,
  file_name text not null,
  document_category text default 'other',
  storage_path text,
  mime_type text,
  file_size bigint,
  extracted_json jsonb,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (customer_id is not null or policy_id is not null)
);

alter table public.documents add column if not exists document_category text default 'other';


create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists customers_updated_at on public.customers;
create trigger customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at before update on public.leads for each row execute function public.set_updated_at();
drop trigger if exists policies_updated_at on public.policies;
create trigger policies_updated_at before update on public.policies for each row execute function public.set_updated_at();
drop trigger if exists followups_updated_at on public.followups;
create trigger followups_updated_at before update on public.followups for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  existing_admin boolean;
  requested_role text;
begin
  select exists(select 1 from public.profiles where role = 'admin') into existing_admin;
  requested_role := coalesce(new.raw_user_meta_data->>'role','staff');
  if not existing_admin then
    requested_role := 'admin';
  else
    requested_role := case when requested_role = 'admin' then 'staff' else requested_role end;
  end if;

  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'RajSure User'),
    new.raw_user_meta_data->>'phone',
    requested_role
  ) on conflict (id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    role = excluded.role,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.has_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where role = 'admin');
$$;

grant execute on function public.has_admin() to anon, authenticated;
grant execute on function public.is_admin() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['profiles','customers','leads','policies','followups','payments','documents','activities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

-- Policies: CRM members can work with CRM data. Admin-only staff actions are handled server-side.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists customers_all on public.customers;
create policy customers_all on public.customers for all to authenticated using (true) with check (true);
drop policy if exists leads_all on public.leads;
create policy leads_all on public.leads for all to authenticated using (true) with check (true);
drop policy if exists policies_all on public.policies;
create policy policies_all on public.policies for all to authenticated using (true) with check (true);
drop policy if exists followups_all on public.followups;
create policy followups_all on public.followups for all to authenticated using (true) with check (true);
drop policy if exists payments_all on public.payments;
create policy payments_all on public.payments for all to authenticated using (true) with check (true);
drop policy if exists documents_all on public.documents;
create policy documents_all on public.documents for all to authenticated using (true) with check (true);
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated using (true);
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated with check (actor_id = auth.uid());

-- Private document bucket. Create it once in Storage if it does not already exist.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Storage policies for authenticated CRM members.
drop policy if exists documents_bucket_select on storage.objects;
create policy documents_bucket_select on storage.objects for select to authenticated using (bucket_id = 'documents');
drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert on storage.objects for insert to authenticated with check (bucket_id = 'documents');
drop policy if exists documents_bucket_update on storage.objects;
create policy documents_bucket_update on storage.objects for update to authenticated using (bucket_id = 'documents') with check (bucket_id = 'documents');
drop policy if exists documents_bucket_delete on storage.objects;
create policy documents_bucket_delete on storage.objects for delete to authenticated using (bucket_id = 'documents');
