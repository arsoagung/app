-- =====================================================================
--  07_jurnal_keuangan_cash.sql — aset Cash: BCA, BNI, Jago, GoPay (goal Cash)
--  Superbank (Cash) sudah ada. Saldo awal kosong: isi lewat tombol + → Update balance.
--  Jalankan SETELAH 06. Aman di-run ulang.
-- =====================================================================
do $$
declare
  v uuid;
  p text;
  n int := 0;
begin
  select user_id into v from public.jurnal_keuangan_akun where tujuan = 'Cash' limit 1;
  if v is null then raise exception 'Goal Cash tidak ditemukan (jalankan 04, 05, 06 dulu)'; end if;
  foreach p in array array['BCA','BNI','Jago','GoPay'] loop
    insert into public.jurnal_keuangan_platform(user_id, nama) values (v, p) on conflict (user_id, nama) do nothing;
    insert into public.jurnal_keuangan_akun(user_id, akun, tujuan, jenis, ikut_return, aktif, urutan, return_mulai, platform, kategori)
    values (v, p || ' Cash', 'Cash', 'cair', false, true,
            (select coalesce(max(urutan), 0) + 1 from public.jurnal_keuangan_akun where user_id = v),
            null, p, 'Cash')
    on conflict (user_id, akun) do nothing;
  end loop;
end $$;
