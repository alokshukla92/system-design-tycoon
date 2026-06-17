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
  const restartFromStarter = useGame((s) => s.restartFromStarter);
  const startLevel = useGame((s) => s.startLevel);
  const exitToMenu = useGame((s) => s.exitToMenu);
  const dismissResult = useGame((s) => s.dismissResult);
  const [selectedAxis, setSelectedAxis] = useState<keyof Scores | null>(null);
  // Solutions are opt-in: the player asks for help rather than being handed it.
  const [showHelp, setShowHelp] = useState(false);

  if (phase !== "debrief" || !result || mode === "interview") return null;

  const debrief = level?.debrief ?? incident?.debrief;
  const nextLevel = level ? LEVELS.find((l) => l.number === level.number + 1) : null;

  // Which SLO criterion actually failed? Map the failing pass/fail line to its
  // scoring axis AND a guaranteed-actionable fallback hint, so the banner is
  // useful even when the mapped axis scored 100 (e.g. a transient spike that
  // doesn't dent the steady-state scalability score).
  const failKeyword: { match: string; label: string; axis: keyof Scores; fallback: string }[] = [
    { match: "Cost", label: "Cost", axis: "cost", fallback: "You're over budget — swap oversized tiers for more, smaller instances, trim spare replicas/shards, and remove anything unused." },
    { match: "Availability", label: "Availability", axis: "reliability", fallback: "Availability dipped — add redundancy (replicas, multiple instances, a load balancer) so a single failure doesn't drop requests." },
    { match: "Error", label: "Error rate", axis: "scalability", fallback: "Errors spiked — a component ran out of capacity under load. Add headroom on the busiest node (bigger tier or more instances) and a cache to absorb reads." },
    { match: "latency", label: "p95 latency", axis: "latency", fallback: "p95 was too high — latency explodes past ~80% utilization. Cache hot reads, add replicas, or scale the busiest tier." },
  ];
  const failingReason = result.reasons.find((r) => !r.includes("✓"));
  const blocker = failingReason ? failKeyword.find((f) => failingReason.includes(f.match)) ?? null : null;

  const hasContent = (k: keyof Scores) => {
    const ex = result.breakdown?.[k];
    return !!ex && (ex.tips.length > 0 || ex.reasons.length > 0);
  };
  // banner tips: prefer the mapped axis's own tips, else the hand-written fallback
  const blockerTips = blocker
    ? (result.breakdown?.[blocker.axis]?.tips.length ? result.breakdown![blocker.axis].tips : [blocker.fallback])
    : [];

  // default the detail cards to the most actionable axis: the blocker if it has
  // content, else the lowest-scoring axis that has content, else the lowest.
  const weakest = AXES.reduce((lo, a) => (result.scores[a.key] < result.scores[lo.key] ? a : lo), AXES[0]);
  const weakestWithContent = [...AXES].sort((a, b) => result.scores[a.key] - result.scores[b.key]).find((a) => hasContent(a.key));
  const defaultAxis: keyof Scores = (blocker && hasContent(blocker.axis) && blocker.axis) || weakestWithContent?.key || weakest.key;
  const activeAxis = selectedAxis ?? defaultAxis;
  const activeLabel = AXES.find((a) => a.key === activeAxis)!.label;
  const activeExplain = result.breakdown?.[activeAxis];

  return (
    <Modal open wide onClose={dismissResult}>
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

      {/* Solutions are opt-in. Show a "Stuck?" button; reveal the fix only on request. */}
      {!result.passed && blocker && (
        showHelp ? (
          <div className="mt-3 rounded-md border border-warn/40 bg-warn/5 p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-warn">
              💡 Fix this first — {blocker.label} is what failed the level
            </div>
            <ul className="space-y-1">
              {blockerTips.map((t, i) => (
                <li key={i} className="flex gap-2 text-xs leading-snug text-ink-200">
                  <span className="shrink-0 text-ok">→</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-ink-700 bg-ink-900 p-3">
            <span className="text-xs text-ink-400">
              Try to work out the fix yourself first — check the scores below and ask the mentor. Still stuck?
            </span>
            <Button variant="secondary" className="shrink-0" onClick={() => setShowHelp(true)}>
              🆘 Stuck? Show me what to fix
            </Button>
          </div>
        )
      )}

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
            {activeExplain.tips.length > 0 &&
              (showHelp ? (
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
              ) : (
                <div className="border-t border-ink-700 pt-2">
                  <button
                    onClick={() => setShowHelp(true)}
                    className="text-[11px] font-medium text-accent hover:underline"
                  >
                    🆘 Stuck? Reveal how to improve this →
                  </button>
                </div>
              ))}
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

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => { exitToMenu(); router.push("/"); }}>
          Menu
        </Button>
        <Button variant="ghost" onClick={dismissResult}>
          Inspect the wreckage
        </Button>
        <Button variant="ghost" onClick={restartFromStarter} title="Discard your design and rebuild the original starter architecture">
          From scratch
        </Button>
        <Button variant="secondary" onClick={resetRun} title="Keep your architecture and replay the simulation from the start">
          ↺ Retry (keep my build)
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
