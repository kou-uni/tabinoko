/* bus.js — イベントバス。モジュール同士はこれと store 経由でのみ話す。
 * emit(name, detail) / on(name, fn) -> off / once / off
 * request(name, payload) : 1つだけ応答できる問い合わせ。handle(name, fn) で受ける。
 *   応答が無い・遅い(1.5秒)・例外のときは null で解決する（呼ぶ側は必ず null を想定する）。
 * 名前は model.js の EVENTS に載っているものだけ。未知の名前は console.warn（打ち間違い検出）。 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});
  const subs = new Map();
  const handlers = new Map();
  const known = () => (T.model && T.model.EVENTS) || null;
  const warnUnknown = (name, kind) => {
    const k = known();
    if (k && !(name in k) && !(T.model.REQUESTS && name in T.model.REQUESTS)) console.warn('[bus] 未登録の' + kind + '名: ' + name + '（model.js に追加してください）');
  };
  const bus = {
    on(name, fn) {
      warnUnknown(name, 'イベント');
      if (!subs.has(name)) subs.set(name, new Set());
      subs.get(name).add(fn);
      return () => bus.off(name, fn);
    },
    once(name, fn) {
      const off = bus.on(name, (d) => { off(); fn(d); });
      return off;
    },
    off(name, fn) { const s = subs.get(name); if (s) s.delete(fn); },
    emit(name, detail) {
      warnUnknown(name, 'イベント');
      const s = subs.get(name);
      if (!s) return;
      [...s].forEach((fn) => { try { fn(detail); } catch (e) { console.error('[bus] handler error in ' + name, e); } });
    },
    handle(name, fn) { warnUnknown(name, '問い合わせ'); handlers.set(name, fn); },
    async request(name, payload, timeoutMs) {
      const h = handlers.get(name);
      if (!h) return null;
      try {
        return await Promise.race([
          Promise.resolve(h(payload)),
          new Promise((r) => setTimeout(() => r(null), timeoutMs || 1500)),
        ]);
      } catch (e) { console.error('[bus] request error in ' + name, e); return null; }
    },
  };
  T.bus = bus;
})();
