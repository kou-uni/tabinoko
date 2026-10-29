/* PWA の準備状態。更新は全タブを閉じた後に適用し、入力中に再読込しない。 */
(function () {
  'use strict';
  const T = window.Tabi;
  const MAP_ORIGIN = 'https://tiles.openfreemap.org';
  // Web Mercator。各スポットを囲む3×3、重複排除。DOMや現在地に依存しない。
  function tileCoordinates(spots, maxZoom = 15, limit = 400) {
    const tiles = new Map();
    const cap = Math.min(400, Math.max(0, Math.floor(limit) || 0));
    for (let z = 12; z <= Math.min(15, maxZoom); z++) {
      const n = 2 ** z;
      for (const spot of spots) {
        if (!spot || spot.hidden || !Number.isFinite(spot.lat) || !Number.isFinite(spot.lng) || Math.abs(spot.lat) > 90 || Math.abs(spot.lng) > 180) continue;
        const lat = Math.max(-85.05112878, Math.min(85.05112878, spot.lat)) * Math.PI / 180;
        const x = Math.floor((spot.lng + 180) / 360 * n);
        const y = Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * n)));
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          if (y + dy < 0 || y + dy >= n) continue;
          const tile = { z, x: ((x + dx) % n + n) % n, y: y + dy };
          const key = `${z}/${tile.x}/${tile.y}`;
          if (tiles.size < cap) tiles.set(key, tile);
        }
      }
    }
    return [...tiles.values()];
  }
  const allowed = url => new URL(url).origin === MAP_ORIGIN;
  async function warmMaps(spots, signal, progress) {
    const seen = new Set();
    let failed = 0;
    async function get(url, json = false) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!allowed(url) || seen.size >= 600) throw new Error('map resource limit');
      seen.add(url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      try {
        const res = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok) throw new Error('map unavailable');
        const body = json ? await res.json() : await res.arrayBuffer();
        // SWが容量不足で保存できなくてもHTTP取得は成功するため、保存を確認する。
        const cache = await caches.open('tabinoko-map-v1');
        if (!await cache.match(url)) throw new Error('map not saved');
        return body;
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    }
    // スタイルが指す版付きTileJSONから実際のタイルURLを解決する。
    const style = await get(MAP_ORIGIN + '/styles/bright', true);
    const assets = new Set(), tiles = new Set();
    const add = url => { if (allowed(url)) assets.add(url); };
    const sprites = typeof style.sprite === 'string' ? [style.sprite] : (style.sprite || []).map(s => s.url);
    sprites.forEach(url => ['', '@2x'].forEach(scale => ['.json', '.png'].forEach(ext => add(url + scale + ext))));
    if (style.glyphs) {
      const fonts = new Set();
      (style.layers || []).forEach(layer => {
        const font = layer.layout && layer.layout['text-font'];
        if (Array.isArray(font) && font.every(f => typeof f === 'string') && !['match', 'case', 'step', 'get'].includes(font[0])) fonts.add(font.join(','));
      });
      const ranges = new Set([0, 256, 0x3000, 0xff00]);
      // 地名の漢字とかな。その他の文字は表示時の実行時キャッシュで保存。
      for (let start = 0x4e00; start <= 0x9f00; start += 256) ranges.add(start);
      fonts.forEach(font => ranges.forEach(start => {
        if (assets.size < 190) add(style.glyphs.replace('{fontstack}', encodeURIComponent(font)).replace('{range}', start + '-' + (start + 255)));
      }));
    }
    for (const source of Object.values(style.sources || {})) {
      if (source.type !== 'vector') continue;
      const info = source.url ? await get(source.url, true) : source;
      const template = (info.tiles || [])[0];
      if (!template) continue;
      // z15 はソースの最大ズームが14ならz14を拡大表示する。
      tileCoordinates(spots, info.maxzoom == null ? 15 : info.maxzoom).forEach(t => {
        const y = info.scheme === 'tms' ? 2 ** t.z - 1 - t.y : t.y;
        const url = template.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', y);
        if (allowed(url) && tiles.size < 400) tiles.add(url);
      });
    }
    if (!tiles.size) throw new Error('no map tiles');
    const urls = [...assets, ...tiles].filter(url => !seen.has(url)).slice(0, 600 - seen.size);
    let done = 0;
    progress({ done, total: urls.length, failed });
    for (const url of urls) {
      if (signal.aborted) break;
      try { await get(url); } catch (_) { if (!signal.aborted) failed++; }
      progress({ done: ++done, total: urls.length, failed });
    }
    return { done, total: urls.length, failed, aborted: signal.aborted };
  }
  T.mapOffline = { tileCoordinates, warmMaps };
  const state = T.pwa = { status: 'unavailable', updateWaiting: false };
  const publish = () => T.bus.emit('pwa:changed', Object.assign({}, state));
  if (!('serviceWorker' in navigator)) return;
  if (T.util.param('nosw') !== null) { state.status = 'disabled'; return; }
  if (!(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return;
  state.status = 'preparing';
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const sync = () => {
        state.status = navigator.serviceWorker.controller ? 'ready' : 'preparing';
        state.updateWaiting = !!reg.waiting; publish();
      };
      navigator.serviceWorker.addEventListener('controllerchange', sync);
      const watch = () => { const worker = reg.installing; if (worker) worker.addEventListener('statechange', () => {
        if (worker.state === 'redundant' && !navigator.serviceWorker.controller) state.status = 'error';
        else sync();
        publish();
      }); };
      reg.addEventListener('updatefound', watch); watch(); sync();
      navigator.serviceWorker.ready.then(sync);
    } catch (e) { state.status = 'error'; publish(); }
  });
})();
