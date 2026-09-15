#!/usr/bin/env python3
"""행정동 경계 원본(vuski/admdongkor)을 웹앱용 경량 GeoJSON으로 변환한다.

사용법:
    python3 scripts/build_data.py [원본.geojson]

원본이 없으면 아래 URL에서 내려받는다.
출처: https://github.com/vuski/admdongkor (통계청 행정동 경계, ver20250401)
"""
import json
import os
import sys
import urllib.request

SRC_URL = ("https://raw.githubusercontent.com/vuski/admdongkor/master/"
           "ver20250401/HangJeongDong_ver20250401.geojson")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "data")

# 시도별 출력 파일. 서울과 그 생활권(경기·인천)만 담는다.
REGIONS = {
    "서울특별시": "dong-seoul.json",
    "경기도": "dong-gyeonggi.json",
    "인천광역시": "dong-incheon.json",
}

PRECISION = 5  # 소수점 5자리 ≈ 1m. 좌표를 같은 값으로 반올림하므로 인접 동 사이에 틈이 생기지 않는다.


def round_ring(ring):
    out = []
    for x, y in ring:
        pt = [round(x, PRECISION), round(y, PRECISION)]
        if not out or pt != out[-1]:
            out.append(pt)
    if len(out) < 4:
        return None
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def shrink_geometry(geom):
    """MultiPolygon/Polygon을 MultiPolygon 좌표 배열로 정규화하고 좌표를 줄인다."""
    coords = geom["coordinates"]
    if geom["type"] == "Polygon":
        coords = [coords]
    polys = []
    for poly in coords:
        rings = [r for r in (round_ring(ring) for ring in poly) if r]
        if rings:
            polys.append(rings)
    return polys


def bbox_of(polys):
    xs = [p[0] for poly in polys for ring in poly for p in ring]
    ys = [p[1] for poly in polys for ring in poly for p in ring]
    return [round(min(xs), PRECISION), round(min(ys), PRECISION),
            round(max(xs), PRECISION), round(max(ys), PRECISION)]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(OUT_DIR, "_source.geojson")
    if not os.path.exists(src):
        print(f"원본을 내려받는 중: {SRC_URL}")
        os.makedirs(os.path.dirname(src), exist_ok=True)
        urllib.request.urlretrieve(SRC_URL, src)

    print(f"읽는 중: {src}")
    with open(src, encoding="utf-8") as fp:
        raw = json.load(fp)

    buckets = {name: [] for name in REGIONS}
    for feat in raw["features"]:
        props = feat["properties"]
        sido = props.get("sidonm")
        if sido not in buckets:
            continue
        polys = shrink_geometry(feat["geometry"])
        if not polys:
            continue
        adm_nm = props["adm_nm"]                  # "서울특별시 성북구 종암동"
        parts = adm_nm.split(" ")
        buckets[sido].append({
            "c": props["adm_cd2"],                # 행정동 코드 (고유 ID)
            "n": parts[-1],                       # 동 이름
            "s": props["sggnm"],                  # 시군구
            "d": sido,                            # 시도
            "b": bbox_of(polys),                  # [minX, minY, maxX, maxY]
            "g": polys,                           # MultiPolygon 좌표
        })

    os.makedirs(OUT_DIR, exist_ok=True)
    for sido, filename in REGIONS.items():
        items = sorted(buckets[sido], key=lambda it: (it["s"], it["n"]))
        path = os.path.join(OUT_DIR, filename)
        with open(path, "w", encoding="utf-8") as fp:
            json.dump({"sido": sido, "dongs": items}, fp,
                      ensure_ascii=False, separators=(",", ":"))
        size = os.path.getsize(path) / 1_000_000
        print(f"  {filename}: {len(items)}개 동, {size:.2f} MB")


if __name__ == "__main__":
    main()
