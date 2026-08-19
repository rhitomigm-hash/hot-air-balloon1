#!/usr/bin/env node
// PLATEAU(国土交通省, CC BY 4.0)のCityGMLから、フライトエリアの建物フットプリントを
// 統一スキーマJSONに変換する。PLATEAU整備済みエリア(佐久・渡良瀬)専用。
//
// 事前にG空間情報センター(geospatial.jp)からCityGML ZIPをダウンロードしておくこと。
// ZIPはリポジトリにコミットしない(サイズが大きいため.gitignore対象)。
//
// 使い方: node convert.mjs <CityGML ZIPパス> <中心lon> <中心lat> <出力先.json> [半径km(既定10)]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { simplifyFootprint } from '../osm-buildings-convert/simplify.mjs';
import { tileKeyFor, selectByTileQuota } from '../osm-buildings-convert/tile-quota.mjs';

const execFileAsync = promisify(execFile);
const MAX_BUILDINGS = 28000; // TILE_RADIUS 2→3拡張(面積約1.96倍)に合わせて増量
const MAX_VERTICES = 12;
const MIN_PER_TILE = 20;
const LICENSE = 'Project PLATEAU (国土交通省) Site Policy に拠る、複製・公衆送信等自由利用可 https://www.mlit.go.jp/plateau/site-policy/';

async function listBldgFiles(zipPath) {
  const { stdout } = await execFileAsync('unzip', ['-l', zipPath]);
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/).pop())
    .filter((name) => name && /udx\/bldg\/.*\.gml$/.test(name));
}

async function readEntry(zipPath, entryName) {
  const { stdout } = await execFileAsync('unzip', ['-p', zipPath, entryName], { maxBuffer: 1024 * 1024 * 64 });
  return stdout;
}

// ファイル先頭のgml:Envelopeだけを読んでメッシュの中心を得る(全文読み込み回避のため軽量なheadで済ませる)
async function meshCenter(zipPath, entryName) {
  const { stdout } = await execFileAsync('sh', [
    '-c',
    `unzip -p ${JSON.stringify(zipPath)} ${JSON.stringify(entryName)} | head -c 4000`,
  ]);
  const lower = stdout.match(/<gml:lowerCorner>([^<]+)<\/gml:lowerCorner>/);
  const upper = stdout.match(/<gml:upperCorner>([^<]+)<\/gml:upperCorner>/);
  if (!lower || !upper) return null;
  const [lat0, lon0] = lower[1].trim().split(/\s+/).map(Number);
  const [lat1, lon1] = upper[1].trim().split(/\s+/).map(Number);
  return { lat: (lat0 + lat1) / 2, lon: (lon0 + lon1) / 2 };
}

function roughDistKm(lon, lat, cLon, cLat) {
  const dLat = (lat - cLat) * 111.32;
  const dLon = (lon - cLon) * 111.32 * Math.cos((cLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

// posList("lat lon height lat lon height ...")を[[lon,lat],...]に変換(高さは捨てる)
export function parseFootprintPosList(posList) {
  const nums = posList.trim().split(/\s+/).map(Number);
  const pts = [];
  for (let i = 0; i + 2 < nums.length + 1; i += 3) {
    if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) pts.push([nums[i + 1], nums[i]]);
  }
  return pts;
}

// 1つのbldg:Building要素(の文字列)から高さとlod0FootPrintを抽出する
export function parseBuilding(xml) {
  const heightM = xml.match(/<bldg:measuredHeight[^>]*>([^<]+)<\/bldg:measuredHeight>/);
  const height = heightM ? Number(heightM[1]) : NaN;

  // lod0FootPrint(接地面)を優先し、無ければlod0RoofEdge(屋根輪郭。LOD1相当の
  // 箱型では接地面とほぼ同じ形になるため代用可)を使う
  const footM =
    xml.match(/<bldg:lod0FootPrint>[\s\S]*?<gml:posList[^>]*>([^<]+)<\/gml:posList>/) ||
    xml.match(/<bldg:lod0RoofEdge>[\s\S]*?<gml:posList[^>]*>([^<]+)<\/gml:posList>/);
  if (!footM) return null;
  const footprint = parseFootprintPosList(footM[1]);
  if (footprint.length < 3) return null;

  return { footprint, height: Number.isFinite(height) && height > 0 ? height : 6 };
}

function extractBuildings(gmlText, centerLon, centerLat, radiusKm) {
  const buildings = [];
  const re = /<bldg:Building [^>]*>[\s\S]*?<\/bldg:Building>/g;
  let m;
  while ((m = re.exec(gmlText))) {
    const b = parseBuilding(m[0]);
    if (!b) continue;
    const cLon = b.footprint.reduce((s, p) => s + p[0], 0) / b.footprint.length;
    const cLat = b.footprint.reduce((s, p) => s + p[1], 0) / b.footprint.length;
    const distKm = roughDistKm(cLon, cLat, centerLon, centerLat);
    if (distKm > radiusKm) continue;
    buildings.push({
      footprint: simplifyFootprint(b.footprint, MAX_VERTICES),
      height: b.height,
      _distKm: distKm,
      _tileKey: tileKeyFor(cLon, cLat, centerLon, centerLat),
    });
  }
  return buildings;
}

export async function convertZip(zipPath, centerLon, centerLat, radiusKm = 15) {
  const files = await listBldgFiles(zipPath);
  console.log(`  メッシュファイル${files.length}件から範囲内のものを判定中...`);

  const inRange = [];
  for (const f of files) {
    const c = await meshCenter(zipPath, f);
    if (c && roughDistKm(c.lon, c.lat, centerLon, centerLat) <= radiusKm * 1.5) inRange.push(f);
  }
  console.log(`  範囲内メッシュ: ${inRange.length}/${files.length}件`);

  let all = [];
  for (const f of inRange) {
    const gml = await readEntry(zipPath, f);
    all = all.concat(extractBuildings(gml, centerLon, centerLat, radiusKm));
  }

  const limited = selectByTileQuota(all, MAX_BUILDINGS, MIN_PER_TILE);

  return {
    source: 'plateau',
    license: LICENSE,
    generatedAt: new Date().toISOString().slice(0, 10),
    buildings: limited,
  };
}

async function main() {
  const [zipPath, lonStr, latStr, outPath, radiusStr] = process.argv.slice(2);
  if (!zipPath || !lonStr || !latStr || !outPath) {
    console.error('使い方: node convert.mjs <CityGML ZIPパス> <中心lon> <中心lat> <出力先.json> [半径km]');
    process.exit(1);
  }
  const lon = Number(lonStr), lat = Number(latStr);
  const radiusKm = radiusStr ? Number(radiusStr) : 15;
  console.log(`PLATEAU変換開始 (中心 ${lon},${lat} 半径${radiusKm}km)`);
  const result = await convertZip(zipPath, lon, lat, radiusKm);
  await writeFile(outPath, JSON.stringify(result));
  console.log(`${result.buildings.length}棟 → ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
