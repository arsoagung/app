-- =====================================================================
--  06_jurnal_keuangan_platform.sql — platform (logo) + kategori per akun
--  Jalankan SETELAH 04 dan 05. Aman di-run ulang (idempotent).
--  Model: satu akun = satu pasangan platform + goal (mis. "Bibit (Emergency Fund)").
--  Logo milik platform (satu logo dipakai semua akun platform itu).
-- =====================================================================

-- 1. Platform: nama + logo (data URL gambar kecil, ~128px, dikecilkan di browser)
create table if not exists public.jurnal_keuangan_platform (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nama     text not null,
  logo     text check (logo is null or (logo like 'data:image/%' and length(logo) <= 80000)),
  primary key (user_id, nama)
);

alter table public.jurnal_keuangan_platform enable row level security;
drop policy if exists owner_all on public.jurnal_keuangan_platform;
create policy owner_all on public.jurnal_keuangan_platform for all to authenticated
  using (public.is_allowed() and user_id = auth.uid())
  with check (public.is_allowed() and user_id = auth.uid());

-- 2. Akun dapat platform + kategori
alter table public.jurnal_keuangan_akun add column if not exists platform text;
alter table public.jurnal_keuangan_akun add column if not exists kategori text;

-- 3. Isi data yang sudah ada: Bibit = Reksadana, Pluang = US Stocks, Superbank (cair) = Cash
update public.jurnal_keuangan_akun
   set platform = split_part(akun, ' ', 1)
 where platform is null;
update public.jurnal_keuangan_akun
   set kategori = case
         when jenis = 'cair' then 'Cash'
         when platform = 'Pluang' then 'US Stocks'
         else 'Reksadana' end
 where kategori is null;
insert into public.jurnal_keuangan_platform(user_id, nama)
select distinct user_id, platform from public.jurnal_keuangan_akun where platform is not null
on conflict (user_id, nama) do nothing;

-- 4. Baca semua data (tambah platform + kategori di akun, dan daftar platform)
create or replace function public.jk_read()
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not public.is_allowed() then raise exception 'This account is not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'today', to_char((now() at time zone 'Asia/Jakarta')::date, 'YYYY-MM-DD'),
    'akun', coalesce((select jsonb_agg(jsonb_build_object(
        'akun', akun, 'nama', akun, 'tujuan', tujuan, 'jenis', jenis,
        'platform', coalesce(platform, split_part(akun, ' ', 1)),
        'kategori', coalesce(kategori, case when jenis = 'cair' then 'Cash' else 'Investment' end),
        'ikutReturn', ikut_return, 'aktif', aktif, 'urutan', urutan,
        'returnMulai', to_char(return_mulai, 'YYYY-MM-DD')) order by urutan, akun)
      from public.jurnal_keuangan_akun), '[]'::jsonb),
    'platform', coalesce((select jsonb_agg(jsonb_build_object('nama', nama, 'logo', logo) order by nama)
      from public.jurnal_keuangan_platform), '[]'::jsonb),
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

-- 5. Tambah / ubah aset (baris platform + goal), atomik. Sekalian simpan logo platform kalau dikirim.
--   p = {akun?: <key akun yang diedit>, platform, kategori, tujuan?: <goal, wajib saat baru>, aktif?, logo?}
--   Baru   : buat akun "<platform> <goal>", return mulai = akhir bulan lalu (kalau bukan Cash)
--   Edit   : ubah platform/kategori/aktif (goal tidak bisa diganti)
create or replace function public.jk_save_akun(p jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_key   text := nullif(btrim(coalesce(p->>'akun', '')), '');
  v_plat  text := btrim(coalesce(p->>'platform', ''));
  v_kat   text := btrim(coalesce(p->>'kategori', ''));
  v_goal  text := btrim(coalesce(p->>'tujuan', ''));
  v_cair  boolean;
  v_new   text;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if not public.is_allowed() then raise exception 'This account is not allowed' using errcode = '42501'; end if;
  if v_plat = '' or length(v_plat) > 40 then raise exception 'Enter a platform name'; end if;
  if v_kat = '' or length(v_kat) > 40 then raise exception 'Enter a category'; end if;
  v_cair := lower(v_kat) in ('cash', 'kas');

  -- platform + logo
  insert into public.jurnal_keuangan_platform(nama, logo)
  values (v_plat, case when p ? 'logo' then nullif(p->>'logo', '') end)
  on conflict (user_id, nama) do update
     set logo = case when p ? 'logo' then nullif(p->>'logo', '') else public.jurnal_keuangan_platform.logo end;

  if v_key is not null then
    update public.jurnal_keuangan_akun
       set platform = v_plat, kategori = v_kat,
           jenis = case when v_cair then 'cair' else 'investasi' end,
           ikut_return = not v_cair,
           aktif = coalesce((p->>'aktif')::boolean, aktif)
     where akun = v_key;
    if not found then raise exception 'Asset not found'; end if;
    return jsonb_build_object('ok', true, 'akun', v_key);
  end if;

  if not exists (select 1 from public.jurnal_keuangan_akun where tujuan = v_goal) then
    raise exception 'Pick a goal';
  end if;
  v_new := v_plat || ' ' || v_goal;
  if exists (select 1 from public.jurnal_keuangan_akun where akun = v_new) then
    raise exception 'This asset already exists';
  end if;
  insert into public.jurnal_keuangan_akun(akun, tujuan, jenis, ikut_return, aktif, urutan, return_mulai, platform, kategori)
  values (v_new, v_goal, case when v_cair then 'cair' else 'investasi' end, not v_cair, true,
          coalesce((select max(urutan) from public.jurnal_keuangan_akun), 0) + 1,
          case when v_cair then null else (date_trunc('month', v_today) - interval '1 day')::date end,
          v_plat, v_kat);
  return jsonb_build_object('ok', true, 'akun', v_new);
end $$;

grant execute on function public.jk_read(), public.jk_save_akun(jsonb) to authenticated;
