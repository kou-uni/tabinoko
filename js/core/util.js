/* util.js — 依存のない小道具。 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});
  const params = new URLSearchParams(location.search);
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const pad = (n) => String(n).padStart(2, '0');

  const util = {
    /** テスト用フック: ?now=2026-10-31T10:00:00+05:30 または ?today=2026-11-01 */
    now() {
      const n = params.get('now');
      if (n) { const d = new Date(n); if (!isNaN(d)) return d; }
      const t = params.get('today');
      if (t && /^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(t + 'T12:00:00');
      return new Date();
    },
    /** 端末のローカル日付 YYYY-MM-DD（旅先で端末が時刻帯を切り替えるのでそれに従う） */
    todayISO() { const d = util.now(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
    isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); },
    parseDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); },
    addDays(iso, n) { const d = util.parseDate(iso); d.setDate(d.getDate() + n); return util.isoOf(d); },
    /** '2026-10-31' -> '10/31（土）' */
    dayLabel(iso) { const d = util.parseDate(iso); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）'; },
    weekday(iso) { return WD[util.parseDate(iso).getDay()]; },
    daysBetween(a, b) { return Math.round((util.parseDate(b) - util.parseDate(a)) / 86400000); },

    uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
    iso() { return util.now().toISOString(); },
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    clamp(n, a, b) { return Math.min(b, Math.max(a, n)); },
    debounce(fn, ms) { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; return f; },
    clone(x) { return x == null ? x : (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x))); },

    /** 同じ文が続かないように選ぶ。key ごとに直近2件を覚える。 */
    pickFresh(key, arr) {
      if (!arr.length) return '';
      const mem = (util._fresh = util._fresh || {});
      const recent = mem[key] || (mem[key] = []);
      let pool = arr.map((_, i) => i).filter((i) => !recent.includes(i));
      if (!pool.length) pool = arr.map((_, i) => i);
      const i = pool[Math.floor(Math.random() * pool.length)];
      recent.push(i); while (recent.length > Math.min(2, arr.length - 1)) recent.shift();
      return arr[i];
    },
    /** 文字列テンプレートに {name} を差し込む。無いキーは空文字。 */
    fill(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : '')); },

    /** X の字数（重み付き 280）。URL は 23。日本語など全角は 2。 */
    xLength(text) {
      let n = 0;
      const t = String(text).replace(/https?:\/\/\S+/g, () => { n += 23; return ''; });
      for (const ch of t) {
        const c = ch.codePointAt(0);
        n += (c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037)) ? 1 : 2;
      }
      return n;
    },
    X_LIMIT: 280,

    /** クリックハンドラの中から「同期的に」呼ぶ。await の後では iOS で失効する。 */
    copy(text) {
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).catch(() => {}); ok = true; }
      } catch (e) { ok = false; }
      if (ok) return true;
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
        ok = document.execCommand('copy'); ta.remove();
      } catch (e) { ok = false; }
      return ok;
    },

    xIntentUrl(text) { return 'https://x.com/intent/post?text=' + encodeURIComponent(text); },
    /** 地図アプリへのリンク。app: 'google' | 'apple' | 'osm' */
    mapLink(spot, app) {
      const q = encodeURIComponent(spot.query || spot.name || (spot.lat + ',' + spot.lng));
      if (app === 'apple') return 'https://maps.apple.com/?ll=' + spot.lat + ',' + spot.lng + '&q=' + encodeURIComponent(spot.name || '');
      if (app === 'osm') return 'https://www.openstreetmap.org/?mlat=' + spot.lat + '&mlon=' + spot.lng + '#map=16/' + spot.lat + '/' + spot.lng;
      return 'https://www.google.com/maps/search/?api=1&query=' + (spot.lat != null ? spot.lat + ',' + spot.lng : q);
    },

    isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
    isStandalone() { return !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)); },
    isOnline() { return navigator.onLine !== false; },
    param(name) { return params.get(name); },

    loadScript(src) {
      return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load failed: ' + src)); document.head.appendChild(s); });
    },
    loadCSS(href) {
      if (document.querySelector('link[href="' + href + '"]')) return;
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
    },
  };
  T.util = util;
})();
