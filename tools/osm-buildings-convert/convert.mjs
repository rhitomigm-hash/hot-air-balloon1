#!/usr/bin/env node
// OSM Buildingsから、フライトエリアの建物フットプリントを統一スキーマJSONに変換する。
// PLATEAU非対応エリア(佐賀・一関/平泉・上士幌)およびポーランド版の全エリアで使う。
// 開発時に手動で1回実行し、結果をリポジトリにコミットする運用(ランタイムでの
// Overpass API呼び出しはしない。Overpass公式が本番の重い利用を非推奨としているため)。
//
// 使い方: node convert.mjs <areaId> <lon> <lat> <出力先.json> [半径km(既定15)] [上限棟数(既定28000)]
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { heightOf } from './height-default.mjs';
import { simplifyFootprint } from './simplify.mjs';
import { tileKeyFor, selectByTileQuota, footprintAreaM2 } from './tile-quota.mjs';

const execFileAsync = promisify(execFile);

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const MAX_BUILDINGS = 28000; // TILE_RADIUS 2→3拡張(面積約1.96倍)に合わせて増量
const MAX_VERTICES = 12;
const MIN_PER_TILE = 20;

function bboxAround(lon, lat, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node標準のfetchは環境によってはHTTPS_PROXYを見てくれないことがあるため、
// (プロキシ越しの通信を確実にするために)curlをそのまま呼び出す。
// Overpassはサーバー混雑時に504/接続リセットを返すことがあるため、指数バックオフで再試行する
async function fetchOverpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const waitMs = 15000 * attempt;
      console.error(`  再試行まで${waitMs / 1000}秒待機...`);
      await sleep(waitMs);
    }
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const { stdout } = await execFileAsync(
          'curl',
          ['-sS', '--fail', '--max-time', '150', '-X', 'POST', '-d', `data=${query}`, endpoint],
          { maxBuffer: 1024 * 1024 * 256 },
        );
        return JSON.parse(stdout);
      } catch (e) {
        console.error(`  [${endpoint}] 失敗: ${e.message.split('\n')[0]}`);
        lastErr = e;
      }
    }
  }
  throw lastErr;
}

// 地心からの距離の目安(km換算、比較専用の簡易ユークリッド距離でよい)
function roughDistKm(lon, lat, cLon, cLat) {
  const dLat = (lat - cLat) * 111.32;
  const dLon = (lon - cLon) * 111.32 * Math.cos((cLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

export async function convertArea(areaId, lon, lat, radiusKm = 15, maxBuildings = MAX_BUILDINGS) {
  const bbox = bboxAround(lon, lat, radiusKm);
  const query = `[out:json][timeout:120];(way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););out geom;`;
  const data = await fetchOverpass(query);

  const elements = Array.isArray(data?.elements) ? data.elements : [];
  const buildings = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 3) continue;
    const footprint = el.geometry.map((p) => [p.lon, p.lat]);
    const height = heightOf(el.tags || {});
    const cLon = footprint.reduce((s, p) => s + p[0], 0) / footprint.length;
    const cLat = footprint.reduce((s, p) => s + p[1], 0) / footprint.length;
    buildings.push({
      footprint: simplifyFootprint(footprint, MAX_VERTICES),
      height,
      _distKm: roughDistKm(cLon, cLat, lon, lat),
      _tileKey: tileKeyFor(cLon, cLat, lon, lat),
      _areaM2: footprintAreaM2(footprint, cLat),
    });
  }

  const limited = selectByTileQuota(buildings, maxBuildings, MIN_PER_TILE);

  return {
    source: 'osm',
    license: '© OpenStreetMap contributors (ODbL) https://www.openstreetmap.org/copyright',
    generatedAt: new Date().toISOString().slice(0, 10),
    buildings: limited,
  };
}

async function main() {
  const [areaId, lonStr, latStr, outPath, radiusStr, maxBuildingsStr] = process.argv.slice(2);
  if (!areaId || !lonStr || !latStr || !outPath) {
    console.error('使い方: node convert.mjs <areaId> <lon> <lat> <出力先.json> [半径km] [上限棟数]');
    process.exit(1);
  }
  const lon = Number(lonStr), lat = Number(latStr);
  const radiusKm = radiusStr ? Number(radiusStr) : 15;
  const maxBuildings = maxBuildingsStr ? Number(maxBuildingsStr) : MAX_BUILDINGS;
  console.log(`[${areaId}] Overpassへ問い合わせ中 (中心 ${lon},${lat} 半径${radiusKm}km 上限${maxBuildings}棟)...`);
  const result = await convertArea(areaId, lon, lat, radiusKm, maxBuildings);
  await writeFile(outPath, JSON.stringify(result));
  console.log(`[${areaId}] ${result.buildings.length}棟 → ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
