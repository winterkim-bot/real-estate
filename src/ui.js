import { STATUSES, statusColor, statusLabel } from './config.js';
import { el, $, $$, clear, debounce, relativeTime, downloadJSON } from './util.js';
import { buildSearch } from './search.js';
import { fetchApartments } from './overpass.js';
import { searchPlaces } from './geocode.js';

const ALL_STATUS_IDS = STATUSES.map((s) => s.id);

export class UI {
  constructor({ dongIndex, store, mapView }) {
    this.dongIndex = dongIndex;
    this.store = store;
    this.map = mapView;
    this.search = buildSearch(dongIndex, store);

    this.activeTab = 'dong';
    this.current = null;        // { kind:'dong'|'complex', … }
    this.moveTargetId = null;   // 단지 위치를 옮기는 중일 때의 단지 id
    this.visibleStatuses = new Set(
      store.setting('visibleStatuses', [...ALL_STATUS_IDS, 'none']),
    );

    this.nodes = {
      sidebar: $('#sidebar'),
      viewList: $('#view-list'),
      viewDetail: $('#view-detail'),
      listDong: $('#list-dong'),
      listComplex: $('#list-complex'),
      listStats: $('#list-stats'),
      filterBar: $('#filter-bar'),
      searchInput: $('#search-input'),
      searchResults: $('#search-results'),
      searchClear: $('#search-clear'),
      countDong: $('#count-dong'),
      countComplex: $('#count-complex'),
      legend: $('#legend'),
      hint: $('#hint'),
      toast: $('#toast'),
      backdrop: $('#sheet-backdrop'),
    };
  }

  init() {
    this.#buildFilterBar();
    this.#buildLegend();
    this.#bindChrome();
    this.#bindSearch();
    this.store.subscribe(() => this.refresh());
    this.refresh();
    this.showList();
  }

  // ─────────────────────────────────────────── 공통 UI

  toast(message, tone = 'info') {
    const node = this.nodes.toast;
    node.textContent = message;
    node.dataset.tone = tone;
    node.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
  }

  refresh() {
    this.#renderList();
    this.#renderStats();
    this.map.renderDongs();
    this.map.renderComplexes();
    if (this.current?.kind === 'dong') {
      const dong = this.dongIndex.get(this.current.code);
      if (dong) this.map.highlightDong(dong);
    }
  }

