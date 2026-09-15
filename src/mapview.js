import { MAP_DEFAULTS, statusColor } from './config.js';
import { toLatLngs, toLatLngBounds } from './geo.js';

const BASE_LAYERS = {
  '기본': {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19,
  },
  '심플': {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19,
  },
  '상세': {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
};

const LABEL_MIN_ZOOM = 11;   // 이보다 멀리서 보면 동 이름표를 숨긴다
const CX_LABEL_MIN_ZOOM = 14;

/** Leaflet 지도와 모든 레이어를 관리한다. UI 로직은 담지 않고 콜백으로 넘긴다. */
export class MapView {
  constructor(containerId, { dongIndex, store, onDongSelect, onComplexSelect, onComplexDrop }) {
    this.dongIndex = dongIndex;
    this.store = store;
    this.onDongSelect = onDongSelect;
    this.onComplexSelect = onComplexSelect;
    this.onComplexDrop = onComplexDrop;

    this.selectedDongCode = null;
    this.selectedComplexId = null;
    this.addMode = false;
    this.filter = () => true;
    this.hoverCode = null;
    this.complexMarkers = new Map();

    this.map = L.map(containerId, {
      center: MAP_DEFAULTS.center,
      zoom: MAP_DEFAULTS.zoom,
      minZoom: MAP_DEFAULTS.minZoom,
      maxZoom: MAP_DEFAULTS.maxZoom,
      zoomControl: false,
      preferCanvas: false,
    });

    const layers = {};
    Object.entries(BASE_LAYERS).forEach(([name, cfg], i) => {
      const layer = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom });
      layers[name] = layer;
      if (i === 0) layer.addTo(this.map);
    });
    L.control.layers(layers, null, { position: 'topright' }).addTo(this.map);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.map);

    // 아래에서 위 순서: 기록 폴리곤 → 선택 강조 → 이름표 → 단지 핀
    this.dongLayer = L.layerGroup().addTo(this.map);
    this.hoverLayer = L.layerGroup().addTo(this.map);
    this.selectionLayer = L.layerGroup().addTo(this.map);
    this.labelLayer = L.layerGroup().addTo(this.map);
    this.complexLayer = L.layerGroup().addTo(this.map);

    this.#bindEvents();
  }

  #bindEvents() {
    this.map.on('click', (ev) => {
      const { lat, lng } = ev.latlng;
      if (this.addMode) {
        const dong = this.dongIndex.findAt(lng, lat);
        this.onComplexDrop?.({ lat, lng, dong });
        return;
      }
      const dong = this.dongIndex.findAt(lng, lat);
      this.onDongSelect?.(dong, { fromMap: true });
    });

    // 마우스를 올린 동을 옅게 미리 보여준다 (터치 기기는 hover가 없으므로 생략).
    if (window.matchMedia('(hover: hover)').matches) {
      let queued = null;
      this.map.on('mousemove', (ev) => {
        queued = ev.latlng;
        if (this.rafId) return;
        this.rafId = requestAnimationFrame(() => {
          this.rafId = null;
          const { lat, lng } = queued;
          const dong = this.dongIndex.findAt(lng, lat);
          this.#setHover(dong);
        });
      });
      this.map.on('mouseout', () => this.#setHover(null));
    }

    this.map.on('zoomend moveend', () => {
      this.#syncLabelVisibility();
    });
  }

  #setHover(dong) {
    const code = dong?.code ?? null;
    if (code === this.hoverCode) return;
    this.hoverCode = code;
    this.hoverLayer.clearLayers();
    const container = this.map.getContainer();
    container.style.cursor = this.addMode ? 'crosshair' : (dong ? 'pointer' : '');
    if (!dong || dong.code === this.selectedDongCode) return;

    L.polygon(toLatLngs(dong.polys), {
      color: '#1d4ed8',
      weight: 1.5,
      opacity: 0.7,
      dashArray: '4 4',
      fill: true,
      fillColor: '#3b82f6',
      fillOpacity: 0.06,
      interactive: false,
    }).addTo(this.hoverLayer);
  }

  setFilter(fn) {
    this.filter = fn;
    this.renderDongs();
    this.renderComplexes();
  }

  setAddMode(on) {
    this.addMode = on;
    const container = this.map.getContainer();
    container.classList.toggle('adding-complex', on);
    container.style.cursor = on ? 'crosshair' : '';
  }

  // ── 동 폴리곤 ──────────────────────────────────────────────
  renderDongs() {
    this.dongLayer.clearLayers();
    this.labelLayer.clearLayers();

    for (const [code, record] of this.store.dongEntries) {
      const dong = this.dongIndex.get(code);
      if (!dong || !this.filter(record)) continue;
      const color = statusColor(record.status);

      L.polygon(toLatLngs(dong.polys), {
        color,
        weight: 2,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: 0.28,
        interactive: false,
      }).addTo(this.dongLayer);

      if (dong.center) {
        const marker = L.marker([dong.center[1], dong.center[0]], {
          icon: L.divIcon({
            className: 'dong-label-icon',
            html: `<span class="dong-label" style="--c:${color}">
                     <i class="dot"></i>${escapeText(dong.name)}
                   </span>`,
            iconSize: null,
          }),
          interactive: true,
          keyboard: false,
        });
        marker.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (this.addMode) {
            this.onComplexDrop?.({ lat: ev.latlng.lat, lng: ev.latlng.lng, dong });
            return;
          }
          this.onDongSelect?.(dong, { fromMap: true });
        });
        marker.dongCode = dong.code;
        marker.addTo(this.labelLayer);
      }
    }
    this.#syncLabelVisibility();
  }

  /**
   * 이름표가 서로 겹치면 뒤엣것을 숨긴다. 가까이 붙은 동이 많은 서울에서
   * 이게 없으면 글자가 뭉쳐서 읽을 수 없다. 선택한 동의 이름표는 항상 남긴다.
   */
  #syncLabelVisibility() {
    const show = this.map.getZoom() >= LABEL_MIN_ZOOM;
    const markers = [...this.labelLayer.getLayers()].sort((a, b) => (
      (b.dongCode === this.selectedDongCode ? 1 : 0) - (a.dongCode === this.selectedDongCode ? 1 : 0)
    ));
    const placed = [];

    for (const marker of markers) {
      const element = marker.getElement?.();
      if (!element) continue;
      if (!show) { element.style.display = 'none'; continue; }

      element.style.display = '';
      const point = this.map.latLngToContainerPoint(marker.getLatLng());
      const halfW = (element.offsetWidth || 70) / 2 + 3;
      const halfH = (element.offsetHeight || 22) / 2 + 3;
      const box = {
        x1: point.x - halfW, y1: point.y - halfH,
        x2: point.x + halfW, y2: point.y + halfH,
      };
      const overlaps = placed.some((r) => !(box.x2 < r.x1 || box.x1 > r.x2 || box.y2 < r.y1 || box.y1 > r.y2));
      if (overlaps) element.style.display = 'none';
      else placed.push(box);
    }

    const showCx = this.map.getZoom() >= CX_LABEL_MIN_ZOOM;
    this.complexLayer.eachLayer((layer) => {
      const element = layer.getElement?.();
      if (element) element.classList.toggle('hide-label', !showCx);
    });
  }

  // ── 단지 핀 ───────────────────────────────────────────────
  renderComplexes() {
    this.complexLayer.clearLayers();
    this.complexMarkers.clear();

    for (const cx of this.store.complexList) {
      if (!this.filter(cx)) continue;
      const color = statusColor(cx.status);
      const selected = cx.id === this.selectedComplexId;
      const marker = L.marker([cx.lat, cx.lng], {
        icon: L.divIcon({
          className: 'complex-icon',
          html: `<span class="cx-pin${selected ? ' is-selected' : ''}" style="--c:${color}">
                   <i class="cx-dot"></i><b class="cx-name">${escapeText(cx.name)}</b>
                 </span>`,
          iconSize: null,
        }),
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : 0,
      });
      marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        this.onComplexSelect?.(cx);
      });
      marker.addTo(this.complexLayer);
      this.complexMarkers.set(cx.id, marker);
    }
    this.#syncLabelVisibility();
  }

  // ── 선택 강조 ─────────────────────────────────────────────
  highlightDong(dong, { zoom = false } = {}) {
    this.selectionLayer.clearLayers();
    this.selectedDongCode = dong?.code ?? null;
    if (!dong) return;

    const record = this.store.getDong(dong.code);
    const color = record?.status ? statusColor(record.status) : '#1d4ed8';
    L.polygon(toLatLngs(dong.polys), {
      color,
      weight: 3.5,
      opacity: 1,
      fillColor: color,
      fillOpacity: record?.status ? 0.3 : 0.12,
      interactive: false,
      className: 'selected-dong',
    }).addTo(this.selectionLayer);

    this.#syncLabelVisibility();

    if (zoom) {
      // 모바일에선 아래쪽을 바텀시트가 가리므로 그만큼 여백을 준다.
      const sheet = window.matchMedia('(max-width: 820px)').matches
        ? Math.round(window.innerHeight * 0.45)
        : 40;
      this.map.fitBounds(toLatLngBounds(dong.bbox), {
        paddingTopLeft: [40, 60],
        paddingBottomRight: [40, sheet],
        maxZoom: 15,
      });
    }
  }

  highlightComplex(cx, { zoom = false } = {}) {
    this.selectedComplexId = cx?.id ?? null;
    this.renderComplexes();
    if (cx && zoom) {
      this.map.setView([cx.lat, cx.lng], Math.max(this.map.getZoom(), 16));
      if (window.matchMedia('(max-width: 820px)').matches) {
        this.map.panBy([0, -Math.round(window.innerHeight * 0.18)], { animate: false });
      }
    }
  }

  clearSelection() {
    this.selectionLayer.clearLayers();
    this.selectedDongCode = null;
    this.selectedComplexId = null;
    this.renderComplexes();
  }

  panTo(lat, lng, zoom) {
    this.map.setView([lat, lng], zoom ?? this.map.getZoom());
  }

  invalidate() {
    setTimeout(() => this.map.invalidateSize(), 220);
  }

  locateMe(onError) {
    if (!navigator.geolocation) { onError?.('이 브라우저는 위치 기능을 지원하지 않아요.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.map.setView([latitude, longitude], 16);
        if (this.meMarker) this.meMarker.remove();
        this.meMarker = L.circleMarker([latitude, longitude], {
          radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1,
        }).addTo(this.map);
      },
      () => onError?.('위치를 가져오지 못했어요. 브라우저 권한을 확인해 주세요.'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }
}

function escapeText(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
