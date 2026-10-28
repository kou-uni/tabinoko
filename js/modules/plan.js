/* plan — しおり（予定表）。所有: js/modules/plan.js, css/mod-plan.css, js/data/itinerary.js
 * 担当: F05（日ごとの予定・編集・今日が一目で）, F13（これから/いま/思い出の「いま」）, F17（初期データ）。
 * 日付・予定の保存先を固定し、非同期処理後の画面遷移を保護する。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store, data = T.data, bus = T.bus;
  const $ = (s, r) => (r || document).querySelector(s);
  let selected = null; // 選択中の日付 YYYY-MM-DD

  function skyline() {
    return '<svg class="skyline" viewBox="0 0 620 160" fill="none" aria-hidden="true"><circle cx="481" cy="53" r="34" fill="var(--peach)"/><path d="M0 143Q140 133 274 144T620 143" stroke="var(--green)" stroke-width="1.3"/><g stroke="var(--green)" stroke-width="1.5" stroke-linejoin="round"><path d="M13 138V89h44v49M19 90V77h31v13M25 78V68h18v10M32 68V56M22 105h7m10 0h7m-24 13h7m10 0h7M69 139V108h39v31M78 108V98h20v10M116 139V78h48v61m-38-48h9m9 0h9m-27 12h9m9 0h9m-27 12h9m9 0h9"/><path d="M184 140V72h18v68m-19-68h20l-10-20zM270 140V72h18v68m-19-68h20l-10-20zM201 82h69v58h-18v-28q-16-27-33 0v28h-18M203 82V67h65v15M211 66v-9h49v9m-24-10V40m-14 16q14-28 28 0M207 91h57"/><path d="M307 138V99h37v39m-31-27h7m10 0h7m-24 13h7m10 0h7M355 139V78h44v61m-34-51h8m9 0h8m-25 14h8m9 0h8m-25 14h8m9 0h8M370 78V62h16v16M415 138V112h27v26M451 140V96h31v44m-25-32h7m6 0h7m-20 13h7m6 0h7M507 140q-4-36 4-63m-1 5q-17-21-29-8m29 7q12-25 29-16m-29 15q18-9 31 3m-31-3q-16-9-26 4M552 139V114h48v25m-42-25 18-19 18 19"/><path d="m59 44 7-4 7 4m270-7 7-4 7 4m67-5 7-4 7 4"/></g><path d="M27 153h122m239-1h179" stroke="var(--line)" stroke-dasharray="6 7"/></svg>';
  }

  const kinds = { flight: '飛行機', move: '移動', stay: '宿泊', sight: '観光', event: 'イベント', meal: '食事', free: '自由時間' };
  const notice = '<p class="caption">パスポート・ETA・予約番号は書かないでね。</p>';
  let mounted = null, revision = 0;
  const daysSorted = () => data.days().sort((a, b) => a.date.localeCompare(b.date));
  const route = (name, label, params = {}) => '<button data-route="' + name + '" data-params="' + esc(JSON.stringify(params)) + '">' + label + '</button>';
  function view(root) {
    const version = ++revision, days = daysSorted(), today = U.todayISO();
    if (!selected || !days.some(d => d.date === selected)) selected = (days.find(d => d.date >= today) || days[days.length - 1] || {}).date;
    const d = data.day(selected), now = data.day(today), future = days.find(x => x.date > today);
    const trip = store.doc('trip');
    const nextDay = days.find(x => x.date >= today && x.items.length), item = nextDay && nextDay.items[0];
    const validTrip = T.progress.valid(trip.start) && T.progress.valid(trip.end) && trip.start <= trip.end;
    const phase = !validTrip ? '旅程を確認' : today < trip.start ? '出発まで' + U.daysBetween(today, trip.start) + '日' : today > trip.end ? '旅程終了' : '旅程 ' + (U.daysBetween(trip.start, today) + 1) + '日目';
    root.innerHTML = '<div class="plan-page"><section class="plan-hero"><h1>ムンバイ / ' + esc(phase) + '</h1><p>' + esc(trip.start) + ' — ' + esc(trip.end) + ' · ' + (validTrip ? U.daysBetween(trip.start, trip.end) + 1 : '—') + '日間の旅</p>' + skyline() + '</section>'
      + '<section class="plan-now" aria-label="次の予定"><h2>' + (nextDay && nextDay.date === today ? '今日の先頭の予定' : '次の予定') + '</h2>'
      + (item ? '<p class="state-label">' + esc(U.dayLabel(nextDay.date)) + '</p><p class="' + (/^\d{1,2}:\d{2}$/.test(item.time) ? 'plan-next-time' : 'plan-time') + '">' + esc(item.time || '時刻未設定') + '</p><p class="plan-next-title">' + esc(item.title) + '</p>' : '<p>予定なし</p>')
      + '<small>便の時刻は各空港の現地時刻。予定は保存順。</small><div class="plan-actions"><button class="primary" data-route="notes" data-params="' + esc(JSON.stringify({date:today})) + '">いま残すこと</button></div></section>'
      + T.gameUI.missions(today < trip.start || today > trip.end ? today : selected || today)
      + '<div class="plan-switch" aria-label="旅の表示"><button id="plan-now">今日</button><button id="plan-future" ' + (!future ? 'disabled' : '') + '>これから</button>' + route('timeline', '思い出') + '</div>'
      + '<h2>旅のしおり</h2>'
      + (d ? '<div class="plan-dates" aria-label="旅の日付">' + days.map(x => '<button data-day="' + esc(x.date) + '" aria-pressed="' + (x.date === selected) + '">' + esc(U.dayLabel(x.date)) + (x.date === today ? ' 今日' : '') + '</button>').join('') + '</div>'
      + '<article class="card plan-day"><div class="day-top"><span class="badge">' + esc(d.title) + '</span><button class="text-btn" id="edit-day">この日を編集</button></div><h2>' + esc(d.headline) + '</h2><p class="plan-note">' + esc(d.note) + '</p>'
      + (d.staleSeed && data.seedDay(d.date) ? '<div class="plan-update"><p>この日に新しい確定情報が届いているよ。あなたの編集は残してあるよ。</p><button id="plan-update">新しい予定を確認</button></div>' : '')
      + (d.candidates.length ? '<h3>予備スポットから選ぼう</h3><div class="plan-actions">' + d.candidates.map(id => '<button data-candidate="' + esc(id) + '">＋ ' + esc((data.spot(id) || {}).name || id) + '</button>').join('') + '</div>' : '')
      + (d.items.length ? d.items.map((x, i) => '<div class="plan-stop"><span class="stop-num">' + (i + 1) + '</span><div class="plan-stop-body"><strong>' + esc(x.title) + '</strong>' + (x.time ? '<p class="plan-time">' + esc(x.time) + '</p>' : '') + (x.note ? '<p class="plan-note">' + esc(x.note) + '</p>' : '') + '<small>' + esc(kinds[x.kind] || '') + '</small></div><button class="text-btn" data-edit-item="' + i + '" aria-label="' + esc(x.title) + 'を編集">編集</button></div>').join('') : ui.empty('予定なし。予定を追加。'))
      + '<div class="plan-actions"><button id="add-item">＋ 予定を追加</button><button id="reorder" ' + (d.items.length < 2 ? 'disabled' : '') + '>並べ替え</button></div></article>' : ui.empty('旅程なし。メモは記録できます。'))
      + '<section id="plan-suggestions" hidden></section>'
      + (store.all('hearing').length ? '<details class="card"><summary>聞かせてくれた旅の話</summary><p class="caption">予定を考えるとき、ここから見返せるよ。</p>' + store.all('hearing').sort((a, b) => String(b.at).localeCompare(String(a.at))).map(x => '<p class="plan-note"><small>' + esc(x.date) + '</small><br>' + esc(x.text) + '</p>').join('') + '</details>' : '')
      + (d && d.items.some(x => x.kind === 'event' && /ETHGlobal/.test(x.title)) ? '<div class="card"><p>ファイナリストとして参加する日。挑戦の気持ちも残せるよ。</p>' + route('post', 'ファイナリストとして参加', { angle: 'finalist', date: d.date }) + '</div>' : '')
      + route('fairy', '記録係に話す') + '</div>';
    if (d) bus.request('suggest:today', { date: d.date }).then(list => {
      if (mounted !== root || revision !== version) return;
      const el = $('#plan-suggestions', root);
      if (!el || !Array.isArray(list) || !list.length) return;
      el.innerHTML = '<h3>この日の楽しみの残し方</h3>' + list.slice(0, 3).map(x => '<div class="card"><strong>' + esc(x.when || '') + '</strong><p>' + esc(x.text) + '</p><p class="caption">' + esc(x.reason || '') + '</p>' + route('post', 'この切り口で書く', { angle: x.angle || 'surprise', spot: x.spotId || '', date: d.date }) + '</div>').join('') + route('suggest', '切り口を選び直す', { date: d.date });
      el.hidden = false;
    }).catch(() => {});
  }

  async function saveDay(date, change) {
    const row = await store.patch('days', date, d => Object.assign(d, change, { edited: true }));
    bus.emit('day:changed', { day: row });
    return row;
  }
  // Capture the day and dialog lifetime: delayed saves must never redraw another route.
  function editor(root, title, body) {
    let open = true, busy = false;
    const dlg = ui.dialog({ title, body: '<div class="plan-editor">' + body + '<p class="plan-error" role="alert"></p></div>', onClose: () => { open = false; } });
    const run = async (write, after) => {
      if (busy || !open) return;
      busy = true;
      dlg.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        await write();
        if (mounted !== root || !open) return;
        ui.closeDialog(); view(root);
        if (after) after();
      } catch (err) {
        if (open && mounted === root) $('.plan-error', dlg).textContent = '保存できなかったよ。入力はこのまま。空き容量や保存設定を確かめて、もう一度試してね。';
      } finally {
        busy = false;
        if (open) dlg.querySelectorAll('button').forEach(b => { b.disabled = b.dataset.locked === 'true'; });
      }
    };
    return { dlg, run };
  }
  function editDay(root) {
    const d = data.day(selected);
    const { dlg, run } = editor(root, 'この日の予定', '<form id="day-form"><label for="day-tag">テーマ</label><input id="day-tag" maxlength="40" required value="' + esc(d.title) + '"><label for="day-title">見出し</label><textarea id="day-title" maxlength="300" required>' + esc(d.headline) + '</textarea><label for="day-note">旅程メモ</label><textarea id="day-note" maxlength="3000">' + esc(d.note) + '</textarea>' + notice + '<button class="primary wide">変更を保存</button></form>');
    $('#day-form', dlg).onsubmit = e => {
      e.preventDefault();
      const title = $('#day-tag', dlg).value.trim(), headline = $('#day-title', dlg).value.trim(), note = $('#day-note', dlg).value.trim();
      if (!title || !headline) return ui.toast('テーマと見出しを教えてね。');
      return run(() => saveDay(d.date, { title, headline, note }));
    };
  }
  function editItem(root, index, candidate) {
    const d = data.day(selected), item = index === undefined ? T.model.makeItem({ title: (data.spot(candidate) || {}).name || '', spotId: candidate || null }) : d.items[index];
    if (!item) return;
    const { dlg, run } = editor(root, index === undefined ? '楽しみをひとつ追加' : '予定を編集', '<form id="item-form"><label for="item-title">予定の名前</label><input id="item-title" maxlength="200" required value="' + esc(item.title) + '"><label for="item-time">時刻・ひとこと（任意）</label><input id="item-time" maxlength="100" value="' + esc(item.time) + '"><label for="item-kind">予定の種類</label><select id="item-kind">' + Object.entries(kinds).map(([k, v]) => '<option value="' + k + '"' + (item.kind === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select><label for="item-spot">場所（任意）</label><select id="item-spot"><option value="">場所を指定しない</option>' + data.spots().filter(s => !s.hidden || s.id === item.spotId).map(s => '<option value="' + esc(s.id) + '"' + (s.id === item.spotId ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select><label for="item-note">メモ（任意）</label><textarea id="item-note" maxlength="3000">' + esc(item.note || '') + '</textarea>' + notice + '<button class="primary wide">しおりに保存</button>' + (index !== undefined ? '<label><input class="plan-check" type="checkbox" id="plan-delete-check"> この予定を削除する</label><button type="button" id="delete-item">削除を確定</button>' : '') + '</form>');
    $('#item-form', dlg).onsubmit = e => {
      e.preventDefault();
      const title = $('#item-title', dlg).value.trim();
      if (!title) return ui.toast('予定の名前を教えてね。');
      const it = T.model.makeItem(Object.assign({}, item, { id: item.id || U.uid(), title, time: $('#item-time', dlg).value.trim(), kind: $('#item-kind', dlg).value, spotId: $('#item-spot', dlg).value || null, note: $('#item-note', dlg).value.trim() }));
      return run(() => {
        const items = data.day(d.date).items.slice(), pos = items.findIndex(x => x.id === item.id);
        if (index === undefined) items.push(it); else if (pos >= 0) items[pos] = it; else throw new Error('missing item');
        return saveDay(d.date, { items });
      });
    };
    if (index !== undefined) $('#delete-item', dlg).onclick = () => {
      if (!$('#plan-delete-check', dlg).checked) return ui.toast('削除してよければ、チェックを入れてね。');
      return run(() => saveDay(d.date, { items: data.day(d.date).items.filter(x => x.id !== item.id) }));
    };
  }
  function reorder(root) {
    const d = data.day(selected);
    const { dlg, run } = editor(root, '予定の順番を変える', '<p>上・下を押すと、その場で保存するよ。</p>' + d.items.map((x, i) => '<div class="plan-stop"><div class="plan-stop-body">' + esc(x.title) + '</div>' + [-1, 1].map(dir => '<button data-move="' + i + '" data-dir="' + dir + '" data-locked="' + (i + dir < 0 || i + dir >= d.items.length) + '" ' + (i + dir < 0 || i + dir >= d.items.length ? 'disabled' : '') + ' aria-label="' + esc(x.title) + (dir < 0 ? 'を上へ' : 'を下へ') + '">' + (dir < 0 ? '↑' : '↓') + '</button>').join('') + '</div>').join(''));
    dlg.querySelectorAll('[data-move]').forEach(b => { b.onclick = () => run(() => {
      const items = data.day(d.date).items.slice(), i = +b.dataset.move, j = i + +b.dataset.dir;
      if (!items[i] || !items[j]) throw new Error('missing item');
      [items[i], items[j]] = [items[j], items[i]];
      return saveDay(d.date, { items });
    }, () => reorder(root)); });
  }
  function updateSeed(root) {
    const date = selected, seed = data.seedDay(date);
    if (!seed) return;
    const { dlg, run } = editor(root, '新しい確定予定', '<h3>' + esc(seed.headline) + '</h3><p>' + esc(seed.note) + '</p>' + seed.items.map(x => '<p>' + esc(x.time + ' ' + x.title + ' ' + (x.note || '')) + '</p>').join('') + '<p>更新すると、この日の編集を上の確定予定に置き換えるよ。今のままなら閉じてね。</p><button id="plan-apply">この日の予定を置き換える</button>');
    $('#plan-apply', dlg).onclick = () => run(async () => {
      const row = T.model.make('days', Object.assign(U.clone(seed), { seedRev: data.seed().rev, staleSeed: 0, edited: false }));
      await store.put('days', row); bus.emit('day:changed', { day: row });
    });
  }
  T.register({
    id: 'plan', title: 'しおり', routes: ['plan'], tab: { label: 'しおり', icon: 'book', order: 10 },
    render(root, params) {
      mounted = root; selected = params && params.day || null;
      view(root);
      const onClick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.day && b.dataset.day !== selected) { selected = b.dataset.day; view(root); }
        else if (b.id === 'plan-now') { selected = U.todayISO(); view(root); $('.plan-now', root).scrollIntoView({ block: 'start' }); }
        else if (b.id === 'plan-future') { selected = (daysSorted().find(d => d.date > U.todayISO()) || {}).date; view(root); }
        else if (b.id === 'edit-day') editDay(root);
        else if (b.id === 'add-item') editItem(root);
        else if (b.id === 'reorder') reorder(root);
        else if (b.id === 'plan-update') updateSeed(root);
        else if (b.dataset.editItem !== undefined) editItem(root, +b.dataset.editItem);
        else if (b.dataset.candidate) editItem(root, undefined, b.dataset.candidate);
      };
      root.addEventListener('click', onClick);
      const off = bus.on('seed:updated', () => view(root));
      const offDate = bus.on('calendar:changed', () => { selected = U.todayISO(); view(root); });
      return () => { mounted = null; ++revision; root.removeEventListener('click', onClick); off(); offDate(); ui.closeDialog(); };
    },
  });
})();
