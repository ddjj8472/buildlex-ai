"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconPin } from "./Icons";

type R = { key: string; label: string; ordinances: string[] };
let cache: R[] | null = null;

export default function RegionPicker({ value, onChange, placement = "up" }: { value: string; onChange: (label: string) => void; placement?: "up" | "down" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<R[]>(cache || []);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || cache) return;
    fetch("/api/regions").then(r => r.json()).then(d => { cache = d.regions; setList(d.regions); }).catch(() => {});
  }, [open]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const filtered = useMemo(() => {
    const t = q.replace(/\s+/g, "");
    return (t ? list.filter(r => r.label.replace(/\s+/g, "").includes(t)) : list).slice(0, 80);
  }, [q, list]);

  return (
    <div className="picker" ref={ref}>
      <button type="button" className={`pill${value ? " on" : ""}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <IconPin size={15} />{value || "지역 선택"}
      </button>
      {open && (
        <div className={`picker-pop${placement === "down" ? " down" : ""}`} role="dialog" aria-label="지역 선택">
          <input autoFocus placeholder="시·군·구 검색 (예: 용인, 강남구)" value={q} onChange={e => setQ(e.target.value)} />
          <div className="picker-list">
            {value && <button type="button" className="picker-item" onClick={() => { onChange(""); setOpen(false); }}>지역 해제 <small>국가법령만 검색</small></button>}
            {filtered.map(r => (
              <button type="button" key={r.key} className={`picker-item${r.label === value ? " on" : ""}`} onClick={() => { onChange(r.label); setOpen(false); setQ(""); }}>
                {r.label}<small>조례 {r.ordinances.length}건</small>
              </button>
            ))}
            {!filtered.length && <div className="empty-note">{list.length ? "일치하는 지역이 없습니다" : "불러오는 중…"}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
