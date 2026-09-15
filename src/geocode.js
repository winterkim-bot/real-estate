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
    // 상점 이름에 지구명이 섞여 들어오므로 넉넉히 받아서 걸러낸다.
    limit: '25',
    addressdetails: '1',
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
  const all = json.map(toPlace).filter(Boolean);

  // 동네·단지처럼 '장소'인 것만 남긴다. 다 걸러지면 원본 순서대로 조금만 보여준다.
  const places = all.filter(isPlaceLike);
  return (places.length ? places : all).slice(0, 6);
}

// 지역·주거지 성격의 결과만 통과시킨다.
const PLACE_CATEGORIES = new Set(['place', 'landuse', 'boundary', 'building', 'residential']);
const PLACE_TYPES = new Set([
  'neighbourhood', 'suburb', 'quarter', 'city_block', 'residential', 'apartments',
  'town', 'village', 'hamlet', 'allotments', 'construction', 'house', 'yes',
]);
// 가게·식당·학원 같은 건 지구 이름을 달고 있어도 뺀다.
const SHOP_CATEGORIES = new Set([
  'shop', 'amenity', 'office', 'craft', 'tourism', 'healthcare', 'leisure',
  'highway', 'railway', 'man_made', 'emergency', 'club',
]);

function isPlaceLike(place) {
  if (SHOP_CATEGORIES.has(place.category)) return false;
  return PLACE_CATEGORIES.has(place.category) || PLACE_TYPES.has(place.kind);
}

function toPlace(item) {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const parts = String(item.display_name ?? '').split(',').map((p) => p.trim());
  const name = item.name?.trim() || parts[0] || '이름 없음';

  // display_name 앞머리는 "19, 진관2로"처럼 번지수라 쓸모가 없다. 주소 항목에서 직접 뽑는다.
  const address = item.address ?? {};
  const region = address.borough || address.city_district || address.county
    || address.city || address.province || address.state || '';
  const local = address.suburb || address.neighbourhood || address.quarter
    || address.town || address.village || '';
  const detail = [region, local].filter(Boolean).join(' · ')
    || parts.slice(1, 3).filter(Boolean).join(' · ');

  return {
    name,
    detail,
    lat,
    lng,
    kind: item.type ?? '',
    category: item.category ?? item.class ?? '',
  };
}
