/**
 * Jurnal Keuangan API (Google Apps Script web app)
 *
 * Semua request = POST, body JSON (Content-Type: text/plain biar tanpa preflight CORS):
 *   { token, action: 'read' }
 *   { token, action: 'addTopup', tanggal:'2026-10-16', nominal:300000, ke:'Bibit Dana Darurat', dari:'', catatan:'' }
 *   { token, action: 'setSaldo', akun:'Pluang USD', bulan:'2026-10', saldo:64349849 }
 *   { token, action: 'saveUpdate', akun:'Pluang USD', saldo:64349849, checkpoint:false, bulan:'2026-10',
 *     topup:{ tanggal:'2026-10-16', nominal:1000000, dari:'', catatan:'' } }   // topup opsional
 * `token` = access_token sesi Supabase (Google login). Diverifikasi ke Supabase, lalu email dicek whitelist.
 *
 * Script properties (Project Settings > Script properties):
 *   SHEET_ID         id spreadsheet "Jurnal Keuangan"
 *   SUPABASE_URL     https://xxxx.supabase.co
 *   SUPABASE_KEY     publishable / anon key project Supabase (boleh publik)
 *   ALLOWED_EMAILS   email whitelist, pisah koma
 */

var TZ = 'Asia/Jakarta';
var TAB = { akun: 'app_akun', saldo: 'app_saldo', trx: 'app_transaksi', inv: 'Investasi', nw: 'Net Worth', upd: 'app_update' };
var UPD_HEAD = ['akun', 'bulan', 'tanggal', 'checkpoint'];

// Akun yang saldonya diinput lewat tab Investasi (kolom B..D, baris JUL=5 .. DES=10)
var INV_COL = { 'Bibit Pendidikan Kael': 2, 'Bibit Dana Darurat': 3, 'Pluang USD': 4 };
var INV_FIRST_MONTH = 7, INV_FIRST_ROW = 5;
// Akun yang saldonya langsung di Net Worth (baris), kolom = bulan + 2 (JAN=C)
var NW_ROW = { 'Bibit Pendidikan Kael': 3, 'Bibit Dana Darurat': 4, 'Pluang USD': 5, 'Superbank Dana Darurat': 6 };
// Log topup di Investasi: O..T, header baris 4, data mulai baris 5
var LOG_COL = 15, LOG_FIRST_ROW = 5;

function doPost(e) {
  try {
    var req = JSON.parse((e.postData && e.postData.contents) || '{}');
    var email = verify_(req.token);
    var out;
    switch (req.action) {
      case 'read':     out = readAll_(); break;
      case 'addTopup': out = addTopup_(req); break;
      case 'setSaldo': out = setSaldo_(req); break;
      case 'saveUpdate': out = saveUpdate_(req); break;
      case 'editTopup':   out = editTopup_(req); break;
      case 'deleteTopup': out = deleteTopup_(req); break;
      default: throw new ApiError('Unknown action', 400);
    }
    return json_({ ok: true, user: email, data: out });
  } catch (err) {
    var status = err instanceof ApiError ? err.status : 500;
    if (!(err instanceof ApiError)) console.error(err && err.stack || err);
    return json_({ ok: false, status: status, error: err instanceof ApiError ? err.message : 'Server error',
      detail: err instanceof ApiError ? undefined : String(err && err.message || err).slice(0, 200) });
  }
}

// Biar buka URL di browser tidak bocor apa-apa
function doGet() { return json_({ ok: true, service: 'jurnal-keuangan' }); }

/* ---------------- auth ---------------- */
function ApiError(msg, status) { this.message = msg; this.status = status || 400; }
ApiError.prototype = Object.create(Error.prototype);

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing script property: ' + k);
  return v;
}

function verify_(token) {
  if (!token || typeof token !== 'string') throw new ApiError('Not signed in', 401);
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var hit = cache.get(key);
  if (hit) return hit;

  var res = UrlFetchApp.fetch(prop_('SUPABASE_URL').replace(/\/$/, '') + '/auth/v1/user', {
    method: 'get', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, apikey: prop_('SUPABASE_KEY') }
  });
  if (res.getResponseCode() !== 200) throw new ApiError('Session expired, please sign in again', 401);
  var user = JSON.parse(res.getContentText());
  var email = String(user.email || '').toLowerCase();
  var allowed = prop_('ALLOWED_EMAILS').toLowerCase().split(',').map(function (s) { return s.trim(); });
  if (!email || (!user.email_confirmed_at && !user.confirmed_at) || allowed.indexOf(email) < 0)
    throw new ApiError('This account is not allowed', 403);
  cache.put(key, email, 300); // cache 5 menit
  return email;
}

