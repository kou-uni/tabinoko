/* map — F11。足跡は手動で visits に保存。地図は明示操作時だけ読み込む。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store, data = T.data;
  let leafletPromise = null;
  const coordinates = (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180;

  function places() {
    const planned = new Map();
    data.days().forEach((d) => (d.items || []).forEach((item) => {
      const s = item.spotId && data.spot(item.spotId);
      if (!s || s.hidden) return;
      if (!planned.has(item.spotId)) planned.set(item.spotId, { ...s, id: item.spotId, dates: [] });
      const dates = planned.get(item.spotId).dates;
      if (!dates.includes(d.date)) dates.push(d.date);
    }));
    const visits = store.all('visits').sort((a, b) => String(b.at).localeCompare(String(a.at))).map((v) => {
      const s = data.spot(v.spotId) || {};
      return { ...s, ...v, name: v.title || s.name || '旅の足跡', ...(coordinates(v) ? {} : { lat: s.lat, lng: s.lng }), visit: true };
    });
    const remaining = [...planned.values()].map((s) => ({ ...s, dates: s.dates.filter((date) => !visits.some((v) => v.spotId === s.id && v.date >= date)) })).filter((s) => s.dates.length);
    return { planned: remaining, visits };
  }

  function links(s) {
    const valid = coordinates(s), query = encodeURIComponent(s.name);
    const google = valid ? U.mapLink(s, 'google') : 'https://www.google.com/maps/search/?api=1&query=' + query;
    const osm = valid ? U.mapLink(s, 'osm') : 'https://www.openstreetmap.org/search?query=' + query;
    const destination = valid ? s.lat + ',' + s.lng : s.name;
    const link = (href, text) => '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + text + ' ↗</a>';
    return '<div class="map-links">' + link(google, 'Google マップで開く') + link(osm, 'OSM で開く')
      + link('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(destination), 'ここへの経路') + '</div>';
  }

  function card(s) {
    const dates = s.visit ? esc(s.date) + ' に行ったよ' : '予定：' + s.dates.map(esc).join('・');
    return '<article class="map-spot ' + (s.visit ? 'map-visited' : 'map-planned') + '"><span class="map-badge">' + (s.visit ? '✓ 行った場所' : '○ 予定の場所') + '</span>'
      + '<h3>' + esc(s.name) + '</h3><p class="map-date">' + dates + '</p>'
      + (s.note ? '<p class="map-note">' + esc(s.note) + '</p>' : '')
      + '<p class="caption">' + (coordinates(s) ? s.lat.toFixed(4) + ', ' + s.lng.toFixed(4) : '位置はまだ未設定。地図アプリで名前から探せるよ。') + '</p>'
      + links(s) + (s.visit ? '<button data-map-undo="' + esc(s.id) + '" aria-label="' + esc(s.name + 'の足跡を取り消す') + '">足跡を取り消す</button>'
        : '<button class="primary" data-map-visit="' + esc(s.id) + '" aria-label="' + esc(s.name + 'に今日行ったと記録する') + '">今日、行ったよ ✓</button>') + '</article>';
  }

  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!leafletPromise) {
      U.loadCSS('vendor/leaflet/leaflet.css');
      leafletPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 10000);
        U.loadScript('vendor/leaflet/leaflet.js').then(() => {
          clearTimeout(timer);
          if (window.L) resolve(window.L); else reject(new Error('missing Leaflet'));
        }, (err) => { clearTimeout(timer); reject(err); });
      }).catch((err) => { leafletPromise = null; throw err; });
    }
    return leafletPromise;
  }

  T.register({
    id: 'map', title: '地図', routes: ['map'], tab: { label: '地図', icon: 'map', order: 40 },
    render(root) {
      // #main is reused by router: isConnected alone cannot identify the current render.
      let active = true, map = null, markers = null, loading = false, saving = false, tileFailed = false, tileTimer = null;
      root.innerHTML = '<div class="map-page">' + ui.heading('OUR TRAVEL FOOTPRINTS', '旅の地図')
        + '<p>これから出会う場所も、出会えた場所も。いっしょに旅の足跡を残そう。</p>'
        + '<p class="caption" id="map-network"></p><p id="map-save-status" role="status" aria-live="polite"></p>'
        + '<div class="map-legend"><span>○ 予定の場所</span><span>✓ 行った場所</span></div>'
        + '<div id="map-lists"></div><section class="map-optional" aria-label="オンライン地図">'
        + '<button id="load-map" class="wide">オンライン地図を開く</button>'
        + '<p id="map-status" class="caption" role="status">地図画像と地図アプリは回線が必要だよ。一覧と足跡は、この端末で見返せるよ。</p>'
        + '<div id="map" class="map-panel" hidden aria-label="予定と足跡の地図"></div></section>'
        + '<button class="text-btn wide" data-route="plan">旅のしおりに戻る →</button></div>';
      const $ = (selector) => root.querySelector(selector);
      const status = $('#map-status'), saveStatus = $('#map-save-status'), button = $('#load-map'), panel = $('#map');
      const network = () => {
        if (!active) return;
        $('#map-network').textContent = U.isOnline() ? '行った場所は「今日、行ったよ」で残せるよ。' : 'いまはオフライン。一覧を見たり、足跡を残したりできるよ。地図アプリは回線が戻ってからね。';
      };
      const drawMarkers = (fit) => {
        if (!map) return;
        markers.clearLayers();
        const group = places(), points = [];
        [...group.planned, ...group.visits].forEach((s) => {
          if (!coordinates(s)) return;
          const point = [s.lat, s.lng]; points.push(point);
          const popup = document.createElement('div');
          popup.innerHTML = '<strong>' + esc(s.name) + '</strong><p>' + (s.visit ? '✓ 行った場所' : '○ 予定の場所') + '</p>' + links(s);
          window.L.marker(point, { title: s.name + (s.visit ? '（行った場所）' : '（予定）'), icon: window.L.divIcon({
            className: 'map-marker ' + (s.visit ? 'map-marker-visited' : 'map-marker-planned'), html: '<span>' + (s.visit ? '✓' : '○') + '</span>', iconSize: [44, 44], iconAnchor: [22, 22],
          }) }).addTo(markers).bindPopup(popup);
        });
        if (fit) {
          if (points.length) map.fitBounds(points, { padding: [28, 28], maxZoom: 14 });
          else map.setView([20, 75], 3);
        }
      };
      const refresh = () => {
        if (!active) return;
        const group = places();
        $('#map-lists').innerHTML = '<section aria-labelledby="map-planned-title"><h2 id="map-planned-title">これからの場所 <small>' + group.planned.length + 'か所</small></h2>'
          + (group.planned.map(card).join('') || '<p class="empty">これからの場所はまだないよ。しおりで場所つきの予定を選ぶと、ここにも並ぶよ。</p>')
          + '</section><section aria-labelledby="map-visited-title"><h2 id="map-visited-title">行った場所 <small>' + group.visits.length + '件</small></h2>'
          + (group.visits.map(card).join('') || '<p class="empty">足跡はこれから。出会えた場所を、一緒に増やしていこう。</p>') + '</section>';
        drawMarkers(false);
      };
      async function loadMap() {
        if (!active || loading) return;
        if (!U.isOnline()) { status.textContent = 'いまはオフライン。回線が戻ったら、また開いてみてね。一覧はこのまま使えるよ。'; return; }
        clearTimeout(tileTimer);
        loading = true; button.disabled = true; status.textContent = '地図を開いているよ…';
        try {
          const L = await ensureLeaflet();
          if (!active) return;
          if (map) map.remove();
          panel.hidden = false; panel.innerHTML = ''; tileFailed = false;
          map = L.map(panel, { scrollWheelZoom: false });
          markers = L.layerGroup().addTo(map);
          const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' });
          clearTimeout(tileTimer);
          tileTimer = setTimeout(() => { if (active) status.textContent = '地図画像を待っているよ。先に一覧を使っていてね。'; }, 10000);
          tiles.on('tileerror', () => { if (active) { tileFailed = true; clearTimeout(tileTimer); status.textContent = '地図画像を読み込めなかったよ。一覧は使えるからね。回線が戻ったら再読み込みしてみてね。'; } });
          tiles.on('load', () => { clearTimeout(tileTimer); if (active && !tileFailed) status.textContent = '○ は予定、✓ は行った場所。ピンから地図アプリも開けるよ。'; });
          tiles.addTo(map); drawMarkers(true); map.invalidateSize();
          button.textContent = '地図を再読み込み';
        } catch (err) {
          clearTimeout(tileTimer);
          if (active) {
            if (map) { map.remove(); map = null; markers = null; }
            panel.hidden = true;
            status.textContent = '地図を開けなかったよ。一覧はそのまま使えるよ。回線が戻ったら、もう一度試してね。';
            button.textContent = '地図をもう一度開く';
          }
        } finally { loading = false; if (active) button.disabled = false; }
      }
      async function onClick(event) {
        const b = event.target.closest('button');
        if (!b || !active) return;
        if (b.id === 'load-map') return loadMap();
        const spotId = b.dataset.mapVisit, visitId = b.dataset.mapUndo;
        if ((!spotId && !visitId) || saving) return;
        const undoSpotId = visitId && (store.get('visits', visitId) || {}).spotId;
        saving = true; b.disabled = true; saveStatus.textContent = '足跡を保存しているよ…';
        try {
          if (spotId) {
            const s = data.spot(spotId);
            if (!s || store.all('visits').some((v) => v.spotId === spotId)) return;
            const visit = await store.put('visits', T.model.make('visits', { id: U.uid(), date: U.todayISO(), at: U.iso(), spotId, title: s.name,
              lat: coordinates(s) ? s.lat : null, lng: coordinates(s) ? s.lng : null }));
            T.bus.emit('visit:added', { visit });
          } else if (store.get('visits', visitId)) await store.remove('visits', visitId);
          if (active) {
            refresh(); saveStatus.textContent = spotId ? '足跡を残したよ。思い出がひとつ増えたね。' : 'この足跡を取り消したよ。';
            // Keep keyboard/VoiceOver focus near the changed place after replacing its card.
            const buttons = root.querySelectorAll('[data-map-visit], [data-map-undo]');
            const target = [...buttons].find((el) => spotId ? (store.get('visits', el.dataset.mapUndo) || {}).spotId === spotId : el.dataset.mapVisit === undoSpotId);
            if (target) target.focus({ preventScroll: true });
          }
        } catch (err) {
          if (active) saveStatus.textContent = '足跡の変更を保存できなかったよ。空き容量を確認して、もう一度試してね。';
        } finally { saving = false; if (active) b.disabled = false; }
      }
      refresh(); network(); root.addEventListener('click', onClick);
      const off = [T.bus.on('app:online', network), T.bus.on('app:offline', network), T.bus.on('store:changed', (d) => {
        if (!saving && ['days', 'spots', 'visits', '*'].includes(d.coll)) refresh();
      })];
      return () => { active = false; root.removeEventListener('click', onClick); off.forEach((fn) => fn()); clearTimeout(tileTimer); if (map) map.remove(); };
    },
  });
})();
