import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATTERNS, PATTERN_IDS, GORES, MAX_COLORS, DEFAULT_APPEARANCE, TAPE_COLORS,
  encodeAppearance, decodeAppearance, colorSlotAt,
} from '../balloon-appearance.js';

test('encodeAppearance/decodeAppearance: 既定値(赤・単色・濃淡・茶テープ)の往復', () => {
  const code = encodeAppearance(DEFAULT_APPEARANCE);
  assert.equal(code.length, 6);
  assert.deepEqual(decodeAppearance(code), { pattern: 'alt', colors: [0], soloFill: false, tape: 'brown' });
});

test('encodeAppearance/decodeAppearance: 4色スパイラル・塗り潰しON・白テープの往復', () => {
  const app = { pattern: 'spiral', colors: [3, 7, 11, 0], soloFill: true, tape: 'white' };
  const code = encodeAppearance(app);
  assert.deepEqual(decodeAppearance(code), app);
});

test('encodeAppearance/decodeAppearance: 2色・3色でも往復できる', () => {
  for (const colors of [[2, 9], [5, 5, 1]]) {
    const app = { pattern: 'sapphire', colors, soloFill: false, tape: 'brown' };
    assert.deepEqual(decodeAppearance(encodeAppearance(app)), app);
  }
});

test('encodeAppearance/decodeAppearance: 全パターンで往復できる', () => {
  for (const pattern of PATTERN_IDS) {
    const app = { pattern, colors: [0], soloFill: false, tape: 'brown' };
    assert.deepEqual(decodeAppearance(encodeAppearance(app)), app);
  }
});

test('encodeAppearance/decodeAppearance: ロードテープ3種すべて往復できる(色数・パターンは固定)', () => {
  for (const tape of TAPE_COLORS) {
    const app = { pattern: 'alt', colors: [1], soloFill: false, tape };
    assert.deepEqual(decodeAppearance(encodeAppearance(app)), app);
  }
});

test('decodeAppearance: 不正なコードは既定値にフォールバックする', () => {
  assert.deepEqual(decodeAppearance('ZZZZZZ'), { ...DEFAULT_APPEARANCE, colors: [0] });
  assert.deepEqual(decodeAppearance(''), { ...DEFAULT_APPEARANCE, colors: [0] });
  assert.deepEqual(decodeAppearance(null), { ...DEFAULT_APPEARANCE, colors: [0] });
  assert.deepEqual(decodeAppearance('123456789'), { ...DEFAULT_APPEARANCE, colors: [0] });
});

test('colorSlotAt: 単色(N=1)は常にスロット0', () => {
  const app = { pattern: 'spiral', colors: [4], soloFill: false };
  for (let g = 0; g < GORES; g++) {
    assert.equal(colorSlotAt(app, g, 0.3), 0);
  }
});

test('colorSlotAt: 交互(alt)はゴアごとに単純に切り替わる', () => {
  const app = { pattern: 'alt', colors: [0, 1], soloFill: false };
  assert.equal(colorSlotAt(app, 0, 0.5), 0);
  assert.equal(colorSlotAt(app, 1, 0.5), 1);
  assert.equal(colorSlotAt(app, 2, 0.5), 0);
});

test('colorSlotAt: 水平(horizontal)は縦位置だけで決まりゴアには依らない', () => {
  const app = { pattern: 'horizontal', colors: [0, 1], soloFill: false };
  const v = 0.05;
  const first = colorSlotAt(app, 0, v);
  for (let g = 1; g < GORES; g++) assert.equal(colorSlotAt(app, g, v), first);
});

test('colorSlotAt: スパイラル・サファイアは常に0..N-1の範囲に収まる', () => {
  for (const pattern of ['spiral', 'sapphire']) {
    for (const n of [1, 2, 3, 4]) {
      const app = { pattern, colors: Array.from({ length: n }, (_, i) => i), soloFill: false };
      for (let g = 0; g < GORES; g++) {
        for (let vi = 0; vi <= 20; vi++) {
          const idx = colorSlotAt(app, g, vi / 20);
          assert.ok(idx >= 0 && idx < n, `${pattern} n=${n} g=${g} v=${vi / 20} -> ${idx}`);
        }
      }
    }
  }
});

