/* Signed local entitlement. Config must be precached for offline verification. */
(function () {
  'use strict';
  const T = window.Tabi = window.Tabi || {};
  const STORAGE_KEY = 'tabinoko.license.v1';
  let config = null, key = null, grant = null, loading = null;
  const fail = (message) => { throw new Error(message); };
  function decode(s) {
    if (!/^[A-Za-z0-9_-]+$/.test(s)) fail('コードをもう一度、まるごと貼り付けてね。');
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  }
  function valid(p) {
    const now = Math.floor(Date.now() / 1000);
    return p && p.v === 1 && p.sku === 'hd' && typeof p.jti === 'string' &&
      p.jti.length > 0 && p.jti.length <= 255 &&
      Number.isSafeInteger(p.iat) && p.iat >= 0 && p.iat <= now + 300 &&
      (p.exp === undefined || (Number.isSafeInteger(p.exp) && p.exp > p.iat && p.exp > now));
  }
  async function verify(code) {
    if (!key) fail('コードの確認は準備中だよ。回線につないで、あとでもう一度開いてね。');
    if (typeof code !== 'string' || code.length > 8192) fail('コードをもう一度、まるごと貼り付けてね。');
    const normalized = code.replace(/\s/g, '');
    const parts = normalized.split('.');
    if (parts.length !== 3 || parts[0] !== 'TN1') fail('メールのコードを、TN1 からまるごと貼り付けてね。');
    try {
      const payload = decode(parts[1]), signature = decode(parts[2]);
      if (signature.length !== 64 || !await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, key, signature,
        new TextEncoder().encode('TN1.' + parts[1])
      )) throw new Error();
      const p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
      if (!valid(p)) throw new Error();
      return { code: normalized, payload: p };
    } catch (_) { fail('コードを確認できなかったよ。貼り付けた内容や有効期限を確かめてね。'); }
  }
  async function load() {
    grant = null;
    try {
      const response = await fetch('config/payment.json');
      if (!response.ok) throw new Error();
      const raw = await response.json();
      let paymentLinkUrl = '';
      try {
        const url = new URL(raw.paymentLinkUrl);
        if (url.protocol === 'https:' && url.hostname === 'buy.stripe.com' && !url.username && !url.password) paymentLinkUrl = url.href;
      } catch (_) { /* An empty or invalid destination stays disabled. */ }
      let tapCounterUrl = '';
      try {
        const url = new URL(raw.tapCounterUrl);
        if (url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search) tapCounterUrl = url.href;
      } catch (_) { /* No configured endpoint means no transmission. */ }
      config = { paymentLinkUrl, tapCounterUrl };
      const jwk = raw.publicKeyJwk;
      if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d || !window.crypto || !window.crypto.subtle) return;
      key = await window.crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) grant = (await verify(saved)).payload;
    } catch (_) { /* Fail closed; never trust an unverified persisted flag. */ }
  }
  const init = () => loading || (loading = load());
  T.license = {
    init,
    has(sku) { return sku === 'hd' && !!grant && valid(grant); },
    async getConfig() {
      await init();
      return { paymentLinkUrl: key && config ? config.paymentLinkUrl : '', tapCounterUrl: config ? config.tapCounterUrl : '', ready: !!key };
    },
    clear() {
      grant = null;
      window.localStorage.removeItem(STORAGE_KEY);
    },
    async redeem(code) {
      await init();
      const result = await verify(code);
      try { window.localStorage.setItem(STORAGE_KEY, result.code); }
      catch (_) { fail('この端末に保存できなかったよ。空き容量やブラウザの保存設定を確かめてね。'); }
      grant = result.payload;
      return true;
    }
  };
})();
