// 熱気球フライト プロトタイプ
// 佐賀・嘉瀬川周辺(約20km四方)を地理院タイルから生成し、
// バーナー/リップライン(上下操作)+ 高度別レイヤーの風で飛ぶ。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrain, lonLatToTile } from './terrain.js';
import { Room, randomRoomCode, BALLOON_COLORS } from './net.js';

// マルチプレイ状態(ソロプレイでは MP.room が null のまま)。実装はファイル末尾の「マルチプレイ」節
const MP = {
  room: null, code: null, myName: '', myColor: 0,
  desired: 1,          // 自分が希望する時間加速(全体への反映はサーバーの合意値)
  ready: false, launch: null,
  resultsShown: false, // 全員確定の順位表を表示済みか
  isCreator: false,    // 自分がルームを作った本人か(再接続時のcreate指定に使う)
  reconnecting: false, // 再接続処理の多重起動防止
  pendingRematch: false, // 切断中に「もう一回戦」を押した場合、再接続後に送る
  myDropped: false, myDist: null, // 自分の投下・計測状態(切断中に進んだ分を復帰時に再送)
  // フルリロード後の?room=復帰用。resumeStateはhello受信時のサーバー局面
  // (lobby以外ならブリーフィングを出さずその場で再開する)。isResumingの間は
  // resultsイベントの演出待ち(3秒)を省略し、即座に結果画面を出す
  resumeState: null, isResuming: false,
};
const ghostMeshes = new Map(); // playerId -> THREE.Group(他プレイヤーの気球)
const ghostMarkers = new Map(); // playerId -> { mesh, vel:THREE.Vector3, landed }(他プレイヤーのマーカー、見た目のみ)

// ---- 舞台設定 ----
const TILE_RADIUS = 2; // 5x5タイル ≒ 20km四方
let AREA = null;       // { lon, lat, name? } エリア選択またはURLで決まる

// 日本の主な気球競技開催地(エリア選択のプリセット)
const PRESET_AREAS = [
  { name: '佐賀・嘉瀬川', lon: 130.25, lat: 33.27 },
  { name: '渡良瀬遊水地', lon: 139.68, lat: 36.22 },
  { name: '佐久・千曲川', lon: 138.48, lat: 36.25 },
  { name: '一関・平泉', lon: 141.13, lat: 38.93 },
  { name: '上士幌(北海道)', lon: 143.30, lat: 43.23 },
];

// URLの ?a=lon,lat からエリアを復元
function decodeArea(s) {
  if (!s) return null;
  const v = s.split(',').map(Number);
  if (v.length !== 2 || !v.every(Number.isFinite)) return null;
  const [lon, lat] = v;
  if (lon < 122 || lon > 148 || lat < 24 || lat > 46) return null; // 日本近辺のみ
  return { lon, lat };
}

// パイバル観測データ。高度ft(MSL) / 風向FROM 磁方位° / 風速kt
const WIND_PRESETS = [
  { name: '佐賀・朝の順転(既定)',
    rows: [[0, 140, 3], [500, 160, 5], [1000, 190, 7], [2000, 220, 10], [3000, 240, 13], [5000, 260, 17]] },
  { name: '逆転(北東→北西)',
    rows: [[0, 40, 4], [500, 20, 6], [1000, 350, 8], [2000, 330, 11], [3000, 310, 14], [5000, 300, 18]] },
  { name: 'ほぼ一定(南風)',
    rows: [[0, 170, 4], [1000, 180, 6], [3000, 185, 9], [5000, 190, 12]] },
  { name: '強風・大きく順転',
    rows: [[0, 120, 6], [500, 150, 9], [1000, 180, 12], [2000, 220, 15], [3000, 250, 18], [5000, 270, 24]] },
];
const toRowObj = ([ft, dir, kt]) => ({ ft, dir, kt });

// URLの ?w=ft,dir,kt;ft,dir,kt;… から風テーブルを復元(共有シード)
function decodeWind(s) {
  if (!s) return null;
  const rows = s.split(';')
    .map((p) => p.split(',').map(Number))
    .filter((v) => v.length === 3 && v.every(Number.isFinite) && v[0] >= 0 && v[2] >= 0)
    .map(toRowObj)
    .sort((a, b) => a.ft - b.ft);
  return rows.length ? rows : null;
}
const encodeWind = (rows) => rows.map((r) => `${r.ft},${r.dir},${r.kt}`).join(';');
const shareUrl = () =>
  `${location.origin}${location.pathname}?a=${AREA.lon.toFixed(4)},${AREA.lat.toFixed(4)}&w=${encodeWind(PIBAL)}`;

let PIBAL = decodeWind(new URLSearchParams(location.search).get('w'))
  || WIND_PRESETS[0].rows.map(toRowObj);
const KT2MS = 0.514444;
const M2FT = 3.28084;

// JDGターゲットはエリア中央。離陸地点はブリーフィングでプレイヤーが選ぶ
const TARGET_XZ = { x: 0, z: 0 };
let launchDist = null; // 離陸地点〜ターゲットの直線距離(m)。startFlightで確定
const BEST_KEY = 'balloon-jdg-proto-best';
const TASK_LIMIT_S = 30 * 60; // 制限時間(ゲーム内秒)

// マーカー(70g+リボン)の落下特性
const MARKER_TERMINAL = 10;              // 終端速度 m/s
const MARKER_DRAG = 9.81 / MARKER_TERMINAL;
const MARKER_WIND_TAU = 1.5;             // 水平速度が風に馴染む時定数 s

function windAt(altM) {
  const ft = altM * M2FT;
  let a = PIBAL[0], b = PIBAL[PIBAL.length - 1];
  if (ft <= a.ft) b = a;
  else if (ft >= b.ft) a = b;
  else {
    for (let i = 0; i < PIBAL.length - 1; i++) {
      if (ft >= PIBAL[i].ft && ft < PIBAL[i + 1].ft) { a = PIBAL[i]; b = PIBAL[i + 1]; break; }
    }
  }
  const t = a === b ? 0 : (ft - a.ft) / (b.ft - a.ft);
  // 風向は最短の角度経路で補間(例: 350°→020° は北回り)
  const delta = ((b.dir - a.dir + 540) % 360) - 180;
  let dir = (a.dir + delta * t + 360) % 360;
  let kt = a.kt + (b.kt - a.kt) * t;
  if (groundWind && ft < GROUND_BAND_FT) {
    const g = groundWindActual(TASK_LIMIT_S - remaining);
    const k = 1 - ft / GROUND_BAND_FT; // 地表で1、GROUND_BAND_FTで0に薄れる
    const gDelta = ((g.dir - dir + 540) % 360) - 180;
    dir = (dir + gDelta * k + 360) % 360;
    kt = kt + (g.kt - kt) * k;
  }
  const toRad = ((dir + 180) * Math.PI) / 180; // FROM → 進行方向
  const ms = kt * KT2MS;
  return { dir, kt, vx: ms * Math.sin(toRad), vz: -ms * Math.cos(toRad) };
}

// ---- 地上風のゆらぎ(β)----
// 高気圧との位置関係(距離のみ。方位は今回のバージョンでは扱わない)から、
// 地上付近の風がパイバル表通りとは限らなくなる度合いを決める。実際の値は
// 離陸時に1回だけ乱数で決まり、パイロットには数値として見せない
// (「地上クルー」への無線確認、またはパネルの離陸時スナップショットでしか触れられない)
const GROUND_BAND_FT = 500; // この高度以下だけ実況値とブレンドし、以上は表通り
const DIR_OSC_AMP_DEG = 7.5;   // 周期振動の振幅(振れ幅は約2倍の15°)
const KT_OSC_AMP_FRAC = 0.3;   // 風速側の振動振幅(±30%)
const GW_RANGES = [
  { maxKm: 150, angMin: 15, angMax: 40, spdMin: 0.3, spdMax: 0.6 },
  { maxKm: 400, angMin: 10, angMax: 25, spdMin: 0.45, spdMax: 0.7 },
  { maxKm: Infinity, angMin: 5, angMax: 15, spdMin: 0.6, spdMax: 0.85 },
];
const randBetween = (lo, hi) => lo + Math.random() * (hi - lo);
let groundWind = null; // 有効時のみ非nullのオブジェクト
let gwReportTimer = null;

// distKmはパイロットに公開される情報(表示用)。それ以外は隠しパラメータ
function rollGroundWind(distKm) {
  const rg = GW_RANGES.find((r) => distKm < r.maxKm);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return {
    distKm,
    veerOffset: sign * randBetween(rg.angMin, rg.angMax),
    speedFactor: randBetween(rg.spdMin, rg.spdMax),
    dirPeriod: randBetween(240, 360), dirPhase: randBetween(0, Math.PI * 2),
    ktPeriod: randBetween(240, 360), ktPhase: randBetween(0, Math.PI * 2),
  };
}

// tSec: 離陸からのゲーム内経過秒。地上の「本当の」風を返す(隠しパラメータ)
function groundWindActual(tSec) {
  const base = PIBAL[0];
  const dirOsc = DIR_OSC_AMP_DEG * Math.sin((2 * Math.PI * tSec) / groundWind.dirPeriod + groundWind.dirPhase);
  const dir = (base.dir + groundWind.veerOffset + dirOsc + 360) % 360;
  const ktOsc = 1 + KT_OSC_AMP_FRAC * Math.sin((2 * Math.PI * tSec) / groundWind.ktPeriod + groundWind.ktPhase);
  const kt = Math.max(0, base.kt * groundWind.speedFactor * ktOsc);
  return { dir, kt };
}

// ---- three.js セットアップ ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec8e8);
scene.fog = new THREE.Fog(0x9ec8e8, 4000, 16000);

scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x54604a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2df, 1.6);
sun.position.set(-3000, 5000, -2000);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 40000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.52;
controls.minDistance = 25;
controls.maxDistance = 600;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// 編みかご風テクスチャ(Canvasで生成。横方向の籐の束を段違いに重ねた見た目)
function buildWickerTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#5d451f';
  ctx.fillRect(0, 0, 128, 128);
  const rowH = 16, segW = 32;
  for (let y = 0, r = 0; y < 128; y += rowH, r++) {
    const off = (r % 2) * (segW / 2);
    for (let x = -segW; x < 128 + segW; x += segW) {
      const grad = ctx.createLinearGradient(0, y, 0, y + rowH);
      grad.addColorStop(0, '#8a6a3c');
      grad.addColorStop(0.45, '#b28a54');
      grad.addColorStop(1, '#6d5127');
      ctx.fillStyle = grad;
      ctx.fillRect(x + off + 1, y + 1, segW - 2, rowH - 2);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 色を白方向に混ぜて明るくする(内面=日光が透けた布の表現用)
function lighten(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v + (255 - v) * k);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// ゴア(縦の縫い目パネル)模様のテクスチャ。bright=true は内面用の明るい配色。
// pal={cols:[濃,淡], seam} を渡すと球皮カラーを差し替えられる(マルチプレイの色選択)
function buildGoreTexture(bright, pal) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  const gores = 16, w = 512 / gores;
  const base = pal || { cols: ['#c62828', '#a81f1f'], seam: '#7a1515' };
  const cols = bright ? base.cols.map((c) => lighten(c, 0.25)) : base.cols;
  const seam = bright ? lighten(base.seam, 0.3) : base.seam;
  for (let i = 0; i < gores; i++) {
    ctx.fillStyle = cols[i % 2];
    ctx.fillRect(i * w, 0, w, 64);
    ctx.fillStyle = seam;
    ctx.fillRect(i * w, 0, 2, 64);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- 気球(プレースホルダ形状) ----
const BASKET_W = 1.4, BASKET_H = 1.1, WALL_T = 0.06, BURNER_Y = 2.0;
function buildBalloon() {
  const g = new THREE.Group(); // 原点 = バスケット底面(接地点)
  const envMat = new THREE.MeshLambertMaterial({ map: buildGoreTexture(false) });
  const env = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 18), envMat);
  env.scale.set(1, 1.12, 1);
  env.position.y = 16.5;
  g.add(env);
  // 球皮の内面(見上げたときに見える側)。日光が透けた明るい布として自発光風に描く
  const envInnerMat = new THREE.MeshBasicMaterial({
    map: buildGoreTexture(true), side: THREE.BackSide,
  });
  const envInner = new THREE.Mesh(new THREE.SphereGeometry(8.8, 24, 18), envInnerMat);
  envInner.scale.set(1, 1.12, 1);
  envInner.position.y = 16.5;
  g.add(envInner);

  // スカート(球皮の口からバーナー上方へ絞る布)。上端半径3.0は球皮の
  // y=7.0における断面半径と一致させ、継ぎ目が浮かないようにしている
  const skirtMat = new THREE.MeshLambertMaterial({ color: 0xb52a2a, side: THREE.DoubleSide });
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(3.0, 1.5, 3.2, 20, 1, true), skirtMat);
  skirt.position.y = 5.4;
  g.add(skirt);

  // 四角い編みかごのゴンドラ(4面の壁+床。内側からも見えるようDoubleSide)
  const wicker = buildWickerTexture();
  wicker.repeat.set(3, 3);
  const wickerMat = new THREE.MeshLambertMaterial({ map: wicker, side: THREE.DoubleSide });
  const half = BASKET_W / 2 - WALL_T / 2;
  for (const [w, d, x, z] of [
    [BASKET_W, WALL_T, 0, half], [BASKET_W, WALL_T, 0, -half],   // 前後の壁
    [WALL_T, BASKET_W, half, 0], [WALL_T, BASKET_W, -half, 0],   // 左右の壁
  ]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, BASKET_H, d), wickerMat);
    wall.position.set(x, BASKET_H / 2, z);
    g.add(wall);
  }
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(BASKET_W, WALL_T, BASKET_W),
    new THREE.MeshLambertMaterial({ color: 0x4a3620 }));
  floor.position.y = WALL_T / 2;
  g.add(floor);

  // 上縁の革張りリム(4辺の横棒。壁の上面を覆って縞の露出を隠す)
  const rimMat = new THREE.MeshLambertMaterial({ color: 0x3e2b18 });
  for (const [len, rot, x, z] of [
    [BASKET_W + 0.14, 0, 0, half], [BASKET_W + 0.14, 0, 0, -half],
    [BASKET_W + 0.14, Math.PI / 2, half, 0], [BASKET_W + 0.14, Math.PI / 2, -half, 0],
  ]) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, len, 10), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.rotation.y = rot;
    rim.position.set(x, BASKET_H, z);
    g.add(rim);
  }

  // 四隅の支柱(革巻き風。バスケット上縁→スカート裾まで)+バーナー本体
  const POLE_TOP = 3.9; // スカート裾(y=3.8)に届く高さ
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x5c3a26 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, POLE_TOP - BASKET_H, 6), poleMat);
      pole.position.set(sx * (half - 0.05), (POLE_TOP + BASKET_H) / 2, sz * (half - 0.05));
      g.add(pole);
    }
  }
  const burnerUnit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, 0.32, 10),
    new THREE.MeshLambertMaterial({ color: 0x555555 }));
  burnerUnit.position.y = BURNER_Y;
  g.add(burnerUnit);

  // リップライン(ゴンドラから気球の口まで伸びる赤いロープ)
  const ropeBaseY = 4.5; // 中心y。長さ5.2でおよそ y=1.9〜7.1
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 5.2, 6),
    new THREE.MeshBasicMaterial({ color: 0xd32f2f }));
  rope.position.set(0.3, ropeBaseY, 0.3);
  g.add(rope);

  // バーナー炎(外側オレンジ+芯の黄色の二重コーン)。バーナー上端から上へ吹き上がる。
  // 底面なし(openEnded)にして、ゴンドラから見上げたときも自然に見えるようにする
  const flame = new THREE.Group();
  const flameMatOpts = { transparent: true, side: THREE.DoubleSide };
  const flameOuter = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.8, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff8a30, opacity: 0.85, ...flameMatOpts }));
  flame.add(flameOuter);
  const flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 1.2, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe082, opacity: 0.95, ...flameMatOpts }));
  flameCore.position.y = -0.25;
  flame.add(flameCore);
  flame.position.y = BURNER_Y + 1.3; // 基部 y≈2.4 からバーナー上方へ吹き上がる
  flame.visible = false;
  g.add(flame);
  const flameLight = new THREE.PointLight(0xffa040, 0, 60);
  flameLight.position.y = BURNER_Y + 1.1;
  g.add(flameLight);
  return { group: g, flame, flameLight, envMat, envInnerMat, skirtMat, rope, ropeBaseY };
}

// ---- 気球の擬似影 ----
// 真下の地面に置く円形の暗がり。対地高度が上がるほど大きく・薄くなり、
// 高さの目安になる(ライトのシャドウマップより軽く、広域地形でも破綻しない)
function buildShadowMesh() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(0.65, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(cv),
      transparent: true, depthWrite: false, opacity: 0.55,
    }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1; // 地形の上に重ねて描く
  return mesh;
}

// ---- JDGターゲット(オレンジのX+白リング) ----
// 地上風ゆらぎの有効/無効を、動画等で後から見ても一目で判別できるよう
// ターゲットの色で対比させる(無効=暖色系、有効=寒色系)
const TARGET_COLOR = {
  off: { arm: 0xff5a00, ring: 0xffd54f }, // 暖色系(オレンジ×黄色)
  on: { arm: 0x2979ff, ring: 0x00e676 },  // 寒色系(青×緑)
};

function buildTarget(x, z, groundY) {
  const g = new THREE.Group();
  const armMat = new THREE.MeshBasicMaterial({ color: TARGET_COLOR.off.arm });
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 2.6), armMat);
    arm.rotation.y = rot;
    g.add(arm);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: TARGET_COLOR.off.ring, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(24, 25.5, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  g.position.set(x, groundY + 0.4, z);
  g.userData.armMat = armMat;
  g.userData.ringMat = ringMat;
  return g;
}

// 離陸時、地上風ゆらぎの有効/無効が確定してから呼ぶ
function applyTargetColor(active) {
  const c = active ? TARGET_COLOR.on : TARGET_COLOR.off;
  target.userData.armMat.color.setHex(c.arm);
  target.userData.ringMat.color.setHex(c.ring);
}

// ---- マーカー(重り+リボン+視認用グロー) ----
// ribbonColor: 他プレイヤーのゴーストマーカーを見分けやすくするための任意指定
// (自機のマーカーは常定色のまま。省略時はデフォルトの黄リボン)
function buildMarkerMesh(ribbonColor) {
  const g = new THREE.Group();
  const weight = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xd32f2f }));
  g.add(weight);
  const ribbon = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 4.5),
    new THREE.MeshBasicMaterial({ color: ribbonColor ?? 0xffee58, side: THREE.DoubleSide }));
  ribbon.position.y = 2.6;
  g.add(ribbon);
  // 落下中でも見失わないよう、常にカメラを向く淡い光のスプライトを重ねる
  const spCv = document.createElement('canvas');
  spCv.width = spCv.height = 64;
  const sctx = spCv.getContext('2d');
  const grad = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,235,80,0.85)');
  grad.addColorStop(1, 'rgba(255,235,80,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 64, 64);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(spCv), transparent: true, depthWrite: false,
  }));
  glow.scale.set(3, 3, 1);
  g.add(glow);
  return g;
}

// ---- サウンド(Web Audio合成、外部ファイル不要) ----
// ブラウザの自動再生制限があるため、初回のユーザー操作で初期化し、
// suspended のままなら操作のたびに resume する(前回鳴らなかった原因への対処)
let audioCtx = null, masterGain = null, burnerGain = null, ripGain = null, windGain = null;
let sndBurnerOn = false, sndRipOn = false;

// サウンドのオン/オフ設定(localStorageに保存)。マスターゲインで一括ミュートする
const SOUND_KEY = 'balloon-sound';
let soundOn = localStorage.getItem(SOUND_KEY) !== 'off';

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = soundOn ? 1 : 0;
    masterGain.connect(audioCtx.destination);
    const noise = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const makeLoop = (type, freq, q) => {
      const src = audioCtx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = audioCtx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = 0;
      src.connect(filter).connect(gainNode).connect(masterGain);
      src.start();
      return gainNode;
    };
    burnerGain = makeLoop('bandpass', 600, 0.6);   // バーナーの噴射音(ゴーッ)
    ripGain = makeLoop('bandpass', 2600, 0.9);     // リップラインの排気音(シューッ)
    windGain = makeLoop('lowpass', 380, 0.4);      // 風のアンビエント
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
addEventListener('keydown', ensureAudio);
addEventListener('pointerdown', ensureAudio);

// ---- 音のミュート切替(計器パネルの「音」行をクリック、またはSキー) ----
function toggleSound() {
  soundOn = !soundOn;
  localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
  ensureAudio(); // ユーザー操作なのでここでresumeも通る
  document.getElementById('sound-status').textContent = soundOn ? 'ON' : 'OFF';
  if (masterGain) masterGain.gain.setTargetAtTime(soundOn ? 1 : 0, audioCtx.currentTime, 0.05);
}
document.getElementById('sound-status').textContent = soundOn ? 'ON' : 'OFF';
document.getElementById('sound-row').addEventListener('click', toggleSound);

// 毎フレーム呼ばれ、入力状態・風速に音量を追従させる
function updateSounds(windKt) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime;
  const bOn = input.burner && state.fuel > 0;
  if (bOn !== sndBurnerOn) {
    sndBurnerOn = bOn;
    burnerGain.gain.setTargetAtTime(bOn ? 0.4 : 0, t, bOn ? 0.04 : 0.18);
  }
  if (input.rip !== sndRipOn) {
    sndRipOn = input.rip;
    ripGain.gain.setTargetAtTime(input.rip ? 0.25 : 0, t, input.rip ? 0.04 : 0.12);
  }
  windGain.gain.setTargetAtTime(THREE.MathUtils.clamp(windKt / 40, 0, 1) * 0.15, t, 0.4);
}

// ---- 入力 ----
const input = { burner: false, rip: false };
let timeScale = 1;
let fpv = false;
let flightReady = false; // 離陸前のキー入力を無視する
let started = false;     // 離陸済みかどうか(物理・時計は離陸後のみ進む)
let remaining = TASK_LIMIT_S;
let expired = false;

// 一人称視点(ゴンドラ視点)。目の位置は固定し、視線方向だけをドラッグで回す
let fpvYaw = 0, fpvPitch = 0;
const EYE_HEIGHT = 1.85;
const LOOK_SPEED = 0.0038;
const PITCH_LIMIT = THREE.MathUtils.degToRad(85);
const look = { dragging: false, lastX: 0, lastY: 0 };

function setTimeScale(v) {
  // マルチプレイでは「希望」をサーバーへ送るだけ。実際の反映は合意値(scale配信)を待つ
  if (MP.room) {
    MP.desired = v;
    MP.room.sendSpeed(v);
    mpRenderBoard();
    return;
  }
  timeScale = v;
  document.getElementById('tscale').textContent = v;
}

// 合意タイムスケールの反映(実際のシミュレーション速度はこの値だけが変える)
function applyServerScale(v) {
  timeScale = v;
  document.getElementById('tscale').textContent = v;
  mpRenderBoard();
}

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { input.burner = true; e.preventDefault(); }
  if (e.code === 'KeyR') input.rip = true;
  if (e.code === 'KeyV' && started) {
    fpv = !fpv;
    applyViewMode();
    if (!fpv) {
      // ゴンドラ視点から戻るときは、見ていた方向の後方に回り込む
      const horiz = new THREE.Vector3(Math.sin(fpvYaw), 0, -Math.cos(fpvYaw));
      const tgt = new THREE.Vector3(state.pos.x, state.pos.y + 12, state.pos.z);
      camera.position.copy(tgt).addScaledVector(horiz, -90).add(new THREE.Vector3(0, 35, 0));
      controls.target.copy(tgt);
    }
  }
  if (e.code === 'KeyM' && flightReady) dropMarker();
  if (e.code === 'KeyP') {
    const p = document.getElementById('pibal');
    p.style.display = p.style.display === 'none' ? '' : 'none';
  }
  if (e.code === 'KeyG' && started) reportGroundCrew();
  if (e.code === 'KeyS') toggleSound();
  if (e.code >= 'Digit1' && e.code <= 'Digit4') {
    setTimeScale([1, 2, 4, 8][Number(e.code.slice(5)) - 1]);
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space') input.burner = false;
  if (e.code === 'KeyR') input.rip = false;
});

