/* 起動前の旅程復号。保存するのは取り出せない CryptoKey だけ。 */
(function () {
  'use strict';
  const T = window.Tabi;
  const bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  function keyStore(mode, value) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('tabinoko-key', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('key store blocked'));
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        const tx = db.transaction('keys', mode === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('keys');
        const r = mode === 'get' ? store.get('seed') : mode === 'delete' ? store.delete('seed') : store.put(value, 'seed');
        tx.oncomplete = () => { db.close(); resolve(r && r.result); };
        tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }
  async function derive(password, data) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(data.salt), iterations: data.iter }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function decrypt(key, data) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(data.iv) }, key, bytes(data.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  let sessionKey = null, remembered = false, period = 90, expiresAt = null, lastTouch = 0;
  const normalize = saved => saved && (saved.key ? saved : { key:saved, days:'forever', expiresAt:null });
  const expired = (saved, now = Date.now()) => !!saved && saved.expiresAt != null && (!Number.isFinite(saved.expiresAt) || now >= saved.expiresAt);
  const record = (key, remember, days = 90, now = Date.now()) => remember ? { key, days:days === 'forever' ? days : [30,90].includes(Number(days)) ? Number(days) : 90,
    expiresAt:days === 'forever' ? null : now + ([30,90].includes(Number(days)) ? Number(days) : 90) * 86400000 } : null;
  async function persistHint() {
    try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch (_) { /* 拒否でも通常保存は可能 */ }
  }
  function installHint() {
    if (!/iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return;
    if (navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) return;
    try { if (localStorage.getItem('tabinoko-key-hint')) return; localStorage.setItem('tabinoko-key-hint','1'); } catch (_) { return; }
    const hint = document.createElement('aside'); hint.className = 'key-install-hint';
    hint.innerHTML = '<p>ホーム画面に追加すると、覚えた鍵が消えにくくなります。Safari の共有 →「ホーム画面に追加」。</p><button type="button">閉じる</button>';
    hint.querySelector('button').onclick = () => hint.remove();
    document.getElementById('slot-banner').appendChild(hint);
  }
  let pending = Promise.resolve();
  function serialize(fn) { const work = pending.then(fn); pending = work.catch(() => {}); return work; }
  const api = T.unlock = {
    sealed: false,
    derive, decrypt, normalize, expired, record,
    state() { return { remembered, days:period, expiresAt }; },
    setRemember(remember, days = period) {
      return serialize(async () => {
        if (!sessionKey) throw new Error('鍵がありません。もう一度あいことばで開いてください。');
        if (remember) {
          const next = record(sessionKey, true, days);
          await keyStore('put', next); remembered = true; period = next.days; expiresAt = next.expiresAt;
          await persistHint(); installHint();
        } else { await keyStore('delete'); remembered = false; expiresAt = null; period = days; }
      });
    },
    touch(now = Date.now()) {
      return serialize(async () => {
        if (!remembered) return;
        if (expired({expiresAt}, now)) { await api.relock(); return; }
        if (now - lastTouch < 60000) return;
        const next = record(sessionKey, true, period, now);
        await keyStore('put', next); expiresAt = next.expiresAt; lastTouch = now;
      });
    },
    async forget() { await keyStore('delete'); remembered = false; expiresAt = null; },
    async relock() {
      document.body.classList.add('sealed'); sessionKey = null;
      try { await api.forget(); } catch (_) { /* 強制ロックURLなら保存鍵を使わない */ }
      const url = new URL(location.href); url.searchParams.set('lock', '1');
      document.body.classList.add('sealed');
      location.replace(url.href);
    },
    async start() {
      if (window.TABI_SEED) return;
      api.sealed = true;
      document.body.classList.add('sealed');
      T.ui.mountSprite();
      const panel = document.createElement('section'); panel.id = 'unlock';
      panel.innerHTML = '<div class="card"><svg class="unlock-fairy" aria-hidden="true"><use href="#fairy"/></svg><h1>合言葉を入れてね</h1><p>きみの旅、いっしょに開こう。</p><form id="unlock-form"><label for="unlock-password">合言葉</label><input id="unlock-password" type="password" autocomplete="current-password" required><button type="button" id="unlock-toggle" aria-pressed="false">表示する</button><label class="unlock-remember"><input id="unlock-remember" type="checkbox" checked>この端末では次から入力しない</label><button class="primary" type="submit" disabled>旅を開く</button></form><p class="caption">覚えた鍵が消えた・期限が切れた場合は再入力が必要です。あいことばを忘れると旅程を復号できません。</p><p id="unlock-status" role="status" aria-live="polite"></p></div>';
      document.body.appendChild(panel);
      const input = panel.querySelector('input'), form = panel.querySelector('form'), status = panel.querySelector('#unlock-status');
      panel.querySelector('#unlock-toggle').onclick = e => {
        const show = input.type === 'password'; input.type = show ? 'text' : 'password';
        e.currentTarget.textContent = show ? '隠す' : '表示する'; e.currentTarget.setAttribute('aria-pressed', String(show));
      };
      let data;
      async function payload() {
        if (data) return data;
        const response = await fetch('data/seed.enc.json');
        if (!response.ok) throw new Error('seed unavailable');
        const d = await response.json();
        if (d.v !== 1 || d.kdf !== 'PBKDF2-SHA256' || d.iter !== 600000 || bytes(d.salt).length !== 16 || bytes(d.iv).length !== 12) throw new Error('invalid seed');
        data = d; return d;
      }
      const forced = new URLSearchParams(location.search).get('lock') === '1';
      if (forced) {
        try { await api.forget(); } catch (_) { /* 今回は必ず合言葉で開く */ }
        const url = new URL(location.href); url.searchParams.delete('lock'); history.replaceState(null, '', url.href);
      }
      let saved = false;
      if (!forced) {
        try {
          const stored = normalize(await keyStore('get'));
          if (stored && expired(stored)) await api.forget();
          else if (stored) {
            window.TABI_SEED = await decrypt(stored.key, await payload()); sessionKey = stored.key;
            remembered = true; period = stored.days; expiresAt = stored.expiresAt; saved = true;
            await api.touch();
          }
        } catch (_) { /* 保存鍵が無い・更新された場合は入力に戻る */ }
      }
      let rememberFailed = false;
      if (!saved) await new Promise(resolve => {
        let busy = false;
        form.querySelector('[type=submit]').disabled = false;
        form.onsubmit = async e => {
          e.preventDefault(); if (busy) return; busy = true;
          const submit = form.querySelector('[type=submit]'); submit.disabled = true; status.textContent = '旅を開いているよ…';
          try {
            let d;
            try { d = await payload(); } catch (_) { status.textContent = '旅の準備ができなかったよ。回線をつないで、もう一度試してね。'; return; }
            const key = await derive(input.value, d);
            const seed = await decrypt(key, d);
            sessionKey = key;
            try { await api.setRemember(panel.querySelector('#unlock-remember').checked, 90); } catch (_) {
              if (!panel.querySelector('#unlock-remember').checked) { status.textContent = '保存鍵を消せませんでした。端末の保存設定を確認して、もう一度試してください。'; return; }
              rememberFailed = true;
            }
            input.value = ''; window.TABI_SEED = seed; resolve();
          } catch (_) { status.textContent = 'ちがうみたい'; input.focus(); }
          finally { busy = false; submit.disabled = false; }
        };
      });
      panel.remove(); document.body.classList.remove('sealed');
      const activity = () => api.touch().catch(() => {});
      document.addEventListener('pointerdown', activity, {passive:true});
      document.addEventListener('keydown', activity);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') activity(); });
      setInterval(() => { if (remembered && expired({expiresAt})) api.relock().catch(() => {}); }, 30000);
      if (rememberFailed) T.ui.toast('この端末に鍵を覚えられなかったよ。次も合言葉で開いてね。', 8000);
    },
  };
})();
