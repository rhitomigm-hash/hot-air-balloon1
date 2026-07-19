import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomCore } from '../src/room-core.js';

const SETUP = { area: { lon: 21.75, lat: 49.68, name: 'クロスノ' }, wind: [[0, 140, 3], [1000, 190, 7]] };

// 2人がロビー→離陸→計測→リザルトまで進む標準ルームを組み立てるヘルパ
function makeFlyingRoom(t0 = 1000) {
  const room = new RoomCore({ countdownMs: 5000, taskSeconds: 1800 });
  const a = room.join('Alice', 2, true, t0);
  const b = room.join('Bob', 5, false, t0);
  room.setSetup(a.id, SETUP);
  room.setReady(a.id, { x: 100, z: 2000 });
  room.setReady(b.id, { x: -300, z: 1800 });
  room.start(a.id, t0);
  room.tick(t0 + 5000); // countdown明け → flying
  return { room, aid: a.id, bid: b.id, t: t0 + 5000 };
}

const msgs = (events, type) => events.filter((e) => e.msg.t === type);

test('未作成ルームへの参加は拒否、create=1で作成', () => {
  const room = new RoomCore();
  assert.equal(room.join('X', 0, false, 0).error.code, 'no_room');
  const r = room.join('Host', 1, true, 0);
  assert.ok(r.id);
  const hello = msgs(r.events, 'hello')[0];
  assert.equal(hello.msg.host, true);
  assert.equal(hello.to, r.id);
});

test('満員・重複入室制御', () => {
  const room = new RoomCore({ maxPlayers: 2 });
  room.join('A', 0, true, 0);
  room.join('B', 0, false, 0);
  assert.equal(room.join('C', 0, false, 0).error.code, 'full');
});

test('ホスト以外はsetup/start/rematchできない', () => {
  const room = new RoomCore();
  const a = room.join('A', 0, true, 0);
  const b = room.join('B', 0, false, 0);
  assert.equal(room.setSetup(b.id, SETUP).error.code, 'not_host');
  room.setSetup(a.id, SETUP);
  room.setReady(a.id, { x: 0, z: 100 });
  room.setReady(b.id, { x: 0, z: 200 });
  assert.equal(room.start(b.id, 0).error.code, 'not_host');
});

test('全員準備完了でないと開始できない・2人未満は開始できない', () => {
  const room = new RoomCore();
  const a = room.join('A', 0, true, 0);
  room.setSetup(a.id, SETUP);
  room.setReady(a.id, { x: 0, z: 100 });
  assert.equal(room.start(a.id, 0).error.code, 'need_players');
  const b = room.join('B', 0, false, 0);
  assert.equal(room.start(a.id, 0).error.code, 'not_ready');
  room.setReady(b.id, { x: 0, z: 200 });
  const r = room.start(a.id, 1000);
  assert.equal(msgs(r.events, 'countdown')[0].msg.startAt, 6000);
  assert.equal(room.state, 'countdown');
});

test('満室+全員準備完了で、ホストの開始操作なしに自動的にカウントダウンへ入る(公開版4機制限)', () => {
  const room = new RoomCore({ maxPlayers: 2, countdownMs: 5000 });
  const a = room.join('A', 0, true, 0);
  const b = room.join('B', 0, false, 0);
  room.setSetup(a.id, SETUP);
  const r1 = room.setReady(a.id, { x: 0, z: 100 }, 1000);
  assert.equal(msgs(r1.events, 'countdown').length, 0); // まだ1人目、満室ではない
  assert.equal(room.state, 'lobby');
  const r2 = room.setReady(b.id, { x: 0, z: 200 }, 1000);
  assert.equal(msgs(r2.events, 'countdown')[0].msg.startAt, 6000);
  assert.equal(room.state, 'countdown');
});

test('満室でも準備未了の人がいれば自動開始しない', () => {
  const room = new RoomCore({ maxPlayers: 2 });
  const a = room.join('A', 0, true, 0);
  room.join('B', 0, false, 0);
  room.setSetup(a.id, SETUP);
  const r = room.setReady(a.id, { x: 0, z: 100 }, 1000);
  assert.equal(msgs(r.events, 'countdown').length, 0);
  assert.equal(room.state, 'lobby');
});