// ゴンドラ視点でのマウスルック(ドラッグで視線方向を回転。目の位置は動かさない)
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!fpv || !started) return;
  look.dragging = true;
  look.lastX = e.clientX;
  look.lastY = e.clientY;
});
addEventListener('mousemove', (e) => {
  if (!look.dragging) return;
  const dx = e.clientX - look.lastX, dy = e.clientY - look.lastY;
  look.lastX = e.clientX;
  look.lastY = e.clientY;
  fpvYaw -= dx * LOOK_SPEED;
  fpvPitch = THREE.MathUtils.clamp(fpvPitch - dy * LOOK_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
});
addEventListener('mouseup', () => { look.dragging = false; });

function applyViewMode() {
  if (fpv) {
    // 現在の視線方向を引き継いでゴンドラ視点に入る(切り替え時の違和感を減らす)
    const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    fpvYaw = Math.atan2(dir.x, -dir.z);
    fpvPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    controls.enabled = false;
  } else {
    controls.enabled = true;
  }
}

// ---- 風向表示のFROM/TO切替(パネルの表とHUDの現在高度風向を連動) ----
// FROM=風が吹いてくる方向(磁方位、実競技の慣行) / TO=風が吹いていく方向(FROM+180°)
let windDisplayMode = 'from';
const toDisplayDir = (dirFrom) => (windDisplayMode === 'to' ? (dirFrom + 180) % 360 : dirFrom);

function toggleWindMode() {
  windDisplayMode = windDisplayMode === 'from' ? 'to' : 'from';
  const label = windDisplayMode.toUpperCase();
  document.getElementById('wind-mode-toggle').textContent = label;
  document.getElementById('pibal-mode-label').textContent = label;
  document.getElementById('wind-label').textContent =
    windDisplayMode === 'to' ? '風(現在高度・TO)' : '風(現在高度)';
  renderFlightPibal();
}
document.getElementById('wind-mode-toggle').addEventListener('click', toggleWindMode);

// ---- 飛行中HUDのパイバル表を描画 ----
function renderFlightPibal() {
  document.getElementById('pibal-body').innerHTML = PIBAL
    .map((r, i) => {
      // 地上風ゆらぎON時の0ft行は、離陸時にパイロットが読んだ値のまま古びていく
      // (現在値ではない)ことを示すため、離陸時スナップショットをグレーアウト表示する
      if (i === 0 && groundWind) {
        const g = groundWind.launchGround;
        return `<tr class="gw-stale"><td>${r.ft}</td>` +
          `<td>${String(Math.round(toDisplayDir(g.dir))).padStart(3, '0')}</td><td>${g.kt.toFixed(1)}</td></tr>`;
      }
      return `<tr><td>${r.ft}</td><td>${String(Math.round(toDisplayDir(r.dir))).padStart(3, '0')}</td><td>${r.kt}</td></tr>`;
    })
    .join('');
}
renderFlightPibal();

// ---- 地上風のゆらぎ: ブリーフィングのUI配線と「地上クルー」(Gキー) ----
document.getElementById('gw-enable').addEventListener('change', (e) => {
  const on = e.target.checked;
  document.getElementById('gw-dist-row').style.display = on ? 'flex' : 'none';
  document.getElementById('gw-dist-hint').style.display = on ? 'block' : 'none';
});
function reportGroundCrew() {
  if (!groundWind) return;
  const g = groundWindActual(TASK_LIMIT_S - remaining);
  const toDir = Math.round((g.dir + 180) % 360);
  const tier = g.kt < 3 ? '弱い風' : g.kt < 8 ? '普通の風' : '強い風';
  const rep = document.getElementById('gw-report');
  rep.innerHTML = `📻 地上クルーより<br><b>${String(toDir).padStart(3, '0')}°</b> ${tier}`;
  rep.style.display = 'block';
  clearTimeout(gwReportTimer);
  gwReportTimer = setTimeout(() => { rep.style.display = 'none'; }, 6000);
}

// ---- エリア選択画面(日本全図のスリッピーマップ+プリセット) ----
function selectArea() {
  return new Promise((resolve) => {
    const el = document.getElementById('areasel');
    const btn = document.getElementById('area-btn');
    el.style.display = '';
    let sel = null;

    const map = setupAreaMap((lon, lat, name) => {
      sel = { lon, lat, name };
      btn.disabled = false;
      btn.textContent = `このエリアで飛ぶ(${name || `${lat.toFixed(3)}N, ${lon.toFixed(3)}E`})`;
    });

    const presetBox = document.getElementById('area-presets');
    presetBox.innerHTML = PRESET_AREAS
      .map((p, i) => `<button type="button" data-i="${i}">${p.name}</button>`)
      .join('');
    presetBox.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const p = PRESET_AREAS[Number(b.dataset.i)];
      map.jumpTo(p.lon, p.lat);
      map.select(p.lon, p.lat, p.name);
    });

    btn.addEventListener('click', () => {
      if (!sel) return;
      el.style.display = 'none';
      resolve(sel);
    });
  });
}

function setupAreaMap(onSelect) {
  const cv = document.getElementById('area-map');
  const ctx = cv.getContext('2d');
  let z = 5;
  let c = lonLatToTile(137.0, 38.0, z); // 日本全体が入る初期ビュー
  let sel = null;

  const tiles = new Map();
  function getTile(zz, tx, ty) {
    const key = `${zz}/${tx}/${ty}`;
    const v = tiles.get(key);
    if (v) return v instanceof ImageBitmap ? v : null;
    tiles.set(key, 'loading');
    fetch(`https://cyberjapandata.gsi.go.jp/xyz/std/${zz}/${tx}/${ty}.png`)
      .then((r) => { if (!r.ok) throw 0; return r.blob(); })
      .then(createImageBitmap)
      .then((bmp) => { tiles.set(key, bmp); render(); })
      .catch(() => tiles.set(key, 'error'));
    return null;
  }

  const cssRatio = () => cv.width / cv.clientWidth;
  const toScreen = (tx, ty) => [(tx - c.x) * 256 + cv.width / 2, (ty - c.y) * 256 + cv.height / 2];
  const toTile = (sx, sy) => [(sx - cv.width / 2) / 256 + c.x, (sy - cv.height / 2) / 256 + c.y];
  const tileToLonLat = (tx, ty) => [
    (tx / 2 ** z) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / 2 ** z))) * 180) / Math.PI,
  ];

  function render() {
    ctx.fillStyle = '#0d1620';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const n = 2 ** z;
    const [txL, tyT] = toTile(0, 0);
    const [txR, tyB] = toTile(cv.width, cv.height);
    for (let ty = Math.max(0, Math.floor(tyT)); ty <= Math.min(n - 1, Math.floor(tyB)); ty++) {
      for (let tx = Math.max(0, Math.floor(txL)); tx <= Math.min(n - 1, Math.floor(txR)); tx++) {
        const bmp = getTile(z, tx, ty);
        if (!bmp) continue;
        const [sx, sy] = toScreen(tx, ty);
        ctx.drawImage(bmp, sx, sy, 256.5, 256.5);
      }
    }
    if (sel) {
      const t = lonLatToTile(sel.lon, sel.lat, z);
      const [sx, sy] = toScreen(t.x, t.y);
      // この緯度・ズームでの1画面ピクセルあたりの実距離から20km枠を描く
      const mpp = (156543.03392 * Math.cos((sel.lat * Math.PI) / 180)) / 2 ** z;
      const box = 20460 / mpp;
      ctx.strokeStyle = '#ff5a00';
      ctx.lineWidth = 3;
      ctx.strokeRect(sx - box / 2, sy - box / 2, box, box);
      ctx.beginPath();
      ctx.moveTo(sx - 8, sy); ctx.lineTo(sx + 8, sy);
      ctx.moveTo(sx, sy - 8); ctx.lineTo(sx, sy + 8);
      ctx.stroke();
    }
  }

  let drag = null;
  cv.addEventListener('mousedown', (e) => {
    drag = { cx: e.clientX, cy: e.clientY, vx: c.x, vy: c.y, moved: false };
  });
  addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.cx) * cssRatio();
    const dy = (e.clientY - drag.cy) * cssRatio();
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (drag.moved) {
      c = { x: drag.vx - dx / 256, y: drag.vy - dy / 256 };
      render();
    }
  });
  cv.addEventListener('mouseup', (e) => {
    if (drag && !drag.moved) {
      const r = cssRatio();
      const [fx, fy] = toTile(e.offsetX * r, e.offsetY * r);
      const [lon, lat] = tileToLonLat(fx, fy);
      select(lon, lat, null);
    }
    drag = null;
  });
  addEventListener('mouseup', () => { drag = null; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const nz = THREE.MathUtils.clamp(z + (e.deltaY < 0 ? 1 : -1), 4, 17);
    if (nz === z) return;
    const r = cssRatio();
    const [fx, fy] = toTile(e.offsetX * r, e.offsetY * r);
    const k = 2 ** (nz - z);
    z = nz;
    c = {
      x: fx * k - (e.offsetX * r - cv.width / 2) / 256,
      y: fy * k - (e.offsetY * r - cv.height / 2) / 256,
    };
    render();
  }, { passive: false });

  function select(lon, lat, name) {
    sel = { lon, lat, name };
    render();
    onSelect(lon, lat, name);
  }
  function jumpTo(lon, lat) {
    z = 10;
    c = lonLatToTile(lon, lat, z);
    render();
  }
  render();
  return { select, jumpTo };
}

// ---- メイン ----
// ?room= 付きで開いた場合はゲスト入室: 接続してホストの条件(エリア・風)を受け取る
const MP_JOIN_CODE = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
if (MP_JOIN_CODE) {
  const setup = await mpJoinGate(MP_JOIN_CODE);
  AREA = setup.area;
  PIBAL = setup.wind.map(toRowObj);
  // groundWind: ホストが決めた値をここでも直接反映する(mpWireRoom内のsetupリスナーは
  // 初回のこの受け渡し完了後に登録されるため、初回分はここで拾う必要がある)
  groundWind = setup.groundWind ? { ...setup.groundWind } : null;
  if (groundWind) groundWind.launchGround = groundWindActual(0);
  MP.isResuming = false; // 復帰処理はここで完了。以降の計測等は通常どおりの演出に戻す
} else {
  AREA = decodeArea(new URLSearchParams(location.search).get('a'));
  if (!AREA) AREA = await selectArea();
}

const loadingEl = document.getElementById('loading');
document.getElementById('load-title').textContent =
  `${AREA.name || `${AREA.lat.toFixed(3)}N ${AREA.lon.toFixed(3)}E`} の地形を読み込み中…`;
loadingEl.style.display = '';

const loadEl = document.getElementById('load-progress');
const terrain = await buildTerrain(AREA.lon, AREA.lat, TILE_RADIUS,
  (done, total) => { loadEl.textContent = `${done} / ${total}`; });
scene.add(terrain.group);
loadingEl.remove();

// ---- ブリーフィング(タスクシート+パイバル編集+離陸地点選択) ----
setupWindEditor();

function setupWindEditor() {
  const sel = document.getElementById('wind-preset');
  sel.innerHTML = WIND_PRESETS
    .map((p, i) => `<option value="${i}">${p.name}</option>`)
    .join('') + '<option value="custom">カスタム</option>';
  if (new URLSearchParams(location.search).has('w')) sel.value = 'custom';
  renderEditorRows(PIBAL);

  sel.addEventListener('change', () => {
    if (sel.value === 'custom') return;
    renderEditorRows(WIND_PRESETS[Number(sel.value)].rows.map(toRowObj));
  });
  document.getElementById('wind-add').addEventListener('click', () => {
    const rows = readEditorRows();
    const last = rows[rows.length - 1];
    rows.push(last ? { ft: last.ft + 1000, dir: last.dir, kt: last.kt } : { ft: 0, dir: 180, kt: 5 });
    renderEditorRows(rows);
    sel.value = 'custom';
  });
  const editor = document.getElementById('wind-editor');
  editor.addEventListener('input', () => { sel.value = 'custom'; });
  editor.addEventListener('click', (e) => {
    if (!e.target.classList.contains('del')) return;
    if (editor.querySelectorAll('tr').length <= 1) return; // 最低1行は残す
    e.target.closest('tr').remove();
    sel.value = 'custom';
  });
  document.getElementById('wind-copy').addEventListener('click', (e) => {
    applyWindFromEditor();
    copyShare(e.target);
  });
}

