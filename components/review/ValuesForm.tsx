"use client";
import { FIELD_KEYS, type FieldKey, type FieldValue, type ProjectValues } from "@/lib/review/types";

const UNITS: Partial<Record<FieldKey, string>> = {
  대지면적: "㎡", 건축면적: "㎡", 연면적: "㎡", 용적률산정용연면적: "㎡", 시설면적: "㎡", 조경면적: "㎡",
  건폐율: "%", 용적률: "%", 건폐율_도면기준: "%", 용적률_도면기준: "%",
  높이: "m", 정북이격_10m이하: "m", 정북이격_10m초과: "m", 접도길이: "m", 전면도로폭: "m",
  지상층수: "층", 지하층수: "층", 주차대수: "대", 법정주차대수_도면: "대", 세대수: "세대",
};
const LABEL: Partial<Record<FieldKey, string>> = {
  건폐율_도면기준: "건폐율 기준(도면 표기)", 용적률_도면기준: "용적률 기준(도면 표기)", 용적률산정용연면적: "용적률 산정용 연면적",
  정북이격_10m이하: "정북 이격(높이 10m 이하)", 정북이격_10m초과: "정북 이격(10m 초과)", 법정주차대수_도면: "법정 주차대수(도면 표기)",
  지구단위계획: "지구단위계획·택지지구", 건축사날인: "건축사 날인",
};
const TEXT_FIELDS = new Set<FieldKey>(["대지위치", "용도지역", "용도지구", "주용도", "건축사날인", "구조"]);
const SRC = { text: "텍스트", vision: "이미지", user: "수정" } as const;

export default function ValuesForm({ values, onChange, disabled }: { values: ProjectValues; onChange: (k: FieldKey, v: FieldValue | undefined) => void; disabled?: boolean }) {
  const set = (k: FieldKey, raw: string | boolean) => {
    if (raw === "" || raw === false) return onChange(k, typeof raw === "boolean" ? { value: false, source: "user", confidence: "HIGH" } : undefined);
    // Numbers stay strings while typing ("12."); the checks parse them.
    if (typeof raw === "string" && !TEXT_FIELDS.has(k) && !/^[\d,.]*$/.test(raw)) return;
    const value = raw;
    onChange(k, { ...(values[k] || {}), value, unit: UNITS[k], source: "user", confidence: "HIGH" });
  };
  return (
    <div className="rv-values">
      {FIELD_KEYS.map(k => {
        const v = values[k];
        const shown = v?.value;
        return (
          <label key={k} className={`rv-field${v ? "" : " empty"}${v?.confidence === "LOW" ? " low" : ""}`} title={v?.raw ? `원문: ${v.raw}` : "도면에서 찾지 못함"}>
            <span className="rv-field-name">{LABEL[k] || k}</span>
            {k === "지구단위계획" ? (
              <input type="checkbox" checked={shown === true} disabled={disabled} onChange={e => set(k, e.target.checked)} />
            ) : (
              <span className="rv-input-wrap">
                <input type="text" inputMode={TEXT_FIELDS.has(k) ? "text" : "decimal"} value={shown === undefined || shown === null ? "" : String(shown)} disabled={disabled}
                  placeholder="—" onChange={e => set(k, e.target.value)} />
                {UNITS[k] && <span className="rv-unit">{UNITS[k]}</span>}
              </span>
            )}
            <span className="rv-meta">{v ? `${SRC[v.source]}${v.sheet_id ? ` · ${v.sheet_id}` : v.page ? ` · ${v.page}쪽` : ""}${v.confidence === "LOW" ? " · 확인" : ""}` : ""}</span>
          </label>
        );
      })}
    </div>
  );
}
