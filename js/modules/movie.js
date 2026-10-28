/* Movie screen. Registration only; load movie-render.js before this file. */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, R = T.movieRender;
  function render(root, params) {
    let active = true, controller = null, result = null, url = null;
    const data = { trip: T.store.doc('trip') };
    ['days', 'posts', 'notes', 'photos', 'visits'].forEach(key => { data[key] = T.store.all(key); });
    const dates = [...new Set(['posts', 'notes', 'photos', 'visits'].flatMap(key => data[key].map(row => row.date).filter(Boolean)))].sort();
    const hd = R.hasHd(T.license);
    root.innerHTML = '<section class="movie-view">' + T.ui.heading('TRAVEL MOVIE', '旅を、ムービーに。')
      + '<button class="text-btn" data-route="recap">← 振り返りへ戻る</button>'
      + '<p>残した言葉と写真を、ひとつの動画にしよう。写真はこの端末だけで使うよ。</p>'
      + '<div class="movie-options card"><label for="movie-variant">書き方</label><select id="movie-variant"><option value="memory">思い出動画</option><option value="learning">学びの記録</option></select>'
      + '<label for="movie-date">まとめる日</label><select id="movie-date"><option value="">旅のすべて</option>'
      + dates.map(date => '<option value="' + U.esc(date) + '">' + U.esc(date) + '</option>').join('') + '</select>'
      + '<label for="movie-quality">画質</label><select id="movie-quality"><option value="simple">かんたん・無料</option><option value="hd"' + (hd ? '' : ' disabled') + '>高画質・友達に見せる' + (hd ? '' : '（おまとめ購入後）') + '</option></select>'
      + '<p class="caption">無料は540×960・小さな「たびのこ」入り。高画質は1080×1920・透かしなし、金のフレームで仕上げるよ。おまとめは1回300円。</p>'
      + (!hd ? '<p class="caption">高画質は、おまとめの利用権を確認できたら選べるよ。</p><button data-route="upgrade">おまとめ（高画質）を見る</button>' : '')
      + '<p class="caption">メモも動画に入るよ。人に見せる前に、内容を再生して確かめてね。字幕とやさしい環境音が入るよ。</p></div>'
      + '<p class="movie-summary"></p><button class="primary movie-create">ムービーを作る</button>'
      + '<button class="movie-cancel" hidden>中断する</button>'
      + '<div class="movie-progress" hidden><label for="movie-progress">動画のできあがり</label><progress id="movie-progress" max="1" value="0"></progress><span class="movie-percent">0%</span></div>'
      + '<p class="movie-status" role="status" aria-live="polite"></p>'
      + '<canvas class="movie-canvas" aria-label="作成中の動画" hidden></canvas>'
      + '<div class="movie-result" hidden><h2>できたよ。見返してみよう。</h2><video class="movie-preview" controls playsinline preload="metadata"></video>'
      + '<button class="movie-save">動画を保存・共有</button><a class="movie-download" download>動画ファイルを開く・保存</a>'
      + '<p class="caption">共有が使えるときは「ビデオを保存」や「ファイルに保存」を選んでね。使えないときは動画を開いて、長押しや共有メニューから保存してね。保存できたことを確かめてから、この画面を閉じよう。</p></div></section>';
    const find = selector => root.querySelector(selector), status = find('.movie-status');
    const variant = find('#movie-variant'), date = find('#movie-date'), quality = find('#movie-quality');
    const create = find('.movie-create'), cancel = find('.movie-cancel'), progress = find('#movie-progress');
    const canvas = find('.movie-canvas'), video = find('.movie-preview'), download = find('.movie-download');
    variant.value = params && params.variant === 'learning' ? 'learning' : 'memory';
    function composition() {
      const selected = { ...data };
      if (date.value) ['posts', 'notes', 'photos', 'visits'].forEach(key => { selected[key] = data[key].filter(row => row.date === date.value); });
      return R.compose(selected, variant.value);
    }
    function summary() {
      const composed = composition(), seconds = Math.ceil(R.timeline(composed.slides).duration);
      find('.movie-summary').textContent = composed.entryCount
        ? composed.chapterCount + '章・約' + seconds + '秒の動画になるよ。作成にも同じくらいの時間がかかるよ。'
        : 'ひとことや写真を残したら、ここで動画にしよう。';
      create.disabled = !composed.entryCount || !R.mimeType(window.MediaRecorder) || typeof canvas.captureStream !== 'function';
      if (!R.mimeType(window.MediaRecorder) || typeof canvas.captureStream !== 'function') status.textContent = 'このブラウザでは動画を作れないみたい。振り返りのアルバムはそのまま見られるよ。Safariなど、別の対応ブラウザで作るには記録の引っ越しが必要だよ。';
    }
    function clearResult() {
      video.pause(); video.removeAttribute('src'); video.load();
      if (url) URL.revokeObjectURL(url);
      url = null; result = null; download.removeAttribute('href'); find('.movie-result').hidden = true;
    }
    async function start() {
      if (controller || !active) return;
      const composed = composition();
      if (!composed.entryCount) return;
      clearResult();
      controller = new AbortController();
      [variant, date, quality, create].forEach(el => { el.disabled = true; });
      cancel.hidden = false; canvas.hidden = false; find('.movie-progress').hidden = false; progress.value = 0;
      find('.movie-percent').textContent = '0%';
      status.textContent = '思い出をつないでいるよ。この画面を開いたまま待っていてね。画面の自動ロックは、できる端末で止めているよ。';
      try {
        const output = await R.record({ canvas, composition: composed, store: T.store, quality: quality.value, license: T.license, signal: controller.signal,
          onProgress(value) {
            if (!active) return;
            progress.value = value; find('.movie-percent').textContent = Math.floor(value * 100) + '%';
          } });
        if (!active) return;
        result = output; url = URL.createObjectURL(output.blob);
        video.src = url; download.href = url; download.download = 'tabinoko-' + composed.variant + '.' + output.extension;
        find('.movie-result').hidden = false;
        status.textContent = output.missingPhotos
          ? 'できたよ。ただ、' + output.missingPhotos + '枚の写真を開けず、背景と言葉でつないだよ。再生して確かめてね。'
          : 'できたよ！ 再生してから、端末に保存してね。';
      } catch (error) {
        if (active) status.textContent = error.name === 'AbortError'
          ? '作成を止めたよ。残した記録はそのまま。画面を開いたまま、また作れるよ。'
          : (error.message && /[ぁ-んァ-ヶ]/.test(error.message) ? error.message : 'うまく動画にできなかったよ。かんたん画質か、日付を絞ってもう一度試してね。');
      } finally {
        controller = null;
        if (active) {
          [variant, date, quality].forEach(el => { el.disabled = false; });
          cancel.hidden = true; canvas.hidden = true;
          canvas.width = canvas.height = 1;
          summary();
        }
      }
    }
    async function save() {
      if (!result || !active) return;
      try {
        const file = new File([result.blob], download.download, { type: result.blob.type });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'たびのこ・旅のムービー' });
          if (active) status.textContent = '共有先で、保存できたことを確かめてね。';
        } else status.textContent = '「動画ファイルを開く・保存」を押してね。動画を長押しするか、共有メニューから保存できるよ。';
      } catch (error) {
        if (active) status.textContent = error.name === 'AbortError' ? '動画はここにあるよ。好きなときに保存してね。'
          : '共有を開けなかったよ。「動画ファイルを開く・保存」から試してね。';
      }
    }
    function stop() { if (controller) controller.abort(); }
    function background() { if (document.visibilityState === 'hidden') stop(); }
    create.addEventListener('click', start); cancel.addEventListener('click', stop);
    find('.movie-save').addEventListener('click', save);
    [variant, date, quality].forEach(el => el.addEventListener('change', summary));
    document.addEventListener('visibilitychange', background);
    window.addEventListener('pagehide', stop);
    summary();
    return () => {
      active = false; stop(); clearResult();
      document.removeEventListener('visibilitychange', background); window.removeEventListener('pagehide', stop);
      create.removeEventListener('click', start); cancel.removeEventListener('click', stop);
      find('.movie-save').removeEventListener('click', save);
      [variant, date, quality].forEach(el => el.removeEventListener('change', summary));
    };
  }
  T.register({ id: 'movie', title: '旅のムービー', routes: ['movie'], render });
})();
