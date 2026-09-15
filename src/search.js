import { toChosung, isChosungQuery } from './util.js';

/**
 * 동 이름 / 단지 이름 통합 검색.
 * - "종암동", "성북구 종암", "서울 종암" 처럼 일부만 쳐도 찾는다.
 * - 초성만 쳐도 찾는다: "ㅈㅇㄷ" → 종암동
 */
export function buildSearch(dongIndex, store) {
  return function search(rawQuery, limit = 12) {
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    if (!query) return [];
    const chosungMode = isChosungQuery(query);
    const needle = chosungMode ? query.replace(/\s/g, '') : query.replace(/\s/g, '');
    const results = [];

    for (const dong of dongIndex.list) {
      const haystack = chosungMode ? dong.chosung : `${dong.sido}${dong.sgg}${dong.name}`;
      const at = haystack.indexOf(needle);
      if (at === -1) continue;
      // 동 이름 자체가 맞으면 우선, 앞쪽에서 맞을수록 우선.
      const nameHit = (chosungMode ? toChosung(dong.name) : dong.name).includes(needle);
      results.push({
        kind: 'dong',
        id: dong.code,
        dong,
        title: dong.name,
        subtitle: `${dong.sido.replace(/특별시|광역시|특별자치시|도$/, '')} ${dong.sgg}`,
        record: store.getDong(dong.code),
        score: (nameHit ? 0 : 100) + at,
      });
    }

    for (const cx of store.complexList) {
      const haystack = chosungMode ? toChosung(cx.name) : cx.name;
      const at = haystack.indexOf(needle);
      if (at === -1) continue;
      const dong = cx.dongCode ? dongIndex.get(cx.dongCode) : null;
      results.push({
        kind: 'complex',
        id: cx.id,
        complex: cx,
        title: cx.name,
        subtitle: dong ? `${dong.sgg} ${dong.name} · 단지` : '아파트 단지',
        record: cx,
        score: at - 50, // 내가 직접 기록한 단지를 위로
      });
    }

    results.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title, 'ko'));
    return results.slice(0, limit);
  };
}
