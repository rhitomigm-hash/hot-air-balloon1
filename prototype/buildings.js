// 建物の3D表現(LOD1相当の押し出しジオメトリ)。壁は無彩色に近いグレーを基準に、
// 1棟ごとに明るさを少しずつ変え(WALL_SHADE_MIN周辺)、さらに細かい濃淡ノイズの
// テクスチャ(WALL_GRAIN_*周辺)を重ねることで、単色べた塗りの単調さを消している。
// 屋根だけ地形と同じ航空写真テクスチャを貼る(terrain.getTileAt()でタイルの
// materialをそのまま共有するため、地形側のLOD昇格・テクスチャ差し替えが
// 屋根にも自動で反映される)。
// データは PLATEAU(国交省・CC BY 4.0)/OSM Buildings のいずれかを、あらかじめ
// tools/plateau-convert・tools/osm-buildings-convert で統一スキーマJSONに変換したものを使う:
//   { source, license, generatedAt, buildings: [{ footprint: [[lon,lat],...], height }] }
// footprintは経緯度のまま持ち、terrain.lonLatToWorld() で地形メッシュと同じ投影・原点に
// 変換することで、地形の頂点座標と完全に整合させる。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 壁は全棟の形状を1つのジオメトリに統合して1回で描くため、棟ごとに色を変えるには
// 頂点カラーを使うしかない(棟ごとにmaterialを分けると統合が壊れ、ドローコールが
// 棟数分に増えてしまう)。materialの色 × 頂点カラー × 下のノイズテクスチャ で
// 最終的な色が決まるので、ここの色が「最も明るい棟の、最も明るい部分の色」になる。
// 屋根(地形の航空写真テクスチャ、グレー寄り)と並んだときに壁だけ明るい白に
// 浮いて見えたため彩度を落としているが、単純なR=G=Bにすると朝日の暖色(下のsun参照)
// との掛け算で実機ではRが強く出て赤みがかって見えるため、あらかじめ少し寒色
// (B>R)寄りにして相殺している
const WALL_MATERIAL = new THREE.MeshLambertMaterial({ color: 0xa0a4a8, vertexColors: true });

// 明るさのばらつきの下限(見た目=sRGB基準の倍率。1.0でベース色そのまま)。
// 0.82なら中央値0.91を挟んでおよそ±10%の幅になる
const WALL_SHADE_MIN = 0.82;

