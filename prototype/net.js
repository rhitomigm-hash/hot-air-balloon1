// マルチプレイ通信モジュール(WebSocket)。three.js非依存。
// プロトコルは server/README.md 参照。描画はmain.js側が行い、
// ここでは接続・送受信・スナップショット補間だけを担当する。

// デプロイ済みのWorkers URL(?server= で上書き可能。../server/README.md参照)
const DEFAULT_SERVER = 'wss://balloon-multiplayer-public.hotairballoongames2026.workers.dev';

const POS_SEND_MS = 200;    // 自機位置の送信間隔(5Hz)
const PREDICT_CAP_S = 0.6;  // スナップショット途絶時に速度外挿を続ける上限(秒)

export function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (!q) return DEFAULT_SERVER;
  return q.replace(/^http/, 'ws');
}

// 紛らわしい文字(0/O, 1/I)を除いたルームコードを生成
export function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 球皮カラーパレット(12色)。[外面の濃淡2色, 縫い目, UI表示用]
export const BALLOON_COLORS = [
  { name: '赤',     cols: ['#c62828', '#a81f1f'], seam: '#7a1515', ui: '#e53935' },
  { name: '青',     cols: ['#1565c0', '#0d47a1'], seam: '#0a3576', ui: '#1e88e5' },
  { name: '緑',     cols: ['#2e7d32', '#1b5e20'], seam: '#124116', ui: '#43a047' },
  { name: '黄',     cols: ['#f9a825', '#f57f17'], seam: '#b35c10', ui: '#fdd835' },
  { name: '紫',     cols: ['#6a1b9a', '#4a148c'], seam: '#380f6b', ui: '#8e24aa' },
  { name: '橙',     cols: ['#ef6c00', '#e65100'], seam: '#a63a00', ui: '#fb8c00' },
  { name: '水色',   cols: ['#0097a7', '#006064'], seam: '#004347', ui: '#00bcd4' },
  { name: 'ピンク', cols: ['#d81b60', '#ad1457'], seam: '#800e3f', ui: '#ec407a' },
  { name: '白',     cols: ['#eceff1', '#cfd8dc'], seam: '#90a4ae', ui: '#eceff1' },
  { name: '黒',     cols: ['#37474f', '#263238'], seam: '#101519', ui: '#546e7a' },
  { name: '黄緑',   cols: ['#9e9d24', '#827717'], seam: '#5a5210', ui: '#c0ca33' },
  { name: '茶',     cols: ['#6d4c41', '#4e342e'], seam: '#33211c', ui: '#8d6e63' },
];

export class Room {
  constructor() {
    this.ws = null;
    this.id = null;
    this.isHost = false;
    this.players = [];       // 最新roster
    this.setup = null;
    this.scale = 1;
    this.clock = null;
    this.handlers = new Map();
    this.lastPosSent = 0;
    // ゴースト予測バッファ: id -> {x,y,z, vx,vy,vz, at}
    // 受信間隔のばらつきをそのまま再生すると揺れて見えるため、区間補間ではなく
    // 「最新位置+推定速度で外挿した目標点」を返し、描画側がなめらかに追いかける
    this.ghosts = new Map();
  }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  emit(type, data) { const fn = this.handlers.get(type); if (fn) fn(data); }