/* ---------------- read ---------------- */
function readAll_() {
  var ss = SpreadsheetApp.openById(prop_('SHEET_ID'));
  SpreadsheetApp.flush();
  var akun = table_(ss, TAB.akun).map(function (r) {
    return { akun: r.akun, nama: r.nama_tampil || r.akun, tujuan: r.tujuan, jenis: r.jenis,
      ikutReturn: r.ikut_return === true, aktif: r.aktif === true, urutan: Number(r.urutan) || 0,
      returnMulai: r.return_mulai ? iso_(r.return_mulai) : null };
  }).filter(function (r) { return r.akun; });
  var saldo = table_(ss, TAB.saldo).filter(function (r) { return r.akun && r.tanggal && r.saldo !== ''; })
    .map(function (r) { return { tanggal: iso_(r.tanggal), akun: r.akun, saldo: Number(r.saldo) }; });
  var transaksi = table_(ss, TAB.trx).filter(function (r) { return r.tanggal && r.nominal !== ''; })
    .map(function (r) { return { tanggal: iso_(r.tanggal), jenis: r.jenis, nominal: Number(r.nominal),
      dari: r.akun_asal || '', ke: r.akun_tujuan || '', catatan: r.catatan || '' }; });
  return { today: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), akun: akun, saldo: saldo, transaksi: transaksi, updates: updates_(ss) };
}

function table_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Missing tab: ' + name);
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  var h = v[0].map(String);
  return v.slice(1).map(function (row) {
    var o = {}; h.forEach(function (k, i) { o[k] = row[i]; }); return o;
  });
}
function iso_(d) {
  return d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : String(d).slice(0, 10);
}

/* ---------------- write: topup ---------------- */
function addTopup_(req) {
  var tgl = parseDate_(req.tanggal);
  var nominal = Number(req.nominal);
  if (!isFinite(nominal) || nominal <= 0 || nominal > 1e11) throw new ApiError('Invalid amount');
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (iso_(tgl) > today) throw new ApiError('Date cannot be in the future');

  var ss = SpreadsheetApp.openById(prop_('SHEET_ID'));
  var aktif = table_(ss, TAB.akun).filter(function (r) { return r.aktif === true; }).map(function (r) { return r.akun; });
  var ke = String(req.ke || '');
  if (aktif.indexOf(ke) < 0) throw new ApiError('Unknown destination account');
  var dari = String(req.dari || '');
  if (dari && dari !== 'Rekening Utama' && aktif.indexOf(dari) < 0) throw new ApiError('Unknown source account');
  if (dari === ke) throw new ApiError('Source and destination are the same');
  var jenis = dari ? 'Transfer' : 'Topup';

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = ss.getSheetByName(TAB.inv);
    var col = sh.getRange(LOG_FIRST_ROW, LOG_COL, sh.getMaxRows() - LOG_FIRST_ROW + 1, 1).getValues();
    var last = 0;
    for (var i = col.length - 1; i >= 0; i--) if (col[i][0] !== '') { last = i + 1; break; }
    var row = LOG_FIRST_ROW + last;
    var cell = sh.getRange(row, LOG_COL, 1, 6);
    // salin format dari baris log sebelumnya (tanggal, angka) biar seragam
    if (last > 0) sh.getRange(row - 1, LOG_COL, 1, 6).copyTo(cell, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    cell.setValues([[tgl, jenis, nominal, dari, ke, safeText_(req.catatan)]]);
    SpreadsheetApp.flush();
    return { row: row, jenis: jenis };
  } finally { lock.releaseLock(); }
}

/* ---------------- write: saldo ---------------- */
function setSaldo_(req) {
  var akun = String(req.akun || ''), saldo = Number(req.saldo);
  if (!isFinite(saldo) || saldo < 0 || saldo > 1e12) throw new ApiError('Invalid balance');
  var m = /^(\d{4})-(\d{2})$/.exec(String(req.bulan || ''));
  if (!m) throw new ApiError('Invalid month (YYYY-MM)');
  var year = Number(m[1]), month = Number(m[2]);
  var ss = SpreadsheetApp.openById(prop_('SHEET_ID'));
  if (year !== Number(ss.getSheetByName(TAB.inv).getRange('E1').getValue())) throw new ApiError('Year is outside the Investasi tab');
  if (month < 1 || month > 12) throw new ApiError('Invalid month');
  if (!(akun in NW_ROW)) throw new ApiError('This account cannot be updated from the app');

  var nw = ss.getSheetByName(TAB.nw);
  var nwCol = month + 2; // JAN=C(3)
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (akun in INV_COL) {
      if (month < INV_FIRST_MONTH) throw new ApiError('That month is not in the Investasi tab');
      var invCell = ss.getSheetByName(TAB.inv).getRange(INV_FIRST_ROW + month - INV_FIRST_MONTH, INV_COL[akun]);
      invCell.setValue(saldo);
      // Net Worth bulan itu: kalau masih kosong, hubungkan ke Investasi (Agu-Okt sudah terhubung)
      var nwCell = nw.getRange(NW_ROW[akun], nwCol);
      if (nwCell.getFormula() === '' && nwCell.getValue() === '') nwCell.setFormula('=' + invCell.getA1Notation().replace(/^/, TAB.inv + '!'));
      return { sel: TAB.inv + '!' + invCell.getA1Notation() };
    }
    var c = nw.getRange(NW_ROW[akun], nwCol);
    if (c.getFormula() !== '') throw new ApiError('Cell contains a formula, not overwritten');
    c.setValue(saldo);
    return { sel: TAB.nw + '!' + c.getA1Notation() };
  } finally { lock.releaseLock(); }
}

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
    // geser isi log di bawahnya naik satu baris, hanya kolom O..T
    if (f.last > f.row) {
      var below = sh.getRange(f.row + 1, LOG_COL, f.last - f.row, 6).getValues();
      sh.getRange(f.row, LOG_COL, below.length, 6).setValues(below);
    }
    sh.getRange(f.last, LOG_COL, 1, 6).clearContent();
    SpreadsheetApp.flush();
    return { deleted: true };
  } finally { lock.releaseLock(); }
}