// サファイアはfineSlices=24分割で描かれるので、マスk(0..23)の中心に対応する
// ゴア座標gと、段r(0..ROWS-1)の中心に対応する縦位置vを求めるヘルパ
const SAPPHIRE_SLICES = PATTERNS.sapphire.fineSlices;
const SAPPHIRE_ROWS = PATTERNS.sapphire.rows;
const SAPPHIRE_TOP_ROWS = PATTERNS.sapphire.topRows;
const SAPPHIRE_TOP_SHIFT = PATTERNS.sapphire.topShift;
const sliceG = (k) => ((k + 0.5) * GORES) / SAPPHIRE_SLICES;
const rowV = (r) => 1 - (r + 0.5) / SAPPHIRE_ROWS;

// 色スロットは「色ペアの段(zone) + 市松の白黒(checker)」で決まる。checkerは
// (マス番号+段番号)の偶奇で決まるので、逆算するとそのマスのzoneが取り出せる
const zoneAt = (app, k, r) => colorSlotAt(app, sliceG(k), rowV(r)) - ((k + r) % 2);

test('colorSlotAt: サファイアは全マスが市松(zone+偶奇)の構造になっている', () => {
  // 逆算したzoneが常に妥当な範囲(0..N-2)に収まることは、どのマスも
  // 「色ペアのどちらか」で塗られている=市松構造が崩れていないことを意味する
  // (段0は市松ではなくスカートのベタ塗りなので対象外)
  const app = { pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false };
  for (let r = 1; r < SAPPHIRE_ROWS; r++) {
    for (let k = 0; k < SAPPHIRE_SLICES; k++) {
      const z = zoneAt(app, k, r);
      assert.ok(z >= 0 && z <= 2, `zone=${z} r=${r} k=${k}`);
    }
  }
});

test('colorSlotAt: サファイアの色の境目は横方向に山谷を描いて上下する', () => {
  // 実機の展開図どおり、境目は水平ではない。同じ段でも場所によってzoneが変わり、
  // かつ隣のマスとの差は1段以内(なめらかな山谷)であることを確認する
  const app = { pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false };
  let undulates = false;
  for (let r = 1; r < SAPPHIRE_ROWS; r++) {
    for (let k = 0; k < SAPPHIRE_SLICES; k++) {
      const z = zoneAt(app, k, r);
      const zr = zoneAt(app, (k + 1) % SAPPHIRE_SLICES, r);
      assert.ok(Math.abs(zr - z) <= 1, `境目が飛んでいる r=${r} k=${k}`);
      if (zr !== z) undulates = true;
    }
  }
  assert.ok(undulates, '境目が横方向に一切動いていない');
});

test('colorSlotAt: サファイアの一番下のスカート段は最も濃い色のベタ塗り', () => {
  // 実機の展開図の"Nx"段にあたる。市松ではなく一色で塗り潰す
  for (const n of [2, 3, 4]) {
    const app = {
      pattern: 'sapphire',
      colors: Array.from({ length: n }, (_, i) => i),
      soloFill: false,
    };
    for (let k = 0; k < SAPPHIRE_SLICES; k++) {
      assert.equal(colorSlotAt(app, sliceG(k), rowV(0)), n - 1, `n=${n} k=${k}`);
    }
  }
});

test('colorSlotAt: サファイアは上から6段だけ柄が4マスずれて山谷が逆位相になる', () => {
  // 1段だけ見るとzoneが2値しか取らず山谷が潰れて見えるので、帯ごとに全段の
  // zoneを足し合わせた「波形」で位相を比べる(足すと三角波がはっきり出る)
  const app = { pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false };
  const period = SAPPHIRE_SLICES / 3;
  const profile = (r0, r1) => Array.from({ length: period }, (_, k) => {
    let sum = 0;
    for (let r = r0; r <= r1; r++) sum += zoneAt(app, k, r);
    return sum;
  });
  const argMax = (a) => a.indexOf(Math.max(...a));
  // 段0はスカートなので除く。下側の帯 / 上側(ずらす)の帯
  const lower = argMax(profile(1, SAPPHIRE_ROWS - SAPPHIRE_TOP_ROWS - 1));
  const upper = argMax(profile(SAPPHIRE_ROWS - SAPPHIRE_TOP_ROWS, SAPPHIRE_ROWS - 1));
  assert.equal((lower - upper + period) % period, SAPPHIRE_TOP_SHIFT, `lower=${lower} upper=${upper}`);
});