test('条件を変えると全員のreadyが解除される', () => {
  const room = new RoomCore();
  const a = room.join('A', 0, true, 0);
  const b = room.join('B', 0, false, 0);
  room.setSetup(a.id, SETUP);
  room.setReady(a.id, { x: 0, z: 1 });
  room.setReady(b.id, { x: 0, z: 2 });
  room.setSetup(a.id, SETUP);
  assert.ok([...room.players.values()].every((p) => !p.ready));
});

test('countdown明けにflyingへ遷移し、snapに位置と時計が載る', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  assert.equal(room.state, 'flying');
  room.pos(aid, 100, 350, 2000, t + 100, 12345); // ts=送信側時刻
  room.pos(bid, -300, 400, 1800, t + 100);       // ts省略(旧クライアント互換)
  const events = room.tick(t + 250);
  const snap = msgs(events, 'snap')[0].msg;
  assert.equal(snap.p.length, 2);
  assert.equal(snap.scale, 1);
  assert.ok(snap.clock <= 1800);
  // 送信側タイムスタンプが素通しされる(クライアントの速度推定用)
  const rowA = snap.p.find((r) => r[0] === aid);
  const rowB = snap.p.find((r) => r[0] === bid);
  assert.equal(rowA[4], 12345);
  assert.equal(rowB[4], null);
});

test('タイムスケールは全員の希望の最小値', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.pos(aid, 0, 300, 0, t);
  room.pos(bid, 0, 300, 0, t);
  let ev = room.speed(aid, 8, t + 1000);
  assert.equal(ev.events.length, 0); // Bobが×1のままなので変わらない
  assert.equal(room.scale, 1);
  ev = room.speed(bid, 4, t + 2000);
  assert.equal(msgs(ev.events, 'scale')[0].msg.v, 4); // min(8,4)=4
  ev = room.speed(aid, 2, t + 3000);
  assert.equal(msgs(ev.events, 'scale')[0].msg.v, 2);
});

test('計測済みプレイヤーは加速集計から除外される', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.pos(aid, 10, 300, 20, t);
  room.pos(bid, 0, 300, 0, t);
  room.speed(bid, 8, t + 100);
  assert.equal(room.scale, 1); // Alice(×1)がブレーキ
  room.drop(aid, t + 200);
  const ev = room.landed(aid, 12.3, t + 300);
  assert.equal(msgs(ev.events, 'scale')[0].msg.v, 8); // Aliceが抜けてBobの×8が通る
});

test('AFK(60秒間posなし)は加速集計から除外される', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.pos(aid, 0, 300, 0, t);
  room.pos(bid, 0, 300, 0, t);
  room.speed(bid, 4, t + 100);
  assert.equal(room.scale, 1);
  // Aliceが60秒無通信 → tickでBobの希望が通る
  room.pos(bid, 0, 300, 0, t + 61_000);
  const events = room.tick(t + 61_500);
  assert.equal(msgs(events, 'scale')[0].msg.v, 4);
});

test('時計はスケールに比例して進む', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.pos(aid, 0, 300, 0, t);
  room.pos(bid, 0, 300, 0, t);
  room.speed(aid, 4, t);
  room.speed(bid, 4, t);
  room.tick(t + 10_000); // 実時間10秒 × ×4 = ゲーム内40秒
  assert.ok(Math.abs(room.clock - (1800 - 40)) < 1.5, `clock=${room.clock}`);
});

test('全員計測でresultsが距離昇順で配信される', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.drop(aid, t + 100);
  room.landed(aid, 55.5, t + 200);
  room.drop(bid, t + 300);
  const ev = room.landed(bid, 3.2, t + 400);
  const rows = msgs(ev.events, 'results')[0].msg.rows;
  assert.deepEqual(rows.map((r) => r.name), ['Bob', 'Alice']);
  assert.equal(room.state, 'results');
});

