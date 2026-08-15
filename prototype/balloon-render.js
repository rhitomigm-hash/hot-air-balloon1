// 気球の球皮テクスチャ・3Dモデル(プレースホルダ形状)生成。
// main.js(実機)とtools/pattern-editor/(単体ツール)の両方から共有し、
// 見た目のロジックが二重管理でズレないようにする。
import * as THREE from 'three';
import { BALLOON_COLORS } from './net.js';
import {
  GORES, DEFAULT_APPEARANCE, TRI_GRID_PATTERN, resolvePattern, colorSlotAt,
} from './balloon-appearance.js';

// 編みかご風テクスチャ(Canvasで生成。横方向の籐の束を段違いに重ねた見た目)
export function buildWickerTexture() {
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
export function lighten(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v + (255 - v) * k);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// ゴア(縦の縫い目パネル)模様のテクスチャ。bright=true は内面用の明るい配色。
// appearance={pattern, colors:[BALLOON_COLORSの番号...], soloFill} で球皮の柄・配色を
// 差し替えられる(気球の色選択UI・マルチプレイでの共有)。省略時は既定(赤の濃淡2トーン)
export function buildGoreTexture(bright, appearance) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  const app = appearance || DEFAULT_APPEARANCE;
  // 三角マス目は対角線をアンチエイリアスで滑らかに見せる必要があるため、
  // 他の柄より縦解像度を上げる(64pxのままだと1マスの縦幅が数pxしかなく、
  // 本来直線のはずの対角線がぼやけた階段状にしか見えない)
  cv.height = app.pattern === TRI_GRID_PATTERN ? 256 : 64;
  const ctx = cv.getContext('2d');
  const w = 512 / GORES;
  const colorIdxs = app.colors && app.colors.length ? app.colors : [0];
  const palettes = colorIdxs.map((i) => BALLOON_COLORS[i] || BALLOON_COLORS[0]);

  // ロードテープ(ゴアとゴアをつなぐ縦の継ぎ目テープ)の色。tape==='transparent'
  // のときは継ぎ目自体を描かない(パネルが途切れ目無く見える)
  const tape = app.tape || 'brown';
  const tapeHex = tape === 'white' ? '#eceff1' : '#5c3a26';
  const seam = bright ? lighten(tapeHex, 0.3) : tapeHex;

  if (palettes.length === 1) {
    // 単色: 現行実装通り、濃淡2トーンの交互塗り(soloFill指定時はベタ塗り)
    const base = palettes[0];
    const cols = bright ? base.cols.map((c) => lighten(c, 0.25)) : base.cols;
    for (let i = 0; i < GORES; i++) {
      ctx.fillStyle = app.soloFill ? cols[0] : cols[i % 2];
      ctx.fillRect(i * w, 0, w, cv.height);
      if (tape !== 'transparent') {
        ctx.fillStyle = seam;
        ctx.fillRect(i * w, 0, 2, cv.height);
      }
    }
  } else {
    // 複数色: パターンに従ってゴア×高さを塗り分ける(各色は代表色uiを使用)
    const filled = palettes.map((p) => (bright ? lighten(p.ui, 0.25) : p.ui));
    const rows = cv.height;
    // サファイアのように、実際の球皮パネル数(GORES)とは別に柄自体の見た目の
    // 分割を細かくしたいパターンは fineSlices ヒントに従う。さらに alignSeams
    // 指定があれば継ぎ目テープもその分割に合わせて引く(市松は1マス=1ゴアなので、
    // 継ぎ目が16本のままだとマスの途中を横切って柄が崩れてしまう)
    const patDef = resolvePattern(app);
    const slices = (patDef && patDef.fineSlices) || GORES;
    const fine = slices !== GORES;
    if (patDef && patDef.subCell && patDef.rows) {
      // 三角マス目はセルを対角線で割った2枚の三角形として直接描画する。
      // ピクセル単位で最近傍の色を拾う方式だと、マス目の解像度なりに
      // 対角線が階段状に見えてしまうため、キャンバスの多角形塗りつぶし
      // (アンチエイリアス込み)で厳密な直線として描く
      const S = patDef.slices;
      const R = patDef.rows.length;
      const period = patDef.rows[0].length;
      const cw = 512 / S;
      for (let r = 0; r < R; r++) {
        const row = patDef.rows[r];
        // rows[0]が最下段(裾側)・rows[R-1]が最上段(頂点側)という並びなので、
        // キャンバス上(y=0が頂点側)には逆順で対応させる
        const y0 = (R - r - 1) / R * rows;
        const y1 = (R - r) / R * rows;
        for (let k = 0; k < S; k++) {
          const cell = row[k % period];
          const x0 = k * cw;
          const x1 = (k + 1) * cw;
          const colA = filled[Math.min(filled.length - 1, cell.a)];
          const colB = filled[Math.min(filled.length - 1, cell.b)];
          // マス全体をまずb色でfillRect(他の柄と同じ塗り方なので継ぎ目が出ない)
          // し、その上からa側の三角形だけ重ねて塗る。アンチエイリアスが掛かる
          // 境界を対角線1本だけに絞ることで、マス目の外枠に余計な継ぎ目が
          // 出ないようにする
          ctx.fillStyle = colB;
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
          ctx.beginPath();
          if (cell.dir === 0) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); }
          else { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x0, y1); }
          ctx.closePath();
          ctx.fillStyle = colA;
          ctx.fill();
        }
      }
    } else {
      const sw = 512 / slices;
      for (let k = 0; k < slices; k++) {
        const gv = fine ? (k + 0.5) * GORES / slices : k;
        const x0 = Math.round(k * sw);
        const x1 = Math.round((k + 1) * sw);
        for (let y = 0; y < rows; y++) {
          const v = (y + 0.5) / rows;
          ctx.fillStyle = filled[colorSlotAt(app, gv, v)];
          ctx.fillRect(x0, y, x1 - x0, 1);
        }
      }
    }
    if (tape !== 'transparent') {
      const seams = patDef && patDef.alignSeams ? slices : GORES;
      const seamW = 512 / seams;
      for (let i = 0; i < seams; i++) {
        ctx.fillStyle = seam;
        ctx.fillRect(Math.round(i * seamW), 0, 2, cv.height);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// スカート(球皮の開口部を覆う円筒)の色。既定は1色目の濃いトーンで球皮の裾と
// 馴染ませるが、サファイアのように実機が開口部を球皮の最上段と同じ濃色に
// している柄では、最後の色(=最上段の色)を使う
export function skirtColorFor(appearance) {
  const app = appearance || DEFAULT_APPEARANCE;
  const cols = app.colors && app.colors.length ? app.colors : [0];
  const patDef = resolvePattern(app);
  const useTop = !!(patDef && patDef.skirtUsesTopColor) && cols.length > 1;
  const pal = BALLOON_COLORS[useTop ? cols[cols.length - 1] : cols[0]] || BALLOON_COLORS[0];
  // 複数色の球皮は代表色uiで塗られているので、最上段に合わせるときもuiを使う
  return useTop ? pal.ui : pal.cols[1];
}

// ---- 気球(プレースホルダ形状) ----
export const BASKET_W = 1.4, BASKET_H = 1.1, WALL_T = 0.06, BURNER_Y = 2.0;
export function buildBalloon() {
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
