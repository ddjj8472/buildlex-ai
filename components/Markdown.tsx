"use client";
// Minimal, safe Markdown renderer for streamed answers:
// ## headings, bullet / ordered lists, **bold**, and [n] citation chips.
import { Fragment, type ReactNode } from "react";

type Props = { text: string; max: number; onCite: (n: number) => void; streaming?: boolean };

function inline(text: string, max: number, onCite: (n: number) => void, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(\d+(?:\s*[,，]\s*\d+)*)\]|\[근거\s*(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${key}b${i++}`}>{m[1]}</strong>);
    else {
      const nums = (m[2] || m[3]).split(/[,，]/).map(s => Number(s.trim()));
      nums.forEach(n => out.push(
        <button key={`${key}c${i++}`} type="button" className={`cite${n < 1 || n > max ? " bad" : ""}`} onClick={() => onCite(n)} title={n <= max ? `근거 ${n} 보기` : "근거 목록에 없는 번호"}>{n}</button>,
      ));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text, max, onCite, streaming }: Props) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), max, onCite, `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${blocks.length}`;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, max, onCite, `${k}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^#{1,4}\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) { flushPara(); flushList(); blocks.push(<h3 key={`h${blocks.length}`}>{h[1].replace(/\*\*/g, "")}</h3>); }
    else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul || ol)![1]);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else if (list && /^\s{2,}/.test(raw)) list.items[list.items.length - 1] += " " + line.trim();
    else { flushList(); para.push(line.trim()); }
  }
  flushPara();
  flushList();
  return <div className="md">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}{streaming && <span className="caret" />}</div>;
}
