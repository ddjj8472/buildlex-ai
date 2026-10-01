"use client";
import { REVIEW_PHASES } from "@/lib/review/utils/session";

export default function ProgressPhases({ current, failed, paused }: { current: number; failed?: boolean; paused?: boolean }) {
  return (
    <ol className="rv-phases" aria-label="검토 단계">
      {REVIEW_PHASES.map((p, i) => {
        const state = i < current ? "done" : i === current ? (failed ? "error" : paused ? "todo" : "running") : "todo";
        return (
          <li key={p} className={`rv-phase ${state}`}>
            <span className="rv-dot" aria-hidden="true" />
            <span>{i + 1}. {p}</span>
          </li>
        );
      })}
    </ol>
  );
}
