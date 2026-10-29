/* 公開情報。設定は script の data-app-version / data-contact-email に置く。 */
(function () {
  'use strict';
  const T = window.Tabi, esc = T.util.esc;
  const script = document.currentScript;
  const config = script ? script.dataset : {};
  const version = (config.appVersion || '').trim() || '開発版';
  const contact = (config.contactEmail || '').trim();
  const emailOK = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(contact)
    && !/[{}]/.test(contact);
  // script の位置を基準にし、配信先のサブディレクトリに追従する。
  const legalBase = script && script.src ? new URL('../../legal/', script.src).href : 'legal/';
  T.register({
    id: 'about',
    title: 'たびのこについて',
    routes: ['about', '/about'],
    render(root) {
      root.innerHTML = '<div class="about-page">'
        + '<p class="eyebrow">ABOUT TABINOKO</p><h1>たびのこについて</h1>'
        + '<p>旅で見つけたこと、聞かせてね。小さな記録を、帰りの思い出に。</p>'
        + '<p class="about-version">バージョン：' + esc(version) + '</p>'
        + '<section class="card"><h2>データの置き場</h2><p>地図は OpenFreeMap（OpenStreetMap データ）です。表示するとき、表示範囲の地図データを OpenFreeMap から取得します。端末の現在地は取得せず、位置情報は送りません。表示範囲と IP アドレスなどの通信情報は提供元に伝わります。Google Maps はキーを設定した場合のみ、読込ボタンで接続します。WebGL 非対応時の代替地図は OpenStreetMap から取得します。取得済みの OpenFreeMap 地図は端末に一時保存します。設定から周辺のライト地図を事前保存できます。オフラインでは保存済み範囲と番号ピン・一覧を使えます。地図の保存には上限があり、端末による消去もあります。</p>'
        + '<p>投稿・メモ・写真・タイムラインは、この端末のブラウザ内（IndexedDB）に保存します。使えない場合は localStorage に退避します。写真・メモを当方のサーバーへ送りません。動画も端末内で作ります。</p>'
        + '<p>購入意向の匿名の回数のみ送信する場合があります（個人は特定しません）。送るのは購入ボタン・希望送信の段階、アプリのバージョン、日時のみです。端末ID・写真・メモは送りません。現在の購入画面はダミーで、お支払い・カード入力はありません。</p>'
        + '<p>旅程を共有する場合、公開されるのは暗号化済みの旅程のみです。共有リンクを受け取った人は旅程を読めるので、渡す相手を確かめてね。</p>'
        + '<p>端末やブラウザを変えても自動では引き継がれません。ブラウザのデータ消去や端末故障に備えて、書き出しを残しておこう。</p>'
        + '<h3>写真ごと、手元に残すには</h3>'
        + '<ol><li>「設定とバックアップ」を開く。</li><li>「書き出す（写真つき）」を押し、保存先を選ぶ。</li><li>JSON ファイルが保存されたことを確認する。</li></ol>'
        + '<p>引っ越し先では「バックアップを読み込む」で記録を戻せます。書き出し先や共有先に選んだクラウド・アプリには記録が渡ります。保管先を確かめてね。</p>'
        + '<button class="primary" data-route="settings">設定とバックアップを開く</button></section>'
        + '<section class="card"><h2>利用と購入の約束</h2><nav class="about-links" aria-label="公開情報">'
        + '<a href="' + esc(legalBase + 'terms.html') + '">利用規約</a>'
        + '<a href="' + esc(legalBase + 'privacy.html') + '">プライバシーポリシー</a>'
        + '<a href="' + esc(legalBase + 'tokushoho.html') + '">特定商取引法に基づく表記</a></nav></section>'
        + '<section class="card"><h2>お問い合わせ</h2>'
        + (emailOK ? '<a class="about-contact" href="mailto:' + esc(encodeURIComponent(contact)) + '">メールで問い合わせる</a>'
          : '<p>お問い合わせ窓口は準備中です。</p>')
        + '<p>困った画面と端末・ブラウザの種類を教えてね。カード番号や、旅の写真・メモの原本を送る必要はありません。</p></section></div>';
    }
  });
})();
