/* ═══════════════════════════════════════════════════════════════
   SHARED.JS — Jurnal Sehat
   Dipakai di index.html dan app.html.
   Isinya cuma hal-hal umum yang dibutuhin dimana-mana:
   - koneksi ke Supabase
   - cek "udah login belum" (auth guard)
   - dark mode
   - utils tanggal
   - toast & helper kecil

   Cara pakai: taro <script src="js/shared.js"></script> di HEAD,
   SEBELUM script lain yang butuh sb / currentUser / dst.
   ═══════════════════════════════════════════════════════════════ */

/* ═══ SUPABASE CONFIG ═══ */
const SUPABASE_URL = 'https://obpnztfbeqnbamiwbagu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9icG56dGZiZXFuYmFtaXdiYWd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NTcxMDcsImV4cCI6MjA4OTIzMzEwN30.9rIhs62HTxEqUqS6ut9dU3h7QTmvkl-k5-osFY85y44';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ═══ STATE UMUM ═══
   currentUser diisi otomatis begitu requireAuth() atau checkSession()
   berhasil. Halaman lain (data.js, script masing-masing halaman)
   tinggal baca variabel ini, gak perlu getSession() ulang. */
var currentUser = null;

/* ═══ AUTH GUARD ═══
   Panggil requireAuth() di AWAL script tiap halaman yang butuh login
   (app.html). Kalau belum login, otomatis
   ditendang balik ke index.html. Kalau udah login, currentUser keisi
   dan halaman lanjut jalan normal.

   Contoh pakai di halaman lain:
     (async function () {
       var user = await requireAuth();
       if (!user) return;   // udah di-redirect, stop di sini
       // lanjut render halaman...
     })();
*/
async function requireAuth() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.replace(getIndexPath());
    return null;
  }
  currentUser = data.session.user;
  return currentUser;
}

/* Path balik ke halaman login. */
function getIndexPath() {
  return 'index.html';
}

async function doLogout() {
  await sb.auth.signOut();
  currentUser = null;
  window.location.replace(getIndexPath());
}

/* ═══ DARK MODE ═══ */
var SVG_MOON = '<path d="M240,96a8,8,0,0,1-8,8H216v16a8,8,0,0,1-16,0V104H184a8,8,0,0,1,0-16h16V72a8,8,0,0,1,16,0V88h16A8,8,0,0,1,240,96ZM144,56h8v8a8,8,0,0,0,16,0V56h8a8,8,0,0,0,0-16h-8V32a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16Zm72.77,97a8,8,0,0,1,1.43,8A96,96,0,1,1,95.07,37.8a8,8,0,0,1,10.6,9.06A88.07,88.07,0,0,0,209.14,150.33,8,8,0,0,1,216.77,153Zm-19.39,14.88c-1.79.09-3.59.14-5.38.14A104.11,104.11,0,0,1,88,64c0-1.79,0-3.59.14-5.38A80,80,0,1,0,197.38,167.86Z"/>';
var SVG_SUN  = '<path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"/>';

function setDarkIcon(isDark) {
  var svg = '<svg viewBox="0 0 256 256" fill="currentColor">' + (isDark ? SVG_SUN : SVG_MOON) + '</svg>';
  var btn1 = document.getElementById('btn-dark');
  var btn2 = document.getElementById('btn-dark-login');
  if (btn1) btn1.innerHTML = svg;
  if (btn2) btn2.innerHTML = svg;
  var tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', isDark ? '#161819' : '#F4EFE6');
}
function toggleDark() {
  var on = document.body.classList.toggle('dark');
  localStorage.setItem('hl_dark', on ? '1' : '0');
  setDarkIcon(on);
  var btn = document.getElementById('btn-dark');
  if (btn) { btn.classList.remove('bounce'); void btn.offsetWidth; btn.classList.add('bounce'); }
}
function initDark() {
  var isDark = localStorage.getItem('hl_dark') === '1';
  if (isDark) document.body.classList.add('dark');
  setDarkIcon(isDark);
}

/* ═══ DATE UTILS ═══ */
function todayStr(){ var d=new Date(); return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function pad2(n){ return n<10?'0'+n:''+n; }
function normDate(s){
  if(!s) return '';
  s=String(s).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if(s.indexOf('T')!==-1){ var d=new Date(s); if(!isNaN(d)){ var w=new Date(d.getTime()+7*3600000); return w.getUTCFullYear()+'-'+pad2(w.getUTCMonth()+1)+'-'+pad2(w.getUTCDate()); } }
  var p=s.split('/'); if(p.length===3){ var a=parseInt(p[0],10),b=parseInt(p[1],10),c=parseInt(p[2],10); if(p[2].length===4) return c+'-'+pad2(a)+'-'+pad2(b); if(p[0].length===4) return a+'-'+pad2(b)+'-'+pad2(c); }
  return s;
}
function parseDt(s){ var iso=normDate(s); if(!iso) return new Date(NaN); return new Date(iso+'T00:00:00'); }
function diffDays(a,b){ var da=typeof a==='string'?parseDt(a):a, db=typeof b==='string'?parseDt(b):b; if(isNaN(da)||isNaN(db)) return 0; return Math.round((db-da)/86400000); }
function sortDesc(arr){ return arr.slice().sort(function(a,b){ return parseDt(b.startDate)-parseDt(a.startDate); }); }
function calcDur(s,e){ if(!e) return 1; var d=diffDays(s,e); return d<1?1:d; }
function fmtDate(s){ if(!s) return ''; var d=parseDt(s); if(isNaN(d)) return s; return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}); }
function agoTxt(s){ var d=parseDt(s); if(isNaN(d)) return ''; var days=Math.round((new Date()-d)/86400000); if(days===0) return 'Hari ini'; if(days===1) return '1 hari lalu'; if(days<0) return 'Akan datang'; return days+' hari lalu'; }

/* ═══ TOAST & HELPER ═══ */
function showToast(msg){
  var el=document.getElementById('toast');
  if(!el) return;
  el.innerHTML=msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(function(){ el.classList.remove('show'); },2800);
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
