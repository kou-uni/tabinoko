/* ui.js — 共有 UI 部品: アイコン、妖精の絵、トースト、ダイアログ、見出し、写真の差し込み。 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});
  const U = T.util, esc = U.esc;
  const $ = (s, r) => (r || document).querySelector(s);

  const ICONS = {
    book: '<path d="M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3zM12 6v15M6 8h3m-3 4h3m6-4h3m-3 4h3"/>',
    post: '<path d="M4 3h12l4 4v14H4z M8 12h8 M12 8v8"/>',
    timeline: '<path d="M5 3v18 M3 5h4v4H3z M3 16h4v4H3z M11 6h10 M11 12h7 M11 18h10"/>',
    map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16"/>',
    fairy: '<path d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5zM20 17v5m-2.5-2.5h5"/>',
    note: '<path d="M13 4H4v17h16v-9M9 15l1-5L19 1l4 4-9 9z"/>',
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
    gear: '<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8"/>',
    plane: '<path d="m2 14 8-3-3-7 2-1 6 6 5-2 1 2-5 3 1 6-2 1-3-6-6 3z"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    pin: '<path d="M12 22s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M5 20h14"/>',
  };
  const FAIRY = '<path class="fairy-wing fairy-wing-left" d="M34 49C2 17 4 73 35 70" fill="#f2c899" stroke="#bb855d" stroke-width="1.4"/><path class="fairy-wing fairy-wing-right" d="M66 49C98 17 96 73 65 70" fill="#f2c899" stroke="#bb855d" stroke-width="1.4"/><path d="M32 76q-6-49 18-54 24 5 18 54-17 12-36 0" fill="#d4ddae" stroke="#50734a" stroke-width="1.5"/><path d="M49 24Q35 9 45 7q10 1 5 17Q65 7 70 13q3 10-20 11" fill="#70935b"/><g class="fairy-eyes"><ellipse cx="42" cy="52" rx="2" ry="3" fill="#304c35"/><ellipse cx="59" cy="52" rx="2" ry="3" fill="#304c35"/></g><path d="M47 61q4 4 8 0" fill="none" stroke="#304c35" stroke-width="1.7" stroke-linecap="round"/><ellipse cx="36" cy="59" rx="5" ry="3" fill="#e4ad89"/><ellipse cx="65" cy="59" rx="5" ry="3" fill="#e4ad89"/><path d="m15 22 2-5 2 5 5 2-5 2-2 5-2-5-5-2zM79 35l2-5 2 5 5 2-5 2-2 5-2-5-5-2z" fill="#c68a4d"/>';

  const icons = Object.assign({}, ICONS);
  let spriteEl = null;
  const symbols = () => Object.entries(icons).map(([n, d]) => '<symbol id="i-' + n + '" viewBox="0 0 24 24">' + d + '</symbol>').join('') + '<symbol id="fairy" viewBox="0 0 100 100">' + FAIRY + '</symbol>';

  let toastTimer, themeMedia;
  function syncThemeColor() {
    const theme = document.documentElement.dataset.theme;
    const dark = theme === 'dark' || (theme === 'auto' && themeMedia.matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#18263D' : '#FFF6E5');
  }
  const ui = {
    esc,
    $,
    applyTheme(value) {
      document.documentElement.dataset.theme = ['dark','light','auto'].includes(value) ? value : 'light';
      if (!themeMedia) { themeMedia = window.matchMedia('(prefers-color-scheme: dark)'); if (themeMedia.addEventListener) themeMedia.addEventListener('change', syncThemeColor); }
      syncThemeColor();
    },
    /** アイコンを足す。name は 'my-icon'、inner は 24x24 の stroke 用 path 群。 */
    addIcons(map) { Object.assign(icons, map); if (spriteEl) spriteEl.innerHTML = '<defs>' + symbols() + '</defs>'; },
    mountSprite() {
      if (spriteEl) return;
      spriteEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      spriteEl.setAttribute('style', 'display:none'); spriteEl.setAttribute('aria-hidden', 'true');
      spriteEl.innerHTML = '<defs>' + symbols() + '</defs>';
      document.body.prepend(spriteEl);
    },
    icon(name) { return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; },
    /** 妖精の絵。cls に 'fairy-large' など。 */
    fairy(cls) { return '<svg class="fairy-art ' + (cls || '') + '" aria-hidden="true" focusable="false"><use href="#fairy"/></svg>'; },
    fairyAnimated(cls) { return '<svg viewBox="0 0 100 100" class="fairy-art fairy-animated ' + esc(cls || '') + '" aria-hidden="true" focusable="false">' + FAIRY + '</svg>'; },
    guide(text) { return '<div class="fairy-guide">' + ui.fairyAnimated('') + '<p>' + esc(text) + '</p></div>'; },
    heading(en, title, extra) { return '<div class="page-head"><h1>' + title + '</h1>' + (extra || '') + '</div>'; },
    empty(text) { return '<div class="empty">' + text + '</div>'; },

    toast(msg, ms) {
      const el = $('#toast'); if (!el) return;
      el.textContent = msg;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.textContent = ''; }, ms || 4500);
    },

    /** 共有ダイアログ。body は HTML 文字列。開いたら最初の入力欄にフォーカス（閉じるボタンではなく）。 */
    dialog(opts) {
      const d = $('#dialog'), opener = document.activeElement;
      d.innerHTML = '<div class="dialog-head"><h2 id="dialog-title">' + esc(opts.title || '') + '</h2><button type="button" id="dialog-close" class="text-btn" aria-label="閉じる">✕</button></div>' + (opts.body || '');
      d.setAttribute('aria-labelledby', 'dialog-title');
      $('#dialog-close').onclick = () => ui.closeDialog();
      d.onclose = () => { if (opts.onClose) opts.onClose(); if (opener && opener.isConnected) opener.focus({ preventScroll: true }); };
      d.onclick = (e) => { if (e.target === d) ui.closeDialog(); };
      if (!d.open) d.showModal();
      const first = d.querySelector('input:not([type=hidden]):not([type=file]),textarea,select');
      if (first) first.focus(); else { d.setAttribute('tabindex', '-1'); d.focus(); }
      return d;
    },
    closeDialog() { const d = $('#dialog'); if (d && d.open) d.close(); },
    /** はい/いいえ。true/false で解決。 */
    confirm(opts) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const d = ui.dialog({ title: opts.title, body: '<p>' + (opts.body || '') + '</p><button class="primary wide" id="dlg-ok">' + esc(opts.ok || 'OK') + '</button><div class="spacer"></div><button class="wide" id="dlg-cancel">' + esc(opts.cancel || 'やめる') + '</button>', onClose: () => finish(false) });
        $('#dlg-ok', d).onclick = () => { finish(true); ui.closeDialog(); };
        $('#dlg-cancel', d).onclick = () => ui.closeDialog();
      });
    },

    /** 日付 <option>。旅の外の日も出せる。 */
    dateOptions(chosen) {
      chosen = chosen || U.todayISO();
      const days = T.data ? T.data.days().map((d) => d.date) : [];
      const dates = [...new Set([chosen, ...days])].sort();
      return dates.map((d) => '<option value="' + esc(d) + '"' + (d === chosen ? ' selected' : '') + '>' + U.dayLabel(d) + (days.includes(d) ? '' : '（旅の前後）') + '</option>').join('');
    },

    /** root 内の <img data-photo-id="..."> に写真を差し込む。 */
    hydratePhotos(root) {
      (root || document).querySelectorAll('img[data-photo-id]').forEach(async (img) => {
        try {
          const meta = T.store.get('photos', img.dataset.photoId);
          if (meta && meta.w > 0 && meta.h > 0) { img.width = meta.w; img.height = meta.h; img.style.aspectRatio = meta.w + '/' + meta.h; }
          const u = await T.store.photos.url(img.dataset.photoId);
          if (!u && T.gameUI) T.gameUI.missingPhoto(img.dataset.photoId);
          if (!img.isConnected) return;
          if (u) img.src = u; else img.replaceWith(document.createTextNode('写真を読み込めませんでした。'));
        } catch (e) { if (img.isConnected) img.replaceWith(document.createTextNode('写真の保存領域にアクセスできません。')); }
      });
    },
    /** 入力欄 → 書きかけ保存を結ぶ。key は store.draft のキー。 */
    bindDraft(el, key) {
      el.value = el.value || T.store.draft(key);
      el.addEventListener('input', () => T.store.setDraft(key, el.value));
    },
  };
  T.ui = ui;
})();
