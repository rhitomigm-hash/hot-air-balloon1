import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heightOf } from './height-default.mjs';
import { simplifyFootprint } from './simplify.mjs';

test('heightOf: heightタグを最優先で使う', () => {
  assert.equal(heightOf({ height: '12.5', 'building:levels': '2', building: 'garage' }), 12.5);
});

test('heightOf: "12 m"のような単位付き表記も数値化する', () => {
  assert.equal(heightOf({ height: '9 m' }), 9);
});

test('heightOf: heightが無ければbuilding:levelsから3m/階で計算する', () => {
  assert.equal(heightOf({ 'building:levels': '4' }), 12);
});

test('heightOf: heightもlevelsも無ければbuildingタグの既定値テーブルを使う', () => {
  assert.equal(heightOf({ building: 'garage' }), 3);
  assert.equal(heightOf({ building: 'apartments' }), 15);
});

test('heightOf: 何も無ければ既定の6mを返す', () => {
  assert.equal(heightOf({}), 6);
  assert.equal(heightOf({ building: 'yes' }), 6);
});

test('heightOf: 不正な値は無視して次の優先順位にフォールバックする', () => {
  assert.equal(heightOf({ height: 'unknown', 'building:levels': '3' }), 9);
  assert.equal(heightOf({ height: '-5', building: 'house' }), 6);
});

test('simplifyFootprint: 頂点数が上限以下ならそのまま(閉路の重複点だけ除去)', () => {
  const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const out = simplifyFootprint(square, 12);
  assert.equal(out.length, 4);
});

test('simplifyFootprint: 上限を超える多角形は間引かれる', () => {
  const circle = Array.from({ length: 50 }, (_, i) => {
    const a = (i / 50) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  });
  const out = simplifyFootprint(circle, 12);
  assert.ok(out.length <= 12);
  assert.ok(out.length >= 3);
});

test('simplifyFootprint: 頂点3未満の入力でもクラッシュしない', () => {
  const out = simplifyFootprint([[0, 0], [1, 1]], 12);
  assert.equal(out.length, 2);
});
