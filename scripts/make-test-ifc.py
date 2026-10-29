#!/usr/bin/env python3
"""
Sample IFC models for the BIM code review (/bim).

  A  가상 근린생활시설 — 3층, 법규 기준을 모두 만족하도록 설계
  B  가상 공동주택     — 5층, 피난·계단·복도·채광·일조 등 위반을 일부러 넣음

Written the way Revit 2025 exports IFC4 so the reader is exercised realistically:
length unit millimetre, Site → Building → Storey placement chain, IfcSpace with
Name = 실 번호 and LongName = 실 이름, IfcStair aggregating IfcStairFlight/landing/railing,
openings filled by doors and windows, Pset_*Common, and the BuildLex_KR property set
(see lib/bim/convention.ts and public/bim/README.md).

Run:  python3 scripts/make-test-ifc.py   (needs: pip install ifcopenshell)
  C  가상 고층 공동주택 — 지하 3층·지상 12층, 시공 단계 탭 시연용 (굴착·개구부·세대수)

Out:  public/bim/sample-a-compliant.ifc, public/bim/sample-b-violations.ifc, public/bim/demo-3-highrise.ifc
      tests/bim/*.truth.json  (hand-computed expected values for tests/bim.test.ts)
"""
import json
import math
import os
import sys

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.guid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MM = 1000.0  # model length unit is millimetre; all coordinates below are metres


