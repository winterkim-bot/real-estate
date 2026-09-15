import { MAP_DEFAULTS, statusColor } from './config.js';
import { toLatLngs, toLatLngBounds } from './geo.js';

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const STADIA_ATTR = '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> '
  + '&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> ' + OSM_ATTR;

// 레이어가 '보이는' 한계. 실제로 얼마나 확대할 수 있는지는 배경마다 nativeMax로 따로 정한다.
export const MAP_MAX_ZOOM = 20;

/**
 * 배경 지도 후보.
 *
 * retina 항목은 고해상도 화면을 어떻게 감당하는지를 뜻한다.
 *  - 'url'  : 제공처가 @2x 이미지를 준다 ({r} 자리에 붙는다). 가장 깨끗하다.
 *  - 'zoom' : @2x가 없으므로 한 단계 높은 줌의 타일을 절반 크기로 그려 밀도를 맞춘다.
 *
 * Stadia는 키를 넣거나 배포 도메인을 등록해야 보인다. 그래서 기본값은 키가 필요 없는
 * OpenStreetMap이고, 안 뜨면 자동으로 되돌린다.
 */
const BASE_LAYERS = [
  {
    name: '깔끔',
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png',
    attribution: STADIA_ATTR,
    nativeMax: 20,
    retina: 'url',
    provider: 'stadia',
  },
  {
    name: '선명',
    url: 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png',
    attribution: STADIA_ATTR,
    nativeMax: 20,
    retina: 'url',
    provider: 'stadia',
  },
  {
    name: '기본',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTR,
    nativeMax: 19,
    retina: 'zoom',
    provider: 'osm',
  },
  {
    name: '위성',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    nativeMax: 19,
    retina: 'zoom',
    provider: 'esri',
  },
];

const FALLBACK_LAYER = '기본';

/**
 * 고해상도 화면에서 또렷하게 나오도록 타일 옵션을 짠다.
 * maxZoom은 '레이어가 보이는 한계', maxNativeZoom은 '실제로 받아오는 타일의 한계'다.
 * 둘을 갈라 둬야 최대 배율에서 있지도 않은 타일을 부르거나 레이어가 통째로 사라지지 않는다.
 */
function tileOptions(cfg) {
  const base = { attribution: cfg.attribution, maxZoom: MAP_MAX_ZOOM };
  if (cfg.retina === 'url' || !L.Browser.retina) {
    return { ...base, maxNativeZoom: cfg.nativeMax };
  }
  return { ...base, maxNativeZoom: cfg.nativeMax - 1, zoomOffset: 1, tileSize: 128 };
}

function tileUrl(cfg, apiKey) {
  return cfg.provider === 'stadia' && apiKey
    ? `${cfg.url}?api_key=${encodeURIComponent(apiKey)}`
    : cfg.url;
}

const LABEL_MIN_ZOOM = 11;   // 이보다 멀리서 보면 동 이름표를 숨긴다
const CX_LABEL_MIN_ZOOM = 14;
const CX_HALO_RADIUS_M = 130;   // 단지 표시 반경 (실제 경계가 아니라 눈에 띄게 하려는 용도)

/** Leaflet 지도와 모든 레이어를 관리한다. UI 로직은 담지 않고 콜백으로 넘긴다. */
export class MapView {
  constructor(containerId, { dongIndex, store, onDongSelect, onComplexSelect, onComplexDrop, onTileProblem }) {
    this.dongIndex = dongIndex;
    this.store = store;
    this.onDongSelect = onDongSelect;
    this.onComplexSelect = onComplexSelect;
    this.onComplexDrop = onComplexDrop;
    this.onTileProblem = onTileProblem;

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
      maxZoom: MAP_MAX_ZOOM,
      zoomControl: false,
      preferCanvas: false,
    });

    this.#buildBaseLayers();
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

  /** 배경 지도 레이어를 만들고, 마지막에 고른 것을 기억해 둔다. */
  #buildBaseLayers() {
    const apiKey = this.store.setting('stadiaKey', '').trim();
    const layers = {};

    for (const cfg of BASE_LAYERS) {
      layers[cfg.name] = L.tileLayer(tileUrl(cfg, apiKey), tileOptions(cfg));
      layers[cfg.name].config = cfg;
    }

    // 저장된 선택이 유효하지 않으면 키 없이도 뜨는 쪽으로 돌아간다.
    let chosen = this.store.setting('baseLayer', FALLBACK_LAYER);
    if (!layers[chosen]) chosen = FALLBACK_LAYER;
    layers[chosen].addTo(this.map);
    this.#limitZoomTo(layers[chosen]);

    L.control.layers(layers, null, { position: 'topright' }).addTo(this.map);
    this.map.on('baselayerchange', (ev) => {
      this.store.setSetting('baseLayer', ev.name);
      this.#limitZoomTo(ev.layer);
    });

    this.#watchTileFailures(layers);
  }

  /**
   * 배경마다 타일이 있는 최대 줌이 다르다(OpenStreetMap·위성은 19, Stadia는 20).
   * 그 너머로 확대하면 없는 타일을 억지로 늘려 그려서 지도가 뭉개진다. 아예 막는다.
   */
  #limitZoomTo(layer) {
    const nativeMax = layer?.config?.nativeMax ?? MAP_MAX_ZOOM;
    if (this.map.getMaxZoom() !== nativeMax) this.map.setMaxZoom(nativeMax);
  }

  /**
   * Stadia는 키나 도메인 등록이 없으면 타일을 거절한다. 그럴 때 빈 지도를 보여주는 대신
   * 키 없이도 되는 배경으로 되돌리고 왜 그런지 알린다.
   */
  #watchTileFailures(layers) {
    const fallback = layers[FALLBACK_LAYER];
    for (const layer of Object.values(layers)) {
      if (layer.config.provider !== 'stadia') continue;
      let failures = 0;
      layer.on('tileerror', () => {
        failures += 1;
        if (failures < 4 || !this.map.hasLayer(layer)) return;
        failures = 0;
        this.map.removeLayer(layer);
        fallback.addTo(this.map);
        this.#limitZoomTo(fallback);
        this.store.setSetting('baseLayer', FALLBACK_LAYER);
        this.onTileProblem?.(layer.config.name);
      });
      layer.on('load', () => { failures = 0; });
    }
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
    for (const marker of this.complexMarkers.values()) {
      const element = marker.getElement?.();
      if (element) element.classList.toggle('hide-label', !showCx);
    }
  }

  // ── 단지 핀 ───────────────────────────────────────────────
  renderComplexes() {
    this.complexLayer.clearLayers();
    this.complexMarkers.clear();

    for (const cx of this.store.complexList) {
      if (!this.filter(cx)) continue;
      const color = statusColor(cx.status);
      const selected = cx.id === this.selectedComplexId;

      // 단지 주변을 옅게 칠해 지도에서 바로 눈에 띄게 한다.
      // 실제 단지 경계가 아니라 '이 근처'라는 표시다.
      L.circle([cx.lat, cx.lng], {
        radius: CX_HALO_RADIUS_M,
        color,
        weight: selected ? 2.5 : 1.5,
        opacity: 0.85,
        dashArray: selected ? null : '5 4',
        fillColor: color,
        fillOpacity: selected ? 0.28 : 0.18,
        interactive: false,
      }).addTo(this.complexLayer);

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
