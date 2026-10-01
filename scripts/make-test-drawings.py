"""Generate synthetic (fictional) Korean permit drawing sets for testing the
drawing-review pipeline. Every value is invented; ground truth is written to
tests/drawings/<case>.truth.json.

  python3 scripts/make-test-drawings.py
"""
import json
import math
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Polygon, Rectangle

# TrueType (not CFF) Korean font + Type 42 embedding so the PDF keeps a real
# text layer (ToUnicode), like CAD-exported permit drawings. apt: fonts-nanum
FONT = "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"
for f in (FONT, FONT.replace(".ttf", "Bold.ttf")):
    font_manager.fontManager.addfont(f)
plt.rcParams["font.family"] = font_manager.FontProperties(fname=FONT).get_name()
plt.rcParams["pdf.fonttype"] = 42
plt.rcParams["axes.unicode_minus"] = False

OUT = os.path.join(os.path.dirname(__file__), "..", "tests", "drawings")
os.makedirs(OUT, exist_ok=True)
W, H = 420 / 25.4, 297 / 25.4  # A3 landscape in inches

CASES = {
    "case-a-compliant": dict(
        label="적합 예시", site=330.00, footprint=196.20,
        floors=[("지하1층", 120.00, "기계실·창고"), ("1층", 196.20, "제2종 근린생활시설(사무소)"), ("2층", 190.50, "제2종 근린생활시설(사무소)"),
                ("3층", 190.50, "제2종 근린생활시설(사무소)"), ("4층", 165.00, "제2종 근린생활시설(사무소)")],
        height=14.2, north_low=1.5, north_high=8.0, parking=5, landscape=25.00, frontage=15.0, road=6.0,
    ),
    "case-b-violations": dict(
        label="위반 포함 예시", site=330.00, footprint=205.00,
        floors=[("지하1층", 120.00, "기계실·창고"), ("1층", 205.00, "제2종 근린생활시설(사무소)"), ("2층", 205.00, "제2종 근린생활시설(사무소)"),
                ("3층", 205.00, "제2종 근린생활시설(사무소)"), ("4층", 205.00, "제2종 근린생활시설(사무소)")],
        height=14.2, north_low=1.5, north_high=6.0, parking=3, landscape=12.00, frontage=1.8, road=6.0,
    ),
}

PROJECT = "가상동 근린생활시설 신축공사 (시험용 가상 도면)"
ADDRESS = "경기도 용인시 수지구 가상동 123-4"
ZONE = "제2종일반주거지역"
OFFICE = "가상건축사사무소 (시험용)"


def frame(fig, sheet_no, sheet_name, scale="NONE"):
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 420); ax.set_ylim(0, 297); ax.axis("off")
    ax.add_patch(Rectangle((10, 10), 400, 277, fill=False, lw=1.2))
    # title block (bottom-right)
    x0, y0, w, h = 300, 10, 110, 52
    ax.add_patch(Rectangle((x0, y0), w, h, fill=False, lw=1))
    rows = [("공 사 명", PROJECT), ("설 계 자", OFFICE), ("도 면 명", sheet_name), ("도면번호", sheet_no), ("축    척", scale), ("일    자", "2026. 09.")]
    for i, (k, v) in enumerate(rows):
        yy = y0 + h - (i + 1) * (h / len(rows))
        ax.plot([x0, x0 + w], [yy, yy], lw=0.5, color="k")
        ax.text(x0 + 2, yy + 2.6, k, fontsize=7)
        ax.text(x0 + 22, yy + 2.6, v, fontsize=7 if len(v) < 34 else 5.6)
    ax.plot([x0 + 20, x0 + 20], [y0, y0 + h], lw=0.5, color="k")
    ax.add_patch(Rectangle((x0 + 86, y0 + 54), 22, 22, fill=False, lw=0.8, ls="--"))
    ax.text(x0 + 97, y0 + 65, "건축사\n(인)", fontsize=6, ha="center", va="center")
    ax.text(20, 280, "※ 본 도면은 소프트웨어 시험용으로 만든 가상 도면이며 실제 건축물이 아님", fontsize=7, color="#a00")
    return ax


def table(ax, x, y, col_w, rows, row_h=8.2, fs=8.5, header=None):
    n_rows = len(rows) + (1 if header else 0)
    total_w = sum(col_w)
    ax.add_patch(Rectangle((x, y - n_rows * row_h), total_w, n_rows * row_h, fill=False, lw=1))
    all_rows = ([header] if header else []) + rows
    for r, row in enumerate(all_rows):
        yy = y - (r + 1) * row_h
        ax.plot([x, x + total_w], [yy, yy], lw=0.4, color="k")
        cx = x
        for c, cell in enumerate(row):
            ax.text(cx + 2, yy + row_h * 0.32, str(cell), fontsize=fs, weight="bold" if (header and r == 0) else "normal")
            cx += col_w[c]
            if c < len(row) - 1:
                ax.plot([cx, cx], [yy, yy + row_h], lw=0.4, color="k")


