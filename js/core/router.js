/* router.js — モジュール登録・ハッシュルーター・下部タブ/ヘッダーの組み立て。
 *
 * Tabi.register({
 *   id: 'plan',
 *   routes: ['plan'],                   // 省略時 [id]。最初のものが代表
 *   tab:    { label, icon, order, accent? }       // 下部タブに出す（最大5。order 昇順）
 *   header: { label, icon, order }                // 右上の小ボタンに出す
 *   firstRun: true,                     // 初回起動（settings.onboardedAt が無い）の入口になる
 *   hideNav: true | ['welcome'],        // その画面では下部タブを隠す
 *   init(): Promise|void,               // 起動時 1 回（store 準備後）
 *   render(root, params, route): fn|Promise<fn>|void   // fn は画面を離れる時の後始末
 * })
 * 画面遷移: <button data-route="post" data-params='{"angle":"finalist"}'> または Tabi.router.go('post',{angle:'finalist'})
 * URL は #route?k=v 。 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});
  const U = T.util, esc = U.esc;
  const mods = [];
  T.modules = mods;
  T.register = function (def) {
    if (!def || !def.id) throw new Error('module id がありません');
    def.routes = def.routes && def.routes.length ? def.routes : [def.id];
    const i = mods.findIndex((m) => m.id === def.id);
    if (i >= 0) mods[i] = def; else mods.push(def);
    return def;
  };

  let cleanup = null, token = 0, current = { route: '', params: {} };
  const rootEl = () => document.getElementById('main');
  const findMod = (route) => mods.find((m) => m.routes.includes(route));
  const firstRunMod = () => mods.find((m) => m.firstRun);
  const defaultRoute = () => { const t = tabs()[0]; return t ? t.route : (mods[0] && mods[0].routes[0]) || ''; };
  const tabs = () => mods.filter((m) => m.tab).map((m) => Object.assign({ route: m.routes[0], mod: m }, m.tab)).sort((a, b) => (a.order || 0) - (b.order || 0));
  const headers = () => mods.filter((m) => m.header).map((m) => Object.assign({ route: m.routes[0] }, m.header)).sort((a, b) => (a.order || 0) - (b.order || 0));

  function parse(hash) {
    const h = String(hash || '').replace(/^#/, '');
    const [route, qs] = h.split('?');
    const params = {};
    new URLSearchParams(qs || '').forEach((v, k) => { params[k] = v; });
    return { route: route || '', params };
  }
  function href(route, params) {
    const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    return '#' + route + qs;
  }

  function buildChrome(route) {
    const mod = findMod(route);
    const nav = document.getElementById('nav');
    if (nav) {
      nav.innerHTML = tabs().map((t) => {
        const on = t.mod.routes.includes(route);
        return '<button data-route="' + esc(t.route) + '" class="' + (on ? 'active' : '') + (t.accent ? ' accent' : '') + '"' + (on ? ' aria-current="page"' : '') + '>' + U_icon(t.icon) + esc(t.label) + '</button>';
      }).join('');
      const hide = mod && (mod.hideNav === true || (Array.isArray(mod.hideNav) && mod.hideNav.includes(route)));
      nav.hidden = !!hide;
      document.body.classList.toggle('no-nav', !!hide);
    }
    const ht = document.getElementById('slot-header-tools');
    if (ht && !ht.dataset.built) {
      ht.dataset.built = '1';
      ht.innerHTML = headers().map((h) => '<button class="icon-btn" data-route="' + esc(h.route) + '" aria-label="' + esc(h.label) + '">' + U_icon(h.icon) + '</button>').join('');
    }
  }
  const U_icon = (n) => (T.ui ? T.ui.icon(n) : '');

  async function show(route, params, opts) {
    const my = ++token;
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error('[router] cleanup', e); } }
    cleanup = null;
    if (T.store) T.store.photos.release();
    const fr = firstRunMod();
    const onboarded = !!(T.store && T.store.doc('settings').onboardedAt);
    if (fr && !onboarded && !fr.routes.includes(route) && route !== 'settings') { route = fr.routes[0]; params = {}; history.replaceState(null, '', href(route, params)); }
    let mod = findMod(route);
    if (!mod) { route = defaultRoute(); params = {}; mod = findMod(route); history.replaceState(null, '', href(route, params)); }
    current = { route, params };
    const root = rootEl();
    root.className = 'page';
    root.innerHTML = '';
    buildChrome(route);
    try {
      const r = mod.render(root, params, route);
      const fn = r && typeof r.then === 'function' ? await r : r;
      if (my !== token) { if (typeof fn === 'function') fn(); return; } // 待っている間に別画面へ移った
      cleanup = typeof fn === 'function' ? fn : null;
    } catch (e) {
      console.error('[router] render failed: ' + route, e);
      root.innerHTML = '<div class="card"><h2>この画面を開けませんでした</h2><p class="caption">' + esc(e && e.message || e) + '</p><button class="primary" data-route="' + esc(defaultRoute()) + '">しおりへ戻る</button></div>';
    }
    if (!(opts && opts.keepScroll)) {
      window.scrollTo(0, 0);
      const heading = root.querySelector('h1, h2') || root;
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    const title = mod.title ? mod.title + ' — たびのこ' : 'たびのこ';
    document.title = title;
    T.bus.emit('route:changed', { route, params });
  }

  const router = {
    get current() { return current; },
    parse, href,
    go(route, params, opts) {
      const h = href(route, params);
      if (opts && opts.replace) { history.replaceState(null, '', h); return show(route, params || {}); }
      if (location.hash === h) return show(route, params || {});
      location.hash = h; // hashchange が show を呼ぶ
    },
    /** 今の画面を、スクロールを保ったまま描き直す。 */
    refresh() { return show(current.route, current.params, { keepScroll: true }); },
    start() {
      window.addEventListener('hashchange', () => { const p = parse(location.hash); show(p.route || defaultRoute(), p.params); });
      document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-route]');
        if (!b) return;
        let p = {};
        try { p = b.dataset.params ? JSON.parse(b.dataset.params) : {}; } catch (err) { /* 無視 */ }
        e.preventDefault();
        router.go(b.dataset.route, p);
      });
      const p = parse(location.hash);
      return show(p.route || defaultRoute(), p.params);
    },
  };
  T.router = router;
})();
