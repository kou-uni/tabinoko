/* settings — F12。バックアップ・ホーム画面追加・オフラインの案内。 */
(function () {
  'use strict';
  const T = window.Tabi, U = T.util, ui = T.ui, esc = U.esc, store = T.store, bus = T.bus;
  const $ = (s, r) => (r || document).querySelector(s);
  const mb = (b) => (b / 1048576).toFixed(1) + 'MB';
  const installHelp = '<p>Safari の共有ボタン →「ホーム画面に追加」。追加したアイコンから開いてください。</p><p class="caption">記録を始める前の追加がおすすめです。追加後に記録が見えない場合は、元の Safari で書き出し、新しい方で読み込んでください。</p>';
  const pwaText = () => {
    const p = T.pwa || {};
    return ({ ready: 'オフライン用の準備ができました。機内モードでも開けるか試してください。', preparing: 'オフライン用の準備中です。回線につないだままお待ちください。', error: 'オフライン用の準備ができませんでした。回線につないで開き直してください。', disabled: '開発用設定でオフライン準備を停止しています。', unavailable: 'この開き方ではオフライン起動を準備できません。Safari で HTTPS の URL を開いてください。' })[p.status || 'unavailable'] + (p.updateWaiting ? ' 更新があります。書きかけを保存し、すべてのタブとホーム画面のアプリを閉じてから開き直してください。' : '');
  };
  function backupDue() {
    const s = store.doc('settings');
    const hasRecords = ['posts', 'notes', 'hearing', 'photos', 'visits'].some((t) => store.count(t)) || store.all('days').some((d) => d.edited) || ['post', 'note', 'hearing'].some((k) => store.draft(k));
    const last = Math.max(Date.parse(s.lastBackupAt) || 0, Date.parse(s.backupNudgeAt) || 0);
    return hasRecords && Date.parse(U.iso()) - last >= 3 * 86400000;
  }
  T.settings = { backupDue };
  T.register({
    id: 'settings', title: '設定', routes: ['settings'], header: { label: '設定を開く', icon: 'gear', order: 90 },
    init() {
      const slot = $('#slot-banner');
      const line = document.createElement('div'); line.className = 'offline'; line.setAttribute('role', 'status'); slot.appendChild(line);
      const coach = document.createElement('div'); coach.className = 'settings-coach'; slot.appendChild(coach);
      const nudge = document.createElement('div'); nudge.className = 'settings-coach'; slot.appendChild(nudge);
      const sync = () => {
        line.textContent = U.isOnline() ? '' : 'オフライン · 外部の地図・投稿先には接続が必要';
        coach.innerHTML = '';
        nudge.innerHTML = '';
        const settingsButton = document.querySelector('.header-tools [data-route="settings"]');
        if (settingsButton) { settingsButton.dataset.backupDue = String(backupDue()); settingsButton.setAttribute('aria-label', backupDue() ? '設定・バックアップ未確認' : '設定を開く'); }

      };
      slot.addEventListener('click', async (e) => {
        try {
          if (e.target.closest('[data-dismiss-install]')) await store.setSetting('installCoachDismissedAt', U.iso());
          if (e.target.closest('[data-dismiss-backup]')) await store.setSetting('backupNudgeAt', U.iso());
        } catch (err) { ui.toast(err.userMessage || err.message); }
      });
      ['app:online', 'app:offline', 'store:changed', 'app:ready', 'route:changed'].forEach((n) => bus.on(n, sync)); sync();
    },
    render(root) {
      let active = true, revision = 0, busy = false, prepared = null, exportUrl = null;
      const release = () => { if (exportUrl) URL.revokeObjectURL(exportUrl); exportUrl = null; prepared = null; };
      const view = async () => {
        const rev = ++revision, us = await store.usage();
        const counts = await T.tapCounter.counts().catch(() => null);
        if (!active || rev !== revision) return;
        const st = store.photos.stats(), s = store.doc('settings');
        root.innerHTML = ui.heading('SETTINGS', '設定とバックアップ')
          + '<div class="card"><h3>この端末の思い出</h3><p class="caption">投稿案 ' + store.count('posts') + ' ／ メモ ' + store.count('notes') + ' ／ 写真 ' + st.count + '枚（' + mb(st.bytes) + '）' + (us.usage != null ? '<br>使用容量 ' + mb(us.usage) : '') + '</p><p class="caption">記録は端末内に保存します。地図・投稿先・共有先を開いた時は外部サービスを使います。キーボード音声入力の通信は OS の設定によります。パスポート・ETA・予約番号は書かないでください。</p>'
          + (store.degraded ? '<p role="status">' + esc(store.degraded) + '</p>' : '')
          + '<button class="wide" data-route="purposes">旅の目的・見せたい相手を変える</button></div>'
          + '<details class="card"><summary>オフライン起動・ホーム画面への追加</summary><h3>旅先でも開けるように</h3><p id="settings-pwa" role="status">' + esc(pwaText()) + '</p>' + (U.isStandalone() ? '<p>ホーム画面から開いています。</p>' : installHelp)
          + '<ol><li>ホーム画面のアイコンから、回線のある場所で開く</li><li>準備完了後、機内モードで開き直し、メモを残してみる</li><li>回線を戻し、写真つきバックアップを保存する</li></ol></details>'
          + '<div class="card"><h3>バックアップ</h3><p class="caption">最後に保存を確認: ' + (s.lastBackupAt ? esc(new Date(s.lastBackupAt).toLocaleString('ja-JP')) : 'まだありません') + '</p><p class="caption">写真・書きかけを含む JSON です。「ファイルに保存」で保存先を選び、保存されたことを確認してください。共有先に選んだアプリやクラウドには記録が渡ります。</p><button class="primary wide" id="export">書き出す（写真つき）</button><div id="settings-export"></div><div class="spacer"></div><button type="button" class="wide" id="import-backup">バックアップを読み込む</button><input id="import-file" type="file" accept="application/json,.json" hidden><p class="caption">読み込みは今の記録に結合します。編集した旅程を初期旅程より優先し、同じ記録は更新日時の新しい方を残します。</p><button class="wide" id="persist">消えにくい保存をお願いする</button><p class="caption">' + (us.persisted === true ? 'ブラウザが永続保存を許可しています。' : '永続保存はブラウザが判断します。') + ' 許可されても、端末故障やデータ消去には備えてバックアップを。</p></div>'
          + '<section class="card"><h3>表示と操作</h3><label for="ui-theme">表示テーマ</label><select id="ui-theme">' + [['dark','ダーク'],['light','ライト'],['auto','端末に合わせる']].map(([v,label]) => '<option value="' + v + '" ' + ((s.uiTheme || 'dark') === v ? 'selected' : '') + '>' + label + '</option>').join('') + '</select><label class="settings-toggle"><input type="checkbox" id="ui-haptics" ' + (s.uiHaptics ? 'checked' : '') + '>触覚フィードバック（対応端末のみ）</label><label class="settings-toggle"><input type="checkbox" id="ui-sound" ' + (s.uiSound ? 'checked' : '') + '>保存の効果音</label><p class="caption">動きを減らす設定では演出・振動を停止します。</p></section>'
          + (T.unlock && T.unlock.sealed ? '<div class="card"><h3>この端末のロック</h3><p>今は鍵を覚えているよ。掛けなおすと、次は合言葉で開けるよ。</p><button class="wide" id="relock">この端末のロックを掛けなおす</button></div>' : '')
          + '<div class="card"><button class="wide" data-route="upgrade">おまとめ（高画質）</button><button class="wide" data-route="/about">このアプリについて</button><p class="caption">この端末のほしい気持ち: ①' + (counts ? counts[1] : '—') + ' ②' + (counts ? counts[2] : '—') + '</p><p class="caption">①購入への興味 ②購入したい気持ち。各段階1日1回まで。集計先が設定されている場合は匿名の回数のみ送るよ。</p></div>'
          + '<div class="card"><h3>全部消す</h3><p class="caption">この版の記録・写真・設定・ライセンス・この端末の希望回数を消します。読み込み元の旧版や、書き出したファイルは残ります。初期の旅程は戻ります。</p><button class="wide" id="wipe">すべて消去…</button></div>';
      };
      const displayChange = async e => {
        const key = { 'ui-theme': 'uiTheme', 'ui-haptics': 'uiHaptics', 'ui-sound': 'uiSound' }[e.target.id];
        if (!key || busy) return;
        busy = true; e.target.disabled = true;
        try { await store.setSetting(key, key === 'uiTheme' ? e.target.value : e.target.checked); if (key === 'uiTheme') document.documentElement.dataset.theme = e.target.value; }
        catch (err) { ui.toast('設定を保存できませんでした。'); }
        finally { busy = false; if (active) e.target.disabled = false; }
      };
      root.addEventListener('change', displayChange);
      const exportControls = (message) => {
        if (!active) return;
        $('#settings-export', root).innerHTML = '<p role="status">' + esc(message) + '</p><button class="wide" id="share-backup">共有してファイルに保存</button><a class="file-label" href="' + exportUrl + '" download="' + prepared.name + '">ダウンロードして保存</a><p class="caption">保存したファイルがあることを確かめてから押してください。</p><button class="wide" id="backup-confirm">ファイルの保存を確認した</button>';
      };
      const onClick = async (e) => {
        const b = e.target.closest('button'); if (!b || busy) return;
        try {
          busy = true;
          if (b.id === 'relock') {
            await T.unlock.relock();
          } else if (b.id === 'import-backup') {
            $('#import-file', root).click();
          } else if (b.id === 'export') {
            b.disabled = true; b.textContent = '写真をまとめています…'; release();
            const blob = await store.exportAll({ photos: true });
            if (!active) return;
            prepared = new File([blob], 'tabinoko-backup-' + U.todayISO() + '.json', { type: 'application/json' });
            exportUrl = URL.createObjectURL(blob);
            exportControls('バックアップを用意しました。保存方法を選んでください。');
          } else if (b.id === 'share-backup' && prepared) {
            // 写真の非同期処理と共有を分け、iOS のユーザー操作権限を保つ。
            if (navigator.canShare && navigator.canShare({ files: [prepared] })) {
              try { await navigator.share({ files: [prepared], title: 'たびのこ バックアップ' }); }
              catch (err) { exportControls(err.name === 'AbortError' ? '保存はまだ確認していません。いつでもやり直せます。' : '共有できませんでした。ダウンロードから保存できます。'); }
            } else exportControls('このブラウザでは共有を使えません。ダウンロードから保存してください。');
          } else if (b.id === 'backup-confirm' && prepared) {
            await store.setSetting('lastBackupAt', U.iso()); bus.emit('backup:done', { kind: 'export' }); release(); await view(); ui.toast('バックアップの保存を記録しました。');
          } else if (b.id === 'persist') {
            const ok = await store.persist(); await store.setSetting('persistAsked', true); ui.toast(ok ? '消えにくい保存が許可されました。バックアップも残してね。' : '許可されないか、未対応です。バックアップを残してね。'); release(); await view();
          } else if (b.id === 'wipe' && await ui.confirm({ title: '本当にすべて消しますか？', body: 'この版の記録・写真・設定・ライセンス・この端末の希望回数を消します。元に戻せません。バックアップを保存したか確かめてください。', ok: '消去する' })) {
            await store.wipe(); await T.data.syncSeed(store); if (active) T.router.go('welcome');
          }
        } catch (err) { ui.toast(err.userMessage || err.message); }
        finally { busy = false; if (active && b.id === 'export') { b.disabled = false; b.textContent = '書き出す（写真つき）'; } }
      };
      const onChange = async (e) => {
        if (busy || e.target.id !== 'import-file' || !e.target.files[0]) return;
        const file = e.target.files[0]; busy = true;
        try {
          if (!await ui.confirm({ title: 'バックアップを読み込みますか？', body: '現在の記録に結合します。編集した旅程を初期旅程より優先し、同じ記録は更新日時が新しい方を残します。', ok: '読み込む' })) return;
          const r = await store.importAll(file, { mode: 'merge' }); release();
          ui.toast('読み込みました（' + r.rows + '件・写真' + r.photos + '枚）'); if (active) await view();
        } catch (err) { ui.toast(err.userMessage || err.message); }
        finally { busy = false; e.target.value = ''; }
      };
      const off = bus.on('pwa:changed', () => { const el = $('#settings-pwa', root); if (active && el) el.textContent = pwaText(); });
      view().catch((err) => ui.toast(err.message));
      root.addEventListener('click', onClick); root.addEventListener('change', onChange);
      return () => { root.removeEventListener('change', displayChange); active = false; release(); off(); root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); };
    },
  });
})();
