-- =====================================================================
--  03_puasain.sql — tabel app Puasain (pencatat intermittent fasting)
--  Jalankan sekali di SQL Editor. Aman di-run ulang (idempotent).
--  Butuh 00_setup.sql sudah jalan (fungsi public.is_allowed()).
-- =====================================================================

-- 1. Catatan puasa. ended_at NULL = puasa lagi berjalan.
create table if not exists public.puasain_fasts (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at   timestamptz,
  goal_hours smallint not null default 16 check (goal_hours between 8 and 24),
  note       text not null default '',
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);
create index if not exists puasain_fasts_user_idx
  on public.puasain_fasts(user_id, started_at desc);

-- cuma boleh 1 puasa berjalan per user
create unique index if not exists puasain_fasts_one_active
  on public.puasain_fasts(user_id) where ended_at is null;

-- 2. Setelan (target default)
create table if not exists public.puasain_settings (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  goal_hours smallint not null default 16 check (goal_hours between 8 and 24),
  updated_at timestamptz not null default now()
);

-- 3. RLS — sama kayak app lain: pemilik DAN whitelisted
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('puasain_fasts','user_id'),
      ('puasain_settings','user_id')
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
