"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGame } from "@/state/store";
import { Canvas } from "@/components/canvas/Canvas";
import { Palette } from "@/components/panels/Palette";
import { Inspector } from "@/components/panels/Inspector";
import { MetricsPanel } from "@/components/panels/MetricsPanel";
import { EventLog } from "@/components/panels/EventLog";
import { MentorPanel } from "@/components/panels/MentorPanel";
import { ScoreHUD } from "@/components/panels/ScoreHUD";
import { SimControls } from "@/components/panels/SimControls";
import { Brief } from "@/components/screens/Brief";
import { Debrief } from "@/components/screens/Debrief";
import { InterviewReportModal } from "@/components/screens/InterviewReport";
import { Button, Tabs } from "@/components/ui";

const TICK_MS = 700;

export function GameScreen() {
  const router = useRouter();
  const mode = useGame((s) => s.mode);
  const level = useGame((s) => s.level);
  const incident = useGame((s) => s.incident);
  const interview = useGame((s) => s.interview);
  const running = useGame((s) => s.running);
  const speed = useGame((s) => s.speed);
  const events = useGame((s) => s.events);
  const mentorMessages = useGame((s) => s.mentorMessages);
  const exitToMenu = useGame((s) => s.exitToMenu);
  const selectedNodeId = useGame((s) => s.selectedNodeId);
  const [rightTab, setRightTab] = useState("palette");

  // selecting a node on the canvas jumps to its inspector
  useEffect(() => {
    if (selectedNodeId) setRightTab("inspect");
  }, [selectedNodeId]);

  // simulation clock
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => useGame.getState().tickOnce(), TICK_MS / speed);
    return () => clearInterval(id);
  }, [running, speed]);

  // no scenario loaded → back to menu
  useEffect(() => {
    if (!mode) router.replace("/");
  }, [mode, router]);

  if (!mode) return null;

  const title = level
    ? `Level ${level.number}: ${level.title}`
    : incident
      ? incident.title
      : interview?.title ?? "";

  const subtitle = level?.project ?? incident?.company ?? "Architecture interview";

  return (
    <div className="flex h-screen flex-col bg-ink-950">
      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-ink-700 bg-ink-900 px-3">
        <Button variant="ghost" className="px-2 text-xs" onClick={() => { exitToMenu(); router.push("/"); }}>
          ← Menu
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-ink-100">{title}</div>
          <div className="truncate text-[10px] text-ink-400">{subtitle}</div>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <ScoreHUD />
          <SimControls />
        </div>
      </header>

      {/* main area */}
      <div className="flex min-h-0 flex-1">
        {/* left: events + mentor */}
        <aside className="w-72 shrink-0 border-r border-ink-700 bg-ink-900">
          <Tabs
            tabs={[
              { id: "events", label: "📟 Events", content: <EventLog />, badge: events.length || undefined },
              { id: "mentor", label: "👩‍💻 Mentor", content: <MentorPanel />, badge: mentorMessages.length || undefined },
            ]}
          />
        </aside>

        {/* center: canvas */}
        <main className="min-w-0 flex-1">
          <Canvas />
        </main>

        {/* right: palette + inspector */}
        <aside className="w-72 shrink-0 border-l border-ink-700 bg-ink-900">
          <Tabs
            tabs={[
              { id: "inspect", label: "🔍 Inspect", content: <Inspector /> },
              { id: "palette", label: "🧰 Components", content: <Palette /> },
            ]}
            active={rightTab}
            onChange={setRightTab}
          />
        </aside>
      </div>

      {/* bottom: metrics */}
      <footer className="h-20 shrink-0 border-t border-ink-700 bg-ink-900">
        <MetricsPanel />
      </footer>

      <Brief />
      <Debrief />
      <InterviewReportModal />
    </div>
  );
}
