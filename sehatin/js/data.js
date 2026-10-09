/* ═══════════════════════════════════════════════════════════════
   DATA.JS — Sehatin
   Isinya SEMUA yang urusannya baca/tulis data catatan sakit ke
   database Supabase (bukan localStorage — ini beneran nyimpen di
   server, jadi data yang sama muncul di HP maupun web).

   Butuh shared.js udah dimuat duluan (pakai sb, currentUser,
   showToast, diffDays, todayStr dari situ).
   Kalau mau pakai exportExcel(), halaman itu juga wajib load
   library XLXS-nya:
   <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
   ═══════════════════════════════════════════════════════════════ */

/* ═══ STATE DATA ═══ */
var allData = {};   // cache data per akun, key = account_key
var appData = [];   // data akun yang lagi aktif (yang ditampilin di layar)

/* ═══ AKUN AKTIF ═══
   Versi sederhana dulu — default cuma 1 akun "Saya". Ini dipisah
   dari fitur ganti-ganti akun (UI-nya nanti pas bikin pengaturan.html),
   tapi query data butuh tau "lagi query akun yang mana" makanya
   ditaro di sini. */
var ACCOUNTS   = [{ key: 'saya', label: 'Saya', emoji: '👤' }];
var curAccount = 0;

function curKey() {
  var acc = ACCOUNTS[curAccount];
  if (!acc) { curAccount = 0; acc = ACCOUNTS[0]; }
  return acc ? acc.key : 'saya';
}

/* ═══ BACA DATA ═══
   Panggil dari onSignIn Auth.init() (user sudah lolos whitelist). Habis selesai, otomatis
   manggil renderAll() — jadi tiap halaman WAJIB punya fungsi
   renderAll() sendiri (isinya beda-beda tergantung halaman itu
   mau nampilin apa: beranda beda sama statistik, dst). */
async function loadData() {
  if (!currentUser) return;
  var key = curKey();
  const { data, error } = await sb
    .from('sehatin_records')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('account_key', key)
    .order('start_date', { ascending: false });
  if (error) { showToast('Gagal memuat data'); return; }
  allData[key] = (data || []).map(function (r) {
    return {
      id: r.id,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date || null,
      symptoms: r.symptoms ? r.symptoms.split(',').filter(Boolean) : [],
      notes: r.notes || '',
      ongoing: r.ongoing || false
    };
  });
  appData = allData[key];
  if (typeof renderAll === 'function') renderAll();
}

/* ═══ SIMPAN / UBAH / HAPUS ═══ */
async function insertRecord(rec) {
  const { error } = await sb.from('sehatin_records').insert({
    id: rec.id,
    user_id: currentUser.id,
    account_key: curKey(),
    name: rec.name,
    start_date: rec.startDate,
    end_date: rec.endDate || null,
    symptoms: rec.symptoms.join(','),
    notes: rec.notes || '',
    ongoing: rec.ongoing || false
  });
  if (error) { showToast('Gagal simpan ke database'); return false; }
  return true;
}

async function updateRecord(rec) {
  const { error } = await sb.from('sehatin_records').update({
    name: rec.name,
    start_date: rec.startDate,
    end_date: rec.endDate || null,
    symptoms: rec.symptoms.join(','),
    notes: rec.notes || '',
    ongoing: rec.ongoing || false
  }).eq('id', rec.id).eq('user_id', currentUser.id);
  if (error) { showToast('Gagal update data'); return false; }
  return true;
}

async function deleteRecord(id) {
  const { error } = await sb.from('sehatin_records')
    .delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Gagal hapus data'); return false; }
  return true;
}

async function deleteAccountData(accountKey) {
  await sb.from('sehatin_records')
    .delete().eq('user_id', currentUser.id).eq('account_key', accountKey);
}

/* ═══ EXPORT EXCEL ═══
   Butuh library XLSX (lihat catatan di paling atas file ini). */
async function exportExcel() {
  if (!currentUser) return;
  showToast('Menyiapkan export...');

  const { data, error } = await sb
    .from('sehatin_records')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('start_date', { ascending: false });

  if (error) { showToast('Gagal ambil data'); return; }
  if (!data || data.length === 0) { showToast('Belum ada data untuk diexport'); return; }

  var wb = XLSX.utils.book_new();

  ACCOUNTS.forEach(function (acc) {
    var rows = data.filter(function (r) { return r.account_key === acc.key; });

    var sheetData = [['Nama Penyakit', 'Tanggal Mulai', 'Tanggal Sembuh', 'Durasi', 'Status']];

    rows.forEach(function (r) {
      var dur = r.ongoing ? 'Masih sakit' :
        (r.end_date ? Math.max(1, diffDays(r.start_date, r.end_date)) + ' hari' : '1 hari');
      sheetData.push([
        r.name,
        r.start_date,
        r.end_date || '-',
        dur,
        r.ongoing ? 'Sedang sakit' : 'Sudah sembuh'
      ]);
    });

    var finished = rows.filter(function (r) { return !r.ongoing; });
    var totalDays = 0;
    finished.forEach(function (r) {
      totalDays += r.end_date ? Math.max(1, diffDays(r.start_date, r.end_date)) : 1;
    });
    var avgDur = finished.length ? Math.round(totalDays / finished.length) : 0;

    sheetData.push([]);
    sheetData.push(['RINGKASAN']);
    sheetData.push(['Total sakit', rows.length + ' kali']);
    sheetData.push(['Total hari sakit', totalDays + ' hari']);
    sheetData.push(['Rata-rata durasi', avgDur ? avgDur + ' hari' : '-']);

    var ws = XLSX.utils.aoa_to_sheet(sheetData);
    ws['!cols'] = [{ wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    /* nama sheet Excel: max 31 char, gak boleh \ / ? * [ ] : dan harus unik */
    var base = (acc.label.replace(/[\\\/?*\[\]:]/g, ' ').trim() || 'Profil').substring(0, 28);
    var sheetName = base, n = 2;
    while (wb.SheetNames.indexOf(sheetName) !== -1) { sheetName = base + ' ' + n; n++; }
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, 'sehatin-' + todayStr() + '.xlsx');
  showToast('Export berhasil!');
}

/* ═══ EXPORT JSON ═══ */
function exportData() {
  var blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'sehatin-' + curKey() + '-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data berhasil diexport!');
}
