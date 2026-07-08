// 熱気球フライト プロトタイプ
// 佐賀・嘉瀬川周辺(約20km四方)を地理院タイルから生成し、
// バーナー/リップライン(上下操作)+ 高度別レイヤーの風で飛ぶ。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrain, lonLatToTile } from './terrain.js';

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
  const dir = (a.dir + delta * t + 360) % 360;
  const kt = a.kt + (b.kt - a.kt) * t;
  const toRad = ((dir + 180) * Math.PI) / 180; // FROM → 進行方向
  const ms = kt * KT2MS;
  return { dir, kt, vx: ms * Math.sin(toRad), vz: -ms * Math.cos(toRad) };
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

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- 気球(プレースホルダ形状) ----
function buildBalloon() {
  const g = new THREE.Group(); // 原点 = バスケット底面(接地点)
  const envMat = new THREE.MeshLambertMaterial({ color: 0xc62828 });
  const env = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 18), envMat);
  env.scale.set(1, 1.12, 1);
  env.position.y = 16.5;
  g.add(env);
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(5.5, 1.6, 6.5, 16, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x7b1a1a, side: THREE.DoubleSide }));
  skirt.position.y = 4.6;
  g.add(skirt);
  const basket = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.1, 1.4),
    new THREE.MeshLambertMaterial({ color: 0x6d4c2f }));
  basket.position.y = 0.55;
  g.add(basket);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffa726, transparent: true, opacity: 0.9 }));
  flame.position.y = 2.2;
  flame.visible = false;
  g.add(flame);
  const flameLight = new THREE.PointLight(0xffa040, 0, 60);
  flameLight.position.y = 3;
  g.add(flameLight);
  return { group: g, flame, flameLight };
}

// ---- JDGターゲット(オレンジのX+白リング) ----
function buildTarget(x, z, groundY) {
  const g = new THREE.Group();
  const armMat = new THREE.MeshBasicMaterial({ color: 0xff5a00 });
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 2.6), armMat);
    arm.rotation.y = rot;
    g.add(arm);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(24, 25.5, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  g.position.set(x, groundY + 0.4, z);
  return g;
}

// ---- マーカー(重り+リボン) ----
function buildMarkerMesh() {
  const g = new THREE.Group();
  const weight = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xd32f2f }));
  g.add(weight);
  const ribbon = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 3.5),
    new THREE.MeshBasicMaterial({ color: 0xffee58, side: THREE.DoubleSide }));
  ribbon.position.y = 2.1;
  g.add(ribbon);
  return g;
}

// ---- 入力 ----
const input = { burner: false, rip: false };
let timeScale = 1;
let fpv = false;
let flightReady = false; // 離陸前のキー入力を無視する
let started = false;     // 離陸済みかどうか(物理・時計は離陸後のみ進む)
let remaining = TASK_LIMIT_S;
let expired = false;

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { input.burner = true; e.preventDefault(); }
  if (e.code === 'KeyR') input.rip = true;
  if (e.code === 'KeyV') { fpv = !fpv; applyViewMode(); }
  if (e.code === 'KeyM' && flightReady) dropMarker();
  if (e.code === 'KeyP') {
    const p = document.getElementById('pibal');
    p.style.display = p.style.display === 'none' ? '' : 'none';
  }
  if (e.code >= 'Digit1' && e.code <= 'Digit4') {
    timeScale = [1, 2, 4, 8][Number(e.code.slice(5)) - 1];
    document.getElementById('tscale').textContent = timeScale;
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space') input.burner = false;
  if (e.code === 'KeyR') input.rip = false;
});

function applyViewMode() {
  if (fpv) {
    controls.minDistance = 0.7;
    controls.maxDistance = 0.7;
  } else {
    controls.minDistance = 25;
    controls.maxDistance = 600;
    // ゴンドラ視点から戻るときはやや後方へ引く
    if (camera.position.distanceTo(controls.target) < 20) {
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(dir, 90);
    }
  }
}

// ---- 飛行中HUDのパイバル表を描画 ----
function renderFlightPibal() {
  document.getElementById('pibal-body').innerHTML = PIBAL
    .map((r) => `<tr><td>${r.ft}</td><td>${String(Math.round(r.dir)).padStart(3, '0')}</td><td>${r.kt}</td></tr>`)
    .join('');
}
renderFlightPibal();

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
    const nz = THREE.MathUtils.clamp(z + (e.deltaY < 0 ? 1 : -1), 4, 12);
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
AREA = decodeArea(new URLSearchParams(location.search).get('a'));
if (!AREA) AREA = await selectArea();

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
document.getElementById('briefing').style.display = '';

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
      btn.textContent = `離陸!(ターゲットまで ${(d / 1000).toFixed(2)} km)`;
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
  applyWindFromEditor(); // 離陸時点のエディタ内容で風を確定
  startFlight(launchSel.x, launchSel.z);
});