test('タイムアップ→猶予経過で未計測者は現在地距離で強制確定', () => {
  const room = new RoomCore({ countdownMs: 0, taskSeconds: 10, graceMs: 5000 });
  const a = room.join('A', 0, true, 0);
  const b = room.join('B', 0, false, 0);
  room.setSetup(a.id, SETUP);
  room.setReady(a.id, { x: 0, z: 1 });
  room.setReady(b.id, { x: 0, z: 2 });
  room.start(a.id, 0);
  room.tick(0);
  room.pos(a.id, 30, 300, 40, 1000); // 原点(ターゲット)から50m
  room.pos(b.id, 300, 300, 400, 1000); // 500m
  let events = room.tick(11_000); // 10秒の制限を超過
  assert.equal(msgs(events, 'timeup').length, 1);
  events = room.tick(16_100); // 猶予5秒経過
  const rows = msgs(events, 'results')[0].msg.rows;
  assert.equal(rows[0].dist, 50);
  assert.equal(rows[1].dist, 500);
});

test('飛行中の切断は即脱落にならず、復帰猶予後に現在地計測で確定する', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.pos(aid, 30, 300, 40, t + 100);
  room.drop(bid, t + 200);
  room.landed(bid, 8.8, t + 300);
  let ev = room.leave(aid, t + 400);
  assert.equal(msgs(ev.events, 'results').length, 0); // まだ確定しない(復帰待ち)
  assert.equal(room.players.get(aid).landed, false);
  // 猶予(60秒)経過 → tickが現在地距離で強制確定し、全員確定でresults
  const events = room.tick(t + 400 + 61_000);
  const rows = msgs(events, 'results')[0].msg.rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dist, 8.8);
  assert.equal(rows[1].dist, 50);
  assert.equal(rows[1].left, true);
});

test('飛行中に切断→同名で再入室すると同じ機体に復帰できる', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.pos(aid, 30, 300, 40, t + 100);
  room.leave(aid, t + 200);
  assert.equal(room.players.get(aid).connected, false);
  // 別名は復帰できない
  assert.equal(room.join('Zoe', 1, false, t + 500).error.code, 'in_flight');
  // 同名なら同じidで復帰し、helloに飛行状況(時計・加速)が載る
  const r = room.join('Alice', 2, false, t + 1000);
  assert.equal(r.reattach, true);
  assert.equal(r.id, aid);
  const hello = msgs(r.events, 'hello')[0].msg;
  assert.equal(hello.state, 'flying');
  assert.ok(hello.clock <= 1800);
  assert.deepEqual(hello.launch, { x: 100, z: 2000 }); // 離陸地点選択をやり直さず即再開するため
  assert.deepEqual(hello.pos, { x: 30, y: 300, z: 40 }); // 切断時の位置から再開(リロードのズル防止)
  assert.equal(room.players.get(aid).connected, true);
  // 復帰後は通常どおり計測でき、猶予切れの強制確定は起きない
  room.drop(aid, t + 1100);
  room.drop(bid, t + 1100);
  room.landed(bid, 5, t + 1200);
  const ev = room.landed(aid, 2, t + 90_000);
  const rows = msgs(ev.events, 'results')[0].msg.rows;
  assert.equal(rows[0].dist, 2);
  assert.equal(rows[0].left, false);
});

test('リザルト中に切断したホストも復帰でき、rematchを送れる', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.drop(aid, t); room.landed(aid, 5, t);
  room.drop(bid, t); room.landed(bid, 9, t);
  assert.equal(room.state, 'results');
  room.leave(aid, t + 1000); // ホストがアプリ切替等で切断
  const r = room.join('Alice', 2, false, t + 3000);
  assert.equal(r.reattach, true);
  assert.equal(r.id, aid);
  const ev = room.rematch(aid);
  assert.equal(msgs(ev.events, 'rematch').length, 1);
  assert.equal(room.state, 'lobby');
  // 切断したまま戻らなかったプレイヤーは次ラウンドから外れる…今回は全員復帰済みなので2人残る
  assert.equal(room.players.size, 2);
});

test('ホスト切断で次に古い入室者へ移譲', () => {
  const room = new RoomCore();
  const a = room.join('A', 0, true, 0);
  const b = room.join('B', 0, false, 0);
  const c = room.join('C', 0, false, 0);
  room.leave(a.id, 100);
  assert.equal(room.hostId, b.id);
  room.leave(b.id, 200);
  assert.equal(room.hostId, c.id);
});

