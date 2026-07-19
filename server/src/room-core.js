// マルチプレイのルーム状態機械(I/O非依存の純粋クラス)。
// Durable Object からもNodeの単体テストからも同じコードを使う。
//
// 状態遷移: lobby → countdown → flying → results → (rematch) → lobby
//
// 設計の要点(仕様検討メモ参照):
// - ゴーストバルーン方式: サーバーは位置の中継のみ。物理・スコア計測はクライアント側
// - 下り通信はスナップショット集約(tick()が全機位置を1メッセージにまとめる)。100機対応の要
// - 時間加速は「飛行中(未計測)の全員の希望の最小値」。AFKは集計から除外
// - 全員の計測が確定した時点で順位表を一斉配信。時間切れは現在地距離で強制確定
// - ターゲットはワールド原点(0,0)にある前提なので、サーバー側でも last pos から距離を出せる

export const TIMESCALES = [1, 2, 4, 8];

export class RoomCore {
  constructor(opts = {}) {
    this.maxPlayers = opts.maxPlayers ?? 16;
    this.taskSeconds = opts.taskSeconds ?? 30 * 60;
    this.countdownMs = opts.countdownMs ?? 5000;
    this.afkMs = opts.afkMs ?? 60_000;      // この間 pos が来なければ加速集計から除外
    this.graceMs = opts.graceMs ?? 20_000;  // タイムアップ後、未計測者を強制確定するまでの猶予
    // 飛行中に切断してから復帰(再入室)を待つ猶予。スマホのアプリ切替はWebSocketが
    // 切れるのが正常系なので、この間は脱落扱いにせず席を保持する
    this.reconnectGraceMs = opts.reconnectGraceMs ?? 60_000;
    // 位置がこの時間更新されていない機体はスナップショットから外す(ゾンビ対策)。
    // リロードや強制終了では切断通知が届かないことがあり、そのまま配信し続けると
    // 他プレイヤーには空中で固まった気球が見え続ける
    this.stalePosMs = opts.stalePosMs ?? 4000;
    this.state = 'lobby';
    this.created = false;   // create=1 の初回入室で立つ。未作成ルームへの参加は拒否
    this.players = new Map();
    this.hostId = null;
    this.setup = null;      // { area:{lon,lat,name?}, wind:[[ft,dir,kt],...] }
    this.scale = 1;
    this.clock = this.taskSeconds;
    this.lastTickAt = null;
    this.startAt = null;    // countdown 終了(離陸)時刻 ms
    this.timeupAt = null;
    this.nextId = 1;
  }

  // ---- 永続化(DOがメモリから破棄・再生成されても状態を失わないため) ----
  // ルームの存在(created)と条件(setup)だけでなく、誰がいるか・誰がホストか・
  // 今どの局面(state)かも保存する。これが無いと、全員切断でDOが破棄された後の
  // 再入室が「新しいロビー」と誤認され、リザルト画面での再戦操作等が
  // bad_state で静かに失敗する(2026-07-18に実機で発生した不具合)
  toJSON() {
    return {
      created: this.created,
      state: this.state,
      setup: this.setup,
      hostId: this.hostId,
      scale: this.scale,
      clock: this.clock,
      startAt: this.startAt,
      timeupAt: this.timeupAt,
      nextId: this.nextId,
      players: [...this.players.values()],
    };
  }

  static fromJSON(json, opts) {
    const room = new RoomCore(opts);
    if (!json) return room;
    room.created = !!json.created;
    room.state = json.state ?? 'lobby';
    room.setup = json.setup ?? null;
    room.hostId = json.hostId ?? null;
    room.scale = json.scale ?? 1;
    room.clock = Number.isFinite(json.clock) ? json.clock : room.taskSeconds;
    room.startAt = json.startAt ?? null;
    room.timeupAt = json.timeupAt ?? null;
    room.nextId = json.nextId ?? 1;
    room.players = new Map((json.players || []).map((p) => [p.id, p]));
    // lastTickAtは復元しない(破棄されていた実時間ぶんクロックが一気に進むのを防ぐため、
    // 復元直後を起点にする。=サーバーが不在だった間はクロックを止めた扱いになる)
    if (room.state === 'flying') room.lastTickAt = Date.now();
    return room;
  }

