/* ═══════════════════════════════════════════════════════════════════
   Tambahan untuk Code.gs Jurnal Keuangan: edit & hapus topup.

   Topup disimpan di log tab Investasi (kolom O..T, data mulai baris 5):
   tanggal | jenis | nominal | akun_asal | akun_tujuan | catatan
   (app_transaksi cuma tampilan dari log itu), jadi edit/hapus dilakukan di log.

   1. Paste fungsi di bawah ke Code.gs (taruh setelah addTopup_).
   2. Di doPost > switch (req.action), tambah:
        case 'editTopup':   out = editTopup_(req); break;
        case 'deleteTopup': out = deleteTopup_(req); break;
   3. Deploy > Manage deployments > pensil > Version: New version > Deploy.

   Baris dicari lewat kecocokan nilai asli (gak ada kolom id). Kalau ada baris
   yang identik, yang pertama yang kena (hasilnya sama).
   ═══════════════════════════════════════════════════════════════════ */

/* ---------------- edit / hapus topup ---------------- */
function findLog_(sh, o) {
  var n = sh.getMaxRows() - LOG_FIRST_ROW + 1;
  var v = sh.getRange(LOG_FIRST_ROW, LOG_COL, n, 6).getValues();
  var last = -1, hit = -1;
  for (var i = 0; i < v.length; i++) {
    var r = v[i];
    if (r[0] === '') continue;
    last = i;
    if (hit < 0 && iso_(r[0]) === String(o.tanggal) && Number(r[2]) === Number(o.nominal) &&
        String(r[3] || '') === String(o.dari || '') && String(r[4] || '') === String(o.ke || '') &&
        String(r[5] || '') === String(o.catatan || '')) hit = i;
  }
  if (hit < 0) throw new ApiError('Top-up row not found (maybe changed in the sheet). Refresh first.');
  return { row: LOG_FIRST_ROW + hit, last: LOG_FIRST_ROW + last };
}

function editTopup_(req) {
  var o = req.orig || {}, n = req.next || {};
  var tgl = parseDate_(n.tanggal);
  var nominal = Number(n.nominal);
  if (!isFinite(nominal) || nominal <= 0 || nominal > 1e11) throw new ApiError('Invalid amount');
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (iso_(tgl) > today) throw new ApiError('Date cannot be in the future');

  var ss = SpreadsheetApp.openById(prop_('SHEET_ID'));
  var aktif = table_(ss, TAB.akun).filter(function (r) { return r.aktif === true; }).map(function (r) { return r.akun; });
  var ke = String(o.ke || '');
  if (aktif.indexOf(ke) < 0) throw new ApiError('Unknown destination account');
  var dari = String(n.dari || '');
  if (dari && dari !== 'Rekening Utama' && aktif.indexOf(dari) < 0) throw new ApiError('Unknown source account');
  if (dari === ke) throw new ApiError('Source and destination are the same');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = ss.getSheetByName(TAB.inv);
    var f = findLog_(sh, o);
    sh.getRange(f.row, LOG_COL, 1, 6).setValues([[tgl, dari ? 'Transfer' : 'Topup', nominal, dari, ke, safeText_(n.catatan)]]);
    SpreadsheetApp.flush();
    return { row: f.row };
  } finally { lock.releaseLock(); }
}

function deleteTopup_(req) {
  var o = req.orig || {};
  var ss = SpreadsheetApp.openById(prop_('SHEET_ID'));
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = ss.getSheetByName(TAB.inv);
    var f = findLog_(sh, o);
    // geser isi log di bawahnya naik satu baris, hanya kolom O..T (kolom lain di tab Investasi gak disentuh)
    if (f.last > f.row) {
      var below = sh.getRange(f.row + 1, LOG_COL, f.last - f.row, 6).getValues();
      sh.getRange(f.row, LOG_COL, below.length, 6).setValues(below);
    }
    sh.getRange(f.last, LOG_COL, 1, 6).clearContent();
    SpreadsheetApp.flush();
    return { deleted: true };
  } finally { lock.releaseLock(); }
}
