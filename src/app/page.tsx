"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, unlockedLevels } from "@/state/store";
import { LEVELS } from "@/lib/game/levels";
import { INCIDENTS } from "@/lib/game/incidents";
import { INTERVIEWS } from "@/lib/game/interviews";
import { Badge, Button, Card, cn } from "@/components/ui";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1000) return `${n / 1000}k`;
  return `${n}`;
}

type Tab = "campaign" | "incident" | "interview";

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("campaign");
  const [hydrated, setHydrated] = useState(false);
  const progress = useGame((s) => s.progress);
  const startLevel = useGame((s) => s.startLevel);
  const startIncident = useGame((s) => s.startIncident);
  const startInterview = useGame((s) => s.startInterview);

  // avoid hydration mismatch with persisted progress
  useEffect(() => setHydrated(true), []);

  const unlocked = hydrated ? unlockedLevels(progress) : [LEVELS[0].id];

  return (
    <div className="h-screen overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-black tracking-tight text-ink-100">
            System Design <span className="text-accent">Tycoon</span>
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
            You are the CTO. Drag real components onto the canvas — every database, cache, and queue has
            simulated throughput, latency, and failure modes. Traffic grows, things break, and you learn
            system design the way it&rsquo;s actually learned: <em className="text-ink-300">by fixing it at 3am</em>.
          </p>
        </header>

        <div className="mb-6 flex justify-center gap-2">
          {(
            [
              { id: "campaign", label: "🚀 Startup Career", desc: "100 → 100M users" },
              { id: "incident", label: "🔥 Incident Commander", desc: "Fix prod. Now." },
              { id: "interview", label: "🎯 Architecture Interview", desc: "Design Twitter" },
            ] as { id: Tab; label: string; desc: string }[]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-lg border px-4 py-2.5 text-left transition-colors",
                tab === t.id
                  ? "border-accent bg-accent/10"
                  : "border-ink-700 bg-ink-850 hover:border-ink-500"
              )}
            >
              <div className="text-sm font-semibold text-ink-100">{t.label}</div>
              <div className="text-[10px] text-ink-400">{t.desc}</div>
            </button>
          ))}
        </div>

        {tab === "campaign" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {LEVELS.map((l) => {
              const isUnlocked = unlocked.includes(l.id);
              const done = hydrated ? progress[l.id] : undefined;
              return (
                <Card
                  key={l.id}
                  className={cn("p-4 transition-colors", isUnlocked ? "hover:border-accent/60" : "opacity-50")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-700 font-mono text-xs font-bold text-ink-200">
                        {l.number}
                      </span>
                      <div>
                        <div className="text-sm font-bold text-ink-100">{l.title}</div>
                        <div className="text-[10px] text-ink-400">{l.project}</div>
                      </div>
                    </div>
                    {done?.passed && <Badge tone="ok">★ {done.overall}</Badge>}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono text-[11px] text-ink-400">
                      {fmt(l.users)} → {fmt(l.usersEnd)} users
                    </span>
                    <Button
                      variant={done?.passed ? "secondary" : "primary"}
                      disabled={!isUnlocked}
                      onClick={() => {
                        startLevel(l.id);
                        router.push("/play");
                      }}
                    >
                      {!isUnlocked ? "🔒 Locked" : done?.passed ? "Replay" : "Play"}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {tab === "incident" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {INCIDENTS.map((inc) => {
              const done = hydrated ? progress[inc.id] : undefined;
              return (
                <Card key={inc.id} className="p-4 hover:border-crit/50">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-ink-100">{inc.title}</div>
                      <div className="text-[10px] text-ink-400">{inc.company} · {fmt(inc.users)} users</div>
                    </div>
                    {done?.passed && <Badge tone="ok">★ {done.overall}</Badge>}
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-snug text-ink-400">{inc.brief[0].replace(/\*\*/g, "")}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <Badge tone="crit">-${inc.revenuePerTick.toLocaleString()}/min</Badge>
                    <Button
                      variant="danger"
                      onClick={() => {
                        startIncident(inc.id);
                        router.push("/play");
                      }}
                    >
                      Respond
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {tab === "interview" && (
          <div className="grid gap-3 sm:grid-cols-3">
            {INTERVIEWS.map((iv) => {
              const done = hydrated ? progress[iv.id] : undefined;
              return (
                <Card key={iv.id} className="p-4 hover:border-accent/60">
                  <div className="text-sm font-bold text-ink-100">{iv.title}</div>
                  <p className="mt-1 line-clamp-3 text-xs leading-snug text-ink-400">{iv.prompt[1]}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-mono text-[10px] text-ink-400">
                      up to {fmt(iv.tiers[iv.tiers.length - 1].users)} users
                    </span>
                    <Button
                      variant="primary"
                      onClick={() => {
                        startInterview(iv.id);
                        router.push("/play");
                      }}
                    >
                      Begin
                    </Button>
                  </div>
                  {done && <div className="mt-2 text-[10px] text-ink-400">Best: {done.overall}/100</div>}
                </Card>
              );
            })}
          </div>
        )}

        <footer className="mt-10 text-center text-[11px] text-ink-500">
          Numbers are tuned for gameplay but directionally realistic — the tradeoffs transfer to production.
        </footer>
      </div>
    </div>
  );
}