/* ---------------- write: saldo + topup opsional + checkpoint akhir bulan ---------------- */
// checkpoint=true  -> saldo masuk ke bulan `bulan` (bulan ini atau bulan lalu). Kalau bulan lalu, nilai yang sama
//                     juga ditulis ke bulan berjalan (live) supaya net worth bulan ini tidak kosong.
// checkpoint=false -> saldo masuk ke bulan berjalan.
function saveUpdate_(req) {
  var akun = String(req.akun || '');
  var saldo = Number(req.saldo);
  if (!isFinite(saldo) || saldo < 0 || saldo > 1e12) throw new ApiError('Invalid balance');
  var ss = SpreadsheetApp.openById(prop_('SHEET_ID'));
  var info = table_(ss, TAB.akun).filter(function (r) { return r.akun === akun && r.aktif === true; })[0];
  if (!info) throw new ApiError('Unknown account');

  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var cur = today.slice(0, 7), prev = prevMonth_(today);
  var cp = req.checkpoint === true;
  var bulan = cp ? String(req.bulan || '') : cur;
  if (cp && bulan !== cur && bulan !== prev) throw new ApiError('Month-end must be this month or last month');
  var tp = req.topup && Number(req.topup.nominal) > 0 ? req.topup : null;
  if (tp && info.jenis === 'cair') throw new ApiError('This account does not take top-ups');
  if (tp && cp && bulan === prev) throw new ApiError('No top-up when closing last month');
  if (tp && Number(tp.nominal) > saldo) throw new ApiError('The balance should include the top-up');

  var out = {};
  if (tp) out.topup = addTopup_({ tanggal: tp.tanggal, nominal: tp.nominal, ke: akun, dari: tp.dari, catatan: tp.catatan });
  out.saldo = setSaldo_({ akun: akun, bulan: bulan, saldo: saldo });
  if (cp && bulan === prev) {
    try { setSaldo_({ akun: akun, bulan: cur, saldo: saldo }); }
    catch (e) { if (!(e instanceof ApiError)) throw e; }   // mis. sel berformula / beda tahun: abaikan
  }
  logUpdate_(ss, akun, bulan, today, cp);
  return out;
}

function prevMonth_(iso) {
  var y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1;
  if (m < 1) { m = 12; y--; }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

// Log tiap update: kapan terakhir diupdate + checkpoint akhir bulan (tab dibuat otomatis kalau belum ada)
function logUpdate_(ss, akun, bulan, today, cp) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = ss.getSheetByName(TAB.upd);
    if (!sh) {
      sh = ss.insertSheet(TAB.upd);
      sh.getRange(1, 1, 1, 4).setValues([UPD_HEAD]);
      sh.getRange('B:B').setNumberFormat('@');          // '2026-10' jangan dibaca jadi tanggal
      sh.getRange('C:C').setNumberFormat('yyyy-mm-dd');
      sh.setFrozenRows(1);
    }
    var row = sh.getLastRow() + 1;
    sh.getRange(row, 2).setNumberFormat('@');
    sh.getRange(row, 1, 1, 4).setValues([[akun, bulan, parseDate_(today), cp]]);
  } finally { lock.releaseLock(); }
}

function updates_(ss) {
  if (!ss.getSheetByName(TAB.upd)) return [];
  return table_(ss, TAB.upd).filter(function (r) { return r.akun && r.bulan && r.tanggal; }).map(function (r) {
    var b = r.bulan instanceof Date ? Utilities.formatDate(r.bulan, TZ, 'yyyy-MM') : String(r.bulan).slice(0, 7);
    return { akun: r.akun, bulan: b, tanggal: iso_(r.tanggal), checkpoint: r.checkpoint === true };
  });
}

/* ---------------- util ---------------- */
function parseDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) throw new ApiError('Invalid date');
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  if (d.getMonth() !== Number(m[2]) - 1) throw new ApiError('Invalid date');
  return d;
}
function safeText_(s) {
  s = String(s || '').trim().slice(0, 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- tes manual dari editor (Run > pilih fungsi) ---------------- */
function testRead() {
  var d = readAll_();
  Logger.log('akun=%s saldo=%s transaksi=%s today=%s', d.akun.length, d.saldo.length, d.transaksi.length, d.today);
}