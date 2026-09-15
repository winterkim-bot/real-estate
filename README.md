# 임장노트 — 서울·수도권 부동산 공부 지도

공부한 동네를 지도에 칠하고, 메모를 남기고, 임장까지 다녀오면 색을 바꿔 가며
"내가 어디까지 봤는지"를 한눈에 확인하는 웹앱입니다.

## 무엇을 할 수 있나

- **지도 클릭 → 동 선택**: 네이버 지도에서 동 이름을 친 것처럼, 클릭한 자리의 행정동 경계가 그려집니다.
- **이름 검색**: `종암동`, `성북구 종암`, 초성 `ㅈㅇㄷ` 모두 찾습니다.
  `은평뉴타운`처럼 행정동이 아닌 곳은 **지도에서 찾기**(OpenStreetMap)에 나오고, 누르면
  그 자리로 이동해 단지로 등록할 수 있습니다.
- **5단계 색깔 표시**: 관심 → 공부중 → 공부완료 → 임장예정 → 임장완료. 단계마다 지도 색이 달라집니다.
- **메모·태그·관심도·임장 날짜**: 동마다, 단지마다 따로 기록합니다.
- **아파트 단지 단위 기록**: 지도를 찍어 단지를 추가하거나, 동 상세에서 *주변 단지 불러오기*로
  OpenStreetMap에 등록된 단지를 한 번에 가져옵니다. 단지를 등록하면 그 동도 '관심'으로 함께
  표시돼서, 지도만 봐도 어느 동네를 보고 있는지 드러납니다.
- **필터 · 통계**: 단계별로 지도를 걸러 보고, 구별로 얼마나 봤는지 확인합니다.
- **모바일 대응**: 임장 현장에서 쓸 수 있게 바텀시트 + 내 위치 버튼을 넣었습니다.

대상 지역은 **서울 426개 · 경기 601개 · 인천 156개 행정동**(총 1,183개)입니다.

## 배포 (Vercel)

빌드가 없는 정적 사이트라 따로 설정할 게 없습니다. `vercel.json`에 프레임워크 없음과
캐시 헤더가 이미 잡혀 있습니다.

1. <https://vercel.com/new> 접속 → GitHub 계정 연결
2. **Import Git Repository**에서 `winterkim-bot/real-estate` 선택
3. **Framework Preset**은 `Other`, **Build Command**는 비워 둔 채로 **Deploy**

1~2분 뒤 `https://<프로젝트이름>.vercel.app` 주소가 나옵니다.
이후 이 브랜치에 푸시하면 자동으로 다시 배포됩니다.

명령줄로 하려면 저장소를 받은 뒤:

```bash
npx vercel --prod
```

> 전체 용량이 3MB 남짓이라 무료(Hobby) 플랜으로 충분합니다.

<details>
<summary>GitHub Pages로 올리는 방법</summary>

저장소 Settings → Pages → **Deploy from a branch** → 이 브랜치의 `/ (root)`를 지정합니다.
루트의 `.nojekyll`은 이때 필요합니다 — 이게 없으면 Jekyll 빌드가 `vendor/` 아래 파일을
빼먹어 지도 라이브러리를 못 읽습니다.

</details>

## 고칠 때 (로컬)

경계 데이터를 `fetch`로 읽기 때문에 파일을 더블클릭해서 여는 방식(`file://`)으로는
동작하지 않습니다. 간단한 로컬 서버를 띄워 주세요.

```bash
python3 -m http.server 8080   # → http://localhost:8080
```

> 지도 배경 타일을 OpenStreetMap에서 받아오므로 인터넷 연결이 필요합니다.
> 지도 라이브러리(Leaflet)와 경계 데이터는 저장소 안에 들어 있습니다.

## 기록은 어디에 저장되나

브라우저의 **localStorage**에만 저장됩니다. 서버로 아무것도 보내지 않습니다.
그래서 두 가지를 기억해 두세요.

- 브라우저 데이터를 지우면 기록도 사라집니다.
- 다른 기기(폰 ↔ 노트북)와는 자동으로 공유되지 않습니다.

사이드바 아래 **내보내기**로 JSON 백업을 받고, 다른 기기에서 **불러오기**로 합칠 수 있습니다.
같은 동이 양쪽에 있으면 더 최근에 고친 쪽이 남습니다.

