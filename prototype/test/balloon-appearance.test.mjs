import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PATTERNS, PATTERN_IDS, GORES, MAX_COLORS, DEFAULT_APPEARANCE, TAPE_COLORS,
  encodeAppearance, decodeAppearance, colorSlotAt,
  CUSTOM_PATTERN, DEFAULT_KERNEL, MAX_CODE_LENGTH, resolvePattern, isValidAppearanceCode,
  GRID_PATTERN, makeGridPattern,
  TRI_GRID_PATTERN, makeTriGridPattern,
  KERNEL_SLICES, KERNEL_KG_VALUES, KERNEL_MAPPINGS, KERNEL_WAVE_PERIODS,
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

test('MAX_COLORS is 16', () => {
  assert.equal(MAX_COLORS, 16);
});

// ---------------------------------------------------------------------------
// 既存4パターンの見た目が変わっていないこと(カーネル階を足した際の回帰検査)
// ---------------------------------------------------------------------------
// 下のハッシュは「カーネル階を導入する前の実装」で全マスを走査して取った値。
// サファイアのような手調整済みの柄が1マスでも変わると落ちる
const PATTERN_SNAPSHOTS = {
  'alt/1': '68eab1e69bfdf7e34642afeb328c5cfa',
  'alt/2': '8bfef0693d9beec0254fb8f86406d814',
  'alt/3': '89c33b09858249bb23a5f22f8f3cb4cf',
  'alt/4': 'f734ae6fea96c1cd1826f50c54b9f9d7',
  'horizontal/1': '68eab1e69bfdf7e34642afeb328c5cfa',
  'horizontal/2': '454c95cd39e53e63660f7484721a838e',
  'horizontal/3': '92720bd78f30beb4b0464b2a9568a588',
  'horizontal/4': '2870273906d470856bcae0642efe2940',
  'spiral/1': '68eab1e69bfdf7e34642afeb328c5cfa',
  'spiral/2': 'e202fa7e751e00544bf8b9ef38fb6f5e',
  'spiral/3': '5223b36aee2fcd614d003c096930c43b',
  'spiral/4': '6d014b8d449541c9fd7f4a706f61ea6b',
  'sapphire/1': '68eab1e69bfdf7e34642afeb328c5cfa',
  'sapphire/2': '29283e1b754ad2cfcb3a0ebdbf7eaaf6',
  'sapphire/3': '3a785de69cfa885930905dd33f30d0a2',
  'sapphire/4': '71c8f59f29d40bb2e8b70e0df6d06d04',
};

test('回帰: 既存4パターンの塗り分けがカーネル導入前と1マスも変わらない', () => {
  for (const pattern of PATTERN_IDS) {
    for (let n = 1; n <= 4; n++) {
      const app = { pattern, colors: Array.from({ length: n }, (_, i) => i), soloFill: false, tape: 'brown' };
      const rows = [];
      // buildGoreTexture()と同じ走査(16分割と24分割の両方)で全マスを舐める
      for (const slices of [GORES, 24]) {
        for (let k = 0; k < slices; k++) {
          const gv = slices === GORES ? k : ((k + 0.5) * GORES) / slices;
          let line = '';
          for (let y = 0; y < 64; y++) line += colorSlotAt(app, gv, (y + 0.5) / 64).toString(16);
          rows.push(line);
        }
      }
      const got = createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 32);
      assert.equal(got, PATTERN_SNAPSHOTS[`${pattern}/${n}`], `${pattern} ${n}色の柄が変わっている`);
    }
  }
});

test('v0互換: 現行の柄・4色以内なら今まで通りの16進6桁コードになる', () => {
  for (const pattern of PATTERN_IDS) {
    for (const tape of TAPE_COLORS) {
      for (const soloFill of [false, true]) {
        for (const colors of [[0], [3, 7], [1, 2, 3], [11, 0, 5, 9]]) {
          const code = encodeAppearance({ pattern, colors, soloFill, tape });
          assert.match(code, /^[0-9A-F]{6}$/, `v0のままでない: ${code}`);
          assert.deepEqual(decodeAppearance(code), { pattern, colors, soloFill, tape });
        }
      }
    }
  }
});

test('v0互換: 既知のコードが以前と同じ見た目に復号される', () => {
  // カーネル導入前の実装が出力していた実際の値
  assert.equal(encodeAppearance(DEFAULT_APPEARANCE), '000000');
  assert.equal(encodeAppearance({ pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false, tape: 'brown' }), '06420F');
});

// ---------------------------------------------------------------------------
// 新形式(v1)
// ---------------------------------------------------------------------------