function renderEditorRows(rows) {
  document.getElementById('wind-editor').innerHTML = rows.map((r) =>
    `<tr><td><input type="number" class="w-ft" step="100" min="0" value="${r.ft}"></td>` +
    `<td><input type="number" class="w-dir" step="10" min="0" max="360" value="${r.dir}"></td>` +
    `<td><input type="number" class="w-kt" step="1" min="0" value="${r.kt}"></td>` +
    `<td><button type="button" class="del" title="行を削除">×</button></td></tr>`).join('');
}

function readEditorRows() {
  return [...document.querySelectorAll('#wind-editor tr')]
    .map((tr) => ({
      ft: Number(tr.querySelector('.w-ft').value),
      dir: ((Number(tr.querySelector('.w-dir').value) % 360) + 360) % 360,
      kt: Number(tr.querySelector('.w-kt').value),
    }))
    .filter((r) => Number.isFinite(r.ft) && Number.isFinite(r.dir) && Number.isFinite(r.kt)
      && r.ft >= 0 && r.kt >= 0)
    .sort((a, b) => a.ft - b.ft);
}

// エディタの内容を有効な風テーブルとして確定し、URLにも反映する
function applyWindFromEditor() {
  const rows = readEditorRows();
  if (rows.length) PIBAL = rows;
  renderFlightPibal();
  history.replaceState(null, '', shareUrl());
}

function copyShare(btn) {
  const orig = btn.textContent;
  navigator.clipboard.writeText(shareUrl())
    .then(() => { btn.textContent = 'コピーしました!'; })
    .catch(() => { btn.textContent = 'コピー失敗'; })
    .finally(() => setTimeout(() => { btn.textContent = orig; }, 1600));
}
document.getElementById('result-share').addEventListener('click', (e) => copyShare(e.target));

const launchSel = { x: null, z: null };
setupLaunchMap();
// 飛行中/リザルト中への復帰(フルリロード後)はソロと同じブリーフィング(離陸地点の
// 選び直し等)を出さない。mp-rematch等のボタン配線は必要なのでmpBriefingInit()自体は呼ぶ
if (!MP.room || MP.resumeState === 'lobby') {
  document.getElementById('briefing').style.display = '';
}
mpBriefingInit();

// ブリーフィング地図: ズーム(ホイール)+パン(ドラッグ)可能な簡易スリッピーマップ。
// ズームに応じて標準地図タイルを z11〜z17 から選んで表示する
function setupLaunchMap() {
  const cv = document.getElementById('launch-map');
  const ctx = cv.getContext('2d');
  const M = terrain.map;
  const tm13 = terrain.tileMeters;            // z13タイルの一辺(m)
  const c13x = M.x0 - M.minX / tm13;          // 世界原点のz13タイル座標
  const c13y = M.y0 - M.minZ / tm13;
  const fitScale = cv.width / terrain.sizeMeters; // 全域表示のpx/m
  const MAX_SCALE = 1.0;
  const view = {
    x: M.minX + terrain.sizeMeters / 2,
    z: M.minZ + terrain.sizeMeters / 2,
    scale: fitScale,
  };

  const tiles = new Map(); // "z/x/y" -> ImageBitmap | 'loading' | 'error'
  function getTile(z, tx, ty) {
    const key = `${z}/${tx}/${ty}`;
    const v = tiles.get(key);
    if (v) return v instanceof ImageBitmap ? v : null;
    tiles.set(key, 'loading');
    fetch(`https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${tx}/${ty}.png`)
      .then((r) => { if (!r.ok) throw 0; return r.blob(); })
      .then(createImageBitmap)
      .then((bmp) => { tiles.set(key, bmp); render(); })
      .catch(() => tiles.set(key, 'error'));
    return null;
  }

  const cssRatio = () => cv.width / cv.clientWidth;
  const worldToScreen = (wx, wz) => [
    (wx - view.x) * view.scale + cv.width / 2,
    (wz - view.z) * view.scale + cv.height / 2,
  ];
  const screenToWorld = (sx, sy) => [
    (sx - cv.width / 2) / view.scale + view.x,
    (sy - cv.height / 2) / view.scale + view.z,
  ];
  function clampView() {
    const half = cv.width / 2 / view.scale;
    view.x = THREE.MathUtils.clamp(view.x, M.minX + half, M.minX + terrain.sizeMeters - half);
    view.z = THREE.MathUtils.clamp(view.z, M.minZ + half, M.minZ + terrain.sizeMeters - half);
  }

  function render() {
    ctx.fillStyle = '#0d1620';
    ctx.fillRect(0, 0, cv.width, cv.height);

    // 表示解像度に合ったタイルズームを選ぶ
    let z = Math.round(13 + Math.log2((view.scale * tm13) / 256));
    z = THREE.MathUtils.clamp(z, 11, 17);
    const f = 2 ** (z - 13);
    const tmz = tm13 / f;

    const [wL, wT] = screenToWorld(0, 0);
    const [wR, wB] = screenToWorld(cv.width, cv.height);
    const txMin = Math.max(Math.floor((c13x + wL / tm13) * f), Math.floor(M.x0 * f));
    const txMax = Math.min(Math.floor((c13x + wR / tm13) * f), Math.ceil((M.x0 + M.n) * f) - 1);
    const tyMin = Math.max(Math.floor((c13y + wT / tm13) * f), Math.floor(M.y0 * f));
    const tyMax = Math.min(Math.floor((c13y + wB / tm13) * f), Math.ceil((M.y0 + M.n) * f) - 1);
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const bmp = getTile(z, tx, ty);
        if (!bmp) continue;
        const [sx, sy] = worldToScreen((tx / f - c13x) * tm13, (ty / f - c13y) * tm13);
        const s = tmz * view.scale;
        ctx.drawImage(bmp, sx, sy, s + 0.5, s + 0.5);
      }
    }

    // ターゲット(橙X+白丸)
    const [tx, ty] = worldToScreen(TARGET_XZ.x, TARGET_XZ.z);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(tx, ty, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ff5a00';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(tx - 11, ty - 11); ctx.lineTo(tx + 11, ty + 11);
    ctx.moveTo(tx - 11, ty + 11); ctx.lineTo(tx + 11, ty - 11);
    ctx.stroke();
    // 選択中の離陸地点(赤丸)
    if (launchSel.x !== null) {
      const [lx, ly] = worldToScreen(launchSel.x, launchSel.z);
      ctx.fillStyle = '#e53935';
      ctx.beginPath();
      ctx.arc(lx, ly, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(lx, ly, 14, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ドラッグ=パン、動かず離したら=離陸地点の選択
  let drag = null;
  cv.addEventListener('mousedown', (e) => {
    drag = { cx: e.clientX, cy: e.clientY, vx: view.x, vz: view.z, moved: false };
  });
  addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.cx) * cssRatio();
    const dy = (e.clientY - drag.cy) * cssRatio();
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (drag.moved) {
      view.x = drag.vx - dx / view.scale;
      view.z = drag.vz - dy / view.scale;
      clampView();
      render();
    }
  });
  cv.addEventListener('mouseup', (e) => {
    if (drag && !drag.moved) {
      const [wx, wz] = screenToWorld(e.offsetX * cssRatio(), e.offsetY * cssRatio());
      launchSel.x = THREE.MathUtils.clamp(wx, M.minX, M.minX + terrain.sizeMeters);
      launchSel.z = THREE.MathUtils.clamp(wz, M.minZ, M.minZ + terrain.sizeMeters);
      render();
      const btn = document.getElementById('launch-btn');
      btn.disabled = false;
      const d = Math.hypot(launchSel.x - TARGET_XZ.x, launchSel.z - TARGET_XZ.z);
      btn.textContent = mpLaunchLabel(d);
      if (MP.room && MP.ready) { MP.room.sendUnready(); MP.ready = false; } // 地点変更で準備解除
    }
    drag = null;
  });
  addEventListener('mouseup', () => { drag = null; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [wx, wz] = screenToWorld(e.offsetX * cssRatio(), e.offsetY * cssRatio());
    const k = e.deltaY < 0 ? 1.3 : 1 / 1.3;
    view.scale = THREE.MathUtils.clamp(view.scale * k, fitScale, MAX_SCALE);
    // カーソル位置の地点が動かないように中心を合わせ直す
    view.x = wx - (e.offsetX * cssRatio() - cv.width / 2) / view.scale;
    view.z = wz - (e.offsetY * cssRatio() - cv.height / 2) / view.scale;
    clampView();
    render();
  }, { passive: false });

  render();
}

document.getElementById('launch-btn').addEventListener('click', () => {
  if (launchSel.x === null) return;
  if (MP.room) { mpToggleReady(); return; } // マルチプレイは準備完了→ホスト開始→同時離陸
  applyWindFromEditor(); // 離陸時点のエディタ内容で風を確定
  if (document.getElementById('gw-enable').checked) {
    const distKm = Math.max(0, Number(document.getElementById('gw-dist').value) || 0);
    groundWind = rollGroundWind(distKm);
    groundWind.launchGround = groundWindActual(0); // 離陸時点(t=0)の実況値を凍結して保存
    renderFlightPibal(); // グレーアウト行を反映
  }
  startFlight(launchSel.x, launchSel.z);
});

function startFlight(x, z) {
  applyTargetColor(!!groundWind);
  // 離陸地点とターゲット周辺は先に高解像度化しておく
  terrain.requestDetail(x, z);
  terrain.requestDetail(TARGET_XZ.x, TARGET_XZ.z);
  launchDist = Math.hypot(x - TARGET_XZ.x, z - TARGET_XZ.z);
  state.pos.set(x, terrain.getHeight(x, z), z);
  state.vy = 0;
  state.heat = 0.5;
  state.grounded = true;
  balloon.group.position.copy(state.pos);
  controls.target.copy(state.pos).add(new THREE.Vector3(0, 12, 0));
  camera.position.copy(controls.target).add(new THREE.Vector3(60, 35, 60));
  prevPos.copy(state.pos);
  document.getElementById('briefing').style.display = 'none';
  flightReady = true;
  started = true;
}

const balloon = buildBalloon();
scene.add(balloon.group);
const balloonShadow = buildShadowMesh();
scene.add(balloonShadow);

// 毎フレーム: 影を気球直下の地面に置き、対地高度でサイズと濃さを変える
function updateShadow() {
  const groundY = terrain.getHeight(state.pos.x, state.pos.z);
  const agl = Math.max(0, state.pos.y - groundY);
  balloonShadow.position.set(state.pos.x, groundY + 0.8, state.pos.z);
  const size = Math.min(19 + agl * 0.05, 60); // 球皮直径≒18mを基準に高いほどぼやけて拡大
  balloonShadow.scale.set(size, size, 1);
  balloonShadow.material.opacity = Math.max(0.07, 0.55 * 300 / (300 + agl));
}

const targetGroundY = terrain.getHeight(TARGET_XZ.x, TARGET_XZ.z);
const target = buildTarget(TARGET_XZ.x, TARGET_XZ.z, targetGroundY);
scene.add(target);

// マーカーは1本。dropped後は marker.state が物理を持つ
const marker = { available: 1, state: null, mesh: null };

// マーカーの軌跡記録(リプレイ用)。実時間(タイムスケール非依存)のタイムスタンプで記録し、
// 再生時も実時間でなぞることで「落下にかかった実際の時間」のまま見返せるようにする
let markerTrail = null;
let markerTrailElapsed = 0;
const REPLAY_DIST_THRESHOLD = 10; // この距離未満(m)ならリプレイボタンを表示

function dropMarker() {
  if (marker.available <= 0 || state.grounded || expired) return;
  marker.available = 0;
  const w = windAt(state.pos.y);
  marker.state = {
    pos: state.pos.clone().add(new THREE.Vector3(0, 0.8, 0)),
    vel: new THREE.Vector3(w.vx, state.vy, w.vz), // 気球(=風)の速度を引き継ぐ
    landed: false,
  };
  marker.mesh = buildMarkerMesh();
  marker.mesh.position.copy(marker.state.pos);
  scene.add(marker.mesh);
  document.getElementById('marker-info').textContent = '投下!';
  markerTrailElapsed = 0;
  // 各サンプルにその瞬間の気球位置(balloonPos)も記録し、リプレイで気球ごと再現できるようにする
  markerTrail = [{ t: 0, pos: marker.state.pos.clone(), balloonPos: state.pos.clone() }];
  MP.myDropped = true;
  if (MP.room) MP.room.sendDrop(); // スコアボードの「投下✓」用
}

