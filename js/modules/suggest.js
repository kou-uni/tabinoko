/* suggest — F06。端末の予定 × 目的から、その日に残したい場面を選ぶ。
 * suggest:today は表示用の生文字列を返す。利用側で必ず escape する。
 * #suggest?date=YYYY-MM-DD で切り口を補正し、投稿画面へ渡す。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, M = T.model, bus = T.bus;
  const esc = U.esc;
  // 補正はこの起動中だけ保持。目的・予定が変わったら新しい提案として扱う。
  const edits = new Map();
  const scenes = {
    flight: ['搭乗前の待ち時間に', '出発を待つあいだに見つけた、小さな旅の始まり'],
    move: ['移動が終わって、ひと息ついたら', '道中で出会った、思いがけない景色'],
    stay: ['宿でひと息ついたら', '今日いちばん心に残った瞬間'],
    sight: ['見終えて、ひと息ついたら', '実際に見て初めて気づいたこと'],
    event: ['会場で休憩するときに', '人や話との出会いで心が動いたこと'],
    meal: ['食後にひと息ついたら', '初めての味や香りへの驚き'],
    free: ['心が動いたときに', '寄り道で見つけた小さな発見'],
  };
  const purposeRules = {
    learn: ['surprise', '予想と違ったことと、そこから学んだこと', '学びを残したい気持ちに、この場面の発見が合いそうだから。'],
    feel: ['moved', '心が動いた瞬間と、そのときの気持ち', '感動を残しておくと、あとでこの瞬間に戻れそうだから。'],
    share: ['surprise', '来てみて初めてわかったこと', '実際に体験した一コマなら、旅の空気が伝わりそうだから。'],
    useful: ['useful', '実際に試してわかった、次に来る人へのヒント', '体験したことが、誰かの旅の小さな助けになりそうだから。'],
    cheer: ['moved', '今日うれしかったことを、ひとつおすそわけ', '見守ってくれる人も、一緒に旅を喜べそうだから。'],
  };
  function dateOf(req) {
    const d = req && (req.date || req.day);
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : U.todayISO();
  }
  function today(req) {
    const date = dateOf(req), day = T.data.day(date);
    const prefs = T.store.doc('purposes') || {};
    const purposes = Array.isArray(prefs.purposeIds) ? prefs.purposeIds.filter((p) => purposeRules[p]) : [];
    const audience = Array.isArray(prefs.audienceIds) ? prefs.audienceIds : [];
    const items = day && Array.isArray(day.items) ? day.items.filter((x) => x && typeof x.title === 'string' && x.title.trim()) : [];
    // 古い seed の会場は sight。日付固定にせず、その日の明示的なハック文脈を読む。
    const hackDay = day && /ETHGlobal|ハッカソン|ハック/i.test((day.title || '') + ' ' + (day.headline || ''));
    const isHack = (x) => /ETHGlobal|ハッカソン|ハック/i.test(x.title) || (hackDay && (x.kind === 'event' || x.spotId === 'bkc'));
    const chosen = items.slice(0, 3);
    const hack = items.find(isHack);
    if (hack && !chosen.includes(hack)) chosen[chosen.length - 1] = hack;
    if (!chosen.length) chosen.push({ id: 'free', title: '', kind: 'free' });
    return chosen.map((item, i) => {
      const kind = isHack(item) ? 'event' : (scenes[item.kind] ? item.kind : 'free');
      const scene = scenes[kind], purpose = purposes[i % purposes.length];
      const rule = purposeRules[purpose];
      const finalist = isHack(item);
      let angle = finalist ? 'finalist' : rule ? rule[0] : 'surprise';
      const id = date + ':' + (item.id || i);
      const key = JSON.stringify([id, item, purposes, audience, finalist]);
      angle = edits.get(key) || angle;
      const focus = angle === 'finalist' ? 'ファイナリストとして参加して、挑戦から感じたこと'
        : angle === 'brag' ? '自分でうれしかった一歩と、支えてくれた人への気持ち'
        : angle === 'useful' ? '実際に試してわかった、次に来る人へのヒント'
        : angle === 'moved' ? '心が動いた瞬間と、そのときの気持ち'
        : rule && rule[0] === 'surprise' ? rule[1] : scene[1];
      const name = item.title ? '「' + item.title + '」で、' : '';
      const forSelf = audience.length === 1 && audience[0] === 'self';
      return {
        id, angle, when: (item.time ? item.time + ' · ' : '') + scene[0],
        text: name + focus + 'を一言残してみない？' + (forSelf ? '自分だけの思い出でもいいんだよ。' : '一緒に思い出にできたらうれしいな。'),
        reason: finalist ? 'これまでの挑戦からつながる出会いを、今の気持ちと残せそうだから。' : rule ? rule[2] : '小さな驚きが、あとで旅を思い出すきっかけになりそうだから。',
        spotId: item.spotId || null, key,
      };
    });
  }
  T.register({
    id: 'suggest', routes: ['suggest'], title: '今日の投稿提案',
    init() { bus.handle('suggest:today', (req) => today(req).map(({ key, ...suggestion }) => suggestion)); },
    render(root, params) {
      const date = dateOf(params);
      let list = [];
      function draw() {
        try {
          list = today({ date });
          const day = T.data.day(date);
          root.innerHTML = '<section class="suggest-page"><h1>今日、どんな思い出にしよう？</h1><p>' + esc(U.dayLabel(date)) + ' · 朝のひと息に、気になる場面を選んでね。あとから変えても大丈夫。</p>'
            + (!day || !Array.isArray(day.items) || !day.items.length ? '<p class="suggest-empty">予定はまだ空っぽ。自由な一日、どんな発見に会えるかな。</p>' : '')
            + '<p class="caption">回線がなくても提案は見られるよ。投稿せず、手元に残してもいいんだよ。</p>'
            + list.map((s, i) => '<article class="card suggest-card"><h2>' + esc(s.when) + '</h2><p id="suggest-text-' + i + '">' + esc(s.text) + '</p><p class="suggest-reason">' + esc(s.reason) + '</p><label for="suggest-angle-' + i + '">この場面の切り口</label><select id="suggest-angle-' + i + '" data-suggest-angle="' + i + '" aria-describedby="suggest-text-' + i + '">' + M.ANGLES.map((a) => '<option value="' + esc(a.id) + '"' + (a.id === s.angle ? ' selected' : '') + '>' + esc(a.label) + '</option>').join('') + '</select><button class="primary wide" data-suggest-post="' + i + '">この切り口で書いてみる</button></article>').join('')
            + '<p class="caption">切り口の変更は、アプリを開いているあいだ覚えているよ。</p><button class="wide" data-route="plan" data-params="' + esc(JSON.stringify({ day: date })) + '">しおりへ戻る</button></section>';
        } catch (err) {
          list = [];
          root.innerHTML = '<section class="suggest-page"><h1>提案を開けなかったよ</h1><p role="status">もう一度、今日の場面を一緒に探してみよう。</p><button data-suggest-retry>もう一度開く</button><button data-route="plan">しおりへ戻る</button></section>';
        }
      }
      const change = (e) => {
        const index = e.target.dataset.suggestAngle;
        const s = index !== undefined && list[Number(index)];
        if (!s || !M.ANGLES.some((a) => a.id === e.target.value)) return;
        edits.set(s.key, e.target.value);
        // select を描き直さず、Safari のフォーカスを保つ。
        list = today({ date });
        root.querySelector('#suggest-text-' + index).textContent = list[Number(index)].text;
      };
      const click = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-suggest-retry')) { draw(); return; }
        const s = b.dataset.suggestPost !== undefined && list[Number(b.dataset.suggestPost)];
        if (s) T.router.go('post', { angle: s.angle, spot: s.spotId || '', date });
      };
      draw();
      root.addEventListener('change', change); root.addEventListener('click', click);
      const off = bus.on('store:changed', (e) => {
        if (e.coll === 'days' || (e.op === 'doc' && e.id === 'purposes') || e.op === 'import' || e.op === 'wipe') draw();
      });
      return () => { off(); root.removeEventListener('change', change); root.removeEventListener('click', click); };
    },
  });
})();
