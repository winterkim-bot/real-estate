import { store } from './store.js';
import { DongIndex } from './data.js';
import { MapView } from './mapview.js';
import { UI } from './ui.js';
import { $ } from './util.js';

async function main() {
  const loader = $('#loader');
  const loaderText = loader.querySelector('p');

  store.load();

  const dongIndex = new DongIndex();
  let ui = null;

  const mapView = new MapView('map', {
    dongIndex,
    store,
    onDongSelect: (dong) => ui?.selectDong(dong),
    onComplexSelect: (cx) => ui?.selectComplex(cx),
    onComplexDrop: (drop) => ui?.handleComplexDrop(drop),
  });

  // 마지막으로 보던 위치를 기억해 둔다.
  const saved = store.setting('mapView', null);
  if (saved) mapView.panTo(saved.lat, saved.lng, saved.zoom);
  mapView.map.on('moveend', () => {
    const center = mapView.map.getCenter();
    store.setSetting('mapView', { lat: center.lat, lng: center.lng, zoom: mapView.map.getZoom() });
  });

  try {
    await dongIndex.load((ratio, sido) => {
      loaderText.textContent = `경계 데이터 불러오는 중… ${sido} (${Math.round(ratio * 100)}%)`;
    });
  } catch (err) {
    console.error(err);
    loaderText.innerHTML = `경계 데이터를 불러오지 못했어요.<br>
      <small>파일을 더블클릭해서 연 경우라면, 폴더에서 <code>python3 -m http.server 8080</code> 을 실행한 뒤
      <code>http://localhost:8080</code> 으로 접속해 주세요.</small>`;
    loader.classList.add('is-error');
    return;
  }

  ui = new UI({ dongIndex, store, mapView });
  ui.init();

  trackKeyboardInset();

  $('#btn-locate')?.addEventListener('click', () => {
    mapView.locateMe((message) => ui.toast(message, 'bad'));
  });

  loader.hidden = true;

  if (!store.dongEntries.length && !store.complexList.length && !store.setting('seenHelp', false)) {
    $('#help-dialog').showModal();
    store.setSetting('seenHelp', true);
  }

  if (!store.available) {
    ui.toast('브라우저 저장소를 쓸 수 없어 기록이 유지되지 않을 수 있어요.', 'bad');
  }

  console.info(`행정동 ${dongIndex.size}곳을 불러왔습니다.`);
}

/**
 * 화면 아래쪽에서 키보드가 잡아먹는 높이를 --kb 로 알려 준다.
 * position:fixed 인 바텀시트는 키보드가 올라와도 그대로 화면 밑에 붙어 있어서,
 * 이 값만큼 위로 올려 주지 않으면 검색 결과가 키보드에 가린다.
 */
function trackKeyboardInset() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const sync = () => {
    const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(inset)}px`);
  };
  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  sync();
}

main().catch((err) => {
  console.error(err);
  const loader = $('#loader');
  if (loader) {
    loader.querySelector('p').textContent = '앱을 시작하지 못했어요. 새로고침해 주세요.';
    loader.classList.add('is-error');
  }
});
