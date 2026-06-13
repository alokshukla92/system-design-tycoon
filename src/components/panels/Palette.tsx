"use client";

import { CATALOG, PALETTE_ORDER } from "@/lib/catalog/components";
import type { ComponentKind } from "@/lib/types";
import { useGame } from "@/state/store";

export function Palette() {
  const level = useGame((s) => s.level);
  const incident = useGame((s) => s.incident);
  const interview = useGame((s) => s.interview);

  // campaign restricts the palette; incident/interview unlock everything
  const unlocked: ComponentKind[] | null = level
    ? [...level.unlocked, "worker", "monitoring"]
    : incident || interview
      ? null
      : [];

  return (
    <div className="space-y-3 p-3">
      <p className="text-[11px] leading-snug text-ink-400">
        Drag components onto the canvas. Connect them by dragging between handles.
      </p>
      {PALETTE_ORDER.map(({ category, label }) => {
        const items = Object.values(CATALOG).filter(
          (c) => c.category === category && (unlocked === null || unlocked.includes(c.kind))
        );
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((c) => (
                <div
                  key={c.kind}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/sdt-component", c.kind);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  title={c.description}
                  className="flex cursor-grab items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-[11px] text-ink-200 transition-colors hover:border-accent/60 hover:bg-ink-700 active:cursor-grabbing"
                >
                  <span className="text-sm">{c.icon}</span>
                  <span className="truncate">{c.shortName}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {level && (
        <p className="text-[10px] italic leading-snug text-ink-500">
          More components unlock as your company grows.
        </p>
      )}
    </div>
  );
}
