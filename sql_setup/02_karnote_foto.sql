-- =====================================================================
--  02_karnote_foto.sql — bucket foto kendaraan KarNote (private)
--  Jalankan sekali di SQL Editor project baru. Aman di-run ulang.
--  Path file: <user_id>/<vehicle_id>-<timestamp>.webp
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('karnote-photos', 'karnote-photos', false, 512000,
        array['image/webp','image/jpeg','image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = 512000,
      allowed_mime_types = array['image/webp','image/jpeg','image/png'];

drop policy if exists karnote_photos_owner on storage.objects;
create policy karnote_photos_owner on storage.objects
  for all to authenticated
  using (
    bucket_id = 'karnote-photos'
    and public.is_allowed()
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'karnote-photos'
    and public.is_allowed()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
