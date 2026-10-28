/* boot.js — 起動順序。最後に読み込む。
 * store 準備 → 旅程シード同期 → 各モジュール init → ルーター開始。
 * どれかが失敗しても、ほかの画面は開けるようにする。 */
(function () {
  'use strict';
  const T = window.Tabi;
  async function boot() {
    await T.unlock.start();
    try { await T.store.ready; }
    catch (e) { document.getElementById('main').innerHTML = '<div class="card"><h2>保存領域を開けませんでした</h2><p class="caption">' + T.util.esc(e && e.message || e) + '</p></div>'; return; }
    T.ui.applyTheme(T.store.setting('uiTheme') || 'light');
    T.ui.mountSprite();
    try { await T.data.syncSeed(T.store); } catch (e) { console.error('[boot] syncSeed', e); }
    T.bus.on('store:error', (d) => T.ui.toast(d.message, 7000));
    window.addEventListener('online', () => T.bus.emit('app:online', {}));
    window.addEventListener('offline', () => T.bus.emit('app:offline', {}));
    if (T.store.degraded) T.ui.toast(T.store.degraded, 8000);
    await Promise.all(T.modules.map(async (m) => { try { if (m.init) await m.init(); } catch (e) { console.error('[boot] init failed: ' + m.id, e); } }));
    T.notebook.lastVisit = T.store.setting('lastNotebookVisit');
    T.gameUI.init();
    T.store.setSetting('lastNotebookVisit', T.util.iso()).catch(() => {});
    await T.router.start();
    T.bus.emit('app:ready', {});
    window.__tabiReady = true;
  }
  boot();
})();