// 座標から決まる0以上1未満の擬似乱数。配列の添字ではなく重心のワールド座標を
// 種にすることで、リロードしても、簡易/詳細ティアを切り替えても、同じ建物は
// 必ず同じ明るさになる(表示のたびに街全体の色が入れ替わるのを防ぐ)
function hash01(x, z) {
  let h = Math.imul(Math.round(x), 73856093) ^ Math.imul(Math.round(z), 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 頂点カラーに入れる明るさ(0..255)。three.jsは頂点カラーをリニア色空間の値として
// 乗算するので、見た目(sRGB)基準で決めた倍率をリニアに直してから格納する。
// r=g=bの中立な倍率なので、暗くしても色味(色相)はずれない
function wallShadeByte(cx, cz) {
  const s = WALL_SHADE_MIN + (1 - WALL_SHADE_MIN) * hash01(cx, cz);
  return Math.round(255 * s ** 2.2);
}

// 壁面がのっぺり(単色べた塗り)に見えるのを避けるための、ごく細かい濃淡ノイズ。
// 棟ごとの明るさ(頂点カラー、上のwallShadeByte)とは別の層として、材質のテクスチャ
// (map)にタイル張りの手続き型ノイズ画像を貼る。頂点数を増やさずに済むうえ、
// 建物の大きさに関係なく実寸(m)基準でタイリングするので、大きな建物でも
// 引き伸ばされて見えることがない
const WALL_GRAIN_SCALE = 4; // ノイズが1回タイリングする物理サイズ(m)。大きな壁面でも
// タイルの繰り返しが目立たない程度に大きめにしている
const WALL_GRAIN_MEAN = 0.95; // 見た目(sRGB)基準の平均倍率
const WALL_GRAIN_AMOUNT = 0.035; // 平均からの振れ幅(パターンとして認識されないよう控えめに)

// gridN×gridNの格子点(トーラス状、端が反対側の端とつながる)を双一次補間する値ノイズ。
// 端をmod演算で折り返すことで、タイル境界に継ぎ目が出ない(継ぎ目があると、その線が
// RepeatWrapping先で規則的なグリッド模様として目立ってしまうため重要)
function makeSeamlessNoiseSampler(gridN) {
  const grid = new Float32Array(gridN * gridN);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
  return (u, v) => {
    const gx = u * gridN, gy = v * gridN;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const xi0 = ((x0 % gridN) + gridN) % gridN, yi0 = ((y0 % gridN) + gridN) % gridN;
    const xi1 = (xi0 + 1) % gridN, yi1 = (yi0 + 1) % gridN;
    const v00 = grid[yi0 * gridN + xi0], v10 = grid[yi0 * gridN + xi1];
    const v01 = grid[yi1 * gridN + xi0], v11 = grid[yi1 * gridN + xi1];
    const a = v00 + (v10 - v00) * fx, b = v01 + (v11 - v01) * fx;
    return a + (b - a) * fy;
  };
}

function createWallGrainTexture() {
  const SIZE = 128;
  // 粗い濃淡(周波数5)と細かい粒立ち(周波数13)を重ねて、単純な繰り返しに見えにくくする
  const coarse = makeSeamlessNoiseSampler(5);
  const fine = makeSeamlessNoiseSampler(13);

  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = SIZE;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const n = coarse(u, v) * 0.65 + fine(u, v) * 0.35; // 両方0..1なので加重和も0..1のまま

      const shade = Math.min(1, Math.max(0, WALL_GRAIN_MEAN + (n - 0.5) * 2 * WALL_GRAIN_AMOUNT));
      const idx = (y * SIZE + x) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = Math.round(255 * shade);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // ここに書き込んだ値は見た目(sRGB)基準の輝度なので、そう明示することで
  // three.js側にリニア変換を任せる(頂点カラーのように手動でpow(2.2)する必要がない)
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
  const uvs = new Float32Array(n * 6 * 2);
  let vi = 0, ui = 0;
  let arc = 0; // 壁沿いの累積距離(m)。ノイズテクスチャのUVをこれで張るので、
  // 建物の大きさや辺の長さによらず、実寸で一定のタイル幅になる(RepeatWrappingで繰り返す)
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts2d[i];
    const [x1, y1] = pts2d[(i + 1) % n];
    const edgeLen = Math.hypot(x1 - x0, y1 - y0);
    const u0 = arc / WALL_GRAIN_SCALE, u1 = (arc + edgeLen) / WALL_GRAIN_SCALE;
    const v0 = 0, v1 = h / WALL_GRAIN_SCALE;
    arc += edgeLen;

    // A=床(p0) B=床(p1) C=天井(p1) D=天井(p0)。pts2dはCCWなので、この頂点順(A,B,D)
    // と(B,C,D)はどちらも外向き法線になる(cross(B-A,D-A)=cross(C-B,D-B)=h*(dy,-dx,0))
    positions[vi++] = x0; positions[vi++] = y0; positions[vi++] = 0;
    positions[vi++] = x1; positions[vi++] = y1; positions[vi++] = 0;
    positions[vi++] = x0; positions[vi++] = y0; positions[vi++] = h;
    positions[vi++] = x1; positions[vi++] = y1; positions[vi++] = 0;
    positions[vi++] = x1; positions[vi++] = y1; positions[vi++] = h;
    positions[vi++] = x0; positions[vi++] = y0; positions[vi++] = h;

    uvs[ui++] = u0; uvs[ui++] = v0;
    uvs[ui++] = u1; uvs[ui++] = v0;
    uvs[ui++] = u0; uvs[ui++] = v1;
    uvs[ui++] = u1; uvs[ui++] = v0;
    uvs[ui++] = u1; uvs[ui++] = v1;
    uvs[ui++] = u0; uvs[ui++] = v1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  // 1棟まるごと同じ明るさにする。Float32ではなくUint8(正規化)で持つのは、詳細ティア
  // (数万棟・壁の総頂点数が百万超)でのメモリを抑えるため。実測で17.6MB→4.4MBになる
  const colors = new Uint8Array(n * 6 * 3).fill(wallShadeByte(cx, cz));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));

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

// フライト開始直後は地形タイル読み込みと帯域を奪い合うため、建物データの取得が
// 一時的に失敗しやすい。404(そのエリアのデータが実際に無い)以外は通信の一時的な
// 失敗とみなして再試行する(terrain.jsのfetchBitmapRetryと同じ考え方)
async function fetchBuildingsJson(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = new Error(`buildings fetch failed: ${res.status} ${url}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e && e.status && e.status < 500 && e.status !== 429) throw e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

// areaId: PRESET_AREASの id。tier: 'simple'(軽量・4G/低スペック向け)または'detailed'
// (高密度・Wi-Fi推奨)。データが無い/取得失敗なら建物0棟の空レイヤーを返す(フェイルセーフ)
export async function buildBuildings(areaId, tier, terrain, onProgress) {
  if (!areaId || (tier !== 'simple' && tier !== 'detailed')) return emptyLayer();

  // ノイズテクスチャの生成にはcanvas(document)が要る。実行時(ブラウザ)まで
  // 遅延させることで、このモジュール自体はNode等のdocument無し環境でも
  // 安全にimportできるようにしておく
  if (typeof document !== 'undefined' && !WALL_MATERIAL.map) {
    WALL_MATERIAL.map = createWallGrainTexture();
    WALL_MATERIAL.needsUpdate = true;
  }

  const suffix = tier === 'simple' ? '-simple' : '';
  let data;
  try {
    data = await fetchBuildingsJson(`./data/buildings/${areaId}${suffix}.json`);
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

  // ここから先で予期しない例外(mergeGeometries失敗等)が起きると、呼び出し元の
  // main.jsでは捕捉されず、建物が二度と表示されないまま(オフオンで再試行しても
  // 直らない)状態になりうるため、フェイルセーフとして空レイヤーにフォールバックする
  try {
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
  } catch (e) {
    console.error('[buildings] geometry build failed', e);
    return emptyLayer();
  }
}
