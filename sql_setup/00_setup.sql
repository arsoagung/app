-- =====================================================================
--  00_setup.sql — Supabase project baru (personal apps: coffeelog,
--  targetin, karnote, sehatin). Jalankan di SQL Editor, sekali aja.
--  Aman di-run ulang (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. WHITELIST
-- ---------------------------------------------------------------
create table if not exists public.app_whitelist (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.app_whitelist enable row level security;
-- sengaja TANPA policy: client (anon/authenticated) gak bisa baca/tulis.
-- Kelola email lewat SQL Editor / dashboard aja.

insert into public.app_whitelist (email, note)
values ('arsoagung@gmail.com', 'owner')
on conflict (email) do nothing;

-- helper: apakah user yang lagi login ada di whitelist?
create or replace function public.is_allowed()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_whitelist
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- lapis 1: blok pendaftaran akun baru kalau email gak ada di whitelist
create or replace function public.block_non_whitelisted_signup()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.app_whitelist where lower(email) = lower(new.email)
  ) then
    raise exception 'Email % tidak diizinkan', new.email;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_non_whitelisted on auth.users;
create trigger trg_block_non_whitelisted
  before insert on auth.users
  for each row execute function public.block_non_whitelisted_signup();

-- ---------------------------------------------------------------
-- 2. COFFEELOG
-- ---------------------------------------------------------------
create table if not exists public.coffeelog_entries (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  drink_type text not null check (drink_type in ('hot','ice')),
  created_at timestamptz not null default now(),
  unique (user_id, entry_date)          -- dipakai onConflict di kode
);

-- ---------------------------------------------------------------
-- 3. TARGETIN
--    id = text (kode generate id lewat uid() string, bukan uuid)
--    start / goal_ms / goal_until / record / stopped_at = epoch ms
-- ---------------------------------------------------------------
create table if not exists public.targetin_habits (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  icon       text not null default 'target',
  color      text not null default '#c8f135',
  cat        text not null default 'Umum',
  start      bigint,
  goal_ms    bigint not null default 0,
  goal_until bigint not null default 0,
  active     boolean not null default true,
  archived   boolean not null default false,
  record     bigint not null default 0,
  stopped_at bigint,
  history    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists targetin_habits_user_idx on public.targetin_habits(user_id, created_at);

-- ---------------------------------------------------------------
-- 4. KARNOTE
-- ---------------------------------------------------------------
create table if not exists public.karnote_vehicles (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists karnote_vehicles_user_idx on public.karnote_vehicles(user_id);

create table if not exists public.karnote_entries (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type       text not null check (type in ('service','fuel','odo')),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists karnote_entries_user_idx on public.karnote_entries(user_id, type);

create table if not exists public.karnote_settings (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 5. SEHATIN (dulunya jurnal-kesehatan)
-- ---------------------------------------------------------------
create table if not exists public.sehatin_records (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_key text not null default 'saya',
  name        text not null,
  start_date  date not null,
  end_date    date,
  symptoms    text not null default '',
  notes       text not null default '',
  ongoing     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists sehatin_records_user_idx on public.sehatin_records(user_id, account_key, start_date desc);

create table if not exists public.sehatin_profiles (
  id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  accounts   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.sehatin_feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid() references auth.users(id) on delete set null,
  email      text,
  pesan      text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 6. RLS — lapis 2: tiap tabel hanya boleh diakses pemilik DAN whitelisted
-- ---------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('coffeelog_entries','user_id'),
      ('targetin_habits','user_id'),
      ('karnote_vehicles','user_id'),
      ('karnote_entries','user_id'),
      ('karnote_settings','user_id'),
      ('sehatin_records','user_id'),
      ('sehatin_profiles','id'),
      ('sehatin_feedback','user_id')
    ) as x(tbl, owner_col)
  loop
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('drop policy if exists owner_all on public.%I', t.tbl);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using (public.is_allowed() and %I = auth.uid())
         with check (public.is_allowed() and %I = auth.uid())',
      t.tbl, t.owner_col, t.owner_col);
  end loop;
end $$;
