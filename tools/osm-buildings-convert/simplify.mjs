// footprintの頂点数がmaxVerticesを超える場合、Douglas-Peuckerで間引く。
// OSMの建物は始点=終点で閉じていることが多いので、末尾の重複点はここで落としておく。
function dedupeClosingPoint(points) {
  if (points.length < 2) return points;
  const [x0, y0] = points[0];
  const [xn, yn] = points[points.length - 1];
  if (x0 === xn && y0 === yn) return points.slice(0, -1);
  return points;
}

function perpendicularDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points;
  let maxDist = -1, idx = 0;
  const [first, last] = [points[0], points[points.length - 1]];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], first, last);
    if (d > maxDist) { maxDist = d; idx = i; }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = douglasPeucker(points.slice(0, idx + 1), epsilon);
  const right = douglasPeucker(points.slice(idx), epsilon);
  return [...left.slice(0, -1), ...right];
}

// 頂点数がmaxVertices以下になるまでepsilonを段階的に広げる
export function simplifyFootprint(points, maxVertices) {
  const closed = dedupeClosingPoint(points);
  if (closed.length <= maxVertices) return closed;

  let epsilon = 1e-6;
  let simplified = closed;
  for (let i = 0; i < 20 && simplified.length > maxVertices; i++) {
    simplified = douglasPeucker(closed, epsilon);
    epsilon *= 2;
  }
  // それでも超える場合は均等間引きで強制的に収める
  if (simplified.length > maxVertices) {
    const step = simplified.length / maxVertices;
    const out = [];
    for (let i = 0; i < maxVertices; i++) out.push(simplified[Math.floor(i * step)]);
    simplified = out;
  }
  return simplified;
}
