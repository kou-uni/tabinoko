/* notes — 端末内のポケットメモ。F10 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store;
  const $ = (s, r) => r.querySelector(s);
  const entryHTML = (n) => '<article class="card entry notes-entry">'
    + (n.photoIds || []).map((id) => '<img data-photo-id="' + esc(id) + '" alt="旅の写真" loading="lazy">').join('')
    + '<p>' + esc(n.text) + '</p><div class="notes-meta">メモ · ' + esc(U.dayLabel(n.date)) + '</div>'
    + '<div class="notes-actions"><button type="button" data-toggle-note="' + esc(n.id) + '" aria-pressed="' + (n.showInTimeline !== false) + '">'
    + (n.showInTimeline !== false ? '思い出に表示中' : 'メモだけに保存中') + '</button>'
    + '<button type="button" class="text-btn" data-delete-note="' + esc(n.id) + '">削除</button></div></article>';

  function render(root) {
    let active = true, saving = false;
    const busy = new Set();
    root.innerHTML = '<section class="notes-page">' + ui.heading('A POCKET FOR YOUR THOUGHTS', '旅のポケットメモ')
      + '<p>旅で見つけたこと、ここにしまっておこう。</p>'
      + '<form id="memo-form"><label for="memo-text">ひとことメモ</label><textarea id="memo-text" maxlength="5000" aria-describedby="notes-privacy" placeholder="気になったお店、聞いたこと、明日やりたいこと。"></textarea>'
      + '<p id="notes-privacy" class="notes-help">パスポート・ETA・予約番号は書かないでね。</p>'
      + '<label class="notes-choice" for="memo-timeline"><input id="memo-timeline" type="checkbox" checked><span>思い出（タイムライン）にも並べる</span></label>'
      + '<label for="memo-date">記録する日</label><select id="memo-date">' + ui.dateOptions() + '</select>'
      + '<button id="memo-save" type="submit" class="primary wide">メモを残す</button></form>'
      + '<p class="notes-help">この端末だけに保存するよ。メモを外に送ることはないよ。回線がなくても書き留められるよ。</p>'
      + '<p id="notes-status" role="status" aria-live="polite"></p>'
      + '<div class="section-label"><h2>ポケットの中</h2></div><div id="notes-list"></div></section>';
    const ta = $('#memo-text', root), form = $('#memo-form', root), submit = $('#memo-save', root);
    const status = (text) => { if (active) $('#notes-status', root).textContent = text; };
    const list = () => {
      if (!active) return;
      const el = $('#notes-list', root);
      el.innerHTML = store.all('notes').slice().reverse().map(entryHTML).join('') || ui.empty('まだ空っぽ。旅の途中の小さな発見、ここで待ってるね。');
      ui.hydratePhotos(el);
    };
    ui.bindDraft(ta, 'note');
    list();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!active || saving) return;
      const raw = ta.value, text = raw.trim();
      if (!text) { status('ひとこと書いたら、ポケットにしまおう。'); ta.focus(); return; }
      saving = true; submit.disabled = true; submit.textContent = 'しまっているよ…';
      try {
        const note = await store.put('notes', T.model.make('notes', {
          id: U.uid(), date: $('#memo-date', root).value, text,
          showInTimeline: $('#memo-timeline', root).checked,
        }));
        // 保存を待つ間に書いた次のメモや、別画面の下書きを消さない。
        if (store.draft('note') === raw) store.setDraft('note', '');
        T.bus.emit('note:saved', { note });
        if (active) {
          if (ta.value === raw) ta.value = '';
          list(); status('メモをポケットにしまったよ。');
        }
      } catch (err) {
        status('まだ保存できていないよ。書いた言葉はこの欄に残してあるよ。端末の空き容量を確かめて、もう一度しまってみてね。');
      } finally {
        saving = false;
        if (active) { submit.disabled = false; submit.textContent = 'メモを残す'; }
      }
    };
    const onClick = async (e) => {
      const b = e.target.closest('[data-toggle-note], [data-delete-note]');
      if (!b || !active) return;
      const id = b.dataset.toggleNote || b.dataset.deleteNote;
      if (busy.has(id)) return;
      busy.add(id); b.disabled = true;
      try {
        if (b.dataset.toggleNote) {
          const n = store.get('notes', id);
          if (!n) return;
          await store.patch('notes', id, { showInTimeline: n.showInTimeline === false });
          status(n.showInTimeline === false ? '思い出にも並べたよ。' : 'メモのポケットだけにしまったよ。');
        } else {
          const ok = await ui.confirm({ title: 'このメモを手放す？', body: '思い出からも消えて、元には戻せないよ。', ok: '削除する', cancel: '残しておく' });
          if (!ok || !active) return;
          // 写真は他の記録も参照しうるため、ここではメモ行のみを消す。
          await store.remove('notes', id);
          status('メモを削除したよ。');
        }
        list();
      } catch (err) { status('変更を保存できなかったよ。少し待って、もう一度試してね。'); }
      finally { busy.delete(id); if (active) b.disabled = false; }
    };
    root.addEventListener('click', onClick);
    return () => { active = false; root.removeEventListener('click', onClick); };
  }
  T.register({ id: 'notes', title: 'メモ', routes: ['notes'], header: { label: 'メモを開く', icon: 'note', order: 10 }, render });
})();
