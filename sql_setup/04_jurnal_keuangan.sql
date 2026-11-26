-- =====================================================================
--  04_jurnal_keuangan.sql — tabel + fungsi app Jurnal Keuangan
--  Jalankan sekali di SQL Editor. Aman di-run ulang (idempotent).
--  Butuh 00_setup.sql sudah jalan (fungsi public.is_allowed()).
--  Setelah ini jalankan 05_jurnal_keuangan_import.sql (sekali) buat isi data lama.
-- =====================================================================

-- 1. Akun (satu akun = satu "rekening" di balik sebuah goal)
create table if not exists public.jurnal_keuangan_akun (
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  akun          text not null,
  tujuan        text not null,
  jenis         text not null check (jenis in ('investasi','cair')),
  ikut_return   boolean not null default false,
  aktif         boolean not null default true,
  urutan        int not null default 0,
  return_mulai  date,
  primary key (user_id, akun)
);

-- 2. Saldo per akun per tanggal akhir bulan (bulan berjalan = nilai live, disimpan di akhir bulan itu)
create table if not exists public.jurnal_keuangan_saldo (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  akun     text not null,
  tanggal  date not null,
  saldo    numeric not null check (saldo >= 0),
  primary key (user_id, akun, tanggal)
);

-- 3. Transaksi: Topup (akun_tujuan), Transfer (asal + tujuan), Withdraw (asal saja)
create table if not exists public.jurnal_keuangan_transaksi (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tanggal      date not null,
  jenis        text not null check (jenis in ('Topup','Transfer','Withdraw')),
  nominal      numeric not null check (nominal > 0),
  akun_asal    text not null default '',
  akun_tujuan  text not null default '',
  catatan      text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists jurnal_keuangan_transaksi_user_idx
  on public.jurnal_keuangan_transaksi(user_id, tanggal);

-- 4. Log update (kapan terakhir diupdate + checkpoint akhir bulan)
create table if not exists public.jurnal_keuangan_update (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  akun        text not null,
  bulan       text not null check (bulan ~ '^\d{4}-\d{2}$'),
  tanggal     date not null,
  checkpoint  boolean not null default false
);
create index if not exists jurnal_keuangan_update_user_idx
  on public.jurnal_keuangan_update(user_id, tanggal);

-- 5. RLS — sama kayak app lain: pemilik DAN whitelisted
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('jurnal_keuangan_akun','user_id'),
      ('jurnal_keuangan_saldo','user_id'),
      ('jurnal_keuangan_transaksi','user_id'),
      ('jurnal_keuangan_update','user_id')
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

-- =====================================================================
--  Fungsi (security invoker → RLS tetap berlaku; semua tulis atomik)
-- =====================================================================

-- util: tanggal 'YYYY-MM-DD', tidak boleh di masa depan (zona Jakarta)
create or replace function public.jk_date(s text)
returns date language plpgsql stable set search_path = public as $$
declare d date;
begin
  if s is null or s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date'; end if;
  begin d := s::date; exception when others then raise exception 'Invalid date'; end;
  if d > (now() at time zone 'Asia/Jakarta')::date then raise exception 'Date cannot be in the future'; end if;
  return d;
end $$;

-- util: nominal 0 < n <= 1e11
create or replace function public.jk_nominal(v jsonb)
returns numeric language plpgsql immutable set search_path = public as $$
declare n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then raise exception 'Invalid amount'; end if;
  n := (v #>> '{}')::numeric;
  if n <= 0 or n > 1e11 then raise exception 'Invalid amount'; end if;
  return n;
end $$;

-- util: akun asal topup harus kosong / 'Rekening Utama' / akun aktif, dan beda dari tujuan
create or replace function public.jk_check_dari(dari text, ke text)
returns void language plpgsql stable set search_path = public as $$
begin
  if dari <> '' and dari <> 'Rekening Utama'
     and not exists (select 1 from public.jurnal_keuangan_akun a where a.akun = dari and a.aktif) then
    raise exception 'Unknown source account';
  end if;
  if dari = ke then raise exception 'Source and destination are the same'; end if;
end $$;

-- BACA semua data dalam satu round-trip
create or replace function public.jk_read()
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not public.is_allowed() then raise exception 'This account is not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'today', to_char((now() at time zone 'Asia/Jakarta')::date, 'YYYY-MM-DD'),
    'akun', coalesce((select jsonb_agg(jsonb_build_object(
        'akun', akun, 'nama', akun, 'tujuan', tujuan, 'jenis', jenis,
        'ikutReturn', ikut_return, 'aktif', aktif, 'urutan', urutan,
        'returnMulai', to_char(return_mulai, 'YYYY-MM-DD')) order by urutan, akun)
      from public.jurnal_keuangan_akun), '[]'::jsonb),
    'saldo', coalesce((select jsonb_agg(jsonb_build_object(
        'tanggal', to_char(tanggal, 'YYYY-MM-DD'), 'akun', akun, 'saldo', saldo) order by tanggal, akun)
      from public.jurnal_keuangan_saldo), '[]'::jsonb),
    'transaksi', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'tanggal', to_char(tanggal, 'YYYY-MM-DD'), 'jenis', jenis, 'nominal', nominal,
        'dari', akun_asal, 'ke', akun_tujuan, 'catatan', catatan) order by id)
      from public.jurnal_keuangan_transaksi), '[]'::jsonb),
    'updates', coalesce((select jsonb_agg(jsonb_build_object(
        'akun', akun, 'bulan', bulan, 'tanggal', to_char(tanggal, 'YYYY-MM-DD'), 'checkpoint', checkpoint) order by id)
      from public.jurnal_keuangan_update), '[]'::jsonb)
  );
