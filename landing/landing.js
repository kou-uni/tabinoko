/* APP_URL は landing/index.html の data-app-url で設定する。外部通信はしない。 */
(function () {
  'use strict';
  const APP_URL = (document.documentElement.dataset.appUrl || '').trim();
  let href = '';
  try {
    if (APP_URL && !/[{}\\\u0000-\u0020]/.test(APP_URL)) {
      const url = new URL(APP_URL, document.baseURI);
      if (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin)) {
        if (!url.username && !url.password) href = url.href;
      }
    }
  } catch (_) { /* 未設定・不正な URL は案内のみ。 */ }
  document.querySelectorAll('[data-open-app]').forEach(function (link) {
    if (href) {
      link.setAttribute('href', href);
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.textContent = 'アプリの案内を準備中';
    }
  });
  const status = document.querySelector('[data-app-status]');
  if (status) status.hidden = !!href;
})();
