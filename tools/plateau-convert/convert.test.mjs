import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFootprintPosList, parseBuilding } from './convert.mjs';

test('parseFootprintPosList: "lat lon height"の並びを[lon,lat]に変換する', () => {
  const posList = '36.1 138.4 0 36.2 138.5 0 36.3 138.6 0';
  const out = parseFootprintPosList(posList);
  assert.deepEqual(out, [
    [138.4, 36.1],
    [138.5, 36.2],
    [138.6, 36.3],
  ]);
});

test('parseFootprintPosList: 空文字なら空配列', () => {
  assert.deepEqual(parseFootprintPosList(''), []);
});

test('parseBuilding: measuredHeightとlod0FootPrintを抽出する', () => {
  const xml = `<bldg:Building gml:id="x">
    <bldg:measuredHeight uom="m">12.5</bldg:measuredHeight>
    <bldg:lod0FootPrint>
      <gml:MultiSurface>
        <gml:surfaceMember>
          <gml:Polygon>
            <gml:exterior>
              <gml:LinearRing>
                <gml:posList>36.1 138.4 0 36.2 138.4 0 36.2 138.5 0 36.1 138.4 0</gml:posList>
              </gml:LinearRing>
            </gml:exterior>
          </gml:Polygon>
        </gml:surfaceMember>
      </gml:MultiSurface>
    </bldg:lod0FootPrint>
  </bldg:Building>`;
  const b = parseBuilding(xml);
  assert.equal(b.height, 12.5);
  assert.equal(b.footprint.length, 4);
  assert.deepEqual(b.footprint[0], [138.4, 36.1]);
});

test('parseBuilding: measuredHeightが無ければ既定の6mにフォールバックする', () => {
  const xml = `<bldg:Building gml:id="x">
    <bldg:lod0FootPrint>
      <gml:posList>36.1 138.4 0 36.2 138.4 0 36.2 138.5 0</gml:posList>
    </bldg:lod0FootPrint>
  </bldg:Building>`;
  const b = parseBuilding(xml);
  assert.equal(b.height, 6);
});

test('parseBuilding: 0以下や非数値のmeasuredHeightも既定値にフォールバックする', () => {
  const xml = `<bldg:Building gml:id="x">
    <bldg:measuredHeight uom="m">-9999</bldg:measuredHeight>
    <bldg:lod0FootPrint>
      <gml:posList>36.1 138.4 0 36.2 138.4 0 36.2 138.5 0</gml:posList>
    </bldg:lod0FootPrint>
  </bldg:Building>`;
  const b = parseBuilding(xml);
  assert.equal(b.height, 6);
});

test('parseBuilding: lod0FootPrintが無い場合はlod0RoofEdgeで代用する', () => {
  const xml = `<bldg:Building gml:id="x">
    <bldg:measuredHeight uom="m">5.7</bldg:measuredHeight>
    <bldg:lod0RoofEdge>
      <gml:posList>36.1 139.6 0 36.2 139.6 0 36.2 139.7 0</gml:posList>
    </bldg:lod0RoofEdge>
    <bldg:lod1Solid></bldg:lod1Solid>
  </bldg:Building>`;
  const b = parseBuilding(xml);
  assert.equal(b.height, 5.7);
  assert.equal(b.footprint.length, 3);
});

test('parseBuilding: lod0FootPrintもlod0RoofEdgeも無ければnullを返す(スキップ対象)', () => {
  const xml = `<bldg:Building gml:id="x"><bldg:measuredHeight uom="m">8</bldg:measuredHeight></bldg:Building>`;
  assert.equal(parseBuilding(xml), null);
});

test('parseBuilding: 頂点3未満のfootprintはnullを返す', () => {
  const xml = `<bldg:Building gml:id="x">
    <bldg:lod0FootPrint><gml:posList>36.1 138.4 0 36.2 138.4 0</gml:posList></bldg:lod0FootPrint>
  </bldg:Building>`;
  assert.equal(parseBuilding(xml), null);
});