  connect({ code, name, color, create }) {
    const url = `${serverUrl()}/ws/${code}?name=${encodeURIComponent(name)}&color=${color}&create=${create ? 1 : 0}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.addEventListener('message', (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'hello') {
          this.id = m.id;
          this.isHost = m.host;
          this.players = m.players;
          this.setup = m.setup;
          this.hello = m; // 復帰時はstate/clock/scaleが入っている(呼び出し側が参照)
          // ロビー待機中は無通信が続くため、中継装置に切られないようキープアライブを打つ
          this.keepalive = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) this.send({ t: 'ping' });
          }, 30_000);
          if (!settled) { settled = true; resolve(this); }
          return;
        }
        if (m.t === 'error' && !settled) { settled = true; reject(new Error(m.msg || m.code)); return; }
        this.onMessage(m);
      });
      ws.addEventListener('close', () => {
        clearInterval(this.keepalive);
        if (!settled) { settled = true; reject(new Error('接続できませんでした')); }
        this.emit('close');
      });
      ws.addEventListener('error', () => { /* closeで処理 */ });
    });
  }

  get alive() { return this.ws && this.ws.readyState === WebSocket.OPEN; }

  onMessage(m) {
    switch (m.t) {
      case 'roster':
        this.players = m.players;
        // ホスト移譲の反映
        this.isHost = m.players.some((p) => p.id === this.id && p.host);
        this.emit('roster', m.players);
        break;
      case 'setup':
        this.setup = { area: m.area, wind: m.wind, groundWind: m.groundWind ?? null };
        this.emit('setup', this.setup);
        break;
      case 'countdown': this.emit('countdown', m); break;
      case 'snap': {
        this.scale = m.scale;
        this.clock = m.clock;
        const at = performance.now();
        for (const [id, x, y, z, ts] of m.p) {
          if (id === this.id) continue;
          const g = this.ghosts.get(id);
          if (g) {
            if (ts != null && g.ts != null) {
              if (ts <= g.ts) continue; // 同じサンプルの再配信。速度・位置とも触らない
              // 送信側タイムスタンプの差=実際のサンプル間隔で速度を出す(脈動しない)
              const dt = Math.min(1.5, Math.max(0.05, (ts - g.ts) / 1000));
              g.vx = (x - g.x) / dt;
              g.vy = (y - g.y) / dt;
              g.vz = (z - g.z) / dt;
            } else {
              // 旧サーバー互換: 受信間隔ベースの推定
              const dt = Math.min(1.0, Math.max(0.1, (at - g.at) / 1000));
              g.vx = (x - g.x) / dt;
              g.vy = (y - g.y) / dt;
              g.vz = (z - g.z) / dt;
            }
            g.x = x; g.y = y; g.z = z; g.at = at; g.ts = ts;
          } else {
            this.ghosts.set(id, { x, y, z, vx: 0, vy: 0, vz: 0, at, ts });
          }
        }
        // スナップに現れなくなった機体(退室)は掃除
        const seen = new Set(m.p.map((r) => r[0]));
        for (const id of this.ghosts.keys()) if (!seen.has(id)) this.ghosts.delete(id);
        this.emit('snap', m);
        break;
      }
      case 'scale': this.scale = m.v; this.emit('scale', m.v); break;
      case 'drop': this.emit('drop', m.id); break;
      case 'timeup': this.emit('timeup'); break;
      case 'results': this.emit('results', m.rows); break;
      case 'rematch': this.emit('rematch'); break;
      case 'error': this.emit('error', m); break;
      default: break;
    }
  }

  // 各ゴーストの「目標位置」(最新位置+推定速度で外挿)を返す。
  // 描画側はこの目標をなめらかに追いかける(main.jsのupdateGhosts参照)
  sampleGhosts() {
    const now = performance.now();
    const out = [];
    for (const [id, g] of this.ghosts) {
      const t = Math.min(PREDICT_CAP_S, (now - g.at) / 1000);
      out.push({ id, x: g.x + g.vx * t, y: g.y + g.vy * t, z: g.z + g.vz * t });
    }
    return out;
  }

  // 1機分の現在位置(外挿込み)+推定速度を返す。他機のマーカー投下演出の
  // 初速に使う(マーカーは計測目的ではなく見た目のためだけなので、この程度の
  // 精度で十分。サーバーには位置しか無く、投下位置・初速は送っていない)
  ghostSnapshot(id) {
    const g = this.ghosts.get(id);
    if (!g) return null;
    const t = Math.min(PREDICT_CAP_S, (performance.now() - g.at) / 1000);
    return {
      x: g.x + g.vx * t, y: g.y + g.vy * t, z: g.z + g.vz * t,
      vx: g.vx, vy: g.vy, vz: g.vz,
    };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  sendSetup(area, wind, groundWind) { this.send({ t: 'setup', area, wind, groundWind: groundWind ?? null }); }
  sendReady(launch) { this.send({ t: 'ready', launch }); }
  sendUnready() { this.send({ t: 'unready' }); }
  sendStart() { this.send({ t: 'start' }); }
  sendSpeed(v) { this.send({ t: 'speed', v }); }
  sendDrop() { this.send({ t: 'drop' }); }
  sendLanded(dist) { this.send({ t: 'landed', dist }); }
  sendRematch() { this.send({ t: 'rematch' }); }
  sendPos(x, y, z) {
    const now = performance.now();
    if (now - this.lastPosSent < POS_SEND_MS) return;
    this.lastPosSent = now;
    // ts: 送信側の時刻(ms)。受信側はこの差分から正確なサンプル間隔を得て速度を推定する
    // (受信間隔で割ると、送信5Hz/配信4Hzのずれで速度が脈動し、動きが波打って見える)
    this.send({
      t: 'pos', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(z * 10) / 10,
      ts: Math.round(now),
    });
  }

  close() { clearInterval(this.keepalive); if (this.ws) this.ws.close(); }
}