// rawDt: 実時間の経過秒(タイムスケールの影響を受けない)。リプレイの記録専用
function stepMarker(dt, rawDt) {
  const m = marker.state;
  if (!m || m.landed) return;
  const w = windAt(m.pos.y);
  // 鉛直: 重力+空気抵抗(終端速度 MARKER_TERMINAL)/ 水平: 風に漸近
  m.vel.y += (-9.81 - MARKER_DRAG * m.vel.y) * dt;
  m.vel.x += ((w.vx - m.vel.x) / MARKER_WIND_TAU) * dt;
  m.vel.z += ((w.vz - m.vel.z) / MARKER_WIND_TAU) * dt;
  m.pos.addScaledVector(m.vel, dt);

  markerTrailElapsed += rawDt;
  markerTrail.push({ t: markerTrailElapsed, pos: m.pos.clone(), balloonPos: state.pos.clone() });

  const ground = terrain.getHeight(m.pos.x, m.pos.z);
  if (m.pos.y <= ground) {
    m.pos.y = ground + 0.3;
    m.landed = true;
    marker.mesh.position.copy(m.pos);
    // 着地位置を確定点として追加
    markerTrail.push({ t: markerTrailElapsed, pos: m.pos.clone(), balloonPos: state.pos.clone() });
    onMarkerLanded(m.pos);
    return;
  }
  marker.mesh.position.copy(m.pos);
  marker.mesh.rotation.y += 2 * dt; // リボンの回転(演出)
  document.getElementById('marker-info').textContent = `落下中 ${Math.round(m.pos.y - ground)}m`;
}

const RESULT_SUSPENSE_MS = 3000; // 着地〜結果発表までの間(実時間。時間加速の影響を受けない)
let measureLine = null; // 着地点→ターゲットの計測ライン。リプレイ中は着地するまで隠す

function onMarkerLanded(pos) {
  const dist = Math.hypot(pos.x - TARGET_XZ.x, pos.z - TARGET_XZ.z);
  // 着地点→ターゲットの計測ライン
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(pos.x, pos.y + 1, pos.z),
    new THREE.Vector3(TARGET_XZ.x, targetGroundY + 1, TARGET_XZ.z),
  ]);
  measureLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x29e0ff }));
  scene.add(measureLine);
  document.getElementById('marker-info').textContent = '計測中...';
  MP.myDist = dist;
  if (MP.room) MP.room.sendLanded(dist); // 演出の3秒を待たず、着地の瞬間にサーバーへ確定距離を送る
  setTimeout(() => showResult(dist, null), RESULT_SUSPENSE_MS);
}

function showResult(dist, note) {
  if (MP.resultsShown) return; // 全員確定の順位表が出た後は個人リザルトを重ねない
  const prev = Number(localStorage.getItem(BEST_KEY));
  const isBest = !Number.isFinite(prev) || prev <= 0 || dist < prev;
  if (isBest) localStorage.setItem(BEST_KEY, dist.toFixed(1));

  const subs = [];
  if (note) subs.push(note);
  subs.push(isBest ? '自己ベスト更新!' : `自己ベスト: ${Number(prev).toFixed(1)} m`);
  if (MP.room) {
    subs.push('🎈 全員の計測を待っています…');
    document.getElementById('result-retry').style.display = 'none';
    document.getElementById('result-share').style.display = 'none';
  }
  document.getElementById('result-dist').textContent = dist.toFixed(1);
  document.getElementById('result-sub').innerHTML = subs.join('<br>');
  document.getElementById('result').style.display = '';
  document.getElementById('result-reopen').style.display = 'none'; // 隠していた場合の後始末
  document.getElementById('marker-info').textContent = `${dist.toFixed(1)} m`;

  // 離陸地点がゴールに近いほど有利になるため、参考情報として直線距離を添える
  const launchInfo = document.getElementById('result-launch');
  if (launchDist !== null) {
    launchInfo.textContent = `離陸地点からゴールまで: ${launchDist.toFixed(0)} m`;
    launchInfo.style.display = '';
  } else {
    launchInfo.style.display = 'none';
  }

  // 地上風ゆらぎの有効/無効
  document.getElementById('result-gw').textContent = `地上風ゆらぎ: ${groundWind ? '有効' : '無効'}`;
  document.getElementById('result-gw').style.display = '';

  // ターゲット至近(10m未満)なら、マーカー投下のリプレイボタンを出す
  const replayBtn = document.getElementById('result-replay');
  const canReplay = markerTrail && markerTrail.length > 1 && dist < REPLAY_DIST_THRESHOLD;
  replayBtn.style.display = canReplay ? '' : 'none';
}

// ---- マーカー投下リプレイ(三人称視点・実時間で再生。何度でも見返せる) ----
let replay = null; // 再生中の状態(nullなら非再生)
let replayPrevFpv = false;

function startReplay() {
  if (!markerTrail || markerTrail.length < 2 || replay) return;
  document.getElementById('result').style.display = 'none';
  replayPrevFpv = fpv;
  if (fpv) { fpv = false; applyViewMode(); }
  if (measureLine) measureLine.visible = false; // 着地するまで計測ラインは隠す

  const first = markerTrail[0];
  const focusStart = first.pos.clone().add(new THREE.Vector3(0, 2, 0));
  controls.target.copy(focusStart);
  camera.position.copy(focusStart).add(new THREE.Vector3(60, 35, 60));
  balloon.group.position.copy(first.balloonPos); // 気球も投下時点の位置に戻す

  replay = {
    samples: markerTrail,
    duration: markerTrail[markerTrail.length - 1].t,
    t: 0,
    idx: 0,
    prevFocus: first.pos.clone(),
    finished: false,
  };
}

function endReplay() {
  replay = null;
  if (replayPrevFpv) { fpv = true; applyViewMode(); }
  document.getElementById('result').style.display = '';
}

// 実時間rawDtで記録済みの軌跡をなぞる。カメラは気球追従と同じ「差分平行移動」方式で追う。
// マーカーだけでなく気球の位置も一緒に再現し、着地後は3秒の余韻を置いてから結果画面に戻る
function stepReplay(rawDt) {
  const r = replay;
  if (r.finished) return; // 結果表示までの余韻待ち中(setTimeoutが解決するのを待つだけ)
  r.t += rawDt;
  const samples = r.samples;
  if (r.t >= r.duration) {
    const last = samples[samples.length - 1];
    marker.mesh.position.copy(last.pos);
    balloon.group.position.copy(last.balloonPos);
    if (measureLine) measureLine.visible = true; // 着地したので計測ラインを表示
    r.finished = true;
    setTimeout(endReplay, RESULT_SUSPENSE_MS);
    return;
  }
  let i = r.idx;
  while (i < samples.length - 2 && samples[i + 1].t <= r.t) i++;
  r.idx = i;
  const a = samples[i], b = samples[i + 1] || a;
  const span = Math.max(1e-6, b.t - a.t);
  const k = THREE.MathUtils.clamp((r.t - a.t) / span, 0, 1);
  const pos = a.pos.clone().lerp(b.pos, k);
  marker.mesh.position.copy(pos);
  balloon.group.position.copy(a.balloonPos.clone().lerp(b.balloonPos, k));

  const focus = pos.clone().add(new THREE.Vector3(0, 2, 0));
  const delta = new THREE.Vector3().subVectors(focus, r.prevFocus);
  camera.position.add(delta);
  controls.target.copy(focus);
  r.prevFocus.copy(focus);
}
document.getElementById('result-replay').addEventListener('click', startReplay);

// 制限時間の進行。時間内に投下できなければ現在地点で計測(フォールバック)
function stepClock(dt) {
  if (expired) return;
  remaining = Math.max(0, remaining - dt);
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
  hud.clock.textContent = `${mm}:${ss}`;
  if (remaining <= 0) {
    if (MP.room) return; // マルチプレイの時間切れはサーバーのtimeup配信に従う(mpOnTimeup)
    expired = true;
    if (!marker.state) {
      marker.available = 0;
      const d = Math.hypot(state.pos.x - TARGET_XZ.x, state.pos.z - TARGET_XZ.z);
      showResult(d, '制限時間切れ: 現在地点で計測');
    }
  }
}

document.getElementById('result-retry').addEventListener('click', () => location.reload());

// 結果パネルの開閉(投下後、パネルをどけて着地点周辺の景色を見たいという要望への対応)
document.getElementById('result-hide').addEventListener('click', () => {
  document.getElementById('result').style.display = 'none';
  document.getElementById('result-reopen').style.display = '';
});
document.getElementById('result-reopen').addEventListener('click', () => {
  document.getElementById('result').style.display = '';
  document.getElementById('result-reopen').style.display = 'none';
});

// 物理状態。pos.y はバスケット底面の標高(MSL)
const state = {
  pos: new THREE.Vector3(0, terrain.getHeight(0, 0), 0),
  vy: 0,
  heat: 0.5,   // エンベロープ温度(0..1)。0.5 が中立浮力
  fuel: 100,
  grounded: true,
};
const H_NEUTRAL = 0.5;

function stepPhysics(dt) {
  if (input.burner && state.fuel > 0) {
    state.heat += 0.055 * dt;
    state.fuel = Math.max(0, state.fuel - 0.25 * dt);
  }
  if (input.rip) state.heat -= 0.16 * dt;
  state.heat -= 0.012 * dt; // 自然冷却
  state.heat = THREE.MathUtils.clamp(state.heat, 0, 1);

  // 浮力(温度差比例)と空気抵抗。加熱の効きが遅れて現れる感覚はこの一次遅れで出る
  const acc = 7.0 * (state.heat - H_NEUTRAL) - 0.5 * state.vy;
  state.vy += acc * dt;
  state.pos.y += state.vy * dt;

  const w = windAt(state.pos.y);
  if (!state.grounded) {
    state.pos.x += w.vx * dt;
    state.pos.z += w.vz * dt;
  }

  const ground = terrain.getHeight(state.pos.x, state.pos.z);
  if (state.pos.y <= ground) {
    state.pos.y = ground;
    if (state.vy < 0) state.vy = 0;
    state.grounded = true;
  } else if (state.pos.y > ground + 0.05) {
    state.grounded = false;
  }
  return w;
}

// ---- コンパス(カメラの向き=画面正面の磁方位。ターゲット方向をオレンジ印で表示) ----
const compassCv = document.getElementById('compass');
const compassCtx = compassCv.getContext('2d');
const camDirTmp = new THREE.Vector3();

