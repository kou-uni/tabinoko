/* photo.js — 写真の取り込み（縮小して IndexedDB へ）。所有: timeline モジュール（他は呼ぶだけ）。
 *   const row = await Tabi.photo.add(file, {date})   -> photos 行（{id, w, h, bytes, ...}）
 * 縮小: 長辺 1440px / JPEG 0.8。向きは EXIF に従う。失敗時は <img> 経由にフォールバック。 */
(function () {
  'use strict';
  const T = (window.Tabi = window.Tabi || {});
  const MAX = 1440, QUALITY = 0.8, LIMIT = 30 * 1024 * 1024;

  async function decode(file) {
    try { const b = await createImageBitmap(file, { imageOrientation: 'from-image' }); return { src: b, w: b.width, h: b.height, close: () => b.close && b.close() }; } catch (e) { /* フォールバックへ */ }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('この写真は読み込めなかったよ。JPEG・PNGの写真で試してね。')); i.src = url; });
      return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch (e) { URL.revokeObjectURL(url); throw e; }
  }

  async function resize(file) {
    if (!file || (!String(file.type || '').startsWith('image/') && !(file.type === '' && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '')))) throw new Error('写真のファイルを選んでね。');
    if (!file.size) throw new Error('この写真は空みたい。別の写真で試してね。');
    if (file.size > LIMIT) throw new Error('30MB以下の写真を選んでね。');
    const d = await decode(file);
    let c;
    try {
      if (!(d.w > 0 && d.h > 0 && Number.isFinite(d.w) && Number.isFinite(d.h))) throw new Error('写真の大きさを読み取れなかったよ。別の写真で試してね。');
      const scale = Math.min(1, MAX / Math.max(d.w, d.h));
      c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(d.w * scale)); c.height = Math.max(1, Math.round(d.h * scale));
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('写真を開く余裕が足りないみたい。小さめの写真で試してね。');
      // JPEG に透明部分はない。黒くつぶれないよう白を敷く。
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(d.src, 0, 0, c.width, c.height);
      const blob = await new Promise((res, rej) => c.toBlob((b) => (b && b.size ? res(b) : rej(new Error('写真を変換できなかったよ。別の写真で試してね。'))), 'image/jpeg', QUALITY));
      return { blob, w: c.width, h: c.height };
    } finally {
      d.close();
      if (c) { c.width = 1; c.height = 1; }
    }
  }

  T.photo = {
    resize,
    async add(file, meta) {
      const r = await resize(file);
      const row = await T.store.photos.put(r.blob, Object.assign({}, meta || {}, { w: r.w, h: r.h }));
      T.bus.emit('photo:added', { photo: row });
      return row;
    },
  };
})();
