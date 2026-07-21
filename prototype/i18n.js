// 多言語対応(日本語/英語/ポルトガル語/ポーランド語)。辞書はここに集約し、HTML/main.js は t() 経由で参照する。
// mobile/i18n.js と同じアーキテクチャ。キー名も可能な限り共通化してあるが、
// PC版(マウス・キーボード操作、風はMSL基準)固有の文言は内容が異なる。
// 言語判定の優先順位: URLの?lang= > localStorage保存値 > ブラウザ言語 > 既定(en)
const LANG_KEY = 'balloon-lang';

const STR = {
  ja: {
    'meta.title': '熱気球フライト プロトタイプ',

    'hud.altMsl': '高度(MSL)',
    'hud.agl': '対地高度',
    'hud.vario': '昇降',
    'hud.windLabel': '風(現在高度)',
    'hud.windLabelTo': '風(現在高度・TO)',
    'hud.fuel': '燃料',
    'hud.envelopeTemp': 'エンベロープ温度',
    'hud.timeScale': '時間加速',
    'hud.soundLabel': '音',
    'hud.soundTitle': 'クリックまたはSキーでミュート切替',
    'hud.soundOn': 'ON',
    'hud.soundOff': 'OFF',
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

    'areasel.title': 'フライトエリア選択',
    'areasel.mapnote': 'クリック: エリア中心を選択(橙枠 = 約20km四方の飛行エリア、中央がターゲット)/ ホイール: 拡大縮小 / ドラッグ: 移動',
    'areasel.btnDefault': '地図でエリアを選択してください',
    'areasel.btnSelected': 'このエリアで飛ぶ({name})',

    'briefing.title': 'タスクブリーフィング',
    'task.disciplineLabel': '競技',
    'task.disciplineValue': 'JDG(ジャッジ・ディクレアード・ゴール)',
    'task.targetLabel': 'ターゲット',
    'task.targetValue': '地図上の橙色X',
    'task.launchLabel': '離陸',
    'task.launchValue': '個別離陸(地図をクリックして選択)',
    'task.timeLimitLabel': '制限時間',
    'task.timeLimitValue': '30:00(ゲーム内時間)',
    'task.markerLabel': 'マーカー',
    'task.markerValue': '1本(Mキーで投下)',
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
      '風向はFROM(磁方位)。表は編集でき、プリセット選択・行の追加削除も可能です。<br>' +
      'ターゲットの風上側に離陸地点を取り、高度で風を乗り換えて狙いましょう。<br>' +
      '「条件URLをコピー」で、この風と同じ条件に挑戦できるURLを共有できます。',

    'gw.sub': '地上風のゆらぎ(β)',
    'gw.enableLabel': '有効にする',
    'gw.distLabel': '高気圧までの距離',
    'gw.distUnit': 'km',
    'gw.hintHtml':
      '地上付近の風は表の値通りとは限りません。実際の値は離陸時に1回だけ決まり、パイロットには分かりません。' +
      '飛行中は<b>Gキー</b>で地上クルーに無線確認できます(速度はおおよその感触のみ)。',
    'gw.reportPrefix': '📻 地上クルーより',
    'gw.tierWeak': '弱い風',
    'gw.tierNormal': '普通の風',
    'gw.tierStrong': '強い風',

    'launch.btnDefault': '地図で離陸地点を選択してください',
    'launch.btnSelected': '離陸!(ターゲットまで {km} km)',
    'launch.mapnote': '地理院タイル(標準地図)/ 北が上 / クリック: 離陸地点を選択 / ホイール: 拡大縮小 / ドラッグ: 移動',

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

    'mp.title': '🎈 みんなで飛ぶ(ベータ)',
    'mp.namePlaceholder': 'パイロット名',
    'mp.createBtn': 'ルームを作る',
    'mp.joinHint': '友達から届いたコードで参加する場合はこちら↓',
    'mp.codePlaceholder': 'コード',
    'mp.joinBtn': '参加',
    'mp.roomLabel': 'ルーム: ',
    'mp.self': '(自分)',
    'mp.copyBtn': '招待URLをコピー',
    'mp.copyOtherBtn': 'スマホの相手を招待するURLをコピー',
    'mp.waitingReady': '全員の準備完了待ち',
    'mp.connecting': '接続中…',
    'mp.connectFailed': '⚠ 接続できませんでした({err})',
    'mp.inviteSent': '招待URLを友達に送ってください',
    'mp.enterName': 'パイロット名を入力してください',
    'mp.enterCode': 'ルームコードを入力してください',
    'mp.readyBtn': '準備完了にする(ターゲットまで {km} km)',
    'mp.readyDone': '✅ 準備完了(クリックで取り消し)',
    'mp.soloLink': 'ソロで飛ぶ',
    'mp.waitingSetup': 'ホストの条件配布を待っています…',
    'mp.reconnectingAfterClose': '⚠ 接続が切れました。再接続しています…',
    'mp.reconnectingRematch': '再接続しています…',
    'mp.reconnected': '再接続しました',
    'mp.reconnectFailedSolo': '⚠ 再接続できませんでした(ソロで続行。タブを切り替えると再試行します)',
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
    'pibal.note': '高度: MSL / 風向: <span id="pibal-mode-label">FROM</span>(磁方位)<br>※磁気偏角は未考慮(プロトタイプ)',

    'help.bodyHtml':
      '<b>Space</b> バーナー(長押し) <b>R</b> リップライン(長押し) <b>M</b> マーカー投下<br>' +
      '<b>V</b> 視点切替(ゴンドラ/外部) <b>1-4</b> 時間加速 ×1/×2/×4/×8<br>' +
      '<b>P</b> パイバル表 表示/非表示 <b>G</b> 地上クルーに無線確認(ゆらぎ有効時)<br>' +
      '<b>S</b> 音のON/OFF マウスドラッグ: 視点回転 / ホイール: ズーム',

    'credit.html': '出典: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院 地理院タイル</a>(標高タイル・全国最新写真)',

    'loading.generic': '地形を読み込み中…',
    'loading.area': '{name} の地形を読み込み中…',

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
    'meta.title': 'Hot Air Balloon Flight (Prototype)',

    'hud.altMsl': 'Altitude (MSL)',
    'hud.agl': 'AGL',
    'hud.vario': 'Vario',
    'hud.windLabel': 'Wind (current alt)',
    'hud.windLabelTo': 'Wind (current alt, TO)',
    'hud.fuel': 'Fuel',
    'hud.envelopeTemp': 'Envelope temp',
    'hud.timeScale': 'Time ×',
    'hud.soundLabel': 'Sound',
    'hud.soundTitle': 'Click or press S to mute',
    'hud.soundOn': 'ON',
    'hud.soundOff': 'OFF',
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

    'areasel.title': 'Select Flight Area',
    'areasel.mapnote': 'Click: choose area center (orange box ≈ 20km flight area, center = target) / Wheel: zoom / Drag: pan',
    'areasel.btnDefault': 'Select an area on the map',
    'areasel.btnSelected': 'Fly here ({name})',

    'briefing.title': 'Task Briefing',
    'task.disciplineLabel': 'Task',
    'task.disciplineValue': 'JDG (Judge Declared Goal)',
    'task.targetLabel': 'Target',
    'task.targetValue': 'Orange X on the map',
    'task.launchLabel': 'Launch',
    'task.launchValue': 'Individual launch (click the map to choose)',
    'task.timeLimitLabel': 'Time Limit',
    'task.timeLimitValue': '30:00 (in-game time)',
    'task.markerLabel': 'Marker',
    'task.markerValue': '1 (press M to drop)',
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
      'Direction is FROM (magnetic). The table is editable — pick a preset or add/remove rows.<br>' +
      'Launch upwind of the target and change altitude to ride different wind layers toward it.<br>' +
      '"Copy Conditions URL" shares a link with this exact wind setup.',

    'gw.sub': 'Ground Wind Drift (beta)',
    'gw.enableLabel': 'Enable',
    'gw.distLabel': 'Distance to high-pressure center',
    'gw.distUnit': 'km',
    'gw.hintHtml':
      'Ground-level wind may not match the table exactly. The actual value is set once at launch ' +
      'and hidden from the pilot. During flight, press <b>G</b> to radio the ground crew for an update ' +
      '(speed is only a rough estimate).',
    'gw.reportPrefix': '📻 From Ground Crew',
    'gw.tierWeak': 'Light wind',
    'gw.tierNormal': 'Moderate wind',
    'gw.tierStrong': 'Strong wind',

    'launch.btnDefault': 'Select a launch point on the map',
    'launch.btnSelected': 'Launch! ({km} km to target)',
    'launch.mapnote': 'GSI tiles (standard map) / North up / Click: choose launch point / Wheel: zoom / Drag: pan',

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

    'mp.title': '🎈 Fly Together (beta)',
    'mp.namePlaceholder': 'Pilot name',
    'mp.createBtn': 'Create Room',
    'mp.joinHint': 'Got a code from a friend? Join here ↓',
    'mp.codePlaceholder': 'Code',
    'mp.joinBtn': 'Join',
    'mp.roomLabel': 'Room: ',
    'mp.self': '(you)',
    'mp.copyBtn': 'Copy Invite URL',
    'mp.copyOtherBtn': 'Copy URL for a mobile player',
    'mp.waitingReady': 'Waiting for everyone to be ready',
    'mp.connecting': 'Connecting…',
    'mp.connectFailed': '⚠ Could not connect ({err})',
    'mp.inviteSent': 'Send the invite URL to your friends',
    'mp.enterName': 'Please enter a pilot name',
    'mp.enterCode': 'Please enter a room code',
    'mp.readyBtn': 'Mark ready ({km} km to target)',
    'mp.readyDone': '✅ Ready (click to cancel)',
    'mp.soloLink': 'Fly solo',
    'mp.waitingSetup': "Waiting for the host's conditions…",
    'mp.reconnectingAfterClose': '⚠ Connection lost. Reconnecting…',
    'mp.reconnectingRematch': 'Reconnecting…',
    'mp.reconnected': 'Reconnected',
    'mp.reconnectFailedSolo': '⚠ Could not reconnect (continuing solo. Switching tabs will retry)',
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
    'pibal.note': 'Alt: MSL / Dir: <span id="pibal-mode-label">FROM</span> (magnetic)<br>*Magnetic declination not modeled (prototype)',

    'help.bodyHtml':
      '<b>Space</b> Burner (hold) <b>R</b> Rip line (hold) <b>M</b> Drop marker<br>' +
      '<b>V</b> Toggle view (gondola/chase) <b>1-4</b> Time ×1/×2/×4/×8<br>' +
      '<b>P</b> Toggle wind table <b>G</b> Radio ground crew (when drift is on)<br>' +
      '<b>S</b> Sound on/off Mouse drag: look around / Wheel: zoom',

    'credit.html': 'Source: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">GSI (Geospatial Information Authority of Japan) tiles</a> (elevation tiles, latest aerial imagery)',

    'loading.generic': 'Loading terrain…',
    'loading.area': 'Loading terrain: {name}…',

    'area.saga': 'Saga - Kasegawa River',
    'area.watarase': 'Watarase Retarding Basin',
    'area.saku': 'Saku - Chikuma River',
    'area.ichinoseki': 'Ichinoseki - Hiraizumi',
    'area.kamishihoro': 'Kamishihoro (Hokkaido)',

    'windPreset.sagaMorning': 'Saga Morning Veer (default)',
    'windPreset.backing': 'Backing (NE→NW)',
    'windPreset.steady': 'Steady (South wind)',
    'windPreset.strongVeer': 'Strong Wind, Sharp Veer',
  },
  pt: {
    'meta.title': 'Voo de Balão (Protótipo)',

    'hud.altMsl': 'Altitude (MSL)',
    'hud.agl': 'Altura do solo',
    'hud.vario': 'Variômetro',
    'hud.windLabel': 'Vento (altitude atual)',
    'hud.windLabelTo': 'Vento (altitude atual, PARA)',
    'hud.fuel': 'Combustível',
    'hud.envelopeTemp': 'Temp. do envelope',
    'hud.timeScale': 'Velocidade ×',
    'hud.soundLabel': 'Som',
    'hud.soundTitle': 'Clique ou pressione S para silenciar',
    'hud.soundOn': 'ON',
    'hud.soundOff': 'OFF',
    'hud.status': 'Status',
    'hud.statusGrounded': 'No solo',
    'hud.statusFlying': 'Voando',
    'hud.target': 'Alvo',
    'hud.marker': 'Marcador',
    'hud.markerRemaining': '{n} restante(s)',
    'hud.markerDropped': 'Lançado!',
    'hud.markerFalling': 'Caindo {m}m',
    'hud.markerMeasuring': 'Medindo...',
    'hud.markerResult': '{m} m',
    'hud.clockLabel': 'Tempo restante',

    'areasel.title': 'Selecionar Área de Voo',
    'areasel.mapnote': 'Clique: escolher o centro da área (caixa laranja ≈ área de 20km, centro = alvo) / Roda: zoom / Arraste: mover',
    'areasel.btnDefault': 'Selecione uma área no mapa',
    'areasel.btnSelected': 'Voar aqui ({name})',

    'briefing.title': 'Briefing da Tarefa',
    'task.disciplineLabel': 'Prova',
    'task.disciplineValue': 'JDG (Meta Declarada pelo Juiz)',
    'task.targetLabel': 'Alvo',
    'task.targetValue': 'X laranja no mapa',
    'task.launchLabel': 'Decolagem',
    'task.launchValue': 'Decolagem individual (clique no mapa para escolher)',
    'task.timeLimitLabel': 'Tempo Limite',
    'task.timeLimitValue': '30:00 (tempo do jogo)',
    'task.markerLabel': 'Marcador',
    'task.markerValue': '1 (pressione M para lançar)',
    'task.scoreLabel': 'Pontuação',
    'task.scoreValue': 'Distância do pouso do marcador até o centro do alvo',
    'wind.sub': 'Dados de Sondagem (Pibal) (editável)',
    'wind.addBtn': '+ Linha',
    'wind.copyBtn': 'Copiar URL das Condições',
    'wind.thAlt': 'Alt. pés',
    'wind.thDir': 'Dir. °',
    'wind.thSpeed': 'Vel. kt',
    'wind.presetCustom': 'Personalizado',
    'wind.delRowTitle': 'Excluir linha',
    'briefing.hintHtml':
      'A direção é DE ONDE vem o vento (magnética). A tabela é editável — escolha um preset ou adicione/remova linhas.<br>' +
      'Decole a favor do vento em relação ao alvo e mude de altitude para pegar diferentes camadas de vento em direção a ele.<br>' +
      '"Copiar URL das Condições" compartilha um link com esta mesma configuração de vento.',

    'gw.sub': 'Vento de Solo Variável (beta)',
    'gw.enableLabel': 'Ativar',
    'gw.distLabel': 'Distância até o centro de alta pressão',
    'gw.distUnit': 'km',
    'gw.hintHtml':
      'O vento perto do solo pode não corresponder exatamente à tabela. O valor real é definido uma vez na decolagem ' +
      'e escondido do piloto. Durante o voo, pressione <b>G</b> para pedir uma atualização por rádio à equipe de solo ' +
      '(a velocidade é apenas uma estimativa aproximada).',
    'gw.reportPrefix': '📻 Da Equipe de Solo',
    'gw.tierWeak': 'Vento fraco',
    'gw.tierNormal': 'Vento moderado',
    'gw.tierStrong': 'Vento forte',

    'launch.btnDefault': 'Selecione um ponto de decolagem no mapa',
    'launch.btnSelected': 'Decolar! ({km} km até o alvo)',
    'launch.mapnote': 'Tiles do GSI (mapa padrão) / Norte para cima / Clique: escolher ponto de decolagem / Roda: zoom / Arraste: mover',

    'result.title': 'Resultado JDG',
    'result.retryBtn': 'Voar de Novo',
    'result.replayBtn': '🎯 Repetir Lançamento',
    'result.bestNew': 'Novo recorde pessoal!',
    'result.bestExisting': 'Recorde pessoal: {m} m',
    'result.timeExpired': 'Tempo esgotado: medido na posição atual',
    'result.launchDist': 'Decolagem até o alvo: {m} m',
    'result.gwOn': 'Vento de solo variável: Ativado',
    'result.gwOff': 'Vento de solo variável: Desativado',
    'result.hideBtn': 'Ocultar ▾',
    'result.hideTitle': 'Ocultar o resultado para olhar ao redor',
    'result.reopenBtn': 'Mostrar Resultado ▴',
    'copy.success': 'Copiado!',
    'copy.fail': 'Falha ao copiar',

    'mp.title': '🎈 Voar Junto (beta)',
    'mp.namePlaceholder': 'Nome do piloto',
    'mp.createBtn': 'Criar Sala',
    'mp.joinHint': 'Recebeu um código de um amigo? Entre aqui ↓',
    'mp.codePlaceholder': 'Código',
    'mp.joinBtn': 'Entrar',
    'mp.roomLabel': 'Sala: ',
    'mp.self': '(você)',
    'mp.copyBtn': 'Copiar URL de Convite',
    'mp.copyOtherBtn': 'Copiar URL para um jogador de celular',
    'mp.waitingReady': 'Esperando todos ficarem prontos',
    'mp.connecting': 'Conectando…',
    'mp.connectFailed': '⚠ Não foi possível conectar ({err})',
    'mp.inviteSent': 'Envie a URL de convite para seus amigos',
    'mp.enterName': 'Digite o nome do piloto',
    'mp.enterCode': 'Digite o código da sala',
    'mp.readyBtn': 'Marcar como pronto ({km} km até o alvo)',
    'mp.readyDone': '✅ Pronto (clique para cancelar)',
    'mp.soloLink': 'Voar sozinho',
    'mp.waitingSetup': 'Esperando as condições do anfitrião…',
    'mp.reconnectingAfterClose': '⚠ Conexão perdida. Reconectando…',
    'mp.reconnectingRematch': 'Reconectando…',
    'mp.reconnected': 'Reconectado',
    'mp.reconnectFailedSolo': '⚠ Não foi possível reconectar (continuando sozinho. Trocar de aba tentará de novo)',
    'mp.reconnectFailedReload': '⚠ Não foi possível reconectar. Recarregue a página',
    'mp.startBtn': '🎈 Decolar Juntos!',
    'mp.waitingPlayers': 'Esperando jogadores (2+ para começar)',
    'mp.boardHeader': 'Sala {code} / Velocidade ×{scale} (você quer ×{desired})',
    'mp.disconnected': '💤 Desconectado',
    'mp.landed': '📍 Medido',
    'mp.dropped': '🎯 Lançado',
    'mp.resultsLeft': '(saiu)',
    'mp.waitingRematch': 'Esperando a revanche do anfitrião…',
    'mp.reloadToRetry': 'Recarregue a página para voar de novo',
    'mp.waitingAllMeasure': '🎈 Esperando todos terminarem…',
    'mp.markerMeasuredBeforeReload': 'Medido (confirmado antes de recarregar)',
    'mp.markerDroppedAlready': 'Já lançado',

    'mpJoin.title': 'Entrar na Sala',
    'mpJoin.descHtml': 'Entrando na sala <b id="mp-join-code"></b>. Escolha seu nome e a cor do balão.',
    'mpJoin.goBtn': 'Entrar',

    'mpCountdown.label': 'Decolando em',

    'mpResults.title': '🏁 Resultados (todos confirmados)',
    'mpResults.thRank': '#',
    'mpResults.thPilot': 'Piloto',
    'mpResults.thDist': 'Distância',
    'mpResults.rematchBtn': 'Revanche',

    'support.title': '🎈 Torça pela Seleção Japonesa!',
    'support.text1': 'Em setembro de 2026, 7 pilotos representarão o Japão no Campeonato Mundial de Balonismo em Krosno🇵🇱, Polônia.',
    'support.tshirtBtn': 'Encomendar Camiseta de Apoio',
    'support.text2':
      'Escolha entre 3 designs × 2 cores cada, em algodão ou tecido dry-fit.<br>' +
      'Doações também são bem-vindas. Doadores recebem um <b>aplicativo especial</b> em que você pode voar ' +
      'sobre o terreno real de Krosno, a cidade-sede do Campeonato Mundial.',
    'support.instaBtn': 'Informações de doação no Instagram',

    'pibal.panelTitle': 'Dados de Sondagem (Pibal)',
    'pibal.note': 'Alt: MSL / Dir: <span id="pibal-mode-label">FROM</span> (magnética)<br>*Declinação magnética não considerada (protótipo)',

    'help.bodyHtml':
      '<b>Espaço</b> Queimador (segurar) <b>R</b> Respiro (segurar) <b>M</b> Lançar marcador<br>' +
      '<b>V</b> Trocar visão (cesto/externa) <b>1-4</b> Velocidade ×1/×2/×4/×8<br>' +
      '<b>P</b> Mostrar/ocultar tabela de vento <b>G</b> Chamar equipe de solo (se ativado)<br>' +
      '<b>S</b> Som ligado/desligado Arrastar o mouse: olhar ao redor / Roda: zoom',

    'credit.html': 'Fonte: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">Tiles do GSI (Instituto Geoespacial do Japão)</a> (tiles de elevação, imagens aéreas recentes)',

    'loading.generic': 'Carregando terreno…',
    'loading.area': 'Carregando terreno: {name}…',

    'area.saga': 'Saga - Rio Kasegawa',
    'area.watarase': 'Bacia de Retenção Watarase',
    'area.saku': 'Saku - Rio Chikuma',
    'area.ichinoseki': 'Ichinoseki - Hiraizumi',
    'area.kamishihoro': 'Kamishihoro (Hokkaido)',

    'windPreset.sagaMorning': 'Rotação Matinal de Saga (padrão)',
    'windPreset.backing': 'Rotação Anti-horária (NE→NO)',
    'windPreset.steady': 'Estável (vento sul)',
    'windPreset.strongVeer': 'Vento Forte, Rotação Acentuada',
  },
  pl: {
    'meta.title': 'Lot Balonem (Prototyp)',

    'hud.altMsl': 'Wysokość (n.p.m.)',
    'hud.agl': 'Wys. nad ziemią',
    'hud.vario': 'Wariometr',
    'hud.windLabel': 'Wiatr (bieżąca wys.)',
    'hud.windLabelTo': 'Wiatr (bieżąca wys., DOKĄD)',
    'hud.fuel': 'Paliwo',
    'hud.envelopeTemp': 'Temp. powłoki',
    'hud.timeScale': 'Przyspieszenie ×',
    'hud.soundLabel': 'Dźwięk',
    'hud.soundTitle': 'Kliknij lub wciśnij S, by wyciszyć',
    'hud.soundOn': 'WŁ',
    'hud.soundOff': 'WYŁ',
    'hud.status': 'Stan',
    'hud.statusGrounded': 'Na ziemi',
    'hud.statusFlying': 'W locie',
    'hud.target': 'Cel',
    'hud.marker': 'Znacznik',
    'hud.markerRemaining': 'Zostało {n}',
    'hud.markerDropped': 'Zrzucono!',
    'hud.markerFalling': 'Spada {m}m',
    'hud.markerMeasuring': 'Pomiar...',
    'hud.markerResult': '{m} m',
    'hud.clockLabel': 'Pozostały czas',

    'areasel.title': 'Wybierz Obszar Lotu',
    'areasel.mapnote': 'Kliknij: wybierz środek obszaru (pomarańczowa ramka ≈ obszar 20km, środek = cel) / Kółko: zoom / Przeciągnij: przesuń',
    'areasel.btnDefault': 'Wybierz obszar na mapie',
    'areasel.btnSelected': 'Leć tutaj ({name})',

    'briefing.title': 'Odprawa Zadania',
    'task.disciplineLabel': 'Konkurencja',
    'task.disciplineValue': 'JDG (Cel Wyznaczony przez Sędziego)',
    'task.targetLabel': 'Cel',
    'task.targetValue': 'Pomarańczowy X na mapie',
    'task.launchLabel': 'Start',
    'task.launchValue': 'Start indywidualny (kliknij mapę, by wybrać)',
    'task.timeLimitLabel': 'Limit Czasu',
    'task.timeLimitValue': '30:00 (czas gry)',
    'task.markerLabel': 'Znacznik',
    'task.markerValue': '1 (wciśnij M, by zrzucić)',
    'task.scoreLabel': 'Wynik',
    'task.scoreValue': 'Odległość miejsca lądowania znacznika od środka celu',
    'wind.sub': 'Dane Sondażu Pilotowego (edytowalne)',
    'wind.addBtn': '+ Wiersz',
    'wind.copyBtn': 'Kopiuj URL Warunków',
    'wind.thAlt': 'Wys. ft',
    'wind.thDir': 'Kier. °',
    'wind.thSpeed': 'Pręd. kt',
    'wind.presetCustom': 'Własne',
    'wind.delRowTitle': 'Usuń wiersz',
    'briefing.hintHtml':
      'Kierunek to kierunek SKĄD wieje wiatr (magnetyczny). Tabelę można edytować — wybierz gotowy zestaw lub dodaj/usuń wiersze.<br>' +
      'Startuj pod wiatr względem celu i zmieniaj wysokość, by korzystać z różnych warstw wiatru w jego kierunku.<br>' +
      '"Kopiuj URL Warunków" pozwala udostępnić link z dokładnie takimi samymi warunkami wiatru.',

    'gw.sub': 'Zmienność Wiatru przy Ziemi (beta)',
    'gw.enableLabel': 'Włącz',
    'gw.distLabel': 'Odległość do centrum wyżu',
    'gw.distUnit': 'km',
    'gw.hintHtml':
      'Wiatr przy ziemi może nie odpowiadać dokładnie wartościom z tabeli. Rzeczywista wartość jest ustalana raz, przy starcie, ' +
      'i ukryta przed pilotem. Podczas lotu wciśnij <b>G</b>, by poprosić ekipę naziemną o aktualizację przez radio ' +
      '(prędkość to tylko przybliżony szacunek).',
    'gw.reportPrefix': '📻 Od Ekipy Naziemnej',
    'gw.tierWeak': 'Słaby wiatr',
    'gw.tierNormal': 'Umiarkowany wiatr',
    'gw.tierStrong': 'Silny wiatr',

    'launch.btnDefault': 'Wybierz miejsce startu na mapie',
    'launch.btnSelected': 'Start! ({km} km do celu)',
    'launch.mapnote': 'Kafelki GSI (mapa standardowa) / Północ u góry / Kliknij: wybierz miejsce startu / Kółko: zoom / Przeciągnij: przesuń',

    'result.title': 'Wynik JDG',
    'result.retryBtn': 'Leć Ponownie',
    'result.replayBtn': '🎯 Powtórz Zrzut',
    'result.bestNew': 'Nowy rekord życiowy!',
    'result.bestExisting': 'Rekord życiowy: {m} m',
    'result.timeExpired': 'Czas minął: zmierzono w bieżącej pozycji',
    'result.launchDist': 'Start do celu: {m} m',
    'result.gwOn': 'Zmienność wiatru przy ziemi: Włączona',
    'result.gwOff': 'Zmienność wiatru przy ziemi: Wyłączona',
    'result.hideBtn': 'Ukryj ▾',
    'result.hideTitle': 'Ukryj wynik, by rozejrzeć się dookoła',
    'result.reopenBtn': 'Pokaż Wynik ▴',
    'copy.success': 'Skopiowano!',
    'copy.fail': 'Kopiowanie nieudane',

    'mp.title': '🎈 Lećmy Razem (beta)',
    'mp.namePlaceholder': 'Imię pilota',
    'mp.createBtn': 'Utwórz Pokój',
    'mp.joinHint': 'Masz kod od znajomego? Dołącz tutaj ↓',
    'mp.codePlaceholder': 'Kod',
    'mp.joinBtn': 'Dołącz',
    'mp.roomLabel': 'Pokój: ',
    'mp.self': '(ty)',
    'mp.copyBtn': 'Kopiuj URL Zaproszenia',
    'mp.copyOtherBtn': 'Kopiuj URL dla gracza na telefonie',
    'mp.waitingReady': 'Czekam, aż wszyscy będą gotowi',
    'mp.connecting': 'Łączenie…',
    'mp.connectFailed': '⚠ Nie udało się połączyć ({err})',
    'mp.inviteSent': 'Wyślij URL zaproszenia znajomym',
    'mp.enterName': 'Wpisz imię pilota',
    'mp.enterCode': 'Wpisz kod pokoju',
    'mp.readyBtn': 'Oznacz jako gotowy ({km} km do celu)',
    'mp.readyDone': '✅ Gotowy (kliknij, by anulować)',
    'mp.soloLink': 'Leć solo',
    'mp.waitingSetup': 'Czekam na warunki od gospodarza…',
    'mp.reconnectingAfterClose': '⚠ Utracono połączenie. Łączę ponownie…',
    'mp.reconnectingRematch': 'Łączę ponownie…',
    'mp.reconnected': 'Połączono ponownie',
    'mp.reconnectFailedSolo': '⚠ Nie udało się połączyć ponownie (kontynuacja solo. Zmiana karty spróbuje ponownie)',
    'mp.reconnectFailedReload': '⚠ Nie udało się połączyć ponownie. Odśwież stronę',
    'mp.startBtn': '🎈 Start Wspólny!',
    'mp.waitingPlayers': 'Czekam na graczy (min. 2, by zacząć)',
    'mp.boardHeader': 'Pokój {code} / Przyspieszenie ×{scale} (chcesz ×{desired})',
    'mp.disconnected': '💤 Rozłączony',
    'mp.landed': '📍 Zmierzono',
    'mp.dropped': '🎯 Zrzucono',
    'mp.resultsLeft': '(opuścił)',
    'mp.waitingRematch': 'Czekam na rewanż od gospodarza…',
    'mp.reloadToRetry': 'Odśwież stronę, by lecieć ponownie',
    'mp.waitingAllMeasure': '🎈 Czekam, aż wszyscy skończą…',
    'mp.markerMeasuredBeforeReload': 'Zmierzono (zatwierdzone przed odświeżeniem)',
    'mp.markerDroppedAlready': 'Już zrzucono',

    'mpJoin.title': 'Dołącz do Pokoju',
    'mpJoin.descHtml': 'Dołączanie do pokoju <b id="mp-join-code"></b>. Wybierz imię i kolor balonu.',
    'mpJoin.goBtn': 'Dołącz',

    'mpCountdown.label': 'Start za',

    'mpResults.title': '🏁 Wyniki (wszyscy potwierdzeni)',
    'mpResults.thRank': '#',
    'mpResults.thPilot': 'Pilot',
    'mpResults.thDist': 'Odległość',
    'mpResults.rematchBtn': 'Rewanż',

    'support.title': '🎈 Kibicuj Reprezentacji Japonii!',
    'support.text1': 'We wrześniu 2026 roku 7 pilotów będzie reprezentować Japonię na Mistrzostwach Świata w Balonach w Krośnie🇵🇱, w Polsce.',
    'support.tshirtBtn': 'Zamów Koszulkę Kibica',
    'support.text2':
      'Wybierz spośród 3 wzorów × 2 kolory każdy, z bawełny lub materiału dry-fit.<br>' +
      'Darowizny są również mile widziane. Darczyńcy otrzymują <b>specjalną wersję aplikacji</b>, w której można latać ' +
      'nad prawdziwym terenem Krosna, miasta-gospodarza Mistrzostw Świata.',
    'support.instaBtn': 'Informacje o darowiznach na Instagramie',

    'pibal.panelTitle': 'Dane Sondażu Pilotowego',
    'pibal.note': 'Wys.: n.p.m. / Kier.: <span id="pibal-mode-label">FROM</span> (magnetyczny)<br>*Deklinacja magnetyczna nieuwzględniona (prototyp)',

    'help.bodyHtml':
      '<b>Spacja</b> Palnik (przytrzymaj) <b>R</b> Odpowietrznik (przytrzymaj) <b>M</b> Zrzuć znacznik<br>' +
      '<b>V</b> Zmień widok (gondola/zewnętrzny) <b>1-4</b> Przyspieszenie ×1/×2/×4/×8<br>' +
      '<b>P</b> Pokaż/ukryj tabelę wiatru <b>G</b> Wywołaj ekipę naziemną (gdy zmienność włączona)<br>' +
      '<b>S</b> Dźwięk wł/wył Przeciąganie myszą: rozglądanie się / Kółko: zoom',

    'credit.html': 'Źródło: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">Kafelki GSI (Japoński Urząd Geoprzestrzenny)</a> (kafelki wysokościowe, najnowsze zdjęcia lotnicze)',

    'loading.generic': 'Wczytywanie terenu…',
    'loading.area': 'Wczytywanie terenu: {name}…',

    'area.saga': 'Saga - rzeka Kasegawa',
    'area.watarase': 'Zbiornik retencyjny Watarase',
    'area.saku': 'Saku - rzeka Chikuma',
    'area.ichinoseki': 'Ichinoseki - Hiraizumi',
    'area.kamishihoro': 'Kamishihoro (Hokkaido)',

    'windPreset.sagaMorning': 'Poranna rotacja w Saga (domyślne)',
    'windPreset.backing': 'Rotacja wsteczna (NE→NW)',
    'windPreset.steady': 'Stabilny (wiatr południowy)',
    'windPreset.strongVeer': 'Silny wiatr, duża rotacja',
  },
};

const SUPPORTED_LANGS = ['ja', 'en', 'pt', 'pl'];

function detectLang() {
  const urlLang = new URLSearchParams(location.search).get('lang');
  if (SUPPORTED_LANGS.includes(urlLang)) return urlLang;
  const saved = localStorage.getItem(LANG_KEY);
  if (SUPPORTED_LANGS.includes(saved)) return saved;
  const nav = (navigator.language || '').toLowerCase();
  const match = SUPPORTED_LANGS.find((l) => nav.startsWith(l));
  return match ?? 'en';
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
  document.documentElement.lang = LANG;
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
