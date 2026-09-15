/**
 * 장소 이름으로 좌표를 찾는다 (OpenStreetMap Nominatim).
 *
 * 행정동 경계 데이터에는 '은평뉴타운', '판교신도시' 같은 택지지구나 아파트 단지 이름이
 * 들어 있지 않다. 그런 이름으로도 지도를 찾아갈 수 있도록 붙인 보조 검색이다.
 * 실패하면 조용히 넘어가고, 동 이름 검색은 그대로 동작한다.
 */
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

// 서울·경기·인천을 감싸는 범위. Nominatim viewbox는 (좌,상,우,하) 순서다.
const VIEWBOX = '126.30,38.35,127.95,36.80';

export async function searchPlaces(query, { signal } = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '6',
    countrycodes: 'kr',
    viewbox: VIEWBOX,
    bounded: '1',
    'accept-language': 'ko',
  });

  const res = await fetch(`${ENDPOINT}?${params}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`장소 검색 실패 (${res.status})`);

  const json = await res.json();
  return json.map(toPlace).filter(Boolean);
}

function toPlace(item) {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const parts = String(item.display_name ?? '').split(',').map((p) => p.trim());
  const name = item.name?.trim() || parts[0] || '이름 없음';
  // "은평뉴타운, 진관동, 은평구, 서울특별시, …" → "진관동 · 은평구"
  const detail = parts.slice(1, 3).filter(Boolean).join(' · ');

  return { name, detail, lat, lng, kind: item.type ?? '' };
}
