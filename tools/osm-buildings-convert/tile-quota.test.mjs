import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileKeyFor, allocateQuota, selectByTileQuota, footprintAreaM2 } from './tile-quota.mjs';

test('tileKeyFor: 中心と同じ地点はタイル0_0になる', () => {
  assert.equal(tileKeyFor(130.25, 33.27, 130.25, 33.27), '0_0');
});

test('tileKeyFor: 東西南北に離れると別タイルになる', () => {
  const center = tileKeyFor(130.25, 33.27, 130.25, 33.27);
  const east = tileKeyFor(130.35, 33.27, 130.25, 33.27); // 約10km東
  const north = tileKeyFor(130.25, 33.36, 130.25, 33.27); // 約10km北
  assert.notEqual(east, center);
  assert.notEqual(north, center);
  assert.notEqual(east, north);
});

test('allocateQuota: 疎なタイルにも最低保証(minPerTile)が入る', () => {
  const counts = new Map([
    ['dense', 100000],
    ['sparse', 5],
  ]);
  const alloc = allocateQuota(counts, 14000, 20);
  assert.equal(alloc.get('sparse'), 5); // 実棟数がminPerTileより少ないのでそのまま
  assert.ok(alloc.get('dense') > 0);
});

test('allocateQuota: 密なタイルほど多く配分される(傾斜配分)', () => {
  const counts = new Map([
    ['dense', 10000],
    ['medium', 1000],
    ['sparse', 100],
  ]);
  const alloc = allocateQuota(counts, 3000, 20);
  assert.ok(alloc.get('dense') > alloc.get('medium'));
  assert.ok(alloc.get('medium') > alloc.get('sparse'));
});

test('allocateQuota: 単純比例ではなく平方根加重なので、密度10倍でも配分は10倍にならない', () => {
  const counts = new Map([
    ['dense', 10000],
    ['sparse', 1000],
  ]);
  const alloc = allocateQuota(counts, 5000, 20);
  const ratio = alloc.get('dense') / alloc.get('sparse');
  assert.ok(ratio < 10, `ratio=${ratio} should be dampened below 10x`);
  assert.ok(ratio > 1, `ratio=${ratio} should still favor the denser tile`);
});

test('allocateQuota: 配分合計が予算を超えない', () => {
  const counts = new Map([
    ['a', 50000],
    ['b', 3000],
    ['c', 200],
    ['d', 10],
  ]);
  const alloc = allocateQuota(counts, 14000, 20);
  const total = [...alloc.values()].reduce((s, v) => s + v, 0);
  assert.ok(total <= 14000, `total=${total} exceeds budget`);
});

test('allocateQuota: 全タイルの実棟数合計が予算未満なら、全棟がそのまま割り当てられる', () => {
  const counts = new Map([
    ['a', 100],
    ['b', 50],
  ]);
  const alloc = allocateQuota(counts, 14000, 20);
  assert.equal(alloc.get('a'), 100);
  assert.equal(alloc.get('b'), 50);
});

test('allocateQuota: 予算が最低保証の合計にも満たない場合は按分して縮小する', () => {
  const counts = new Map([
    ['a', 1000],
    ['b', 1000],
    ['c', 1000],
  ]);
  const alloc = allocateQuota(counts, 30, 20); // 20*3=60 > 30
  const total = [...alloc.values()].reduce((s, v) => s + v, 0);
  assert.ok(total <= 30, `total=${total} exceeds budget`);
  assert.ok(total >= 28, `total=${total} should be close to budget`); // 端数調整で30に近いはず
});

test('allocateQuota: 空のMapを渡しても壊れない', () => {
  const alloc = allocateQuota(new Map(), 14000, 20);
  assert.equal(alloc.size, 0);
});

test('allocateQuota: 1タイルだけの場合はそのタイルに全予算(実棟数上限)が入る', () => {
  const counts = new Map([['only', 50000]]);
  const alloc = allocateQuota(counts, 14000, 20);
  assert.equal(alloc.get('only'), 14000);
});

test('footprintAreaM2: 正方形の面積をおおよそ正しく計算する(赤道付近、1辺約111.32m)', () => {
  // 経度・緯度どちらも0.001度四方 ≈ 111.32m四方 ≈ 12392m²(赤道付近, cos(0)=1)
  const footprint = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.001],
    [0, 0.001],
  ];
  const area = footprintAreaM2(footprint, 0);
  assert.ok(Math.abs(area - 12392) < 50, `area=${area} should be ≈12392`);
});

test('footprintAreaM2: 頂点の並び順(時計回り/反時計回り)によらず同じ面積になる', () => {
  const ccw = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]];
  const cw = [...ccw].reverse();
  assert.equal(footprintAreaM2(ccw, 0), footprintAreaM2(cw, 0));
});

test('selectByTileQuota: 同一タイル内では面積が大きい建物から優先的に選ばれる', () => {
  const items = [
    { _tileKey: 't', _areaM2: 10, id: 'small' },
    { _tileKey: 't', _areaM2: 1000, id: 'large' },
    { _tileKey: 't', _areaM2: 100, id: 'medium' },
  ];
  const selected = selectByTileQuota(items, 2, 0);
  const ids = selected.map((b) => b.id);
  assert.deepEqual(ids.sort(), ['large', 'medium'].sort());
});

test('selectByTileQuota: 各タイルの取り分(密度傾斜配分)は面積優先ソートの影響を受けない', () => {
  const items = [
    ...Array.from({ length: 100 }, (_, i) => ({ _tileKey: 'dense', _areaM2: i, id: `d${i}` })),
    ...Array.from({ length: 3 }, (_, i) => ({ _tileKey: 'sparse', _areaM2: i, id: `s${i}` })),
  ];
  const selected = selectByTileQuota(items, 20, 2);
  const denseCount = selected.filter((b) => b.id.startsWith('d')).length;
  const sparseCount = selected.filter((b) => b.id.startsWith('s')).length;
  assert.equal(sparseCount, 3); // 疎タイルは実棟数(3)がそのまま残る
  assert.ok(denseCount > sparseCount); // 密タイルは傾斜配分でより多く残る
});

test('selectByTileQuota: 出力に内部用フィールド(_areaM2等)が残らない', () => {
  const items = [{ _tileKey: 't', _areaM2: 10, _distKm: 1, footprint: [], height: 5 }];
  const selected = selectByTileQuota(items, 10, 20);
  assert.deepEqual(Object.keys(selected[0]).sort(), ['footprint', 'height']);
});