## 구조

```
index.html              화면 뼈대
assets/styles.css       스타일 (라이트/다크, 모바일 바텀시트)
src/
  app.js                시작점 — 데이터 로드 후 지도·UI 연결
  config.js             공부 단계 정의, 지도 기본값
  data.js               행정동 경계 색인 (좌표 → 동 찾기)
  geo.js                점-다각형 판정, 무게중심 등 기하 계산
  mapview.js            Leaflet 지도 · 폴리곤 · 이름표 · 단지 핀
  ui.js                 사이드바, 상세 패널, 검색, 필터, 통계
  search.js             동/단지 통합 검색 (초성 지원)
  store.js              localStorage 기록 저장소
  overpass.js           OpenStreetMap 단지 조회 (선택 기능)
  geocode.js            장소 이름 검색 (Nominatim, 선택 기능)
  util.js               DOM·한글·포맷 도우미
data/dong-*.json        서울·경기·인천 행정동 경계 (총 2.7MB)
vercel.json             정적 배포 설정 (캐시 헤더)
scripts/build_data.py   경계 데이터 재생성
scripts/check-syntax.mjs 모듈 문법 검사
vendor/                 Leaflet 1.9.4 (BSD-2-Clause)
```

### 고해상도 화면

타일 제공처가 @2x 이미지를 주지 않아도 또렷하게 보이도록, 고해상도 화면에서는
**한 단계 높은 줌의 타일을 절반 크기로** 그립니다(`src/mapview.js`의 `tileOptions`).
같은 영역을 두 배 밀도로 채우는 방식이라 키가 필요한 타일 서버로 갈아타지 않아도 됩니다.
대신 타일 요청 수는 네 배가 됩니다.

### 성능에 대한 메모

행정동 1,183개를 전부 그리면 지도가 버벅입니다. 그래서 화면에는 **기록이 있는 동과
선택한 동만** 그리고, 클릭 지점이 어느 동인지는 bbox로 후보를 추린 뒤
점-다각형 판정(`src/geo.js`)으로 찾습니다.

## 경계 데이터 다시 만들기

행정동 경계는 바뀔 때가 있습니다. 새 버전이 나오면:

```bash
python3 scripts/build_data.py           # 원본을 받아 data/dong-*.json 을 다시 생성
```

`scripts/build_data.py` 안의 `SRC_URL`에서 버전을 바꿀 수 있습니다.
좌표는 소수점 5자리(약 1m)로 반올림합니다. 인접한 동이 같은 값으로 반올림되므로
경계 사이에 틈이 생기지 않습니다.

## 데이터 출처

- 행정동 경계: [vuski/admdongkor](https://github.com/vuski/admdongkor) (통계청 행정동 경계, 2025-04-01 기준)
- 지도 배경: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors / 위성 영상 Esri, Maxar, Earthstar Geographics
- 아파트 단지 조회: [Overpass API](https://overpass-api.de/) / OpenStreetMap
- 장소 이름 검색: [Nominatim](https://nominatim.openstreetmap.org/) / OpenStreetMap
- 지도 라이브러리: [Leaflet](https://leafletjs.com/) 1.9.4

## 알아 둘 점

- 행정동 경계 데이터에는 '은평뉴타운' 같은 택지지구나 단지 이름이 없습니다. 그래서 그런 이름은
  Nominatim으로 좌표를 찾은 뒤 단지 핀으로 기록하는 방식입니다. 이때 같은 이름을 단 가게·식당은
  걸러내고 동네·주거지 성격의 결과만 보여 줍니다.
- 경계는 **법정동이 아니라 행정동** 기준입니다. 예를 들어 법정동 '종암동'과 행정동 '종암동'의
  범위가 정확히 같지는 않을 수 있습니다.
- *주변 단지 불러오기*는 OpenStreetMap에 등록된 단지만 찾습니다. 빠진 단지는 지도를 직접 찍어
  추가하세요.
- 단지 핀 둘레의 옅은 원(반경 130m)은 지도에서 눈에 띄라고 그린 표시이고, 실제 단지 경계가
  아닙니다. 단지 경계 데이터는 공개된 것이 마땅치 않습니다.
