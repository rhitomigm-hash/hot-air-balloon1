// 建物データの取捨選択(キャッピング)を、フライトエリア全体を5x5のタイルに分けた
// 上で「密度が高いタイルは多め、低いタイルは少なめ(ただしゼロにはしない)」という
// 傾斜配分で行うためのヘルパー。tools/osm-buildings-convert/convert.mjs と
// tools/plateau-convert/convert.mjs の両方から使う(単純な中心からの距離ソートだと、
// 密集地がフライトエリアの中心から離れている場合にまるごと切り捨てられてしまうため)。
// 各タイルの取り分(何棟入るか)は密度傾斜配分で決め、その中でどの建物を選ぶかは
// 面積が大きい建物を優先する(同じ上限棟数でも、より目立つ建物を残すことで
// 上空から見た立体感を出しやすくするため)。
const EARTH_CIRC = 40075016.686;
const DEM_Z = 13;

// terrain.js(ゲーム本体)と同じ計算式(1タイル≒4km四方、緯度で経度方向の縮尺を補正)
function tileMetersAt(lat) {
  return (EARTH_CIRC / 2 ** DEM_Z) * Math.cos((lat * Math.PI) / 180);
}

// footprint(経緯度の配列)のおおよその面積(m²)。緯度refLatを基準に局所平面へ
// 投影してからshoelace公式で計算する(選別の優先度づけに使うだけなので厳密な
// 測地面積である必要はない)
export function footprintAreaM2(footprint, refLat) {
  const cos = Math.cos((refLat * Math.PI) / 180);
  const pts = footprint.map(([lon, lat]) => [lon * 111320 * cos, lat * 111320]);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum / 2);
}

// (lon,lat)がフライトエリア中心から見てどのタイルに属するかのキーを返す。
// ゲーム本体のterrain.jsが持つ実タイル境界と厳密に一致させる必要はない
// (実行時のタイル判定はbuildings.jsのterrain.getTileAt()が別途行う)
export function tileKeyFor(lon, lat, centerLon, centerLat) {
  const tileMeters = tileMetersAt(centerLat);
  const dxMeters = (lon - centerLon) * 111320 * Math.cos((centerLat * Math.PI) / 180);
  const dzMeters = (lat - centerLat) * 111320;
  const tx = Math.round(dxMeters / tileMeters);
  const tz = Math.round(dzMeters / tileMeters);
  return `${tx}_${tz}`;
}

// countsByTile: Map<tileKey, 実棟数> → Map<tileKey, 割り当て棟数>
// 1) 建物が1棟でもあるタイルにはmin(実棟数, minPerTile)を保証
// 2) 残り予算を実棟数の平方根に比例する重みで配分(単純比例だと密集タイルが
//    予算をほぼ独占してしまうため、平方根で緩和する)
// 3) 配分が実棟数を超える場合は実棟数で頭打ちにし、余りは他のタイルへ再配分
export function allocateQuota(countsByTile, totalBudget, minPerTile = 20) {
  const entries = [...countsByTile.entries()].filter(([, count]) => count > 0);
  const alloc = new Map(entries.map(([key]) => [key, 0]));
  if (entries.length === 0) return alloc;

  let used = 0;
  for (const [key, count] of entries) {
    const floor = Math.min(count, minPerTile);
    alloc.set(key, floor);
    used += floor;
  }

  // 予算が最低保証の合計にも満たない場合は、保証分自体を按分して縮小する
  if (used > totalBudget) {
    const scale = totalBudget / used;
    let scaledUsed = 0;
    for (const [key] of alloc) {
      const scaled = Math.floor(alloc.get(key) * scale);
      alloc.set(key, scaled);
      scaledUsed += scaled;
    }
    let leftover = totalBudget - scaledUsed;
    for (const [key] of alloc) {
      if (leftover <= 0) break;
      alloc.set(key, alloc.get(key) + 1);
      leftover--;
    }
    return alloc;
  }

  let remaining = totalBudget - used;
  while (remaining > 0) {
    const headroom = entries.filter(([key, count]) => alloc.get(key) < count);
    if (headroom.length === 0) break;
    const totalWeight = headroom.reduce((s, [, count]) => s + Math.sqrt(count), 0);
    let distributed = 0;
    for (const [key, count] of headroom) {
      if (remaining - distributed <= 0) break;
      const weight = Math.sqrt(count) / totalWeight;
      const want = Math.max(1, Math.floor(weight * remaining));
      const give = Math.min(want, count - alloc.get(key), remaining - distributed);
      if (give <= 0) continue;
      alloc.set(key, alloc.get(key) + give);
      distributed += give;
    }
    if (distributed === 0) break; // 安全弁(丸め等で誰にも配れなくなった場合)
    remaining -= distributed;
  }
  return alloc;
}

// items: 各要素が_tileKey(tileKeyForの戻り値)と_areaM2(footprintAreaM2の戻り値。
// タイル内での取捨選択に使う)を持つ配列。タイルごとの配分数(何棟入るか)は
// allocateQuota()による密度傾斜配分のまま変えず、その配分数の中で_areaM2が
// 大きい順(＝面積の大きい、目立つ建物優先)に選ぶ。これにより、密な市街地が
// 中心から離れていてもタイルごとの取り分は確保されたまま(既存の傾斜配分の
// 効果はそのまま)、各タイル内で選ばれる建物がより目立つ大きな建物になり、
// 同じ上限棟数でも上空から見た立体感が出やすくなる
export function selectByTileQuota(items, totalBudget, minPerTile = 20) {
  const countsByTile = new Map();
  for (const item of items) {
    countsByTile.set(item._tileKey, (countsByTile.get(item._tileKey) || 0) + 1);
  }
  const quota = allocateQuota(countsByTile, totalBudget, minPerTile);

  const byTile = new Map();
  for (const item of items) {
    if (!byTile.has(item._tileKey)) byTile.set(item._tileKey, []);
    byTile.get(item._tileKey).push(item);
  }

  const selected = [];
  for (const [key, group] of byTile) {
    const take = quota.get(key) || 0;
    group.sort((a, b) => b._areaM2 - a._areaM2);
    selected.push(...group.slice(0, take));
  }
  return selected.map(({ _distKm, _tileKey, _areaM2, ...rest }) => rest);
}
