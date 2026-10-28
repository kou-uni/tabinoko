/* migrate.js — v0 試作（localStorage 'tabinoko.v1' + IndexedDB 'tabinoko-photos'）からの引っ越し。
 * 元データは消さない。一度だけ実行し、settings.migratedV1 に結果を残す。 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});
  const U = T.util, M = T.model;

  /** v1 の state を v2 の行に変換する（純粋関数。Node でテストできる）。 */
  function convertV1(state, seed) {
    const out = { purposes: null, onboarded: false, days: [], hearing: [], posts: [], notes: [], photoIds: [], drafts: {} };
    if (typeof state.purpose === 'number' && M.PURPOSES[state.purpose]) {
      out.purposes = { purposeIds: [M.PURPOSES[state.purpose].id], audienceIds: [] };
      out.onboarded = true;
    }
    const seedDays = {};
    ((seed && seed.days) || []).forEach((d) => { seedDays[d.date] = d; });
    (state.days || []).forEach((d) => {
      if (!d.date) return;
      const base = seedDays[d.date];
      const items = (d.items || []).map((x, i) => M.makeItem({ id: x.id || d.date + '-m' + (i + 1), title: x.title, time: x.time || '', spotId: x.spot || null, kind: 'sight' }));
      const sig = (o) => JSON.stringify([o.title, o.headline, o.note, (o.items || []).map((x) => [x.title, x.time, x.spotId])]);
      const row = { id: d.date, date: d.date, title: d.t, headline: d.h, note: d.p, items, candidates: d.candidates || [], seedRev: 0 };
      row.edited = base ? sig(row) !== sig(base) : true;
      out.days.push(row);
    });
    (state.chats || []).forEach((c, i) => out.hearing.push({ id: 'v1c' + i, date: c.date, at: (c.date || '2026-10-28') + 'T00:00:00.000Z', text: c.text, source: 'fairy' }));
    (state.entries || []).forEach((e) => {
      const at = e.created || (e.date + 'T00:00:00.000Z');
      if (e.type === 'post') out.posts.push({ id: e.id, date: e.date, at, text: e.text, angle: 'surprise', photoIds: [] });
      else { out.notes.push({ id: e.id, date: e.date, at, text: e.text || '', photoIds: e.photo ? [e.id] : [] }); if (e.photo) out.photoIds.push(e.id); }
    });
    out.drafts = { hearing: state.chatDraft || '', post: state.postDraft || '', note: state.memoDraft || '' };
    return out;
  }

  function readOldPhoto(id) {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open('tabinoko-photos'); } catch (e) { return resolve(null); }
      req.onerror = () => resolve(null);
      req.onupgradeneeded = () => { req.transaction.abort(); resolve(null); }; // 旧DBが無かった: 作らない
      req.onsuccess = () => {
        const db = req.result;
        try {
          const g = db.transaction('photos', 'readonly').objectStore('photos').get(id);
          g.onsuccess = () => { db.close(); resolve(g.result || null); };
          g.onerror = () => { db.close(); resolve(null); };
        } catch (e) { db.close(); resolve(null); }
      };
    });
  }

  async function run(store, backend) {
    if (store.doc('settings').migratedV1) return;
    let raw = null;
    try { raw = localStorage.getItem('tabinoko.v1'); } catch (e) { /* 無視 */ }
    if (!raw) { await store.setDoc('settings', { migratedV1: 'none' }); return; }
    let state;
    try { state = JSON.parse(raw); } catch (e) { await store.setDoc('settings', { migratedV1: 'unreadable' }); return; }
    const c = convertV1(state, window.TABI_SEED);
    if (c.purposes) await store.setDoc('purposes', c.purposes);
    if (c.onboarded) await store.setDoc('settings', { onboardedAt: U.iso() });
    for (const d of c.days) await store.put('days', M.make('days', d));
    for (const h of c.hearing) await store.put('hearing', M.make('hearing', h));
    for (const p of c.posts) await store.put('posts', M.make('posts', p));
    for (const n of c.notes) await store.put('notes', M.make('notes', n));
    let copied = 0;
    for (const id of c.photoIds) {
      const blob = await readOldPhoto(id);
      if (blob) { await store.photos.put(blob, { id, date: (c.notes.find((n) => n.id === id) || {}).date }); copied++; }
    }
    await store.setDoc('drafts', c.drafts);
    await store.setDoc('settings', { migratedV1: U.iso() + ' days=' + c.days.length + ' photos=' + copied });
  }

  T.migrate = { run, convertV1 };
})();