def truth_of(c):
    above = sum(a for n, a, _ in c["floors"] if not n.startswith("지하"))
    total = sum(a for _, a, _ in c["floors"])
    return dict(
        대지위치=ADDRESS, 용도지역=ZONE, 주용도="제2종 근린생활시설(사무소)",
        대지면적=c["site"], 건축면적=c["footprint"], 연면적=round(total, 2), 용적률산정용연면적=round(above, 2),
        건폐율=round(c["footprint"] / c["site"] * 100, 2), 용적률=round(above / c["site"] * 100, 2),
        지상층수=4, 지하층수=1, 높이=c["height"], 정북이격_10m이하=c["north_low"], 정북이격_10m초과=c["north_high"],
        주차대수=c["parking"], 조경면적=c["landscape"], 접도길이=c["frontage"], 전면도로폭=c["road"],
    )


def sheet_summary(pdf, c, t):
    fig = plt.figure(figsize=(W, H))
    ax = frame(fig, "A-001", "건축개요 및 도면목록")
    ax.text(20, 262, "건 축 개 요", fontsize=16, weight="bold")
    rows = [
        ("공사명", PROJECT), ("대지위치", ADDRESS), ("지역·지구", f"{ZONE}, 가로구역별 최고높이 미지정"),
        ("주용도", "제2종 근린생활시설(사무소)"), ("대지면적", f"{c['site']:,.2f} ㎡"),
        ("건축면적", f"{c['footprint']:,.2f} ㎡"), ("건폐율", f"{t['건폐율']:.2f} %  (법정 60% 이하)"),
        ("연면적", f"{t['연면적']:,.2f} ㎡  (지하 {c['floors'][0][1]:,.2f} ㎡ / 지상 {t['용적률산정용연면적']:,.2f} ㎡)"),
        ("용적률 산정용 연면적", f"{t['용적률산정용연면적']:,.2f} ㎡"), ("용적률", f"{t['용적률']:.2f} %  (법정 240% 이하)"),
        ("규모", "지하 1층, 지상 4층"), ("최고높이", f"{c['height']:.1f} m"), ("구조", "철근콘크리트조"),
        ("주차대수", f"{c['parking']} 대 (1층 필로티 자주식)"), ("조경면적", f"{c['landscape']:,.2f} ㎡"),
        ("전면도로", f"남측 {c['road']:.1f} m 도로, 접도길이 {c['frontage']:.1f} m"),
        ("정북방향 이격", f"높이 10m 이하 부분 {c['north_low']:.1f} m / 10m 초과 부분 {c['north_high']:.1f} m"),
    ]
    table(ax, 20, 254, [52, 190], rows, row_h=11.4, fs=9.5, header=("구 분", "내 용"))
    ax.text(285, 262, "도 면 목 록", fontsize=12, weight="bold")
    table(ax, 285, 254, [30, 70], [("A-001", "건축개요 및 도면목록"), ("A-002", "면적표"), ("A-101", "배치도"), ("A-201", "입면도")], header=("도면번호", "도면명"))
    pdf.savefig(fig); plt.close(fig)


def sheet_areas(pdf, c, t):
    fig = plt.figure(figsize=(W, H))
    ax = frame(fig, "A-002", "면적표")
    ax.text(20, 262, "층 별 면 적 표", fontsize=16, weight="bold")
    rows = [(n, u, f"{a:,.2f}", "제외" if n.startswith("지하") else "산입") for n, a, u in c["floors"]]
    rows.append(("합계", "", f"{t['연면적']:,.2f}", f"{t['용적률산정용연면적']:,.2f}"))
    table(ax, 20, 250, [36, 110, 46, 60], rows, row_h=12, fs=10, header=("층", "용도", "바닥면적(㎡)", "용적률 산정"))
    pdf.savefig(fig); plt.close(fig)


