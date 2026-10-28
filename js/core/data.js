/* data.js — 旅の初期データ（js/data/itinerary.js = window.TABI_SEED）と store の橋渡し。
 *
 * 旅程が更新されたら seed.rev を上げる。次回起動で:
 *   - 本人が触っていない日（edited=false）は自動で新しい内容に置き換わる
 *   - 触った日（edited=true）は残し、staleSeed に新 rev を立てる（plan が「新しい予定に更新」を出せる）
 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});
  const U = T.util, M = T.model;

  const data = {
    seed() { return window.TABI_SEED || { rev: 0, trip: M.make('trip'), spots: {}, days: [] }; },
    /** 場所を id で引く（seed + 本人が足したもの） */
    spot(id) { return data.seed().spots[id] || (T.store && T.store.get('spots', id)) || null; },
    spots() {
      const seed = Object.values(data.seed().spots);
      const custom = T.store ? T.store.all('spots') : [];
      return seed.concat(custom);
    },
    day(date) { return T.store.get('days', date); },
    days() { return T.store.all('days'); },
    /** 旅の何日目か（旅の外は null）。初日 = 1 */
    dayNumber(date) { const ds = data.days(); const i = ds.findIndex((d) => d.date === date); return i < 0 ? null : i + 1; },
    seedDay(date) { return data.seed().days.find((d) => d.date === date) || null; },

    async syncSeed(store) {
      const seed = data.seed();
      const settings = store.doc('settings');
      if (seed.trip && settings.seedRev !== seed.rev) await store.setDoc('trip', Object.assign(M.make('trip'), seed.trip));
      const changed = [], stale = [];
      const seedIds = new Set(seed.days.map((d) => d.id));
      for (const sd of seed.days) {
        const row = store.get('days', sd.id);
        const fresh = () => M.make('days', Object.assign(U.clone(sd), { seedRev: seed.rev, edited: false, staleSeed: 0 }));
        if (!row) { await store.put('days', fresh()); changed.push(sd.id); continue; }
        if ((row.seedRev || 0) >= seed.rev) continue;
        if (!row.edited) { await store.put('days', fresh()); changed.push(sd.id); }
        else { row.staleSeed = seed.rev; await store.put('days', row); stale.push(sd.id); }
      }
      for (const row of store.all('days')) {
        if (!seedIds.has(row.id) && !row.edited && row.seedRev) { await store.remove('days', row.id); changed.push(row.id); }
      }
      if (settings.seedRev !== seed.rev) await store.setDoc('settings', { seedRev: seed.rev });
      if (changed.length || stale.length) T.bus.emit('seed:updated', { days: changed, stale });
      return { changed, stale };
    },
  };
  T.data = data;
})();