test('v1: 5色以上を使うと G で始まる可変長コードになり往復できる', () => {
  for (let n = 5; n <= MAX_COLORS; n++) {
    const app = {
      pattern: 'sapphire', colors: Array.from({ length: n }, (_, i) => i),
      soloFill: false, tape: 'white',
    };
    const code = encodeAppearance(app);
    assert.equal(code[0], 'G', `v1になっていない: ${code}`);
    assert.ok(code.length <= MAX_CODE_LENGTH, `長すぎる: ${code}`);
    assert.deepEqual(decodeAppearance(code), app);
  }
});

test('v1: カスタム柄はパラメータを総当たりしても往復できる', () => {
  let cases = 0;
  for (const slices of KERNEL_SLICES) {
    for (const kg of KERNEL_KG_VALUES) {
      for (const mapping of KERNEL_MAPPINGS) {
        for (const wavePeriods of KERNEL_WAVE_PERIODS) {
          const app = {
            pattern: CUSTOM_PATTERN,
            colors: [0, 5, 9, 15],
            soloFill: true,
            tape: 'transparent',
            kernel: { slices, kv: 13, kg, waveAmp: 2, wavePeriods, checker: true, mapping },
          };
          assert.deepEqual(decodeAppearance(encodeAppearance(app)), app);
          cases++;
        }
      }
    }
  }
  assert.ok(cases > 3000, `総当たりの件数が少なすぎる: ${cases}`);
});

test('v1: 一番長いコード(カーネル+16色)でも上限24文字に収まる', () => {
  const code = encodeAppearance({
    pattern: CUSTOM_PATTERN,
    colors: Array.from({ length: 16 }, (_, i) => i),
    soloFill: true,
    tape: 'transparent',
    kernel: { slices: 48, kv: 31, kg: '-N', waveAmp: 3, wavePeriods: 4, checker: true, mapping: 'mirror' },
  });
  assert.equal(code.length, 20);
  assert.ok(code.length <= MAX_CODE_LENGTH);
});

test('v1: 壊れたコードは既定値にフォールバックする', () => {
  for (const bad of ['G', 'G!!!', `G${'Z'.repeat(40)}`, 'GRTBB']) {
    assert.deepEqual(decodeAppearance(bad), { ...DEFAULT_APPEARANCE, colors: [0] }, `fallbackしない: ${bad}`);
  }
});

test('v1: 小文字と Crockford の読み替え(I/L→1, O→0)を受け付ける', () => {
  const app = {
    pattern: CUSTOM_PATTERN, colors: [1, 0], soloFill: false, tape: 'brown',
    kernel: { ...DEFAULT_KERNEL },
  };
  const code = encodeAppearance(app);
  assert.deepEqual(decodeAppearance(code.toLowerCase()), app);
  assert.deepEqual(decodeAppearance(code.replace(/0/g, 'O').replace(/1/g, 'I')), app);
});

// ---------------------------------------------------------------------------
// カーネル階(パラメータ式)
// ---------------------------------------------------------------------------

test('カーネル: 交互(alt)と水平(horizontal)をパラメータだけで完全再現できる', () => {
  const equiv = [
    [{ pattern: 'alt' }, { slices: 16, kv: 0, kg: 16, waveAmp: 0, wavePeriods: 0, checker: false, mapping: 'cycle' }],
    [{ pattern: 'horizontal' }, { slices: 16, kv: 10, kg: 0, waveAmp: 0, wavePeriods: 0, checker: false, mapping: 'cycle' }],
  ];
  for (const [preset, kernel] of equiv) {
    for (let n = 2; n <= 4; n++) {
      const colors = Array.from({ length: n }, (_, i) => i);
      const a = { ...preset, colors };
      const b = { pattern: CUSTOM_PATTERN, colors, kernel };
      for (let g = 0; g < GORES; g++) {
        for (let y = 0; y < 64; y++) {
          const v = (y + 0.5) / 64;
          assert.equal(colorSlotAt(b, g, v), colorSlotAt(a, g, v), `${preset.pattern} n=${n} g=${g} v=${v}`);
        }
      }
    }
  }
});

test('カーネル: どの割当方式でも色番号が 0..N-1 に収まる', () => {
  for (const mapping of KERNEL_MAPPINGS) {
    for (let n = 2; n <= MAX_COLORS; n++) {
      const app = {
        pattern: CUSTOM_PATTERN,
        colors: Array.from({ length: n }, (_, i) => i),
        kernel: { slices: 24, kv: 13, kg: '-N', waveAmp: 3, wavePeriods: 3, checker: true, mapping },
      };
      for (let k = 0; k < 24; k++) {
        for (let y = 0; y < 64; y++) {
          const slot = colorSlotAt(app, ((k + 0.5) * GORES) / 24, (y + 0.5) / 64);
          assert.ok(Number.isInteger(slot) && slot >= 0 && slot < n, `${mapping} n=${n} slot=${slot}`);
        }
      }
    }
  }
});

