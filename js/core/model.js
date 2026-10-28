/* model.js — 共有データモデルの定数・イベント名・ひな形・検証。
 * スキーマの正は ARCHITECTURE.md §3。ここはその機械可読版。 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});

  const PURPOSES = [
    { id: 'learn', label: '学びを残す', short: '学び' },
    { id: 'feel', label: '感動を自分のために残す', short: '感動' },
    { id: 'share', label: '経験を分かってもらう', short: '経験' },
    { id: 'useful', label: '人の役に立つ情報', short: '役立ち' },
    { id: 'cheer', label: '応援してくれる人を楽しませる', short: '応援' },
  ];
  const AUDIENCES = [
    { id: 'self', label: '自分のため' },
    { id: 'friends', label: '友達' },
    { id: 'seekers', label: '役立つ情報を探している人' },
    { id: 'supporters', label: '応援してくれている人' },
  ];
  /** 投稿の切り口。既定は surprise（自慢中心にしない）。 */
  const ANGLES = [
    { id: 'surprise', label: '意外だった' },
    { id: 'moved', label: '感動した' },
    { id: 'useful', label: '役に立つ' },
    { id: 'brag', label: 'ちょっと自慢' },
    { id: 'finalist', label: 'ファイナリストとして' },
  ];
  const ITEM_KINDS = ['flight', 'move', 'stay', 'sight', 'event', 'meal', 'free'];
  const SPOT_KINDS = ['sight', 'hotel', 'airport', 'venue', 'station', 'food', 'other'];

  /** table = 行の集まり(id 主キー) / doc = 1つだけの設定的な塊 */
  const TABLES = ['days', 'spots', 'posts', 'notes', 'hearing', 'visits', 'photos'];
  const DOCS = ['trip', 'purposes', 'settings', 'drafts'];

  /** バスのイベント名の正。detail の形を右に書く。 */
  const EVENTS = {
    'calendar:changed': '{date}',
    'record:operation-start': '{operationId}',
    'record:operation-end': '{operationId, result}',
    'pwa:changed': '{status, updateWaiting}',
    'app:ready': '{}',
    'app:online': '{}',
    'app:offline': '{}',
    'route:changed': '{route, params}',
    'store:changed': "{coll, id, op:'put'|'remove'|'doc'|'import'|'wipe'}",
    'store:error': '{kind, message, quota:boolean}',
    'seed:updated': '{days:[id], stale:[id]}',
    'purposes:changed': '{purposeIds, audienceIds}',
    'hearing:added': '{entry}',
    'day:changed': '{day}',
    'post:saved': '{post}',
    'post:shared': "{post, via:'x'|'copy'}",
    'note:saved': '{note}',
    'photo:added': '{photo}',
    'visit:added': '{visit}',
    'recap:opened': "{variant:'memory'|'learning'}",
    'fairy:say': '{text, tone?, ttl?}',
    'backup:done': "{kind:'export'|'import'|'wipe'}",
    'settings:changed': '{key}',
  };
  /** bus.request の名前。返り値の形を右に書く。応答が無ければ null。 */
  const REQUESTS = {
    'fairy:compose': "{kind:'recap-open'|'recap-return'|'arrive'|…, …} -> string|null",
    'suggest:today': '{date} -> [{id, angle, when, text, reason, spotId?}]',
  };

  const now = () => (T.util ? T.util.iso() : new Date().toISOString());
  const arr = (v) => (Array.isArray(v) ? v : []);

  /** 各コレクションの既定形。put 前に make() で埋めると欠けがなくなる。 */
  const FACTORY = {
    trip: () => ({ id: 'trip', name: 'たびのこ', origin: '', destination: '', start: '', end: '', tzHome: 'Asia/Tokyo', tzDest: 'Asia/Kolkata' }),
    purposes: () => ({ id: 'purposes', purposeIds: [], audienceIds: [], note: '' }),
    settings: () => ({ id: 'settings', schema: 2, uiHaptics: false, uiSound: true, uiFairy: true, uiMotion: true, onboardedAt: null, seedRev: 0, angleDefault: 'surprise', lastBackupAt: null, backupNudgeAt: null, installCoachDismissedAt: null, persistAsked: false, wantsHdVideo: false, migratedV1: null }),
    drafts: () => ({ id: 'drafts' }),
    days: () => ({ id: '', date: '', title: '', headline: '', note: '', items: [], candidates: [], edited: false, seedRev: 0, staleSeed: 0 }),
    spots: () => ({ id: '', name: '', lat: null, lng: null, note: '', kind: 'sight', custom: true }),
    posts: () => ({ id: '', date: '', at: now(), text: '', prompt: '', angle: 'surprise', purposeIds: [], audienceIds: [], spotId: null, photoIds: [], sharedAt: null, sharedVia: null, showInTimeline: true }),
    notes: () => ({ id: '', date: '', at: now(), text: '', photoIds: [], spotId: null, showInTimeline: true }),
    hearing: () => ({ id: '', date: '', at: now(), text: '', source: 'fairy' }),
    visits: () => ({ id: '', date: '', at: now(), spotId: null, title: '', lat: null, lng: null, note: '' }),
    photos: () => ({ id: '', date: '', at: now(), mime: 'image/jpeg', w: 0, h: 0, bytes: 0 }),
  };
  const ITEM = () => ({ id: '', title: '', time: '', spotId: null, kind: 'sight', note: '' });

  const CHECKS = {
    days: (r, e) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) e.push('days.date は YYYY-MM-DD'); if (r.id !== r.date) e.push('days.id は date と同じ'); arr(r.items).forEach((it, i) => { if (!it.id) e.push('items[' + i + '].id なし'); }); },
    posts: (r, e) => { if (!r.date) e.push('posts.date なし'); if (typeof r.text !== 'string') e.push('posts.text は文字列'); if (!ANGLES.some((a) => a.id === r.angle)) e.push('posts.angle 不正'); },
    notes: (r, e) => { if (!r.date) e.push('notes.date なし'); },
    hearing: (r, e) => { if (!r.text) e.push('hearing.text なし'); },
    visits: (r, e) => { if (!r.date) e.push('visits.date なし'); },
    photos: (r, e) => { if (!r.date) e.push('photos.date なし'); },
    spots: (r, e) => { if (!r.name) e.push('spots.name なし'); },
  };

  const model = {
    PURPOSES, AUDIENCES, ANGLES, ITEM_KINDS, SPOT_KINDS, TABLES, DOCS, EVENTS, REQUESTS, FACTORY,
    purpose: (id) => PURPOSES.find((p) => p.id === id) || null,
    audience: (id) => AUDIENCES.find((a) => a.id === id) || null,
    angle: (id) => ANGLES.find((a) => a.id === id) || ANGLES[0],
    /** 既定値を埋めた新しい行を返す。 */
    make(coll, partial) {
      const f = FACTORY[coll];
      if (!f) throw new Error('unknown collection: ' + coll);
      return Object.assign(f(), partial || {});
    },
    makeItem(partial) { return Object.assign(ITEM(), partial || {}); },
    /** 問題の文字列配列を返す（空なら OK）。store.put が dev で警告に使う。 */
    validate(coll, row) {
      const errors = [];
      if (!row || typeof row !== 'object') return ['row が object ではない'];
      if (!row.id) errors.push('id なし');
      if (CHECKS[coll]) CHECKS[coll](row, errors);
      return errors;
    },
  };
  T.model = model;
})();
