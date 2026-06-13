"use client";

import { useEffect, useRef } from "react";
import { useGame } from "@/state/store";
import { Badge, cn } from "@/components/ui";
import type { EventSeverity } from "@/lib/types";

const SEV_META: Record<EventSeverity, { tone: "ok" | "warn" | "crit" | "accent" | "default"; label: string }> = {
  info: { tone: "accent", label: "info" },
  warn: { tone: "warn", label: "warn" },
  crit: { tone: "crit", label: "alert" },
  resolve: { tone: "ok", label: "resolved" },
  mentor: { tone: "default", label: "mentor" },
};

export function EventLog() {
  const events = useGame((s) => s.events);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-ink-500">
        Incidents and alerts will stream in here. Quiet… for now.
      </div>
    );
  }

  return (
    <div className="space-y-1.5 p-2">
      {events.map((e) => {
        const meta = SEV_META[e.severity];
        return (
          <div
            key={e.id}
            className={cn(
              "rounded-md border px-2 py-1.5",
              e.severity === "crit"
                ? "border-crit/40 bg-crit/5"
                : e.severity === "resolve"
                  ? "border-ok/40 bg-ok/5"
                  : "border-ink-700 bg-ink-800/60"
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] text-ink-500">t+{e.tick}m</span>
              <Badge tone={meta.tone}>{meta.label}</Badge>
              <span className="truncate text-[11px] font-medium text-ink-100">{e.title}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-line text-[11px] leading-snug text-ink-300">{e.detail}</p>
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
