"use client";

import { Badge, Button, Modal } from "@/components/ui";

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <Modal open wide onClose={onClose}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-ink-100">How to play</h2>
        <Badge tone="accent">CTO field manual</Badge>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-ink-300">
        You design an architecture on the canvas, press <strong className="text-ink-100">Launch</strong>, and watch
        real simulated traffic flow through it. Things break the way they break in production — your job is to spot
        it and fix it. Here&rsquo;s the mechanics.
      </p>

      <div className="space-y-3">
        <Step n={1} title="Add a component">
          Open the <strong className="text-ink-100">🧰 Components</strong> tab on the right, then{" "}
          <strong className="text-ink-100">drag</strong> a component onto the canvas. (In Startup Career, more
          components unlock as your company grows.)
        </Step>

        <Step n={2} title="Connect components — this is the key one">
          Every node has small <strong className="text-ink-100">circular handles</strong>: one on its{" "}
          <strong className="text-ink-100">right edge</strong> (output) and one on its{" "}
          <strong className="text-ink-100">left edge</strong> (input). To wire two components, press on the{" "}
          <strong className="text-ink-100">right-edge dot</strong> of one and{" "}
          <strong className="text-ink-100">drag a line</strong> to the{" "}
          <strong className="text-ink-100">left-edge dot</strong> of the next, then release.
          <div className="mt-2 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-[11px] text-ink-200">
            Traffic flows left → right: &nbsp; Users → API Server → Database
          </div>
        </Step>

        <Step n={3} title="Configure a component">
          <strong className="text-ink-100">Click</strong> any node, then open the{" "}
          <strong className="text-ink-100">🔍 Inspect</strong> tab to change its size (vertical scaling), instance
          count (horizontal scaling), replicas, caching strategy, shard key, reliability toggles, and so on.
        </Step>

        <Step n={4} title="Delete a component or connection">
          Click a node or a connection line to select it, then press{" "}
          <strong className="text-ink-100">Delete</strong> or <strong className="text-ink-100">Backspace</strong>.
          (The Users node can&rsquo;t be removed.)
        </Step>

        <Step n={5} title="Run the simulation">
          Press <strong className="text-ink-100">▶ Launch</strong> (top-right). Watch the{" "}
          <strong className="text-ink-100">metrics strip</strong> at the bottom and the{" "}
          <strong className="text-ink-100">utilization bars</strong> on each node. Use{" "}
          <strong className="text-ink-100">1× / 2× / 4×</strong> for speed, and{" "}
          <strong className="text-ink-100">⏸ Pause</strong> anytime to redesign mid-run.
        </Step>

        <Step n={6} title="Read the board">
          Node and edge colors show health: <span className="text-ok">green</span> = healthy,{" "}
          <span className="text-warn">amber</span> = strained, <span className="text-crit">red</span> = failing. The{" "}
          <strong className="text-ink-100">📟 Events</strong> tab streams alerts (symptoms only — you investigate),{" "}
          <strong className="text-ink-100">👩‍💻 Mentor</strong> asks guiding questions, and the{" "}
          <strong className="text-ink-100">scores</strong> up top grade your design — hover any score to see{" "}
          <em>why</em> and <em>how to improve it</em>.
        </Step>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          What connects to what — quick cheatsheet
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Recipe icon="⚖️" name="Load Balancer" flow="Users → LB → API ×N">
            Only helps with 2+ API instances behind it. Spreads traffic and reroutes around crashes.
          </Recipe>
          <Recipe icon="🟥" name="Cache (Redis)" flow="API → Redis  and  API → DB">
            Absorbs repeated reads before they hit the database. Keep the DB connected too — for cache misses.
          </Recipe>
          <Recipe icon="🪵" name="Queue (Kafka/SQS)" flow="API → Queue → Worker → DB">
            Buffers write bursts so the database sees a smooth drain instead of a spike. Needs a Worker to consume it.
          </Recipe>
          <Recipe icon="🌍" name="CDN" flow="Users → CDN → LB/API">
            Serves static content (images, video, bundles) from the edge, cutting latency and origin load.
          </Recipe>
          <Recipe icon="🔎" name="Search (Elasticsearch)" flow="API → Elasticsearch">
            Handles text-search queries that would otherwise scan the whole database.
          </Recipe>
          <Recipe icon="📈" name="Observability" flow="API → O11y,  DB → O11y">
            Not in the traffic path — it just needs to exist to unlock 🔬 diagnostics. Connect it to what it watches so it isn&rsquo;t flagged as disconnected.
          </Recipe>
        </div>
      </div>

      <p className="mt-4 text-xs italic leading-snug text-ink-500">
        The golden rule: a component only helps if traffic can actually reach it. If a node shows no traffic during
        a run, check that it&rsquo;s wired into the path from Users.
      </p>

      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Got it →
        </Button>
      </div>
    </Modal>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 font-mono text-xs font-bold text-accent">
        {n}
      </span>
      <div>
        <div className="text-sm font-semibold text-ink-100">{title}</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-ink-300">{children}</div>
      </div>
    </div>
  );
}

function Recipe({
  icon,
  name,
  flow,
  children,
}: {
  icon: string;
  name: string;
  flow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-ink-700 bg-ink-900 p-2.5">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-100">
        <span>{icon}</span> {name}
      </div>
      <div className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-accent">{flow}</div>
      <p className="mt-1 text-[11px] leading-snug text-ink-400">{children}</p>
    </div>
  );
}
