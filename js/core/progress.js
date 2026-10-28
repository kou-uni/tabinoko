/* Pure calendar-based derivation. No DOM, storage, or clock dependencies. */
(function (root) {
  'use strict';
  const valid = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  const next = (d, n = 1) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const unique = rows => [...new Map((rows || []).filter(r => r && r.id).map(r => [r.id, r])).values()];
  const text = r => typeof r.text === 'string' && !!r.text.trim();
  const visitKey = r => r.spotId ? 'spot:' + r.spotId : Number.isFinite(r.lat) && Number.isFinite(r.lng) ? 'geo:' + r.lat + ',' + r.lng : 'id:' + r.id;
  function calculate(snapshot, today) {
    const s = snapshot || {}, trip = s.trip || {}, start = trip.start, end = trip.end;
    const period = valid(start) && valid(end) && start <= end;
    const days = [], totals = { photos: 0, notes: 0, posts: 0, visits: 0 }, places = new Set();
    const photos = unique(s.photos).filter(r => [r.w, r.h, r.bytes].every(n => Number.isFinite(n) && n > 0) && !(s.missingPhotoIds || []).includes(r.id));
    const photoIds = new Set(photos.map(r => r.id));
    const notes = [...unique(s.notes), ...unique(s.hearing)].filter(text);
    const posts = unique(s.posts).filter(r => text(r) || (Array.isArray(r.photoIds) && r.photoIds.some(id => photoIds.has(id))));
    const visits = unique(s.visits);
    if (period) for (let d = start; d <= end; d = next(d)) {
      const eligible = valid(today) && d <= today;
      const at = rows => eligible ? rows.filter(r => r.date === d) : [];
      const P = at(photos).length, N = at(notes).length, C = at(posts).length, vs = at(visits), V = new Set(vs.map(visitKey)).size;
      vs.forEach(r => places.add(visitKey(r)));
      const complete = P > 0 && N > 0 && C > 0;
      const xp = 10 * Number(P > 0) + 10 * Number(N > 0) + 20 * Number(C > 0) + 10 * Number(V > 0) + 20 * Number(complete);
      days.push({ date: d, P, N, C, V, xp, complete, active: P + N + C + V > 0, eligible, missions: [P > 0, N > 0, C > 0] });
      totals.photos += P; totals.notes += N; totals.posts += C;
      if (d === end) break;
    }
    totals.visits = places.size;
    const xp = days.reduce((n, d) => n + d.xp, 0), recordedDays = days.filter(d => d.active).length;
    const active = new Set(days.filter(d => d.active).map(d => d.date));
    let longest = 0, run = 0, streak = 0;
    days.forEach(d => { run = d.active ? run + 1 : 0; longest = Math.max(longest, run); });
    if (valid(today)) for (let d = active.has(today) ? today : next(today, -1); active.has(d); d = next(d, -1)) streak++;
    const ratio = days.length ? xp / (70 * days.length) : 0;
    const rank = !period ? '旅程を確認' : !xp ? '未記録' : ratio >= .8 ? '夜航の記録者' : ratio >= .55 ? '街を綴る人' : ratio >= .25 ? '路地の採集者' : '最初の足跡';
    const conditions = [
      ['first-photo', '最初の一枚', '写真1枚', totals.photos >= 1], ['five-photos', '五つの場面', '写真5枚', totals.photos >= 5],
      ['first-note', '現場のひとこと', 'メモまたは会話1件', totals.notes > 0], ['first-draft', '文案を携えて', '文案1件', totals.posts > 0],
      ['first-visit', '足跡を打つ', '異なる訪問地点1か所', places.size > 0], ['three-visits', '三つの地点', '異なる訪問地点3か所', places.size >= 3],
      ['daily-three', '一日を収める', '1日で写真・メモ・文案を保存', days.some(d => d.complete)], ['streak-three', '三日をつなぐ', '最長3日連続', longest >= 3],
      ['half-days', '旅の半分を記録', '旅程の半分以上の日に記録', period && recordedDays >= Math.ceil(days.length / 2)]
    ];
    return { period, days, totals, xp, level: 1 + Math.floor(xp / 100), remaining: 100 - xp % 100, ratio, rank, recordedDays, streak, longest, ended: period && today > end, achievements: conditions.map(([id, label, condition, earned]) => ({ id, label, condition, earned })) };
  }
  const api = { calculate, valid, next, visitKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.Tabi = root.Tabi || {}).progress = api;
})(typeof window !== 'undefined' ? window : globalThis);
