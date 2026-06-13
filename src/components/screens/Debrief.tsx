"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGame } from "@/state/store";
import { LEVELS } from "@/lib/game/levels";
import { Badge, Button, Modal, cn } from "@/components/ui";
import type { Scores } from "@/lib/types";

const AXES: { key: keyof Scores; label: string }[] = [
  { key: "scalability", label: "Scalability" },
  { key: "reliability", label: "Reliability" },
  { key: "latency", label: "Latency" },
  { key: "cost", label: "Cost" },
  { key: "maintainability", label: "Maintainability" },
  { key: "complexity", label: "Simplicity" },
];

export function Debrief() {
  const router = useRouter();
  const phase = useGame((s) => s.phase);
  const mode = useGame((s) => s.mode);
  const level = useGame((s) => s.level);
  const incident = useGame((s) => s.incident);
  const result = useGame((s) => s.result);
  const resetRun = useGame((s) => s.resetRun);
  const startLevel = useGame((s) => s.startLevel);
  const exitToMenu = useGame((s) => s.exitToMenu);
  const dismissResult = useGame((s) => s.dismissResult);
  const [selectedAxis, setSelectedAxis] = useState<keyof Scores | null>(null);

  if (phase !== "debrief" || !result || mode === "interview") return null;

  const debrief = level?.debrief ?? incident?.debrief;
  const nextLevel = level ? LEVELS.find((l) => l.number === level.number + 1) : null;

  // default the breakdown to the weakest axis — that's what to fix first
  const weakest = AXES.reduce((lo, a) => (result.scores[a.key] < result.scores[lo.key] ? a : lo), AXES[0]);
  const activeAxis = selectedAxis ?? weakest.key;
  const activeLabel = AXES.find((a) => a.key === activeAxis)!.label;
  const activeExplain = result.breakdown?.[activeAxis];

  return (
    <Modal open wide>
      <div className="mb-2 flex items-center gap-2">
        {result.passed ? <Badge tone="ok">✓ {mode === "incident" ? "SERVICE RESTORED" : "LEVEL PASSED"}</Badge> : <Badge tone="crit">✗ {mode === "incident" ? "INCIDENT UNRESOLVED" : "SLO MISSED"}</Badge>}
        <Badge tone="accent">Overall {result.overall}/100</Badge>
      </div>
      <h2 className="text-xl font-bold text-ink-100">
        {result.passed ? "Postmortem (the good kind)" : "Postmortem"}
      </h2>

      <div className="mt-3 grid gap-1.5 rounded-md border border-ink-700 bg-ink-900 p-3 text-sm sm:grid-cols-2">
        {result.reasons.map((r, i) => (
          <div key={i} className={cn("text-xs", r.includes("✓") ? "text-ok" : "text-crit")}>
            {r}
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {AXES.map(({ key, label }) => {
          const v = result.scores[key];
          const isActive = key === activeAxis;
          return (
            <button
              key={key}
              onClick={() => setSelectedAxis(key)}
              className={cn(
                "rounded-md border bg-ink-900 p-2 text-center transition-colors",
                isActive ? "border-accent ring-1 ring-accent/40" : "border-ink-700 hover:border-ink-500"
              )}
            >
              <div className={cn("font-mono text-lg font-bold", v >= 75 ? "text-ok" : v >= 50 ? "text-warn" : "text-crit")}>
                {v}
              </div>
              <div className="text-[9px] uppercase tracking-wide text-ink-400">{label}</div>
            </button>
          );
        })}
      </div>

      {/* breakdown of the selected axis — why this score, and how to raise it */}
      <div className="mt-2 rounded-md border border-ink-700 bg-ink-900 p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            {activeLabel} {result.scores[activeAxis]}/100
          </span>
          <span className="text-[10px] text-ink-500">· tap any score above</span>
        </div>
        {activeExplain && (activeExplain.reasons.length > 0 || activeExplain.tips.length > 0) ? (
          <div className="space-y-2">
            {activeExplain.reasons.length > 0 && (
              <ul className="space-y-1">
                {activeExplain.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-snug text-crit">
                    <span className="shrink-0">−</span>
                    <span className="text-ink-300">{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {activeExplain.tips.length > 0 && (
              <div className="border-t border-ink-700 pt-2">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ok">To improve</div>
                <ul className="space-y-1">
                  {activeExplain.tips.map((t, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-snug text-ink-200">
                      <span className="shrink-0 text-ok">→</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-ok">Nothing to fix here — this axis is solid. 🎉</p>
        )}
      </div>

      {debrief && (
        <div className="mt-4 rounded-md border border-violet/30 bg-violet/5 p-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-violet">
            What this was really about
          </div>
          <h3 className="mb-2 text-base font-bold text-ink-100">{debrief.concept}</h3>
          <div className="space-y-2 text-sm leading-relaxed text-ink-300">
            {debrief.explanation.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="mt-3 border-t border-violet/20 pt-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">Tradeoffs to carry with you</div>
            <ul className="space-y-1.5 text-sm leading-snug text-ink-300">
              {debrief.tradeoffs.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-violet">⚖</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => { exitToMenu(); router.push("/"); }}>
          Menu
        </Button>
        <Button variant="secondary" onClick={dismissResult}>
          Inspect the wreckage
        </Button>
        <Button variant="secondary" onClick={resetRun}>
          ↺ Retry
        </Button>
        {result.passed && nextLevel && (
          <Button variant="primary" onClick={() => startLevel(nextLevel.id)}>
            Next: Level {nextLevel.number} — {nextLevel.title} →
          </Button>
        )}
      </div>
    </Modal>
  );
}
