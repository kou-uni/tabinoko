/* 旅のノート: DOM に依存しない状態・文言・棚の選択。 */
(function () {
  'use strict';
  const T = window.Tabi;
  function transition(state = { phase: 'input', pending: 0, failed: false }, event) {
    if (event === 'start') return { phase: 'saving', pending: state.pending + 1, failed: state.pending ? state.failed : false };
    if (event === 'input') return state.pending ? state : { phase: 'input', pending: 0, failed: false };
    if (!state.pending) return state;
    const pending = state.pending - 1, failed = state.failed || event === 'error';
    return { phase: pending ? 'saving' : failed ? 'error' : 'saved', pending, failed };
  }
  function saveLabel(state, backend, degraded) {
    if (state.phase === 'saving') return '保存中…';
    if (state.phase === 'error') return '保存できませんでした。もう一度保存してください';
    if (backend === 'memory') return '一時保存（閉じると消えます）';
    if (degraded) return '退避保存済み（バックアップ推奨）';
    return state.phase === 'input' ? '入力中・まだ保存していません' : 'この端末に保存済み';
  }
  function achievement(before, after) {
    const labels = { photos: '写真', notes: 'メモ・会話', posts: '文案', visits: '訪問' };
    return Object.keys(labels).filter(k => after[k] > before[k]).map(k => labels[k] + 'を' + (after[k] - before[k]) + (k === 'photos' ? '枚' : '件') + '保存しました').join('。') || '記録の変更を保存しました';
  }
  function resume({ now, last, draft, next } = {}) {
    const away = Number.isFinite(Date.parse(last)) && Date.parse(now) - Date.parse(last) >= 3 * 86400000;
    return { greeting: away ? 'おかえりなさい。前の続きからでも、新しく1行でも。' : '', next: '次はここから：' + (draft ? '書きかけのひとこと' : next || '思い出を読み返す'), route: draft ? 'notes' : next ? 'plan' : 'timeline' };
  }
  function mission(index, complete) {
    const labels = ['写真を1枚', 'ひとことを1件', '文案を1つ'];
    return labels[index] + (complete ? '保存済み' : '残す');
  }
  function filter(rows, query = {}) {
    const norm = s => String(s || '').normalize('NFKC').toLocaleLowerCase();
    return rows.filter(r => (!query.date || r.date === query.date) && (!query.place || r.spotId === query.place) && (!query.theme || r.theme === query.theme) && (!query.text || norm([r.text, r.place, r.theme].join(' ')).includes(norm(query.text))));
  }
  T.notebook = { transition, saveLabel, achievement, mission, resume, filter };
})();