function drawCompass() {
  camera.getWorldDirection(camDirTmp);
  const heading = (Math.atan2(camDirTmp.x, -camDirTmp.z) * 180 / Math.PI + 360) % 360;

  const ctx = compassCtx;
  const W = compassCv.width, C = W / 2, R = W / 2 - 10;
  ctx.clearRect(0, 0, W, W);

  // 文字盤(視線方向が常に上。北の文字が回る)
  ctx.save();
  ctx.translate(C, C);
  ctx.rotate((-heading * Math.PI) / 180);
  for (let d = 0; d < 360; d += 30) {
    const rad = (d * Math.PI) / 180;
    const isCard = d % 90 === 0;
    ctx.strokeStyle = isCard ? '#e8f0f6' : '#5a7085';
    ctx.lineWidth = isCard ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(Math.sin(rad) * (R - (isCard ? 12 : 7)), -Math.cos(rad) * (R - (isCard ? 12 : 7)));
    ctx.lineTo(Math.sin(rad) * R, -Math.cos(rad) * R);
    ctx.stroke();
  }
  ctx.font = 'bold 20px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cards = [['N', 0, '#ff5252'], ['E', 90, '#e8f0f6'], ['S', 180, '#e8f0f6'], ['W', 270, '#e8f0f6']];
  for (const [label, deg, color] of cards) {
    const rad = (deg * Math.PI) / 180;
    ctx.save();
    ctx.translate(Math.sin(rad) * (R - 26), -Math.cos(rad) * (R - 26));
    ctx.rotate((heading * Math.PI) / 180); // 文字自体は正立させる
    ctx.fillStyle = color;
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  // ターゲット方向(オレンジの印)
  const brgT = Math.atan2(TARGET_XZ.x - state.pos.x, -(TARGET_XZ.z - state.pos.z));
  ctx.fillStyle = '#ff5a00';
  ctx.beginPath();
  ctx.arc(Math.sin(brgT) * (R - 5), -Math.cos(brgT) * (R - 5), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 視線方向の固定ポインタ(上向き三角)と数値
  ctx.fillStyle = '#ffd54f';
  ctx.beginPath();
  ctx.moveTo(C, 4);
  ctx.lineTo(C - 7, 18);
  ctx.lineTo(C + 7, 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8f0f6';
  ctx.font = 'bold 16px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${String(Math.round(heading)).padStart(3, '0')}°`, C, C);
}

// ---- HUD ----
const hud = {
  altFt: document.getElementById('alt-ft'),
  altM: document.getElementById('alt-m'),
  agl: document.getElementById('agl'),
  vario: document.getElementById('vario'),
  wind: document.getElementById('wind'),
  fuel: document.getElementById('fuel'),
  fuelFill: document.getElementById('fuel-fill'),
  heatFill: document.getElementById('heat-fill'),
  status: document.getElementById('status'),
  target: document.getElementById('target-info'),
  clock: document.getElementById('clock'),
};
function updateHud(w) {
  const ground = terrain.getHeight(state.pos.x, state.pos.z);
  hud.altFt.textContent = Math.round(state.pos.y * M2FT);
  hud.altM.textContent = Math.round(state.pos.y);
  hud.agl.textContent = Math.round(state.pos.y - ground);
  hud.vario.textContent = (state.vy >= 0 ? '+' : '') + state.vy.toFixed(1);
  hud.wind.textContent = `${String(Math.round(toDisplayDir(w.dir))).padStart(3, '0')}° / ${w.kt.toFixed(0)}kt`;
  hud.fuel.textContent = Math.round(state.fuel);
  hud.fuelFill.style.width = `${state.fuel}%`;
  hud.heatFill.style.width = `${state.heat * 100}%`;
  hud.status.textContent = state.grounded ? '接地' : '飛行中';

  const dxE = TARGET_XZ.x - state.pos.x;        // 東成分
  const dN = -(TARGET_XZ.z - state.pos.z);      // 北成分
  const distT = Math.hypot(dxE, dN);
  const brg = (Math.atan2(dxE, dN) * 180 / Math.PI + 360) % 360;
  hud.target.textContent =
    `${distT >= 1000 ? (distT / 1000).toFixed(2) + ' km' : Math.round(distT) + ' m'} / ${String(Math.round(brg)).padStart(3, '0')}°`;
}

// ---- カメラ初期配置 ----
balloon.group.position.copy(state.pos);
controls.target.copy(state.pos).add(new THREE.Vector3(0, 12, 0));
camera.position.copy(controls.target).add(new THREE.Vector3(60, 35, 60));
applyViewMode();

const prevPos = state.pos.clone();
const clock = new THREE.Clock();
let lastDetailCheck = 0;
let envGlow = 0;  // バーナー点火時の球皮内面の明るさ(0..1、滑らかに追従)
let ripPull = 0;  // リップラインを引いた量(0..1、滑らかに追従)

// デバッグ用: ?autostart=1 でブリーフィングを飛ばして即離陸(自動テスト向け)。
// ?fpv=1 を併用するとゴンドラ視点で開始(視点確認用)
if (new URLSearchParams(location.search).has('autostart')) {
  startFlight(800, 1800);
  if (new URLSearchParams(location.search).has('fpv')) {
    fpv = true;
    applyViewMode();
  }
}

renderer.setAnimationLoop(() => {
  const rawDt = Math.min(clock.getDelta(), 0.05); // 実時間(タイムスケール非依存)
  const dt = rawDt * timeScale;

  if (replay) {
    // リプレイ中はシミュレーションを止め、記録した軌跡だけを実時間で再生する
    stepReplay(rawDt);
  } else if (started) {
    const w = stepPhysics(dt);
    stepMarker(dt, rawDt);
    stepClock(dt);
    updateSounds(w.kt);

    balloon.group.position.copy(state.pos);
    updateShadow();
    balloon.flame.visible = input.burner && state.fuel > 0;
    balloon.flameLight.intensity = balloon.flame.visible ? 40 : 0;

    // バーナー点火で球皮内面がふわっと暖色に明るくなる(点滅ではなく滑らかな変化)
    const glowTarget = balloon.flame.visible ? 1 : 0;
    envGlow += (glowTarget - envGlow) * Math.min(1, dt * 2.5);
    balloon.envInnerMat.color.setRGB(1 + 0.3 * envGlow, 1 + 0.12 * envGlow, 1);
    // リップラインを引いている間はロープが引き下がる
    const pullTarget = input.rip ? 1 : 0;
    ripPull += (pullTarget - ripPull) * Math.min(1, dt * 6);
    balloon.rope.position.y = balloon.ropeBaseY - 0.18 * ripPull;

    if (fpv) {
      // ゴンドラ視点: 目の位置は気球に固定し、視線方向だけドラッグで回す。
      // 立ち位置は中心から少し横(実機のパイロット位置。真上の炎が正しく見える)
      camera.position.set(state.pos.x - 0.45, state.pos.y + EYE_HEIGHT, state.pos.z);
      const cy = Math.cos(fpvPitch), sy = Math.sin(fpvPitch);
      const dir = new THREE.Vector3(Math.sin(fpvYaw) * cy, sy, -Math.cos(fpvYaw) * cy);
      camera.lookAt(camera.position.x + dir.x, camera.position.y + dir.y, camera.position.z + dir.z);
    } else {
      // カメラは気球に追従(ターゲット+同じ分だけ平行移動)
      const delta = new THREE.Vector3().subVectors(state.pos, prevPos);
      camera.position.add(delta);
      controls.target.copy(state.pos).add(new THREE.Vector3(0, 12, 0));
    }
    prevPos.copy(state.pos);

    updateHud(w);
    drawCompass();

    // マルチプレイ: 自機位置を送信(送信間隔はnet.js側で調整)し、他機のゴーストを補間表示
    if (MP.room) {
      MP.room.sendPos(state.pos.x, state.pos.y, state.pos.z);
      updateGhosts(rawDt); // 位置の補間自体は見た目のなめらかさ優先で実時間のまま
      updateGhostMarkers(dt); // マーカーの落下物理は合意タイムスケールに揃える(自機と同じ速さで見える)
    }

    // 気球の近くの地面を段階的に高解像度化(1.5秒おきに1枚ずつ)。
    // 低高度では直下の1タイルだけさらにz17(≒1m/px)へ
    if (performance.now() - lastDetailCheck > 1500) {
      lastDetailCheck = performance.now();
      terrain.updateDetail(state.pos.x, state.pos.z);
      const agl = state.pos.y - terrain.getHeight(state.pos.x, state.pos.z);
      if (agl < 1000) terrain.requestUltra(state.pos.x, state.pos.z);
    }
  }

  if (!fpv) controls.update();
  renderer.render(scene, camera);
});

// ==== マルチプレイ(みんなで飛ぶ) ====================================
// ゴーストバルーン方式: 物理は自機のみ計算し、他機はサーバー経由の位置を補間表示する。
// プロトコルとサーバー実装は ../server/ を参照。ソロプレイでは MP.room が null のまま、
// このセクションの関数は何もしない(または呼ばれない)。

// 他プレイヤー名をinnerHTMLに混ぜるためのエスケープ。
// この節はファイル途中のtop-level awaitより後に評価されるため、
// それ以前に呼ばれても参照できるよう関数宣言(巻き上げあり)にしている
function esc(s) {
  return String(s).replace(/[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function mpStatus(s) { document.getElementById('mp-status').textContent = s; }

function mpInviteUrl(code) {
  const server = new URLSearchParams(location.search).get('server');
  return `${location.origin}${location.pathname}?room=${code}`
    + (server ? `&server=${encodeURIComponent(server)}` : '');
}

function mpLaunchLabel(d) {
  const km = (d / 1000).toFixed(2);
  return MP.room ? `準備完了にする(ターゲットまで ${km} km)` : `離陸!(ターゲットまで ${km} km)`;
}

// 色パレットを描画し、クリックで選択(初期値はランダム)
function mpRenderColors(containerId, initial) {
  const el = document.getElementById(containerId);
  el.innerHTML = BALLOON_COLORS
    .map((c, i) => `<button type="button" data-i="${i}" title="${c.name}" style="background:${c.ui}"></button>`)
    .join('');
  const select = (i) => {
    MP.myColor = i;
    [...el.children].forEach((b, j) => b.classList.toggle('sel', j === i));
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) select(Number(b.dataset.i));
  });
  select(Number.isInteger(initial) ? initial : Math.floor(Math.random() * BALLOON_COLORS.length));
}

// ゲスト入室ゲート(?room= 付きで開いたとき、地形読み込みより先に呼ばれる)。
// 名前と色を決めて接続し、ホストの条件(エリア・風)を返す
async function mpJoinGate(code) {
  MP.code = code;
  const params = new URLSearchParams(location.search);
  const autoName = (params.get('n') || '').trim().slice(0, 12);
  const cParam = Number(params.get('c'));
  const initColor = Number.isInteger(cParam) && cParam >= 0 && cParam < BALLOON_COLORS.length
    ? cParam : undefined;

  const overlay = document.getElementById('mp-join');
  document.getElementById('mp-join-code').textContent = code;
  mpRenderColors('mp-join-colors', initColor);
  const nameIn = document.getElementById('mp-join-name');
  nameIn.value = autoName;
  const statusEl = document.getElementById('mp-join-status');
  const goBtn = document.getElementById('mp-join-go');
  overlay.style.display = 'flex';

  const tryConnect = async () => {
    const name = nameIn.value.trim().slice(0, 12);
    if (!name) { statusEl.textContent = 'パイロット名を入力してください'; return null; }
    goBtn.disabled = true;
    statusEl.textContent = '接続中…';
    const room = new Room();
    try {
      await room.connect({ code, name, color: MP.myColor, create: false });
      MP.room = room;
      MP.myName = name;
      return room;
    } catch (err) {
      goBtn.disabled = false;
      statusEl.innerHTML =
        `⚠ ${esc(err.message)} <a href="${location.pathname}" style="color:#9ecfff">ソロで飛ぶ</a>`;
      return null;
    }
  };

  let room = null;
  const waitClickAndConnect = async () => {
    while (!room) {
      await new Promise((resolve) => { goBtn.onclick = resolve; });
      room = await tryConnect();
    }
  };
  // 切断時の入り直し: しばらく自動で試し、ダメなら「参加する」ボタン待ちに戻す
  const reconnectLoop = async () => {
    for (let i = 0; i < 8 && !room; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      room = await tryConnect();
    }
    await waitClickAndConnect();
  };

  if (autoName) room = await tryConnect(); // 再戦後の自動再入室(URLに名前と色を引き継いでいる)
  await waitClickAndConnect();

  // 手入力で初参加した場合もURLに名前・色を反映しておく(事故リロード対策。
  // 再戦時の自動再入室と同じ仕組みに乗せる)
  if (!autoName) {
    const mpUrl = new URL(location.href);
    mpUrl.searchParams.set('n', MP.myName);
    mpUrl.searchParams.set('c', String(MP.myColor));
    history.replaceState(null, '', mpUrl);
  }

  // フルリロード後の復帰かどうかをここで確定する。helloのstateがlobby以外なら、
  // ソロと同じブリーフィング画面(離陸地点の選び直し等)は出さずその場で再開する
  MP.resumeState = room.hello.state;
  MP.launch = room.hello.launch || null;
  MP.isResuming = MP.resumeState !== 'lobby';

  // ホストの条件配布を待つ。待機中にアプリ切替等で切断されたら入り直す
  let setup = room.setup;
  while (!setup) {
    statusEl.textContent = 'ホストの条件配布を待っています…';
    const ev = await new Promise((resolve) => {
      room.on('setup', (s) => resolve({ setup: s }));
      room.on('close', () => resolve({}));
    });
    if (ev.setup) { setup = ev.setup; break; }
    statusEl.textContent = '⚠ 接続が切れました。再接続しています…';
    room = null;
    MP.room = null;
    await reconnectLoop();
    setup = room.setup;
  }
  mpWireRoom(); // setup待ちの仮ハンドラを本ハンドラで置き換える

  // リザルト画面への復帰: resultsイベント(mpWireRoom登録直後にサーバーから届く)を
  // 待ってから合流する。isResuming中は演出の3秒待ちを省略するようmpShowResults側で分岐する
  if (MP.resumeState === 'results' && !MP.resultsShown) {
    await new Promise((resolve) => {
      const iv = setInterval(() => { if (MP.resultsShown) { clearInterval(iv); resolve(); } }, 50);
      setTimeout(() => { clearInterval(iv); resolve(); }, 3000); // 保険(万一届かなくても先に進む)
    });
  }

  overlay.style.display = 'none';
  return setup;
}

// ブリーフィング表示後に呼ばれる。ホスト用の作成UIとゲスト用のロビーを整える
function mpBriefingInit() {
  if (MP.room) {
    // ゲスト: 入室済み。条件は編集不可、準備完了フローへ
    document.getElementById('mp-entry').style.display = 'none';
    document.getElementById('mp-room-code').textContent = MP.code;
    document.getElementById('mp-lobby').style.display = '';
    mpLockWind();
    mpRenderGroundWindUI();
    mpRenderRoster();
  } else {
    mpRenderColors('mp-colors');
    document.getElementById('mp-create').addEventListener('click', mpCreateRoom);
    document.getElementById('mp-join-btn').addEventListener('click', () => {
      const code = document.getElementById('mp-code-in').value.trim().toUpperCase();
      const name = document.getElementById('mp-name').value.trim().slice(0, 12);
      if (!/^[A-Z0-9]{4,8}$/.test(code)) { mpStatus('ルームコードを入力してください'); return; }
      if (!name) { mpStatus('パイロット名を入力してください'); return; }
      location.href = `${mpInviteUrl(code)}&n=${encodeURIComponent(name)}&c=${MP.myColor}`;
    });
  }
  document.getElementById('mp-copy').addEventListener('click', (e) => {
    navigator.clipboard.writeText(mpInviteUrl(MP.code))
      .then(() => { e.target.textContent = 'コピーしました!'; })
      .catch(() => { e.target.textContent = 'コピー失敗'; })
      .finally(() => setTimeout(() => { e.target.textContent = '招待URLをコピー'; }, 1600));
  });
  document.getElementById('mp-start').addEventListener('click', () => { if (MP.room) MP.room.sendStart(); });
  document.getElementById('mp-rematch').addEventListener('click', () => {
    // リザルト画面を見ている間に接続が切れていることがある(アプリ切替等)。
    // その場合は繋ぎ直してから再戦を送る
    if (MP.room && MP.room.alive) {
      MP.room.sendRematch();
      return;
    }
    MP.pendingRematch = true;
    document.getElementById('mp-results-note').textContent = '再接続しています…';
    mpTryReconnect();
  });
}

// ホストとしてルームを作成し、現在の条件(エリア・風)を配布する
async function mpCreateRoom() {
  const name = document.getElementById('mp-name').value.trim().slice(0, 12);
  if (!name) { mpStatus('パイロット名を入力してください'); return; }
  mpStatus('接続中…');
  const code = randomRoomCode();
  const room = new Room();
  try {
    await room.connect({ code, name, color: MP.myColor, create: true });
  } catch (err) {
    mpStatus(`⚠ 接続できませんでした(${err.message})`);
    return;
  }
  MP.room = room;
  MP.code = code;
  MP.myName = name;
  MP.isCreator = true;
  mpWireRoom();
  // 事故リロード対策: URLに?room=を反映しておく。誤ってリロードボタンを押しても
  // 通常のゲスト参加と同じ復帰ゲート(mpJoinGate)を通り、ソロの新規ゲームに
  // 迷い込まず同じルームへ戻れるようにする
  const mpUrl = new URL(location.href);
  mpUrl.searchParams.set('room', code);
  mpUrl.searchParams.set('n', name);
  mpUrl.searchParams.set('c', String(MP.myColor));
  history.replaceState(null, '', mpUrl);
  applyWindFromEditor(); // エディタの内容で風を確定してから配布(以後は編集不可)
  let gwPayload = null;
  if (document.getElementById('gw-enable').checked) {
    const distKm = Math.max(0, Number(document.getElementById('gw-dist').value) || 0);
    gwPayload = rollGroundWind(distKm); // 隠しパラメータはホストが1回だけ決め、全員で共有する
  }
  room.sendSetup(AREA, PIBAL.map((r) => [r.ft, r.dir, r.kt]), gwPayload);
  mpLockWind();
  document.getElementById('mp-entry').style.display = 'none';
  document.getElementById('mp-room-code').textContent = code;
  document.getElementById('mp-lobby').style.display = '';
  mpStatus('招待URLを友達に送ってください');
  if (launchSel.x !== null) {
    const d = Math.hypot(launchSel.x - TARGET_XZ.x, launchSel.z - TARGET_XZ.z);
    document.getElementById('launch-btn').textContent = mpLaunchLabel(d);
  }
  mpRenderRoster();
}

// ルーム作成後・入室後は風条件を全員で共有するため編集を止める
function mpLockWind() {
  const tools = document.querySelector('.wind-tools');
  if (tools) tools.style.display = 'none';
  for (const el of document.querySelectorAll('#wind-editor input')) el.disabled = true;
  for (const el of document.querySelectorAll('#wind-editor .del')) el.style.display = 'none';
  // 地上風のゆらぎはホストが決めた値を全員で共有するため編集を止める(表示自体は残す)
  document.getElementById('gw-enable').disabled = true;
  document.getElementById('gw-dist').disabled = true;
}

// groundWind(共有済みの状態)に合わせて、ブリーフィングのトグル/距離表示を更新する。
// ホスト・ゲスト共通(サーバーから届いたsetupをそのまま反映するだけ)
function mpRenderGroundWindUI() {
  const on = !!groundWind;
  document.getElementById('gw-enable').checked = on;
  document.getElementById('gw-dist-row').style.display = on ? 'flex' : 'none';
  document.getElementById('gw-dist-hint').style.display = on ? 'block' : 'none';
  if (on) document.getElementById('gw-dist').value = groundWind.distKm;
}

function mpToggleReady() {
  const btn = document.getElementById('launch-btn');
  if (!MP.ready) {
    MP.launch = { x: launchSel.x, z: launchSel.z };
    MP.room.sendReady(MP.launch);
    MP.ready = true;
    btn.textContent = '✅ 準備完了(クリックで取り消し)';
  } else {
    MP.room.sendUnready();
    MP.ready = false;
    const d = Math.hypot(launchSel.x - TARGET_XZ.x, launchSel.z - TARGET_XZ.z);
    btn.textContent = mpLaunchLabel(d);
  }
}

// サーバーからのイベントをUIへ配線する(ホスト・ゲスト共通)
function mpWireRoom() {
  const room = MP.room;
  room.on('roster', mpRenderRoster);
  room.on('setup', (s) => {
    PIBAL = s.wind.map(toRowObj);
    renderEditorRows(PIBAL);
    // groundWindはホストが1回だけ決めた値がそのまま届く(自分では乱数を引き直さない)。
    // launchGroundは共有パラメータだけで決まる純粋な値なので、いつ計算しても同じ結果になる
    groundWind = s.groundWind ? { ...s.groundWind } : null;
    if (groundWind) groundWind.launchGround = groundWindActual(0);
    mpLockWind();
    mpRenderGroundWindUI();
    renderFlightPibal();
  });
  room.on('countdown', mpCountdown);
  room.on('drop', onGhostDrop);
  room.on('snap', (m) => {
    if (started) remaining = Math.max(0, m.clock); // サーバーの時計を正とする
    if (m.scale !== timeScale) applyServerScale(m.scale);
  });
  room.on('scale', applyServerScale);
  room.on('timeup', mpOnTimeup);
  room.on('results', (rows) => {
    // 復帰時(自分の着地演出ではない)は3秒の余韻を挟まず即座に見せる
    setTimeout(() => mpShowResults(rows), MP.isResuming ? 0 : RESULT_SUSPENSE_MS);
  });
  room.on('rematch', () => {
    // もう一回戦: 同じルームコードで同名・同色のまま再入室(条件はサーバーが保持)
    location.href = `${mpInviteUrl(MP.code)}&n=${encodeURIComponent(MP.myName)}&c=${MP.myColor}`;
  });
  room.on('error', (m) => mpStatus(`⚠ ${m.msg || m.code}`));
  room.on('close', () => {
    if (room !== MP.room) return;
    MP.room = null;
    // どの局面でも自動で入り直す。切断は異常ではなく正常系として扱う。
    // 飛行中・リザルト中はサーバー側が復帰猶予つきで席を保持している
    if (!started && !MP.resultsShown) MP.ready = false;
    mpScheduleReconnect(0);
  });
}

// ---- 自動再接続(ロビー・飛行中・リザルト共通) ----
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 8000, 8000, 8000];

// 局面に応じた場所に再接続の状態を表示する
function mpReconnectStatus(text) {
  if (MP.resultsShown) {
    document.getElementById('mp-results-note').textContent = text;
  } else if (started) {
    document.getElementById('mp-board').innerHTML = esc(text);
  } else {
    mpStatus(text);
  }
}

function mpScheduleReconnect(attempt) {
  if (attempt >= RECONNECT_DELAYS.length) {
    // 諦めメッセージ(タブを再度アクティブにした際の再試行は続く)
    mpReconnectStatus(started && !MP.resultsShown
      ? '⚠ 再接続できませんでした(ソロで続行。タブを切り替えると再試行します)'
      : '⚠ 再接続できませんでした。ページを再読み込みしてください');
    return;
  }
  mpReconnectStatus('⚠ 接続が切れました。再接続しています…');
  setTimeout(() => mpTryReconnect(attempt), RECONNECT_DELAYS[attempt]);
}

async function mpTryReconnect(attempt = 0) {
  if (MP.room || MP.reconnecting || !MP.code) return;
  MP.reconnecting = true;
  const room = new Room();
  try {
    // 作成者はcreate=1で再入室(全員切断でルームが空になっていても作り直せる)。
    // 飛行中・リザルト中は同名プレイヤーとしてサーバーが同じ機体に復帰させる
    await room.connect({ code: MP.code, name: MP.myName, color: MP.myColor, create: MP.isCreator });
    MP.room = room;
    mpWireRoom();
    if (!started && !MP.resultsShown) {
      // ロビー: 準備完了はサーバー側でリセットされているので押し直せる状態に戻す
      mpStatus('再接続しました');
      if (launchSel.x !== null) {
        const d = Math.hypot(launchSel.x - TARGET_XZ.x, launchSel.z - TARGET_XZ.z);
        const btn = document.getElementById('launch-btn');
        btn.textContent = mpLaunchLabel(d);
        btn.disabled = false;
      }
      // 自分がホストに戻った場合は条件を配り直す(空ルームを作り直したケース)。
      // 地上風ゆらぎの隠しパラメータも、既に決まっている値をそのまま再送する(引き直さない)
      if (MP.isCreator && room.isHost && !room.setup) {
        room.sendSetup(AREA, PIBAL.map((r) => [r.ft, r.dir, r.kt]), groundWind);
      }
    } else {
      // 飛行中/リザルト: 同じ機体への復帰。サーバーの時計・加速に合わせ直す
      mpReconnectStatus('再接続しました');
      if (room.hello && room.hello.clock != null && started && !MP.resultsShown) {
        remaining = Math.max(0, room.hello.clock);
        if (room.hello.scale && room.hello.scale !== timeScale) applyServerScale(room.hello.scale);
      }
      // 切断中に進んだ自分の投下・計測をサーバーへ再送(サーバー側は重複を無視する)
      if (MP.myDropped) room.sendDrop();
      if (MP.myDist != null) room.sendLanded(MP.myDist);
      if (MP.desired !== 1) room.sendSpeed(MP.desired);
      if (MP.pendingRematch && room.isHost) {
        room.sendRematch();
        MP.pendingRematch = false;
      }
    }
    mpRenderRoster();
  } catch (err) {
    mpScheduleReconnect(attempt + 1);
  } finally {
    MP.reconnecting = false;
  }
}

// タブが再度アクティブになった瞬間に即時再接続を試みる(バックオフ待ちをスキップ)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && MP.code && !MP.room) mpTryReconnect();
});

// ロビーの在室者一覧+ホストの開始ボタン
function mpRenderRoster() {
  if (!MP.room) return;
  const ps = MP.room.players;
  document.getElementById('mp-roster').innerHTML = ps.map((p) =>
    `<div><span class="chip" style="background:${BALLOON_COLORS[p.color].ui}"></span>` +
    `${esc(p.name)}${p.host ? ' 👑' : ''}${p.id === MP.room.id ? '(自分)' : ''} ` +
    `${p.ready ? '✅' : '…'}</div>`).join('');
  const startBtn = document.getElementById('mp-start');
  if (MP.room.isHost) {
    startBtn.style.display = '';
    const ok = ps.length >= 2 && ps.every((p) => p.ready);
    startBtn.disabled = !ok;
    startBtn.textContent = ok ? '🎈 一斉離陸スタート!'
      : (ps.length < 2 ? '参加者を待っています(2人以上で開始)' : '全員の準備完了待ち');
  } else {
    startBtn.style.display = 'none';
  }
  mpRenderBoard();
}

// 飛行中のスコアボード(投下✓のみ。距離は全員確定まで見せない)
function mpRenderBoard() {
  if (!MP.room) return;
  const el = document.getElementById('mp-board');
  el.innerHTML =
    `<div style="color:#9ecfff">ルーム ${MP.code} / 加速 全体×${timeScale}(希望×${MP.desired})</div>` +
    MP.room.players.map((p) =>
      `<div><span class="chip" style="background:${BALLOON_COLORS[p.color].ui}"></span>` +
      `${esc(p.name)} <span class="done">${p.connected === false ? '💤切断中'
        : p.landed ? '📍計測済' : p.dropped ? '🎯投下' : ''}</span></div>`)
      .join('');
}

// 選んだ球皮カラーを自機に反映する(球皮の外面・内面・スカート)
function applyBalloonColor(idx) {
  const c = BALLOON_COLORS[idx];
  if (!c) return;
  const pal = { cols: c.cols, seam: c.seam };
  balloon.envMat.map = buildGoreTexture(false, pal);
  balloon.envMat.needsUpdate = true;
  balloon.envInnerMat.map = buildGoreTexture(true, pal);
  balloon.envInnerMat.needsUpdate = true;
  balloon.skirtMat.color.set(c.cols[1]);
}

// 同時離陸カウントダウン(サーバーからの相対時間inMsを使い、時計ずれの影響を受けない)
function mpCountdown(m) {
  document.getElementById('briefing').style.display = 'none';
  applyBalloonColor(MP.myColor); // 自分の視点でも選んだ色の気球に乗る
  const ov = document.getElementById('mp-countdown');
  const numEl = document.getElementById('mp-countdown-num');
  ov.style.display = 'flex';
  const end = performance.now() + (m.inMs ?? 5000);
  const iv = setInterval(() => {
    const left = end - performance.now();
    numEl.textContent = Math.max(0, Math.ceil(left / 1000));
    if (left <= 0) {
      clearInterval(iv);
      ov.style.display = 'none';
      renderFlightPibal();
      const l = MP.launch || launchSel;
      startFlight(l.x, l.z);
      document.getElementById('mp-board').style.display = 'block';
      mpRenderBoard();
    }
  }, 100);
}

// サーバーからの時間切れ。未投下なら現在地で計測して確定を送る
function mpOnTimeup() {
  remaining = 0;
  if (expired) return;
  expired = true;
  if (!marker.state) {
    marker.available = 0;
    const d = Math.hypot(state.pos.x - TARGET_XZ.x, state.pos.z - TARGET_XZ.z);
    MP.myDist = d;
    if (MP.room) MP.room.sendLanded(d);
    showResult(d, '制限時間切れ: 現在地点で計測');
  }
  // マーカー落下中なら着地時に onMarkerLanded が送信する
}

// 全員確定の順位表(実競技の成績発表)。ホストには「もう一回戦」を出す
function mpShowResults(rows) {
  MP.resultsShown = true;
  document.getElementById('result').style.display = 'none';
  document.getElementById('result-reopen').style.display = 'none'; // 隠していた場合の後始末
  document.getElementById('mp-results-body').innerHTML = rows.map((r, i) =>
    `<tr class="${i === 0 ? 'rank1' : ''}"><td>${i + 1}</td>` +
    `<td><span class="chip" style="background:${BALLOON_COLORS[r.color].ui}"></span>` +
    `${esc(r.name)}${r.left ? '(離脱)' : ''}${MP.room && r.id === MP.room.id ? ' ★' : ''}</td>` +
    `<td class="num">${r.dist == null ? '—' : `${Number(r.dist).toFixed(1)} m`}</td></tr>`).join('');
  document.getElementById('mp-results').style.display = 'block';
  document.getElementById('mp-results-gw').textContent = `地上風ゆらぎ: ${groundWind ? '有効' : '無効'}`;
  const rematchBtn = document.getElementById('mp-rematch');
  const note = document.getElementById('mp-results-note');
  if (MP.room && MP.room.isHost) {
    rematchBtn.style.display = '';
    note.textContent = '';
  } else {
    rematchBtn.style.display = 'none';
    note.textContent = MP.room ? 'ホストの「もう一回戦」を待っています…'
      : 'もう一度飛ぶにはページを再読み込みしてください';
  }
}

// ---- ゴーストバルーン(他プレイヤーの気球) ----
// 自機の詳細モデルより大幅に簡略化した表現(球皮+ゴンドラ+名前ラベル)。
// 将来100機規模にする際は距離別にスプライトへ落とすLODをここに足す
// (ghostMeshes本体はtop-level await中の切断にも耐えるようファイル先頭で宣言)

function buildGhostBalloon(colorIdx, name) {
  const c = BALLOON_COLORS[colorIdx] || BALLOON_COLORS[0];
  const g = new THREE.Group(); // 原点=バスケット底面(自機と同じ基準)
  const env = new THREE.Mesh(
    new THREE.SphereGeometry(9, 16, 12),
    new THREE.MeshLambertMaterial({ color: c.ui }));
  env.scale.set(1, 1.12, 1);
  env.position.y = 16.5;
  g.add(env);
  // スカート(自機と同じ寸法。濃い方の色で球皮と馴染ませる)
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(3.0, 1.5, 3.2, 12, 1, true),
    new THREE.MeshLambertMaterial({ color: c.cols[1], side: THREE.DoubleSide }));
  skirt.position.y = 5.4;
  g.add(skirt);
  const basket = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.1, 1.4),
    new THREE.MeshLambertMaterial({ color: 0x5d451f }));
  basket.position.y = 0.55;
  g.add(basket);
  // 名前ラベル(常にカメラを向くスプライト。縁取りで地形に埋もれないように)
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 30px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.strokeText(name, 128, 32);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 128, 32);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false,
  }));
  label.scale.set(36, 9, 1);
  label.position.y = 34;
  g.add(label);
  return g;
}

