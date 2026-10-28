(function () {
  'use strict';
  const T = window.Tabi;
  let serial = 0, audio = null;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Call immediately before a user operation and finish only after all rollback work.
  T.feedback = {
    begin() {
      const operationId = 'record-' + (++serial);
      T.bus.emit('record:operation-start', { operationId });
      let ended = false;
      return result => { if (!ended) { ended = true; T.bus.emit('record:operation-end', { operationId, result }); } };
    },
    async run(write) {
      const end = this.begin();
      try { const result = await write(); end('success'); return result; }
      catch (error) { end('error'); throw error; }
    },
    reward(achievement) {
      if (reduced()) return;
      if (T.store.setting('uiHaptics') && navigator.vibrate) { try { navigator.vibrate(achievement ? [8,30,12] : 12); } catch (_) {} }
      if (!T.store.setting('uiSound') || !audio || audio.state !== 'running') return;
      try {
        const start = audio.currentTime, duration = achievement ? .09 : .07;
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(achievement ? 440 : 660, start); oscillator.frequency.setValueAtTime(achievement ? 660 : 880, start + duration / 2);
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.025, start + .003); gain.gain.setValueAtTime(.025, start + duration - .02); gain.gain.linearRampToValueAtTime(0, start + duration);
        oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(start); oscillator.stop(start + duration);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      } catch (_) { /* Visual confirmation remains sufficient. */ }
    },
    init() {
      let recent = null;
      document.addEventListener('click', e => {
        const b = e.target.closest('button,[data-route]');
        if (!b || b.disabled) return;
        const key = b.id || JSON.stringify(b.dataset);
        if (!key) return;
        const now = Date.now();
        // 連続した同じ操作だけを二重クリックとする。別の案を選んで戻る操作は通す。
        if (recent && recent.key === key && now - recent.at < 300) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        recent = { key, at: now };
        if (T.store.setting('uiSound') && !reduced()) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          try { if (!audio && Audio) audio = new Audio(); if (audio && audio.state === 'suspended') audio.resume().catch(() => {}); } catch (_) {}
        }
      }, true);
    }
  };
})();
