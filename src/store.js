import { STORAGE_KEY } from './config.js';
import { uid } from './util.js';

const EMPTY = () => ({ version: 1, dongs: {}, complexes: {}, settings: {} });

/**
 * 공부 기록 저장소. 브라우저 localStorage 하나만 쓰고, 바뀔 때마다 구독자에게 알린다.
 * 서버가 없으므로 내보내기/불러오기(JSON)가 유일한 백업 수단이다.
 */
class Store {
  constructor() {
    this.data = EMPTY();
    this.listeners = new Set();
    this.available = true;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.data = this.#normalize(JSON.parse(raw));
    } catch (err) {
      console.warn('저장된 기록을 읽지 못했습니다.', err);
      this.available = false;
    }
    return this;
  }

  #normalize(parsed) {
    const base = EMPTY();
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      version: 1,
      dongs: parsed.dongs && typeof parsed.dongs === 'object' ? parsed.dongs : {},
      complexes: parsed.complexes && typeof parsed.complexes === 'object' ? parsed.complexes : {},
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
    };
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.available = true;
    } catch (err) {
      console.warn('기록을 저장하지 못했습니다.', err);
      this.available = false;
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit(change) {
    this.save();
    for (const fn of this.listeners) fn(change);
  }

  // ── 동 기록 ────────────────────────────────────────────────
  getDong(code) { return this.data.dongs[code] ?? null; }
  get dongEntries() { return Object.entries(this.data.dongs); }
  hasDong(code) { return Boolean(this.data.dongs[code]); }

  updateDong(code, patch) {
    const now = Date.now();
    const prev = this.data.dongs[code] ?? { createdAt: now, status: null, rating: 0, note: '', tags: [] };
    const next = { ...prev, ...patch, updatedAt: now };
    if (isBlankRecord(next)) {
      delete this.data.dongs[code];
      this.#emit({ type: 'dong', code, removed: true });
      return null;
    }
    this.data.dongs[code] = next;
    this.#emit({ type: 'dong', code });
    return next;
  }

  removeDong(code) {
    if (!this.data.dongs[code]) return;
    delete this.data.dongs[code];
    this.#emit({ type: 'dong', code, removed: true });
  }

  // ── 아파트 단지 ────────────────────────────────────────────
  get complexList() { return Object.values(this.data.complexes); }
  getComplex(id) { return this.data.complexes[id] ?? null; }

  addComplex(fields) {
    const now = Date.now();
    const id = uid('cx');
    this.data.complexes[id] = {
      id,
      name: '이름 없는 단지',
      lat: 0,
      lng: 0,
      dongCode: null,
      status: 'interest',
      rating: 0,
      note: '',
      tags: [],
      households: '',
      builtYear: '',
      visitedAt: '',
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
    this.#emit({ type: 'complex', id });
    return this.data.complexes[id];
  }

  updateComplex(id, patch) {
    const prev = this.data.complexes[id];
    if (!prev) return null;
    this.data.complexes[id] = { ...prev, ...patch, updatedAt: Date.now() };
    this.#emit({ type: 'complex', id });
    return this.data.complexes[id];
  }

  removeComplex(id) {
    if (!this.data.complexes[id]) return;
    delete this.data.complexes[id];
    this.#emit({ type: 'complex', id, removed: true });
  }

  complexesInDong(code) {
    return this.complexList.filter((cx) => cx.dongCode === code);
  }

  // ── 환경설정 ──────────────────────────────────────────────
  setting(key, fallback) {
    return this.data.settings[key] ?? fallback;
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.save();
  }

  // ── 백업 ──────────────────────────────────────────────────
  exportData() {
    return { ...this.data, exportedAt: new Date().toISOString(), app: 'imjang-note' };
  }

  /** mode: 'merge'(기본) | 'replace' */
  importData(parsed, mode = 'merge') {
    const incoming = this.#normalize(parsed);
    const counts = { dongs: 0, complexes: 0 };

    if (mode === 'replace') {
      this.data = incoming;
      counts.dongs = Object.keys(incoming.dongs).length;
      counts.complexes = Object.keys(incoming.complexes).length;
    } else {
      for (const [code, record] of Object.entries(incoming.dongs)) {
        const mine = this.data.dongs[code];
        // 같은 동이 양쪽에 있으면 더 최근에 고친 쪽을 남긴다.
        if (!mine || (record.updatedAt ?? 0) > (mine.updatedAt ?? 0)) {
          this.data.dongs[code] = record;
          counts.dongs += 1;
        }
      }
      for (const [id, cx] of Object.entries(incoming.complexes)) {
        const mine = this.data.complexes[id];
        if (!mine || (cx.updatedAt ?? 0) > (mine.updatedAt ?? 0)) {
          this.data.complexes[id] = { ...cx, id };
          counts.complexes += 1;
        }
      }
    }
    this.#emit({ type: 'import' });
    return counts;
  }

  clearAll() {
    this.data = EMPTY();
    this.#emit({ type: 'reset' });
  }
}

/** 상태·메모·별점·태그·임장일이 모두 비었으면 기록을 지운 것으로 본다. */
function isBlankRecord(record) {
  return !record.status
    && !record.note?.trim()
    && !record.rating
    && !(record.tags?.length)
    && !record.visitedAt;
}

export const store = new Store();
