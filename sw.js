/* sw.js — Service Worker。所有: platform。
 * 出発前に Wi-Fi で一度開けば、以後は回線なしで起動できる（全部プリキャッシュ）。cache-first。
 * 更新は「次に開いた時」に反映（skipWaiting しない）。旅の最中に画面が勝手に変わらないように。
 * PRECACHE ブロックは tools/gen-precache.cjs が書く。手で編集しない（ファイルを足したら node tools/gen-precache.cjs）。 */
/*PRECACHE:BEGIN*/
const VERSION = 'f1eb7cfad9';
const FILES = ["./", "config/maps.json", "config/payment.json", "css/base.css", "css/mod-compose.css", "css/mod-fairy.css", "css/mod-legal.css", "css/mod-map.css", "css/mod-movie.css", "css/mod-notes.css", "css/mod-onboarding.css", "css/mod-plan.css", "css/mod-progress.css", "css/mod-recap.css", "css/mod-settings.css", "css/mod-suggest.css", "css/mod-timeline.css", "css/mod-upgrade.css", "css/motion.css", "data/seed.enc.json", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "index.html", "js/core/boot.js", "js/core/bus.js", "js/core/data.js", "js/core/feedback.js", "js/core/license.js", "js/core/migrate.js", "js/core/model.js", "js/core/movie-render.js", "js/core/notebook.js", "js/core/photo.js", "js/core/progress.js", "js/core/pwa.js", "js/core/router.js", "js/core/store.js", "js/core/tap-counter.js", "js/core/ui.js", "js/core/unlock.js", "js/core/util.js", "js/core/voice.js", "js/modules/about.js", "js/modules/compose.js", "js/modules/fairy.js", "js/modules/map.js", "js/modules/movie.js", "js/modules/notes.js", "js/modules/onboarding.js", "js/modules/plan.js", "js/modules/progress.js", "js/modules/recap.js", "js/modules/settings.js", "js/modules/suggest.js", "js/modules/timeline.js", "js/modules/upgrade.js", "landing/index.html", "landing/landing.css", "landing/landing.js", "legal/legal.css", "legal/privacy.html", "legal/terms.html", "legal/tokushoho.html", "manifest.webmanifest", "vendor/leaflet/images/layers-2x.png", "vendor/leaflet/images/layers.png", "vendor/leaflet/images/marker-icon-2x.png", "vendor/leaflet/images/marker-icon.png", "vendor/leaflet/images/marker-shadow.png", "vendor/leaflet/leaflet.css", "vendor/leaflet/leaflet.js"];
/*PRECACHE:END*/
const CACHE = 'tabinoko-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tabinoko-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 地図タイル・X などは触らない
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (err) {
      if (req.mode === 'navigate') { const shell = await cache.match('./index.html'); if (shell) return shell; }
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