test('カーネル: 単色(N=1)は割当方式によらず常にスロット0', () => {
  for (const mapping of KERNEL_MAPPINGS) {
    const app = {
      pattern: CUSTOM_PATTERN, colors: [4],
      kernel: { slices: 24, kv: 13, kg: 3, waveAmp: 2, wavePeriods: 3, checker: true, mapping },
    };
    for (let g = 0; g < GORES; g++) assert.equal(colorSlotAt(app, g, 0.3), 0);
  }
});

test('カーネル: 不正なパラメータは既定値へ丸められる', () => {
  const app = {
    pattern: CUSTOM_PATTERN, colors: [0, 1], soloFill: false, tape: 'brown',
    kernel: { slices: 999, kv: -5, kg: 'とんでもない値', waveAmp: 99, wavePeriods: 7, checker: 'yes', mapping: 'なにか' },
  };
  const round = decodeAppearance(encodeAppearance(app));
  assert.deepEqual(round.kernel, { ...DEFAULT_KERNEL, kv: 0, waveAmp: 3, checker: true });
});

test('resolvePattern: プリセットもカスタムも同じ形(描画側が分岐しないで済む)', () => {
  const preset = resolvePattern({ pattern: 'sapphire', colors: [0, 1] });
  const custom = resolvePattern({
    pattern: CUSTOM_PATTERN, colors: [0, 1],
    kernel: { slices: 24, kv: 13, kg: 0, waveAmp: 0, wavePeriods: 0, checker: true, mapping: 'zoneChecker' },
  });
  for (const def of [preset, custom]) {
    assert.equal(typeof def.colorIndex, 'function');
    assert.equal(typeof def.fineSlices, 'number');
  }
  // 24分割のカスタム柄は、サファイアと同じくロードテープをマス目に合わせる
  assert.equal(custom.fineSlices, 24);
  assert.equal(custom.alignSeams, true);
  assert.equal(custom.skirtUsesTopColor, true, 'グラデーション系はスカートを最終色に合わせる');
  // 16分割・巡回なら既定のゴア数のままで、テープの本数も既定どおり
  const plain = resolvePattern({
    pattern: CUSTOM_PATTERN, colors: [0, 1],
    kernel: { ...DEFAULT_KERNEL, slices: 16, mapping: 'cycle' },
  });
  assert.equal(plain.alignSeams, false);
  assert.equal(plain.skirtUsesTopColor, false);
});

test('resolvePattern: 未知のパターン名は交互(alt)へフォールバックする', () => {
  assert.equal(resolvePattern({ pattern: 'なにか', colors: [0, 1] }), PATTERNS.alt);
});

// ---------------------------------------------------------------------------
// マス目階(展開図をそのまま持つ柄) と v2 コード
// ---------------------------------------------------------------------------

// エディタが展開図を焼き込むのと同じ手順で、柄からマス目を作る
function gridOf(pat, slices, rows, n) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < slices; c++) {
      const g = ((c + 0.5) * GORES) / slices;
      const v = 1 - (r + 0.5) / rows;
      row.push(((pat.colorIndex(g, v, n) % n) + n) % n);
    }
    out.push(row);
  }
  return out;
}

// 2つの見た目が同じ塗り分けになるか(復号後は横周期ぶんしか持たないので配列では比べられない)
function rendersSame(a, b, slices) {
  for (let c = 0; c < slices; c++) {
    for (let y = 0; y < 64; y++) {
      const g = ((c + 0.5) * GORES) / slices;
      const v = (y + 0.5) / 64;
      if (colorSlotAt(a, g, v) !== colorSlotAt(b, g, v)) return false;
    }
  }
  return true;
}

const MV56B = {
  pattern: GRID_PATTERN, colors: [8, 6, 1, 12], soloFill: false, tape: 'brown',
  grid: { slices: 24, rows: gridOf(PATTERNS.sapphire, 24, 13, 4) },
};

test('makeGridPattern: PATTERNSの要素と同じ形を返し、プリセットとして使える', () => {
  const rows = gridOf(PATTERNS.sapphire, 24, 13, 4);
  const def = makeGridPattern('mv56b', 24, rows);
  assert.equal(typeof def.colorIndex, 'function');
  assert.equal(def.fineSlices, 24);
  assert.equal(def.alignSeams, true);
  assert.equal(def.skirtUsesTopColor, true);
  // 焼き込み元と同じ塗り分けになる(段の境目の丸めを含めて)
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 24; c++) {
      const g = ((c + 0.5) * GORES) / 24;
      const v = 1 - (r + 0.5) / 13;
      assert.equal(def.colorIndex(g, v, 4), rows[r][c], `r=${r} c=${c}`);
    }
  }
});