test('rematchでロビーへ戻り、成績・準備・退室者がリセットされる', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.drop(aid, t);
  room.landed(aid, 5, t);
  room.leave(bid, t + 100); // Bobは切断(復帰猶予つき)
  room.tick(t + 100 + 61_000); // 猶予切れで現在地計測 → 全員確定でresultsへ
  assert.equal(room.state, 'results');
  const ev = room.rematch(aid);
  assert.equal(room.state, 'lobby');
  assert.equal(msgs(ev.events, 'rematch').length, 1);
  assert.equal(room.players.size, 1); // 退室済みBobは消える
  const alice = room.players.get(aid);
  assert.equal(alice.landed, false);
  assert.equal(alice.dist, null);
  assert.equal(alice.ready, false);
  // 同じルームで次のラウンドを開始できる
  const d = room.join('Dave', 3, false, t + 500);
  room.setReady(aid, { x: 0, z: 1 });
  room.setReady(d.id, { x: 0, z: 2 });
  assert.equal(room.start(aid, t + 600).error, undefined);
});

test('フライト中の途中参加は拒否される', () => {
  const { room } = makeFlyingRoom();
  assert.equal(room.join('Late', 0, false, 99_999).error.code, 'in_flight');
});

test('再戦→全員リロードで入り直せる(もう一回戦フロー)', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.drop(aid, t); room.landed(aid, 5, t);
  room.drop(bid, t); room.landed(bid, 9, t);
  room.rematch(aid); // state → lobby
  room.leave(aid, t + 100); // 各クライアントがリロードで切断
  room.leave(bid, t + 200);
  assert.equal(room.state, 'lobby');
  assert.equal(room.players.size, 0);
  assert.ok(room.setup); // 条件は保持される
  const r = room.join('Alice', 2, false, t + 500); // create不要で入れる
  assert.ok(r.id);
  assert.equal(room.hostId, r.id); // 最初の再入室者が新ホスト
});

// ---- 永続化(DO破棄→復元)のテスト ----
// 2026-07-18に実機で発見: 全員切断でDOがメモリから破棄されると、
// created/setupしか保存していなかったため復帰後に「新しいロビー」と誤認され、
// リザルト画面の「もう一回戦」がbad_stateで静かに失敗していた

test('toJSON/fromJSONの往復でロビーの状態が保たれる', () => {
  const room = new RoomCore();
  const a = room.join('Alice', 2, true, 0);
  room.join('Bob', 5, false, 0);
  room.setSetup(a.id, SETUP);
  const restored = RoomCore.fromJSON(room.toJSON(), {});
  assert.equal(restored.state, 'lobby');
  assert.equal(restored.hostId, a.id);
  assert.equal(restored.created, true);
  assert.deepEqual(restored.setup, { ...SETUP, groundWind: null });
  assert.equal(restored.players.size, 2);
});

test('全員切断→DO破棄(復元)後も、同名の再入室でホストとしてリザルトに復帰しrematchできる', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.drop(aid, t); room.landed(aid, 5, t);
  room.drop(bid, t); room.landed(bid, 9, t);
  assert.equal(room.state, 'results');
  room.leave(aid, t + 100); // ホストがアプリ切替等で切断
  room.leave(bid, t + 200); // ゲストも切断(全員切断)

  // ここでDOがメモリから破棄され、次のアクセスで作り直される状況を再現
  const restored = RoomCore.fromJSON(room.toJSON(), {});
  assert.equal(restored.state, 'results'); // ロビーに巻き戻っていない
  assert.equal(restored.hostId, aid);

  // ホストがcreate=1で再入室 → 新規ロビーではなく「復帰」として扱われる
  const r = restored.join('Alice', 2, true, t + 5000);
  assert.equal(r.reattach, true);
  assert.equal(r.id, aid);
  assert.equal(restored.state, 'results'); // 状態は変わらない

  // 「もう一回戦」がbad_state/not_hostで失敗せず成功する
  const ev = restored.rematch(aid);
  assert.equal(ev.error, undefined);
  assert.equal(msgs(ev.events, 'rematch').length, 1);
  assert.equal(restored.state, 'lobby');
});

