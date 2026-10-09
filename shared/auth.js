/* ═══════════════════════════════════════════════════════════════════
   shared/auth.js — login seragam untuk semua app personal
   (Coffeelog, Targetin, KarNote, Sehatin)

   Ngapain aja:
   - bikin satu Supabase client (URL + anon key cuma ada di file ini)
   - nampilin layar login yang sama di semua app (beda nama/ikon/warna aja)
   - login Google, cek whitelist (is_allowed), logout
   - nanganin sesi: SIGNED_IN yang muncul lagi pas tab dibuka ulang
     gak bikin app reload data (cuma user yang beda yang diproses)

   Cara pakai di tiap app (urutan script penting):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.min.js"></script>
     <script src="../shared/auth.js"></script>
     <script>
       const sb = Auth.client;
       Auth.init({
         name: 'Coffeelog', tagline: '...', accent: '#D97757', icon: '<svg ...>',
         onSignIn:  function (user) { ... },   // sudah lolos whitelist
         onSignOut: function () { ... }        // user klik keluar
       });
     </script>
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ═══ SERVICE WORKER (offline) — sw.js ada di folder induk shared/ ═══ */
  try {
    var _src = document.currentScript && document.currentScript.src;
    var _secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (_src && _secure && 'serviceWorker' in navigator) {
      var _sw = new URL('../sw.js', _src).href;
      global.addEventListener('load', function () {
        navigator.serviceWorker.register(_sw).catch(function () {});
      });
    }
  } catch (e) {}

  /* ═══ KONFIGURASI SUPABASE (satu-satunya tempat) ═══ */
  var SUPABASE_URL = 'https://kkrphmvdxxpzdglljoqa.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrcnBobXZkeHhwemRnbGxqb3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NDExODIsImV4cCI6MjEwNzAxNzE4Mn0.eN7KzESeMbd2y-ZGq16G9WvFsYuvFOeHSAC72WPyGR0';

  var client = global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var MSG_DENIED = 'Akun ini tidak diizinkan. Pakai email yang terdaftar.';
  var DENIED_FLAG = 'auth_denied';
  var VERIFIED_KEY = 'auth_verified';
  var VERIFIED_MAX_AGE = 30 * 24 * 3600 * 1000;   // 30 hari

  var opts = null;      // konfigurasi dari app
  var root = null;      // elemen overlay
  var user = null;      // user yang sudah lolos whitelist
  var admitting = false;
  var denying = false;
  var pendingUser = null;
  var urlError = '';

  /* ═══ STYLE ═══ */
  var CSS = [
    '#auth-root{position:fixed;inset:0;z-index:2147483000;background:#0e0e10;color:#f2f2f0;',
    'font-family:"Plus Jakarta Sans",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;',
    'display:flex;align-items:flex-start;justify-content:center;',
    'padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom));overflow:auto}',
    '#auth-root[hidden]{display:none}',
    '#auth-root *{box-sizing:border-box;margin:0;padding:0}',
    '#auth-root .au-wrap{width:100%;max-width:340px;display:flex;flex-direction:column;align-items:center;text-align:center;margin-top:clamp(56px,24vh,220px)}',
    '#auth-root .au-ico{width:76px;height:76px;border-radius:24px;display:grid;place-items:center;color:var(--acc);',
    'background:rgba(255,255,255,.07);background:color-mix(in srgb,var(--acc) 14%,#0e0e10);margin-bottom:22px}',
    '#auth-root .au-ico svg{width:38px;height:38px}',
    '#auth-root .au-title{font-size:30px;font-weight:800;letter-spacing:-.02em;line-height:1.15}',
    '#auth-root .au-tag{font-size:14px;line-height:1.6;color:#8a8b94;margin:8px 0 36px}',
    '#auth-root .au-btn{width:100%;height:52px;border:0;border-radius:16px;background:#fff;color:#1a1a1c;',
    'font:600 15px/1 "Plus Jakarta Sans",system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:10px;',
    'cursor:pointer;transition:transform .12s,opacity .12s}',
    '#auth-root .au-btn:active{transform:scale(.98)}',
    '#auth-root .au-btn:disabled{opacity:.6;cursor:default}',
    '#auth-root .au-btn:focus-visible,#auth-root .au-link:focus-visible{outline:2px solid var(--acc);outline-offset:3px}',
    '#auth-root .au-btn svg{width:20px;height:20px}',
    '#auth-root .au-link{margin-top:14px;background:none;border:0;color:#8a8b94;font:600 13px "Plus Jakarta Sans",system-ui,sans-serif;cursor:pointer;padding:6px}',
    '#auth-root .au-msg{min-height:20px;margin-top:16px;font-size:13px;line-height:1.5;color:#ff7a7a}',
    '#auth-root .au-foot{margin-top:28px;font-size:12px;line-height:1.5;color:#5a5b64}',
    '#auth-root .au-load{display:none;align-items:center;gap:12px;color:#8a8b94;font-size:14px;height:52px}',
    '#auth-root .au-spin{width:22px;height:22px;border-radius:50%;border:2.5px solid rgba(255,255,255,.12);border-top-color:var(--acc);animation:au-spin .8s linear infinite}',
    '@keyframes au-spin{to{transform:rotate(360deg)}}',
    '@media (prefers-reduced-motion:reduce){#auth-root .au-spin{animation-duration:2.4s}}',
    '#auth-root .au-login,#auth-root .au-retry{display:none;width:100%;flex-direction:column;align-items:center}',
    '#auth-root[data-state="loading"] .au-load{display:flex}',
    '#auth-root[data-state="login"] .au-login{display:flex}',
    '#auth-root[data-state="retry"] .au-retry{display:flex}'
  ].join('');

  var G_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.4 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.8 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.4 6.1 29.5 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.3 0 10.1-2 13.7-5.4l-6.3-5.3C29.3 34.9 26.8 36 24 36c-5.3 0-9.8-3.4-11.4-8.1l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.4-2.4 4.4-4.4 5.8l6.3 5.3C40.9 36.6 43 30.9 43 24c0-1.4-.1-2.4-.4-3.5z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureHead() {
    if (!document.getElementById('auth-style')) {
      var st = document.createElement('style');
      st.id = 'auth-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (!document.querySelector('link[href*="Plus+Jakarta+Sans"]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap';
      document.head.appendChild(l);
    }
  }

  /* ═══ OVERLAY ═══ */
  function mount() {
    ensureHead();
    root = document.createElement('div');
    root.id = 'auth-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Masuk ke ' + opts.name);
    root.style.setProperty('--acc', opts.accent || '#c8f135');
    root.dataset.state = 'loading';
    root.innerHTML =
      '<div class="au-wrap">' +
        '<div class="au-ico">' + (opts.icon || '') + '</div>' +
        '<h1 class="au-title">' + esc(opts.name) + '</h1>' +
        '<p class="au-tag">' + esc(opts.tagline || '') + '</p>' +
        '<div class="au-load"><div class="au-spin"></div><span data-el="loadtxt">Memuat…</span></div>' +
        '<div class="au-login"><button class="au-btn" type="button" data-act="google">' + G_ICON + 'Masuk dengan Google</button></div>' +
        '<div class="au-retry"><button class="au-btn" type="button" data-act="retry">Coba lagi</button>' +
          '<button class="au-link" type="button" data-act="out">Keluar</button></div>' +
        '<p class="au-msg" role="alert" aria-live="polite" data-el="msg"></p>' +
        '<p class="au-foot">Akses pribadi · hanya untuk akun yang terdaftar</p>' +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'google') signInGoogle(b);
      else if (act === 'retry' && pendingUser) admit(pendingUser);
      else if (act === 'out') { client.auth.signOut(); setState('login', ''); }
    });
  }

  function setState(state, msg, loadTxt) {
    if (!root) return;
    root.hidden = false;
    root.dataset.state = state;
    root.querySelector('[data-el="msg"]').textContent = msg || '';
    if (loadTxt) root.querySelector('[data-el="loadtxt"]').textContent = loadTxt;
    var g = root.querySelector('[data-act="google"]');
    if (g) g.disabled = false;
  }

  function hide() { if (root) root.hidden = true; }

  /* ═══ LOGIN / WHITELIST ═══ */
  async function signInGoogle(btn) {
    if (btn) btn.disabled = true;
    root.querySelector('[data-el="msg"]').textContent = '';
    var r = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + location.pathname.replace(/index\.html$/, ''),
        queryParams: { prompt: 'select_account' }
      }
    });
    if (r.error) setState('login', 'Login gagal: ' + r.error.message);
  }

  /* true = boleh, false = ditolak, null = gagal ngecek (jaringan dsb) */
  async function isAllowed() {
    try {
      var r = await client.rpc('is_allowed');
      if (r.error) return null;
      return r.data === true;
    } catch (e) { return null; }
  }

  /* Saat offline whitelist gak bisa dicek. Kalau akun ini pernah lolos < 30 hari lalu,
     tetap boleh buka app (data di server tetap dijaga RLS, jadi aman). */
  function verifiedRecently(id) {
    try {
      var v = JSON.parse(localStorage.getItem(VERIFIED_KEY) || 'null');
      return !!(v && v.id === id && Date.now() - v.t < VERIFIED_MAX_AGE);
    } catch (e) { return false; }
  }
  function markVerified(id) {
    try { localStorage.setItem(VERIFIED_KEY, JSON.stringify({ id: id, t: Date.now() })); } catch (e) {}
  }

  async function admit(u) {
    if (admitting) return;
    admitting = true;
    pendingUser = u;
    setState('loading', '', 'Memeriksa akses…');
    var ok = await isAllowed();
    admitting = false;
    if (ok === null && verifiedRecently(u.id)) ok = true;     // offline / server gangguan
    else if (ok === true) markVerified(u.id);
    if (ok === null) {
      setState('retry', 'Gagal memeriksa akses. Cek koneksi lalu coba lagi.');
      return;
    }
    if (ok === false) {
      denying = true;
      await client.auth.signOut();
      setState('login', MSG_DENIED);
      return;
    }
    user = u;
    pendingUser = null;
    hide();
    if (opts.onSignIn) opts.onSignIn(u);
  }

  function handleSignedOut() {
    if (denying) { denying = false; return; }
    var was = !!user;
    user = null;
    pendingUser = null;
    if (was) {
      setState('login', '');
      if (opts.onSignOut) opts.onSignOut();
    }
  }

  function readUrlError() {
    var raw = (location.hash || '').replace(/^#/, '') || (location.search || '').replace(/^\?/, '');
    var d = new URLSearchParams(raw).get('error_description');
    if (d) history.replaceState(null, '', location.pathname);
    var denied = '';
    try { denied = sessionStorage.getItem(DENIED_FLAG) || ''; sessionStorage.removeItem(DENIED_FLAG); } catch (e) {}
    return (d || denied) ? MSG_DENIED : '';
  }

  /* ═══ INIT ═══ */
  function init(o) {
    opts = o;
    var go = function () {
      urlError = readUrlError();
      mount();

      client.auth.onAuthStateChange(function (event, session) {
        if (event === 'SIGNED_OUT') { handleSignedOut(); return; }
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (session && user) user = session.user;
          return;
        }
        if (session && session.user) {
          /* SIGNED_IN muncul lagi tiap tab dibuka ulang: user sama → abaikan */
          if (user && user.id === session.user.id) { user = session.user; return; }
          /* jangan await panggilan Supabase di dalam callback ini */
          setTimeout(function () { admit(session.user); }, 0);
        } else if (event === 'INITIAL_SESSION') {
          setState('login', urlError);
        }
      });

      /* jaring pengaman kalau INITIAL_SESSION gak pernah datang */
      setTimeout(async function () {
        if (root.dataset.state !== 'loading' || admitting || user) return;
        var r = await client.auth.getSession();
        if (r.data && r.data.session) admit(r.data.session.user);
        else setState('login', urlError);
      }, 4000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }

  /* keluar (dipakai tombol Keluar di tiap app) */
  async function signOut(o) {
    if (o && o.denied) { try { sessionStorage.setItem(DENIED_FLAG, '1'); } catch (e) {} }
    return client.auth.signOut();
  }

  global.Auth = {
    client: client,
    init: init,
    signOut: signOut,
    isAllowed: isAllowed,
    get user() { return user; }
  };
})(window);