test('プリセット追加: 5つ目以降の柄もv1のプリセット番号で往復できる', () => {
  // 実際にPATTERNSへ足したときと同じ状態を作って確かめ、終わったら元へ戻す
  const rows = gridOf(PATTERNS.sapphire, 24, 13, 4);
  PATTERNS.mv56b = makeGridPattern('mv56b', 24, rows);
  PATTERN_IDS.push('mv56b');
  try {
    assert.equal(PATTERN_IDS.indexOf('mv56b'), 4, '5つ目の枠に入る');
    const app = { pattern: 'mv56b', colors: [8, 6, 1, 12], soloFill: false, tape: 'brown' };
    const code = encodeAppearance(app);
    // v0はパターン2bitしか無いので、5つ目からは自動的にv1へ切り替わる
    assert.equal(code[0], 'G', `v1になっていない: ${code}`);
    assert.ok(code.length <= 8, `プリセットなら短いままのはず: ${code}`);
    assert.deepEqual(decodeAppearance(code), app);
    assert.equal(resolvePattern(app), PATTERNS.mv56b);
  } finally {
    delete PATTERNS.mv56b;
    PATTERN_IDS.pop();
  }
});

test('プリセット追加: 手元が知らないプリセット番号は既定の柄へ落ちる', () => {
  // 新しい柄を持つクライアントから、まだ更新していないクライアントへコードが渡る場面
  const rows = gridOf(PATTERNS.sapphire, 24, 13, 4);
  PATTERNS.future = makeGridPattern('future', 24, rows);
  PATTERN_IDS.push('future');
  let code;
  try {
    code = encodeAppearance({ pattern: 'future', colors: [1, 2], soloFill: false, tape: 'brown' });
  } finally {
    delete PATTERNS.future;
    PATTERN_IDS.pop();
  }
  const decoded = decodeAppearance(code);
  assert.equal(decoded.pattern, 'alt', '知らない番号は交互へフォールバックする');
  assert.deepEqual(decoded.colors, [1, 2], '色は正しく読める');
});

test('v2: マス目の柄は H で始まるコードになり、塗り分けが完全に往復する', () => {
  const code = encodeAppearance(MV56B);
  assert.equal(code[0], 'H');
  assert.ok(code.length <= MAX_CODE_LENGTH);
  const back = decodeAppearance(code);
  assert.equal(back.pattern, GRID_PATTERN);
  assert.equal(back.grid.slices, 24);
  assert.equal(back.grid.rows.length, 13);
  assert.deepEqual(back.colors, MV56B.colors);
  assert.equal(back.tape, 'brown');
  assert.ok(rendersSame(MV56B, back, 24), '往復後の塗り分けがずれている');
});

test('v2: 横の繰り返しを畳んでコードを短くする', () => {
  const code = encodeAppearance(MV56B);
  const back = decodeAppearance(code);
  // MV-56bは一周に山が3回なので、24列は8列の繰り返しになる
  assert.equal(back.grid.rows[0].length, 8, '周期8列に畳まれていない');
  assert.ok(code.length < 60, `畳めていれば60文字未満のはず: ${code.length}`);

  // 繰り返しの無い柄は畳まれず、そのぶん長くなる
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const rows = Array.from({ length: 13 }, () => Array.from({ length: 24 }, () => rand(4)));
  const app = { pattern: GRID_PATTERN, colors: [0, 1, 2, 3], soloFill: false, tape: 'brown',
    grid: { slices: 24, rows } };
  const c2 = decodeAppearance(encodeAppearance(app));
  assert.equal(c2.grid.rows[0].length, 24);
  assert.ok(rendersSame(app, c2, 24));
});

test('v2: 色数1〜16・テープ3種・分割8〜48で往復できる', () => {
  for (const slices of KERNEL_SLICES) {
    for (const n of [1, 2, 4, 7, 16]) {
      for (const tape of TAPE_COLORS) {
        let seed = slices * 31 + n;
        const rand = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
        const rows = Array.from({ length: 9 }, () => Array.from({ length: slices }, () => rand(n)));
        const app = {
          pattern: GRID_PATTERN, colors: Array.from({ length: n }, (_, i) => i),
          soloFill: false, tape, grid: { slices, rows },
        };
        const back = decodeAppearance(encodeAppearance(app));
        assert.equal(back.pattern, GRID_PATTERN, `${slices}/${n}/${tape}`);
        assert.deepEqual(back.colors, app.colors);
        assert.equal(back.tape, tape);
        assert.ok(rendersSame(app, back, slices), `塗り分けがずれた ${slices}/${n}/${tape}`);
      }
    }
  }
});

test('v2: 大きすぎるマス目はコードにできない(プリセットの道になる)', () => {
  let seed = 99;
  const rand = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
  const rows = Array.from({ length: 24 }, () => Array.from({ length: 48 }, () => rand(16)));
  const app = { pattern: GRID_PATTERN, colors: Array.from({ length: 16 }, (_, i) => i),
    soloFill: false, tape: 'brown', grid: { slices: 48, rows } };
  const code = encodeAppearance(app);
  assert.ok(code.length > MAX_CODE_LENGTH, '上限を超える想定のケース');
  assert.equal(isValidAppearanceCode(code), false, '長すぎるコードは受け付けない');
  assert.equal(decodeAppearance(code).pattern, 'alt', '既定へフォールバックする');
});