test('colorSlotAt: サファイアの山谷は一周で3周期ちょうど繰り返す', () => {
  // 24分割 ÷ 3周期 = 8マスで1周期。8マスずらすと完全に同じ柄になる
  // (8は偶数なので市松の偶奇も一致する)
  const app = { pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false };
  const period = SAPPHIRE_SLICES / 3;
  assert.equal(period, 8);
  for (let r = 0; r < SAPPHIRE_ROWS; r++) {
    for (let k = 0; k < SAPPHIRE_SLICES; k++) {
      assert.equal(
        colorSlotAt(app, sliceG(k), rowV(r)),
        colorSlotAt(app, sliceG((k + period) % SAPPHIRE_SLICES), rowV(r)),
        `周期がずれている r=${r} k=${k}`,
      );
    }
  }
});

const slotsAtRow = (app, r) => new Set(
  Array.from({ length: SAPPHIRE_SLICES }, (_, k) => colorSlotAt(app, sliceG(k), rowV(r))),
);

test('colorSlotAt: サファイアは高さとともに使う色のペアがパレット順にずれる', () => {
  // 最も明るい白はスカートのすぐ上にだけ現れ、上半分には出てこない。
  // 最上段は colors[N-2]/colors[N-1](濃い水色/青)だけを使う
  const app = { pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false };
  assert.ok(slotsAtRow(app, 1).has(0), 'スカートのすぐ上に白が出ていない');
  assert.deepEqual([...slotsAtRow(app, SAPPHIRE_ROWS - 1)].sort(), [2, 3], '最上段は濃い水色/青');
  for (let r = Math.ceil(SAPPHIRE_ROWS / 2); r < SAPPHIRE_ROWS; r++) {
    assert.ok(!slotsAtRow(app, r).has(0), `上半分に白が出ている r=${r}`);
  }
});

test('colorSlotAt: サファイアは上から7・8段目が薄い水色と濃い水色の帯になる', () => {
  // 下側の柄を2段ぶん下げた結果、上から7段目・8段目(=下から6・5段目)には
  // colors[1]/colors[2] が来る。白(colors[0])はここまで上がってこない
  const app = { pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false };
  for (const r of [SAPPHIRE_ROWS - 7, SAPPHIRE_ROWS - 8]) {
    const slots = slotsAtRow(app, r);
    assert.ok(!slots.has(0), `白が出ている r=${r}`);
    assert.ok(slots.has(1) && slots.has(2), `薄い水色/濃い水色が揃っていない r=${r}`);
  }
});

test('colorSlotAt: サファイアは上から7・8段目が全列で乱れなく交互になる(zone1/2境目の二重波防止)', () => {
  // 下側の帯はzone0/1の境目だけを受け持ち、zone1/2の境目は上側の帯(4マスずらす側)が
  // 別位相で描く。波の振幅がzone間隔に対して大きいと、下側の帯がzone1/2の境目にまで
  // 意図せず届いて薄い水色/濃い水色の帯に濃い青が漏れ出す不具合があったため、
  // 波の頂上にあたる列(周期8マスごと)を含めて全列で漏れがないことを確認する
  const app = { pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false };
  for (const r of [SAPPHIRE_ROWS - 7, SAPPHIRE_ROWS - 8]) {
    for (let k = 0; k < SAPPHIRE_SLICES; k++) {
      const slot = colorSlotAt(app, sliceG(k), rowV(r));
      assert.ok(slot === 1 || slot === 2, `r=${r} k=${k} slot=${slot}(1か2のみのはず)`);
    }
  }
});

test('colorSlotAt: サファイアは2色なら全体が単純な市松になる', () => {
  const app = { pattern: 'sapphire', colors: [0, 1], soloFill: false };
  const seen = new Set();
  for (let r = 0; r < SAPPHIRE_ROWS; r++) {
    for (let k = 0; k < SAPPHIRE_SLICES; k++) seen.add(colorSlotAt(app, sliceG(k), rowV(r)));
  }
  assert.deepEqual([...seen].sort(), [0, 1]);
});

test('PATTERNS: 4種類全てにcolorIndex関数がある', () => {
  assert.equal(Object.keys(PATTERNS).length, 4);
  for (const p of Object.values(PATTERNS)) assert.equal(typeof p.colorIndex, 'function');
});

test('MAX_COLORS is 4', () => {
  assert.equal(MAX_COLORS, 4);
});
