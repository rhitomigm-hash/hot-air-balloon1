// 気球の球皮パターン(交互/水平/スパイラル/サファイア)+配色(最大4色)
// の純粋ロジック。DOM/three.jsに依存しない(実際のテクスチャ描画はmain.js側、
// ネットワーク越しの送受信はnet.js側が担当する)。仕様の由来・幾何学的な導出根拠は
// 仕様検討メモ.md参照。
import { BALLOON_COLORS } from './net.js';

export const GORES = 16; // buildGoreTexture()と同じゴア(区画)数
export const ENV_Y_SCALE = 1.12; // buildBalloon()のSphereGeometry scale.set(1,1.12,1)と同じ(色選択プレビューの形状にも使う)

// スパイラル(spiral)の傾きの基準: 球の正投影は非線形(cosカーブ)なので、
// 「全長÷ゴア幅」という平均の傾きではなく、局所的な傾きから導出する必要がある
// (平均の傾きを使うと帯の縦幅が横幅の約1.55倍に見えてしまう誤りがあった)
const SPIRAL_TOTAL = (Math.PI * ENV_Y_SCALE) / (2 * Math.sin(Math.PI / GORES));

// サファイア(市松)の分割数。実機(Ultramagic MV-56b)の展開図が24ゴアなので、
// この柄だけゴア数とは独立に24分割で描く(fineSlices/alignSeams参照)
const SAPPHIRE_SLICES = 24;
// 1マスがほぼ正方形に見える段数。SPIRAL_TOTALと同じ考え方(全長÷赤道でのマス幅)を
// 24分割に当てはめると約13.5となり、実機展開図の13段とほぼ一致する
const SAPPHIRE_ROWS = Math.round(
  (Math.PI * ENV_Y_SCALE) / (2 * Math.sin(Math.PI / SAPPHIRE_SLICES)),
);
// 色の境目は水平ではなく、横に一周する間に3回の山谷を描いて上下する。
// 24分割 ÷ 3周期 = 1周期8マスちょうど(割り切れるので継ぎ目で柄が破綻しない)
const SAPPHIRE_PERIODS = 3;
// 山と谷の振幅(段数)。境目がマス目の途中で切れないよう整数段でずらす
const SAPPHIRE_WAVE_ROWS = 2;
// 展開図では上側と下側で柄の位相がずれている。上から6段ぶんは柄をそのまま
// 4マス(=半周期)左へずらすことで、山と谷の位置が上下で入れ替わる
const SAPPHIRE_TOP_ROWS = 6;
const SAPPHIRE_TOP_SHIFT = 4;
// 上から7段目より下(＝ずらさない側の帯)は、柄を2段ぶん下げて描く。
// これで下から2段目・3段目に白の帯が来て、展開図の並びに合う
const SAPPHIRE_LOWER_DROP = 2;

// 0→1→0の三角波(1周期の中央が山の頂上)。展開図の境界線が直線的な
// 山形になっているので、正弦波ではなく三角波を使う
function sapphireWave(slice) {
  const cyc = (slice / SAPPHIRE_SLICES) * SAPPHIRE_PERIODS;
  const frac = cyc - Math.floor(cyc);
  return 1 - Math.abs(2 * frac - 1);
}

export const PATTERN_IDS = ['alt', 'horizontal', 'spiral', 'sapphire'];

// colorIndex(g, v, N): ゴア番号g(0..GORES-1)・縦位置v(0=上, 1=下)・使用色数Nから
// 色スロット番号(0..N-1)を返す純関数
export const PATTERNS = {
  alt: {
    id: 'alt',
    colorIndex: (g, v, N) => g % N,
  },
  horizontal: {
    id: 'horizontal',
    colorIndex: (g, v, N) => Math.min(9, Math.floor(v * 10)) % N,
  },
  spiral: {
    id: 'spiral',
    colorIndex: (g, v, N) => Math.floor(v * SPIRAL_TOTAL + (g / GORES) * N) % N,
  },
  // サファイア: 実機(Ultramagic MV-56b)の展開図と実写を参考にした市松模様。
  // 24ゴア×13段のマス目で、隣り合うマスが必ず違う色になる将棋盤状の市松。
  // ただし全体を2色で塗るのではなく、「使う色のペア」が高さとともにパレット順に
  // 1つずつスライドしていく(下から 白/水色 → 水色/濃い水色 → 濃い水色/青)。
  // これにより、市松の粗い質感を保ったまま全体としては下が明るく上が濃い
  // グラデーションに見える、という実機の柄を再現する。
  //
  // fineSlices: 実際の球皮パネル数(GORES=16)とは独立に、この柄だけ24分割で描く。
  // alignSeams: 市松のマス目は1マス=1ゴアなので、継ぎ目テープもマス目の境界に
  // 合わせて24本引く(16本のままだとマスの途中を継ぎ目が横切って柄が崩れる)
  sapphire: {
    id: 'sapphire',
    fineSlices: SAPPHIRE_SLICES,
    rows: SAPPHIRE_ROWS,
    topRows: SAPPHIRE_TOP_ROWS,
    topShift: SAPPHIRE_TOP_SHIFT,
    lowerDrop: SAPPHIRE_LOWER_DROP,
    alignSeams: true,
    // 開口部を覆う円筒のスカートも、実機同様に球皮の最上段と同じ濃色にする
    // (既定は1色目=最下段の色なので、この柄では白っぽくなってしまう)
    skirtUsesTopColor: true,
    colorIndex: (g, v, N) => {
      if (N <= 1) return 0;
      const rows = SAPPHIRE_ROWS;
      // v=0が球皮の頂点(上)・v=1がスカート側(下)なので「下からの高さ」に直す
      const u = 1 - v;
      const row = Math.min(rows - 1, Math.max(0, Math.floor(u * rows)));
      // 一番下の段(展開図の"Nx")はスカートと同じ最も濃い色でベタ塗りにする
      if (row === 0) return N - 1;
      let slice = Math.floor((g / GORES) * SAPPHIRE_SLICES);
      let patRow = row;
      // 下側の帯が受け持つのは一番下の境目(zone0/1)だけ。上側の境目(zone1/2)は
      // 上の帯(4マスずらす側)が別の位相で描くので、下側で二重に波打たせない
      // よう、下側で届く上限をzone数-2に留める(境目が1つしか無ければ無効)
      let zoneCap = Infinity;
      if (row >= rows - SAPPHIRE_TOP_ROWS) {
        // 上から6段は柄ごと4マス左へずらす(下側とは山谷の位相が逆になる)
        slice = (slice + SAPPHIRE_TOP_SHIFT) % SAPPHIRE_SLICES;
      } else {
        // 上から7段目より下は柄を2段ぶん下げる。ずらす量が偶数なので
        // 市松の偶奇は変わらず、マス目の格子は保たれたまま柄だけが下がる
        patRow = Math.min(rows - 1, row + SAPPHIRE_LOWER_DROP);
        zoneCap = Math.max(0, N - 3);
      }
      // 色ペアの段数。N色なら隣接ペアはN-1通り(0/1, 1/2, 2/3, ...)
      const zones = N - 1;
      // 色ペアの境目だけを三角波で上下させる(市松のマス目自体はずらさない)。
      // 山の頂上では境目が下がり、谷では上がるので、横方向に山谷が3回現れる
      const shift = Math.round(SAPPHIRE_WAVE_ROWS * (sapphireWave(slice) * 2 - 1));
      const zoneRow = Math.min(rows - 1, Math.max(0, patRow + shift));
      const zone = Math.min(zones - 1, zoneCap, Math.floor((zoneRow * zones) / rows));
      const checker = (slice + row) % 2;
      return zone + checker;
    },
  },
};

