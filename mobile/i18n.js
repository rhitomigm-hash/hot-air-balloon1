// 多言語対応(日本語/英語)。辞書はここに集約し、HTML/main.js は t() 経由で参照する。
// 言語判定の優先順位: URLの?lang= > localStorage保存値 > ブラウザ言語 > 既定(ja)
const LANG_KEY = 'balloon-lang';

const STR = {
  ja: {
    'meta.title': '熱気球フライト(モバイル版)',

    'hud.altUnit': 'ft 対地',
    'hud.altMsl': '高度(MSL)',
    'hud.agl': '対地高度',
    'hud.vario': '昇降',
    'hud.windLabel': '風(現在高度)',
    'hud.windLabelTo': '風(現在高度・TO)',
    'hud.fuel': '燃料',
    'hud.envelopeTemp': 'エンベロープ温度',
    'hud.timeScale': '時間加速',
    'hud.status': '状態',
    'hud.statusGrounded': '接地',
    'hud.statusFlying': '飛行中',
    'hud.target': 'ターゲット',
    'hud.marker': 'マーカー',
    'hud.markerRemaining': '残り {n}',
    'hud.markerDropped': '投下!',
    'hud.markerFalling': '落下中 {m}m',
    'hud.markerMeasuring': '計測中...',
    'hud.markerResult': '{m} m',
    'hud.clockLabel': '残り時間',
    'hud.toggleOpen': 'タップで詳細 ▾',
    'hud.toggleClose': '閉じる ▴',

    'areasel.title': 'フライトエリア選択',
    'areasel.mapnote': 'タップ: エリア中心を選択(橙枠 = 約20km四方の飛行エリア、中央がターゲット)/ ピンチ: 拡大縮小 / ドラッグ: 移動',
    'areasel.btnDefault': '地図でエリアを選択してください',
    'areasel.btnSelected': 'このエリアで飛ぶ({name})',

    'briefing.title': 'タスクブリーフィング',
    'task.disciplineLabel': '競技',
    'task.disciplineValue': 'JDG(ジャッジ・ディクレアード・ゴール)',
    'task.targetLabel': 'ターゲット',
    'task.targetValue': '地図上の橙色X',
    'task.launchLabel': '離陸',
    'task.launchValue': '個別離陸(地図をタップして選択)',
    'task.timeLimitLabel': '制限時間',
    'task.timeLimitValue': '30:00(ゲーム内時間)',
    'task.markerLabel': 'マーカー',
    'task.markerValue': '1本(投下ボタン)',
    'task.scoreLabel': 'スコア',
    'task.scoreValue': 'マーカー着地点〜ターゲット中心の距離',
    'wind.sub': 'パイバル観測データ(編集できます)',
    'wind.addBtn': '+行',
    'wind.copyBtn': '条件URLをコピー',
    'wind.thAlt': '高度ft',
    'wind.thDir': '風向°',
    'wind.thSpeed': '風速kt',
    'wind.presetCustom': 'カスタム',
    'wind.delRowTitle': '行を削除',
    'briefing.hintHtml':
      '高度は対地(AGL)、風向はFROM(磁方位)。表は編集でき、プリセット選択・行の追加削除も可能です。<br>' +
      'ターゲットの風上側に離陸地点を取り、高度で風を乗り換えて狙いましょう。<br>' +
      '「条件URLをコピー」で、この風と同じ条件に挑戦できるURLを共有できます。',
    'launch.btnDefault': '地図で離陸地点を選択してください',
    'launch.btnSelected': '離陸!(ターゲットまで {km} km)',
    'launch.mapnote': '地理院タイル(標準地図)/ 北が上 / タップ: 離陸地点を選択 / ピンチ: 拡大縮小 / ドラッグ: 移動',

    'result.title': 'JDG リザルト',
    'result.retryBtn': 'もう一度飛ぶ',
    'result.replayBtn': '🎯 投下シーンをリプレイ',
    'result.bestNew': '自己ベスト更新!',
    'result.bestExisting': '自己ベスト: {m} m',
    'result.timeExpired': '制限時間切れ: 現在地点で計測',
    'result.launchDist': '離陸地点からゴールまで: {m} m',
    'result.gwOn': '地上風ゆらぎ: 有効',
    'result.gwOff': '地上風ゆらぎ: 無効',
    'result.hideBtn': '隠す ▾',
    'result.hideTitle': '結果を隠して周囲を見る',
    'result.reopenBtn': '結果を表示 ▴',
    'copy.success': 'コピーしました!',
    'copy.fail': 'コピー失敗',

    'gw.sub': '地上風のゆらぎ(β)',
    'gw.enableLabel': '有効にする',
    'gw.distLabel': '高気圧までの距離',
    'gw.distUnit': 'km',
    'gw.hintHtml':
      '地上付近の風は表の値通りとは限りません。実際の値は離陸時に1回だけ決まり、パイロットには分かりません。' +
      '飛行中は「地上クルー」ボタンで無線確認できます(速度はおおよその感触のみ)。',
    'gw.groundCrewBtn': '地上クルー',
    'gw.reportPrefix': '📻 地上クルーより',
    'gw.tierWeak': '弱い風',
    'gw.tierNormal': '普通の風',
    'gw.tierStrong': '強い風',

    'mp.title': '🎈 みんなで飛ぶ(ベータ)',
    'mp.namePlaceholder': 'パイロット名',
    'mp.createBtn': 'ルームを作る',
    'mp.joinHint': '友達から届いたコードで参加する場合はこちら↓',
    'mp.codePlaceholder': 'コード',
    'mp.joinBtn': '参加',
    'mp.roomLabel': 'ルーム: ',
    'mp.self': '(自分)',
    'mp.copyBtn': '招待URLをコピー',
    'mp.waitingReady': '全員の準備完了待ち',
    'mp.connecting': '接続中…',
    'mp.connectFailed': '⚠ 接続できませんでした({err})',
    'mp.inviteSent': '招待URLを友達に送ってください',
    'mp.enterName': 'パイロット名を入力してください',
    'mp.enterCode': 'ルームコードを入力してください',
    'mp.readyBtn': '準備完了にする(ターゲットまで {km} km)',
    'mp.readyDone': '✅ 準備完了(タップで取り消し)',
    'mp.soloLink': 'ソロで飛ぶ',
    'mp.waitingSetup': 'ホストの条件配布を待っています…',
    'mp.reconnectingAfterClose': '⚠ 接続が切れました。再接続しています…',
    'mp.reconnectingRematch': '再接続しています…',
    'mp.reconnected': '再接続しました',
    'mp.reconnectFailedSolo': '⚠ 再接続できませんでした(ソロで続行。画面を切り替えると再試行します)',
    'mp.reconnectFailedReload': '⚠ 再接続できませんでした。ページを再読み込みしてください',
    'mp.startBtn': '🎈 一斉離陸スタート!',
    'mp.waitingPlayers': '参加者を待っています(2人以上で開始)',
    'mp.boardHeader': 'ルーム {code} / 加速 全体×{scale}(希望×{desired})',
    'mp.disconnected': '💤切断中',
    'mp.landed': '📍計測済',
    'mp.dropped': '🎯投下',
    'mp.resultsLeft': '(離脱)',
    'mp.waitingRematch': 'ホストの「もう一回戦」を待っています…',
    'mp.reloadToRetry': 'もう一度飛ぶにはページを再読み込みしてください',
    'mp.waitingAllMeasure': '🎈 全員の計測を待っています…',
    'mp.markerMeasuredBeforeReload': '計測済(リロード前に確定)',
    'mp.markerDroppedAlready': '投下済',

    'mpJoin.title': 'ルームに参加',
    'mpJoin.descHtml': 'ルーム <b id="mp-join-code"></b> に参加します。名前と気球の色を選んでください。',
    'mpJoin.goBtn': '参加する',

    'mpCountdown.label': '同時離陸まで',

    'mpResults.title': '🏁 リザルト(全員確定)',
    'mpResults.thRank': '#',
    'mpResults.thPilot': 'パイロット',
    'mpResults.thDist': '距離',
    'mpResults.rematchBtn': 'もう一回戦',

    'support.title': '🎈 日本代表を応援しよう!',
    'support.text1': '2026年9月、ポーランド🇵🇱クロスノで開催される熱気球世界選手権に、日本から7名のパイロットが日本代表として出場予定です。',
    'support.tshirtBtn': '応援Tシャツを申し込む',
    'support.text2':
      'Tシャツは3デザイン×各2色、綿素材とドライ素材から選べます。<br>' +
      'ご寄付も受け付けています。ご寄付いただいた方には、世界選手権の開催地' +
      'クロスノの実在地形で飛べる<b>特別版アプリ</b>をお届けします。',
    'support.instaBtn': '寄付のご案内はInstagramへ',

    'pibal.panelTitle': 'パイバル観測データ',
    'pibal.note': '高度: 対地(AGL) / 風向: <span id="pibal-mode-label">FROM</span>(磁方位)',
    'pibal.closeBtn': '閉じる ▲',
    'pibal.launchTimeNote': ' (離陸時)',

    'btn.burnerHtml': '🔥<br>バーナー',
    'btn.rip': '排気',
    'btn.markerHtml': 'マーカー<br>投下',
    'btn.view': '視点',
    'btn.speed': '加速 ×',
    'btn.pibal': '風データ',
    'btn.soundOn': '音 ON',
    'btn.soundOnStalled': '音 ON…',
    'btn.soundOff': '音 OFF',

    'help.bodyHtml':
      '<b>Space</b> バーナー(長押し) <b>R</b> リップライン(長押し) <b>M</b> マーカー投下<br>' +
      '<b>V</b> 視点切替(ゴンドラ/外部) <b>1-4</b> 時間加速 ×1/×2/×4/×8<br>' +
      '<b>P</b> パイバル表 表示/非表示 マウスドラッグ: 視点回転 / ホイール: ズーム',

    'credit.aria': '出典を表示',
    'credit.html': '出典: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院 地理院タイル</a>(標高タイル・全国最新写真)',

    'loading.generic': '地形を読み込み中…',
    'loading.area': '{name} の地形を読み込み中…',

    'lang.toggle': 'English',

    'area.saga': '佐賀・嘉瀬川',
    'area.watarase': '渡良瀬遊水地',
    'area.saku': '佐久・千曲川',
    'area.ichinoseki': '一関・平泉',
    'area.kamishihoro': '上士幌(北海道)',

    'windPreset.sagaMorning': '佐賀・朝の順転(既定)',
    'windPreset.backing': '逆転(北東→北西)',
    'windPreset.steady': 'ほぼ一定(南風)',
    'windPreset.strongVeer': '強風・大きく順転',
  },
  en: {
    'meta.title': 'Hot Air Balloon Flight (Mobile)',

    'hud.altUnit': 'ft AGL',
    'hud.altMsl': 'Altitude (MSL)',
    'hud.agl': 'AGL',
    'hud.vario': 'Vario',
    'hud.windLabel': 'Wind (current alt)',
    'hud.windLabelTo': 'Wind (current alt, TO)',
    'hud.fuel': 'Fuel',
    'hud.envelopeTemp': 'Envelope temp',
    'hud.timeScale': 'Time ×',
    'hud.status': 'Status',
    'hud.statusGrounded': 'Grounded',
    'hud.statusFlying': 'Flying',
    'hud.target': 'Target',
    'hud.marker': 'Marker',
    'hud.markerRemaining': '{n} left',
    'hud.markerDropped': 'Dropped!',
    'hud.markerFalling': 'Falling {m}m',
    'hud.markerMeasuring': 'Measuring...',
    'hud.markerResult': '{m} m',
    'hud.clockLabel': 'Time left',
    'hud.toggleOpen': 'Tap for detail ▾',
    'hud.toggleClose': 'Close ▴',

    'areasel.title': 'Select Flight Area',
    'areasel.mapnote': 'Tap: choose area center (orange box ≈ 20km flight area, center = target) / Pinch: zoom / Drag: pan',
    'areasel.btnDefault': 'Select an area on the map',
    'areasel.btnSelected': 'Fly here ({name})',

    'briefing.title': 'Task Briefing',
    'task.disciplineLabel': 'Task',
    'task.disciplineValue': 'JDG (Judge Declared Goal)',
    'task.targetLabel': 'Target',
    'task.targetValue': 'Orange X on the map',
    'task.launchLabel': 'Launch',
    'task.launchValue': 'Individual launch (tap the map to choose)',
    'task.timeLimitLabel': 'Time Limit',
    'task.timeLimitValue': '30:00 (in-game time)',
    'task.markerLabel': 'Marker',
    'task.markerValue': '1 (drop button)',
    'task.scoreLabel': 'Score',
    'task.scoreValue': 'Distance from marker landing to target center',
    'wind.sub': 'Pibal Observation Data (editable)',
    'wind.addBtn': '+ Row',
    'wind.copyBtn': 'Copy Conditions URL',
    'wind.thAlt': 'Alt ft',
    'wind.thDir': 'Dir °',
    'wind.thSpeed': 'Speed kt',
    'wind.presetCustom': 'Custom',
    'wind.delRowTitle': 'Delete row',
    'briefing.hintHtml':
      'Altitude is AGL, direction is FROM (magnetic). The table is editable — pick a preset or add/remove rows.<br>' +
      'Launch upwind of the target and change altitude to ride different wind layers toward it.<br>' +
      '"Copy Conditions URL" shares a link with this exact wind setup.',
    'launch.btnDefault': 'Select a launch point on the map',
    'launch.btnSelected': 'Launch! ({km} km to target)',
    'launch.mapnote': 'GSI tiles (standard map) / North up / Tap: choose launch point / Pinch: zoom / Drag: pan',

    'result.title': 'JDG Result',
    'result.retryBtn': 'Fly Again',
    'result.replayBtn': '🎯 Replay Marker Drop',
    'result.bestNew': 'New personal best!',
    'result.bestExisting': 'Personal best: {m} m',
    'result.timeExpired': "Time's up: measured at current position",
    'result.launchDist': 'Launch to goal: {m} m',
    'result.gwOn': 'Ground wind drift: On',
    'result.gwOff': 'Ground wind drift: Off',
    'result.hideBtn': 'Hide ▾',
    'result.hideTitle': 'Hide the result to look around',
    'result.reopenBtn': 'Show Result ▴',
    'copy.success': 'Copied!',
    'copy.fail': 'Copy failed',

    'gw.sub': 'Ground Wind Drift (beta)',
    'gw.enableLabel': 'Enable',
    'gw.distLabel': 'Distance to high-pressure center',
    'gw.distUnit': 'km',
    'gw.hintHtml':
      'Ground-level wind may not match the table exactly. The actual value is set once at launch ' +
      'and hidden from the pilot. During flight, use the "Ground Crew" button to radio for an update ' +
      '(speed is only a rough estimate).',
    'gw.groundCrewBtn': 'Ground Crew',
    'gw.reportPrefix': '📻 From Ground Crew',
    'gw.tierWeak': 'Light wind',
    'gw.tierNormal': 'Moderate wind',
    'gw.tierStrong': 'Strong wind',

    'mp.title': '🎈 Fly Together (beta)',
    'mp.namePlaceholder': 'Pilot name',
    'mp.createBtn': 'Create Room',
    'mp.joinHint': 'Got a code from a friend? Join here ↓',
    'mp.codePlaceholder': 'Code',
    'mp.joinBtn': 'Join',
    'mp.roomLabel': 'Room: ',
    'mp.self': '(you)',
    'mp.copyBtn': 'Copy Invite URL',
    'mp.waitingReady': 'Waiting for everyone to be ready',
    'mp.connecting': 'Connecting…',
    'mp.connectFailed': '⚠ Could not connect ({err})',
    'mp.inviteSent': 'Send the invite URL to your friends',
    'mp.enterName': 'Please enter a pilot name',
    'mp.enterCode': 'Please enter a room code',
    'mp.readyBtn': 'Mark ready ({km} km to target)',
    'mp.readyDone': '✅ Ready (tap to cancel)',
    'mp.soloLink': 'Fly solo',
    'mp.waitingSetup': "Waiting for the host's conditions…",
    'mp.reconnectingAfterClose': '⚠ Connection lost. Reconnecting…',
    'mp.reconnectingRematch': 'Reconnecting…',
    'mp.reconnected': 'Reconnected',
    'mp.reconnectFailedSolo': '⚠ Could not reconnect (continuing solo. Switching apps will retry)',
    'mp.reconnectFailedReload': '⚠ Could not reconnect. Please reload the page',
    'mp.startBtn': '🎈 Launch Together!',
    'mp.waitingPlayers': 'Waiting for players (2+ to start)',
    'mp.boardHeader': 'Room {code} / Speed ×{scale} (you want ×{desired})',
    'mp.disconnected': '💤 Disconnected',
    'mp.landed': '📍 Measured',
    'mp.dropped': '🎯 Dropped',
    'mp.resultsLeft': '(left)',
    'mp.waitingRematch': "Waiting for the host's rematch…",
    'mp.reloadToRetry': 'Reload the page to fly again',
    'mp.waitingAllMeasure': '🎈 Waiting for everyone to finish…',
    'mp.markerMeasuredBeforeReload': 'Measured (locked in before reload)',
    'mp.markerDroppedAlready': 'Already dropped',

    'mpJoin.title': 'Join Room',
    'mpJoin.descHtml': 'Joining room <b id="mp-join-code"></b>. Choose your name and balloon color.',
    'mpJoin.goBtn': 'Join',

    'mpCountdown.label': 'Launching in',

    'mpResults.title': '🏁 Results (all confirmed)',
    'mpResults.thRank': '#',
    'mpResults.thPilot': 'Pilot',
    'mpResults.thDist': 'Distance',
    'mpResults.rematchBtn': 'Rematch',

    'support.title': '🎈 Cheer on Team Japan!',
    'support.text1': 'In September 2026, 7 pilots will represent Japan at the Hot Air Balloon World Championship in Krosno🇵🇱, Poland.',
    'support.tshirtBtn': 'Order a Support T-Shirt',
    'support.text2':
      'Choose from 3 designs × 2 colors each, in cotton or dry-fit fabric.<br>' +
      'Donations are also welcome. Donors receive a <b>special edition app</b> where you can fly ' +
      'over the real terrain of Krosno, the World Championship host city.',
    'support.instaBtn': 'Donation info on Instagram',

    'pibal.panelTitle': 'Pibal Observation Data',
    'pibal.note': 'Alt: AGL / Dir: <span id="pibal-mode-label">FROM</span> (magnetic)',
    'pibal.closeBtn': 'Close ▲',
    'pibal.launchTimeNote': ' (at launch)',

    'btn.burnerHtml': '🔥<br>Burner',
    'btn.rip': 'Vent',
    'btn.markerHtml': 'Drop<br>Marker',
    'btn.view': 'View',
    'btn.speed': 'Speed ×',
    'btn.pibal': 'Wind Data',
    'btn.soundOn': 'Sound ON',
    'btn.soundOnStalled': 'Sound ON…',
    'btn.soundOff': 'Sound OFF',

    'help.bodyHtml':
      '<b>Space</b> Burner (hold) <b>R</b> Rip line (hold) <b>M</b> Drop marker<br>' +
      '<b>V</b> Toggle view (gondola/chase) <b>1-4</b> Time ×1/×2/×4/×8<br>' +
      '<b>P</b> Toggle wind table Mouse drag: look around / Wheel: zoom',

    'credit.aria': 'Show credits',
    'credit.html': 'Source: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">GSI (Geospatial Information Authority of Japan) tiles</a> (elevation tiles, latest aerial imagery)',

    'loading.generic': 'Loading terrain…',
    'loading.area': 'Loading terrain: {name}…',

    'lang.toggle': '日本語',

    // 地名はローマ字表記(実際の英語圏の慣行が定まっていないため暫定。要フィードバック)
    'area.saga': 'Saga - Kasegawa River',
    'area.watarase': 'Watarase Retarding Basin',
    'area.saku': 'Saku - Chikuma River',
    'area.ichinoseki': 'Ichinoseki - Hiraizumi',
    'area.kamishihoro': 'Kamishihoro (Hokkaido)',

    // 順転/逆転は英語気象・気球用語の veering/backing に対応(暫定。要フィードバック)
    'windPreset.sagaMorning': 'Saga Morning Veer (default)',
    'windPreset.backing': 'Backing (NE→NW)',
    'windPreset.steady': 'Steady (South wind)',
    'windPreset.strongVeer': 'Strong Wind, Sharp Veer',
  },
};

function detectLang() {
  const urlLang = new URLSearchParams(location.search).get('lang');
  if (urlLang === 'en' || urlLang === 'ja') return urlLang;
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'en' || saved === 'ja') return saved;
  return navigator.language && navigator.language.startsWith('ja') ? 'ja' : 'en';
}

export const LANG = detectLang();
const DICT = STR[LANG];

export function t(key, vars) {
  let s = DICT[key] ?? STR.ja[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

// 言語を切り替えて再読み込みする(?lang= をURLに反映、localStorageにも保存)。
// エリア/風プリセット名など起動時に確定するデータもあるため、動的差し替えではなくリロードで揃える
export function setLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
  const url = new URL(location.href);
  url.searchParams.set('lang', lang);
  location.href = url.toString();
}

// 起動時に一度だけ呼び、data-i18n系属性を持つ静的要素をまとめて差し替える
export function applyStaticI18n() {
  document.documentElement.lang = LANG === 'ja' ? 'ja' : 'en';
  document.title = t('meta.title');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    }
  });
}
