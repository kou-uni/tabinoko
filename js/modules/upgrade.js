(function () {
  'use strict';
  const T = window.Tabi;
  T.register({
    id: 'upgrade', routes: ['upgrade', '/upgrade', 'checkout', '/checkout'], title: 'おまとめ',
    init() { return T.license.init(); },
    render(root, params, route) {
      let active = true, busy = false;
      if (route === 'checkout' || route === '/checkout') {
        root.innerHTML = '<section class="upgrade-panel card"><p class="eyebrow">おまとめ</p>'
          + '<h1>おまとめは、ただいま準備中</h1>' + T.ui.guide('希望を送っても、お支払いは発生しないよ')
          + '<p>高画質の動画と、友達に見せる専用テンプレート。1回300円（税込）を予定しているよ。</p>'
          + '<p>ここはダミー決済画面だよ。お支払いは発生せず、カードや個人情報の入力もないよ。送っても高画質はまだ使えないよ。</p>'
          + '<p class="caption">端末ごとに各段階1日1回まで記録するよ。集計先が設定されている場合は、匿名の希望回数を送るよ。写真やメモは送らないよ。</p>'
          + '<button class="primary upgrade-send">ほしい気持ちを送る</button>'
          + '<p class="upgrade-status" role="status" aria-live="polite"></p><button data-route="movie">無料のムービーを作る</button>'
          + '<button data-route="upgrade">おまとめに戻る</button></section>';
        const button = root.querySelector('.upgrade-send'), status = root.querySelector('.upgrade-status');
        const send = async () => {
          if (busy) return;
          busy = true; button.disabled = true;
          try {
            const counted = await T.tapCounter.record(2);
            if (active) status.textContent = counted ? 'ありがとう！ この端末に気持ちを残したよ。集計先が設定されていて、回線が使えれば届けるね。' : '今日の気持ちは、もう記録しているよ。ありがとう！';
          } catch (_) {
            if (active) { status.textContent = '保存できなかったよ。ブラウザの保存設定を確かめて、もう一度試してね。'; button.disabled = false; }
          } finally { busy = false; }
        };
        button.addEventListener('click', send);
        return () => { active = false; button.removeEventListener('click', send); };
      }
      root.innerHTML = '<section class="upgrade-panel card">' + T.ui.guide('おまとめの提供状況を、ここで確かめられるよ')
        + '<p class="eyebrow">旅の思い出を、おすそわけ</p><h1>高画質のおまとめ</h1>'
        + '<p>無料でも、一定の低画質で振り返り動画を作れるよ。</p>'
        + '<p>もっとくっきり、友達にも見せたいときに。</p>'
        + '<ul><li>高画質の動画</li><li>友達に見せる専用テンプレート</li><li>透かし無し</li></ul>'
        + '<p>「思い出動画」「学びの記録」のどちらも選べるよ。</p>'
        + '<p class="upgrade-price">300円 <span>（税込）／1回の「おまとめ」購入</span></p>'
        + '<p class="caption">毎月のお支払いはないよ。購入コードを入れると、この端末で何度でも作り直せるよ。</p>'
        + '<div class="upgrade-purchase"><button class="primary" type="button">おまとめの準備状況を見る</button></div>'
        + '<p class="caption">いまは購入の準備中。次の画面で、ほしい気持ちを聞かせてね。お支払いは発生しないよ。</p>'
        + '<form class="upgrade-form"><label for="upgrade-code">メールで届いたライセンスコード</label>'
        + '<textarea id="upgrade-code" maxlength="8192" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="TN1.…" required></textarea>'
        + '<button type="submit">コードを確認する</button></form>'
        + '<p class="upgrade-status" role="status" aria-live="polite"></p>'
        + '<p class="caption">コードは大切に保管してね。この端末の保存データを消したときは、もう一度貼り付けられるよ。</p>'
        + '<button data-route="recap">振り返りへ</button></section>';
      const form = root.querySelector('.upgrade-form');
      const status = root.querySelector('.upgrade-status');
      const submit = form.querySelector('button');
      const input = form.querySelector('textarea');
      T.license.getConfig().then(() => {
        if (!active) return;
        if (T.license.has('hd')) status.textContent = '高画質のおまとめが使えるよ。思い出を形にしよう。';
      });
      const purchase = root.querySelector('.upgrade-purchase button');
      const onPurchase = async () => {
        if (busy) return;
        busy = true; purchase.disabled = true;
        try { await T.tapCounter.record(1); }
        catch (_) { /* The preview remains available if storage is unavailable. */ }
        finally { busy = false; if (active) { purchase.disabled = false; T.router.go('checkout'); } }
      };
      purchase.addEventListener('click', onPurchase);
      const onSubmit = async event => {
        event.preventDefault();
        if (busy) return;
        busy = true; submit.disabled = true; status.textContent = 'コードを確かめているよ。';
        try {
          await T.license.redeem(input.value);
          if (!active) return;
          input.value = '';
          status.textContent = '受け取ったよ！ 高画質・専用テンプレート・透かし無しで作れるよ。';
        } catch (error) { if (active) status.textContent = error.message; }
        finally { busy = false; if (active) submit.disabled = false; }
      };
      form.addEventListener('submit', onSubmit);
      return () => { active = false; form.removeEventListener('submit', onSubmit); purchase.removeEventListener('click', onPurchase); };
    }
  });
})();
