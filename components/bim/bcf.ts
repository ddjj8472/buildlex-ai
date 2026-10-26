// BCF 2.1 export — the buildingSMART issue format Solibri, BIMcollab, Revizto and the
// Revit BCF plug-ins read. Each FAIL / 확인 필요 issue becomes a topic with the IFC GUIDs
// of the offending elements selected, a camera viewpoint and a snapshot, so the team can
// open it in Revit and jump straight to the element.
import type { BimIssue, BimRuleResult, Vec3 } from "@/lib/bim/types";
import type { CameraState } from "./Viewer3D";

// ── minimal ZIP writer (stored, no compression; UTF-8 names) ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files: { name: string; data: Uint8Array | string }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)].map(p => p as BlobPart), { type: "application/octet-stream" });
}

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xyz = (tag: string, v: Vec3) => `<${tag}><X>${v[0].toFixed(4)}</X><Y>${v[1].toFixed(4)}</Y><Z>${v[2].toFixed(4)}</Z></${tag}>`;

export type BcfTopic = { rule: BimRuleResult; issue: BimIssue; snapshot?: Uint8Array; camera?: CameraState };

/** offset: analysis frame − IFC metres (cameras are written in IFC model coordinates). */
export function buildBcf(topics: BcfTopic[], meta: { project: string; file: string; offset: Vec3 }): Blob {
  const files: { name: string; data: Uint8Array | string }[] = [
    { name: "bcf.version", data: `<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>` },
    { name: "project.bcfp", data: `<?xml version="1.0" encoding="UTF-8"?>\n<ProjectExtension><Project ProjectId="${uuid()}"><Name>${esc(meta.project || "BuildLex AI")}</Name></Project><ExtensionSchema></ExtensionSchema></ProjectExtension>` },
  ];
  const date = new Date().toISOString();
  const toIfc = (v: Vec3): Vec3 => [v[0] - meta.offset[0], v[1] - meta.offset[1], v[2] - meta.offset[2]];
  for (const t of topics) {
    const id = uuid(), vp = uuid(), cm = uuid();
    const priority = t.issue.severity === "critical" ? "Critical" : t.issue.severity === "major" ? "Major" : "Minor";
    const desc = [t.issue.detail, `기준: ${t.rule.requirement}`, `근거: ${[...new Set(t.rule.citations.map(c => c.label))].join(", ")}`, t.issue.measured ? `측정: ${t.issue.measured}` : "", t.issue.required ? `필요: ${t.issue.required}` : ""].filter(Boolean).join("\n");
    files.push({
      name: `${id}/markup.bcf`,
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Markup>
  <Header><File isExternal="true"><Filename>${esc(meta.file)}</Filename><Date>${date}</Date></File></Header>
  <Topic Guid="${id}" TopicType="Issue" TopicStatus="${t.issue.status === "FAIL" ? "Open" : "In Progress"}">
    <Title>${esc(`[${t.rule.title}] ${t.issue.title}`)}</Title>
    <Priority>${priority}</Priority>
    <Labels>${esc(t.rule.section)}</Labels>
    <Labels>${esc(t.rule.check_id)}</Labels>
    <CreationDate>${date}</CreationDate>
    <CreationAuthor>BuildLex AI</CreationAuthor>
    <Description>${esc(desc)}</Description>
  </Topic>
  <Comment Guid="${cm}"><Date>${date}</Date><Author>BuildLex AI</Author><Comment>${esc(desc)}</Comment><Viewpoint Guid="${vp}"/></Comment>
  <Viewpoints Guid="${vp}"><Viewpoint>viewpoint.bcfv</Viewpoint>${t.snapshot ? "<Snapshot>snapshot.png</Snapshot>" : ""}</Viewpoints>
</Markup>`,
    });
    const cam = t.camera ? `<PerspectiveCamera>${xyz("CameraViewPoint", toIfc(t.camera.position))}${xyz("CameraDirection", t.camera.direction)}${xyz("CameraUpVector", t.camera.up)}<FieldOfView>${t.camera.fov}</FieldOfView></PerspectiveCamera>` : "";
    files.push({
      name: `${id}/viewpoint.bcfv`,
      data: `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${vp}">
  <Components>
    <Selection>${t.issue.refs.filter(r => r.guid).map(r => `<Component IfcGuid="${esc(r.guid)}"><OriginatingSystem>BuildLex AI</OriginatingSystem></Component>`).join("")}</Selection>
    <Visibility DefaultVisibility="true"/>
    <Coloring><Color Color="FFD93025">${t.issue.refs.filter(r => r.guid).map(r => `<Component IfcGuid="${esc(r.guid)}"/>`).join("")}</Color></Coloring>
  </Components>
  ${cam}
</VisualizationInfo>`,
    });
    if (t.snapshot) files.push({ name: `${id}/snapshot.png`, data: t.snapshot });
  }
  return zip(files);
}
