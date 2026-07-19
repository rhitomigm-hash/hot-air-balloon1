# マルチプレイ用サーバー(Cloudflare Workers + Durable Objects)

熱気球フライトゲーム公開版のリアルタイム同時プレイ(ゴーストバルーン方式)のバックエンド。
1ルーム=1 Durable Object。位置はサーバーで集約し4Hzのスナップショットで一斉配信する。

このサーバーは寄付者版(`balloon-supporters`リポジトリ)のマルチプレイサーバーとは
**別デプロイ**です(`wrangler.toml`の`name`が異なるため、同じCloudflareアカウントに
両方デプロイしても別々のWorker・別々のルームコード空間になります)。

**公開版は同時飛行4機まで**(`wrangler.toml`の`MAX_PLAYERS`)に制限しています。
サーバー負荷を低く抑えるための暫定措置で、将来的にサーバーを増強し次第、上限は
緩和する予定です。満室(4人)になった時点で全員が準備完了していれば、ホストが
「開始」を押さなくても自動的にカウントダウンへ入ります(`RoomCore.setReady`)。

## デプロイ手順

1. Cloudflareアカウントを用意(**無料プランでOK**。Durable ObjectsはSQLite保存方式なら無料枠で使える)
2. `npm install -g wrangler` して `wrangler login`
3. このディレクトリで `wrangler deploy`
4. 表示されたURL(例 `https://balloon-multiplayer-public.<account>.workers.dev`)を
   `mobile/net.js` と `prototype/net.js` の `DEFAULT_SERVER` に設定
   (またはゲームURLに `?server=` で指定)

### 無料枠の目安と有料化の判断

- 無料プランのDOリクエスト上限は1日10万件。位置送信は1人あたり毎秒5件なので、
  **2人×45分のフライトで約27,000件 = 1日3〜4フライトが目安**(時間加速を使えば実時間が
  縮むのでさらに余裕が出る)
- 上限に当たると課金されるのではなく**その日は止まるだけ**(翌日回復)
- 公開版は寄付者版よりアクセスが読めないため、無料枠の消費ペースは運用しながら要観察
- 毎日遊ぶ・大人数(8人超)・100機イベントをやる段階になったら
  Workers有料プラン(月$5、月1,000万件込み)へ切り替える

## テスト

サーバーの状態機械(`src/room-core.js`)はI/O非依存の純粋クラスなので、Nodeだけでテストできる:

```
npm test
```

## プロトコル概要(JSON over WebSocket)

接続: `wss://…/ws/<ROOMCODE>?name=<名前>&color=<0-11>&create=<1|0>`

| 方向 | メッセージ | 意味 |
|---|---|---|
| C→S | `{t:'setup', area, wind, groundWind}` | ホストが条件(エリア・風・地上風ゆらぎの隠しパラメータ)を配布 |
| C→S | `{t:'ready', launch:{x,z}}` / `{t:'unready'}` | 準備完了/解除 |
| C→S | `{t:'start'}` | ホストが開始(全員準備完了が条件。満室+全員準備完了なら`ready`の時点で自動開始されるため送る必要はない) |
| C→S | `{t:'pos', x,y,z,ts}` | 自機位置(5Hz。tsは送信側時刻でゴースト速度推定に使う) |
| C→S | `{t:'speed', v}` | 希望タイムスケール(1/2/4/8) |
| C→S | `{t:'drop'}` / `{t:'landed', dist}` | マーカー投下/着地計測 |
| C→S | `{t:'rematch'}` | ホストがもう一回戦 |
| S→C | `{t:'hello', id, host, state, setup, players, launch, pos, dropped, landed, clock, scale}` | 入室応答(復帰時は飛行状態も含む) |
| S→C | `{t:'roster', players}` | 在室者一覧(準備・投下✓含む) |
| S→C | `{t:'setup', area, wind, groundWind}` | 条件配布 |
| S→C | `{t:'countdown', inMs}` | 同時離陸カウントダウン(相対ミリ秒) |
| S→C | `{t:'snap', clock, scale, p:[[id,x,y,z,ts],…]}` | 位置スナップショット(4Hz) |
| S→C | `{t:'scale', v}` | 合意タイムスケール変更 |
| S→C | `{t:'timeup'}` | 制限時間切れ(クライアントは現在地計測して landed を送る) |
| S→C | `{t:'results', rows}` | 全員確定後の順位表 |
| S→C | `{t:'rematch'}` | ロビーに戻る |
| S→C | `{t:'error', code, msg}` | エラー |
