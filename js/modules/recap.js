/* recap — F14: 端末内の日別アルバム、ムービー・おまとめへの入口。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store, bus = T.bus;

  function chapters(variant) {
    const rows = [], referenced = new Set();
    ['posts', 'notes'].forEach((coll) => store.all(coll).forEach((row) => {
      const photoIds = [...new Set(row.photoIds || [])];
      photoIds.forEach((id) => referenced.add(id));
      if (row.text || photoIds.length) rows.push(Object.assign({}, row, { photoIds, kind: coll }));
    }));
    store.all('photos').forEach((p) => {
      if (!referenced.has(p.id)) rows.push({ date: p.date, at: p.at, text: '', photoIds: [p.id], kind: 'photos' });
    });
    const rank = (r) => variant === 'learning'
      ? ((r.purposeIds || []).includes('learn') ? 0 : r.kind === 'notes' && r.text ? 1 : r.text ? 2 : 3)
      : (r.photoIds.length ? 0 : 1);
    rows.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || String(a.at).localeCompare(String(b.at)));
    const groups = new Map();
    rows.forEach((row) => {
      if (!groups.has(row.date)) groups.set(row.date, []);
      groups.get(row.date).push(row);
    });
    return [...groups].map(([date, entries]) => ({ date, entries }));
  }

  function render(root, params) {
    let variant = params && params.variant === 'learning' ? 'learning' : 'memory';
    let active = true, revision = 0;
    const alive = (version) => active && root.isConnected && version === revision;
    function paint() {
      const version = ++revision, groups = chapters(variant);
      root.innerHTML = '<div class="recap-view">' + ui.heading('', '旅の到達記録') + '<div data-game-summary>' + T.gameUI.summary() + '</div>'
        + '<button class="text-btn" data-route="timeline">← あしあとへ戻る</button>'
        + '<button class="primary" data-route="movie" data-params="' + esc(JSON.stringify({ variant })) + '">ムービーを作る</button>'
        + '<div class="recap-variants" role="group" aria-label="振り返りの見せ方">'
        + ['memory', 'learning'].map((v) => '<button data-recap-variant="' + v + '" aria-pressed="' + (variant === v) + '">' + (v === 'memory' ? '思い出' : '学びの記録') + '</button>').join('') + '</div>'
        + '<p class="recap-guide">' + (variant === 'memory' ? '写真から、あの日へ。下へめくって見返そう。' : '「学び」の目的で残した投稿、メモ、ほかの言葉の順に。あなたの言葉をそのまま見返そう。') + '</p>'
        + '<p class="caption">メモも含めて、この端末の中だけで見返せるよ。回線がなくても大丈夫。</p>'
        + '<div class="recap-greeting" aria-live="polite"></div>'
        + '<div class="recap-album">' + (groups.length ? groups.map((group, index) => {
          const day = T.data.day(group.date);
          return '<section class="recap-chapter" aria-labelledby="recap-day-' + index + '">'
            + '<header class="recap-chapter-head"><p class="recap-chapter-number">第' + (index + 1) + '章</p><h2 id="recap-day-' + index + '"><time datetime="' + esc(group.date) + '">' + esc(U.dayLabel(group.date)) + '</time></h2>'
            + (day && day.title ? '<p>' + esc(day.title) + '</p>' : '') + '</header>'
            + group.entries.map((entry) => {
              const images = entry.photoIds.map((id) => '<figure class="recap-photo"><img loading="lazy" decoding="async" data-photo-id="' + esc(id) + '" alt="' + esc(U.dayLabel(group.date)) + 'に残した旅の写真"></figure>').join('');
              const text = entry.text ? '<p class="recap-text">' + esc(entry.text) + '</p>' : '';
              return '<article class="recap-slide"><p class="recap-kind">' + (entry.kind === 'notes' ? '残したメモ' : entry.kind === 'photos' ? '旅の写真' : (entry.purposeIds || []).includes('learn') ? '学びの投稿' : '残した投稿') + '</p>'
                + (variant === 'learning' ? text + images : images + text) + '</article>';
            }).join('') + '</section>';
        }).join('') : '<section class="recap-empty"><h2>旅の記録 0</h2><p>メモ・写真を残す。</p><button data-route="post">最初のひとことを残す</button><button data-route="timeline">写真を残す</button></section>') + '</div>'
        + '<section class="recap-hd"><h2>友達に見せる高画質版</h2><p>おまとめは1回300円（税込）。高画質の動画と、友達に見せる専用テンプレートだよ。</p>'
        + '<button data-route="upgrade">おまとめを見る</button></section></div>';
      ui.hydratePhotos(root);
      bus.emit('recap:opened', { variant });
      // 妖精の応答でアルバムの初期表示を待たせない。共有 root は遷移後も接続されたまま。
      bus.request('fairy:compose', { kind: 'recap-open', variant, text: groups.flatMap((g) => g.entries).find((e) => e.text)?.text || '' }).then((line) => {
        if (!alive(version) || !line) return;
        const greeting = root.querySelector('.recap-greeting');
        if (greeting) greeting.innerHTML = ui.fairy('fairy-large') + '<p>' + esc(line) + '</p>';
      }).catch(() => {});
    }
    async function click(event) {
      const button = event.target.closest('button');
      if (!button || !root.contains(button) || !active) return;
      if (button.dataset.recapVariant) {
        if (variant === button.dataset.recapVariant) return;
        variant = button.dataset.recapVariant;
        paint();
        root.querySelector('[data-recap-variant="' + variant + '"]').focus();
      }
    }
    function photoError(event) {
      const img = event.target;
      if (img.tagName === 'IMG' && img.hasAttribute('data-photo-id')) {
        const message = document.createElement('p');
        message.className = 'recap-photo-error';
        message.textContent = 'この写真は開けなかったよ。残した言葉はそのまま見返せるよ。';
        img.replaceWith(message);
      }
    }
    root.addEventListener('click', click);
    root.addEventListener('error', photoError, true);
    paint();
    return () => { active = false; ++revision; root.removeEventListener('click', click); root.removeEventListener('error', photoError, true); };
  }
  T.register({ id: 'recap', title: '振り返り', routes: ['recap'], render });
})();