  // ---- 内部ヘルパ ----
  roster() {
    return [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, ready: p.ready,
      host: p.id === this.hostId, dropped: p.dropped, landed: p.landed,
      connected: p.connected,
    }));
  }
  rosterEvent() { return { to: 'all', msg: { t: 'roster', players: this.roster() } }; }

  // 加速の合意値 = 「まだ計測が済んでいない・AFKでない・接続中」の参加者の希望の最小値
  recomputeScale(now) {
    if (this.state !== 'flying') return [];
    const candidates = [...this.players.values()]
      .filter((p) => !p.landed && p.connected && now - p.lastSeen < this.afkMs);
    const v = candidates.length ? Math.min(...candidates.map((p) => p.desired)) : this.scale;
    if (v === this.scale) return [];
    this.scale = v;
    return [{ to: 'all', msg: { t: 'scale', v } }];
  }

  allLanded() {
    const flying = [...this.players.values()];
    return flying.length > 0 && flying.every((p) => p.landed);
  }

  resultsRows() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id, name: p.name, color: p.color, dist: p.dist,
        left: p.left || !p.connected,
      }))
      .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
  }

  buildResults() {
    this.state = 'results';
    return [{ to: 'all', msg: { t: 'results', rows: this.resultsRows() } }];
  }

  distFromLastPos(p) {
    return p.pos ? Math.round(Math.hypot(p.pos.x, p.pos.z) * 10) / 10 : null;
  }

  // ---- 参加/退出 ----
  join(name, color, create, now) {
    if (!this.created) {
      if (!create) return { error: { code: 'no_room', msg: 'ルームが存在しません' } };
      this.created = true;
    }
    if (this.state !== 'lobby') {
      // フライト中/リザルト中は、同名プレイヤーへの「復帰」だけを受け付ける
      // (アプリ切替でWebSocketが切れたスマホが同じ機体に戻ってくるための経路)。
      // リロード・強制終了では切断通知が届かず connected=true のまま残ることがあるため、
      // 切断中の席を最優先しつつ、位置更新が止まっている席(ゾンビ)への復帰も許す
      const wanted = String(name || '').slice(0, 12);
      const sameName = [...this.players.values()].filter((p) => p.name === wanted);
      const ghost = sameName.find((p) => !p.connected)
        || sameName.find((p) => now - (p.posAt ?? 0) > this.stalePosMs);
      if (!ghost) {
        return { error: { code: 'in_flight', msg: 'フライト中は参加できません。ラウンド終了後にもう一度お試しください' } };
      }
      ghost.connected = true;
      ghost.disconnectedAt = null;
      ghost.lastSeen = now;
      const hello = {
        to: ghost.id,
        msg: {
          t: 'hello', id: ghost.id, host: this.hostId === ghost.id, state: this.state,
          setup: this.setup, players: this.roster(),
          clock: Math.max(0, Math.round(this.clock)), scale: this.scale,
          launch: ghost.launch, // フルリロード後の復帰時、離陸地点選択をやり直させず即再開するため
          pos: ghost.pos,       // 切断時の位置。ここから再開させ、リロードによる仕切り直しを防ぐ
          dropped: ghost.dropped, landed: ghost.landed, // 投下済みならマーカー無しで復帰させる
        },
      };
      const events = [hello, this.rosterEvent()];
      // 離席中に順位が確定していた場合は、復帰者にだけ順位表を再送する
      if (this.state === 'results') {
        events.push({ to: ghost.id, msg: { t: 'results', rows: this.resultsRows() } });
      }
      return { id: ghost.id, reattach: true, events };
    }
    if (this.players.size >= this.maxPlayers) {
      return { error: { code: 'full', msg: `満員です(最大${this.maxPlayers}人)` } };
    }
    const id = this.nextId++;
    const p = {
      id,
      name: String(name || `Pilot ${id}`).slice(0, 12),
      color: Number.isInteger(color) && color >= 0 && color < 12 ? color : 0,
      ready: false, launch: null, desired: 1, pos: null, lastSeen: now,
      dropped: false, landed: false, dist: null, left: false,
      connected: true, disconnectedAt: null,
    };
    this.players.set(id, p);
    if (this.hostId === null) this.hostId = id;
    const hello = {
      to: id,
      msg: {
        t: 'hello', id, host: this.hostId === id, state: this.state,
        setup: this.setup, players: this.roster(),
      },
    };
    return { id, events: [hello, this.rosterEvent()] };
  }

  leave(id, now) {
    const p = this.players.get(id);
    if (!p) return { events: [] };
    const events = [];
    if (this.state === 'lobby') {
      this.players.delete(id);
      if (this.hostId === id) {
        const rest = [...this.players.values()];
        this.hostId = rest.length ? rest[0].id : null;
      }
    } else {
      // 飛行中・リザルト中の切断は即脱落にせず、復帰猶予つきで席を保持する。
      // 猶予内に戻らなければ tick() が現在地計測で確定させる
      p.connected = false;
      p.disconnectedAt = now;
    }
    events.push(this.rosterEvent());
    events.push(...this.recomputeScale(now));
    if (this.state === 'flying' && this.allLanded()) events.push(...this.buildResults());
    // ロビーで全員いなくなったら初期状態へ(条件は保持。再入室に備える)
    if (this.players.size === 0) {
      this.state = 'lobby';
      this.hostId = null;
      this.scale = 1;
      this.clock = this.taskSeconds;
      this.startAt = null;
      this.timeupAt = null;
    }
    return { events };
  }

  // ---- ロビー ----
  setSetup(id, setup) {
    if (id !== this.hostId) return { error: { code: 'not_host', msg: 'ホストのみ設定できます' } };
    if (this.state !== 'lobby') return { error: { code: 'bad_state', msg: 'ロビーでのみ設定できます' } };
    if (!setup || !setup.area || !Array.isArray(setup.wind) || !setup.wind.length) {
      return { error: { code: 'bad_setup', msg: '条件が不正です' } };
    }
    // groundWind: 地上風のゆらぎ(β)の隠しパラメータ。サーバーは中身を解釈せず、
    // ホストが決めた値をそのまま全員へ配って同じ「本当の地上風」を共有させるだけ
    this.setup = { area: setup.area, wind: setup.wind, groundWind: setup.groundWind ?? null };
    // 条件が変わったら全員の準備完了を解除(古い条件のまま離陸しないように)
    for (const p of this.players.values()) p.ready = false;
    return { events: [{ to: 'all', msg: { t: 'setup', ...this.setup } }, this.rosterEvent()] };
  }

  setReady(id, launch) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby') return { events: [] };
    if (!this.setup) return { error: { code: 'no_setup', msg: 'ホストの条件配布待ちです' } };
    if (!launch || !Number.isFinite(launch.x) || !Number.isFinite(launch.z)) {
      return { error: { code: 'bad_launch', msg: '離陸地点が不正です' } };
    }
    p.ready = true;
    p.launch = { x: launch.x, z: launch.z };
    return { events: [this.rosterEvent()] };
  }

  setUnready(id) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby') return { events: [] };
    p.ready = false;
    return { events: [this.rosterEvent()] };
  }

  start(id, now) {
    if (id !== this.hostId) return { error: { code: 'not_host', msg: 'ホストのみ開始できます' } };
    if (this.state !== 'lobby') return { error: { code: 'bad_state', msg: '開始できる状態ではありません' } };
    const all = [...this.players.values()];
    if (all.length < 2) return { error: { code: 'need_players', msg: '2人以上で開始できます' } };
    if (!all.every((p) => p.ready)) return { error: { code: 'not_ready', msg: '全員の準備完了待ちです' } };
    this.state = 'countdown';
    this.startAt = now + this.countdownMs;
    this.clock = this.taskSeconds;
    this.scale = 1;
    this.timeupAt = null;
    for (const p of this.players.values()) {
      p.desired = 1; p.dropped = false; p.landed = false; p.dist = null; p.lastSeen = now;
    }
    // inMs: 受信からの相対時間。クライアントの時計ずれの影響を受けないようこちらを使う
    return { events: [{ to: 'all', msg: { t: 'countdown', startAt: this.startAt, inMs: this.countdownMs } }] };
  }

  // ---- 飛行中 ----
  // ts: 送信クライアントの時刻(ms)。速度推定用にスナップショットへ素通しする
  pos(id, x, y, z, now, ts) {
    const p = this.players.get(id);
    if (!p) return { events: [] };
    if (![x, y, z].every(Number.isFinite)) return { events: [] };
    p.pos = { x, y, z };
    p.posTs = Number.isFinite(ts) ? ts : null;
    p.posAt = now; // スナップショットの鮮度判定用(サーバー時刻)
    p.lastSeen = now;
    return { events: [] }; // 配信はtick()のスナップショットに集約
  }

  speed(id, v, now) {
    const p = this.players.get(id);
    if (!p || !TIMESCALES.includes(v)) return { events: [] };
    p.desired = v;
    p.lastSeen = now;
    return { events: this.recomputeScale(now) };
  }

  drop(id, now) {
    const p = this.players.get(id);
    if (!p || this.state !== 'flying' || p.dropped) return { events: [] };
    p.dropped = true;
    p.lastSeen = now;
    return { events: [{ to: 'all', msg: { t: 'drop', id } }, this.rosterEvent()] };
  }

  landed(id, dist, now) {
    const p = this.players.get(id);
    if (!p || this.state !== 'flying' || p.landed) return { events: [] };
    p.landed = true;
    p.dropped = true;
    p.dist = Number.isFinite(dist) ? Math.round(dist * 10) / 10 : this.distFromLastPos(p);
    const events = [this.rosterEvent(), ...this.recomputeScale(now)];
    if (this.allLanded()) events.push(...this.buildResults());
    return { events };
  }

  // ---- リザルト ----
  rematch(id) {
    if (id !== this.hostId) return { error: { code: 'not_host', msg: 'ホストのみ再戦できます' } };
    if (this.state !== 'results') return { error: { code: 'bad_state', msg: '再戦できる状態ではありません' } };
    for (const p of [...this.players.values()]) {
      if (p.left || !p.connected) { this.players.delete(p.id); continue; }
      p.ready = false; p.launch = null; p.desired = 1;
      p.pos = null; p.dropped = false; p.landed = false; p.dist = null;
    }
    this.state = 'lobby';
    this.scale = 1;
    this.clock = this.taskSeconds;
    this.startAt = null;
    this.timeupAt = null;
    const events = [{ to: 'all', msg: { t: 'rematch' } }, this.rosterEvent()];
    return { events };
  }

  // ---- 周期処理(呼び出し側が250ms間隔で呼ぶ) ----
  // タスク時計の進行・カウントダウン明け・タイムアップ・スナップショット配信をまとめて行う
  tick(now) {
    const events = [];
    if (this.state === 'countdown' && now >= this.startAt) {
      this.state = 'flying';
      this.lastTickAt = now;
    }
    if (this.state !== 'flying') return events;

    // 合意タイムスケールでゲーム内時計を進める
    this.clock -= ((now - this.lastTickAt) / 1000) * this.scale;
    this.lastTickAt = now;

    events.push(...this.recomputeScale(now)); // AFK脱落による変化もここで拾う

    // 切断からの復帰猶予が切れたプレイヤーは現在地距離で確定する
    let graceChanged = false;
    for (const p of this.players.values()) {
      if (!p.connected && !p.landed && now - p.disconnectedAt >= this.reconnectGraceMs) {
        p.landed = true;
        p.left = true;
        p.dist = this.distFromLastPos(p);
        graceChanged = true;
      }
    }
    if (graceChanged) {
      events.push(this.rosterEvent());
      events.push(...this.recomputeScale(now));
      if (this.allLanded()) {
        events.push(...this.buildResults());
        return events;
      }
    }

    if (this.clock <= 0 && !this.timeupAt) {
      this.clock = 0;
      this.timeupAt = now;
      events.push({ to: 'all', msg: { t: 'timeup' } });
    }
    // タイムアップ後の猶予を過ぎたら、未計測者を現在地距離で強制確定
    if (this.timeupAt && now - this.timeupAt >= this.graceMs) {
      let changed = false;
      for (const p of this.players.values()) {
        if (!p.landed) { p.landed = true; p.dist = this.distFromLastPos(p); changed = true; }
      }
      if (changed) events.push(this.rosterEvent());
      if (this.allLanded()) {
        events.push(...this.buildResults());
        return events;
      }
    }
    if (this.state === 'flying' && this.allLanded()) {
      events.push(...this.buildResults());
      return events;
    }

    // スナップショット(全機の位置+時計+加速)を1メッセージに集約。切断中の機体と、
    // 位置更新が止まっている機体(切断通知が届かないゾンビ)は隠す。
    // 各行の末尾は送信側タイムスタンプ(クライアントの速度推定用)
    const p = [...this.players.values()]
      .filter((q) => q.pos && !q.left && q.connected && now - (q.posAt ?? 0) <= this.stalePosMs)
      .map((q) => [q.id, Math.round(q.pos.x * 10) / 10, Math.round(q.pos.y * 10) / 10, Math.round(q.pos.z * 10) / 10, q.posTs ?? null]);
    events.push({
      to: 'all',
      msg: { t: 'snap', clock: Math.max(0, Math.round(this.clock)), scale: this.scale, p },
    });
    return events;
  }

  get empty() { return this.players.size === 0; }
}
