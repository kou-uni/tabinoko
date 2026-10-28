/* timeline — 日ごとの思い出。写真・投稿・メモ・足跡を端末内から読む。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store, bus = T.bus, M = T.model;
  const $ = (s, r) => r.querySelector(s);
  const KIND = { post: '投稿案', note: 'メモ', visit: '足跡' };
  function entries() {
    const out = [];
    [['posts', 'post'], ['notes', 'note'], ['visits', 'visit']].forEach(([coll, kind]) => {
      store.all(coll).filter((r) => r.showInTimeline !== false).forEach((r) => out.push(Object.assign({}, r, { kind, text: kind === 'visit' ? [r.title, r.note].filter(Boolean).join('\n') : r.text, photoIds: r.photoIds || [] })));
    });
    return out.sort((a, b) => a.date.localeCompare(b.date) || (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0) || a.id.localeCompare(b.id));
  }
  function time(at) {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function entryHTML(e) {
    const spot = e.spotId && T.data.spot(e.spotId);
    const own = e.kind === 'note' && e.source === 'timeline';
    const actions = own ? '<button class="text-btn" data-edit-memory="' + esc(e.id) + '">編集</button><button class="text-btn" data-delete-memory="' + esc(e.id) + '">削除</button>'
      : '<button class="text-btn" data-route="' + ({ post: 'post', note: 'notes', visit: 'map' }[e.kind]) + '">' + ({ post: '投稿画面へ', note: 'メモを開く', visit: '地図で見る' }[e.kind]) + '</button>';
    return '<article class="card timeline-entry" data-memory-id="' + esc(e.id) + '">' + e.photoIds.map((id) => '<img data-photo-id="' + esc(id) + '" alt="旅の写真" loading="lazy" decoding="async">').join('')
      + (e.text ? '<p>' + esc(e.text) + '</p>' : '') + '<div class="timeline-meta"><span>' + (e.kind === 'post' && e.sharedAt ? '共有した投稿' : KIND[e.kind]) + ' · <time datetime="' + esc(e.at) + '">' + esc(time(e.at)) + '</time></span>' + (spot ? '<span>' + esc(spot.name) + '</span>' : '') + '</div><div class="timeline-entry-actions">' + actions + '</div></article>';
  }
  function view(root) {
    const list = entries(), days = store.all('days').sort((a, b) => a.date.localeCompare(b.date));
    const dates = [...new Set([...days.map((d) => d.date), ...list.map((e) => e.date)])].sort();
    root.innerHTML = '<div class="timeline-page">' + ui.heading('COLLECTING MEMORIES', '旅のあしあと', '<span class="badge">' + list.length + ' の思い出</span>')
      + '<p class="timeline-count">記録 <strong>' + new Set(list.map(e => e.date)).size + '</strong>日 · ' + list.length + '件</p>'
      + '<p class="muted">写真とことばを、日付からたどる。</p><p class="caption">回線がなくても、この端末に思い出を残せるよ。時刻は端末の設定で表示するね。</p>'
      + '<button data-route="recap">旅を振り返る ↗</button>'
      + (!list.length ? '<p class="empty">記録 0件。メモ・写真を残す。</p>' : '')
      + '<div class="timeline">' + dates.map((date) => {
        const i = days.findIndex((d) => d.date === date);
        return '<section class="timeline-day"><h2>' + (i < 0 ? '旅の前後' : '<em>' + (i + 1) + '</em>日目') + ' <small>' + esc(U.dayLabel(date)) + '</small></h2>'
          + (list.filter((e) => e.date === date).map(entryHTML).join('') || '<p class="timeline-blank">未記録</p>') + '</section>';
      }).join('') + '</div><div class="timeline-add"><button class="primary" id="add-memory">＋ メモ・写真を残す</button></div></div>';
    ui.hydratePhotos(root);
  }
  function memoryDialog(state, existing) {
    let busy = false, closed = false;
    const now = U.iso();
    const spots = T.data.spots();
    const dlg = ui.dialog({ title: existing ? '思い出を整える' : '思い出をひとつ', onClose: () => { closed = true; }, body: '<form id="memory-form" class="timeline-form"><label for="memory-text">ひとこと（写真だけでもOK）</label><textarea id="memory-text" maxlength="5000" placeholder="ここに来られて、よかった。">' + esc(existing ? existing.text : '') + '</textarea><p class="caption">パスポート・ETA・予約番号は書かないでね。写真にも写っていないか見てね。</p><label for="memory-photo">写真を' + (existing ? '追加する' : '選ぶ') + '</label><input id="memory-photo" type="file" accept="image/*"><p class="caption">写真は縮小して、この端末だけに保存するよ。' + (existing && existing.photoIds.length ? '保存済みの写真はそのまま残るよ。' : '') + '</p><label for="memory-date">記録する日</label><input id="memory-date" type="date" required value="' + esc(existing ? existing.date : state.date || U.todayISO()) + '"><label for="memory-time">時刻（端末の時刻）</label><input id="memory-time" type="time" required value="' + esc(time(existing ? existing.at : now)) + '"><label for="memory-spot">場所（選ばなくてもOK）</label><select id="memory-spot"><option value="">場所を付けない</option>' + spots.map((s) => '<option value="' + esc(s.id) + '"' + (existing && existing.spotId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select><p id="memory-error" role="alert"></p><button id="save-memory" class="primary wide">思い出に残す</button></form>' });
    const form = $('#memory-form', dlg), btn = $('#save-memory', dlg), error = $('#memory-error', dlg);
    state.dialog = dlg;
    const live = () => state.active && !closed && dlg.open && $('#memory-form', dlg) === form;
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy || !live()) return;
      const text = $('#memory-text', dlg).value.trim(), file = $('#memory-photo', dlg).files[0], date = $('#memory-date', dlg).value, tm = $('#memory-time', dlg).value;
      const at = new Date(date + 'T' + tm + ':00');
      if (!text && !file && !(existing && existing.photoIds.length)) { error.textContent = 'ひとことか、写真を選んでね。'; return; }
      if (!date || !tm || Number.isNaN(at.getTime())) { error.textContent = '日付と時刻を選んでね。'; return; }
      const spotId = $('#memory-spot', dlg).value || null;
      busy = true; btn.disabled = true; btn.textContent = '思い出をしまっています…'; error.textContent = '';
      const inputs = ['memory-text', 'memory-photo', 'memory-date', 'memory-time', 'memory-spot'].map((id) => $('#' + id, dlg));
      inputs.forEach((input) => { input.disabled = true; });
      let photo = null, saved = false;
      const finish = T.feedback.begin();
      try {
        if (file) photo = await T.photo.add(file, { date, at: at.toISOString() });
        // 写真変換中に閉じた場合は、新しい画面にも記録にも触らない。
        if (!live()) return;
        if (existing && !store.get('notes', existing.id)) throw new Error('この思い出は見つからなかったよ。一度閉じて一覧を見てね。');
        const note = await store.put('notes', M.make('notes', Object.assign({}, existing || {}, { id: existing ? existing.id : U.uid(), source: 'timeline', date, at: at.toISOString(), text, spotId, photoIds: [...(existing ? existing.photoIds : []), ...(photo ? [photo.id] : [])] })));
        saved = true;
        bus.emit('note:saved', { note });
        if (live()) { ui.closeDialog(); ui.toast('思い出をこの端末に残したよ。'); }
      } catch (err) {
        if (live()) error.textContent = err.userMessage || (err.name === 'QuotaExceededError' ? '端末の保存場所がいっぱいみたい。設定でバックアップして、整理してからもう一度試してね。' : err.message || '保存できなかったよ。入力はそのまま、もう一度試してね。');
      } finally {
        if (photo && !saved) await store.photos.remove(photo.id).catch(() => { if (live()) error.textContent += ' 写真だけ残った可能性があるよ。設定で保存容量を見てね。'; });
        finish(saved ? 'success' : 'error');
        busy = false;
        if (live()) { inputs.forEach((input) => { input.disabled = false; }); btn.disabled = false; btn.textContent = '思い出に残す'; }
      }
    };
  }
  async function remove(state, id) {
    const row = store.get('notes', id);
    if (!row || row.source !== 'timeline') return;
    const ok = await ui.confirm({ title: 'この思い出を削除する？', body: 'この端末の記録を削除するよ。元には戻せないので、残しておきたい写真はバックアップしてね。', ok: '削除する', cancel: '残しておく' });
    if (!ok || !state.active) return;
    const finish = T.feedback.begin(); let removed = false;
    try {
      await store.remove('notes', id);
      for (const pid of row.photoIds || []) {
        const used = ['posts', 'notes'].some((coll) => store.all(coll).some((r) => (r.photoIds || []).includes(pid)));
        if (!used) await store.photos.remove(pid);
      }
      removed = true;
    } catch (err) { if (state.active) ui.toast('削除を最後までできなかったよ。一覧と保存容量を見てね。'); }
    finally { finish(removed ? 'success' : 'error'); }
  }
  T.register({
    id: 'timeline', title: '思い出', routes: ['timeline'], tab: { label: '思い出', icon: 'timeline', order: 30 },
    render(root, params = {}) {
      const state = { active: true, dialog: null, date: params.date, deleting: new Set() };
      view(root);
      if (params.add === 'photo') memoryDialog(state);
      const off = bus.on('store:changed', ({ coll }) => { if (state.active && ['posts', 'notes', 'visits', 'days', 'spots', '*'].includes(coll)) view(root); });
      const onClick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.id === 'add-memory') memoryDialog(state);
        else if (b.dataset.editMemory) {
          const row = store.get('notes', b.dataset.editMemory);
          if (row && row.source === 'timeline') memoryDialog(state, row);
        } else if (b.dataset.deleteMemory && !state.deleting.has(b.dataset.deleteMemory)) { const id = b.dataset.deleteMemory; state.deleting.add(id); remove(state, id).finally(() => state.deleting.delete(id)); }
      };
      const onPhotoError = (e) => {
        const img = e.target;
        if (!state.active || !img.matches || !img.matches('img[data-photo-id]')) return;
        const fallback = document.createElement('p');
        fallback.className = 'caption';
        fallback.textContent = 'この写真は開けなかったよ。ほかの思い出はそのまま見られるよ。';
        img.replaceWith(fallback);
      };
      root.addEventListener('click', onClick);
      root.addEventListener('error', onPhotoError, true);
      return () => { state.active = false; off(); root.removeEventListener('click', onClick); root.removeEventListener('error', onPhotoError, true); if (state.dialog && state.dialog.open && $('#memory-form', state.dialog)) ui.closeDialog(); };
    },
  });
})();