// 毎フレーム: 目標位置(最新位置+速度外挿)をなめらかに追いかける。
// 目標へ即座に置くとスナップショット受信のたびにガタつくため、
// 指数平滑で数百msかけて寄せる(厳密な位置より滑らかさを優先)
const ghostTarget = new THREE.Vector3();
function updateGhosts(rawDt) {
  const samples = MP.room.sampleGhosts();
  const alpha = 1 - Math.exp(-(rawDt || 0.016) * 5); // 時定数 約200ms
  const seen = new Set();
  for (const s of samples) {
    seen.add(s.id);
    let g = ghostMeshes.get(s.id);
    if (!g) {
      const pl = MP.room.players.find((p) => p.id === s.id);
      g = buildGhostBalloon(pl ? pl.color : 0, pl ? pl.name : '???');
      g.position.set(s.x, s.y, s.z); // 初回だけ直接置く
      ghostMeshes.set(s.id, g);
      scene.add(g);
      continue;
    }
    g.position.lerp(ghostTarget.set(s.x, s.y, s.z), alpha);
  }
  for (const [id, g] of ghostMeshes) {
    if (!seen.has(id)) {
      scene.remove(g);
      ghostMeshes.delete(id);
      const gm = ghostMarkers.get(id); // 気球が消えたら(退室)そのマーカーも片付ける
      if (gm) { scene.remove(gm.mesh); ghostMarkers.delete(id); }
    }
  }
}

