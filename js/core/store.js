/* store.js — 端末内の保存。IndexedDB を主に、使えなければ localStorage（写真はメモリのみ）に退く。
 *
 * 読み取りは同期（起動時に全行をメモリに載せる）。書き込みは async（IndexedDB に確定してから resolve）。
 * 返す行は「コピー」。変えたいときは put/patch で書き戻す。
 *
 *   await Tabi.store.ready
 *   store.get(coll,id) / store.all(coll) / store.find(coll,pred)       ... table
 *   await store.put(coll,row) / patch(coll,id,fnOrObj) / remove(coll,id)
 *   store.doc(name) / await store.setDoc(name, fnOrObj)                ... doc
 *   store.draft(key) / store.setDraft(key,text)                        ... 書きかけ（閉じても残る）
 *   store.photos.{put,blob,url,release,remove,stats}                   ... 写真本体
 *   store.exportAll() / importAll(file,{mode}) / wipe() / usage() / persist()
 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});
  const U = T.util, M = T.model, bus = T.bus;
  const DB_NAME = 'tabinoko-v2';
  const LS_KEY = 'tabinoko.v2.ls';

  /* ---------- backends ---------- */
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function txDone(tx) { return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('tx aborted')); }); }

  function openIDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('indexedDB なし'));
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return reject(e); }
      const timer = setTimeout(() => reject(new Error('indexedDB を開けません（タイムアウト）')), 6000);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('docs', { keyPath: 'id' });
        db.createObjectStore('blobs');
        M.TABLES.forEach((t) => db.createObjectStore(t, { keyPath: 'id' }));
      };
      req.onsuccess = () => { clearTimeout(timer); const db = req.result; db.onversionchange = () => db.close(); resolve(db); };
      req.onerror = () => { clearTimeout(timer); reject(req.error); };
      req.onblocked = () => { clearTimeout(timer); reject(new Error('indexedDB がほかのタブで使用中です')); };
    });
  }

  function idbBackend(db) {
    return {
      name: 'indexeddb',
      async load(withBlobs) {
        const stores = ['docs', ...M.TABLES, ...(withBlobs ? ['blobs'] : [])];
        const tx = db.transaction(stores, 'readonly');
        const done = txDone(tx);
        const out = { docs: {}, tables: {} };
        const reqs = stores.map((s) => reqP(tx.objectStore(s).getAll()));
        if (withBlobs) reqs.push(reqP(tx.objectStore('blobs').getAllKeys()));
        const [res] = await Promise.all([Promise.all(reqs), done]);
        res[0].forEach((d) => { out.docs[d.id] = d; });
        M.TABLES.forEach((t, i) => { out.tables[t] = res[i + 1]; });
        if (withBlobs) out.blobs = new Map(res.at(-1).map((id, i) => [id, res[stores.length - 1][i]]));
        return out;
      },
      async putRow(t, row) { const tx = db.transaction(t, 'readwrite'); tx.objectStore(t).put(row); await txDone(tx); },
      async deleteRow(t, id) { const tx = db.transaction(t, 'readwrite'); tx.objectStore(t).delete(id); await txDone(tx); },
      async putDoc(doc) { const tx = db.transaction('docs', 'readwrite'); tx.objectStore('docs').put(doc); await txDone(tx); },
      async blobPut(id, blob) { const tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, id); await txDone(tx); },
      async blobGet(id) { const tx = db.transaction('blobs', 'readonly'); return (await reqP(tx.objectStore('blobs').get(id))) || null; },
      async blobDel(id) { const tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').delete(id); await txDone(tx); },
      async applyImport(data, blobs, replace) {
        const names = ['docs', 'blobs', ...M.TABLES];
        const tx = db.transaction(names, 'readwrite');
        const done = txDone(tx);
        try {
          if (replace) names.forEach((n) => tx.objectStore(n).clear());
          Object.values(data.docs).forEach((d) => tx.objectStore('docs').put(d));
          M.TABLES.forEach((t) => data.tables[t].forEach((r) => tx.objectStore(t).put(r)));
          blobs.forEach((b, id) => tx.objectStore('blobs').put(b, id));
        } catch (e) { tx.abort(); await done.catch(() => {}); throw e; }
        await done;
      },
      async clearAll() { const names = ['docs', 'blobs', ...M.TABLES]; const tx = db.transaction(names, 'readwrite'); names.forEach((n) => tx.objectStore(n).clear()); await txDone(tx); },
    };
  }

  /** メモリ（+任意で localStorage に JSON 退避）。IndexedDB が使えない端末・テスト用。 */
  function memoryBackend(persist) {
    let docs = {}, tables = {}; M.TABLES.forEach((t) => { tables[t] = new Map(); });
    let blobs = new Map();
    const reload = () => {
      if (!persist) return;
      const raw = localStorage.getItem(LS_KEY);
      const d = raw ? JSON.parse(raw) : { docs: {}, tables: {} };
      docs = d.docs || {};
      M.TABLES.forEach((t) => { tables[t] = new Map((d.tables[t] || []).map((r) => [r.id, r])); });
      blobs = new Map(Object.entries(d.blobs || {}));
    };
    const save = () => {
      if (!persist) return;
      const dump = { docs, tables: {}, blobs: Object.fromEntries(blobs) };
      M.TABLES.forEach((t) => { dump.tables[t] = [...tables[t].values()]; });
      try { localStorage.setItem(LS_KEY, JSON.stringify(dump)); } catch (e) { const err = new Error('保存領域がいっぱいです'); err.name = 'QuotaExceededError'; throw err; }
    };
    return {
      name: persist ? 'localstorage' : 'memory',
      async load(withBlobs) {
        reload();
        const out = { docs: U.clone(docs), tables: {} };
        M.TABLES.forEach((t) => { out.tables[t] = [...tables[t].values()].map(U.clone); });
        if (withBlobs) out.blobs = new Map([...blobs].map(([id, b]) => [id, base64ToBlob(b.data, b.mime)]));
        return out;
      },
      async putRow(t, row) { reload(); const prev = tables[t].get(row.id); tables[t].set(row.id, U.clone(row)); try { save(); } catch (e) { if (prev) tables[t].set(row.id, prev); else tables[t].delete(row.id); throw e; } },
      async deleteRow(t, id) { reload(); const prev = tables[t].get(id); tables[t].delete(id); try { save(); } catch (e) { if (prev) tables[t].set(id, prev); throw e; } },
      async putDoc(doc) { reload(); const prev = docs[doc.id]; docs[doc.id] = U.clone(doc); try { save(); } catch (e) { if (prev) docs[doc.id] = prev; else delete docs[doc.id]; throw e; } },
      async blobPut(id, blob) {
        const encoded = { mime: blob.type, data: await blobToBase64(blob) };
        reload(); const prev = blobs.get(id); blobs.set(id, encoded);
        try { save(); } catch (e) { if (prev) blobs.set(id, prev); else blobs.delete(id); throw e; }
      },
      async blobGet(id) { reload(); const b = blobs.get(id); return b ? base64ToBlob(b.data, b.mime) : null; },
      async blobDel(id) { reload(); const prev = blobs.get(id); blobs.delete(id); try { save(); } catch (e) { if (prev) blobs.set(id, prev); throw e; } },
      async applyImport(data, incoming, replace) {
        const encoded = new Map();
        for (const [id, b] of incoming) encoded.set(id, { mime: b.type, data: await blobToBase64(b) });
        reload();
        const nextDocs = replace ? {} : U.clone(docs), nextTables = {};
        Object.assign(nextDocs, U.clone(data.docs));
        M.TABLES.forEach((t) => { nextTables[t] = new Map(replace ? [] : tables[t]); data.tables[t].forEach((r) => nextTables[t].set(r.id, U.clone(r))); });
        const oldDocs = docs, oldTables = tables, oldBlobs = blobs; docs = nextDocs; tables = nextTables;
        blobs = new Map(replace ? [] : oldBlobs);
        encoded.forEach((b, id) => blobs.set(id, b));
        try { save(); } catch (e) { docs = oldDocs; tables = oldTables; blobs = oldBlobs; throw e; }
      },
      async clearAll() {
        reload();
        const oldDocs = docs, oldTables = tables, oldBlobs = blobs; docs = {}; tables = {}; blobs = new Map(); M.TABLES.forEach((t) => { tables[t] = new Map(); });
        try { save(); } catch (e) { docs = oldDocs; tables = oldTables; blobs = oldBlobs; throw e; }
      },
    };
  }

  /* ---------- store ---------- */
  let backend = null;
  const cache = { docs: {}, tables: {} };
  M.TABLES.forEach((t) => { cache.tables[t] = new Map(); });
  const urls = new Map();

  const store = {
    degraded: null, // null | 文字列（保存先が弱いときの理由）
    backendName: '',
    ready: null,
    _setBackend(b) { backend = b; store.backendName = b.name; }, // テスト用

    /* ----- table ----- */
    get(coll, id) { return U.clone(cache.tables[coll].get(id)) || null; },
    all(coll) {
      const rows = [...cache.tables[coll].values()].map(U.clone);
      if (coll === 'days') return rows.sort((a, b) => a.date.localeCompare(b.date));
      return rows.sort((a, b) => String(a.at || a.createdAt || '').localeCompare(String(b.at || b.createdAt || '')) || a.id.localeCompare(b.id));
    },
    find(coll, pred) { return store.all(coll).filter(pred); },
    count(coll) { return cache.tables[coll].size; },

    async put(coll, row) {
      const map = cache.tables[coll];
      if (!map) throw new Error('unknown table: ' + coll);
      const prev = map.get(row.id);
      const ts = U.iso();
      const r = U.clone(row);
      r.id = r.id || U.uid();
      r.createdAt = r.createdAt || (prev && prev.createdAt) || ts;
      r.updatedAt = ts;
      const problems = M.validate(coll, r);
      if (problems.length) console.warn('[store] ' + coll + ' の形が不正:', problems.join(' / '), r);
      map.set(r.id, r);
      try { await backend.putRow(coll, r); } catch (e) {
        if (prev) map.set(r.id, prev); else map.delete(r.id);
        throw fail('write', e);
      }
      bus.emit('store:changed', { coll, id: r.id, op: 'put' });
      return U.clone(r);
    },
    async patch(coll, id, change) {
      const cur = store.get(coll, id);
      if (!cur) throw new Error(coll + '/' + id + ' が見つかりません');
      const next = typeof change === 'function' ? (change(cur) || cur) : Object.assign(cur, change);
      return store.put(coll, next);
    },
    async remove(coll, id) {
      const map = cache.tables[coll];
      const prev = map.get(id);
      if (!prev) return false;
      map.delete(id);
      try {
        await backend.deleteRow(coll, id);
        if (coll === 'photos') { release(id); await backend.blobDel(id); }
      } catch (e) { map.set(id, prev); throw fail('write', e); }
      bus.emit('store:changed', { coll, id, op: 'remove' });
      return true;
    },

    /* ----- doc ----- */
    doc(name) { return U.clone(cache.docs[name]) || M.make(name); },
    async setDoc(name, change) {
      const cur = store.doc(name);
      const next = typeof change === 'function' ? (change(cur) || cur) : Object.assign(cur, change);
      next.id = name; next.updatedAt = U.iso();
      const prev = cache.docs[name];
      cache.docs[name] = next;
      try { await backend.putDoc(next); } catch (e) { if (prev) cache.docs[name] = prev; else delete cache.docs[name]; throw fail('write', e); }
      bus.emit('store:changed', { coll: name, id: name, op: 'doc' });
      return U.clone(next);
    },
    setting(key) { return store.doc('settings')[key]; },
    async setSetting(key, value) { const r = await store.setDoc('settings', (s) => { s[key] = value; }); bus.emit('settings:changed', { key }); return r; },

    /* ----- 書きかけ ----- */
    draft(key) { const d = cache.docs.drafts; return (d && d[key]) || ''; },
    setDraft(key, text) {
      const d = cache.docs.drafts || (cache.docs.drafts = M.make('drafts'));
      if (d[key] === text && !draftDirty) return;
      d[key] = text;
      d.updatedAt = U.iso();
      draftDirty = true;
      flushDraft();
    },

    /* ----- 写真 ----- */
    photos: {
      /** blob と最小メタを保存し、photos 行を返す。縮小は Tabi.photo.add を使う。 */
      async put(blob, meta) {
        const id = (meta && meta.id) || U.uid();
        await backend.blobPut(id, blob).catch((e) => { throw fail('write', e); });
        try {
          return await store.put('photos', Object.assign(M.make('photos'), { date: U.todayISO() }, meta || {}, { id, mime: blob.type || 'image/jpeg', bytes: blob.size }));
        } catch (e) { await backend.blobDel(id).catch(() => {}); throw e; }
      },
      blob(id) { return backend.blobGet(id); },
      /** <img src> 用の objectURL。ルート移動時に release() される。 */
      async url(id) {
        if (urls.has(id)) return urls.get(id);
        const b = await backend.blobGet(id);
        if (!b) return null;
        const u = URL.createObjectURL(b); urls.set(id, u); return u;
      },
      release() { release(); },
      remove(id) { return store.remove('photos', id); },
      stats() { const rows = cache.tables.photos; let bytes = 0; rows.forEach((r) => { bytes += r.bytes || 0; }); return { count: rows.size, bytes }; },
    },

    /* ----- バックアップ ----- */
    /** 全データを JSON Blob にする。写真は base64 で同梱（photos:false で省略）。 */
    async exportAll(opts) {
      await saveDraft();
      const withPhotos = !opts || opts.photos !== false;
      const snapshot = backend.load ? await backend.load(withPhotos) : { docs: U.clone(cache.docs), tables: Object.fromEntries(M.TABLES.map((t) => [t, store.all(t)])) };
      M.DOCS.forEach((n) => { if (!snapshot.docs[n]) snapshot.docs[n] = store.doc(n); });
      const head = { app: 'tabinoko', schema: 2, exportedAt: U.iso(), docs: snapshot.docs, tables: snapshot.tables };
      const headJson = JSON.stringify(head);
      const parts = [headJson.slice(0, -1) + ',"photos":['];
      if (withPhotos) {
        let first = true;
        for (const p of snapshot.tables.photos) {
          const b = snapshot.blobs ? snapshot.blobs.get(p.id) : await backend.blobGet(p.id);
          if (!b) throw new Error('写真を読み出せません。写真つきバックアップを作成できませんでした。');
          const data = await blobToBase64(b);
          parts.push((first ? '' : ',') + JSON.stringify({ id: p.id, mime: b.type || p.mime, data }));
          first = false;
        }
      }
      parts.push(']}');
      return new Blob(parts, { type: 'application/json' });
    },
    /** file は File|Blob|string。mode: 'merge'（新しい更新が勝つ）| 'replace'（先に全消去）。 */
    async importAll(file, opts) {
      await saveDraft();
      if (backend.load) {
        const latest = await backend.load();
        Object.assign(cache.docs, latest.docs);
        M.TABLES.forEach((t) => { cache.tables[t] = new Map(latest.tables[t].map((r) => [r.id, r])); });
      }
      const mode = (opts && opts.mode) || 'merge';
      const text = typeof file === 'string' ? file : await file.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('ファイルを読めませんでした（JSON ではありません）'); }
      if (!data || data.app !== 'tabinoko' || !data.tables) throw new Error('たびのこのバックアップではありません');
      if (data.schema > 2) throw new Error('新しい版のバックアップです。アプリを更新してください');
      if (!['merge', 'replace'].includes(mode)) throw new Error('読み込み方法が不正です');
      const invalid = () => { throw new Error('バックアップのデータ形式が不正です。記録は変更していません。'); };
      const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
      if (!object(data.tables) || !object(data.docs) || !Array.isArray(data.photos) || data.schema !== 2) invalid();
      const incoming = { docs: {}, tables: {} }, blobs = new Map();
      const sum = { rows: 0, photos: 0, skipped: 0 };
      // 全行と写真を検証・復号してから、単一トランザクションで確定する。
      for (const t of M.TABLES) {
        if (!Array.isArray(data.tables[t])) invalid();
        const ids = new Set(); incoming.tables[t] = [];
        for (const raw of data.tables[t]) {
          if (!object(raw) || typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)) invalid();
          ids.add(raw.id);
          const r = M.make(t, raw);
          for (const [key, value] of Object.entries(M.make(t))) {
            if (Array.isArray(value) && !Array.isArray(r[key])) invalid();
            if (typeof value === 'string' && typeof r[key] !== 'string') invalid();
          }
          if (M.validate(t, r).length) invalid();
          const cur = mode === 'merge' && cache.tables[t].get(r.id);
          if (keepCurrent(t, cur, r)) { sum.skipped++; continue; }
          incoming.tables[t].push(r); sum.rows++;
        }
      }
      for (const name of M.DOCS) {
        const inc = data.docs[name];
        if (!object(inc) || inc.id !== name) invalid();
        for (const [key, value] of Object.entries(M.make(name))) {
          if (Array.isArray(value) && !Array.isArray(inc[key])) invalid();
          if (typeof value === 'string' && typeof inc[key] !== 'string') invalid();
        }
        const cur = cache.docs[name];
        const emptyDraft = name === 'drafts' && cur && !Object.keys(cur).some((k) => !['id', 'updatedAt'].includes(k) && cur[k]);
        const legacyDraft = name === 'drafts' && !inc.updatedAt && emptyDraft && !cur.updatedAt;
        if (cur && mode === 'merge' && !legacyDraft && String(cur.updatedAt || '') >= String(inc.updatedAt || '')) continue;
        incoming.docs[name] = inc;
      }
      const photoIds = new Set(data.tables.photos.map((p) => p.id));
      for (const p of data.photos) {
        if (!object(p) || !photoIds.has(p.id) || blobs.has(p.id) || typeof p.data !== 'string' || !/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(p.mime)) invalid();
        try { blobs.set(p.id, base64ToBlob(p.data, p.mime)); } catch (e) { invalid(); }
      }
      // 既存の写真を新しいメタデータと食い違わせない。
      for (const p of data.tables.photos) {
        const old = mode === 'merge' && await backend.blobGet(p.id);
        const selected = incoming.tables.photos.some((r) => r.id === p.id);
        if (old && !selected) blobs.delete(p.id);
        if (!old && !blobs.has(p.id)) invalid();
      }
      sum.photos = blobs.size;
      try { await backend.applyImport(incoming, blobs, mode === 'replace'); }
      catch (e) { throw fail('import', e); }
      if (mode === 'replace') {
        Object.keys(cache.docs).forEach((k) => delete cache.docs[k]);
        M.TABLES.forEach((t) => cache.tables[t].clear());
      }
      Object.assign(cache.docs, U.clone(incoming.docs));
      M.TABLES.forEach((t) => incoming.tables[t].forEach((r) => cache.tables[t].set(r.id, U.clone(r))));
      ensureDocs(); release();
      bus.emit('store:changed', { coll: '*', id: '*', op: 'import' });
      bus.emit('backup:done', { kind: 'import' });
      return sum;
    },
    /** 全消去。 */
    async wipe(opts) {
      await draftWrite.catch(() => {});
      const empty = { docs: {}, tables: {} };
      M.DOCS.forEach((n) => { empty.docs[n] = M.make(n); });
      empty.docs.settings.migratedV1 = 'wiped';
      M.TABLES.forEach((t) => { empty.tables[t] = []; });
      try { await backend.applyImport(empty, new Map(), true); } catch (e) { throw fail('wipe', e); }
      Object.keys(cache.docs).forEach((k) => delete cache.docs[k]);
      Object.assign(cache.docs, empty.docs);
      draftDirty = false;
      M.TABLES.forEach((t) => cache.tables[t].clear());
      release();
      if (!opts || !opts.silent) { bus.emit('store:changed', { coll: '*', id: '*', op: 'wipe' }); bus.emit('backup:done', { kind: 'wipe' }); }
    },
    async usage() {
      const out = { usage: null, quota: null, persisted: null };
      try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); out.usage = e.usage; out.quota = e.quota; } } catch (e) { /* 無視 */ }
      try { if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted(); } catch (e) { /* 無視 */ }
      return out;
    },
    /** 「消さないで」とブラウザに頼む。通っても過信しない。 */
    async persist() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; } },
  };

  let draftDirty = false, draftWrite = Promise.resolve();
  function saveDraft() {
    draftWrite = draftWrite.catch(() => {}).then(async () => {
      if (!draftDirty || !backend) return;
      const d = U.clone(cache.docs.drafts);
      try { await backend.putDoc(d); }
      catch (e) { throw fail('write', e); }
      if (JSON.stringify(cache.docs.drafts) === JSON.stringify(d)) draftDirty = false;
    });
    return draftWrite;
  }
  const flushDraft = U.debounce(() => { saveDraft().catch(() => {}); }, 400);
  const flushDraftNow = () => { flushDraft.flush(); };
  window.addEventListener('pagehide', flushDraftNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraftNow(); });

  function release(id) {
    if (id) { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } return; }
    urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear();
  }
  function fail(kind, e) {
    const quota = !!(e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || '')));
    const msg = quota ? '端末の空き容量がいっぱいです。バックアップを書き出して、いらない写真を消してください。' : '保存できませんでした。' + ((e && e.message) || '');
    bus.emit('store:error', { kind, message: msg, quota });
    const err = e instanceof Error ? e : new Error(msg);
    err.userMessage = msg; err.quota = quota;
    return err;
  }
  function ensureDocs() { M.DOCS.forEach((n) => { if (!cache.docs[n]) cache.docs[n] = M.make(n); }); }
  function keepCurrent(table, cur, inc) {
    if (!cur) return false;
    // 初期旅程の自動投入日時より、本人による編集を優先する。
    if (table === 'days' && !!cur.edited !== !!inc.edited) return !!cur.edited;
    return String(cur.updatedAt || '') >= String(inc.updatedAt || '');
  }
  async function blobToBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function base64ToBlob(b64, mime) {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'image/jpeg' });
  }

  store.ready = (async () => {
    let loaded;
    if (!backend) {
      try {
        backend = idbBackend(await openIDB());
        loaded = await backend.load();
        let raw = null;
        try { raw = localStorage.getItem(LS_KEY); }
        catch (e) { store.degraded = '退避保存の読み取りはできませんが、通常の保存領域を使えます。'; }
        if (raw) {
          const fallback = memoryBackend(true), saved = await fallback.load(true);
          const incoming = { docs: {}, tables: {} };
          for (const [n, d] of Object.entries(saved.docs)) if (!keepCurrent(n, loaded.docs[n], d)) incoming.docs[n] = d;
          M.TABLES.forEach((t) => {
            const existing = new Map(loaded.tables[t].map((r) => [r.id, r]));
            incoming.tables[t] = saved.tables[t].filter((r) => !keepCurrent(t, existing.get(r.id), r));
          });
          const photos = new Set(incoming.tables.photos.map((r) => r.id));
          await backend.applyImport(incoming, new Map([...saved.blobs].filter(([id]) => photos.has(id))), false);
          loaded = await backend.load();
          if (localStorage.getItem(LS_KEY) === raw) localStorage.removeItem(LS_KEY);
        }
        store.backendName = 'indexeddb';
      }
      catch (e) {
        console.warn('[store] IndexedDB が使えません。localStorage に退避します:', e);
        backend = memoryBackend(true); store.backendName = 'localstorage';
        store.degraded = '退避保存を使っています。容量が限られるため、写真つきバックアップをこまめに残してください。';
        try { loaded = await backend.load(); }
        catch (err) {
          backend = memoryBackend(false); store.backendName = 'memory';
          store.degraded = '保存領域を読めません。この画面を閉じる前にバックアップを書き出してください。';
          loaded = await backend.load();
        }
      }
    }
    loaded = loaded || await backend.load();
    Object.assign(cache.docs, loaded.docs);
    M.TABLES.forEach((t) => (loaded.tables[t] || []).forEach((r) => cache.tables[t].set(r.id, r)));
    ensureDocs();
    if (T.migrate) await T.migrate.run(store, backend).catch((e) => console.error('[migrate]', e));
    return store;
  })();

  store._memoryBackend = memoryBackend; // テスト用
  T.store = store;
})();
