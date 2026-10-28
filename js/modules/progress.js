/* Shared HUD; intentionally adds no route or module registration. */
(function () {
  'use strict';
  const T = window.Tabi, esc = T.util.esc;
  const missing = new Set(), pending = new Map(), celebrated = new Set();
  let lastDay, baseline, before, beforeRoute, failed = false, ready = false, timer, rewardTimer, frame = null, effect = 0;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const marks = ['M4 4h12l4 4v12H4z M7 16l4-5 3 3 3-2', 'M3 6V3h13 M5 9V6h14 M8 9h13v12H8z M12 12h5v3h-5v3h5', 'M3 3h14l4 4v14H3z M7 9h10 M7 14h7', 'M4 3h11l5 5v13H4z M15 3v6h5 M8 12h8 M8 16h8', 'M12 3v18 M8 9h8v6H8z', 'M3 18l8-12 10 12 M2 16h4v4H2z M9 3h4v4H9z M18 16h4v4h-4z', 'M5 4v14 M12 4v14 M19 4v14 M3 18h18', 'M3 12h18 M3 8v8 M9 8v8 M15 8v8 M21 8v8', 'M12 3H4v18h16V7l-4-4z M12 3v18 M4 9h8 M4 15h8'];
  function read() { return T.progress.calculate(Object.assign({ trip: T.store.doc('trip'), missingPhotoIds: [...missing] }, Object.fromEntries(['photos','notes','hearing','posts','visits'].map(c => [c, T.store.all(c)]))), T.util.todayISO()); }
  function phase(g) {
    const trip = T.store.doc('trip'), today = T.util.todayISO();
    if (!g.period) return '旅程を確認';
    return today < trip.start ? '出発前' : today > trip.end ? '旅程終了' : '旅の' + (g.days.findIndex(d => d.date === today) + 1) + '日目';
  }
  function paint(g) {
    const slot = document.getElementById('slot-hud'); if (!slot) return;
    const state = pending.size ? '保存中…' : T.saveUI.label();
    if (!slot.dataset.built) {
      slot.dataset.built = '1';
      slot.innerHTML = '<span id="hud-phase"></span><button data-progress-details id="hud-level"><span id="hud-level-value"></span> <strong id="hud-xp" aria-hidden="true" hidden></strong></button><button data-route="settings" class="hud-storage" id="hud-storage"></button>';
    }
    document.getElementById('hud-phase').textContent = phase(g);
    document.getElementById('hud-level-value').textContent = '記録 ' + g.recordedDays + '日';
    document.getElementById('hud-xp').textContent = g.xp;
    document.getElementById('hud-level').setAttribute('aria-label', 'レベル' + g.level + '、合計' + g.xp + 'XP。集計を開く');
    document.getElementById('hud-storage').textContent = state;
    document.querySelectorAll('[data-game-summary]').forEach(el => { el.innerHTML = summary(g); });
    document.querySelectorAll('[data-missions-date]').forEach(el => { el.innerHTML = missionBody(el.dataset.missionsDate, g); });
  }
  function summary(g = read()) {
    return '<section class="progress-summary"><p class="state-label">保存記録による集計</p><h2>' + esc(g.rank) + '</h2><div class="progress-total"><strong>' + g.xp + '</strong> XP <span>Lv.' + g.level + '</span></div><progress max="100" value="' + (g.xp % 100) + '" aria-label="次のレベルへの進捗"></progress><p>記録 ' + g.recordedDays + ' / ' + g.days.length + '日。休んでも記録は減りません。</p><p class="caption">写真 ' + g.totals.photos + '枚 ／ メモ・会話 ' + g.totals.notes + '件 ／ 文案 ' + g.totals.posts + '件 ／ 訪問 ' + g.totals.visits + '地点<br>次のレベルまで ' + g.remaining + ' XP</p><button class="text-btn" data-progress-details>集計の内訳・実績</button></section>';
  }
  function missionBody(date, g = read()) {
    const day = g.days.find(d => d.date === date), today = T.util.todayISO();
    const title = !day ? '今日の記録' : date > today ? '予定' : date === today ? '今日の3つ' : 'この日の3つ';
    return '<div class="section-label"><h2>' + title + '</h2><span>' + (day ? day.missions.filter(Boolean).length : 0) + ' / 3</span></div>' + ['写真を1枚残す','ひとこと残す','文案を1つ保存'].map((label,i) => '<button class="mission-row" data-route="' + ['timeline','notes','post'][i] + '" data-params="' + esc(JSON.stringify({ date, ...(i === 0 ? { add: 'photo' } : {}) })) + '"><span class="mission-check">' + (day && day.missions[i] ? '✓' : '') + '</span><span>' + T.notebook.mission(i, !!(day && day.missions[i])) + '</span><small>' + [10,10,20][i] + ' XP</small></button>').join('') + '<p class="caption">各日、最初の写真・ひとこと・文案に上記XP。同じ日の追加や連打では増えません。3種類を保存で +20 XP。文案は外部投稿不要。' + (!day ? '旅XPは旅程期間内の記録で集計。' : date > today ? '未来日の記録は当日に集計。' : '') + '</p>';
  }
  function details() {
    const g = read();
    T.ui.dialog({ title: '旅の集計と実績', body: summary(g).replace('<button class="text-btn" data-progress-details>集計の内訳・実績</button>', '') + '<p class="caption">旅程内・今日までの記録。各日、写真10＋メモ・会話10＋文案20＋訪問10＋3つ完了20。1日最大70XP。非表示の記録も数え、同じ写真・地点は重複しない。ランクは25%・55%・80%で更新。全旅程 ' + g.days.length * 70 + ' XPを分母に算出。</p><div class="achievement-list">' + g.achievements.map((a,i) => '<div class="achievement ' + (a.earned ? 'earned' : '') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + marks[i] + '"/></svg><div><strong>' + a.label + '</strong><small>' + (a.earned ? '達成 · ' : '未達成 · ') + a.condition + '</small></div></div>').join('') + '</div><details><summary>日ごとのXP</summary>' + g.days.map(d => '<p>' + esc(d.date) + ' · ' + d.xp + ' XP（写真' + d.P + '／メモ' + d.N + '／文案' + d.C + '／訪問' + d.V + '）</p>').join('') + '</details>' });
  }
  function update() { if (!ready || pending.size) return; effect++; baseline = read(); paint(baseline); const today = T.util.todayISO(); if (lastDay !== today) { lastDay = today; T.bus.emit('calendar:changed', { date: today }); } }
  function midnight() { clearTimeout(timer); const n = new Date(); const end = new Date(n); end.setHours(24,0,0,20); timer = setTimeout(() => { update(); midnight(); }, end - n); }
  T.gameUI = { read, summary, missions: date => '<section data-missions-date="' + esc(date) + '">' + missionBody(date) + '</section>', missingPhoto(id) { missing.add(id); update(); }, init() {
    if (ready) return;
    ready = true; lastDay = T.util.todayISO(); baseline = read(); paint(baseline); midnight(); T.feedback.init();
    document.addEventListener('click', e => { if (e.target.closest('[data-progress-details]')) details(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { update(); midnight(); } });
    T.bus.on('record:operation-start', ({ operationId }) => { if (pending.has(operationId)) return; if (!pending.size) { effect++; before = baseline; beforeRoute = T.router.current.route; failed = false; } pending.set(operationId, true); paint(baseline); });
    T.bus.on('record:operation-end', ({ operationId, result }) => {
      if (!pending.delete(operationId)) return;
      failed ||= result !== 'success'; if (pending.size) return;
      const after = read(), delta = after.xp - before.xp;
      const fresh = after.achievements.filter(a => a.earned && !before.achievements.find(b => b.id === a.id).earned && !celebrated.has(a.id));
      baseline = after; paint(after);
      if (failed || delta <= 0) { if (!failed && delta === 0 && beforeRoute === T.router.current.route) T.feedback.reward(false); if (delta < 0) T.ui.toast('記録に合わせて集計を更新'); return; }
      fresh.forEach(a => celebrated.add(a.id));
      T.feedback.reward(fresh.length > 0);
      // The form owns the spoken save status; the notebook margin shows factual growth.
      const band = document.getElementById('reward-band'); if (!band) return;
      clearTimeout(rewardTimer);
      band.innerHTML = esc(T.notebook.achievement(before.totals, after.totals) + '（+' + delta + ' XP）');
      band.removeAttribute('aria-label');
      rewardTimer = setTimeout(() => { band.innerHTML = ''; }, 2400);
    });
    T.bus.on('store:changed', d => { if (['photos','notes','hearing','posts','visits','trip','*'].includes(d.coll)) { if (d.op === 'import' || d.op === 'wipe') { missing.clear(); failed = true; } update(); } });
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.addEventListener) motion.addEventListener('change', () => { effect++; if (frame && window.cancelAnimationFrame) cancelAnimationFrame(frame); paint(baseline); });
    T.bus.on('seed:updated', update);
    T.bus.on('route:changed', () => { effect++; paint(baseline); });
  } };
})();