def sheet_site(pdf, c, t):
    fig = plt.figure(figsize=(W, H))
    ax = frame(fig, "A-101", "배치도", "1/100")
    s = 9.0  # mm per m on paper
    ox, oy = 70, 70
    lot_w, lot_d = 22.0, 15.0  # 330 m²
    ax.add_patch(Polygon([(ox, oy), (ox + lot_w * s, oy), (ox + lot_w * s, oy + lot_d * s), (ox, oy + lot_d * s)], closed=True, fill=False, lw=1.6, ls="-."))
    ax.text(ox + lot_w * s / 2, oy + lot_d * s + 6, f"대지경계선 (대지면적 {c['site']:,.2f}㎡)", ha="center", fontsize=8)
    # road (south)
    ax.add_patch(Rectangle((ox - 25, oy - c["road"] * s), lot_w * s + 50, c["road"] * s, color="#ddd"))
    ax.text(ox + lot_w * s / 2, oy - c["road"] * s / 2, f"{c['road']:.1f} m 도로", ha="center", va="center", fontsize=10)
    # frontage marker
    fx0 = ox + (lot_w - c["frontage"]) / 2 * s
    ax.plot([fx0, fx0 + c["frontage"] * s], [oy - 2, oy - 2], lw=3, color="#06c")
    ax.text(fx0 + c["frontage"] * s / 2, oy - 6, f"접도길이 {c['frontage']:.1f} m", ha="center", fontsize=8, color="#06c")
    # building
    bw = c["footprint"] / 13.0
    bx, by = ox + 1.0 * s, oy + lot_d * s - c["north_low"] * s - 13.0 * s
    ax.add_patch(Rectangle((bx, by), bw * s, 13.0 * s, fill=True, color="#f2e6c9", ec="k", lw=1.2))
    ax.text(bx + bw * s / 2, by + 9.0 * s, f"계획 건축물\n건축면적 {c['footprint']:,.2f}㎡\n지상4층 / 지하1층", ha="center", va="center", fontsize=9)
    # north setback dimension
    top = oy + lot_d * s
    ax.annotate("", xy=(bx + bw * s + 6, top), xytext=(bx + bw * s + 6, by + 13.0 * s), arrowprops=dict(arrowstyle="<->", lw=0.8))
    ax.text(bx + bw * s + 8, top - c["north_low"] * s / 2, f"정북 이격 {c['north_low']:.1f} m\n(높이 10m 이하)", fontsize=7, va="center")
    ax.text(bx + 2, by + 13.0 * s + 2, f"※ 높이 10m 초과 부분 정북 이격 {c['north_high']:.1f} m (단면도 참조)", fontsize=7)
    # landscape + parking
    lx, ly = ox + lot_w * s - 4.6 * s, oy + 0.4 * s
    ax.add_patch(Rectangle((lx, ly), 4.0 * s, c["landscape"] / 4.0 * s, hatch="xx", fill=False, color="#2a7"))
    ax.text(lx + 2 * s, ly + c["landscape"] / 8.0 * s, f"조경\n{c['landscape']:,.2f}㎡", ha="center", va="center", fontsize=8, color="#174")
    for i in range(c["parking"]):
        px = bx + 0.4 * s + i * 2.5 * s
        ax.add_patch(Rectangle((px, by + 0.4 * s), 2.3 * s, 5.0 * s, fill=False, lw=0.8, ls="--"))
        ax.text(px + 1.15 * s, by + 3 * s, f"P{i + 1}", ha="center", fontsize=7)
    ax.text(bx + 0.4 * s, by + 5.8 * s, "1층 필로티 하부 주차", fontsize=7)
    ax.text(30, 22, f"주차 계획: 1층 필로티 자주식 {c['parking']}대 (2.3m×5.0m)", fontsize=9)
    # north arrow
    ax.annotate("N", xy=(380, 250), xytext=(380, 228), ha="center", fontsize=12, arrowprops=dict(arrowstyle="-|>", lw=1.5))
    pdf.savefig(fig); plt.close(fig)


def sheet_elevation(pdf, c, t):
    fig = plt.figure(figsize=(W, H))
    ax = frame(fig, "A-201", "입면도", "1/100")
    s = 9.0
    ox, oy = 80, 70
    ax.plot([ox - 30, ox + 200], [oy, oy], lw=1.5)
    ax.text(ox - 30, oy - 6, "G.L ±0", fontsize=8)
    levels = [0, 4.2, 7.5, 10.8, c["height"] - 0.2]
    for i in range(4):
        ax.add_patch(Rectangle((ox, oy + levels[i] * s), 150, (levels[i + 1] - levels[i]) * s, fill=False, lw=1))
        ax.text(ox + 75, oy + (levels[i] + levels[i + 1]) / 2 * s, f"{i + 1}층", ha="center", va="center", fontsize=9)
    ax.add_patch(Rectangle((ox, oy + levels[4] * s), 150, 0.2 * s, fill=True, color="#999"))
    ax.annotate("", xy=(ox + 165, oy), xytext=(ox + 165, oy + c["height"] * s), arrowprops=dict(arrowstyle="<->", lw=0.8))
    ax.text(ox + 168, oy + c["height"] * s / 2, f"최고높이 {c['height']:.1f} m", fontsize=9, va="center")
    ax.text(ox, oy + c["height"] * s + 8, "정 면 도 (남측)", fontsize=11, weight="bold")
    pdf.savefig(fig); plt.close(fig)


for key, c in CASES.items():
    t = truth_of(c)
    path = os.path.join(OUT, f"{key}.pdf")
    with PdfPages(path) as pdf:
        sheet_summary(pdf, c, t); sheet_areas(pdf, c, t); sheet_site(pdf, c, t); sheet_elevation(pdf, c, t)
    with open(os.path.join(OUT, f"{key}.truth.json"), "w", encoding="utf-8") as f:
        json.dump({"label": c["label"], "region": "경기도 용인시", "facts": t}, f, ensure_ascii=False, indent=1)
    print(path, os.path.getsize(path), t)