test('v2: 壊れたコードは既定値へフォールバックする', () => {
  for (const bad of ['H', 'H!!!', 'HRT', `H${'Z'.repeat(600)}`]) {
    assert.equal(isValidAppearanceCode(bad), false, `受理してはいけない: ${bad}`);
    assert.deepEqual(decodeAppearance(bad), { ...DEFAULT_APPEARANCE, colors: [0] });
  }
});

test('v2: 不正なマス目(段が不揃い・範囲外の値)は丸められる', () => {
  const app = {
    pattern: GRID_PATTERN, colors: [0, 1], soloFill: false, tape: 'brown',
    grid: { slices: 24, rows: [[0, 1, 0], [1, 0], [9, -3, 'x', 1]] },
  };
  const back = decodeAppearance(encodeAppearance(app));
  assert.equal(back.grid.rows.length, 3);
  // 一番短い段(2列)に揃えられ、値も色数の範囲へ収まる
  assert.equal(back.grid.rows[0].length, 2);
  for (const row of back.grid.rows) {
    for (const c of row) assert.ok(Number.isInteger(c) && c >= 0 && c < 2, `範囲外: ${c}`);
  }
});

test('v0/v1はv2を足しても一切変わらない', () => {
  assert.equal(encodeAppearance(DEFAULT_APPEARANCE), '000000');
  assert.equal(encodeAppearance({ pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false, tape: 'brown' }), '06420F');
  const v1 = encodeAppearance({
    pattern: CUSTOM_PATTERN, colors: [0, 1, 2, 3], soloFill: false, tape: 'brown',
    kernel: { ...DEFAULT_KERNEL },
  });
  assert.equal(v1[0], 'G');
  assert.equal(decodeAppearance(v1).pattern, CUSTOM_PATTERN);
});

// ---------------------------------------------------------------------------
// 第4段階: 三角マス目(1マスを対角線で2色に割る柄。実機のMV-65のようなパネル)
// ---------------------------------------------------------------------------

// makeTriGridPattern()単体でのジオメトリ確認。gore座標(g)・縦位置(v)から
// セル内の位置(lu, lv)を導き、対角線のどちら側かで色が決まることを直接検証する
test('makeTriGridPattern: dir=0("\\")は左下(lu+lv<1)がa、右上がb', () => {
  const pat = makeTriGridPattern('t', 1, [[{ a: 0, b: 1, dir: 0 }]]);
  // lu=0.25,lv=0.25(左下寄り) → a
  assert.equal(pat.colorIndex(0.25 * GORES, 0.75, 2), 0);
  // lu=0.9,lv=0.9(右上寄り) → b
  assert.equal(pat.colorIndex(0.9 * GORES, 0.1, 2), 1);
});

test('makeTriGridPattern: dir=1("/")は左上(lv>lu)がa、右下がb', () => {
  const pat = makeTriGridPattern('t', 1, [[{ a: 2, b: 3, dir: 1 }]]);
  // lu=0.2,lv=0.8(左上寄り) → a
  assert.equal(pat.colorIndex(0.2 * GORES, 0.2, 4), 2);
  // lu=0.8,lv=0.2(右下寄り) → b
  assert.equal(pat.colorIndex(0.8 * GORES, 0.8, 4), 3);
});

test('makeTriGridPattern: PATTERNS/makeGridPatternと同じ形({colorIndex,fineSlices,alignSeams,skirtUsesTopColor})を返す', () => {
  const pat = makeTriGridPattern('t', 24, [[{ a: 0, b: 1, dir: 0 }]]);
  assert.equal(typeof pat.colorIndex, 'function');
  assert.equal(pat.fineSlices, 24);
  assert.equal(pat.alignSeams, true);
  assert.equal(pat.skirtUsesTopColor, true);
});

