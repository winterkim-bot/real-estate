// 공부 단계별 상태 정의. 배열 순서가 곧 진행 순서이고, 리스트/범례 정렬에도 쓰인다.
export const STATUSES = [
  { id: 'interest',      label: '관심',     color: '#38bdf8', desc: '찜해둔 곳' },
  { id: 'studying',      label: '공부중',   color: '#f59e0b', desc: '자료 보는 중' },
  { id: 'studied',       label: '공부완료', color: '#22c55e', desc: '정리 끝' },
  { id: 'visit_planned', label: '임장예정', color: '#a855f7', desc: '날짜 잡음' },
  { id: 'visited',       label: '임장완료', color: '#e11d48', desc: '다녀옴' },
];

export const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
export const NEUTRAL_COLOR = '#94a3b8';

export function statusColor(id) {
  return STATUS_MAP[id]?.color ?? NEUTRAL_COLOR;
}

export function statusLabel(id) {
  return STATUS_MAP[id]?.label ?? '기록 없음';
}

// 불러올 경계 데이터. 서울을 먼저 그려야 첫 화면이 빨리 뜬다.
export const DATA_FILES = [
  { file: 'data/dong-seoul.json', sido: '서울특별시' },
  { file: 'data/dong-gyeonggi.json', sido: '경기도' },
  { file: 'data/dong-incheon.json', sido: '인천광역시' },
];

export const MAP_DEFAULTS = {
  center: [37.5665, 126.978],
  zoom: 11,
  minZoom: 8,
  maxZoom: 19,
};

export const STORAGE_KEY = 'imjang-note:v1';
