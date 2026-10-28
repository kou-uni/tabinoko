/* onboarding — F01 空港での聞き取り / F04 目的・相手の複数選択。
 * 聞き取りは hearing、途中の入力は drafts.hearing、選択は purposes に端末内保存。
 * 反応の生成は fairy:compose に任せる。welcome は聞き取り送信後も完了印まで再開可能。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store, M = T.model, bus = T.bus;
  const initialAnswer = () => store.all('hearing').find((r) => r.source === 'onboarding');
  const validIds = (ids, options) => options.filter((o) => Array.isArray(ids) && ids.includes(o.id)).map((o) => o.id);

  function view(root, firstRun, back) {
    let active = true, busy = false, answer = initialAnswer();
    let phase = firstRun && !answer ? 'hearing' : 'purposes';
    const current = store.doc('purposes');
    const selected = { purposeIds: validIds(current.purposeIds, M.PURPOSES), audienceIds: validIds(current.audienceIds, M.AUDIENCES) };
    const returnRoute = T.modules.some((m) => m.routes.includes(back)) && !['welcome', 'purposes'].includes(back) ? back : 'settings';
    const $ = (s) => root.querySelector(s);
    const status = (text) => { if (active) $('[data-status]').textContent = text; };
    const lock = (value) => {
      busy = value;
      if (!active) return;
      root.querySelectorAll('button, textarea').forEach((el) => { el.disabled = value; });
      $('[data-onboarding]').setAttribute('aria-busy', String(value));
    };
    const failure = (err) => status(err && err.quota
      ? '端末がいっぱいで、まだ残せなかったよ。空きを作って、もう一度試してね。'
      : 'まだ端末に残せなかったよ。画面の内容はそのまま。もう一度試してね。');
    const persistChoices = async () => {
      const doc = await store.setDoc('purposes', { purposeIds: selected.purposeIds.slice(), audienceIds: selected.audienceIds.slice() });
      bus.emit('purposes:changed', { purposeIds: doc.purposeIds, audienceIds: doc.audienceIds });
    };
    function group(key, options, title) {
      return '<fieldset class="onboarding-group"><legend>' + title + '</legend><div class="onboarding-options">'
        + options.map((o) => '<button type="button" class="onboarding-choice" data-choice="' + key + '" data-id="' + o.id + '" aria-pressed="' + selected[key].includes(o.id) + '"><span class="onboarding-check" aria-hidden="true">' + (selected[key].includes(o.id) ? '✓' : '＋') + '</span><span>' + esc(o.label) + '</span></button>').join('') + '</div></fieldset>';
    }
    function draw() {
      if (!active) return;
      const context = answer || store.all('hearing').slice(-1)[0];
      root.innerHTML = '<section class="onboarding" data-onboarding aria-busy="false"><button type="button" class="text-btn onboarding-sound" data-sound aria-pressed="' + !!store.setting('uiSound') + '">音：' + (store.setting('uiSound') ? 'オン' : 'オフ') + '</button><div class="onboarding-intro">' + ui.fairyAnimated('onboarding-fairy')
        + '<p class="onboarding-step">' + (firstRun ? (phase === 'hearing' ? '旅のはじまり · 1 / 2' : '思い出の残し方 · 2 / 2') : '思い出の残し方') + '</p>'
        + '<h1>' + (phase === 'hearing' ? 'どんな旅にしよう？' : 'だれに、何を残す？') + '</h1>'
        + '<p>' + (phase === 'hearing' ? 'ムンバイの旅のしおり。<br>旅で残したいことを、最初のメモに。' : '記録する目的と、届ける相手。<br>複数選択できます。後から変更できます。') + '</p></div>'
        + (phase === 'hearing'
          ? '<form data-hearing-form><label for="onboarding-text">旅の楽しみ、ひとことから</label><textarea id="onboarding-text" rows="4" maxlength="2000" aria-describedby="onboarding-input-help onboarding-private" placeholder="海沿いの夜景を、写真に残したい">' + esc(store.draft('hearing')) + '</textarea><p class="onboarding-help" id="onboarding-input-help">書きかけも残しておくね。声で入れるなら、入力欄を押してキーボードのマイクを使ってね。音声入力には通信が必要な場合があります（OS・端末の設定によります）。</p><p class="onboarding-help" id="onboarding-private">パスポート・ETA・予約番号は書かないでね。</p><button type="submit" class="primary wide" data-send>たびのこに話す</button></form>'
          : (context ? '<details class="onboarding-story"><summary>聞かせてくれた旅の話</summary><p>' + esc(context.text) + '</p></details>' : '<p class="onboarding-help">旅の話は、あとから妖精に聞かせてね。</p>')
            + '<p class="onboarding-reaction" data-reaction role="status">' + esc(context && context.fairyReply || '') + '</p>'
            + group('purposeIds', M.PURPOSES, 'どんなふうに残したい？（複数選べるよ）')
            + group('audienceIds', M.AUDIENCES, '誰に見せたい？（複数選べるよ）')
            + '<p class="onboarding-help">タップするたびに覚えておくね。もう一度押すと外せるよ。あとから選び直しても大丈夫。</p><button type="button" class="primary wide" data-finish>' + (firstRun ? 'この気持ちで、旅のしおりへ' : 'この気持ちを保存して戻る') + '</button>')
        + '<p class="onboarding-status" data-status role="status" aria-live="polite"></p><p class="onboarding-help">この画面の話と選択は、端末の中だけに残すよ。電波がなくても書けるよ。</p></section>';
    }
    draw();
    root.oninput = (e) => { if (active && !busy && e.target.id === 'onboarding-text') store.setDraft('hearing', e.target.value); };
    root.onsubmit = async (e) => {
      e.preventDefault();
      if (!active || busy || phase !== 'hearing' || e.isComposing) return;
      const ta = $('#onboarding-text'), text = ta.value.trim();
      if (!text) { status('ひとことでも聞けたらうれしいな。思いついたら書いてね。'); ta.focus(); return; }
      lock(true); status('保存中…');
      try {
        answer = await store.put('hearing', M.make('hearing', { id: U.uid(), text, date: U.todayISO(), source: 'onboarding' }));
        store.setDraft('hearing', '');
        bus.emit('hearing:added', { entry: answer });
        if (!active) return;
        phase = 'purposes'; draw();
        // 応答が無くても選択を続けられる。生成中に離れた場合は DOM を触らない。
        bus.request('fairy:compose', { kind: 'react', text }).then(async (reply) => {
          if (typeof reply !== 'string') return;
          // 初回の返答も会話の一部として残し、妖精画面で別の返答に変わらないようにする。
          answer = await store.patch('hearing', answer.id, { fairyReply: reply });
          if (active && phase === 'purposes' && typeof reply === 'string') $('[data-reaction]').textContent = reply;
        }).catch((err) => { if (active) failure(err); });
      } catch (err) { failure(err); }
      finally { lock(false); }
    };
    root.onclick = async (e) => {
      if (!active || busy) return;
      const sound = e.target.closest('[data-sound]');
      if (sound) { sound.disabled = true; try { await store.setSetting('uiSound', !store.setting('uiSound')); if (active) { sound.textContent = '音：' + (store.setting('uiSound') ? 'オン' : 'オフ'); sound.setAttribute('aria-pressed', String(!!store.setting('uiSound'))); } } catch (err) { failure(err); } finally { sound.disabled = false; } return; }
      const choice = e.target.closest('[data-choice]'), finish = e.target.closest('[data-finish]');
      if (!choice && !finish) return;
      lock(true); status('保存中…');
      try {
        if (choice) {
          const key = choice.dataset.choice, id = choice.dataset.id;
          const options = key === 'purposeIds' ? M.PURPOSES : key === 'audienceIds' ? M.AUDIENCES : [];
          if (!options.some((o) => o.id === id)) return;
          selected[key] = selected[key].includes(id) ? selected[key].filter((v) => v !== id) : [...selected[key], id];
          // フォーカスとスクロール位置を保つため画面全体は描き直さない。
          choice.setAttribute('aria-pressed', String(selected[key].includes(id)));
          choice.querySelector('.onboarding-check').textContent = selected[key].includes(id) ? '✓' : '＋';
          await persistChoices();
          status(T.saveUI.savedLabel());
        } else {
          // 保存に失敗した選択も、完了ボタンからまとめて再試行する。
          await persistChoices();
          if (!active) return;
          if (firstRun) await store.setSetting('onboardedAt', U.iso());
          if (active) T.router.go(firstRun ? 'plan' : returnRoute);
        }
      } catch (err) { failure(err); }
      finally { lock(false); }
    };
    const offError = bus.on('store:error', (err) => { if (!busy) failure(err); });
    return () => { active = false; offError(); root.onclick = null; root.oninput = null; root.onsubmit = null; };
  }

  T.register({
    id: 'onboarding', title: 'はじめに', routes: ['welcome', 'purposes'], firstRun: true, hideNav: ['welcome'],
    render(root, params, route) { return view(root, !store.setting('onboardedAt'), params && params.back); },
  });
})();
