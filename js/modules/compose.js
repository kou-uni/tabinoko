/* compose — 一言と写真を端末に残し、選んだ文案を X で本人が最終確認する。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, S = T.store, M = T.model, esc = U.esc;
  const endings = {
    learn: 'この発見を、未来の自分への学びに。', feel: 'この気持ちを忘れたくない。',
    share: '旅先で出会った瞬間をおすそわけ。', useful: 'これから訪れる人の参考になれば。', cheer: '見守ってくれるみんなにも、この瞬間を。'
  };
  const audiences = { self: '自分への旅のメモ。', friends: '友達にも見せたい旅の一コマ。', seekers: '旅を考えている人へ、現地での気づき。', supporters: 'いつも応援してくれるみんなへ。' };
  function templates(text, context) {
    const c = context || {}, angle = M.angle(c.angle).id;
    const t = String(text || '').trim() || '写真に残した、旅の一コマ。';
    const head = { surprise: '旅先で出会った、意外なひとコマ。', moved: '心に残った旅の瞬間。', useful: '旅先での気づきメモ。', brag: 'ちょっとだけ、うれしい報告。', finalist: 'ETHGlobal Tokyo のファイナリストとして、Mumbai のハッカソンへ。' }[angle];
    const ps = (c.purposeIds || []).filter(p => endings[p]);
    const as = (c.audienceIds || []).filter(a => audiences[a]);
    const place = c.spotName ? c.spotName + 'にて。' : '';
    const shortHead = { surprise: '意外な発見。', moved: '心が動いた。', useful: '旅のヒント。', brag: 'うれしい一歩。', finalist: head }[angle];
    const feeling = ps.filter(p => p !== 'useful').map(p => endings[p]).join('\n');
    const people = as.map(a => audiences[a]).join('\n');
    // 同じ本文を並べ替えるだけにせず、長さと読み手の使い道を分ける。
    // 入力した観察以外の体験・料金・営業時間などは作らない。
    return [
      [shortHead, place, t].filter(Boolean).join('\n'),
      [head, [place, '旅の途中で、こう感じた。', '「' + t + '」'].filter(Boolean).join('\n'),
        feeling || endings.feel, people].filter(Boolean).join('\n\n'),
      ['これから訪れる人への実用メモ。',
        (c.spotName ? '場所：' + c.spotName + '\n' : '') + '現地の気づき：' + t,
        c.photoIds && c.photoIds.length ? '写真も記録に添えています。' : '',
        endings.useful, '訪問前には、最新のアクセス・営業時間を確認してね。'].filter(Boolean).join('\n\n')
    ];
  }
  function render(root, params = {}) {
    const $ = s => root.querySelector(s);
    let alive = true, busy = false, photoBusy = false, post = null, drafts = [], photos = [], selectedDraft = 0;
    let angle = M.angle(params.angle || S.setting('angleDefault')).id;
    let spotId = params.spot || null;
    let restored = {};
    try { restored = JSON.parse(S.draft('compose') || '{}'); } catch (_) { /* 古い書きかけは無視 */ }
    if (!params.date && !params.text && !params.angle && !params.spot) {
      post = restored.postId ? S.get('posts', restored.postId) : null;
      drafts = Array.isArray(restored.drafts) ? restored.drafts.filter(x => typeof x === 'string').slice(0, 3) : [];
      photos = Array.isArray(restored.photos) ? restored.photos.filter(id => S.get('photos', id)).slice(0, 4) : [];
      angle = M.angle(restored.angle || angle).id;
      spotId = restored.spotId || null;
    }
    if (params.record) {
      post = S.get('posts', params.record);
      if (post) { drafts = [post.text]; photos = post.photoIds || []; angle = M.angle(post.angle).id; spotId = post.spotId; }
    }
    const spot = spotId && T.data.spot(spotId);
    root.innerHTML = '<section class="compose-screen">' + ui.heading('CAPTURE THE LITTLE MOMENTS', '旅のことば') + ui.guide('どんな景色だった？')
      + '<button class="text-btn" data-route="purposes" data-params=\'{"back":"post"}\'>' + esc([...S.doc('purposes').purposeIds.map(id => M.purpose(id)?.short), ...S.doc('purposes').audienceIds.map(id => M.audience(id)?.label)].filter(Boolean).join(' · ') || '目的・相手を設定') + ' / 変更</button>'
      + '<form id="post-form"><label for="post-text">いま残すこと</label><textarea id="post-text" maxlength="3000" placeholder="例：チャイ 20ルピー。甘さは強め。"></textarea>'
      + '<button type="button" id="post-voice" class="compose-voice">' + ui.icon('mic') + '音声入力</button><p class="caption">パスポート・ETA・予約番号は入力・撮影しないでください。</p>'
      + '<label for="post-photo">写真を追加（4枚まで）</label><input id="post-photo" type="file" accept="image/*" multiple><div id="compose-photos" class="compose-photos"></div>'
      + '<p class="caption">写真は端末に保存。画像の内容は解析しません。</p>'
      + '<details class="compose-context"><summary>記録の条件 · <span id="compose-date-label"></span></summary><label for="post-angle">ことばの切り口</label><select id="post-angle">' + M.ANGLES.map(a => '<option value="' + a.id + '"' + (a.id === angle ? ' selected' : '') + '>' + esc(a.label) + '</option>').join('') + '</select>'
      + '<label for="post-date">記録する日</label><select id="post-date">' + ui.dateOptions(params.date || U.todayISO()) + '</select></details><button id="compose-generate" class="primary wide" type="submit">3つの文案を作る</button></form>'
      + '<p id="compose-status" role="status" aria-live="polite"></p><p class="caption">最初の案を自動保存。Xでは文面と写真を本人が最終確認。写真はX側で選んで添付。</p><div id="drafts"></div><button id="compose-new" class="wide">次の記録を書く</button></section>';
    const field = $('#post-text');
    if ($('#compose-date-label')) $('#compose-date-label').textContent = $('#post-date').value;
    ui.bindDraft(field, 'post');
    if (params.text && !field.value) { field.value = params.text; S.setDraft('post', field.value); }
    if (params.record && post) field.value = post.prompt || '';
    const detachVoice = T.voice.attach($('#post-voice'), field);
    if (restored.date && !params.date && !params.text && !params.angle && !params.spot) $('#post-date').innerHTML = ui.dateOptions(restored.date);
    if ($('#compose-date-label')) $('#compose-date-label').textContent = $('#post-date').value;
    const remember = () => S.setDraft('compose', JSON.stringify({ postId: post && post.id, drafts, photos, angle, spotId, date: $('#post-date').value }));
    const status = text => { if (alive) $('#compose-status').textContent = text; };
    const context = () => Object.assign({}, S.doc('purposes'), { angle, spotName: spot && spot.name, photoIds: photos });
    const sync = () => {
      if (!alive) return;
      root.querySelectorAll('[data-x]').forEach(a => {
        const text = drafts[+a.dataset.x], n = U.xLength(text);
        const ready = post && post.text === text.trim() && n <= 280 && text.trim() && !busy;
        a.removeAttribute('href'); a.setAttribute('aria-disabled', String(!ready || !U.isOnline()));
        if (ready && U.isOnline()) a.href = U.xIntentUrl(text.trim());
        a.textContent = !U.isOnline() ? '回線が戻ったら X で確認' : ready ? 'X で最終確認 ↗' : 'この案を保存してから X へ';
        const saveButton = $('[data-save-post="' + a.dataset.x + '"]');
        const saved = post && post.text === text.trim(); saveButton.disabled = !!saved || busy; saveButton.textContent = busy ? '保存中…' : saved ? T.saveUI.savedLabel() : 'この文案を端末に保存'; saveButton.classList.toggle('primary', !saved);
        const count = $('[data-count="' + a.dataset.x + '"]');
        count.textContent = n + ' / 280（X換算・目安）' + (n > 280 ? ' — 短くするとXへ渡せるよ' : '');
      });
    };
    const showDrafts = () => {
      $('#compose-generate').classList.toggle('primary', !drafts.length);
      $('#drafts').innerHTML = '<div class="draft-tabs" role="tablist" aria-label="文案">' + drafts.map((_, i) => '<button role="tab" id="draft-tab-' + i + '" aria-controls="draft-panel-' + i + '" data-select-draft="' + i + '" tabindex="' + (i === selectedDraft ? '0' : '-1') + '" aria-selected="' + (i === selectedDraft) + '">案 ' + (i + 1) + '</button>').join('') + '</div>' + drafts.map((text, i) => '<article role="tabpanel" aria-labelledby="draft-tab-' + i + '" id="draft-panel-' + i + '" class="compose-draft" ' + (i !== selectedDraft ? 'hidden' : '') + '><label for="compose-draft-' + i + '">文案 ' + (i + 1) + '</label><textarea id="compose-draft-' + i + '" data-draft="' + i + '" aria-describedby="compose-count-' + i + '">' + esc(text) + '</textarea><p class="caption" id="compose-count-' + i + '" data-count="' + i + '"></p><div class="compose-actions"><button data-copy="' + i + '">コピー</button><button data-save-post="' + i + '">この文案を端末に保存</button><a data-x="' + i + '" target="_blank" rel="noopener noreferrer">X で最終確認 ↗</a></div></article>').join('');
      sync();
    };
    async function save(text, prompt) {
      status('保存中…');
      const row = M.make('posts', Object.assign({}, post || {}, { id: post ? post.id : U.uid(), date: $('#post-date').value, text: text.trim(), prompt, angle, spotId, photoIds: photos.slice(), purposeIds: S.doc('purposes').purposeIds, audienceIds: S.doc('purposes').audienceIds, showInTimeline: true }));
      post = await T.feedback.run(() => S.put('posts', row));
      if (alive) remember();
      T.bus.emit('post:saved', { post });
      return post;
    }
    $('#post-form').onsubmit = async e => {
      e.preventDefault(); if (busy || photoBusy) return;
      if (!field.value.trim() && !photos.length) { status('ひとことか写真で、その瞬間を聞かせてね。'); field.focus(); return; }
      busy = true; $('#compose-generate').disabled = true; sync();
      angle = $('#post-angle').value;
      drafts = templates(field.value, context()); showDrafts();
      remember();
      try { await save(drafts[0], field.value); status(T.saveUI.savedLabel() + '。文案を編集できます。'); }
      catch (err) { status('まだ思い出に保存できていないよ。入力はここにあるので、空き容量を確かめてもう一度保存してね。'); }
      finally { busy = false; if (alive) { $('#compose-generate').disabled = false; sync(); } }
    };
    $('#post-photo').onchange = async e => {
      if (photoBusy || busy) return;
      const files = Array.from(e.target.files || []); if (!files.length) return;
      photoBusy = true; e.target.disabled = true; $('#compose-generate').disabled = true;
      status('写真を保存中');
      const finish = T.feedback.begin(); let savedPhotos = false;
      try {
        if (files.length + photos.length > 4) throw new Error('写真は4枚まで選んでね。');
        for (const file of files) {
          const row = await T.photo.add(file, { date: $('#post-date').value }); photos.push(row.id);
          if (!alive) break;
          remember();
          $('#compose-photos').innerHTML = photos.map(id => '<img data-photo-id="' + esc(id) + '" alt="記録に添えた写真">').join(''); ui.hydratePhotos($('#compose-photos'));
        }
        savedPhotos = true; status(T.saveUI.savedLabel() + '。写真 ' + photos.length + ' / 4');
      } catch (err) { status('写真を追加できなかったよ。' + (err.message || '空き容量や写真の形式を確かめてね。')); }
      finally { finish(savedPhotos ? 'success' : 'error'); photoBusy = false; if (alive) { e.target.disabled = false; e.target.value = ''; $('#compose-generate').disabled = false; } }
    };
    const input = e => {
      if (e.target.dataset.draft !== undefined) { drafts[+e.target.dataset.draft] = e.target.value; sync(); }
      if ($('#compose-date-label')) $('#compose-date-label').textContent = $('#post-date').value;
      remember();
    };
    const click = async e => {
      const b = e.target.closest('button,a'); if (!b) return;
      if (b.dataset.selectDraft !== undefined) { selectedDraft = +b.dataset.selectDraft; showDrafts(); $('#draft-tab-' + selectedDraft).focus(); return; }
      if (b.dataset.copy !== undefined) {
        const area = $('[data-draft="' + b.dataset.copy + '"]');
        // execCommand reports actual success; util.copy treats an unfulfilled clipboard promise as success.
        area.focus(); area.select(); area.setSelectionRange(0, area.value.length);
        let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* 手動へ */ }
        status(ok ? 'ことばをコピーしたよ。' : '選んだことばを長押しして、コピーしてね。');
      } else if (b.dataset.savePost !== undefined) {
        if (busy || photoBusy) return;
        const text = drafts[+b.dataset.savePost]; if (!text.trim()) return status('残したいことばをひとこと添えてね。');
        busy = true; b.disabled = true; sync();
        try { await save(text, field.value); status(T.saveUI.savedLabel() + '。Xで確認できます。'); }
        catch (_) { status('保存できなかったよ。入力はここにあるので、もう一度試してね。'); }
        finally { busy = false; if (alive) { b.disabled = false; sync(); } }
      } else if (b.dataset.x !== undefined) {
        if (!b.hasAttribute('href') || busy || !U.isOnline()) { e.preventDefault(); status('この文案を端末に保存して、回線が戻ってからXで確認してね。'); }
        else {
          const area = $('[data-draft="' + b.dataset.x + '"]');
          area.focus(); area.select(); area.setSelectionRange(0, area.value.length);
          try { document.execCommand('copy'); } catch (_) { /* 保存済みの本文は端末に残る */ }
        }
        // X を開いたことと実際に投稿したことは区別。sharedAt は設定しない。
      }
    };
    const tabKey = e => { if (e.target.dataset.selectDraft === undefined || !['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return; e.preventDefault(); selectedDraft = e.key === 'Home' ? 0 : e.key === 'End' ? drafts.length - 1 : (selectedDraft + (e.key === 'ArrowRight' ? 1 : -1) + drafts.length) % drafts.length; showDrafts(); $('#draft-tab-' + selectedDraft).focus(); };
    root.addEventListener('keydown', tabKey);
    root.addEventListener('input', input); root.addEventListener('change', input); root.addEventListener('click', click);
    $('#compose-new').onclick = () => {
      if (busy || photoBusy) return;
      if (!post && (field.value.trim() || photos.length)) return status('今の瞬間を文案にして保存してから、次へ進もう。');
      if (post && (post.prompt !== field.value || JSON.stringify(post.photoIds) !== JSON.stringify(photos))) return status('書き足したひとことや写真があるよ。文案を作って保存してから、次へ進もう。');
      $('#compose-generate').classList.toggle('primary', true);
      post = null; drafts = []; photos = []; field.value = ''; S.setDraft('post', '');
      $('#drafts').innerHTML = ''; $('#compose-photos').innerHTML = '';
      remember(); status('次はどんな瞬間に出会った？'); field.focus();
    };
    if (drafts.length) showDrafts();
    if (photos.length) {
      $('#compose-photos').innerHTML = photos.map(id => '<img data-photo-id="' + esc(id) + '" alt="記録に添えた写真">').join('');
      ui.hydratePhotos($('#compose-photos'));
    }
    const offOnline = T.bus.on('app:online', sync), offOffline = T.bus.on('app:offline', sync);
    return () => { alive = false; root.removeEventListener('keydown', tabKey); root.removeEventListener('input', input); root.removeEventListener('change', input); root.removeEventListener('click', click); offOnline(); offOffline(); if (detachVoice) detachVoice(); T.voice.stop(); };
  }
  T.register({ id: 'compose', title: '投稿', routes: ['post'], tab: { label: '投稿', icon: 'post', order: 20, accent: true }, render, templates });
})();
