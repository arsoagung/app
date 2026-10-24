/* ═══════════════════════════════════════════════════════════════════
   Tambahan untuk Code.gs Jurnal Keuangan: edit & hapus topup.
   Belum ke-deploy otomatis. Langkah:
   1. Paste dua fungsi di bawah ke Code.gs.
   2. Di router (tempat 'read' dan 'saveUpdate' ditangani, setelah token +
      whitelist lolos) tambahkan:
         case 'editTopup':   return <bungkus seperti saveUpdate>(editTopup_(p));
         case 'deleteTopup': return <bungkus seperti saveUpdate>(deleteTopup_(p));
      p = body request (p.orig, p.next).
   3. Deploy > Manage deployments > edit versi > New version.

   Tab app_transaksi gak punya kolom id, jadi baris dicari lewat kecocokan
   nilai asli: tanggal, nominal, akun_tujuan (ke), akun_asal (dari), catatan.
   Kalau ada beberapa baris identik, yang pertama yang diubah/dihapus (hasilnya
   sama saja karena isinya identik).
   ═══════════════════════════════════════════════════════════════════ */

function findTopupRow_(sh, o) {
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var v = sh.getDataRange().getValues();
  var h = v[0].map(String), c = {};
  ['tanggal', 'jenis', 'nominal', 'akun_asal', 'akun_tujuan', 'catatan'].forEach(function (k) { c[k] = h.indexOf(k); });
  for (var k in c) if (c[k] < 0) throw new Error('Kolom ' + k + ' gak ada di app_transaksi');
  var num = function (x) { return Number(String(x).replace(/\D/g, '')) || 0; };
  var day = function (x) { return x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : String(x).slice(0, 10); };
  for (var r = 1; r < v.length; r++) {
    var row = v[r];
    if (day(row[c.tanggal]) === o.tanggal && num(row[c.nominal]) === Number(o.nominal) &&
        String(row[c.akun_tujuan]) === String(o.ke) && String(row[c.akun_asal] || '') === String(o.dari || '') &&
        String(row[c.catatan] || '') === String(o.catatan || '')) return { row: r + 1, c: c };
  }
  throw new Error('Baris topup gak ketemu (mungkin sudah diubah dari sheet). Refresh dulu.');
}

function editTopup_(p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName('app_transaksi');
    var f = findTopupRow_(sh, p.orig), n = p.next;
    sh.getRange(f.row, f.c.tanggal + 1).setValue(n.tanggal);
    sh.getRange(f.row, f.c.nominal + 1).setValue(Number(n.nominal));
    sh.getRange(f.row, f.c.akun_asal + 1).setValue(n.dari || '');
    sh.getRange(f.row, f.c.catatan + 1).setValue(n.catatan || '');
    return { edited: true };
  } finally { lock.releaseLock(); }
}

function deleteTopup_(p) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName('app_transaksi');
    sh.deleteRow(findTopupRow_(sh, p.orig).row);
    return { deleted: true };
  } finally { lock.releaseLock(); }
}