class Model:
    def __init__(self, name, description):
        api = ifcopenshell.api
        self.f = f = api.run("project.create_file", version="IFC4")
        self.project = api.run("root.create_entity", f, ifc_class="IfcProject", name=name)
        self.project.Description = description
        mm = api.run("unit.add_si_unit", f, unit_type="LENGTHUNIT", prefix="MILLI")
        m2 = api.run("unit.add_si_unit", f, unit_type="AREAUNIT")
        m3 = api.run("unit.add_si_unit", f, unit_type="VOLUMEUNIT")
        api.run("unit.assign_unit", f, units=[mm, m2, m3])
        self.model_ctx = api.run("context.add_context", f, context_type="Model")
        self.model_ctx.TrueNorth = f.createIfcDirection((0.0, 1.0))
        self.body = api.run("context.add_context", f, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=self.model_ctx)
        self.plan_ctx = api.run("context.add_context", f, context_type="Plan")
        self.footprint = api.run("context.add_context", f, context_type="Plan", context_identifier="FootPrint", target_view="PLAN_VIEW", parent=self.plan_ctx)
        self.storeys = {}
        self.axes = {}

    # ── primitives ────────────────────────────────────────────────────────────
    def pt3(self, x, y, z):
        return self.f.createIfcCartesianPoint((x * MM, y * MM, z * MM))

    def pt2(self, x, y):
        return self.f.createIfcCartesianPoint((x * MM, y * MM))

    def axis(self, origin=(0, 0, 0), z=(0.0, 0.0, 1.0), x=(1.0, 0.0, 0.0)):
        f = self.f
        return f.createIfcAxis2Placement3D(self.pt3(*origin), f.createIfcDirection(z), f.createIfcDirection(x))

    def placement(self, rel_to, origin):
        return self.f.createIfcLocalPlacement(rel_to, self.axis(origin))

    def polyline(self, pts):
        pts = list(pts) + [pts[0]]
        return self.f.createIfcPolyline([self.pt2(x, y) for x, y in pts])

    def extrude(self, pts, z0, dz, holes=()):
        """Polygon (metres, element-local XY) extruded up from z0 by dz."""
        f = self.f
        if holes:
            prof = f.createIfcArbitraryProfileDefWithVoids("AREA", None, self.polyline(pts), [self.polyline(h) for h in holes])
        else:
            prof = f.createIfcArbitraryClosedProfileDef("AREA", None, self.polyline(pts))
        return f.createIfcExtrudedAreaSolid(prof, self.axis((0, 0, z0)), f.createIfcDirection((0.0, 0.0, 1.0)), dz * MM)

    def shape(self, items, rep_type="SweptSolid"):
        f = self.f
        rep = f.createIfcShapeRepresentation(self.body, "Body", rep_type, items)
        return f.createIfcProductDefinitionShape(None, None, [rep])

    def entity(self, ifc_class, name, storey=None, origin=(0, 0, 0), predefined=None, rel_to=None):
        e = ifcopenshell.api.run("root.create_entity", self.f, ifc_class=ifc_class, name=name, predefined_type=predefined)
        parent = rel_to if rel_to is not None else (storey.ObjectPlacement if storey is not None else None)
        e.ObjectPlacement = self.placement(parent, origin)
        if storey is not None:
            if ifc_class == "IfcSpace":  # spaces decompose the storey (IfcRelAggregates), as Revit writes them
                ifcopenshell.api.run("aggregate.assign_object", self.f, products=[e], relating_object=storey)
            else:
                ifcopenshell.api.run("spatial.assign_container", self.f, products=[e], relating_structure=storey)
        return e

    def pset(self, product, name, props):
        """props: {name: (IfcType, value)} — explicit measure types, as Revit writes them."""
        f = self.f
        vals = [f.createIfcPropertySingleValue(k, None, f.create_entity(t, v), None) for k, (t, v) in props.items()]
        ps = f.createIfcPropertySet(ifcopenshell.guid.new(), None, name, None, vals)
        f.createIfcRelDefinesByProperties(ifcopenshell.guid.new(), None, None, None, [product], ps)
        return ps

    def kr(self, product, **props):
        """BuildLex_KR property set. Lengths in model units (mm) like Revit; areas in ㎡."""
        types = {
            "대지면적": "IfcAreaMeasure", "전면도로폭": "IfcLengthMeasure", "접도길이": "IfcLengthMeasure",
            "세대수": "IfcCountMeasure", "유효폭": "IfcLengthMeasure",
        }
        out = {}
        for k, v in props.items():
            if isinstance(v, bool):
                out[k] = ("IfcBoolean", v)
            elif k in types:
                t = types[k]
                out[k] = (t, int(v) if t == "IfcCountMeasure" else float(v) * (MM if t == "IfcLengthMeasure" else 1))
            else:
                out[k] = ("IfcLabel", str(v))
        return self.pset(product, "BuildLex_KR", out)

    # ── spatial structure ─────────────────────────────────────────────────────
    def site(self, name, boundary, **kr):
        api = ifcopenshell.api
        s = api.run("root.create_entity", self.f, ifc_class="IfcSite", name=name)
        s.ObjectPlacement = self.placement(None, (0, 0, 0))
        fp = self.f.createIfcShapeRepresentation(self.footprint, "FootPrint", "Curve2D", [self.polyline(boundary)])
        s.Representation = self.f.createIfcProductDefinitionShape(None, None, [fp])
        api.run("aggregate.assign_object", self.f, products=[s], relating_object=self.project)
        self.site_e = s
        self.kr(s, **kr)
        return s

    def building(self, name, **kr):
        api = ifcopenshell.api
        b = api.run("root.create_entity", self.f, ifc_class="IfcBuilding", name=name)
        b.ObjectPlacement = self.placement(self.site_e.ObjectPlacement, (0, 0, 0))
        api.run("aggregate.assign_object", self.f, products=[b], relating_object=self.site_e)
        self.building_e = b
        self.kr(b, **kr)
        return b

    def storey(self, name, elev):
        api = ifcopenshell.api
        s = api.run("root.create_entity", self.f, ifc_class="IfcBuildingStorey", name=name)
        s.ObjectPlacement = self.placement(self.building_e.ObjectPlacement, (0, 0, elev))
        s.Elevation = elev * MM
        api.run("aggregate.assign_object", self.f, products=[s], relating_object=self.building_e)
        self.storeys[name] = s
        return s

    # ── building elements (coordinates are building XY; z relative to storey) ──
    def wall(self, st, p0, p1, t, h, external=False, name=None, z0=0.0):
        (x0, y0), (x1, y1) = p0, p1
        L = math.hypot(x1 - x0, y1 - y0)
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        nx, ny = -uy * t / 2, ux * t / 2
        pts = [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)]
        w = self.entity("IfcWall", name or ("외벽" if external else "내벽"), st, predefined="STANDARD")
        w.Representation = self.shape([self.extrude(pts, z0, h)])
        self.pset(w, "Pset_WallCommon", {"IsExternal": ("IfcBoolean", external), "LoadBearing": ("IfcBoolean", external)})
        self.axes[w.id()] = (p0, p1, t)
        return w

    def opening(self, st, wall, a0, a1, z0, z1):
        """Void in `wall` between axis distances a0..a1 (metres from p0) and storey heights z0..z1."""
        (x0, y0), (x1, y1), t = self.axes[wall.id()]
        L = math.hypot(x1 - x0, y1 - y0)
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        nx, ny = -uy, ux
        e = t / 2 + 0.05
        corners = [(x0 + ux * a + nx * s, y0 + uy * a + ny * s) for a, s in ((a0, -e), (a1, -e), (a1, e), (a0, e))]
        o = self.entity("IfcOpeningElement", "개구부", None, rel_to=st.ObjectPlacement, predefined="OPENING")
        o.Representation = self.shape([self.extrude(corners, z0, z1 - z0)])
        self.f.createIfcRelVoidsElement(ifcopenshell.guid.new(), None, None, None, wall, o)
        return o, corners, (ux, uy, nx, ny)

    def door(self, st, wall, a0, width, height=2.1, external=False, main=False, name=None):
        (x0, y0), (x1, y1), t = self.axes[wall.id()]
        o, _, (ux, uy, nx, ny) = self.opening(st, wall, a0, a0 + width, 0.0, height)
        d = self.entity("IfcDoor", name or ("출입문" if external else "문"), st, predefined="DOOR")
        ft = 0.05
        panel = [(x0 + ux * a + nx * s, y0 + uy * a + ny * s) for a, s in ((a0, -ft), (a0 + width, -ft), (a0 + width, ft), (a0, ft))]
        d.Representation = self.shape([self.extrude(panel, 0.0, height)])
        d.OverallWidth = width * MM
        d.OverallHeight = height * MM
        self.f.createIfcRelFillsElement(ifcopenshell.guid.new(), None, None, None, o, d)
        self.pset(d, "Pset_DoorCommon", {"IsExternal": ("IfcBoolean", external)})
        if main:
            self.kr(d, 주출입구=True)
        return d

    def window(self, st, wall, a0, width, sill, height, name="창"):
        (x0, y0), (x1, y1), t = self.axes[wall.id()]
        o, _, (ux, uy, nx, ny) = self.opening(st, wall, a0, a0 + width, sill, sill + height)
        w = self.entity("IfcWindow", name, st, predefined="WINDOW")
        ft = 0.04
        pane = [(x0 + ux * a + nx * s, y0 + uy * a + ny * s) for a, s in ((a0, -ft), (a0 + width, -ft), (a0 + width, ft), (a0, ft))]
        w.Representation = self.shape([self.extrude(pane, sill, height)])
        w.OverallWidth = width * MM
        w.OverallHeight = height * MM
        self.f.createIfcRelFillsElement(ifcopenshell.guid.new(), None, None, None, o, w)
        self.pset(w, "Pset_WindowCommon", {"IsExternal": ("IfcBoolean", True)})
        return w

    def slab(self, st, pts, top, thick=0.2, holes=(), name="바닥", predefined="FLOOR"):
        s = self.entity("IfcSlab", name, st, predefined=predefined)
        s.Representation = self.shape([self.extrude(pts, top - thick, thick, holes)])
        return s

    def space(self, st, number, long_name, pts, height, use=None, **kr):
        s = self.entity("IfcSpace", number, st, predefined="SPACE")
        s.LongName = long_name
        s.Representation = self.shape([self.extrude(pts, 0.0, height)])
        props = dict(kr)
        if use:
            props["실용도"] = use
        if props:
            self.kr(s, **props)
        return s

    def box_proxy(self, st, name, x0, y0, x1, y1, z0, z1, object_type=None, **kr):
        p = self.entity("IfcBuildingElementProxy", name, st, predefined="USERDEFINED")
        p.ObjectType = object_type or name
        p.Representation = self.shape([self.extrude([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1 - z0)])
        if kr:
            self.kr(p, **kr)
        return p

    def flight(self, st, start, direction, width, risers, riser, tread, z0=0.0, name="계단 경간"):
        """Straight flight: `start` is the corner of the first riser on the left of the run direction
        (looking up the stair), `direction` a unit axis vector (±x / ±y). Sawtooth side profile
        extruded across the width — the shape Revit exports for monolithic stairs."""
        f = self.f
        ux, uy = direction
        # Local frame: X = run, Y = up, extrusion Z = X × Y = (uy, -ux, 0) → to the right of the run.
        prof = [(0.0, 0.0), (0.0, riser)]
        for i in range(1, risers):
            prof += [(i * tread, i * riser), (i * tread, (i + 1) * riser)]
        top_run = (risers - 1) * tread
        prof += [(top_run, risers * riser - 0.3)]
        pts = [self.pt2(a, b) for a, b in prof] + [self.pt2(*prof[0])]
        area = f.createIfcArbitraryClosedProfileDef("AREA", None, f.createIfcPolyline(pts))
        pos = f.createIfcAxis2Placement3D(self.pt3(start[0], start[1], z0), f.createIfcDirection((float(uy), float(-ux), 0.0)), f.createIfcDirection((float(ux), float(uy), 0.0)))
        solid = f.createIfcExtrudedAreaSolid(area, pos, f.createIfcDirection((0.0, 0.0, 1.0)), width * MM)
        fl = self.entity("IfcStairFlight", name, None, rel_to=st.ObjectPlacement, predefined="STRAIGHT")
        fl.Representation = self.shape([solid])
        fl.NumberOfRisers = risers
        fl.NumberOfTreads = risers - 1
        fl.RiserHeight = riser * MM
        fl.TreadLength = tread * MM
        self.pset(fl, "Pset_StairFlightCommon", {
            "NumberOfRiser": ("IfcCountMeasure", risers), "NumberOfTreads": ("IfcCountMeasure", risers - 1),
            "RiserHeight": ("IfcPositiveLengthMeasure", riser * MM), "TreadLength": ("IfcPositiveLengthMeasure", tread * MM),
        })
        return fl

    def railing(self, st, x0, y0, x1, y1, z0, z1, height, where=None, name="난간", rel_to=None, contain=True):
        r = self.entity("IfcRailing", name, st if contain else None, predefined="GUARDRAIL", rel_to=rel_to if rel_to is not None else (None if contain else st.ObjectPlacement))
        r.Representation = self.shape([self.extrude([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1 - z0)])
        self.pset(r, "Pset_RailingCommon", {"Height": ("IfcPositiveLengthMeasure", height * MM), "IsExternal": ("IfcBoolean", where in ("옥상", "노대"))})
        if where:
            self.kr(r, 난간위치=where)
        return r

    def stair(self, st, parts, name="계단"):
        s = self.entity("IfcStair", name, st, predefined="HALF_TURN_STAIR")
        ifcopenshell.api.run("aggregate.assign_object", self.f, products=parts, relating_object=s)
        return s

    def save(self, path):
        self.f.write(path)


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def exterior_walls(m, st, x0, y0, x1, y1, t, h):
    """Exterior walls on the centreline ring (outer face = x0..x1, y0..y1)."""
    c = t / 2
    S = m.wall(st, (x0, y0 + c), (x1, y0 + c), t, h, True, "외벽-남")
    E = m.wall(st, (x1 - c, y0 + t), (x1 - c, y1 - t), t, h, True, "외벽-동")
    N = m.wall(st, (x1, y1 - c), (x0, y1 - c), t, h, True, "외벽-북")
    W = m.wall(st, (x0 + c, y1 - t), (x0 + c, y0 + t), t, h, True, "외벽-서")
    return S, E, N, W


# ───────────────────────────── A: 근린생활시설 (적합) ─────────────────────────────
def build_a():
    m = Model("가상 근린생활시설 A", "BuildLex AI BIM 법규검토 시험 모델 — 적합 예시")
    m.site("대지", rect(0, 0, 20, 25), 대지위치="서울특별시 마포구 상암동 1-1", 용도지역="제2종일반주거지역", 대지면적=500.0, 전면도로폭=8.0, 접도길이=20.0)
    m.building("근린생활시설 A동", 주용도="제2종 근린생활시설(사무소)", 주요구조부내화=True, 구조="철근콘크리트조")
    X0, Y0, X1, Y1, T = 2.0, 4.0, 14.0, 17.0, 0.2
    H = 3.3
    names = ["1층", "2층", "3층"]
    stair_hole = rect(10.6, 11.2, 13.8, 14.45)
    for i, nm in enumerate(names):
        st = m.storey(nm, i * H)
        top = 0.0
        m.slab(st, rect(X0, Y0, X1, Y1), top, 0.2, holes=[stair_hole] if i > 0 else (), name="바닥 슬래브" if i else "기초 슬래브", predefined="FLOOR" if i else "BASESLAB")
        wh = H - 0.2
        S, E, N, W = exterior_walls(m, st, X0, Y0, X1, Y1, T, wh)
        # 계단실 벽, 화장실 벽
        w1 = m.wall(st, (10.5, 11.1), (10.5, 16.8), T, wh, name="계단실 벽")
        w2 = m.wall(st, (10.4, 11.1), (13.8, 11.1), T, wh, name="계단실 벽")
        m.door(st, w2, 0.6, 1.0, name="계단실 출입문")
        w3 = m.wall(st, (5.1, 13.1), (5.1, 16.8), T, wh, name="화장실 벽")
        w4 = m.wall(st, (2.2, 13.1), (5.2, 13.1), T, wh, name="화장실 벽")
        m.door(st, w4, 1.0, 0.9, name="화장실 문")
        # 창
        m.window(st, S, 7.0, 2.0, 0.9, 1.5)
        m.window(st, W, 7.0, 2.0, 0.9, 1.5)
        m.window(st, N, 5.0, 2.0, 0.9, 1.5)
        if i == 0:
            m.door(st, S, 4.0, 1.5, 2.4, external=True, main=True, name="주출입구")
        room = "매장" if i == 0 else "사무실"
        main = [(2.2, 4.2), (13.8, 4.2), (13.8, 11.0), (10.4, 11.0), (10.4, 16.8), (5.2, 16.8), (5.2, 13.0), (2.2, 13.0)]
        m.space(st, f"{i + 1}01", room, main, wh)
        m.space(st, f"{i + 1}02", "화장실", rect(2.2, 13.2, 5.0, 16.8), wh)
        m.space(st, f"{i + 1}03", "계단실", rect(10.6, 11.2, 13.8, 16.8), wh)
        if i < len(names) - 1:
            # 반계단(ㄷ자): 경간 2개 + 계단참, 경간마다 1.65m
            f1 = m.flight(st, (10.65, 12.0), (0.0, 1.0), 1.25, 10, 0.165, 0.26, 0.0, "계단 경간 1")
            land = m.slab(st, rect(10.6, 14.34, 13.8, 16.8), 1.65, 0.2, name="계단참", predefined="LANDING")
            # 경간 2 (남쪽으로 상승): 오른쪽 기준 시작점 → 왼쪽 모서리 (x=13.65)
            f2 = m.flight(st, (13.65, 14.34), (0.0, -1.0), 1.25, 10, 0.165, 0.26, 1.65, "계단 경간 2")
            r = m.railing(st, 12.1, 12.0, 12.2, 14.34, 0.0, 3.2, 0.9, where="계단", contain=False)
            # 경간 2 서측 = 경간 1 동측 사이 난간 (한 개로 양쪽을 막음)
            m.stair(st, [f1, land, f2, r])
    roof = m.storey("지붕", 3 * H)
    m.slab(roof, rect(X0, Y0, X1, Y1), 0.0, 0.2, name="지붕 슬래브", predefined="ROOF")
    # 주차(지상 1층에 소속, 대지 동측) — Revit 주차 패밀리는 IfcBuildingElementProxy로 나감
    st1 = m.storeys["1층"]
    for k, y in enumerate((5.0, 7.5, 10.0)):
        m.box_proxy(st1, f"주차구획 {k + 1}", 14.5, y, 19.5, y + 2.5, 0.0, 0.02, object_type="주차구획(일반형)", 실용도="주차구획", 주차형식="일반형")
    m.box_proxy(st1, "조경", 2.0, 19.0, 14.0, 24.0, -0.3, 0.0, object_type="조경", 실용도="조경")
    out = os.path.join(ROOT, "public", "bim", "sample-a-compliant.ifc")
    m.save(out)
    return out


# ───────────────────────────── B: 공동주택 (위반 포함) ─────────────────────────────
def build_b():
    m = Model("가상 공동주택 B", "BuildLex AI BIM 법규검토 시험 모델 — 위반 포함 예시")
    m.site("대지", rect(0, 0, 24, 46), 대지위치="서울특별시 마포구 상암동 2-1", 용도지역="제2종일반주거지역", 대지면적=1104.0, 전면도로폭=8.0, 접도길이=24.0)
    m.building("공동주택 B동", 주용도="공동주택(아파트)", 세대수=55, 주요구조부내화=False, 사업계획승인대상=True, 구조="경량철골조")
    X0, Y0, X1, Y1, T = 6.0, 4.0, 18.0, 40.0, 0.2
    H = 3.0
    wh = H - 0.2
    unit_y = [(4.2, 10.0), (10.2, 16.0), (16.2, 22.0), (22.2, 28.0), (28.2, 34.0), (34.2, 39.8)]
    for i in range(5):
        st = m.storey(f"{i + 1}층", i * H)
        hole = [rect(12.95, 4.2, 17.8, 9.9)] if i > 0 else []
        m.slab(st, rect(X0, Y0, X1, Y1), 0.0, 0.2, holes=hole, name="바닥 슬래브" if i else "기초 슬래브", predefined="FLOOR" if i else "BASESLAB")
        S, E, N, W = exterior_walls(m, st, X0, Y0, X1, Y1, T, wh)
        cw = m.wall(st, (11.15, 4.2), (11.15, 39.8), T, wh, name="복도 벽(서)")
        ce = m.wall(st, (12.85, 4.2), (12.85, 39.8), T, wh, name="복도 벽(동)")
        for yy in (10.1, 16.1, 22.1, 28.1, 34.1):
            m.wall(st, (6.2, yy), (11.05, yy), T, wh, name="세대 경계벽")
            m.wall(st, (12.95, yy), (17.8, yy), T, wh, name="세대 경계벽")
        m.space(st, f"{i + 1}00", "복도", rect(11.25, 4.2, 12.75, 39.8), wh)
        m.space(st, f"{i + 1}99", "계단실", rect(12.95, 4.2, 17.8, 10.0), wh)
        m.door(st, ce, 4.8, 1.0, name="계단실 출입문")
        if i == 0:
            m.door(st, S, 5.4, 0.85, 2.1, external=True, main=True, name="주출입구")
        n = 0
        for side, (wx0, wx1), corridor_wall, ext_wall in (("서", (6.2, 11.05), cw, W), ("동", (12.95, 17.8), ce, E)):
            for k, (ya, yb) in enumerate(unit_y):
                if side == "동" and k == 0:
                    continue  # 계단실
                n += 1
                h = wh
                if i == 4 and side == "동" and k == 5:
                    h = 2.05  # 반자높이 위반 (2.1m 미만)
                m.space(st, f"{i + 1}{n:02d}", "거실", rect(wx0, ya, wx1, yb), h, 세대번호=f"{i + 1}{n:02d}호")
                # 세대 출입문: 복도 벽 축은 y=4.2에서 시작
                m.door(st, corridor_wall, (ya - 4.2) + 0.6, 0.9, name="세대 현관문")
                # 외벽 창: 서측 외벽 축은 북→남(y=39.8→4.2), 동측은 남→북
                small = (i == 2 and side == "서" and k == 5)
                ww, wh_ = (0.6, 0.9) if small else (2.4, 1.5)
                a = (39.8 - yb) + 1.5 if side == "서" else (ya - 4.2) + 1.5
                m.window(st, ext_wall, a, ww, 0.9, wh_)
        # 계단: 1층은 직선 1경간(3.0m, 계단참 없음), 2~4층은 반계단
        if i == 0:
            f1 = m.flight(st, (13.1, 4.4), (0.0, 1.0), 1.0, 17, 3.0 / 17, 0.24, 0.0, "계단 경간(직선)")
            r = m.railing(st, 14.25, 4.4, 14.35, 8.24, 0.0, 2.9, 0.9, where="계단", contain=False)
            m.stair(st, [f1, r])
        elif i < 4:
            f1 = m.flight(st, (13.1, 5.5), (0.0, 1.0), 1.0, 9, 1.5 / 9, 0.24, 0.0, "계단 경간 1")
            land = m.slab(st, rect(12.95, 7.42, 17.8, 9.9), 1.5, 0.2, name="계단참", predefined="LANDING")
            f2 = m.flight(st, (15.6, 7.42), (0.0, -1.0), 1.0, 9, 1.5 / 9, 0.24, 1.5, "계단 경간 2")
            r = m.railing(st, 14.25, 5.5, 14.35, 7.42, 0.0, 2.9, 0.9, where="계단", contain=False)
            m.stair(st, [f1, land, f2, r])
    roof = m.storey("지붕", 5 * H)
    m.slab(roof, rect(X0, Y0, X1, Y1), 0.0, 0.2, name="지붕 슬래브", predefined="ROOF")
    m.railing(roof, 6.2, 39.7, 17.8, 39.8, 0.0, 1.1, 1.1, where="옥상", name="옥상 난간")
    st1 = m.storeys["1층"]
    m.box_proxy(st1, "주차구획 1", 0.5, 5.0, 5.5, 7.3, 0.0, 0.02, object_type="주차구획(일반형)", 실용도="주차구획", 주차형식="일반형")
    m.box_proxy(st1, "주차구획 2", 0.5, 7.3, 5.5, 9.8, 0.0, 0.02, object_type="주차구획(일반형)", 실용도="주차구획", 주차형식="일반형")
    m.box_proxy(st1, "주차구획 3", 0.5, 9.8, 5.5, 13.1, 0.0, 0.02, object_type="주차구획(장애인전용)", 실용도="주차구획", 주차형식="장애인전용")
    m.box_proxy(st1, "조경", 6.0, 41.0, 18.0, 45.0, -0.3, 0.0, object_type="조경", 실용도="조경")
    out = os.path.join(ROOT, "public", "bim", "sample-b-violations.ifc")
    m.save(out)
    return out


# ───────────────────── C: 고층 공동주택 (시공 단계 데모) ─────────────────────
def build_c():
    """12층 아파트 + 지하 3층 주차장. 시공 단계 탭 시연용: 매트기초 하단 GL-11.5m (소규모 지하안전평가),
    48세대 (주택법 사업계획승인), 10층 이상 (안전관리계획), 층마다 계단실·승강로 슬래브 개구부."""
    m = Model("가상 공동주택 C", "BuildLex AI BIM 시공 단계 시연 모델 — 지하 3층·지상 12층 아파트")
    m.site("대지", rect(0, 0, 60, 50), 대지위치="서울특별시 마포구 상암동 3-1", 용도지역="제2종일반주거지역", 대지면적=3000.0, 전면도로폭=12.0, 접도길이=60.0)
    m.building("공동주택 C동", 주용도="공동주택(아파트)", 세대수=48, 주요구조부내화=True, 사업계획승인대상=True, 구조="철근콘크리트조")
    X0, Y0, X1, Y1, T = 4.0, 4.0, 34.0, 19.0, 0.2
    BX0, BY0, BX1, BY1 = 2.0, 2.0, 36.0, 21.0
    STAIR = rect(16.2, 12.7, 19.3, 18.8)
    LIFT = rect(19.8, 12.7, 21.8, 14.7)
    H, HB = 2.9, 3.5

    def core(st, h, i):
        m.wall(st, (16.1, 12.6), (16.1, 18.9), T, h, name="계단실 벽(서)")
        m.wall(st, (19.5, 12.6), (19.5, 18.9), T, h, name="계단실 벽(동)")
        m.wall(st, (21.9, 12.6), (21.9, 14.8), T, h, name="승강로 벽(동)")
        m.wall(st, (19.6, 14.8), (22.0, 14.8), T, h, name="승강로 벽(북)")
        m.space(st, f"{i}S", "계단실", STAIR, h)
        m.space(st, f"{i}E", "승강기", LIFT, h)
        r = round(h / 2 / 0.175 + 0.4999)
        f1 = m.flight(st, (16.3, 12.9), (0.0, 1.0), 1.2, r, h / 2 / r, 0.26, 0.0, "계단 경간 1")
        y2 = 12.9 + (r - 1) * 0.26
        land = m.slab(st, rect(16.2, y2, 19.3, 18.8), h / 2, 0.2, name="계단참", predefined="LANDING")
        f2 = m.flight(st, (19.2, y2), (0.0, -1.0), 1.2, r, h / 2 / r, 0.26, h / 2, "계단 경간 2")
        r1 = m.railing(st, 17.65, 12.9, 17.85, y2, 0.0, h, 0.9, where="계단", contain=False)
        m.stair(st, [f1, land, f2, r1])

    # 지하 3층 주차장: 매트기초(두께 1.0m) 위 B3, B2·B1 슬래브에 계단·승강로 개구부
    for k, name in enumerate(("지하3층", "지하2층", "지하1층")):
        z = -HB * (3 - k)
        st = m.storey(name, z)
        if k == 0:
            m.slab(st, rect(BX0, BY0, BX1, BY1), 0.0, 1.0, name="매트 기초", predefined="BASESLAB")
        else:
            m.slab(st, rect(BX0, BY0, BX1, BY1), 0.0, 0.25, holes=[STAIR, LIFT], name="지하 슬래브")
        exterior_walls(m, st, BX0, BY0, BX1, BY1, 0.4, HB - 0.25)
        m.space(st, f"B{3 - k}P", "지하주차장", rect(BX0 + 0.4, BY0 + 0.4, 16.0, BY1 - 0.4), HB - 0.25, use="주차")
        core(st, HB - 0.25, f"B{3 - k}")

    unit_rects = [rect(4.2, 4.2, 18.9, 10.4), rect(19.1, 4.2, 33.8, 10.4), rect(4.2, 12.6, 16.0, 18.8), rect(22.0, 12.6, 33.8, 18.8)]
    for i in range(12):
        st = m.storey(f"{i + 1}층", i * H)
        if i == 0:
            m.slab(st, rect(BX0, BY0, BX1, BY1), 0.0, 0.3, holes=[STAIR, LIFT], name="1층 바닥(지하 상부)")
        else:
            m.slab(st, rect(X0, Y0, X1, Y1), 0.0, 0.2, holes=[STAIR, LIFT], name="바닥 슬래브")
        wh = H - 0.2
        S, E, N, W = exterior_walls(m, st, X0, Y0, X1, Y1, T, wh)
        m.wall(st, (4.2, 10.5), (33.8, 10.5), T, wh, name="복도 벽(남)")
        m.wall(st, (16.0, 12.5), (16.0, 18.8), T, wh, name="세대 경계벽")
        m.wall(st, (19.0, 4.2), (19.0, 10.4), T, wh, name="세대 경계벽")
        m.space(st, f"{i + 1}00", "복도", rect(4.2, 10.6, 33.8, 12.5), wh)
        core(st, wh, i + 1)
        for n, pts in enumerate(unit_rects):
            m.space(st, f"{i + 1}{n + 1:02d}", "거실", pts, wh, 세대번호=f"{i + 1}{n + 1:02d}호")
        for a in (2.0, 9.0, 17.0, 24.0):
            m.window(st, S, a, 3.6, 0.9, 1.5)
        for a in (3.0, 7.5, 21.0, 26.0):
            m.window(st, N, a, 3.6, 0.9, 1.5)
        if i == 0:
            m.door(st, W, 6.0, 1.2, 2.1, external=True, main=True, name="주출입구")
    roof = m.storey("지붕층", 12 * H)
    m.slab(roof, rect(X0, Y0, X1, Y1), 0.0, 0.2, holes=[STAIR, LIFT], name="지붕 슬래브", predefined="ROOF")
    m.box_proxy(m.storeys["1층"], "조경", 4.0, 24.0, 44.0, 46.0, -0.3, 0.0, object_type="조경", 실용도="조경")
    out = os.path.join(ROOT, "public", "bim", "demo-3-highrise.ifc")
    m.save(out)
    return out


TRUTH = {
    "sample-a-compliant": {
        "storeys_above": 3, "storeys_below": 0, "height": 9.9,
        "building_area": 151.04, "gross_floor_area": 453.12, "far_floor_area": 453.12, "site_area": 500.0,
        "parking": 3, "landscape_area": 60.0, "north_min_low": 8.0,
        "egress_max": [11.0, 13.5],
        "expect": {"FAIL": []},
    },
    "sample-b-violations": {
        "storeys_above": 5, "storeys_below": 0, "height": 15.0,
        "building_area": 422.44, "gross_floor_area": 2112.2, "far_floor_area": 2112.2, "site_area": 1104.0,
        "parking": 3, "landscape_area": 48.0, "north_min_high": 6.0,
        "egress_max": [32.0, 38.0],
        # 3B: 마포구 건축조례 연면적 2천㎡ 이상 → 대지면적 15%; B-STAIR-GUARD: 2~4층 경간 2 동측이 열려 있음
        "expect": {"FAIL": ["3B", "B-EGRESS-DIST", "B-EGRESS-COUNT", "B-STAIR-WIDTH", "B-STAIR-STEP", "B-STAIR-LANDING", "B-STAIR-GUARD", "B-CORRIDOR", "B-CEILING", "B-DAYLIGHT-WINDOW", "B-GUARD", "B-DOOR", "B-PARKING-STALL", "B-NORTH"]},
    },
}

if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "public", "bim"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "tests", "bim"), exist_ok=True)
    only = set(sys.argv[1:])  # e.g. `python3 scripts/make-test-ifc.py c` rebuilds only demo-3
    for key, build in (("a", build_a), ("b", build_b), ("c", build_c)):
        if only and key not in only:
            continue
        p = build()
        print("wrote", os.path.relpath(p, ROOT), f"{os.path.getsize(p) / 1024:.0f} KB")
    for k, v in TRUTH.items():
        with open(os.path.join(ROOT, "tests", "bim", f"{k}.truth.json"), "w", encoding="utf-8") as fh:
            json.dump(v, fh, ensure_ascii=False, indent=2)
    sys.exit(0)