  #filterFn() {
    return (record) => {
      const status = record?.status ?? null;
      return this.visibleStatuses.has(status ?? 'none');
    };
  }

  #buildFilterBar() {
    const bar = clear(this.nodes.filterBar);
    const makeChip = (id, label, color) => {
      const active = this.visibleStatuses.has(id);
      return el('button.chip', {
        class: `chip${active ? ' is-on' : ''}`,
        style: `--c:${color}`,
        onclick: () => {
          if (this.visibleStatuses.has(id)) this.visibleStatuses.delete(id);
          else this.visibleStatuses.add(id);
          this.store.setSetting('visibleStatuses', [...this.visibleStatuses]);
          this.#buildFilterBar();
          this.map.setFilter(this.#filterFn());
          this.#renderList();
        },
      }, [el('i.chip-dot'), label]);
    };
    for (const status of STATUSES) bar.append(makeChip(status.id, status.label, status.color));
    this.map.setFilter(this.#filterFn());
  }

  #buildLegend() {
    const legend = clear(this.nodes.legend);
    legend.append(el('h3', { text: '색깔 = 공부 단계' }));
    for (const status of STATUSES) {
      legend.append(el('div.legend-row', {}, [
        el('i.legend-swatch', { style: `background:${status.color}` }),
        el('b', { text: status.label }),
        el('span', { text: status.desc }),
      ]));
    }
    legend.append(el('p.legend-note', {
      text: '기록은 이 브라우저에만 저장됩니다. 가끔 “내보내기”로 백업하세요.',
    }));
  }

  #bindChrome() {
    $('#btn-legend').addEventListener('click', () => {
      this.nodes.legend.hidden = !this.nodes.legend.hidden;
    });

    $('#btn-add-complex').addEventListener('click', () => this.toggleAddMode());

    $('#btn-help').addEventListener('click', () => $('#help-dialog').showModal());

    $('#btn-export').addEventListener('click', () => {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJSON(`임장노트-백업-${stamp}.json`, this.store.exportData());
      this.toast('백업 파일을 내려받았어요.');
    });

    const fileInput = $('#file-import');
    $('#btn-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const counts = this.store.importData(parsed, 'merge');
        this.toast(`동 ${counts.dongs}곳, 단지 ${counts.complexes}곳을 불러왔어요.`, 'good');
      } catch (err) {
        console.error(err);
        this.toast('불러오기에 실패했어요. JSON 파일이 맞는지 확인해 주세요.', 'bad');
      }
      fileInput.value = '';
    });

    for (const tab of $$('.tab')) {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        for (const other of $$('.tab')) other.classList.toggle('is-active', other === tab);
        this.nodes.listDong.hidden = this.activeTab !== 'dong';
        this.nodes.listComplex.hidden = this.activeTab !== 'complex';
        this.nodes.listStats.hidden = this.activeTab !== 'stats';
      });
    }

    const collapse = $('#btn-collapse');
    const expand = $('#btn-expand');
    collapse?.addEventListener('click', () => {
      document.body.classList.add('sidebar-collapsed');
      expand.hidden = false;
      this.map.invalidate();
    });
    expand?.addEventListener('click', () => {
      document.body.classList.remove('sidebar-collapsed');
      expand.hidden = true;
      this.map.invalidate();
    });

    this.nodes.backdrop.addEventListener('click', () => this.collapseSheet());

    $('#sheet-handle')?.addEventListener('click', () => {
      if (document.body.classList.contains('sheet-open')) this.collapseSheet();
      else this.expandSheet();
    });
  }

  toggleAddMode(force) {
    const next = force ?? !this.map.addMode;
    this.moveTargetId = next ? this.moveTargetId : null;
    this.map.setAddMode(next);
    $('#btn-add-complex').classList.toggle('is-on', next);
    this.nodes.hint.innerHTML = next
      ? (this.moveTargetId ? '단지를 옮길 위치를 지도에서 클릭하세요' : '지도에서 <b>아파트 단지 위치</b>를 클릭하세요')
      : '지도를 클릭하면 그 자리의 <b>동</b>이 선택돼요';
    this.nodes.hint.classList.toggle('is-active', next);
    if (next) this.collapseSheet();
  }

  /** 모바일에서 바텀시트를 내린다(지도를 보기 위해). */
  collapseSheet() {
    document.body.classList.remove('sheet-open');
    this.nodes.backdrop.hidden = true;
  }

  expandSheet() {
    if (!window.matchMedia('(max-width: 820px)').matches) return;
    document.body.classList.add('sheet-open');
    this.nodes.backdrop.hidden = false;
  }

  // ─────────────────────────────────────────── 검색

  #bindSearch() {
    const input = this.nodes.searchInput;
    const results = this.nodes.searchResults;

    this.placeState = { query: '', status: 'idle', items: [] };

    const run = debounce(() => {
      const query = input.value;
      this.nodes.searchClear.hidden = !query;
      if (!query.trim()) {
        results.hidden = true;
        this.placeState = { query: '', status: 'idle', items: [] };
        this.placeSearch?.cancel();
        return;
      }
      this.#renderSearchResults(query);
      this.placeSearch(query);
    }, 140);

    // 장소 검색은 남의 서버를 쓰므로 더 느긋하게, 그리고 이전 요청은 취소하며 보낸다.
    this.placeSearch = debounce(async (query) => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        this.placeState = { query: trimmed, status: 'idle', items: [] };
        this.#renderSearchResults(query);
        return;
      }
      this.placeAbort?.abort();
      this.placeAbort = new AbortController();
      this.placeState = { query: trimmed, status: 'loading', items: [] };
      this.#renderSearchResults(query);
      try {
        const items = await searchPlaces(trimmed, { signal: this.placeAbort.signal });
        if (input.value.trim() !== trimmed) return;   // 그 사이 다른 걸 쳤다면 버린다
        this.placeState = { query: trimmed, status: 'done', items };
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('장소 검색 실패', err);
        this.placeState = { query: trimmed, status: 'error', items: [] };
      }
      if (input.value.trim() === trimmed) this.#renderSearchResults(input.value);
    }, 550);

    input.addEventListener('input', run);
    input.addEventListener('focus', () => {
      this.expandSheet();
      if (input.value.trim()) run();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { input.value = ''; results.hidden = true; input.blur(); }
      if (ev.key === 'Enter') {
        const first = results.querySelector('.search-row');
        first?.click();
      }
    });
    this.nodes.searchClear.addEventListener('click', () => {
      input.value = '';
      this.nodes.searchClear.hidden = true;
      results.hidden = true;
      input.focus();
    });
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('.search-wrap')) results.hidden = true;
    });
  }

  #renderSearchResults(query) {
    const results = clear(this.nodes.searchResults);
    const hits = query.trim() ? this.search(query) : [];
    for (const hit of hits) results.append(this.#searchRow(hit));

    const place = this.placeState ?? { status: 'idle', items: [] };
    if (place.status !== 'idle') {
      results.append(el('li.search-section', {
        text: hits.length ? '지도에서 찾기 · OpenStreetMap' : '지도에서 찾기 · OpenStreetMap',
      }));
    }
    if (place.status === 'loading') {
      results.append(el('li.search-note', { text: '장소를 찾는 중…' }));
    } else if (place.status === 'error') {
      results.append(el('li.search-note', { text: '장소 검색에 연결하지 못했어요.' }));
    } else if (place.status === 'done') {
      if (place.items.length) {
        for (const item of place.items) results.append(this.#placeRow(item));
      } else {
        results.append(el('li.search-note', { text: '지도에서도 찾지 못했어요.' }));
      }
    }

    if (!results.childElementCount) {
      results.append(el('li.search-empty', { text: '검색 결과가 없어요' }));
    }
    results.hidden = false;
  }

  #searchRow(hit) {
    const color = hit.record?.status ? statusColor(hit.record.status) : 'transparent';
    return el('li.search-row', {
      role: 'option',
      onclick: () => {
        this.nodes.searchResults.hidden = true;
        this.nodes.searchInput.blur();
        if (hit.kind === 'dong') this.selectDong(hit.dong, { zoom: true });
        else this.selectComplex(hit.complex, { zoom: true });
      },
    }, [
      el('i.search-mark', { style: `background:${color}` }),
      el('div.search-text', {}, [
        el('b', { text: hit.title }),
        el('span', { text: hit.subtitle }),
      ]),
      hit.kind === 'complex' ? el('span.row-kind', { text: '단지' }) : null,
    ]);
  }

  #placeRow(place) {
    return el('li.search-row.place-row', {
      role: 'option',
      onclick: () => {
        this.nodes.searchResults.hidden = true;
        this.nodes.searchInput.blur();
        this.#goToPlace(place);
      },
    }, [
      el('i.search-mark.place-mark', { text: '📍' }),
      el('div.search-text', {}, [
        el('b', { text: place.name }),
        el('span', { text: place.detail || '지도에서 찾은 장소' }),
      ]),
    ]);
  }

  /** 장소로 이동해 그 자리의 동을 열고, 단지로 등록할 수 있게 제안한다. */
  #goToPlace(place) {
    const dong = this.dongIndex.findAt(place.lng, place.lat);
    this.map.panTo(place.lat, place.lng, 16);
    if (!dong) {
      this.toast(`${place.name} 위치로 이동했어요. (서울·경기·인천 밖이라 동 기록은 안 돼요)`);
      return;
    }
    this.pendingPlace = { ...place, dongCode: dong.code };
    this.selectDong(dong);
  }

  // ─────────────────────────────────────────── 선택 / 상세

  selectDong(dong, { zoom = false } = {}) {
    if (!dong) {
      this.toast('이 지점은 서울·경기·인천 밖이라 기록할 수 없어요.');
      return;
    }
    this.current = { kind: 'dong', code: dong.code };
    this.map.highlightComplex(null);
    this.map.highlightDong(dong, { zoom });
    this.#renderDongDetail(dong);
    this.expandSheet();
  }

  selectComplex(cx, { zoom = false } = {}) {
    this.current = { kind: 'complex', id: cx.id };
    this.map.highlightComplex(cx, { zoom });
    const dong = cx.dongCode ? this.dongIndex.get(cx.dongCode) : null;
    if (dong) this.map.highlightDong(dong);
    this.#renderComplexDetail(cx);
    this.expandSheet();
  }

  showList() {
    this.current = null;
    this.pendingPlace = null;
    this.map.clearSelection();
    this.nodes.viewDetail.hidden = true;
    this.nodes.viewList.hidden = false;
  }

  #showDetail(content) {
    const view = clear(this.nodes.viewDetail);
    view.append(content);
    view.hidden = false;
    this.nodes.viewList.hidden = true;
    view.scrollTop = 0;
  }

  #backButton(label) {
    return el('button.back-btn', {
      onclick: () => this.showList(),
    }, ['←', el('span', { text: label })]);
  }

  #statusPicker(current, onPick) {
    const row = el('div.status-picker');
    for (const status of STATUSES) {
      const on = current === status.id;
      row.append(el('button.status-chip', {
        class: `status-chip${on ? ' is-on' : ''}`,
        style: `--c:${status.color}`,
        onclick: () => onPick(on ? null : status.id),
        title: status.desc,
      }, [el('i.chip-dot'), status.label]));
    }
    return row;
  }

  #rating(value, onPick) {
    const row = el('div.rating', { role: 'group', 'aria-label': '관심도' });
    for (let i = 1; i <= 5; i += 1) {
      row.append(el('button.star', {
        class: `star${i <= value ? ' is-on' : ''}`,
        'aria-label': `${i}점`,
        onclick: () => onPick(i === value ? 0 : i),
      }, ['★']));
    }
    return row;
  }

  #field(label, control, hint) {
    return el('label.field', {}, [
      el('span.field-label', { text: label }),
      control,
      hint ? el('span.field-hint', { text: hint }) : null,
    ]);
  }

  // ── 동 상세 ──────────────────────────────────────────────

  #renderDongDetail(dong) {
    const record = this.store.getDong(dong.code) ?? {};
    const save = (patch) => {
      this.store.updateDong(dong.code, patch);
      this.#renderDongDetail(this.dongIndex.get(dong.code));
    };
    const saveQuiet = (patch) => this.store.updateDong(dong.code, patch);

    const noteBox = el('textarea.note-input', {
      rows: 7,
      placeholder: '무엇을 공부했나요?\n예) 지하철 6호선 월곡역 도보 8분 / 재개발 구역 3곳 / 학군은 …',
    });
    noteBox.value = record.note ?? '';
    const debouncedNote = debounce((value) => {
      saveQuiet({ note: value });
      this.#markSaved();
    }, 500);
    noteBox.addEventListener('input', () => debouncedNote(noteBox.value));
    noteBox.addEventListener('blur', () => debouncedNote.flush(noteBox.value));

    const tagInput = el('input.text-input', {
      type: 'text',
      placeholder: '재개발, 역세권, 학군 (쉼표로 구분)',
      value: (record.tags ?? []).join(', '),
    });
    tagInput.addEventListener('change', () => {
      saveQuiet({ tags: parseTags(tagInput.value) });
      this.#markSaved();
    });

    const visitInput = el('input.text-input', { type: 'date', value: record.visitedAt ?? '' });
    visitInput.addEventListener('change', () => save({ visitedAt: visitInput.value }));

    const complexes = this.store.complexesInDong(dong.code);

    const place = this.pendingPlace?.dongCode === dong.code ? this.pendingPlace : null;

    const body = el('div.detail', {}, [
      this.#backButton('내 기록 목록'),

      place ? el('div.place-callout', {}, [
        el('div.place-callout-text', {}, [
          el('b', { text: place.name }),
          el('span', { text: '지도에서 찾은 장소예요. 단지로 등록해 둘까요?' }),
        ]),
        el('button.mini-btn.is-primary', {
          onclick: () => {
            const cx = this.store.addComplex({
              name: place.name,
              lat: place.lat,
              lng: place.lng,
              dongCode: dong.code,
              status: 'interest',
            });
            this.pendingPlace = null;
            this.selectComplex(cx, { zoom: true });
            this.toast(`${cx.name}을(를) 단지로 추가했어요.`, 'good');
          },
        }, '단지로 추가'),
        el('button.icon-btn.place-dismiss', {
          'aria-label': '닫기',
          onclick: () => { this.pendingPlace = null; this.#renderDongDetail(dong); },
        }, '✕'),
      ]) : null,

      el('div.detail-head', {}, [
        el('span.detail-eyebrow', { text: `${dong.sido} ${dong.sgg}` }),
        el('h2.detail-title', { text: dong.name }),
        el('p.detail-sub', {
          text: record.updatedAt ? `마지막 기록 ${relativeTime(record.updatedAt)}` : '아직 기록이 없는 동이에요',
        }),
        el('span.saved-flag', { id: 'saved-flag', text: '저장됨' }),
      ]),

      this.#field('공부 단계', this.#statusPicker(record.status ?? null, (id) => save({ status: id }))),
      this.#field('관심도', this.#rating(record.rating ?? 0, (n) => save({ rating: n }))),
      this.#field('임장 다녀온 날', visitInput,
        record.status === 'visited' && !record.visitedAt ? '임장완료인데 날짜가 비어 있어요' : null),
      this.#field('태그', tagInput),
      this.#field('공부 메모', noteBox),

      el('section.sub-section', {}, [
        el('div.sub-head', {}, [
          el('h3', { text: `이 동의 단지 ${complexes.length}곳` }),
          el('div.sub-actions', {}, [
            el('button.mini-btn', {
              onclick: () => {
                this.moveTargetId = null;
                this.toggleAddMode(true);
                this.toast('지도에서 단지 위치를 클릭하세요.');
              },
            }, '+ 지도에서 찍기'),
            el('button.mini-btn', {
              id: 'btn-osm-import',
              onclick: (ev) => this.#importFromOSM(dong, ev.currentTarget),
            }, '주변 단지 불러오기'),
          ]),
        ]),
        el('div.cx-list', {}, complexes.length
          ? complexes.map((cx) => this.#complexRow(cx))
          : [el('p.empty-hint', { text: '아직 등록한 단지가 없어요.' })]),
        el('div.osm-result', { id: 'osm-result' }),
      ]),

      record.updatedAt ? el('button.danger-btn', {
        onclick: () => {
          if (!confirm(`${dong.name} 기록을 지울까요? (단지 기록은 남습니다)`)) return;
          this.store.removeDong(dong.code);
          this.toast('기록을 지웠어요.');
          this.showList();
        },
      }, '이 동 기록 지우기') : null,
    ]);

    this.#showDetail(body);
  }

  #markSaved() {
    const flag = $('#saved-flag');
    if (!flag) return;
    flag.classList.add('is-show');
    clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => flag.classList.remove('is-show'), 1200);
  }

  async #importFromOSM(dong, button) {
    const box = $('#osm-result');
    if (!box) return;
    button.disabled = true;
    button.textContent = '불러오는 중…';
    clear(box);
    try {
      const found = await fetchApartments(dong);
      const known = this.store.complexesInDong(dong.code).map((cx) => cx.name);
      const fresh = found.filter((item) => !known.includes(item.name));
      if (!fresh.length) {
        box.append(el('p.empty-hint', { text: 'OpenStreetMap에서 새로 찾은 단지가 없어요. 지도에서 직접 찍어 주세요.' }));
        return;
      }
      box.append(el('p.osm-title', { text: `${fresh.length}곳을 찾았어요. 추가할 단지를 고르세요.` }));
      const list = el('div.osm-list');
      for (const item of fresh) {
        list.append(el('button.osm-item', {
          onclick: (ev) => {
            const cx = this.store.addComplex({
              name: item.name,
              lat: item.lat,
              lng: item.lng,
              dongCode: dong.code,
              builtYear: item.builtYear,
              households: item.households,
              status: 'interest',
            });
            ev.currentTarget.classList.add('is-added');
            ev.currentTarget.disabled = true;
            this.toast(`${cx.name}을(를) 추가했어요.`, 'good');
          },
        }, [el('b', { text: item.name }), el('span', { text: '추가' })]));
      }
      box.append(list);
      box.append(el('p.osm-note', { text: '출처: OpenStreetMap. 모든 단지가 등록돼 있지는 않아요.' }));
    } catch (err) {
      console.error(err);
      box.append(el('p.empty-hint', {
        text: '단지 정보를 가져오지 못했어요. 잠시 뒤 다시 시도하거나 지도에서 직접 찍어 주세요.',
      }));
    } finally {
      button.disabled = false;
      button.textContent = '주변 단지 불러오기';
    }
  }

  // ── 단지 상세 ────────────────────────────────────────────

  #renderComplexDetail(cx) {
    const save = (patch) => {
      const next = this.store.updateComplex(cx.id, patch);
      if (next) this.#renderComplexDetail(next);
    };
    const saveQuiet = (patch) => this.store.updateComplex(cx.id, patch);
    const dong = cx.dongCode ? this.dongIndex.get(cx.dongCode) : null;

    const nameInput = el('input.title-input', { type: 'text', value: cx.name, placeholder: '단지 이름' });
    nameInput.addEventListener('change', () => {
      saveQuiet({ name: nameInput.value.trim() || '이름 없는 단지' });
      this.#markSaved();
    });

    const noteBox = el('textarea.note-input', {
      rows: 6,
      placeholder: '평형 / 시세 / 관리 상태 / 임장 때 본 것…',
    });
    noteBox.value = cx.note ?? '';
    const debouncedNote = debounce((value) => { saveQuiet({ note: value }); this.#markSaved(); }, 500);
    noteBox.addEventListener('input', () => debouncedNote(noteBox.value));
    noteBox.addEventListener('blur', () => debouncedNote.flush(noteBox.value));

    const builtInput = el('input.text-input', { type: 'text', inputmode: 'numeric', placeholder: '예) 2008', value: cx.builtYear ?? '' });
    builtInput.addEventListener('change', () => saveQuiet({ builtYear: builtInput.value.trim() }));

    const householdInput = el('input.text-input', { type: 'text', inputmode: 'numeric', placeholder: '예) 1,200', value: cx.households ?? '' });
    householdInput.addEventListener('change', () => saveQuiet({ households: householdInput.value.trim() }));

    const tagInput = el('input.text-input', { type: 'text', placeholder: '쉼표로 구분', value: (cx.tags ?? []).join(', ') });
    tagInput.addEventListener('change', () => { saveQuiet({ tags: parseTags(tagInput.value) }); this.#markSaved(); });

    const visitInput = el('input.text-input', { type: 'date', value: cx.visitedAt ?? '' });
    visitInput.addEventListener('change', () => save({ visitedAt: visitInput.value }));

    const body = el('div.detail', {}, [
      this.#backButton('내 기록 목록'),
      el('div.detail-head', {}, [
        el('span.detail-eyebrow', {
          text: dong ? `${dong.sgg} ${dong.name}` : '소속 동 없음',
          onclick: () => dong && this.selectDong(dong, { zoom: true }),
          class: dong ? 'detail-eyebrow is-link' : 'detail-eyebrow',
        }),
        nameInput,
        el('span.saved-flag', { id: 'saved-flag', text: '저장됨' }),
      ]),

      this.#field('공부 단계', this.#statusPicker(cx.status ?? null, (id) => save({ status: id }))),
      this.#field('관심도', this.#rating(cx.rating ?? 0, (n) => save({ rating: n }))),
      el('div.field-grid', {}, [
        this.#field('준공년도', builtInput),
        this.#field('세대수', householdInput),
      ]),
      this.#field('임장 다녀온 날', visitInput),
      this.#field('태그', tagInput),
      this.#field('메모', noteBox),

      el('div.detail-actions', {}, [
        el('button.mini-btn', {
          onclick: () => {
            this.moveTargetId = cx.id;
            this.toggleAddMode(true);
            this.toast('새 위치를 지도에서 클릭하세요.');
          },
        }, '위치 옮기기'),
        el('button.mini-btn', {
          onclick: () => this.map.panTo(cx.lat, cx.lng, 17),
        }, '지도에서 보기'),
      ]),

      el('button.danger-btn', {
        onclick: () => {
          if (!confirm(`${cx.name} 기록을 지울까요?`)) return;
          this.store.removeComplex(cx.id);
          this.toast('단지를 지웠어요.');
          this.showList();
        },
      }, '이 단지 지우기'),
    ]);

    this.#showDetail(body);
  }

  /** 지도 클릭으로 단지를 새로 찍거나, 기존 단지를 옮긴다. */
  handleComplexDrop({ lat, lng, dong }) {
    if (this.moveTargetId) {
      const moved = this.store.updateComplex(this.moveTargetId, { lat, lng, dongCode: dong?.code ?? null });
      this.moveTargetId = null;
      this.toggleAddMode(false);
      if (moved) { this.selectComplex(moved); this.toast('위치를 옮겼어요.', 'good'); }
      return;
    }
    if (!dong) {
      this.toast('서울·경기·인천 안에서 찍어 주세요.');
      return;
    }
    const cx = this.store.addComplex({
      name: `${dong.name} 단지`,
      lat,
      lng,
      dongCode: dong.code,
      status: 'interest',
    });
    this.toggleAddMode(false);
    this.selectComplex(cx);
    setTimeout(() => {
      const input = $('.title-input', this.nodes.viewDetail);
      input?.focus();
      input?.select();
    }, 60);
  }

  // ─────────────────────────────────────────── 목록 & 통계

  #renderList() {
    const pass = this.#filterFn();

    const dongRows = this.store.dongEntries
      .map(([code, record]) => ({ dong: this.dongIndex.get(code), record }))
      .filter((item) => item.dong && pass(item.record))
      .sort((a, b) => (b.record.updatedAt ?? 0) - (a.record.updatedAt ?? 0));

    const total = this.store.dongEntries.length;
    this.nodes.countDong.textContent = String(total);

    const dongPane = clear(this.nodes.listDong);
    if (!total) {
      dongPane.append(this.#emptyState(
        '아직 기록이 없어요',
        '지도에서 공부한 동네를 클릭해 첫 기록을 남겨 보세요.',
      ));
    } else if (!dongRows.length) {
      dongPane.append(this.#emptyState('필터에 걸리는 기록이 없어요', '위쪽 색깔 칩을 다시 켜 보세요.'));
    } else {
      for (const { dong, record } of dongRows) dongPane.append(this.#dongRow(dong, record));
    }

    const cxAll = this.store.complexList;
    const cxRows = cxAll
      .filter(pass)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    this.nodes.countComplex.textContent = String(cxAll.length);

    const cxPane = clear(this.nodes.listComplex);
    if (!cxAll.length) {
      cxPane.append(this.#emptyState(
        '등록한 단지가 없어요',
        '“단지 추가”를 누르고 지도를 클릭하거나, 동 상세에서 주변 단지를 불러오세요.',
      ));
    } else if (!cxRows.length) {
      cxPane.append(this.#emptyState('필터에 걸리는 단지가 없어요', '위쪽 색깔 칩을 다시 켜 보세요.'));
    } else {
      for (const cx of cxRows) cxPane.append(this.#complexRow(cx, true));
    }
  }

  #emptyState(title, body) {
    return el('div.empty-state', {}, [
      el('div.empty-emoji', { text: '🗺️' }),
      el('b', { text: title }),
      el('p', { text: body }),
    ]);
  }

  #dongRow(dong, record) {
    const color = statusColor(record.status);
    const cxCount = this.store.complexesInDong(dong.code).length;
    return el('button.row', {
      onclick: () => this.selectDong(dong, { zoom: true }),
    }, [
      el('i.row-bar', { style: `background:${color}` }),
      el('div.row-main', {}, [
        el('div.row-title', {}, [
          el('b', { text: dong.name }),
          el('span.row-sgg', { text: dong.sgg }),
        ]),
        el('div.row-meta', {}, [
          el('span.row-status', { style: `--c:${color}`, text: statusLabel(record.status) }),
          record.rating ? el('span.row-stars', { text: '★'.repeat(record.rating) }) : null,
          cxCount ? el('span.row-dim', { text: `단지 ${cxCount}` }) : null,
          el('span.row-dim', { text: relativeTime(record.updatedAt) }),
        ]),
        record.note ? el('p.row-note', { text: record.note }) : null,
        (record.tags ?? []).length
          ? el('div.row-tags', {}, record.tags.map((t) => el('span.tag', { text: `#${t}` })))
          : null,
      ]),
    ]);
  }

  #complexRow(cx, showDong = false) {
    const color = statusColor(cx.status);
    const dong = cx.dongCode ? this.dongIndex.get(cx.dongCode) : null;
    return el('button.row.row-cx', {
      onclick: () => this.selectComplex(cx, { zoom: true }),
    }, [
      el('i.row-bar', { style: `background:${color}` }),
      el('div.row-main', {}, [
        el('div.row-title', {}, [
          el('b', { text: cx.name }),
          showDong && dong ? el('span.row-sgg', { text: `${dong.sgg} ${dong.name}` }) : null,
        ]),
        el('div.row-meta', {}, [
          el('span.row-status', { style: `--c:${color}`, text: statusLabel(cx.status) }),
          cx.rating ? el('span.row-stars', { text: '★'.repeat(cx.rating) }) : null,
          cx.builtYear ? el('span.row-dim', { text: `${cx.builtYear}년` }) : null,
          cx.households ? el('span.row-dim', { text: `${cx.households}세대` }) : null,
        ]),
        cx.note ? el('p.row-note', { text: cx.note }) : null,
      ]),
    ]);
  }

  #renderStats() {
    const pane = clear(this.nodes.listStats);
    const dongs = this.store.dongEntries;
    const complexes = this.store.complexList;

    if (!dongs.length && !complexes.length) {
      pane.append(this.#emptyState('통계는 기록이 쌓이면 보여요', '동을 하나 클릭해서 시작해 보세요.'));
      return;
    }

    pane.append(el('div.stat-cards', {}, [
      el('div.stat-card', {}, [el('b', { text: String(dongs.length) }), el('span', { text: '공부한 동' })]),
      el('div.stat-card', {}, [el('b', { text: String(complexes.length) }), el('span', { text: '기록한 단지' })]),
      el('div.stat-card', {}, [
        el('b', { text: String(dongs.filter(([, r]) => r.status === 'visited').length) }),
        el('span', { text: '임장 다녀온 동' }),
      ]),
    ]));

    const counts = new Map(STATUSES.map((s) => [s.id, 0]));
    for (const [, record] of dongs) {
      if (counts.has(record.status)) counts.set(record.status, counts.get(record.status) + 1);
    }
    const max = Math.max(1, ...counts.values());
    pane.append(el('h3.stat-head', { text: '단계별 동 개수' }));
    for (const status of STATUSES) {
      const value = counts.get(status.id);
      pane.append(el('div.bar-row', {}, [
        el('span.bar-label', { text: status.label }),
        el('span.bar-track', {}, [
          el('i.bar-fill', { style: `width:${(value / max) * 100}%;background:${status.color}` }),
        ]),
        el('span.bar-value', { text: String(value) }),
      ]));
    }

    const bySgg = new Map();
    for (const [code] of dongs) {
      const dong = this.dongIndex.get(code);
      if (!dong) continue;
      bySgg.set(dong.sgg, (bySgg.get(dong.sgg) ?? 0) + 1);
    }
    const ranked = [...bySgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (ranked.length) {
      pane.append(el('h3.stat-head', { text: '많이 본 지역' }));
      const maxSgg = ranked[0][1];
      for (const [sgg, value] of ranked) {
        pane.append(el('div.bar-row', {}, [
          el('span.bar-label', { text: sgg }),
          el('span.bar-track', {}, [
            el('i.bar-fill', { style: `width:${(value / maxSgg) * 100}%;background:#64748b` }),
          ]),
          el('span.bar-value', { text: String(value) }),
        ]));
      }
    }
  }
}

function parseTags(text) {
  return text.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 12);
}
