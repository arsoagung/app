-- Rename Indonesian category labels to English
update public.jurnal_keuangan_akun set kategori='Mutual Funds' where lower(kategori)='reksadana';
update public.jurnal_keuangan_akun set kategori='Time Deposit' where lower(kategori)='deposito';