test('v3: 三角マス目はJで始まるコードになり、塗り分けが完全に往復する', () => {
  // a/bは色スロット番号(0..colors.length-1)。パレット番号そのものではない
  const rows = [
    [{ a: 3, b: 2, dir: 0 }, { a: 0, b: 3, dir: 1 }, { a: 2, b: 3, dir: 0 }, { a: 3, b: 0, dir: 1 },
      { a: 3, b: 0, dir: 0 }, { a: 2, b: 3, dir: 1 }, { a: 0, b: 2, dir: 0 }, { a: 3, b: 3, dir: 1 }],
    [{ a: 0, b: 3, dir: 1 }, { a: 2, b: 3, dir: 0 }, { a: 3, b: 0, dir: 1 }, { a: 3, b: 2, dir: 0 },
      { a: 2, b: 0, dir: 1 }, { a: 3, b: 3, dir: 0 }, { a: 3, b: 0, dir: 1 }, { a: 0, b: 2, dir: 0 }],
  ];
  const app = { pattern: TRI_GRID_PATTERN, colors: [8, 6, 1, 12], soloFill: false, tape: 'brown', triGrid: { slices: 8, rows } };
  const code = encodeAppearance(app);
  assert.equal(code[0], 'J');
  assert.ok(code.length <= MAX_CODE_LENGTH);
  const back = decodeAppearance(code);
  assert.equal(back.pattern, TRI_GRID_PATTERN);
  assert.equal(back.triGrid.slices, 8);
  assert.equal(back.triGrid.rows.length, 2);
  assert.deepEqual(back.triGrid.rows, rows);
  assert.deepEqual(back.colors, app.colors);
  assert.equal(back.tape, 'brown');
});

test('v3: 横の繰り返しを畳んでコードを短くする', () => {
  // 24列だが実際は8列の繰り返し。8個は互いに全て異なるセルなので、
  // 8より小さい周期(1,2,4)には縮まらない(どの約数で比べても必ずどこかが違う)
  const cells8 = [
    { a: 0, b: 1, dir: 0 }, { a: 1, b: 2, dir: 1 }, { a: 2, b: 3, dir: 0 }, { a: 3, b: 0, dir: 1 },
    { a: 0, b: 2, dir: 0 }, { a: 1, b: 3, dir: 1 }, { a: 2, b: 0, dir: 0 }, { a: 3, b: 1, dir: 1 },
  ];
  const rows = Array.from({ length: 13 }, () => Array.from({ length: 24 }, (_, i) => cells8[i % 8]));
  const app = { pattern: TRI_GRID_PATTERN, colors: [0, 1, 2, 3], soloFill: false, tape: 'brown', triGrid: { slices: 24, rows } };
  const back = decodeAppearance(encodeAppearance(app));
  assert.equal(back.triGrid.rows[0].length, 8, '周期8列に畳まれていない');

  // 繰り返しの無い柄は畳まれず、そのぶん長くなる
  let seed = 11;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const randRows = Array.from({ length: 13 }, () => Array.from({ length: 24 },
    () => ({ a: rand(4), b: rand(4), dir: rand(2) })));
  const app2 = { pattern: TRI_GRID_PATTERN, colors: [0, 1, 2, 3], soloFill: false, tape: 'brown', triGrid: { slices: 24, rows: randRows } };
  const c2 = decodeAppearance(encodeAppearance(app2));
  assert.equal(c2.triGrid.rows[0].length, 24);
});

test('v3: 色数1〜16・テープ3種・分割8〜48で往復できる', () => {
  for (const slices of KERNEL_SLICES) {
    for (const n of [1, 2, 4, 7, 16]) {
      for (const tape of TAPE_COLORS) {
        let seed = slices * 31 + n;
        const rand = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
        const rows = Array.from({ length: 5 }, () => Array.from({ length: slices },
          () => ({ a: rand(n), b: rand(n), dir: rand(2) })));
        const app = {
          pattern: TRI_GRID_PATTERN, colors: Array.from({ length: n }, (_, i) => i),
          soloFill: false, tape, triGrid: { slices, rows },
        };
        const back = decodeAppearance(encodeAppearance(app));
        assert.equal(back.pattern, TRI_GRID_PATTERN, `${slices}/${n}/${tape}`);
        assert.deepEqual(back.colors, app.colors);
        assert.equal(back.tape, tape);
        assert.ok(rendersSame(app, back, slices), `塗り分けがずれた ${slices}/${n}/${tape}`);
      }
    }
  }
});

test('v3: 24列×13段・4色前後の実機相当の大きさならコード長に収まる', () => {
  let seed = 77;
  const rand = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
  const rows = Array.from({ length: 13 }, () => Array.from({ length: 24 },
    () => ({ a: rand(4), b: rand(4), dir: rand(2) })));
  const app = { pattern: TRI_GRID_PATTERN, colors: [8, 6, 1, 12], soloFill: false, tape: 'brown', triGrid: { slices: 24, rows } };
  const code = encodeAppearance(app);
  assert.ok(code.length <= MAX_CODE_LENGTH, `想定より長い: ${code.length}文字`);
});