function startFlight(x, z) {
  // 離陸地点とターゲット周辺は先に高解像度化しておく
  terrain.requestDetail(x, z);
  terrain.requestDetail(TARGET_XZ.x, TARGET_XZ.z);
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

const targetGroundY = terrain.getHeight(TARGET_XZ.x, TARGET_XZ.z);
const target = buildTarget(TARGET_XZ.x, TARGET_XZ.z, targetGroundY);
scene.add(target);

// マーカーは1本。dropped後は marker.state が物理を持つ
const marker = { available: 1, state: null, mesh: null };

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
}

function stepMarker(dt) {
  const m = marker.state;
  if (!m || m.landed) return;
  const w = windAt(m.pos.y);
  // 鉛直: 重力+空気抵抗(終端速度 MARKER_TERMINAL)/ 水平: 風に漸近
  m.vel.y += (-9.81 - MARKER_DRAG * m.vel.y) * dt;
  m.vel.x += ((w.vx - m.vel.x) / MARKER_WIND_TAU) * dt;
  m.vel.z += ((w.vz - m.vel.z) / MARKER_WIND_TAU) * dt;
  m.pos.addScaledVector(m.vel, dt);

  const ground = terrain.getHeight(m.pos.x, m.pos.z);
  if (m.pos.y <= ground) {
    m.pos.y = ground + 0.3;
    m.landed = true;
    marker.mesh.position.copy(m.pos);
    onMarkerLanded(m.pos);
    return;
  }
  marker.mesh.position.copy(m.pos);
  marker.mesh.rotation.y += 2 * dt; // リボンの回転(演出)
}

function onMarkerLanded(pos) {
  const dist = Math.hypot(pos.x - TARGET_XZ.x, pos.z - TARGET_XZ.z);
  // 着地点→ターゲットの計測ライン
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(pos.x, pos.y + 1, pos.z),
    new THREE.Vector3(TARGET_XZ.x, targetGroundY + 1, TARGET_XZ.z),
  ]);
  scene.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffee58 })));
  showResult(dist, null);
}

function showResult(dist, note) {
  const prev = Number(localStorage.getItem(BEST_KEY));
  const isBest = !Number.isFinite(prev) || prev <= 0 || dist < prev;
  if (isBest) localStorage.setItem(BEST_KEY, dist.toFixed(1));

  const subs = [];
  if (note) subs.push(note);
  subs.push(isBest ? '自己ベスト更新!' : `自己ベスト: ${Number(prev).toFixed(1)} m`);
  document.getElementById('result-dist').textContent = dist.toFixed(1);
  document.getElementById('result-sub').innerHTML = subs.join('<br>');
  document.getElementById('result').style.display = '';
  document.getElementById('marker-info').textContent = `${dist.toFixed(1)} m`;
}

// 制限時間の進行。時間内に投下できなければ現在地点で計測(フォールバック)
function stepClock(dt) {
  if (expired) return;
  remaining = Math.max(0, remaining - dt);
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
  hud.clock.textContent = `${mm}:${ss}`;
  if (remaining <= 0) {
    expired = true;
    if (!marker.state) {
      marker.available = 0;
      const d = Math.hypot(state.pos.x - TARGET_XZ.x, state.pos.z - TARGET_XZ.z);
      showResult(d, '制限時間切れ: 現在地点で計測');
    }
  }
}

document.getElementById('result-retry').addEventListener('click', () => location.reload());

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
  hud.wind.textContent = `${String(Math.round(w.dir)).padStart(3, '0')}° / ${w.kt.toFixed(0)}kt`;
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

// デバッグ用: ?autostart=1 でブリーフィングを飛ばして即離陸(自動テスト向け)
if (new URLSearchParams(location.search).has('autostart')) {
  startFlight(800, 1800);
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05) * timeScale;

  if (started) {
    const w = stepPhysics(dt);
    stepMarker(dt);
    stepClock(dt);

    balloon.group.position.copy(state.pos);
    balloon.flame.visible = input.burner && state.fuel > 0;
    balloon.flameLight.intensity = balloon.flame.visible ? 40 : 0;

    // カメラは気球に追従(ターゲット+同じ分だけ平行移動)
    const delta = new THREE.Vector3().subVectors(state.pos, prevPos);
    camera.position.add(delta);
    controls.target.copy(state.pos).add(new THREE.Vector3(0, fpv ? 1.7 : 12, 0));
    prevPos.copy(state.pos);

    updateHud(w);

    // 気球の近くの地面を段階的に高解像度化(1.5秒おきに1枚ずつ)。
    // 低高度では直下の1タイルだけさらにz17(≒1m/px)へ
    if (performance.now() - lastDetailCheck > 1500) {
      lastDetailCheck = performance.now();
      terrain.updateDetail(state.pos.x, state.pos.z);
      const agl = state.pos.y - terrain.getHeight(state.pos.x, state.pos.z);
      if (agl < 1000) terrain.requestUltra(state.pos.x, state.pos.z);
    }
  }

  controls.update();
  renderer.render(scene, camera);
});
