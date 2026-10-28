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
    let alive = true, busy = false, photoBusy = false, post = null, drafts = [], photos = [];
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
    const spot = spotId && T.data.spot(spotId);
    root.innerHTML = '<section class="compose-screen">' + ui.heading('CAPTURE THE LITTLE MOMENTS', '「あっ」を、ことばに。')
      + '<p class="muted">うまく話さなくて大丈夫。そのまま聞かせて。</p><button class="wide" data-route="purposes" data-params=\'{"back":"post"}\'>目的・届けたい相手を選び直す</button>'
      + '<form id="post-form"><label for="post-text">いま、何を感じた？</label><textarea id="post-text" maxlength="3000" placeholder="海沿いの夜景が、ネックレスみたい。"></textarea>'
      + '<button type="button" id="post-voice" class="compose-voice">' + ui.icon('mic') + '声でひとこと</button><p class="caption">キーボードのマイクで話せるよ。音声入力の通信は端末の設定によります。<br>パスポート・ETA・予約番号は書かないでね。写真にも写さないでね。</p>'
      + '<label for="post-photo">一緒に残す写真（4枚まで）</label><input id="post-photo" type="file" accept="image/*" multiple><div id="compose-photos" class="compose-photos"></div>'
      + '<p class="caption">写真は端末に保存するよ。写真の中身を読み取る機能はないので、感じたことをひとこと添えてね。</p>'
      + '<label for="post-angle">ことばの切り口</label><select id="post-angle">' + M.ANGLES.map(a => '<option value="' + a.id + '"' + (a.id === angle ? ' selected' : '') + '>' + esc(a.label) + '</option>').join('') + '</select>'
      + '<label for="post-date">記録する日</label><select id="post-date">' + ui.dateOptions(params.date || U.todayISO()) + '</select><button id="compose-generate" class="primary wide" type="submit">投稿のことばを3つ見つける</button></form>'
      + '<p id="compose-status" role="status" aria-live="polite"></p><p class="caption">文案を作ると、この瞬間が思い出に残るよ。投稿しなくても大丈夫。Xは文面を渡すだけ。写真はX側で元の写真を選んで添えてね。最後の投稿はXで確認してね。</p><div id="drafts"></div><button id="compose-new" class="wide">次の瞬間を残す</button></section>';
    const field = $('#post-text');
    ui.bindDraft(field, 'post');
    if (params.text && !field.value) { field.value = params.text; S.setDraft('post', field.value); }
    const detachVoice = T.voice.attach($('#post-voice'), field);
    if (restored.date && !params.date && !params.text && !params.angle && !params.spot) $('#post-date').innerHTML = ui.dateOptions(restored.date);
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
        const count = $('[data-count="' + a.dataset.x + '"]');
        count.textContent = n + ' / 280（X換算・目安）' + (n > 280 ? ' — 短くするとXへ渡せるよ' : '');
      });
    };
    const showDrafts = () => {
      $('#drafts').innerHTML = '<h2>気持ちに近いことばを選んでね</h2>' + drafts.map((text, i) => '<article class="card compose-draft"><label for="compose-draft-' + i + '">文案 ' + (i + 1) + '</label><textarea id="compose-draft-' + i + '" data-draft="' + i + '" aria-describedby="compose-count-' + i + '">' + esc(text) + '</textarea><p class="caption" id="compose-count-' + i + '" data-count="' + i + '"></p><div class="compose-actions"><button data-copy="' + i + '">コピー</button><button data-save-post="' + i + '">この案を思い出に保存</button><a data-x="' + i + '" target="_blank" rel="noopener noreferrer">X で最終確認 ↗</a></div></article>').join('');
      sync();
    };
    async function save(text, prompt) {
      const row = M.make('posts', Object.assign({}, post || {}, { id: post ? post.id : U.uid(), date: $('#post-date').value, text: text.trim(), prompt, angle, spotId, photoIds: photos.slice(), purposeIds: S.doc('purposes').purposeIds, audienceIds: S.doc('purposes').audienceIds, showInTimeline: true }));
      post = await S.put('posts', row);
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
      try { await save(drafts[0], field.value); status('この瞬間を思い出に残したよ。ことばは自由に直してね。'); }
      catch (err) { status('まだ思い出に保存できていないよ。入力はここにあるので、空き容量を確かめてもう一度保存してね。'); }
      finally { busy = false; if (alive) { $('#compose-generate').disabled = false; sync(); } }
    };
    $('#post-photo').onchange = async e => {
      if (photoBusy || busy) return;
      const files = Array.from(e.target.files || []); if (!files.length) return;
      photoBusy = true; e.target.disabled = true; $('#compose-generate').disabled = true;
      status('写真を思い出に迎えているよ…');
      try {
        if (files.length + photos.length > 4) throw new Error('写真は4枚まで選んでね。');
        for (const file of files) {
          const row = await T.photo.add(file, { date: $('#post-date').value }); photos.push(row.id);
          if (!alive) break;
          remember();
          $('#compose-photos').innerHTML = photos.map(id => '<img data-photo-id="' + esc(id) + '" alt="一緒に残す旅の写真">').join(''); ui.hydratePhotos($('#compose-photos'));
        }
        status('写真を端末に残したよ。文案を作ると、ことばと一緒に思い出に残るよ。');
      } catch (err) { status('写真を追加できなかったよ。' + (err.message || '空き容量や写真の形式を確かめてね。')); }
      finally { photoBusy = false; if (alive) { e.target.disabled = false; e.target.value = ''; $('#compose-generate').disabled = false; } }
    };
    const input = e => {
      if (e.target.dataset.draft !== undefined) { drafts[+e.target.dataset.draft] = e.target.value; sync(); }
      remember();
    };
    const click = async e => {
      const b = e.target.closest('button,a'); if (!b) return;
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
        try { await save(text, field.value); status('この案を思い出に残したよ。Xで確認するなら、下のリンクからどうぞ。'); }
        catch (_) { status('保存できなかったよ。入力はここにあるので、もう一度試してね。'); }
        finally { busy = false; if (alive) { b.disabled = false; sync(); } }
      } else if (b.dataset.x !== undefined) {
        if (!b.hasAttribute('href') || busy || !U.isOnline()) { e.preventDefault(); status('この案を思い出に保存して、回線が戻ってからXで確認してね。'); }
        else {
          const area = $('[data-draft="' + b.dataset.x + '"]');
          area.focus(); area.select(); area.setSelectionRange(0, area.value.length);
          try { document.execCommand('copy'); } catch (_) { /* 保存済みの本文は端末に残る */ }
        }
        // X を開いたことと実際に投稿したことは区別。sharedAt は設定しない。
      }
    };
    root.addEventListener('input', input); root.addEventListener('click', click);
    $('#compose-new').onclick = () => {
      if (busy || photoBusy) return;
      if (!post && (field.value.trim() || photos.length)) return status('今の瞬間を文案にして保存してから、次へ進もう。');
      if (post && (post.prompt !== field.value || JSON.stringify(post.photoIds) !== JSON.stringify(photos))) return status('書き足したひとことや写真があるよ。文案を作って保存してから、次へ進もう。');
      post = null; drafts = []; photos = []; field.value = ''; S.setDraft('post', '');
      $('#drafts').innerHTML = ''; $('#compose-photos').innerHTML = '';
      remember(); status('次はどんな瞬間に出会った？'); field.focus();
    };
    if (drafts.length) showDrafts();
    if (photos.length) {
      $('#compose-photos').innerHTML = photos.map(id => '<img data-photo-id="' + esc(id) + '" alt="一緒に残す旅の写真">').join('');
      ui.hydratePhotos($('#compose-photos'));
    }
    const offOnline = T.bus.on('app:online', sync), offOffline = T.bus.on('app:offline', sync);
    return () => { alive = false; root.removeEventListener('input', input); root.removeEventListener('click', click); offOnline(); offOffline(); if (detachVoice) detachVoice(); T.voice.stop(); };
  }
  T.register({ id: 'compose', title: '投稿', routes: ['post'], tab: { label: '投稿', icon: 'post', order: 20, accent: true }, render, templates });
})();
