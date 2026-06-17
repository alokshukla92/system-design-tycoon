"use client";

import { useGame } from "@/state/store";
import { Button, cn } from "@/components/ui";

export function SimControls() {
  const phase = useGame((s) => s.phase);
  const running = useGame((s) => s.running);
  const speed = useGame((s) => s.speed);
  const tick = useGame((s) => s.tick);
  const mode = useGame((s) => s.mode);
  const level = useGame((s) => s.level);
  const incident = useGame((s) => s.incident);
  const run = useGame((s) => s.run);
  const pause = useGame((s) => s.pause);
  const setSpeed = useGame((s) => s.setSpeed);
  const resetRun = useGame((s) => s.resetRun);
  const submitInterview = useGame((s) => s.submitInterview);

  const duration = level?.durationTicks ?? incident?.durationTicks ?? 0;

  if (mode === "interview") {
    return (
      <Button variant="primary" onClick={submitInterview}>
        📋 Submit design for review
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {running ? (
        <Button variant="secondary" onClick={pause}>
          ⏸ Pause
        </Button>
      ) : (
        <Button variant="primary" onClick={run} disabled={phase === "debrief"}>
          {tick === 0 ? "▶ Launch" : "▶ Resume"}
        </Button>
      )}
      <div className="flex overflow-hidden rounded-md border border-ink-600">
        {([1, 2, 4] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={cn(
              "px-2 py-1 font-mono text-[11px] transition-colors",
              speed === s ? "bg-accent text-onbright" : "bg-ink-800 text-ink-300 hover:bg-ink-700"
            )}
          >
            {s}×
          </button>
        ))}
      </div>
      {duration > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min(100, (tick / duration) * 100)}%` }}
            />
          </div>
          <span className="font-mono text-[10px] text-ink-400">
            {tick}/{duration}m
          </span>
        </div>
      )}
      {tick > 0 && (
        <Button variant="ghost" onClick={resetRun} title="Replay from the start, keeping your current design">
          ↺
        </Button>
      )}
    </div>
  );
}
