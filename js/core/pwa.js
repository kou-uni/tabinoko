/* PWA の準備状態。更新は全タブを閉じた後に適用し、入力中に再読込しない。 */
(function () {
  'use strict';
  const T = window.Tabi;
  const state = T.pwa = { status: 'unavailable', updateWaiting: false };
  const publish = () => T.bus.emit('pwa:changed', Object.assign({}, state));
  if (!('serviceWorker' in navigator)) return;
  if (T.util.param('nosw') !== null) { state.status = 'disabled'; return; }
  if (!(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) return;
  state.status = 'preparing';
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const sync = () => {
        state.status = navigator.serviceWorker.controller ? 'ready' : 'preparing';
        state.updateWaiting = !!reg.waiting; publish();
      };
      navigator.serviceWorker.addEventListener('controllerchange', sync);
      const watch = () => { const worker = reg.installing; if (worker) worker.addEventListener('statechange', () => {
        if (worker.state === 'redundant' && !navigator.serviceWorker.controller) state.status = 'error';
        else sync();
        publish();
      }); };
      reg.addEventListener('updatefound', watch); watch(); sync();
      navigator.serviceWorker.ready.then(sync);
    } catch (e) { state.status = 'error'; publish(); }
  });
})();
