// 建物の3D表現(LOD1相当の押し出しジオメトリ)。壁は単色、屋根だけ地形と同じ
// 航空写真テクスチャを貼る(terrain.getTileAt()でタイルのmaterialをそのまま共有
// するため、地形側のLOD昇格・テクスチャ差し替えが屋根にも自動で反映される)。
// データは PLATEAU(国交省・CC BY 4.0)/OSM Buildings のいずれかを、あらかじめ
// tools/plateau-convert・tools/osm-buildings-convert で統一スキーマJSONに変換したものを使う:
//   { source, license, generatedAt, buildings: [{ footprint: [[lon,lat],...], height }] }
// footprintは経緯度のまま持ち、terrain.lonLatToWorld() で地形メッシュと同じ投影・原点に
// 変換することで、地形の頂点座標と完全に整合させる。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WALL_MATERIAL = new THREE.MeshLambertMaterial({ color: 0xb8b0a4 });

function emptyLayer() {
  return { group: new THREE.Group(), count: 0, setVisible() {}, dispose() {} };
}

// 2D多角形の符号付き面積(shoelace)。正=反時計回り
function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

// footprint(経緯度の配列)から1棟分の配置情報を作る。失敗(頂点不足・範囲外など)時はnullを返す
function placeBuilding(footprint, height, terrain) {
  if (!Array.isArray(footprint) || footprint.length < 3) return null;

  const world = footprint.map(([lon, lat]) => terrain.lonLatToWorld(lon, lat));
  // GeoJSON形式は始点=終点で閉じていることが多いので、末尾の重複点を落とす
  if (world.length > 1) {
    const a = world[0], b = world[world.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6) world.pop();
  }
  if (world.length < 3) return null;

  const cx = world.reduce((s, p) => s + p.x, 0) / world.length;
  const cz = world.reduce((s, p) => s + p.z, 0) / world.length;

  // 読み込み済み地形範囲の外にある建物は(地面が無いので)描かない
  const half = terrain.sizeMeters / 2;
  if (Math.abs(cx) > half || Math.abs(cz) > half) return null;

  // Shapeの(x,y)は (東西オフセット, -南北オフセット) に対応させる。
  // rotateX(-90°)で立てたときにワールドXZと向きが一致するようにするため
  let pts2d = world.map((p) => [p.x - cx, -(p.z - cz)]);
  if (signedArea(pts2d) < 0) pts2d = pts2d.reverse(); // Shapeの前提はCCW

  const h = Number.isFinite(height) && height > 0 ? height : 6;
  const groundY = terrain.getHeight(cx, cz);
  return { pts2d, cx, cz, groundY, h };
}

// 側面だけの手作りジオメトリ(天面キャップは作らない)。屋根は別ジオメトリ
// (buildRoofGeometry)で同じ高さにちょうど乗せるため、天面キャップを残すと
// 屋根とほぼ同一平面になり、遠距離では深度バッファ精度不足でZファイティング
// (チラつき)を起こす。天面が無ければそもそも競合する面が存在しない
function buildWallGeometry({ pts2d, cx, cz, groundY, h }) {
  const n = pts2d.length;
  const positions = new Float32Array(n * 6 * 3); // 1辺あたり2三角形×3頂点×3成分
  let vi = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts2d[i];
    const [x1, y1] = pts2d[(i + 1) % n];
    // A=床(p0) B=床(p1) C=天井(p1) D=天井(p0)。pts2dはCCWなので、この頂点順(A,B,D)
    // と(B,C,D)はどちらも外向き法線になる(cross(B-A,D-A)=cross(C-B,D-B)=h*(dy,-dx,0))
    positions[vi++] = x0; positions[vi++] = y0; positions[vi++] = 0;
    positions[vi++] = x1; positions[vi++] = y1; positions[vi++] = 0;
    positions[vi++] = x0; positions[vi++] = y0; positions[vi++] = h;
    positions[vi++] = x1; positions[vi++] = y1; positions[vi++] = 0;
    positions[vi++] = x1; positions[vi++] = y1; positions[vi++] = h;
    positions[vi++] = x0; positions[vi++] = y0; positions[vi++] = h;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, groundY, cz);
  return geo;
}

// 屋根の平面ジオメトリ。UVは地形タイルの写真テクスチャ空間(u, 1-v)に合わせて計算し、
// tile.matをそのまま使い回せるようにする
function buildRoofGeometry({ pts2d, cx, cz, groundY, h }, tile, tileMeters) {
  const shape = new THREE.Shape(pts2d.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ShapeGeometry(shape);

  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const tileX0 = tile.cx - tileMeters / 2;
  const tileZ0 = tile.cz - tileMeters / 2;
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i) + cx;
    const worldZ = cz - pos.getY(i); // pts2dのy = -(worldZ-cz) の逆変換
    uv[i * 2] = (worldX - tileX0) / tileMeters;
    uv[i * 2 + 1] = 1 - (worldZ - tileZ0) / tileMeters;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, groundY + h, cz);
  return geo;
}

// areaId: PRESET_AREASの id。データが無い/取得失敗なら建物0棟の空レイヤーを返す(フェイルセーフ)
export async function buildBuildings(areaId, terrain, onProgress) {
  if (!areaId) return emptyLayer();

  let data;
  try {
    const res = await fetch(`./data/buildings/${areaId}.json`);
    if (!res.ok) return emptyLayer();
    data = await res.json();
  } catch {
    return emptyLayer();
  }

  const list = Array.isArray(data?.buildings) ? data.buildings : [];
  const wallGeometries = [];
  const roofGroups = new Map(); // "tx_ty" -> { mat, geos: [] }
  let count = 0;
  const total = list.length;

  for (let i = 0; i < list.length; i++) {
    try {
      const placement = placeBuilding(list[i].footprint, list[i].height, terrain);
      if (placement) {
        wallGeometries.push(buildWallGeometry(placement));
        count++;

        const tile = terrain.getTileAt ? terrain.getTileAt(placement.cx, placement.cz) : null;
        if (tile) {
          const key = `${tile.tx}_${tile.ty}`;
          if (!roofGroups.has(key)) roofGroups.set(key, { mat: tile.mat, geos: [] });
          roofGroups.get(key).geos.push(buildRoofGeometry(placement, tile, terrain.tileMeters));
        }
      }
    } catch {
      // 個々の建物データが壊れていても他の建物の描画は継続する
    }
    if (onProgress) onProgress(i + 1, total);
  }

  if (wallGeometries.length === 0) return emptyLayer();

  const group = new THREE.Group();

  const mergedWalls = mergeGeometries(wallGeometries, false);
  for (const geo of wallGeometries) geo.dispose();
  group.add(new THREE.Mesh(mergedWalls, WALL_MATERIAL));

  // 屋根はタイル単位(=地形と同じ写真テクスチャを共有するmaterial単位)でまとめて1メッシュずつ追加
  const roofMeshes = [];
  for (const { mat, geos } of roofGroups.values()) {
    const mergedRoof = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    const mesh = new THREE.Mesh(mergedRoof, mat); // matは地形タイルの共有material(disposeしない)
    roofMeshes.push(mesh);
    group.add(mesh);
  }

  return {
    group,
    count,
    setVisible(v) { group.visible = v; },
    dispose() {
      mergedWalls.dispose();
      for (const mesh of roofMeshes) mesh.geometry.dispose(); // materialは地形側が所有するため触らない
      group.clear();
    },
  };
}
