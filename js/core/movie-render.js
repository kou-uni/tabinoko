/* Local-only movie composition and Canvas/MediaRecorder exporter. */
(function (host) {
  'use strict';
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const PRESETS = {
    simple: Object.freeze({ id: 'simple', label: 'かんたん', width: 540, height: 960, bitrate: 1200000, watermark: true, template: 'standard' }),
    hd: Object.freeze({ id: 'hd', label: '高画質', width: 1080, height: 1920, bitrate: 6500000, watermark: false, template: 'friends' }),
  };
  function preset(requested, licensed) { return PRESETS[requested === 'hd' && licensed === true ? 'hd' : 'simple']; }
  function hasHd(license) {
    try { return !!license && typeof license.has === 'function' && license.has('hd') === true; }
    catch (_) { return false; }
  }
  function splitText(text, size) {
    const chars = Array.from(String(text || '').trim().replace(/\s+/g, ' ')), parts = [];
    for (let i = 0; i < chars.length; i += size) parts.push(chars.slice(i, i + size).join(''));
    return parts.length ? parts : [''];
  }
  function compose(data, variant) {
    variant = variant === 'learning' ? 'learning' : 'memory';
    const rows = [], referenced = new Set(), days = new Map((data.days || []).map(d => [d.date, d]));
    ['posts', 'notes'].forEach(kind => (data[kind] || []).forEach(row => {
      const photoIds = [...new Set(row.photoIds || [])];
      photoIds.forEach(id => referenced.add(id));
      if (row.text || photoIds.length) rows.push({ ...row, photoIds, kind });
    }));
    (data.visits || []).forEach(row => rows.push({ ...row, text: [row.title, row.note].filter(Boolean).join('\n'), photoIds: [], kind: 'visits' }));
    (data.photos || []).forEach(row => {
      if (!referenced.has(row.id)) rows.push({ ...row, text: '', photoIds: [row.id], kind: 'photos' });
    });
    const rank = r => variant === 'learning'
      ? ((r.purposeIds || []).includes('learn') ? 0 : r.kind === 'notes' ? 1 : 2)
      : 0;
    rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
      || rank(a) - rank(b) || String(a.at || '').localeCompare(String(b.at || '')) || String(a.id || '').localeCompare(String(b.id || '')));
    const slides = [{ kind: 'title', title: data.trip && data.trip.name || 'わたしの旅', text: variant === 'learning' ? '学びの記録' : '思い出動画', duration: 3 }];
    let lastDate = null, chapter = 0;
    rows.forEach(row => {
      const date = row.date || '日付のない思い出';
      if (date !== lastDate) {
        const day = days.get(date);
        slides.push({ kind: 'chapter', title: '第' + (++chapter) + '章', text: date + (day && day.title ? '\n' + day.title : ''), duration: 3 });
        lastDate = date;
      }
      const texts = splitText(row.text, 112), photos = row.photoIds || [];
      const count = Math.max(texts.length, photos.length);
      for (let i = 0; i < count; i++) {
        const text = texts[i] || '';
        slides.push({ kind: 'entry', title: date, text, photoId: photos[i % photos.length] || null,
          source: row.kind, sourceId: row.id, duration: clamp(3 + Array.from(text).length / 15, 4, 11) });
      }
    });
    slides.push({ kind: 'ending', title: 'いい旅だったね。', text: variant === 'learning' ? 'ここで見つけたことを、これからへ。' : 'また、あの日を見返そう。', duration: 3 });
    return { variant, slides, entryCount: rows.length, chapterCount: chapter };
  }
  function timeline(slides, fade) {
    fade = Number.isFinite(fade) ? clamp(fade, 0, 1) : 0.6;
    let end = 0;
    const segments = slides.map((slide, i) => {
      const duration = Number.isFinite(slide.duration) ? Math.max(1, slide.duration) : 4;
      const start = i ? end - fade : 0;
      end = start + duration;
      return { start, end, duration, fade: i ? fade : 0 };
    });
    return { segments, duration: end };
  }
  function frameAt(plan, time) {
    const segments = plan.segments;
    if (!segments.length) return { index: -1, previous: -1, progress: 0, mix: 1 };
    time = clamp(Number.isFinite(time) ? time : 0, 0, plan.duration);
    let index = 0;
    while (index + 1 < segments.length && segments[index + 1].start <= time) index++;
    const s = segments[index];
    return { index, previous: index > 0 && time < s.start + s.fade ? index - 1 : -1,
      progress: clamp((time - s.start) / s.duration, 0, 1),
      mix: s.fade ? clamp((time - s.start) / s.fade, 0, 1) : 1 };
  }
  function mimeType(Recorder) {
    if (!Recorder || typeof Recorder.isTypeSupported !== 'function') return '';
    return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => {
      try { return Recorder.isTypeSupported(type); } catch (_) { return false; }
    }) || '';
  }
  function abortError() { const e = new Error('中断しました'); e.name = 'AbortError'; return e; }
  function check(signal) { if (signal && signal.aborted) throw abortError(); }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); };
      const abort = () => { done(); reject(abortError()); };
      const timer = setTimeout(() => { done(); resolve(); }, ms);
      if (signal) { signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }
    });
  }
  async function photo(id, store, width, signal) {
    if (!id) return null;
    check(signal);
    const blob = await store.photos.blob(id);
    check(signal);
    if (!blob || !/^image\//.test(blob.type)) return null;
    // Decode only local Blobs; retain at most two downscaled canvases.
    const url = URL.createObjectURL(blob), image = new Image();
    let timer, abort;
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = () => reject(new Error('photo'));
        abort = () => reject(abortError());
        if (signal) signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(new Error('photo timeout')), 15000);
        image.src = url;
      });
      check(signal);
      const scale = Math.min(1, width * 1.78 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    } catch (e) { if (e.name === 'AbortError') throw e; return null; }
    finally {
      clearTimeout(timer);
      if (signal && abort) signal.removeEventListener('abort', abort);
      image.onload = image.onerror = null; image.src = ''; URL.revokeObjectURL(url);
    }
  }
  function lines(ctx, text, x, y, width, lineHeight, limit) {
    const output = [];
    String(text || '').split('\n').forEach(paragraph => {
      let line = '';
      for (const char of Array.from(paragraph)) {
        if (line && ctx.measureText(line + char).width > width) { output.push(line); line = ''; }
        line += char;
      }
      output.push(line);
    });
    output.slice(0, limit).forEach((line, i) => {
      if (i === limit - 1 && output.length > limit) line = Array.from(line).slice(0, -1).join('') + '…';
      ctx.fillText(line, x, y + i * lineHeight);
    });
  }
  function draw(ctx, slide, image, progress, quality) {
    const w = quality.width, h = quality.height, unit = w / 540;
    ctx.save(); ctx.scale(unit, unit);
    ctx.fillStyle = '#0b0e17'; ctx.fillRect(0, 0, 540, 960);
    if (image) {
      const scale = Math.max(540 / image.width, 960 / image.height) * (1 + progress * 0.065);
      const iw = image.width * scale, ih = image.height * scale;
      ctx.drawImage(image, (540 - iw) / 2 + (progress - .5) * 8, (960 - ih) / 2, iw, ih);
      const shade = ctx.createLinearGradient(0, 0, 0, 960);
      shade.addColorStop(0, '#0b0e1766'); shade.addColorStop(.4, '#0b0e1711'); shade.addColorStop(.64, '#0b0e17cc'); shade.addColorStop(1, '#0b0e17');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, 540, 960);
    } else {
      ctx.fillStyle = '#192d35'; ctx.beginPath(); ctx.arc(430, 160, 200 + progress * 20, 0, Math.PI * 2); ctx.fill();
    }
    const friends = quality.template === 'friends';
    if (friends) { ctx.strokeStyle = '#e6c36a'; ctx.lineWidth = 2; ctx.strokeRect(20, 20, 500, 920); }
    const entry = slide.kind === 'entry', titleY = entry ? 98 : friends ? 330 : 365;
    ctx.fillStyle = friends ? '#e6c36a' : '#3ef0d0';
    ctx.font = (entry ? '22' : friends ? '42' : '36') + 'px sans-serif';
    lines(ctx, slide.title, 42, titleY, 456, 52, 3);
    ctx.fillStyle = '#edf2f8'; ctx.font = '26px sans-serif';
    lines(ctx, slide.text, 42, entry ? 648 : 535, 456, 37, entry ? 7 : 9);
    if (quality.watermark) {
      ctx.fillStyle = '#edf2f8aa'; ctx.font = '18px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('たびのこ', 508, 926);
    }
    ctx.restore();
    // Width/height belong to the preset, never to a remote image.
    return { width: w, height: h };
  }
  function ambient() {
    const Audio = host.AudioContext || host.webkitAudioContext;
    if (!Audio) throw new Error('音の準備ができませんでした');
    const context = new Audio(), destination = context.createMediaStreamDestination();
    const gain = context.createGain(); gain.gain.value = 0.025; gain.connect(destination);
    const oscillators = [174.61, 261.63, 349.23].map(frequency => {
      const node = context.createOscillator(); node.type = 'sine'; node.frequency.value = frequency; node.connect(gain); node.start(); return node;
    });
    return { context, destination, close() { oscillators.forEach(node => { try { node.stop(); node.disconnect(); } catch (_) {} }); gain.disconnect(); context.close().catch(() => {}); } };
  }
  async function record(options) {
    const { canvas, composition, store, signal, onProgress } = options;
    const quality = preset(options.quality, hasHd(options.license)), type = mimeType(host.MediaRecorder);
    if (!type || typeof canvas.captureStream !== 'function') throw new Error('このブラウザでは動画を作れません。振り返りのアルバムで、一緒に見返そう。');
    check(signal);
    canvas.width = quality.width; canvas.height = quality.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('動画の準備ができませんでした。');
    const plan = timeline(composition.slides);
    const layer = document.createElement('canvas');
    layer.width = quality.width; layer.height = quality.height;
    const layerCtx = layer.getContext('2d');
    let audio, stream, recorder, wake, stopped, stopTimer, stopAbort, current = null, previous = null, failed = null, bytes = 0, chunks = [];
    const missingPhotos = new Set();
    const releaseImage = image => { if (image) { image.width = 1; image.height = 1; } };
    try {
      // Called synchronously from the create button before awaiting photo reads (iOS audio gesture).
      audio = ambient();
      await audio.context.resume();
      check(signal);
      if (audio.context.state !== 'running') throw new Error('音を準備できなかったよ。もう一度「ムービーを作る」を押してね。');
      if (host.navigator && host.navigator.wakeLock) {
        // An unresponsive wake-lock request must not block exporting.
        host.navigator.wakeLock.request('screen').then(lock => {
          if (signal && signal.aborted || stopped) lock.release().catch(() => {});
          else wake = lock;
        }).catch(() => {});
      }
      stream = canvas.captureStream(30);
      audio.destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      recorder = new host.MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: quality.bitrate, audioBitsPerSecond: 96000 });
      const done = new Promise((resolve, reject) => {
        recorder.ondataavailable = event => {
          if (event.data && event.data.size) {
            bytes += event.data.size;
            if (bytes > 160 * 1024 * 1024) { failed = new Error('動画が大きくなったよ。かんたん画質か、日付を絞ってもう一度作ってね。'); return; }
            chunks.push(event.data);
          }
        };
        recorder.onerror = () => { failed = new Error('動画を書き出せなかったよ。もう一度試してみてね。'); reject(failed); };
        recorder.onstop = resolve;
      });
      done.catch(() => {});
      // Only current and previous photos are held; recording pauses during disk/decode waits.
      for (let i = 0; i < composition.slides.length; i++) {
        check(signal);
        const slide = composition.slides[i], segment = plan.segments[i];
        current = await photo(slide.photoId, store, quality.width, signal);
        if (slide.photoId && !current) missingPhotos.add(slide.photoId);
        check(signal);
        if (failed) throw failed;
        draw(ctx, slide, current, 0, quality);
        if (i === 0) recorder.start(1000); else recorder.resume();
        const duration = (i + 1 < plan.segments.length ? plan.segments[i + 1].start : plan.duration) - segment.start;
        const start = performance.now();
        while (true) {
          check(signal); if (failed) throw failed;
          const elapsed = Math.min(duration, (performance.now() - start) / 1000);
          const f = frameAt(plan, segment.start + elapsed);
          // Draw both full frames for the overlap; the incoming opaque frame fades over the outgoing one.
          if (i && elapsed < segment.fade) {
            draw(ctx, composition.slides[i - 1], previous, 1, quality);
            draw(layerCtx, slide, current, clamp(elapsed / segment.duration, 0, 1), quality);
            ctx.globalAlpha = clamp(elapsed / segment.fade, 0, 1);
            ctx.drawImage(layer, 0, 0);
          } else draw(ctx, slide, current, clamp(elapsed / segment.duration, 0, 1), quality);
          ctx.globalAlpha = 1;
          if (onProgress) onProgress(clamp((segment.start + elapsed) / plan.duration, 0, 1), f.index);
          if (elapsed >= duration) break;
          await wait(33, signal);
        }
        recorder.pause();
        releaseImage(previous); previous = current; current = null;
      }
      recorder.stop();
      await Promise.race([done, new Promise((_, reject) => {
        stopTimer = setTimeout(() => reject(new Error('動画の仕上げが間に合わなかったよ。もう一度試してね。')), 12000);
        stopAbort = () => reject(abortError());
        if (signal) { signal.addEventListener('abort', stopAbort, { once: true }); if (signal.aborted) stopAbort(); }
      })]);
      check(signal); if (failed) throw failed;
      if (!chunks.length) throw new Error('動画が空でした。もう一度試してみてね。');
      const blob = new Blob(chunks, { type: recorder.mimeType || type }); chunks = [];
      if (onProgress) onProgress(1, composition.slides.length - 1);
      return { blob, extension: blob.type.includes('mp4') ? 'mp4' : 'webm', quality, missingPhotos: missingPhotos.size };
    } finally {
      stopped = true; clearTimeout(stopTimer);
      if (signal && stopAbort) signal.removeEventListener('abort', stopAbort);
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} }
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (audio) { audio.destination.stream.getTracks().forEach(track => track.stop()); audio.close(); }
      if (wake) wake.release().catch(() => {});
      releaseImage(current); releaseImage(previous); releaseImage(layer); chunks = [];
    }
  }
  const api = { preset, hasHd, compose, timeline, frameAt, mimeType, record };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { host.Tabi = host.Tabi || {}; host.Tabi.movieRender = api; }
})(typeof window !== 'undefined' ? window : globalThis);
