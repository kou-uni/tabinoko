/* map — F11。足跡は手動で visits に保存。地図は明示操作時だけ読み込む。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store, data = T.data;
  let leafletPromise = null, googlePromise = null, librePromise = null;
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
    days.forEach((d, dayIndex) => (d.items || []).forEach(item => {
      const s = item.spotId && lookup(item.spotId);
      if (!s || s.hidden) return;
      if (!rows.has(item.spotId)) rows.set(item.spotId, { ...s, id: item.spotId, number: rows.size + 1, dayIndex, dates: [] });
      if (!rows.get(item.spotId).dates.includes(d.date)) rows.get(item.spotId).dates.push(d.date);
    }));
    return [...rows.values()];
  }
  function selectStyle(config, theme, systemDark = false) {
    const dark = theme === 'dark' || (theme === 'auto' && systemDark);
    return dark ? config.styleDark || 'https://tiles.openfreemap.org/styles/positron'
      : config.styleLight || 'https://tiles.openfreemap.org/styles/bright';
  }
  function selectProvider(config, webgl) {
    if ((config.provider === 'google' || !config.provider) && config.googleMapsApiKey) return 'google';
    return webgl ? 'openfreemap' : 'leaflet';
  }
  // 投影済みの画面座標を使い、近接関係がつながる地点をまとめる（DOM 非依存）。
  function clusterPlaces(rows, project, distance = 48) {
    const points = rows.map(project), seen = new Set(), groups = [];
    rows.forEach((_, start) => {
      if (seen.has(start)) return;
      const indices = [start]; seen.add(start);
      for (let k = 0; k < indices.length; k++) {
        const a = points[indices[k]];
        points.forEach((b, i) => {
          if (!seen.has(i) && Math.hypot(a.x - b.x, a.y - b.y) < distance) {
            seen.add(i); indices.push(i);
          }
        });
      }
      groups.push(indices.map(i => rows[i]));
    });
    return groups;
  }
  function filterPlaces(group, date) {
    return { planned: group.planned.filter(s => !date || s.dates.includes(date)),
      visits: group.visits.filter(s => !date || s.date === date) };
  }
  T.map = { numberPlaces, selectStyle, selectProvider, clusterPlaces, filterPlaces };
  const dayColors = ['#176f70', '#954318', '#6551a2', '#25659c', '#9b345a', '#436b25'];
  const dayColor = s => dayColors[(s.dayIndex || 0) % dayColors.length];
  function ensureLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (!librePromise) {
      U.loadCSS('vendor/maplibre/maplibre-gl.css');
      librePromise = U.loadScript('vendor/maplibre/maplibre-gl.js').then(() => {
        if (!window.maplibregl) throw new Error('MapLibre unavailable');
        return window.maplibregl;
      }).catch(err => { librePromise = null; throw err; });
    }
    return librePromise;
  }
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
    return '<details id="map-card-' + (s.visit ? 'visit-' : '') + esc(s.id) + '" class="map-spot ' + (s.visit ? 'map-visited' : 'map-planned') + '"><summary><span class="map-number" style="--map-day-color:' + dayColor(s) + '">' + (s.number || '・') + '</span><span class="map-badge">' + (s.visit ? '訪問を記録済み' : '予定') + '</span>'
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
      let active = true, map = null, markers = null, loading = false, saving = false, tileFailed = false, tileTimer = null, engine = 'leaflet', googleMarkers = [], libreMarkers = [], config = {}, currentStyle = '';
      let selectedDate = '', stopMovement = () => {};
      const visiblePlaces = () => filterPlaces(places(), selectedDate);
      const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      const reduced = () => store.setting('uiMotion') === false || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const styleURL = () => selectStyle(config, store.setting('uiTheme') || 'light', themeMedia.matches);
      const darkTheme = () => store.setting('uiTheme') === 'dark' || (store.setting('uiTheme') === 'auto' && themeMedia.matches);
      root.innerHTML = '<div class="map-page"><section class="map-optional" aria-label="旅程の地図">'
        + '<div id="map-days" class="map-days" role="group" aria-label="日付で地図と一覧を絞る"></div>'
        + '<div id="map" class="map-panel" hidden aria-label="番号つきの旅程地図"></div>'
        + '<button id="load-map" class="wide">番号つき地図を開く</button>'
        + '<p id="map-status" class="caption" role="status">開くと OpenFreeMap へ地図の表示範囲が送られます。地図の移動は2本指、ページのスクロールは1本指です。Google 設定時は、このボタンで Google へ通信します。現在地は取得しません。</p></section>'
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
      const fitPoints = (points, maxZoom = 14) => {
        if (!points.length) return;
        if (engine === 'google') {
          const bounds = new window.google.maps.LatLngBounds();
          points.forEach(p => bounds.extend({ lat: p[0], lng: p[1] })); map.fitBounds(bounds, 48);
        } else if (engine === 'openfreemap') {
          const bounds = new window.maplibregl.LngLatBounds();
          points.forEach(p => bounds.extend([p[1], p[0]]));
          map.fitBounds(bounds, { padding: 48, maxZoom, duration: 0 });
        } else map.fitBounds(points, { padding: [48, 48], maxZoom, animate: false });
      };
      const watchMovement = () => {
        const instance = map, redraw = () => { if (active && map === instance) drawMarkers(false); };
        if (engine === 'google') {
          const listener = map.addListener?.('idle', redraw);
          stopMovement = () => listener?.remove();
        } else {
          // moveend はズーム終了も含む。移動中には再計算しない。
          map.on?.('moveend', redraw);
          stopMovement = () => instance.off?.('moveend', redraw);
        }
      };
      const drawMarkers = (fit) => {
        if (!map) return;
        const group = visiblePlaces();
        const rows = [...group.planned.map(s => ({ ...s, visit: group.visits.some(v => v.spotId === s.id) })),
          ...group.visits.filter(v => !group.planned.some(s => s.id === v.spotId)).map(v => ({ ...v, visitCard: true }))].filter(coordinates);
        if (fit) fitPoints(rows.map(s => [s.lat, s.lng]));
        if (engine === 'leaflet') markers.clearLayers();
        googleMarkers.forEach(m => m.setMap(null)); googleMarkers = [];
        libreMarkers.forEach(m => m.remove()); libreMarkers = [];
        const project = s => {
          if (engine === 'openfreemap') return map.project([s.lng, s.lat]);
          if (engine === 'leaflet') return map.latLngToContainerPoint([s.lat, s.lng]);
          const p = map.getProjection().fromLatLngToPoint(new window.google.maps.LatLng(s.lat, s.lng));
          const scale = 2 ** map.getZoom(); return { x: p.x * scale, y: p.y * scale };
        };
        const ready = engine === 'google' ? map.getProjection?.() : engine === 'openfreemap' ? map.project : map.latLngToContainerPoint;
        const clusters = ready ? clusterPlaces(rows, project) : rows.map(s => [s]);
        clusters.forEach(members => {
          const clustered = members.length > 1;
          const s = clustered ? { name: members.length + '件の場所を拡大',
            lat: members.reduce((n, p) => n + p.lat, 0) / members.length,
            lng: members.reduce((n, p) => n + p.lng, 0) / members.length } : members[0];
          const label = clustered ? members.length + '件' : String(s.number || '・');
          const point = [s.lat, s.lng];
          const popup = document.createElement('div');
          popup.innerHTML = '<strong>' + esc(s.name) + '</strong><p>' + (s.visit ? '訪問を記録済み' : '予定') + '</p>' + links(s);
          const show = () => {
            if (clustered) { fitPoints(members.map(p => [p.lat, p.lng]), 19); return; }
            const detail = document.getElementById('map-card-' + (s.visitCard ? 'visit-' + s.id : s.id));
            if (!detail) return;
            detail.open = true; detail.classList.add('map-highlight'); detail.scrollIntoView({ block: 'center', behavior: 'auto' });
            detail.querySelector('summary').focus({ preventScroll: true });
            setTimeout(() => detail.classList.remove('map-highlight'), 1800);
          };
          if (engine === 'google') {
            const m = new window.google.maps.Marker({ map, position: { lat:s.lat, lng:s.lng }, label: {text:label,color:dayColor(s),fontSize:'16px',fontWeight:'700'}, icon: {path:'M 0,-22 C 30,-22 30,22 0,22 C -30,22 -30,-22 0,-22 Z',fillColor:'#FFFCF5',fillOpacity:1,strokeColor:dayColor(s),strokeWeight:2,scale:1}, title:s.name });
            m.addListener('click', show); googleMarkers.push(m); return;
          }
          if (engine === 'openfreemap') {
            const element = document.createElement('button');
            element.type = 'button'; element.className = 'map-marker map-libre-marker' + (clustered ? ' map-cluster' : '');
            element.style.setProperty('--map-day-color', dayColor(s));
            element.setAttribute('aria-label', clustered ? s.name : (s.number || '・') + '番 ' + s.name);
            element.innerHTML = '<span>' + label + '</span>';
            element.addEventListener('click', show);
            libreMarkers.push(new window.maplibregl.Marker({ element }).setLngLat([s.lng, s.lat]).addTo(map));
            return;
          }
          const marker = window.L.marker(point, { title: s.name + (s.visit ? '（行った場所）' : '（予定）'), icon: window.L.divIcon({
            className: 'map-marker ' + (clustered ? 'map-cluster ' : '') + (s.visit ? 'map-marker-visited' : 'map-marker-planned'), html: '<span style="--map-day-color:' + dayColor(s) + '">' + label + '</span>', iconSize: [44, 44], iconAnchor: [22, 22],
          }) }).addTo(markers).on('click', show);
          if (!clustered) marker.bindPopup(popup);
        });
      };
      const refresh = () => {
        if (!active) return;
        const all = places();
        const dates = [...new Set([...data.days().map(d => d.date), ...all.visits.map(v => v.date)])].sort();
        if (selectedDate && !dates.includes(selectedDate)) selectedDate = '';
        const chips = $('#map-days'), scroll = chips.scrollLeft || 0;
        chips.innerHTML = ['', ...dates].map(date => '<button type="button" data-map-date="' + esc(date)
          + '" aria-pressed="' + (date === selectedDate) + '">' + (date ? esc(U.dayLabel(date)) : 'すべて') + '</button>').join('');
        chips.scrollLeft = scroll;
        const group = visiblePlaces();
        $('#map-lists').innerHTML = '<section aria-labelledby="map-planned-title"><h2 id="map-planned-title">しおりの場所 <small>' + group.planned.length + 'か所</small></h2>'
          + (group.planned.map(card).join('') || '<p class="empty">これからの場所はまだないよ。しおりで場所つきの予定を選ぶと、ここにも並ぶよ。</p>')
          + '</section><section aria-labelledby="map-visited-title"><h2 id="map-visited-title">行った場所 <small>' + group.visits.length + '件</small></h2>'
          + (group.visits.map(card).join('') || '<p class="empty">訪問記録 0件。場所を開いて訪問を記録。</p>') + '</section>';
        drawMarkers(false);
      };
      function destroyMap() {
        clearTimeout(tileTimer);
        stopMovement(); stopMovement = () => {};
        libreMarkers.forEach(m => m.remove()); libreMarkers = [];
        googleMarkers.forEach(m => m.setMap(null)); googleMarkers = [];
        if (map?.remove) map.remove();
        map = null; markers = null;
      }
      function syncTheme() {
        if (!active || engine !== 'openfreemap' || !map) return;
        panel.classList.toggle('map-night', darkTheme());
        const next = styleURL();
        if (next !== currentStyle) {
          currentStyle = next;
          status.textContent = '地図のテーマを切り替えているよ…';
          try { map.setStyle(next); } catch (_) { status.textContent = 'テーマを取得できません。再読み込みしてね。'; }
        }
      }
      async function loadMap() {
        if (!active || loading) return;

        clearTimeout(tileTimer);
        loading = true; button.disabled = true; status.textContent = '地図を開いているよ…';
        try {
          config = {};
          try { const response = await fetch('config/maps.json'); if (response.ok) config = await response.json(); } catch (_) { /* オフラインでは同梱地図 */ }
          if (!active) return;
          if (selectProvider(config, true) === 'google' && U.isOnline()) {
            try {
              const G = await ensureGoogle(config.googleMapsApiKey);
              if (!active) return;
              destroyMap();
              panel.hidden = false; panel.innerHTML = ''; engine = 'google';
              map = new G.Map(panel, { center: {lat:20,lng:75}, zoom:3, mapTypeControl:false, streetViewControl:false, gestureHandling:'cooperative' });
              watchMovement(); drawMarkers(true); status.textContent = 'Google マップ：番号ピンから詳細を開けます。'; button.textContent = '地図を再読み込み'; return;
            } catch (_) { if (!active) return; /* 同梱版で番号を残す */ }
          }
          let canWebGL = false;
          if (window.WebGLRenderingContext || window.WebGL2RenderingContext) {
            try {
              const canvas = document.createElement('canvas');
              const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
              canWebGL = !!gl;
              gl?.getExtension('WEBGL_lose_context')?.loseContext();
            } catch (_) { /* GPU が無効な端末は簡易地図 */ }
          }
          const M = canWebGL ? await ensureLibre() : null;
          if (!active) return;
          if (selectProvider({}, !!M) === 'openfreemap') {
            if (!U.isOnline()) throw new Error('offline');
            destroyMap(); panel.hidden = false; panel.innerHTML = ''; engine = 'openfreemap';
            currentStyle = styleURL(); panel.classList.toggle('map-night', darkTheme());
            map = new M.Map({ container: panel, style: currentStyle, center: [75, 20], zoom: 3,
              cooperativeGestures: true, attributionControl: false });
            map.addControl(new M.NavigationControl({ showCompass: false }), 'top-left');
            map.addControl(new M.AttributionControl({ compact: true }), 'bottom-right');
            watchMovement();
            const instance = map;
            const failed = () => {
              if (!active || map !== instance) return;
              clearTimeout(tileTimer);
              status.textContent = U.isOnline() ? '地図スタイル・画像を取得できません。一覧を使うか再読み込みしてね。' : 'オフラインです。一覧はそのまま使えます。';
            };
            map.on('error', failed);
            map.on('style.load', () => {
              if (!active || map !== instance) return;
              clearTimeout(tileTimer);
              status.textContent = '番号はしおり順、色は日ごと。件数の丸を押すと拡大できます。地図の移動は2本指。';
            });
            tileTimer = setTimeout(failed, 12000);
            drawMarkers(true); button.textContent = '地図を再読み込み'; return;
          }
          const L = await ensureLeaflet();
          if (!active) return;
          destroyMap();
          panel.hidden = false; panel.innerHTML = ''; tileFailed = false;
          googleMarkers.forEach(m => m.setMap(null)); googleMarkers = []; engine = 'leaflet';
          panel.classList?.remove('map-night');
          map = L.map(panel, { center: [20, 75], zoom: 3, scrollWheelZoom: false, dragging: !L.Browser?.touch, touchZoom: true });
          markers = L.layerGroup().addTo(map);
          const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' });
          clearTimeout(tileTimer);
          tileTimer = setTimeout(() => { if (active) status.textContent = '地図画像を待っているよ。先に一覧を使っていてね。'; }, 10000);
          tiles.on('tileerror', () => { if (active) { tileFailed = true; clearTimeout(tileTimer); status.textContent = '地図画像を読み込めなかったよ。一覧は使えるからね。回線が戻ったら再読み込みしてみてね。'; } });
          tiles.on('load', () => { clearTimeout(tileTimer); if (active && !tileFailed) status.textContent = 'WebGL 非対応のため簡易地図です。番号ピンから詳細へ移動できます。'; });
          if (U.isOnline()) tiles.addTo(map); else { clearTimeout(tileTimer); status.textContent = 'オフライン：背景画像なしで番号ピンを表示しています。'; }
          watchMovement(); drawMarkers(true); map.invalidateSize();
          button.textContent = '地図を再読み込み';
        } catch (err) {
          clearTimeout(tileTimer);
          if (active) {
            destroyMap();
            panel.hidden = true;
            status.textContent = U.isOnline() ? '地図を開けなかったよ。一覧はそのまま使えます。再読み込みしてね。' : 'オフラインです。一覧はそのまま使えます。';
            button.textContent = '地図をもう一度開く';
          }
        } finally { loading = false; if (active) button.disabled = false; }
      }
      async function onClick(event) {
        const b = event.target.closest('button');
        if (!b || !active) return;
        if (b.id === 'load-map') return loadMap();
        if (b.dataset.mapDate !== undefined) {
          selectedDate = b.dataset.mapDate;
          refresh(); drawMarkers(true);
          const chip = [...root.querySelectorAll('[data-map-date]')].find(el => el.dataset.mapDate === selectedDate);
          chip?.focus({ preventScroll: true });
          return;
        }
        if (b.dataset.mapFocus) {
          const focus = b.dataset.mapFocus;
          const s = focus.startsWith('visit:') ? places().visits.find(v => v.id === focus.slice(6)) : data.spot(focus);
          if (!coordinates(s)) return;
          if (!map) await loadMap();
          if (!active || !map) return;
          if (engine === 'openfreemap') { map.flyTo({ center: [s.lng, s.lat], zoom: 17, animate: !reduced() }); } else if (engine === 'google') { map.panTo({lat:s.lat,lng:s.lng}); map.setZoom(14); } else map.setView([s.lat,s.lng],17, { animate: !reduced() });
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
      themeMedia.addEventListener?.('change', syncTheme);
      const off = [T.bus.on('app:online', network), T.bus.on('app:offline', network), T.bus.on('store:changed', (d) => {
        syncTheme();
        if (!saving && ['days', 'spots', 'visits', '*'].includes(d.coll)) refresh();
      })];
      return () => { active = false; root.removeEventListener('click', onClick); off.forEach((fn) => fn()); themeMedia.removeEventListener?.('change', syncTheme); destroyMap(); };
    },
  });
})();