export const MAX_COLORS = 4;
// ロードテープ(ゴアとゴアをつなぐ縦の継ぎ目テープ)の色。既定は茶色、transparentで非表示
export const TAPE_COLORS = ['brown', 'white', 'transparent'];
// 既定値: 何も選ばなければ現行実装そのまま(赤の濃淡2トーン・茶色のロードテープ)になる
export const DEFAULT_APPEARANCE = { pattern: 'alt', colors: [0], soloFill: false, tape: 'brown' };

function clampColorIndex(i) {
  return Number.isInteger(i) && i >= 0 && i < BALLOON_COLORS.length ? i : 0;
}

function clampAppearance(app) {
  const pattern = PATTERN_IDS.includes(app && app.pattern) ? app.pattern : 'alt';
  const rawColors = Array.isArray(app && app.colors) && app.colors.length ? app.colors : [0];
  const colors = rawColors.slice(0, MAX_COLORS).map(clampColorIndex);
  const tape = TAPE_COLORS.includes(app && app.tape) ? app.tape : 'brown';
  return { pattern, colors, soloFill: !!(app && app.soloFill), tape };
}

// 見た目を16進数コード(6桁固定)へエンコードする。共有URLやテキストでの再入力用。
// bit0-1: パターン, bit2-3: 色数-1, bit4: 単色時の塗り潰しフラグ,
// bit5-8/9-12/13-16/17-20: 色1〜4のパレット番号(各4bit、BALLOON_COLORS.length<=16前提),
// bit21-22: ロードテープの色(0=茶,1=白,2=透明)
export function encodeAppearance(appearance) {
  const app = clampAppearance(appearance);
  const patternIdx = Math.max(0, PATTERN_IDS.indexOf(app.pattern));
  const n = app.colors.length;
  let code = patternIdx | ((n - 1) << 2) | ((app.soloFill ? 1 : 0) << 4);
  for (let i = 0; i < MAX_COLORS; i++) {
    code |= clampColorIndex(app.colors[i] ?? app.colors[0]) << (5 + i * 4);
  }
  code |= TAPE_COLORS.indexOf(app.tape) << 21;
  return code.toString(16).toUpperCase().padStart(6, '0');
}

// 16進数コードから見た目をデコードする。不正な値は既定(赤の濃淡2トーン・茶色)にフォールバックする
export function decodeAppearance(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{1,6}$/.test(hex)) return { ...DEFAULT_APPEARANCE, colors: [0] };
  const code = parseInt(hex, 16);
  if (!Number.isFinite(code)) return { ...DEFAULT_APPEARANCE, colors: [0] };
  const patternIdx = code & 0b11;
  const n = ((code >> 2) & 0b11) + 1;
  const soloFill = !!((code >> 4) & 1);
  const colors = [];
  for (let i = 0; i < n; i++) colors.push(clampColorIndex((code >> (5 + i * 4)) & 0b1111));
  const tape = TAPE_COLORS[(code >> 21) & 0b11] || 'brown';
  return { pattern: PATTERN_IDS[patternIdx] || 'alt', colors, soloFill, tape };
}

// ゴアg・縦位置vにおける「色スロット番号」(0..N-1)を返す。N===1のときは常に0
// (呼び出し側=main.jsが単色の濃淡/塗り潰しを別途処理する)
export function colorSlotAt(appearance, g, v) {
  const n = appearance.colors.length;
  if (n <= 1) return 0;
  const pat = PATTERNS[appearance.pattern] || PATTERNS.alt;
  return ((pat.colorIndex(g, v, n) % n) + n) % n;
}
