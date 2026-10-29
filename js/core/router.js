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

  let cleanup = null, current = { route: '', params: {} }, scene = null;
  const positions = new Map(), historyKeys = []; let historyIndex = -1;
  // DOM に依存しない遷移の所有権。古い完了通知は新しい要求を終了できない。
  function createNavigationState() {
    let serial = 0, pending = false, transition = null;
    const interrupt = () => {
      const old = transition; transition = null;
      if (old) { try { old.skipTransition(); } catch (_) { /* 中断は正常系 */ } }
    };
    return {
      begin() { serial++; pending = true; interrupt(); return serial; },
      isCurrent(id) { return serial === id; },
      attach(id, vt) { if (serial === id) transition = vt; else vt.skipTransition(); },
      complete(id) { if (serial === id) { pending = false; transition = null; } },
      interrupt,
      get pending() { return pending; },
    };
  }
  const navigation = createNavigationState();
  function observeTransition(vt) {
    // ready は skipTransition() でも拒否される。3本とも直ちに捕捉する。
    const handled = ['ready', 'finished', 'updateCallbackDone'].map(key => Promise.resolve(vt[key]).catch(() => {}));
    return Promise.all(handled);
  }
  const parents = { recap: 'timeline', notes: 'plan', settings: 'plan', movie: 'recap', upgrade: 'recap', '/upgrade': 'recap', checkout: 'upgrade', '/checkout': 'upgrade', purposes: 'post', about: 'settings', '/about': 'settings' };
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
    return { route: route && route.startsWith('/') && !findMod(route) ? route.slice(1) : route || '', params };
  }
  function href(route, params) {
    const qs = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    return '#' + route + qs;
  }

  function buildChrome(route) {
    const mod = findMod(route);
    const nav = document.getElementById('nav');
    if (nav) {
      if (!nav.dataset.built) {
      nav.dataset.built = '1';
      nav.innerHTML = tabs().map((t) => {
        const on = t.mod.routes.includes(route);
        return '<button data-route="' + esc(t.route) + '" class="' + (on ? 'active' : '') + (t.accent ? ' accent' : '') + '"' + (on ? ' aria-current="page"' : '') + '>' + U_icon(t.icon) + esc(t.label) + '</button>';
      }).join('') + '<span class="nav-indicator" aria-hidden="true"><i></i></span>';
      }
      nav.querySelectorAll('button[data-route]').forEach(b => { const active = findMod(b.dataset.route) === mod || (route === 'recap' && b.dataset.route === 'timeline'); b.classList.toggle('active', active); if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      const active = nav.querySelector('[aria-current]'), indicator = nav.querySelector('.nav-indicator');
      if (indicator) { indicator.hidden = !active; if (active) { indicator.style.width = '24px'; indicator.style.transform = 'translateX(' + (active.offsetLeft + active.offsetWidth / 2 - 12) + 'px)'; } }
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

  function show(route, params, opts = {}) {
    const requestId = navigation.begin();
    if (scene) { scene.cancel(); scene = null; }
    const apply = () => navigation.isCurrent(requestId) ? renderRoute(route, params, Object.assign({}, opts, { requestId, transition: useTransition })) : undefined;
    const useTransition = !!current.route && route !== current.route && !opts.keepScroll && document.startViewTransition && T.store.setting('uiMotion') !== false && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const complete = () => navigation.complete(requestId);
    if (!useTransition) return Promise.resolve(apply()).finally(complete);
    const ordered = tabs().map(t => t.route), from = ordered.indexOf(current.route), to = ordered.indexOf(route);
    const direction = opts.back || parents[current.route] === route ? -1 : from >= 0 && to >= 0 ? Math.sign(to - from) : 1;
    const depth = from < 0 || to < 0;
    document.documentElement.style.setProperty('--scene-x', depth ? '0px' : direction * 16 + 'px');
    document.documentElement.style.setProperty('--scene-exit-x', depth ? '0px' : direction * -8 + 'px');
    document.documentElement.style.setProperty('--scene-y', depth ? direction * 12 + 'px' : '0px');
    document.documentElement.style.setProperty('--scene-scale', depth ? '.985' : '1');
    let applied = false, result;
    const once = () => { if (!applied) { applied = true; result = apply(); } return result; };
    try {
      const vt = document.startViewTransition(once);
      const settled = observeTransition(vt);
      navigation.attach(requestId, vt);
      return settled.finally(complete);
    } catch (_) { return Promise.resolve(once()).finally(complete); }
  }

  async function renderRoute(route, params, opts) {
    const previous = current.route;
    if (scene) { scene.cancel(); scene = null; }
    if (previous) positions.set(href(current.route, current.params), window.scrollY);
    const changing = !!previous && !(opts && opts.keepScroll) && previous !== route;
    const ordered = tabs().map(t => t.route), from = ordered.indexOf(previous), to = ordered.indexOf(route);
    const depth = from < 0 || to < 0;
    const direction = opts && opts.back ? -1 : from >= 0 && to >= 0 ? Math.sign(to - from) : parents[previous] === route ? -1 : 1;
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error('[router] cleanup', e); } }
    cleanup = null;
    if (T.store) T.store.photos.release();
    const fr = firstRunMod();
    const onboarded = !!(T.store && T.store.doc('settings').onboardedAt);
    if (fr && !onboarded && !fr.routes.includes(route) && route !== 'settings') { route = fr.routes[0]; params = {}; history.replaceState(null, '', href(route, params)); }
    let mod = findMod(route);
    if (!mod) { route = defaultRoute(); params = {}; mod = findMod(route); history.replaceState(null, '', href(route, params)); }
    current = { route, params };
    const oldRoot = rootEl(), root = document.createElement('main');
    root.id = 'main'; root.className = 'page'; root.setAttribute('tabindex', '-1');
    oldRoot.replaceWith(root);
    buildChrome(route);
    try {
      const r = mod.render(root, params, route);
      const fn = r && typeof r.then === 'function' ? await r : r;
      if (!navigation.isCurrent(opts.requestId)) { if (typeof fn === 'function') fn(); return; } // 待っている間に別画面へ移った
      cleanup = typeof fn === 'function' ? fn : null;
    } catch (e) {
      console.error('[router] render failed: ' + route, e);
      if (!navigation.isCurrent(opts.requestId)) return;
      root.innerHTML = '<div class="card"><h2>この画面を開けませんでした</h2><p class="caption">' + esc(e && e.message || e) + '</p><button class="primary" data-route="' + esc(defaultRoute()) + '">しおりへ戻る</button></div>';
    }
    if (!(opts && opts.keepScroll)) {
      window.scrollTo(0, opts && opts.back ? positions.get(href(route, params)) || 0 : 0);
      const heading = root.querySelector('h1, h2') || root;
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    if (!navigation.isCurrent(opts.requestId)) return;
    if (changing && !opts.transition && T.store.setting('uiMotion') !== false && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const transform = depth ? 'translateY(' + direction * 12 + 'px) scale(.985)' : 'translateX(' + direction * 16 + 'px)';
      if (root.animate) scene = root.animate([{ opacity: .6, transform }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
      else { root.style.setProperty('--scene-x', depth ? '0px' : direction * 16 + 'px'); root.style.setProperty('--scene-y', depth ? direction * 12 + 'px' : '0px'); root.style.setProperty('--scene-scale', depth ? '.985' : '1'); root.classList.add('scene-enter'); }
    }
    const title = mod.title ? mod.title + ' — たびのこ' : 'たびのこ';
    document.title = title;
    T.bus.emit('route:changed', { route, params });
  }

  const router = {
    get current() { return current; },
    get isNavigating() { return navigation.pending; },
    createNavigationState,
    parse, href,
    go(route, params, opts) {
      const h = href(route, params);
      if (opts && opts.replace) { history.replaceState(null, '', h); return show(route, params || {}); }
      if (location.hash === h) return;
      location.hash = h; // hashchange が show を呼ぶ
    },
    /** 今の画面を、スクロールを保ったまま描き直す。 */
    refresh() { return show(current.route, current.params, { keepScroll: true }); },
    start() {
      window.addEventListener('hashchange', () => { const p = parse(location.hash), key = href(p.route || defaultRoute(), p.params); const back = historyIndex > 0 && historyKeys[historyIndex - 1] === key; if (back) historyIndex--; else if (historyKeys[historyIndex + 1] === key) historyIndex++; else { historyKeys.splice(historyIndex + 1); historyKeys.push(key); historyIndex++; } show(p.route || defaultRoute(), p.params, { back }); });
      let scrollFrame = 0;
      const compact = () => {
        scrollFrame = 0;
        const header = document.querySelector('.shell>header'); if (!header) return;
        const fraction = T.store.setting('uiMotion') === false || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : Math.min(1, Math.max(0, window.scrollY / 72));
        header.style.setProperty('--header-shift', (-44 * fraction) + 'px');
        header.style.setProperty('--header-fade', String(1 - fraction));
      };
      window.addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(compact); }, { passive: true });
      window.addEventListener('resize', () => { buildChrome(current.route); compact(); });
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (motion.addEventListener) motion.addEventListener('change', () => { if (scene) { scene.cancel(); scene = null; } navigation.interrupt(); });
      const viewportChrome = () => {
        if (!document.documentElement.style) return;
        const viewport = window.visualViewport;
        const inset = viewport && viewport.scale === 1 ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
        document.documentElement.style.setProperty('--keyboard-inset', inset + 'px');
        const nav = document.getElementById('nav');
        if (nav && !nav.hidden) document.documentElement.style.setProperty('--nav-h', Math.ceil(nav.getBoundingClientRect().height) + 'px');
      };
      if (window.visualViewport) { window.visualViewport.addEventListener('resize', viewportChrome); window.visualViewport.addEventListener('scroll', viewportChrome); }
      if (window.ResizeObserver) new ResizeObserver(viewportChrome).observe(document.getElementById('nav'));
      window.addEventListener('resize', viewportChrome); viewportChrome();
      document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-route]');
        if (!b) return;
        let p = {};
        try { p = b.dataset.params ? JSON.parse(b.dataset.params) : {}; } catch (err) { /* 無視 */ }
        e.preventDefault();
        router.go(b.dataset.route, p);
      });
      const p = parse(location.hash);
      historyKeys.push(href(p.route || defaultRoute(), p.params)); historyIndex = 0;
      return show(p.route || defaultRoute(), p.params);
    },
  };
  T.router = router;
})();