test('復元後、飛行中の時計はジャンプせず復元直後を起点に進む', () => {
  const room = new RoomCore({ countdownMs: 0, taskSeconds: 1800 });
  const a = room.join('Alice', 2, true, 0);
  const b = room.join('Bob', 5, false, 0);
  room.setSetup(a.id, SETUP);
  room.setReady(a.id, { x: 0, z: 1 });
  room.setReady(b.id, { x: 0, z: 2 });
  room.start(a.id, 0);
  room.tick(0); // countdown明け→flying
  room.clock = 1200; // 30分中10分経過した想定

  const restored = RoomCore.fromJSON(room.toJSON(), {});
  assert.equal(restored.state, 'flying');
  const events = restored.tick(Date.now() + 50); // 復元「直後」の最初のtick
  const snap = msgs(events, 'snap')[0].msg;
  assert.ok(Math.abs(snap.clock - 1200) <= 1, `clock jumped: ${snap.clock}`); // 大きくジャンプしない
});

// ---- ゾンビ(切断通知が届かない切断)対策のテスト ----
// リロードや強制終了ではWebSocketのcloseがサーバーに届かないことがある

test('位置更新が止まった機体はスナップショットから外れる(空中で固まった気球の防止)', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.pos(aid, 10, 300, 20, t + 100);
  room.pos(bid, 30, 300, 40, t + 100);
  let snap = msgs(room.tick(t + 250), 'snap')[0].msg;
  assert.equal(snap.p.length, 2);
  // Aliceの位置更新が5秒止まる(切断通知は届いていない=connectedのまま)
  room.pos(bid, 31, 300, 41, t + 5200);
  snap = msgs(room.tick(t + 5300), 'snap')[0].msg;
  assert.equal(snap.p.length, 1, '固まった機体は配信から外れる');
  assert.equal(snap.p[0][0], bid);
  // 復帰(posが再開)すれば再び配信される
  room.pos(aid, 11, 300, 21, t + 6000);
  snap = msgs(room.tick(t + 6100), 'snap')[0].msg;
  assert.equal(snap.p.length, 2);
});

test('切断通知が届いていなくても、位置更新が止まっていれば同名で復帰できる', () => {
  const { room, aid, bid, t } = makeFlyingRoom();
  room.pos(aid, 10, 300, 20, t + 100);
  room.pos(bid, 0, 300, 0, t + 100);
  // Aliceがリロード(closeは届かず connected=true のまま)。5秒後に再入室
  const r = room.join('Alice', 2, true, t + 5200);
  assert.equal(r.reattach, true, 'ゾンビ席への復帰が許可される');
  assert.equal(r.id, aid);
  // 位置更新が新鮮な席(Bobは直前までposを送っている)は同名でも乗っ取れない
  room.pos(bid, 1, 300, 1, t + 5250);
  const bad = room.join('Bob', 5, false, t + 5300);
  assert.equal(bad.error.code, 'in_flight');
});

// ---- 地上風のゆらぎ(β): マルチプレイでの隠しパラメータ共有 ----
// サーバーは中身を解釈せず、ホストが決めた値をそのまま全員に配って
// toJSON/fromJSON(DO復元)を経ても同じ値を保つことだけを保証する
test('地上風ゆらぎの隠しパラメータがsetupで配布され、復元後も保たれる', () => {
  const room = new RoomCore();
  const a = room.join('Alice', 2, true, 0);
  const gw = { distKm: 200, veerOffset: 12.3, speedFactor: 0.55, dirPeriod: 300, dirPhase: 1, ktPeriod: 280, ktPhase: 2 };
  const res = room.setSetup(a.id, { ...SETUP, groundWind: gw });
  const setupEvent = res.events.find((e) => e.msg.t === 'setup');
  assert.deepEqual(setupEvent.msg.groundWind, gw, '全員への配布メッセージにそのまま載る');
  const restored = RoomCore.fromJSON(room.toJSON(), {});
  assert.deepEqual(restored.setup.groundWind, gw, 'DO復元後も同じ値のまま');
});

test('地上風ゆらぎを使わない場合はgroundWindがnullのまま配布される', () => {
  const room = new RoomCore();
  const a = room.join('Alice', 2, true, 0);
  const res = room.setSetup(a.id, SETUP);
  const setupEvent = res.events.find((e) => e.msg.t === 'setup');
  assert.equal(setupEvent.msg.groundWind, null);
});
