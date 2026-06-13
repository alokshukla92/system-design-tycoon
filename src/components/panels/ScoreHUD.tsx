"use client";

import { useGame } from "@/state/store";
import { cn } from "@/components/ui";
import type { Scores } from "@/lib/types";

const AXES: { key: keyof Scores; label: string; icon: string }[] = [
  { key: "scalability", label: "Scale", icon: "📈" },
  { key: "reliability", label: "Reliability", icon: "🛡️" },
  { key: "latency", label: "Latency", icon: "⚡" },
  { key: "cost", label: "Cost", icon: "💰" },
  { key: "maintainability", label: "Maint", icon: "🔧" },
  { key: "complexity", label: "Simplicity", icon: "🧩" },
];

export function ScoreHUD() {
  const scores = useGame((s) => s.scores);
  const breakdown = useGame((s) => s.scoreBreakdown);
  if (!scores) return null;

  return (
    <div className="flex items-center gap-3">
      {AXES.map(({ key, label, icon }) => {
        const v = scores[key];
        const ex = breakdown?.[key];
        const hasDetail = ex && (ex.reasons.length > 0 || ex.tips.length > 0);
        return (
          <div key={key} className="group relative flex items-center gap-1">
            <span className="text-xs">{icon}</span>
            <div className="hidden text-[9px] uppercase tracking-wide text-ink-400 xl:block">{label}</div>
            <span
              className={cn(
                "font-mono text-xs font-semibold",
                v >= 75 ? "text-ok" : v >= 50 ? "text-warn" : "text-crit"
              )}
            >
              {v}
            </span>

            {/* hover popover: why this score + how to improve */}
            <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-72 group-hover:block">
              <div className="rounded-lg border border-ink-600 bg-ink-850 p-3 text-left shadow-2xl">
                <div className="mb-1.5 text-[11px] font-semibold text-ink-100">
                  {label} <span className="font-mono text-ink-400">{v}/100</span>
                </div>
                {hasDetail ? (
                  <div className="space-y-1.5">
                    {ex!.reasons.map((r, i) => (
                      <div key={i} className="flex gap-1.5 text-[11px] leading-snug text-ink-300">
                        <span className="shrink-0 text-crit">−</span>
                        <span>{r}</span>
                      </div>
                    ))}
                    {ex!.tips.map((t, i) => (
                      <div key={i} className="flex gap-1.5 text-[11px] leading-snug text-ink-200">
                        <span className="shrink-0 text-ok">→</span>
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-ok">Solid — nothing to fix on this axis.</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
