/* map — F11。足跡は手動で visits に保存。地図は明示操作時だけ読み込む。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store, data = T.data;
  let leafletPromise = null, googlePromise = null;
  async function ensureGoogle(key) {
    if (window.google?.maps?.Map) return window.google.maps;
    if (!googlePromise) googlePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('Google timeout')); }, 12000);
      window.tabinokoMapsReady = () => { clearTimeout(timer); resolve(window.google.maps); };
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&loading=async&callback=tabinokoMapsReady';
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Google unavailable')); };
      document.head.appendChild(script);
    }).catch(err => { googlePromise = null; throw err; });
    return googlePromise;
  }
  // 同じ場所は最初の登場順で一つの番号。訪問の追加・取消では番号を変えない。
  function numberPlaces(days, lookup) {
    const rows = new Map();
    days.forEach(d => (d.items || []).forEach(item => {
      const s = item.spotId && lookup(item.spotId);
      if (!s || s.hidden) return;
      if (!rows.has(item.spotId)) rows.set(item.spotId, { ...s, id: item.spotId, number: rows.size + 1, dates: [] });
      if (!rows.get(item.spotId).dates.includes(d.date)) rows.get(item.spotId).dates.push(d.date);
    }));
    return [...rows.values()];
  }
  T.map = { numberPlaces };
  const coordinates = (s) => !!s && Number.isFinite(s.lat) && Number.isFinite(s.lng) && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180;

  function places() {
    const planned = numberPlaces(data.days(), id => data.spot(id));
    const visits = store.all('visits').sort((a, b) => String(b.at).localeCompare(String(a.at))).map((v) => {
      const s = data.spot(v.spotId) || {};
      return { ...s, ...v, name: v.title || s.name || '旅の足跡', ...(coordinates(v) ? {} : { lat: s.lat, lng: s.lng }), visit: true, number: planned.find(p => p.id === v.spotId)?.number };
    });
    return { planned: planned.map(s => ({...s, visitedToday:visits.some(v => v.spotId === s.id && v.date === U.todayISO())})), visits };
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
    return '<details id="map-card-' + (s.visit ? 'visit-' : '') + esc(s.id) + '" class="map-spot ' + (s.visit ? 'map-visited' : 'map-planned') + '"><summary><span class="map-number">' + (s.number || '・') + '</span><span class="map-badge">' + (s.visit ? '訪問を記録済み' : '予定') + '</span>'
      + '<h3>' + esc(s.name) + '</h3></summary><p class="map-date">' + dates + '</p>'
      + (s.note ? '<p class="map-note">' + esc(s.note) + '</p>' : '')
      + '<p class="caption">' + (coordinates(s) ? s.lat.toFixed(4) + ', ' + s.lng.toFixed(4) : '位置はまだ未設定。地図アプリで名前から探せるよ。') + '</p>'
      + links(s) + (coordinates(s) ? '<button data-map-focus="' + esc(s.visit ? 'visit:' + s.id : s.id) + '">地図の' + (s.number || '') + '番へ</button>' : '') + (s.visit ? '<button data-map-undo="' + esc(s.id) + '" aria-label="' + esc(s.name + 'の足跡を取り消す') + '">足跡を取り消す</button>'
        : s.visitedToday ? '<button disabled>今日の訪問を記録済み</button>' : '<button data-map-visit="' + esc(s.id) + '" aria-label="' + esc(s.name + 'に今日行ったと記録する') + '">この場所への訪問を記録</button>') + '</details>';
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
      let active = true, map = null, markers = null, loading = false, saving = false, tileFailed = false, tileTimer = null, engine = 'leaflet', googleMarkers = [];
      root.innerHTML = '<div class="map-page"><section class="map-optional" aria-label="旅程の地図">'
        + '<div id="map" class="map-panel" hidden aria-label="番号つきの旅程地図"></div>'
        + '<button id="load-map" class="wide">番号つき地図を開く</button>'
        + '<p id="map-status" class="caption" role="status">同梱の地図で番号を表示できます。地図画像を読むと提供元へ表示範囲が送られます。Google 設定時は、このボタンで Google へ通信します。現在地は取得しません。</p></section>'
        + ui.heading('OUR TRAVEL FOOTPRINTS', '旅の地図')
        + '<p>番号はしおりに登場する順。同じ場所は、同じ番号。</p>'
        + '<p class="caption" id="map-network"></p><p id="map-save-status" role="status" aria-live="polite"></p>'
        + '<div id="map-lists"></div><button class="text-btn wide" data-route="plan">旅のしおりに戻る →</button></div>';
      const $ = (selector) => root.querySelector(selector);
      const status = $('#map-status'), saveStatus = $('#map-save-status'), button = $('#load-map'), panel = $('#map');
      const network = () => {
        if (!active) return;
        $('#map-network').textContent = U.isOnline() ? '行った場所は「今日、行ったよ」で残せるよ。' : 'いまはオフライン。一覧を見たり、足跡を残したりできるよ。地図アプリは回線が戻ってからね。';
      };
      const drawMarkers = (fit) => {
        if (!map) return;
        if (engine === 'leaflet') markers.clearLayers();
        googleMarkers.forEach(m => m.setMap(null)); googleMarkers = [];
        const group = places(), points = [];
        [...group.planned.map(s => ({ ...s, visit: group.visits.some(v => v.spotId === s.id) })), ...group.visits.filter(v => !group.planned.some(s => s.id === v.spotId))].forEach((s) => {
          if (!coordinates(s)) return;
          const point = [s.lat, s.lng]; points.push(point);
          const popup = document.createElement('div');
          popup.innerHTML = '<strong>' + esc(s.name) + '</strong><p>' + (s.visit ? '訪問を記録済み' : '予定') + '</p>' + links(s);
          const show = () => {
            const detail = document.getElementById('map-card-' + (s.number ? s.id : 'visit-' + s.id));
            if (!detail) return;
            detail.open = true; detail.classList.add('map-highlight'); detail.scrollIntoView({ block: 'center', behavior: 'auto' });
            detail.querySelector('summary').focus({ preventScroll: true });
            setTimeout(() => detail.classList.remove('map-highlight'), 1800);
          };
          if (engine === 'google') {
            const m = new window.google.maps.Marker({ map, position: { lat:s.lat, lng:s.lng }, label: {text:String(s.number || '・'),color:'#176F70',fontSize:'16px',fontWeight:'700'}, icon: {path:'M 0,-22 C 30,-22 30,22 0,22 C -30,22 -30,-22 0,-22 Z',fillColor:'#FFFCF5',fillOpacity:1,strokeColor:'#176F70',strokeWeight:2,scale:1}, title:s.name });
            m.addListener('click', show); googleMarkers.push(m); return;
          }
          window.L.marker(point, { title: s.name + (s.visit ? '（行った場所）' : '（予定）'), icon: window.L.divIcon({
            className: 'map-marker ' + (s.visit ? 'map-marker-visited' : 'map-marker-planned'), html: '<span>' + (s.number || '・') + '</span>', iconSize: [44, 44], iconAnchor: [22, 22],
          }) }).addTo(markers).bindPopup(popup).on('click', show);
        });
        if (fit) {
          if (engine === 'google') { const bounds = new window.google.maps.LatLngBounds(); points.forEach(p => bounds.extend({lat:p[0], lng:p[1]})); if (points.length) map.fitBounds(bounds); return; }
          if (points.length) map.fitBounds(points, { padding: [28, 28], maxZoom: 14 });
          else map.setView([20, 75], 3);
        }
      };
      const refresh = () => {
        if (!active) return;
        const group = places();
        $('#map-lists').innerHTML = '<section aria-labelledby="map-planned-title"><h2 id="map-planned-title">しおりの場所 <small>' + group.planned.length + 'か所</small></h2>'
          + (group.planned.map(card).join('') || '<p class="empty">これからの場所はまだないよ。しおりで場所つきの予定を選ぶと、ここにも並ぶよ。</p>')
          + '</section><section aria-labelledby="map-visited-title"><h2 id="map-visited-title">行った場所 <small>' + group.visits.length + '件</small></h2>'
          + (group.visits.map(card).join('') || '<p class="empty">訪問記録 0件。場所を開いて訪問を記録。</p>') + '</section>';
        drawMarkers(false);
      };
      async function loadMap() {
        if (!active || loading) return;

        clearTimeout(tileTimer);
        loading = true; button.disabled = true; status.textContent = '地図を開いているよ…';
        try {
          let config = {};
          try { const response = await fetch('config/maps.json'); if (response.ok) config = await response.json(); } catch (_) { /* オフラインでは同梱地図 */ }
          if (!active) return;
          if (config.googleMapsApiKey && U.isOnline()) {
            try {
              const G = await ensureGoogle(config.googleMapsApiKey);
              if (!active) return;
              if (map?.remove) map.remove();
              googleMarkers.forEach(m => m.setMap(null));
              panel.hidden = false; panel.innerHTML = ''; engine = 'google';
              map = new G.Map(panel, { center: {lat:20,lng:75}, zoom:3, mapTypeControl:false, streetViewControl:false });
              drawMarkers(true); status.textContent = 'Google マップ：番号ピンから詳細を開けます。'; button.textContent = '地図を再読み込み'; return;
            } catch (_) { if (!active) return; /* 同梱版で番号を残す */ }
          }
          const L = await ensureLeaflet();
          if (!active) return;
          if (map?.remove) map.remove();
          panel.hidden = false; panel.innerHTML = ''; tileFailed = false;
          googleMarkers.forEach(m => m.setMap(null)); googleMarkers = []; engine = 'leaflet';
          map = L.map(panel, { scrollWheelZoom: false });
          markers = L.layerGroup().addTo(map);
          const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' });
          clearTimeout(tileTimer);
          tileTimer = setTimeout(() => { if (active) status.textContent = '地図画像を待っているよ。先に一覧を使っていてね。'; }, 10000);
          tiles.on('tileerror', () => { if (active) { tileFailed = true; clearTimeout(tileTimer); status.textContent = '地図画像を読み込めなかったよ。一覧は使えるからね。回線が戻ったら再読み込みしてみてね。'; } });
          tiles.on('load', () => { clearTimeout(tileTimer); if (active && !tileFailed) status.textContent = '番号はしおり順。ピンから下の詳細へ移動できます。'; });
          if (U.isOnline()) tiles.addTo(map); else { clearTimeout(tileTimer); status.textContent = 'オフライン：背景画像なしで番号ピンを表示しています。'; }
          drawMarkers(true); map.invalidateSize();
          button.textContent = '地図を再読み込み';
        } catch (err) {
          clearTimeout(tileTimer);
          if (active) {
            if (map) { if (map.remove) map.remove(); googleMarkers.forEach(m => m.setMap(null)); googleMarkers = []; map = null; markers = null; }
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
        if (b.dataset.mapFocus) {
          const focus = b.dataset.mapFocus;
          const s = focus.startsWith('visit:') ? places().visits.find(v => v.id === focus.slice(6)) : data.spot(focus);
          if (!coordinates(s)) return;
          if (!map) await loadMap();
          if (!active || !map) return;
          if (engine === 'google') { map.panTo({lat:s.lat,lng:s.lng}); map.setZoom(14); } else map.setView([s.lat,s.lng],14);
          panel.scrollIntoView({ block:'center' }); button.focus({preventScroll:true}); return;
        }
        const spotId = b.dataset.mapVisit, visitId = b.dataset.mapUndo;
        if ((!spotId && !visitId) || saving) return;
        const undoSpotId = visitId && (store.get('visits', visitId) || {}).spotId;
        saving = true; b.disabled = true; saveStatus.textContent = '足跡を保存しているよ…';
        try {
          if (spotId) {
            const s = data.spot(spotId);
            if (!s || store.all('visits').some((v) => v.spotId === spotId && v.date === U.todayISO())) return;
            const visit = await T.feedback.run(() => store.put('visits', T.model.make('visits', { id: U.uid(), date: U.todayISO(), at: U.iso(), spotId, title: s.name,
              lat: coordinates(s) ? s.lat : null, lng: coordinates(s) ? s.lng : null })));
            T.bus.emit('visit:added', { visit });
          } else if (store.get('visits', visitId)) await T.feedback.run(() => store.remove('visits', visitId));
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
      return () => { active = false; root.removeEventListener('click', onClick); off.forEach((fn) => fn()); clearTimeout(tileTimer); googleMarkers.forEach(m => m.setMap(null)); if (map?.remove) map.remove(); };
    },
  });
})();
