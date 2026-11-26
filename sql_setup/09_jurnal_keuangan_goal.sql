-- =====================================================================
--  09_jurnal_keuangan_goal.sql — target nominal per goal
--  Jalankan SETELAH 04-07. Aman di-run ulang (idempotent).
--  Target diisi dari Settings. Kosong / 0 = target dihapus.
-- =====================================================================

create table if not exists public.jurnal_keuangan_goal (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tujuan  text not null,
  target  bigint not null check (target > 0),
  primary key (user_id, tujuan)
);

alter table public.jurnal_keuangan_goal enable row level security;
drop policy if exists owner_all on public.jurnal_keuangan_goal;
create policy owner_all on public.jurnal_keuangan_goal for all to authenticated
  using (public.is_allowed() and user_id = auth.uid())
  with check (public.is_allowed() and user_id = auth.uid());

-- jk_read: sama seperti sebelumnya + array 'goal' [{tujuan,target}]
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
    'goal', coalesce((select jsonb_agg(jsonb_build_object('tujuan', tujuan, 'target', target) order by tujuan)
      from public.jurnal_keuangan_goal), '[]'::jsonb),
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


-- Simpan / hapus target. p = {tujuan, target}  (target kosong atau 0 = hapus)
create or replace function public.jk_save_goal(p jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_goal text := btrim(coalesce(p->>'tujuan', ''));
  v_t    bigint := coalesce(nullif(regexp_replace(coalesce(p->>'target', ''), '[^0-9]', '', 'g'), '')::bigint, 0);
begin
  if not public.is_allowed() then raise exception 'This account is not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.jurnal_keuangan_akun where tujuan = v_goal) then
    raise exception 'Unknown goal';
  end if;
  if v_t <= 0 then
    delete from public.jurnal_keuangan_goal where tujuan = v_goal and user_id = auth.uid();
  else
    insert into public.jurnal_keuangan_goal (tujuan, target) values (v_goal, v_t)
    on conflict (user_id, tujuan) do update set target = excluded.target;
  end if;
  return jsonb_build_object('ok', true);
end $$;
