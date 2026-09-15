/**
 * OpenStreetMap Overpass API에서 아파트 단지를 찾아온다.
 * 단지를 일일이 손으로 찍는 수고를 줄이기 위한 보조 기능이라, 실패해도 앱은 그대로 동작한다.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** dong.bbox = [minX, minY, maxX, maxY] → Overpass는 (남,서,북,동) 순서 */
function buildQuery(bbox) {
  const area = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
  return `[out:json][timeout:30];
(
  way["building"="apartments"]["name"](${area});
  relation["building"="apartments"]["name"](${area});
  way["landuse"="residential"]["name"](${area});
  relation["landuse"="residential"]["name"](${area});
  node["place"="neighbourhood"]["name"](${area});
);
out center tags;`;
}

export async function fetchApartments(dong, { signal } = {}) {
  const body = new URLSearchParams({ data: buildQuery(dong.bbox) });
  let lastError = null;

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: 'POST', body, signal });
      if (!res.ok) throw new Error(`Overpass 응답 오류 (${res.status})`);
      const json = await res.json();
      return normalize(json, dong);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastError = err;
    }
  }
  throw lastError ?? new Error('Overpass에 연결하지 못했습니다.');
}

function normalize(json, dong) {
  const seen = new Map();
  for (const element of json.elements ?? []) {
    const name = element.tags?.name;
    if (!name) continue;
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (lat == null || lng == null) continue;

    // 같은 이름이 여러 동(building)으로 쪼개져 있으면 하나로 합친다.
    const key = name;
    const prev = seen.get(key);
    if (prev) {
      prev.count += 1;
      prev.lat += (lat - prev.lat) / prev.count;
      prev.lng += (lng - prev.lng) / prev.count;
      continue;
    }
    seen.set(key, {
      name,
      lat,
      lng,
      count: 1,
      builtYear: element.tags['start_date']?.slice(0, 4) ?? '',
      households: element.tags['building:flats'] ?? '',
      dongCode: dong.code,
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
