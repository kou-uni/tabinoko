/* Counts stay on this device, outside travel backups. IDB transactions serialize tabs. */
(function () {
  'use strict';
  const T = window.Tabi;
  const appVer = '2.1.0';
  let opening;
  function open() {
    if (!window.indexedDB) return Promise.reject(new Error('保存を使えないよ。'));
    if (!opening) opening = new Promise((resolve, reject) => {
      const req = window.indexedDB.open('tabinoko-tap-counter', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('counts', { keyPath: 'id' });
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('別の画面を閉じて試してね。'));
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function transaction(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('counts', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('保存できなかったよ。'));
      work(tx.objectStore('counts'), value => { result = value; });
    });
  }
  function send(stage, ts, wasOnline) {
    if (!wasOnline) return;
    T.license.getConfig().then(config => {
      if (!config.tapCounterUrl || window.navigator.onLine === false) return;
      return fetch(config.tapCounterUrl, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
        redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, appVer, ts })
      });
    }).catch(() => {}); // No retry or offline queue.
  }
  T.tapCounter = {
    appVer,
    async record(stage) {
      if (stage !== 1 && stage !== 2) throw new Error('不明な段階です。');
      const now = new Date(), ts = now.toISOString();
      const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
      const online = window.navigator.onLine !== false;
      const counted = await transaction('readwrite', (store, done) => {
        const req = store.get(stage);
        req.onsuccess = () => {
          const previous = req.result;
          if (previous && previous.day >= day) { done(false); return; }
          store.put({ id: stage, count: (previous ? previous.count : 0) + 1, day, lastAt: ts });
          done(true);
        };
      });
      if (counted) send(stage, ts, online);
      return counted;
    },
    async counts() {
      return transaction('readonly', (store, done) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const counts = { 1: 0, 2: 0 };
          req.result.forEach(row => { counts[row.id] = row.count; });
          done(counts);
        };
      });
    },
    async clear() {
      if (!window.indexedDB) return;
      return transaction('readwrite', store => store.clear());
    }
  };
})();
