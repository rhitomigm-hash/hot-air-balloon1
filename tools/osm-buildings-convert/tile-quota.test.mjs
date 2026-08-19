import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileKeyFor, allocateQuota } from './tile-quota.mjs';

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
