(function () {
  'use strict';
  const T = window.Tabi;
  let serial = 0, audio = null;
  const systemReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduced = () => T.store.setting('uiMotion') === false || systemReduced();
  let lastButton = null, rewardButton = null, lastTone = -Infinity;
  const voices = new Set();
  const muted = () => document.visibilityState === 'hidden' || document.body.classList.contains('sealed') || !!document.querySelector('.movie-cancel:not([hidden])') || [...document.querySelectorAll('video')].some(v => !v.paused && !v.ended);
  const haptic = value => { if (!systemReduced() && !muted() && T.store.setting('uiHaptics') && navigator.vibrate) { try { navigator.vibrate(value); } catch (_) {} } };
  function tone(kind) {
    if (systemReduced() || muted() || !T.store.setting('uiSound') || !audio || audio.state !== 'running') return;
    const now = audio.currentTime;
    if (kind === 'tap' && now - lastTone < .15) return;
    // 結果音は操作音を置換。同時2声、合計gain .025以下。
    for (const voice of voices) { try { voice.stop(); } catch (_) {} } voices.clear();
    lastTone = now;
    try {
      const pitches = kind === 'achievement' ? [[880,880,0,.09,.01],[1320,1320,.055,.09,.01]] : kind === 'save' ? [[520,720,0,.08,.02]] : [[240,150,0,.065,.012]];
      pitches.forEach(([from,to,delay,duration,volume]) => {
        const oscillator = audio.createOscillator(), gain = audio.createGain(), start = now + delay;
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(from, start); oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + .004); gain.gain.linearRampToValueAtTime(0, start + duration);
        oscillator.connect(gain); gain.connect(audio.destination); voices.add(oscillator); oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); }; oscillator.start(start); oscillator.stop(start + duration);
      });
    } catch (_) {}
  }
  // Observe actual persistence, including settings and operations outside record feedback.
  T.saveUI = {
    state: { phase: 'saved', pending: 0, failed: false },
    savedLabel() { return T.notebook.saveLabel({ phase: 'saved' }, T.store.backendName, T.store.degraded); },
    label() { return T.notebook.saveLabel(this.state, T.store.backendName, T.store.degraded); },
    paint() { const el = document.getElementById('hud-storage'); if (el) { el.textContent = this.label(); el.setAttribute('aria-busy', String(this.state.pending > 0)); } },
    init() {
      if (this.ready) return; this.ready = true;
      const wrap = (owner, name) => {
        const write = owner[name];
        owner[name] = async (...args) => {
          this.state = T.notebook.transition(this.state, 'start'); this.paint();
          try { const result = await write.apply(owner, args); this.state = T.notebook.transition(this.state, 'success'); return result; }
          catch (error) { this.state = T.notebook.transition(this.state, 'error'); throw error; }
          finally { this.paint(); }
        };
      };
      ['put', 'remove', 'setDoc', 'importAll', 'flushDrafts'].forEach(name => wrap(T.store, name));
      wrap(T.store.photos, 'put');
    }
  };
  // Call immediately before a user operation and finish only after all rollback work.
  T.feedback = {
    begin() {
      const operationId = 'record-' + (++serial), anchor = lastButton;
      T.saveUI.state = T.notebook.transition(T.saveUI.state, 'start'); T.saveUI.paint();
      T.bus.emit('record:operation-start', { operationId });
      let ended = false;
      return result => { if (!ended) { ended = true; T.saveUI.state = T.notebook.transition(T.saveUI.state, result === 'success' ? 'success' : 'error'); T.saveUI.paint(); rewardButton = anchor; try { T.bus.emit('record:operation-end', { operationId, result }); } finally { rewardButton = null; } } };
    },
    async run(write) {
      const end = this.begin();
      try { const result = await write(); end('success'); return result; }
      catch (error) { end('error'); throw error; }
    },
    reward(achievement) {
      if (muted()) return;
      haptic(achievement ? [8,30,10] : 10);
      tone(achievement ? 'achievement' : 'save');
      if (reduced()) return;
      const fairy = document.querySelector('#main .fairy-animated');
      if (fairy) { fairy.classList.remove('fairy-saved'); void fairy.getBoundingClientRect(); fairy.classList.add('fairy-saved'); setTimeout(() => fairy.classList.remove('fairy-saved'), 360); }
      if (rewardButton && rewardButton.isConnected) {
        const box = rewardButton.getBoundingClientRect();
        if (box.top < 0 || box.bottom > window.innerHeight) return;
        for (let i = 0; i < 6; i++) { const dot = document.createElement('i'), angle = i * Math.PI / 3; dot.className = 'save-spark'; dot.setAttribute('aria-hidden', 'true'); dot.style.left = (box.left + box.width / 2 + Math.cos(angle) * 8) + 'px'; dot.style.top = (box.top + Math.min(20, box.height / 2) + Math.sin(angle) * 8) + 'px'; dot.style.setProperty('--spark-x', Math.cos(angle) * 28 + 'px'); dot.style.setProperty('--spark-y', Math.sin(angle) * 28 + 'px'); document.body.append(dot); setTimeout(() => dot.remove(), 420); }
      }
    },
    quiet() { for (const voice of voices) { try { voice.stop(); } catch (_) {} } voices.clear(); },
    init() {
      T.saveUI.init();
      const expressions = () => {
        document.documentElement.dataset.fairy = T.store.setting('uiFairy') === false ? 'hidden' : 'visible';
        document.documentElement.dataset.motion = T.store.setting('uiMotion') === false ? 'off' : 'on';
      };
      expressions(); T.bus.on('settings:changed', expressions);
      let recent = null, pressed = null, origin = null;
      const release = cancel => { if (!pressed) return; const b = pressed; pressed = null; b.classList.remove('is-pressed'); const clean = () => { if (pressed === b) return; b.classList.remove('is-released','press-ready'); b.querySelector('.press-face')?.remove(); }; if (!cancel) { b.classList.add('is-released'); setTimeout(clean, 220); } else clean(); };
      const press = b => {
        release(true); if (!b || b.disabled || reduced()) return;
        pressed = b;
        if (!b.closest('nav') && !b.matches('.text-btn,[aria-pressed],[role="tab"],.mission-row')) {
          if (!b.querySelector('.press-face')) { const face = document.createElement('span'); face.className = 'press-face'; face.setAttribute('aria-hidden', 'true'); b.prepend(face); } b.classList.add('press-ready');
        }
        b.classList.remove('is-released'); b.classList.add('is-pressed');
      };
      document.addEventListener('pointerdown', e => { if (e.button !== 0) return; origin = { x:e.clientX, y:e.clientY }; press(e.target.closest('button')); }, { passive:true });
      document.addEventListener('keydown', e => { if (!e.repeat && (e.key === 'Enter' || e.key === ' ')) press(e.target.closest('button')); });
      document.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') release(false); });
      document.addEventListener('pointerup', () => release(false), { passive:true });
      document.addEventListener('pointercancel', () => release(true), { passive:true });
      document.addEventListener('pointermove', e => { if (pressed && origin && Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>8) release(true); }, { passive:true });
      document.addEventListener('scroll', () => release(true), { passive:true, capture:true });
      window.addEventListener('blur', () => release(true));
      document.addEventListener('focusin', e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) document.querySelectorAll('.fairy-working').forEach(f => f.classList.remove('fairy-working')); });
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (motion.addEventListener) motion.addEventListener('change', () => { if (motion.matches) { release(true); T.feedback.quiet(); } });
      document.addEventListener('play', () => T.feedback.quiet(), true);
      const seen = new Set();
      T.bus.on('route:changed', ({route}) => {
        release(true); lastButton = null;

        if (!seen.has(route) && !reduced()) { seen.add(route); [...document.querySelectorAll('#main .plan-stop,#main .map-spot,#main .timeline-entry')].filter(el => el.getBoundingClientRect().top < window.innerHeight).slice(0,6).forEach((el,i) => { el.style.setProperty('--stagger', i*24+'ms'); el.classList.add('cute-stagger'); setTimeout(() => el.classList.remove('cute-stagger'), 300); }); }
      });
      document.addEventListener('click', e => {
        const b = e.target.closest('button,[data-route]');
        if (!b || b.disabled || document.body.classList.contains('sealed')) return;
        const key = b.id || (Object.keys(b.dataset).length ? JSON.stringify(b.dataset) : b);
        if (!key) return;
        const now = Date.now();
        // 連続した同じ操作だけを二重クリックとする。別の案を選んで戻る操作は通す。
        if (recent && recent.key === key && now - recent.at < 300) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        recent = { key, at: now }; lastButton = b;
        haptic(6);
        if (T.store.setting('uiSound') && !systemReduced()) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          try { if (!audio && Audio) audio = new Audio(); if (audio && audio.state === 'suspended') audio.resume().catch(() => {}); } catch (_) {}
        }
        tone('tap');
      }, true);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { release(true); for (const voice of voices) { try { voice.stop(); } catch (_) {} } voices.clear(); } });
    }
  };
})();
