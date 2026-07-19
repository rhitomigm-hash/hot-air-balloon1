// ルームのDurable Object。WebSocket入出力をRoomCore(純粋状態機械)に橋渡しする。
// 1ルーム=1 DOインスタンス(ルームコードから idFromName で決まる)。
import { RoomCore } from './room-core.js';

const TICK_MS = 250; // スナップショット配信間隔(4Hz)

export class RoomDO {
  constructor(state, env) {
    this.state = state;
    // 公開版は同時飛行4機まで(サーバー負荷低減のため。将来的にサーバーを増強し次第、
    // 上限は緩和する予定)。wrangler.toml の MAX_PLAYERS で上書きされる
    this.maxPlayers = Number(env.MAX_PLAYERS || 4);
    this.core = new RoomCore({ maxPlayers: this.maxPlayers });
    this.sockets = new Map(); // playerId -> WebSocket
    this.interval = null;
    // ルーム全体(在室者・ホスト・局面・スコア)を永続化しておく。スマホはアプリ切替
    // (LINE等)でWebSocketが切れ、全員切断でDOがメモリから破棄されることがある。
    // creed/setupだけでは「誰がホストか」「今リザルト画面か」が失われ、再入室者が
    // 新しいロビーの主だと誤認されて「もう一回戦」等が静かに失敗していた
    state.blockConcurrencyWhile(async () => {
      const saved = await state.storage.get('room');
      if (saved) {
        this.core = RoomCore.fromJSON(saved, { maxPlayers: this.maxPlayers });
        return;
      }
      // 後方互換: 導入前の created/setup だけの保存からの移行
      const created = await state.storage.get('created');
      const setup = await state.storage.get('setup');
      if (created) this.core.created = true;
      if (setup) this.core.setup = setup;
    });
  }

  persist() {
    this.state.storage.put('room', this.core.toJSON());
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocketでアクセスしてください', { status: 426 });
    }
    const name = url.searchParams.get('name') || '';
    const color = Number(url.searchParams.get('color'));
    const create = url.searchParams.get('create') === '1';

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const res = this.core.join(name, Number.isFinite(color) ? color : 0, create, Date.now());
    if (res.error) {
      server.send(JSON.stringify({ t: 'error', ...res.error }));
      server.close(4000, res.error.code);
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = res.id;
    const old = this.sockets.get(id);
    if (old && old !== server) {
      try { old.close(4001, 'reattached'); } catch { /* すでに死んでいる場合 */ }
    }
    this.sockets.set(id, server);
    this.persist(); // 入室成功=ルーム成立・在室者確定(冪等)
    this.dispatch(res.events);
    this.ensureTicker();

    server.addEventListener('message', (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.onMessage(id, m);
    });
    const onGone = () => {
      // 復帰(reattach)で新しいソケットに差し替わった後に、古いソケットのcloseが
      // 遅れて届くことがある。現役のソケットのcloseだけを退出として扱う
      if (this.sockets.get(id) !== server) return;
      this.sockets.delete(id);
      this.dispatch(this.core.leave(id, Date.now()).events);
      this.persist(); // 切断=connected:false の状態を、DOが破棄される前に必ず残す
      if (this.sockets.size === 0) this.stopTicker();
    };
    server.addEventListener('close', onGone);
    server.addEventListener('error', onGone);

    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(id, m) {
    const now = Date.now();
    // pos(5Hz)は頻度が高すぎるので永続化の対象外にする(取りこぼしても見た目上のみの影響)。
    // それ以外の局面が変わりうる操作は毎回保存し、DO破棄後の復帰で矛盾が起きないようにする
    const skipPersist = m.t === 'pos' || m.t === 'ping';
    let res;
    switch (m.t) {
      case 'ping': return; // ロビー待機中のキープアライブ(応答不要)
      case 'setup': res = this.core.setSetup(id, { area: m.area, wind: m.wind, groundWind: m.groundWind }); break;
      case 'ready': res = this.core.setReady(id, m.launch, now); break;
      case 'unready': res = this.core.setUnready(id); break;
      case 'start': res = this.core.start(id, now); break;
      case 'pos': res = this.core.pos(id, m.x, m.y, m.z, now, m.ts); break;
      case 'speed': res = this.core.speed(id, m.v, now); break;
      case 'drop': res = this.core.drop(id, now); break;
      case 'landed': res = this.core.landed(id, m.dist, now); break;
      case 'rematch': res = this.core.rematch(id); break;
      default: return;
    }
    if (res.error) {
      this.sendTo(id, { t: 'error', ...res.error });
      return;
    }
    if (!skipPersist) this.persist();
    this.dispatch(res.events);
  }

  ensureTicker() {
    if (this.interval) return;
    this.interval = setInterval(() => {
      const events = this.core.tick(Date.now());
      // snap(4Hz)だけの周回は保存しない。局面が変わる出来事(scale/timeup/results等)が
      // 混ざっている時だけ永続化する
      if (events.some((e) => e.msg.t !== 'snap')) this.persist();
      this.dispatch(events);
    }, TICK_MS);
  }
  stopTicker() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  dispatch(events) {
    for (const ev of events || []) {
      const data = JSON.stringify(ev.msg);
      if (ev.to === 'all') {
        for (const ws of this.sockets.values()) this.trySend(ws, data);
      } else {
        const ws = this.sockets.get(ev.to);
        if (ws) this.trySend(ws, data);
      }
    }
  }
  sendTo(id, msg) {
    const ws = this.sockets.get(id);
    if (ws) this.trySend(ws, JSON.stringify(msg));
  }
  trySend(ws, data) {
    try { ws.send(data); } catch { /* 切断済みはcloseイベント側で処理 */ }
  }
}
