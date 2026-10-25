// Generates the Revit / openBIM kit for the BuildLex_KR property set from lib/bim/convention.ts:
//   public/bim/BuildLex_KR_SharedParameters.txt  Revit 공유 매개변수 파일
//   public/bim/BuildLex_KR_IFC_PropertySets.txt  Revit IFC 내보내기 "사용자 정의 속성 세트" 매핑 파일
//   public/bim/buildlex-kr.ids                   buildingSMART IDS 1.0 — 검토에 필요한 정보 요건
// Run: npx tsx scripts/make-bim-kit.ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import { KR_PROPS, PSET, SPACE_USES, type KrDataType } from "../lib/bim/convention.ts";

const out = (f: string, s: string) => { fs.writeFileSync(`public/bim/${f}`, s, "utf8"); console.log("wrote public/bim/" + f); };

/** Stable GUID per parameter name, so re-generating never breaks Revit bindings. */
function guid(name: string): string {
  const h = createHash("sha1").update(`BuildLex_KR/${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const REVIT_TYPE: Record<KrDataType, string> = { Text: "TEXT", Area: "AREA", Length: "LENGTH", Boolean: "YESNO", Integer: "INTEGER" };
const IFC_TYPE: Record<KrDataType, string> = { Text: "Text", Area: "Area", Length: "Length", Boolean: "Boolean", Integer: "Integer" };
const IDS_TYPE: Record<KrDataType, string> = { Text: "IFCLABEL", Area: "IFCAREAMEASURE", Length: "IFCLENGTHMEASURE", Boolean: "IFCBOOLEAN", Integer: "IFCINTEGER" };

// ── Revit shared parameter file (tab separated) ──
const sp = [
  "# This is a Revit shared parameter file.",
  "# Do not edit manually.",
  "*META\tVERSION\tMINVERSION",
  "META\t2\t1",
  "*GROUP\tID\tNAME",
  "GROUP\t1\tBuildLex_KR",
  "*PARAM\tGUID\tNAME\tDATATYPE\tDATACATEGORY\tGROUP\tVISIBLE\tDESCRIPTION\tUSERMODIFIABLE\tHIDEWHENNOVALUE",
  ...KR_PROPS.map(p => ["PARAM", guid(p.name), p.name, REVIT_TYPE[p.type], "", "1", "1", p.desc.replace(/\t/g, " "), "1", "0"].join("\t")),
];
out("BuildLex_KR_SharedParameters.txt", sp.join("\r\n") + "\r\n");

// ── Revit IFC exporter: user defined property sets ──
const classes = [...new Set(KR_PROPS.flatMap(p => p.on))];
const ps = [
  "#",
  "# BuildLex_KR — Revit IFC 내보내기 사용자 정의 속성 세트",
  "# IFC 내보내기 → 설정 수정 → 속성 세트 → '사용자 정의 속성 세트 내보내기'에 이 파일을 지정하세요.",
  "# IfcSite·IfcBuilding 값은 Revit '프로젝트 정보'의 같은 이름 매개변수에서 읽습니다.",
  "#",
];
for (const cls of classes) {
  ps.push(`PropertySet:\t${PSET}\tI\t${cls}`);
  for (const p of KR_PROPS.filter(x => x.on.includes(cls))) ps.push(`\t${p.name}\t${IFC_TYPE[p.type]}\t${p.name}`);
}
out("BuildLex_KR_IFC_PropertySets.txt", ps.join("\r\n") + "\r\n");

// ── IDS 1.0 ──
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const entity = (name: string) => `<ids:entity><ids:name><ids:simpleValue>${name.toUpperCase()}</ids:simpleValue></ids:name></ids:entity>`;
const prop = (pset: string, name: string, dataType: string, cardinality: "required" | "optional", values?: string[], instructions?: string) =>
  `<ids:property dataType="${dataType}" cardinality="${cardinality}"${instructions ? ` instructions="${esc(instructions)}"` : ""}><ids:propertySet><ids:simpleValue>${esc(pset)}</ids:simpleValue></ids:propertySet><ids:baseName><ids:simpleValue>${esc(name)}</ids:simpleValue></ids:baseName>${values ? `<ids:value><xs:restriction base="xs:string">${values.map(v => `<xs:enumeration value="${esc(v)}"/>`).join("")}</xs:restriction></ids:value>` : ""}</ids:property>`;
const attr = (name: string, instructions: string) => `<ids:attribute cardinality="required" instructions="${esc(instructions)}"><ids:name><ids:simpleValue>${name}</ids:simpleValue></ids:name></ids:attribute>`;
type Spec = { name: string; desc: string; on: string; req: string[]; optional?: boolean };
const specs: Spec[] = [
  { name: "대지 정보", desc: "용도지역·대지면적으로 건폐율·용적률·일조 기준을 정합니다.", on: "IfcSite", req: KR_PROPS.filter(p => p.on.includes("IfcSite") && p.required).map(p => prop(PSET, p.name, IDS_TYPE[p.type], "required", undefined, p.desc)) },
  { name: "건축물 주용도", desc: "건축법 시행령 별표 1 용도에 따라 계단·복도·채광 기준이 달라집니다.", on: "IfcBuilding", req: KR_PROPS.filter(p => p.on.includes("IfcBuilding") && p.required).map(p => prop(PSET, p.name, IDS_TYPE[p.type], "required", undefined, p.desc)) },
  { name: "실 이름과 용도", desc: "거실·복도·계단실 구분은 보행거리·복도 폭·반자높이·채광 검토의 전제입니다.", on: "IfcSpace", req: [attr("LongName", "Revit 룸 이름"), prop(PSET, "실용도", "IFCLABEL", "optional", SPACE_USES, "없으면 실 이름으로 추정합니다.")] },
  { name: "외벽 구분", desc: "건축면적·바닥면적을 외벽 중심선으로 환산할 때 씁니다.", on: "IfcWall", req: [prop("Pset_WallCommon", "IsExternal", "IFCBOOLEAN", "required", undefined, "Revit 벽 유형의 '기능 = 외부'")] },
  { name: "계단 단 치수", desc: "단높이·단너비 검토(학교·공동주택).", on: "IfcStairFlight", req: [prop("Pset_StairFlightCommon", "RiserHeight", "IFCPOSITIVELENGTHMEASURE", "required"), prop("Pset_StairFlightCommon", "TreadLength", "IFCPOSITIVELENGTHMEASURE", "required")] },
  { name: "문 폭", desc: "주출입구 통과 유효폭 검토.", on: "IfcDoor", req: [attr("OverallWidth", "문 폭(Revit '폭')")] },
  { name: "난간 높이", desc: "옥상·노대 난간 높이 검토.", on: "IfcRailing", req: [prop("Pset_RailingCommon", "Height", "IFCPOSITIVELENGTHMEASURE", "required")] },
];
const ids = `<?xml version="1.0" encoding="UTF-8"?>
<ids:ids xmlns:ids="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">
  <ids:info>
    <ids:title>BuildLex_KR — BIM 법규검토 정보 요건</ids:title>
    <ids:version>1.0</ids:version>
    <ids:description>BuildLex AI BIM 법규검토(/bim)가 국내 건축법규를 자동 검토하려면 IFC에 있어야 하는 정보입니다.</ids:description>
    <ids:date>${new Date().toISOString().slice(0, 10)}</ids:date>
    <ids:purpose>Code compliance checking (Korea)</ids:purpose>
  </ids:info>
  <ids:specifications>
${specs.map(s => `    <ids:specification name="${esc(s.name)}" ifcVersion="IFC2X3 IFC4" description="${esc(s.desc)}">
      <ids:applicability minOccurs="0" maxOccurs="unbounded">${entity(s.on)}</ids:applicability>
      <ids:requirements>${s.req.join("")}</ids:requirements>
    </ids:specification>`).join("\n")}
  </ids:specifications>
</ids:ids>
`;
out("buildlex-kr.ids", ids);
