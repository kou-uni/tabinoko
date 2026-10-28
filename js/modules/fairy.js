/* fairy — 端末内の旅の相棒。hearing の追記と返答を所有する。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, store = T.store, bus = T.bus, M = T.model, esc = U.esc;
  const $ = (s, r) => (r || document).querySelector(s);
  const short = (s) => { const a = Array.from(String(s || '').replace(/\s+/g, ' ').trim()); return a.slice(0, 42).join('') + (a.length > 42 ? '…' : ''); };
  const phrases = {
    joy: ['「{word}」を記録。', '「{word}」を端末に保存。'],
    rest: ['「{word}」を記録。休めるときに休息を。', '「{word}」を保存。続きは後から書ける。'],
    arrive: ['「{word}」への訪問を記録。', '訪問記録：「{word}」。'],
    record: ['「{word}」を記録。', '記録に追加：「{word}」。']
  };
  function subject(ctx) {
    const s = ctx.spotId && T.data.spot(ctx.spotId);
    return short(ctx.text || ctx.title || (s && s.name) || (ctx.date ? U.dayLabel(ctx.date) + 'の写真' : '旅のひとこま'));
  }
  function reply(ctx) {
    ctx = ctx || {};
    const word = subject(ctx);
    const kind = /疲|不安|眠|つら|辛|悲|怖|痛|体調/.test(ctx.text || '') ? 'rest' : ctx.kind === 'arrive' ? 'arrive' : ctx.kind === 'record' ? 'record' : 'joy';
    return U.fill(U.pickFresh('fairy-' + kind, phrases[kind]), { word });
  }
  function question(text) {
    const choices = /寺院|石窟|エローラ|アジャンタ/.test(text) ? ['どんなところを、ゆっくり見てみたい？', 'その場所で楽しみなこと、もう少し聞いてもいい？'] : /学|Devcon|ハック|ETH/i.test(text) ? ['どんな出会いを楽しみにしているの？', 'そこで触れてみたいことはある？'] : ['楽しみな場所や日があったら、続きも聞かせてね。', 'その旅でやってみたいこと、思いついたら教えてね。', '覚えておきたい場面をひとつ。'];
    return /疲|不安|眠|つら|辛|悲|怖|痛|体調/.test(text) ? '続きは、話したくなったときで大丈夫だよ。' : U.pickFresh('fairy-question-' + choices[0], choices);
  }
  function recap() {
    const trip = store.doc('trip');
    const records = ['posts', 'notes', 'visits', 'photos'].flatMap((c) => store.all(c)).filter((r) => r.date >= trip.start && r.date <= trip.end && r.date <= U.todayISO() && r.showInTimeline !== false).sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)));
    const words = [...new Set(records.map(subject))].slice(0, 2);
    if (!words.length) return '帰りの旅も、そばにいるよ。まだ記録はないけれど、覚えておきたいひとこまがあったら聞かせてね。';
    return '記録を振り返る。' + words.map((w) => '「' + w + '」').join('も、') + 'を保存している。';
  }
  const returning = () => { const end = store.doc('trip').end; return !!end && U.todayISO() >= U.addDays(end, -1); };
  function compose(ctx) {
    if (!ctx) return null;
    if (ctx.kind === 'recap-open' || ctx.kind === 'recap-return') return recap();
    if (['react', 'arrive', 'record'].includes(ctx.kind)) return reply(ctx);
    return null;
  }
  function stamp(c) {
    const d = new Date(c.at);
    return c.date + (Number.isNaN(d.getTime()) ? '' : ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  }
  function view(root) {
    let alive = true, busy = false;
    const list = store.all('hearing').sort((a, b) => String(a.at || a.date).localeCompare(String(b.at || b.date)));
    const latest = list[list.length - 1];
    root.innerHTML = '<section class="fairy-view">' + ui.heading('YOUR LITTLE TRAVEL COMPANION', '旅の記録係')
      + '<div class="fairy-intro">' + ui.fairy('fairy-large') + '<span>記録係 · たびのこ</span></div>'
      + '<div class="fairy-bubble" id="fairy-answer" role="status">' + esc(latest ? latest.fairyReply || reply({ text: latest.text }) : '店名と値段を残すと、あとで探しやすい。') + '</div>'
      + (returning() ? '<div class="fairy-return"><p>' + esc(recap()) + '</p><button class="warm wide" data-route="recap">アルバムを開く →</button></div>' : '')
      + '<form id="chat-form"><label for="chat-text">旅のこと、少しずつ聞かせて</label><textarea id="chat-text" maxlength="2000" aria-describedby="fairy-help" placeholder="石窟で彫刻をゆっくり見てみたいな"></textarea><p class="caption" id="fairy-help">何回に分けても大丈夫。回線がなくても、話と書きかけはこの端末に残せるよ。パスポート・ETA・予約番号は書かないでね。</p><button type="button" class="voice" id="chat-voice">' + ui.icon('mic') + '声で話す</button><p class="caption">入力欄を開いて、キーボードのマイクで話してね。音声入力には通信が必要な場合があります（OS・端末の設定によります）。</p><button class="primary wide" id="fairy-send">たびのこに話す ✧</button><p id="fairy-error" role="alert"></p></form>'
      + '<button class="text-btn wide" data-route="plan">旅のしおりをひらく →</button><h2>これまで聞かせてくれた話</h2><div id="fairy-history">' + (list.length ? list.map(history).join('') : '<p class="caption">まだお話はないよ。短いひとことからでもうれしいな。</p>') + '</div></section>';
    const ta = $('#chat-text', root), send = $('#fairy-send', root), voice = $('#chat-voice', root), error = $('#fairy-error', root);
    ui.bindDraft(ta, 'hearing');
    // この画面からアプリ内の外部音声認識を開始しない。
    voice.onclick = () => { ta.focus(); ui.toast('キーボードのマイクで話してね。音声入力には通信が必要な場合があります（OS・端末の設定によります）。文字でも、ゆっくり聞かせてね。'); };
    $('#chat-form', root).onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      const text = ta.value.trim();
      if (!text) { error.textContent = '短いひとことでも大丈夫。聞かせたいことを書いてね。'; ta.focus(); return; }
      busy = true; send.disabled = true; ta.readOnly = true; voice.disabled = true; error.textContent = ''; send.textContent = '聞いているよ…';
      const answer = reply({ text }) + ' ' + question(text);
      try {
        const entry = await T.feedback.run(() => store.put('hearing', M.make('hearing', { id: U.uid(), text, date: U.todayISO(), source: 'fairy', fairyReply: answer })));
        if (store.draft('hearing').trim() === text) store.setDraft('hearing', '');
        bus.emit('hearing:added', { entry });
        if (!alive) return;
        ta.value = '';
        $('#fairy-answer', root).textContent = answer;
        $('#fairy-history', root).innerHTML = store.all('hearing').sort((a, b) => String(a.at || a.date).localeCompare(String(b.at || b.date))).map(history).join('');
      } catch (err) {
        if (alive) error.textContent = 'ごめんね、まだ保存できなかったよ。お話はここに残してあるから、もう一度試してね。';
      } finally {
        busy = false;
        if (alive) { send.disabled = false; ta.readOnly = false; voice.disabled = false; send.textContent = 'たびのこに話す ✧'; }
      }
    };
    return () => { alive = false; };
  }
  function history(c) {
    return '<article class="fairy-message"><p>' + esc(c.text) + '</p><small>' + esc(stamp(c)) + '</small>' + (c.fairyReply ? '<p class="fairy-history-reply">✧ たびのこ<br>' + esc(c.fairyReply) + '</p>' : '') + '</article>';
  }
  let slot = null, route = '', lastText = '';
  function companion() { if (slot) { slot.hidden = true; slot.innerHTML = ''; } }
  function say(text) {
    if (!text) return;
    // 長い返答は文書フローの相棒欄へ。固定通知で入力・保存操作を覆わない。
    lastText = text; companion();
  }
  T.register({
    id: 'fairy', title: '妖精', routes: ['fairy'], tab: { label: '妖精', icon: 'fairy', order: 50 },
    init() {
      slot = $('#slot-fairy'); companion();
      bus.handle('fairy:compose', compose);
      bus.on('fairy:say', (d) => { if (d) say(d.text, d.ttl); });
      bus.on('route:changed', (d) => { route = d.route; companion(); });
      bus.on('app:ready', () => { if (returning()) say(recap()); });
      bus.on('hearing:added', (d) => { if (d && d.entry && d.entry.source !== 'onboarding') say(d.entry.fairyReply || reply({ text: d.entry.text })); });
      bus.on('post:saved', (d) => { if (d && d.post) say(reply(Object.assign({}, d.post, { kind: 'record' }))); });
      bus.on('note:saved', (d) => { if (d && d.note) say(reply(Object.assign({}, d.note, { kind: 'record' }))); });
      bus.on('photo:added', (d) => { if (d && d.photo) say(reply(Object.assign({}, d.photo, { kind: 'record' }))); });
      bus.on('visit:added', (d) => { if (d && d.visit) say(reply(Object.assign({}, d.visit, { text: d.visit.title || '', kind: 'arrive' }))); });
      bus.on('day:changed', (d) => { if (d && d.day) say(reply({ text: U.dayLabel(d.day.date) + '、' + d.day.headline })); });
      bus.on('store:changed', (d) => { if (d.op === 'wipe' || d.op === 'import') { lastText = ''; companion(); } });
    },
    render: view,
  });
})();
