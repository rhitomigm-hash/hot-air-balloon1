// OSMタグから建物の高さ(m)を決める。優先順位:
// 1. height タグ(実測値、単位mを想定。"12 m"のような表記も許容)
// 2. building:levels タグ × 3m/階
// 3. building タグの値に応じた既定値テーブル
// 4. 既定値6m
const LEVEL_HEIGHT_M = 3;
const DEFAULT_HEIGHT_M = 6;

const TYPE_DEFAULTS = {
  house: 6,
  detached: 6,
  semidetached_house: 6,
  terrace: 6,
  bungalow: 4,
  garage: 3,
  garages: 3,
  shed: 3,
  carport: 3,
  hut: 3,
  cabin: 3,
  greenhouse: 3,
  apartments: 15,
  residential: 9,
  commercial: 9,
  retail: 8,
  office: 12,
  industrial: 8,
  warehouse: 8,
  school: 9,
  hospital: 15,
  church: 12,
  cathedral: 20,
  chapel: 8,
  hotel: 15,
  farm: 6,
  farm_auxiliary: 5,
  barn: 6,
  stable: 5,
  parking: 3,
  civic: 9,
  public: 9,
};

function parseMeters(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function heightOf(tags) {
  const fromHeight = parseMeters(tags.height);
  if (fromHeight != null) return fromHeight;

  const levels = parseMeters(tags['building:levels']);
  if (levels != null) return levels * LEVEL_HEIGHT_M;

  const type = tags.building;
  if (type && TYPE_DEFAULTS[type] != null) return TYPE_DEFAULTS[type];

  return DEFAULT_HEIGHT_M;
}