test('v3: 大きすぎるマス目はコードにできない(プリセットの道になる)', () => {
  let seed = 99;
  const rand = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
  const rows = Array.from({ length: 24 }, () => Array.from({ length: 48 },
    () => ({ a: rand(16), b: rand(16), dir: rand(2) })));
  const app = {
    pattern: TRI_GRID_PATTERN, colors: Array.from({ length: 16 }, (_, i) => i),
    soloFill: false, tape: 'brown', triGrid: { slices: 48, rows },
  };
  const code = encodeAppearance(app);
  assert.ok(code.length > MAX_CODE_LENGTH, '上限を超える想定のケース');
  assert.equal(isValidAppearanceCode(code), false, '長すぎるコードは受け付けない');
  assert.equal(decodeAppearance(code).pattern, 'alt', '既定へフォールバックする');
});

test('v3: 壊れたコードは既定値へフォールバックする', () => {
  for (const bad of ['J', 'J!!!', 'JRT', `J${'Z'.repeat(600)}`]) {
    assert.equal(isValidAppearanceCode(bad), false, `受理してはいけない: ${bad}`);
    assert.deepEqual(decodeAppearance(bad), { ...DEFAULT_APPEARANCE, colors: [0] });
  }
});

test('v3: 不正なマス目(段が不揃い・範囲外の値・dirが真偽値でない)は丸められる', () => {
  const app = {
    pattern: TRI_GRID_PATTERN, colors: [0, 1], soloFill: false, tape: 'brown',
    triGrid: {
      slices: 24,
      rows: [
        [{ a: 0, b: 1, dir: 0 }, { a: 1, b: 0, dir: 1 }, { a: 0, b: 1, dir: 0 }],
        [{ a: 9, b: -3, dir: 'x' }, { a: 1, b: 0, dir: 1 }],
      ],
    },
  };
  const back = decodeAppearance(encodeAppearance(app));
  assert.equal(back.triGrid.rows.length, 2);
  // 一番短い段(2列)に揃えられ、値も色数の範囲(0..1)・dirも0/1へ丸められる
  assert.equal(back.triGrid.rows[0].length, 2);
  for (const row of back.triGrid.rows) {
    for (const cell of row) {
      assert.ok(Number.isInteger(cell.a) && cell.a >= 0 && cell.a < 2, `a範囲外: ${cell.a}`);
      assert.ok(Number.isInteger(cell.b) && cell.b >= 0 && cell.b < 2, `b範囲外: ${cell.b}`);
      assert.ok(cell.dir === 0 || cell.dir === 1, `dir不正: ${cell.dir}`);
    }
  }
});

test('resolvePattern: 三角マス目もプリセット/カーネル/マス目と同じ形で返る', () => {
  const app = {
    pattern: TRI_GRID_PATTERN, colors: [0, 1],
    triGrid: { slices: 24, rows: [[{ a: 0, b: 1, dir: 0 }]] },
  };
  const def = resolvePattern(app);
  assert.equal(typeof def.colorIndex, 'function');
  assert.equal(def.fineSlices, 24);
  assert.equal(def.alignSeams, true);
});

test('v0/v1/v2はv3を足しても一切変わらない', () => {
  assert.equal(encodeAppearance(DEFAULT_APPEARANCE), '000000');
  assert.equal(encodeAppearance({ pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false, tape: 'brown' }), '06420F');
  const v1 = encodeAppearance({
    pattern: CUSTOM_PATTERN, colors: [0, 1, 2, 3], soloFill: false, tape: 'brown',
    kernel: { ...DEFAULT_KERNEL },
  });
  assert.equal(v1[0], 'G');
  const v2 = encodeAppearance({
    pattern: GRID_PATTERN, colors: [8, 6, 1, 12], soloFill: false, tape: 'brown',
    grid: { slices: 24, rows: [[0, 1, 2, 3]] },
  });
  assert.equal(v2[0], 'H');
  assert.equal(decodeAppearance(v2).pattern, GRID_PATTERN);
});

// ---------------------------------------------------------------------------
// v4: v3の圧縮版(ベタ塗りマスは色を1つだけ持つ)。5色以上・段数が多い柄で
// 512文字を超えてしまう実例(実機7色・24列×15段)がきっかけで追加した
// ---------------------------------------------------------------------------

test('v4: 対角線もベタ塗りも混在する柄がv3より短く、塗り分けも完全一致する', () => {
  // わざと「対角線のマス」と「ベタ塗り(a===b)のマス」を混ぜる
  let seed = 3;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const rows = Array.from({ length: 15 }, () => Array.from({ length: 24 }, () => {
    if (rand(2) === 0) { const v = rand(7); return { a: v, b: v, dir: rand(2) }; }
    return { a: rand(7), b: rand(7), dir: rand(2) };
  }));
  const app = {
    pattern: TRI_GRID_PATTERN, colors: [0, 1, 2, 3, 4, 5, 6], soloFill: false, tape: 'brown',
    triGrid: { slices: 24, rows },
  };
  const code = encodeAppearance(app);
  assert.equal(code[0], 'K', 'ベタ塗りを含む柄はv4が選ばれるはず');
  assert.ok(code.length <= MAX_CODE_LENGTH);
  const back = decodeAppearance(code);
  assert.equal(back.pattern, TRI_GRID_PATTERN);
  assert.deepEqual(back.colors, app.colors);
  assert.ok(rendersSame(app, back, 24), '塗り分けがv3と変わってしまった');
});