end $$;

-- SIMPAN update: saldo + (topup | withdraw) opsional + checkpoint + log, atomik
-- p = {akun, saldo, checkpoint, bulan, topup?:{tanggal,nominal,dari,catatan}, withdraw?:{tanggal,nominal,catatan}}
create or replace function public.jk_save_update(p jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_akun   text := coalesce(p->>'akun', '');
  v_saldo  numeric;
  v_cp     boolean := coalesce((p->>'checkpoint')::boolean, false);
  v_today  date := (now() at time zone 'Asia/Jakarta')::date;
  v_cur    text := to_char((now() at time zone 'Asia/Jakarta')::date, 'YYYY-MM');
  v_prev   text := to_char(date_trunc('month', (now() at time zone 'Asia/Jakarta')::date) - interval '1 month', 'YYYY-MM');
  v_bulan  text;
  v_jenis  text;
  tp jsonb; wd jsonb;
  v_dari   text;
begin
  if not public.is_allowed() then raise exception 'This account is not allowed' using errcode = '42501'; end if;

  if jsonb_typeof(p->'saldo') is distinct from 'number' then raise exception 'Invalid balance'; end if;
  v_saldo := (p->>'saldo')::numeric;
  if v_saldo < 0 or v_saldo > 1e12 then raise exception 'Invalid balance'; end if;

  select a.jenis into v_jenis from public.jurnal_keuangan_akun a where a.akun = v_akun and a.aktif;
  if v_jenis is null then raise exception 'Unknown account'; end if;

  v_bulan := case when v_cp then coalesce(p->>'bulan', '') else v_cur end;
  if v_cp and v_bulan <> v_cur and v_bulan <> v_prev then
    raise exception 'Month-end must be this month or last month';
  end if;

  tp := case when coalesce((p->'topup'->>'nominal')::numeric, 0) > 0 then p->'topup' end;
  wd := case when coalesce((p->'withdraw'->>'nominal')::numeric, 0) > 0 then p->'withdraw' end;
  if tp is not null and v_jenis = 'cair' then raise exception 'This account does not take top-ups'; end if;
  if tp is not null and v_cp and v_bulan = v_prev then raise exception 'No top-up when closing last month'; end if;
  if tp is not null and (tp->>'nominal')::numeric > v_saldo then raise exception 'The balance should include the top-up'; end if;
  if wd is not null and tp is not null then raise exception 'Choose either a top-up or a withdrawal'; end if;
  if wd is not null and v_cp and v_bulan = v_prev then raise exception 'No withdrawal when closing last month'; end if;
  if wd is not null and v_jenis = 'cair' then raise exception 'This account does not take withdrawals'; end if;

  if tp is not null then
    v_dari := coalesce(tp->>'dari', '');
    perform public.jk_check_dari(v_dari, v_akun);
    insert into public.jurnal_keuangan_transaksi(tanggal, jenis, nominal, akun_asal, akun_tujuan, catatan)
    values (public.jk_date(tp->>'tanggal'),
            case when v_dari <> '' then 'Transfer' else 'Topup' end,
            public.jk_nominal(tp->'nominal'), v_dari, v_akun,
            left(btrim(coalesce(tp->>'catatan', '')), 200));
  end if;
  if wd is not null then
    insert into public.jurnal_keuangan_transaksi(tanggal, jenis, nominal, akun_asal, akun_tujuan, catatan)
    values (public.jk_date(wd->>'tanggal'), 'Withdraw', public.jk_nominal(wd->'nominal'), v_akun, '',
            left(btrim(coalesce(wd->>'catatan', '')), 200));
  end if;

  -- saldo disimpan di tanggal akhir bulan; checkpoint bulan lalu juga ditulis ke bulan berjalan (live)
  insert into public.jurnal_keuangan_saldo(akun, tanggal, saldo)
  values (v_akun, (to_date(v_bulan || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date, v_saldo)
  on conflict (user_id, akun, tanggal) do update set saldo = excluded.saldo;
  if v_cp and v_bulan = v_prev then
    insert into public.jurnal_keuangan_saldo(akun, tanggal, saldo)
    values (v_akun, (to_date(v_cur || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date, v_saldo)
    on conflict (user_id, akun, tanggal) do update set saldo = excluded.saldo;
  end if;

  insert into public.jurnal_keuangan_update(akun, bulan, tanggal, checkpoint)
  values (v_akun, v_bulan, v_today, v_cp);

  return jsonb_build_object('ok', true);
end $$;

-- EDIT transaksi. p = {id, next:{tanggal, nominal, dari?, catatan}}
-- Withdraw: dari diabaikan (akun tetap). Topup/Transfer: tujuan tetap, dari boleh diganti.
create or replace function public.jk_edit_tx(p jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  t public.jurnal_keuangan_transaksi%rowtype;
  n jsonb := p->'next';
  v_tgl date; v_nom numeric; v_dari text;
begin
  if not public.is_allowed() then raise exception 'This account is not allowed' using errcode = '42501'; end if;
  select * into t from public.jurnal_keuangan_transaksi where id = (p->>'id')::bigint;
  if not found then raise exception 'Transaction not found (maybe deleted). Refresh first.'; end if;
  v_tgl := public.jk_date(n->>'tanggal');
  v_nom := public.jk_nominal(n->'nominal');
  if t.jenis = 'Withdraw' then
    if not exists (select 1 from public.jurnal_keuangan_akun a where a.akun = t.akun_asal and a.aktif and a.jenis <> 'cair') then
      raise exception 'Unknown account';
    end if;
    update public.jurnal_keuangan_transaksi
       set tanggal = v_tgl, nominal = v_nom, catatan = left(btrim(coalesce(n->>'catatan', '')), 200)
     where id = t.id;
  else
    if not exists (select 1 from public.jurnal_keuangan_akun a where a.akun = t.akun_tujuan and a.aktif) then
      raise exception 'Unknown destination account';
    end if;
    v_dari := coalesce(n->>'dari', '');
    perform public.jk_check_dari(v_dari, t.akun_tujuan);
    update public.jurnal_keuangan_transaksi
       set tanggal = v_tgl, nominal = v_nom, akun_asal = v_dari,
           jenis = case when v_dari <> '' then 'Transfer' else 'Topup' end,
           catatan = left(btrim(coalesce(n->>'catatan', '')), 200)
     where id = t.id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- HAPUS transaksi
create or replace function public.jk_delete_tx(p_id bigint)
returns jsonb language plpgsql set search_path = public as $$
begin
  if not public.is_allowed() then raise exception 'This account is not allowed' using errcode = '42501'; end if;
  delete from public.jurnal_keuangan_transaksi where id = p_id;
  if not found then raise exception 'Transaction not found (maybe deleted). Refresh first.'; end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.jk_read(), public.jk_save_update(jsonb),
  public.jk_edit_tx(jsonb), public.jk_delete_tx(bigint) to authenticated;
