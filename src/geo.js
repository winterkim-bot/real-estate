/** 경위도 폴리곤 계산. 좌표는 모두 [경도, 위도] 순서(GeoJSON 규칙)를 따른다. */

/** bbox = [minX, minY, maxX, maxY] */
export function bboxContains(bbox, x, y) {
  return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
}

/** 링(닫힌 고리) 안에 점이 있는지 — ray casting. */
function pointInRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * MultiPolygon 좌표([[외곽링, 구멍링…], …]) 안에 점이 있는지.
 * 각 폴리곤의 첫 링은 외곽, 나머지는 구멍으로 본다.
 */
export function pointInPolygons(polys, x, y) {
  for (const poly of polys) {
    if (!pointInRing(poly[0], x, y)) continue;
    let inHole = false;
    for (let i = 1; i < poly.length; i++) {
      if (pointInRing(poly[i], x, y)) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return area / 2;
}

/** 가장 넓은 외곽 링의 무게중심. 라벨을 놓을 지점으로 쓴다. */
export function centroidOf(polys) {
  let best = null;
  let bestArea = -Infinity;
  for (const poly of polys) {
    const area = Math.abs(ringArea(poly[0]));
    if (area > bestArea) { bestArea = area; best = poly[0]; }
  }
  if (!best) return null;

  let twiceArea = 0, cx = 0, cy = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const [x0, y0] = best[j];
    const [x1, y1] = best[i];
    const cross = (x0 * y1) - (x1 * y0);
    twiceArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    // 면적이 거의 0인 경우(아주 가는 도형)엔 bbox 중심으로 대체한다.
    const xs = best.map((p) => p[0]);
    const ys = best.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  const factor = 1 / (3 * twiceArea);
  return [cx * factor, cy * factor];
}

/** GeoJSON 좌표([lng, lat])를 Leaflet 좌표([lat, lng])로 뒤집는다. */
export function toLatLngs(polys) {
  return polys.map((poly) => poly.map((ring) => ring.map(([x, y]) => [y, x])));
}

/** Leaflet용 bounds [[남, 서], [북, 동]] */
export function toLatLngBounds(bbox) {
  return [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
}

const EARTH_RADIUS_M = 6371000;

/** 두 좌표 사이 거리(m). 단지 중복 판정에 쓴다. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