test('v4: 全マス対角線(ベタ塗りなし)ではv3の方が短いか同じなので、v3のままになる', () => {
  let seed = 9;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const rows = Array.from({ length: 4 }, () => Array.from({ length: 8 }, () => {
    const a = rand(3), b = (a + 1 + rand(2)) % 3; // aとbが必ず異なるようにする
    return { a, b, dir: rand(2) };
  }));
  const app = {
    pattern: TRI_GRID_PATTERN, colors: [0, 1, 2], soloFill: false, tape: 'brown',
    triGrid: { slices: 8, rows },
  };
  const code = encodeAppearance(app);
  assert.equal(code[0], 'J', '対角線だらけの柄はv4にすると旗ビットぶん長くなるのでv3のままのはず');
  const back = decodeAppearance(code);
  assert.ok(rendersSame(app, back, 8));
});

test('v4: 実機相当(7色・24列×15段)で512文字を超えていたコードが収まるようになる', () => {
  // ベタ塗りマスを多めに混ぜた実例相当のデータ(実際の不具合報告と同じ形)
  let seed = 21;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const rows = Array.from({ length: 15 }, () => Array.from({ length: 24 }, () => {
    if (rand(3) < 1) { const v = rand(7); return { a: v, b: v, dir: 0 }; }
    return { a: rand(7), b: rand(7), dir: rand(2) };
  }));
  const app = {
    pattern: TRI_GRID_PATTERN, colors: [0, 1, 2, 3, 4, 5, 6], soloFill: false, tape: 'brown',
    triGrid: { slices: 24, rows },
  };
  const code = encodeAppearance(app);
  assert.ok(code.length <= MAX_CODE_LENGTH, `${code.length}文字は上限超え`);
  const back = decodeAppearance(code);
  assert.ok(rendersSame(app, back, 24));
});

test('v4: 壊れたコードは既定値へフォールバックする', () => {
  for (const bad of ['K', 'K!!!', 'KRT', `K${'Z'.repeat(600)}`]) {
    assert.equal(isValidAppearanceCode(bad), false, `受理してはいけない: ${bad}`);
    assert.deepEqual(decodeAppearance(bad), { ...DEFAULT_APPEARANCE, colors: [0] });
  }
});

test('v0/v1/v2/v3はv4を足しても一切変わらない', () => {
  assert.equal(encodeAppearance(DEFAULT_APPEARANCE), '000000');
  assert.equal(encodeAppearance({ pattern: 'sapphire', colors: [0, 1, 2, 3], soloFill: false, tape: 'brown' }), '06420F');
  const v1 = encodeAppearance({
    pattern: CUSTOM_PATTERN, colors: [0, 1, 2, 3], soloFill: false, tape: 'brown',
    kernel: { ...DEFAULT_KERNEL },
  });
  assert.equal(v1[0], 'G');
  const v2 = encodeAppearance({
    pattern: GRID_PATTERN, colors: [8, 6, 1, 12], soloFill: false, tape: 'brown',
    grid: { slices: 24, rows: [[0, 1, 2, 3]] },
  });
  assert.equal(v2[0], 'H');
  // v3当時に書いたテスト(このファイル上部)がdecodeV3/encodeV3を一切変更していない
  // まま全てpassし続けていること自体が、v4追加による回帰が無いことの証拠になる
  const rows = [
    [{ a: 3, b: 2, dir: 0 }, { a: 0, b: 3, dir: 1 }, { a: 2, b: 3, dir: 0 }, { a: 3, b: 0, dir: 1 },
      { a: 3, b: 0, dir: 0 }, { a: 2, b: 3, dir: 1 }, { a: 0, b: 2, dir: 0 }, { a: 3, b: 3, dir: 1 }],
    [{ a: 0, b: 3, dir: 1 }, { a: 2, b: 3, dir: 0 }, { a: 3, b: 0, dir: 1 }, { a: 3, b: 2, dir: 0 },
      { a: 2, b: 0, dir: 1 }, { a: 3, b: 3, dir: 0 }, { a: 3, b: 0, dir: 1 }, { a: 0, b: 2, dir: 0 }],
  ];
  const v3App = { pattern: TRI_GRID_PATTERN, colors: [8, 6, 1, 12], soloFill: false, tape: 'brown', triGrid: { slices: 8, rows } };
  const v3 = encodeAppearance(v3App);
  assert.equal(v3[0], 'J', 'この柄はベタ塗りが少ないのでv3のままのはず(v4追加で変わってしまった)');
  assert.ok(rendersSame(v3App, decodeAppearance(v3), 8));
});
