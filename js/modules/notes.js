/* notes — 端末内のポケットメモ。F10 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store;
  const $ = (s, r) => r.querySelector(s);
  const entryHTML = (n) => '<article class="card entry notes-entry" tabindex="-1" data-note-id="' + esc(n.id) + '">'
    + (n.photoIds || []).map((id) => '<img data-photo-id="' + esc(id) + '" alt="旅の写真" loading="lazy">').join('')
    + '<p>' + esc(n.text) + '</p><div class="notes-meta">メモ · ' + esc(U.dayLabel(n.date)) + '</div>'
    + '<div class="notes-actions"><button type="button" data-toggle-note="' + esc(n.id) + '" aria-pressed="' + (n.showInTimeline !== false) + '">'
    + (n.showInTimeline !== false ? '思い出に表示中' : 'メモだけに表示') + '</button>'
    + '<button type="button" class="text-btn" data-delete-note="' + esc(n.id) + '">削除</button></div></article>';

  function render(root, params = {}) {
    let active = true, saving = false;
    const busy = new Set();
    root.innerHTML = '<section class="notes-page">' + ui.heading('A POCKET FOR YOUR THOUGHTS', 'メモ')
      + '<p>店名と値段を残すと、あとで探しやすい。</p>'
      + '<form id="memo-form"><label for="memo-text">ひとことメモ</label><textarea id="memo-text" maxlength="5000" aria-describedby="notes-privacy" placeholder="気になったお店、聞いたこと、明日やりたいこと。"></textarea>'
      + '<p id="notes-privacy" class="notes-help">パスポート・ETA・予約番号は書かないでね。</p>'
      + '<label class="notes-choice" for="memo-timeline"><input id="memo-timeline" type="checkbox" checked><span>思い出（タイムライン）にも並べる</span></label>'
      + '<label for="memo-date">記録する日</label><select id="memo-date">' + ui.dateOptions(params.date || U.todayISO()) + '</select>'
      + '<button id="memo-save" type="submit" class="primary wide">メモを保存</button></form>'
      + '<p class="notes-help">この端末だけに保存するよ。メモを外に送ることはないよ。回線がなくても書き留められるよ。</p>'
      + '<p id="notes-status" role="status" aria-live="polite"></p>'
      + '<div class="section-label"><h2>ポケットの中</h2></div><div id="notes-list"></div><div class="notebook-rest"><button class="text-btn" data-route="plan">今日はここまで</button><p class="caption">次はここから：しおりで次の予定を確認</p></div></section>';
    const ta = $('#memo-text', root), form = $('#memo-form', root), submit = $('#memo-save', root);
    const status = (text) => { if (active) $('#notes-status', root).textContent = text; };
    const list = () => {
      if (!active) return;
      const el = $('#notes-list', root);
      el.innerHTML = store.all('notes').slice().reverse().map(entryHTML).join('') || ui.empty('記録 0件');
      ui.hydratePhotos(el);
    };
    ui.bindDraft(ta, 'note');
    list();
    if (params.record) { const record = [...root.querySelectorAll('[data-note-id]')].find(el => el.dataset.noteId === params.record); if (record) { record.scrollIntoView({block:'center'}); record.focus({preventScroll:true}); } }
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!active || saving) return;
      const raw = ta.value, text = raw.trim();
      if (!text) { status('ひとこと書いたら、ポケットにしまおう。'); ta.focus(); return; }
      saving = true; submit.disabled = true; submit.textContent = '保存中';
      try {
        const note = await T.feedback.run(() => store.put('notes', T.model.make('notes', {
          id: U.uid(), date: $('#memo-date', root).value, text,
          showInTimeline: $('#memo-timeline', root).checked,
        })));
        // 保存を待つ間に書いた次のメモや、別画面の下書きを消さない。
        if (store.draft('note') === raw) store.setDraft('note', '');
        T.bus.emit('note:saved', { note });
        if (active) {
          if (ta.value === raw) ta.value = '';
          list(); status(T.saveUI.savedLabel() + '。メモを1件保存しました。');
        }
      } catch (err) {
        status('まだ保存できていないよ。書いた言葉はこの欄に残してあるよ。端末の空き容量を確かめて、もう一度しまってみてね。');
      } finally {
        saving = false;
        if (active) { submit.disabled = false; submit.textContent = 'メモを保存'; }
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
          await T.feedback.run(() => store.remove('notes', id));
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
