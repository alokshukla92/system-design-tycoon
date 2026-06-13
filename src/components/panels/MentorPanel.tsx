"use client";

import { useEffect, useRef } from "react";
import { useGame } from "@/state/store";
import { cn } from "@/components/ui";

const KIND_ICON = { question: "🤔", observation: "👀", tradeoff: "⚖️", praise: "🌟" } as const;

export function MentorPanel() {
  const messages = useGame((s) => s.mentorMessages);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet/20 text-sm">👩‍💻</div>
        <div>
          <div className="text-xs font-semibold text-ink-100">Priya</div>
          <div className="text-[10px] text-ink-400">Staff Engineer · asks, never tells</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {messages.length === 0 && (
          <p className="p-2 text-[11px] italic leading-snug text-ink-500">
            &ldquo;I&rsquo;ll be watching your design. When I see something interesting, I&rsquo;ll ask you about
            it. I won&rsquo;t give you answers — that&rsquo;s not how you&rsquo;ll learn this.&rdquo;
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "rounded-lg rounded-tl-none border px-2.5 py-2 text-[11px] leading-relaxed",
              m.kind === "praise"
                ? "border-ok/30 bg-ok/5 text-ink-100"
                : "border-violet/30 bg-violet/5 text-ink-200"
            )}
          >
            <span className="mr-1">{KIND_ICON[m.kind]}</span>
            {m.text}
            <div className="mt-1 font-mono text-[9px] text-ink-500">t+{m.tick}m</div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
}
