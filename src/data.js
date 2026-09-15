import { DATA_FILES } from './config.js';
import { centroidOf, bboxContains, pointInPolygons } from './geo.js';
import { toChosung } from './util.js';

/**
 * 행정동 경계 데이터를 담는 저장소.
 * 1,100개가 넘는 폴리곤을 전부 그리면 느리기 때문에, 화면에는 기록이 있는 동만 그리고
 * 클릭 판정은 여기 있는 bbox → 폴리곤 2단계 검사로 처리한다.
 */
export class DongIndex {
  constructor() {
    this.list = [];              // 모든 동 (로드 순서)
    this.byCode = new Map();     // 코드 → 동
    this.loadedSido = new Set();
  }

  get size() { return this.list.length; }

  async load(onProgress) {
    let done = 0;
    for (const { file, sido } of DATA_FILES) {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`${sido} 경계 데이터를 불러오지 못했습니다 (${res.status})`);
      const payload = await res.json();
      this.#ingest(payload);
      this.loadedSido.add(sido);
      done += 1;
      onProgress?.(done / DATA_FILES.length, sido);
    }
    return this;
  }

  #ingest(payload) {
    for (const raw of payload.dongs) {
      const dong = {
        code: raw.c,
        name: raw.n,
        sgg: raw.s,
        sido: raw.d,
        bbox: raw.b,
        polys: raw.g,
        fullName: `${raw.d} ${raw.s} ${raw.n}`,
        shortName: `${raw.s} ${raw.n}`,
        center: centroidOf(raw.g),
      };
      dong.chosung = toChosung(`${raw.s}${raw.n}`);
      this.list.push(dong);
      this.byCode.set(dong.code, dong);
    }
  }

  get(code) { return this.byCode.get(code); }

  /** 좌표가 속한 동을 찾는다. 없으면 null (바다·데이터 밖 지역). */
  findAt(lng, lat) {
    const candidates = [];
    for (const dong of this.list) {
      if (bboxContains(dong.bbox, lng, lat)) candidates.push(dong);
    }
    for (const dong of candidates) {
      if (pointInPolygons(dong.polys, lng, lat)) return dong;
    }
    return null;
  }
}
