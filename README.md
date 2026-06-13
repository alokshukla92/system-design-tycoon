# System Design Tycoon 🏗️

A browser game that teaches **large-scale system design** by simulation, not quizzes.

You are the CTO. You drag real components — PostgreSQL, MongoDB, Cassandra, DynamoDB, Redis, Kafka, load balancers, Kubernetes, CDNs — onto a canvas and wire them together. Every component has **actually simulated** throughput, latency, storage limits, replication behavior, and failure modes. Traffic grows, things break in realistic ways (cache stampedes, retry storms, hot partitions, replication lag, consumer backlog), and you learn by fixing them.

**Learning philosophy:** Problem → Failure → Investigation → Fix → Explanation. The game never teaches first — concepts are explained in the debrief *after* you've fought the failure they cause.

## Getting started

```bash
npm install
npm run dev        # → http://localhost:3000
```

```bash
npm test           # simulation engine unit tests (vitest)
npm run build      # production build
node scripts/smoke-e2e.mjs   # browser smoke test (needs Chrome + `npm i --no-save playwright-core`, dev server running)
```

## Game modes

| Mode | What it is |
|---|---|
| 🚀 **Startup Career** | 10 levels, 100 → 100M users. URL shortener → chat → photos → rides → e-commerce → global video. Each level's lesson (indexing, caching, replication, sharding, queues, idempotency, multi-region) emerges from a scripted disaster. |
| 🔥 **Incident Commander** | Join a company mid-outage. The architecture is pre-built (badly). Diagnose from symptoms, fix live, stop the revenue bleed. |
| 🎯 **Architecture Interview** | Design Twitter / WhatsApp / YouTube on a blank canvas. The engine stress-tests your design at three traffic tiers (plus viral hot-key events) and produces a FAANG-style hire/no-hire rubric. |

## How the simulation works

- **Tick-based** (1 tick = 1 simulated minute), fully deterministic with a seeded RNG.
- Traffic flows along your edges: CDN absorbs static reads → load balancer splits across compute → cache absorbs hot reads by hit-ratio → queues buffer writes for workers to drain → the rest lands on databases.
- Per-node **queueing math**: latency ∝ 1/(1−utilization), so latency explodes *before* you run out of capacity, just like production.
- **Emergent cascades**: an overloaded DB causes timeouts → retries amplify load (retry storm) → cascade, unless a circuit breaker or rate limiter intervenes.
- Failures announce **symptoms only** ("one shard at 100%, seven idle") — the explanation arrives when you fix it.
- **Priya**, the rule-based Staff Engineer mentor, asks Socratic questions and never gives answers.
- Live 6-axis scoring: scalability (capacity-ceiling probe), reliability (SPOF analysis), latency, cost, maintainability, and simplicity (over-engineering at small scale is penalized!).

## Project structure

```
src/
  lib/
    types.ts                  # domain types
    catalog/components.ts     # component specs: capacity, latency, tiers, configs, failure profiles
    simulation/engine.ts      # tick engine: demand → flow → queueing → cascades
    simulation/failures.ts    # signal tracking, scripted disasters, symptom/lesson text
    simulation/scoring.ts     # 6-axis scores, SPOF analysis, capacity-ceiling probe
    mentor/mentor.ts          # rule-based Socratic mentor (pluggable provider interface)
    game/levels.ts            # campaign (10 levels)
    game/incidents.ts         # incident scenarios (5)
    game/interviews.ts        # interview prompts (3)
    game/evaluate.ts          # interview stress-test rubric
  state/store.ts              # Zustand store: graph, sim loop, modes, persistence
  components/
    canvas/                   # React Flow canvas, live nodes, animated traffic edges
    panels/                   # palette, inspector, metrics, events, mentor, scores, controls
    screens/                  # brief / debrief / interview report
    ui/                       # hand-rolled shadcn-style primitives
  app/                        # Next.js App Router pages
```

Built with Next.js 14, TypeScript, Tailwind, React Flow (@xyflow/react), Zustand, Vitest.

> Numbers are tuned for gameplay but directionally realistic — relative throughput/latency/cost between technologies mirrors the real world, so the tradeoffs you learn transfer.