// ---- 他プレイヤーのマーカー投下(見た目のみ。ターゲットまでの計測はしない) ----
// サーバーは「誰が投下したか」しか知らないので、投下位置・初速はその瞬間の
// ゴーストの推定位置・速度から作る。厳密さより「他の人も投げてる感」が目的
function onGhostDrop(id) {
  if (!MP.room || id === MP.room.id) return; // 自分の投下は既存のdropMarker()側で処理済み
  if (ghostMarkers.has(id)) return; // 1本ルールなので二重生成しない
  const snap = MP.room.ghostSnapshot(id);
  if (!snap) return; // まだ位置を受信していない(ほぼ起きないはずだが念のため)
  const pl = MP.room.players.find((p) => p.id === id);
  const color = BALLOON_COLORS[pl ? pl.color : 0].ui;
  const mesh = buildMarkerMesh(color);
  mesh.position.set(snap.x, snap.y + 0.8, snap.z);
  scene.add(mesh);
  ghostMarkers.set(id, {
    mesh, landed: false,
    vel: new THREE.Vector3(snap.vx, snap.vy, snap.vz),
  });
}

// 毎フレーム: 自機のstepMarker()と同じ物理(重力+風)で、他プレイヤーの
// マーカーも見た目だけ落とす。着地したら地面に置いたまま静止させる
function updateGhostMarkers(dt) {
  for (const gm of ghostMarkers.values()) {
    if (gm.landed) continue;
    const p = gm.mesh.position;
    const w = windAt(p.y);
    gm.vel.y += (-9.81 - MARKER_DRAG * gm.vel.y) * dt;
    gm.vel.x += ((w.vx - gm.vel.x) / MARKER_WIND_TAU) * dt;
    gm.vel.z += ((w.vz - gm.vel.z) / MARKER_WIND_TAU) * dt;
    p.addScaledVector(gm.vel, dt);
    const ground = terrain.getHeight(p.x, p.z);
    if (p.y <= ground) {
      p.y = ground + 0.3;
      gm.landed = true;
    } else {
      gm.mesh.rotation.y += 2 * dt; // リボンの回転(自機のマーカーと同じ演出)
    }
  }
}

// ---- フルリロード後の復帰(飛行中への再合流) ----
// ?room=経由の再入室で、サーバーの局面がlobby以外だった場合はここで直接再開する。
// (results中の復帰はmpJoinGate内でresultsイベントを待ってから合流済みなので、
//  ここではflying/countdownへの復帰だけを扱う)
if (MP.room && (MP.resumeState === 'flying' || MP.resumeState === 'countdown') && !MP.resultsShown) {
  mpResumeFlight();
}

function mpResumeFlight() {
  const l = MP.launch;
  if (!l) return; // 離陸地点が無ければ復帰しない(readyしていれば必ずあるはずの想定)
  startFlight(l.x, l.z);
  const hello = MP.room.hello;
  if (hello) {
    if (hello.clock != null) remaining = Math.max(0, hello.clock);
    if (hello.scale) applyServerScale(hello.scale);
    // 切断時の位置から再開する(離陸地点からの仕切り直しを許すと、ゴールに
    // 寄れなかった時にリロードで再トライするズルができてしまう)。
    // 燃料・温度までは復元しないが、位置が戻らないので仕切り直しの旨味はない
    if (hello.pos) {
      const ground = terrain.getHeight(hello.pos.x, hello.pos.z);
      state.pos.set(hello.pos.x, Math.max(hello.pos.y, ground), hello.pos.z);
      state.vy = 0;
      state.grounded = state.pos.y <= ground + 0.05;
      balloon.group.position.copy(state.pos);
      controls.target.copy(state.pos).add(new THREE.Vector3(0, 12, 0));
      camera.position.copy(controls.target).add(new THREE.Vector3(60, 35, 60));
      prevPos.copy(state.pos);
      terrain.requestDetail(state.pos.x, state.pos.z);
    }
    // 投下済みで復帰した場合はマーカーを持たせない(投下し直しの防止。
    // サーバー側も2回目のdrop/landedは無視するので順位への影響は元々ない)
    if (hello.dropped || hello.landed) {
      MP.myDropped = true;
      marker.available = 0;
      document.getElementById('marker-info').textContent =
        hello.landed ? '計測済(リロード前に確定)' : '投下済';
    }
  }
  document.getElementById('mp-board').style.display = 'block';
  mpRenderBoard();
}
