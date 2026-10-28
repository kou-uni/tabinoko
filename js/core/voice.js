/* キーボード音声入力への案内。アプリから音声認識サービスへ送信しない。 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});
  function guide(field) {
    if (field) field.focus(); // iOS のユーザー操作中に同期してキーボードを開く
    T.ui.toast('キーボードのマイクで話してね。見つからなければ、そのまま文字でも大丈夫。音声入力の通信は端末の設定によります。', 7000);
  }
  function attach(button, field) {
    const click = () => guide(field);
    button.addEventListener('click', click);
    return () => button.removeEventListener('click', click);
  }
  T.voice = { attach, guide, stop() {} };
})();
