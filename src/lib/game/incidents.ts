import type { ComponentKind, GraphSnapshot, IncidentDef } from "@/lib/types";
import { defaultConfig } from "@/lib/catalog/components";

// ─────────────────────────────────────────────────────────────────────────────
// Incident Commander mode: you join a company mid-disaster. The architecture
// is already built (badly). Diagnose from symptoms, fix live, stop the bleed.
// ─────────────────────────────────────────────────────────────────────────────

interface NodeSpec {
  id: string;
  kind: ComponentKind;
  label: string;
  x: number;
  y: number;
  tier?: string;
  instances?: number;
  config?: Record<string, string | number | boolean>;
}

function build(nodes: NodeSpec[], edges: [string, string][]): GraphSnapshot {
  return {
    nodes: nodes.map((s) => ({
      id: s.id,
      position: { x: s.x, y: s.y },
      data: {
        kind: s.kind,
        label: s.label,
        tier: s.tier ?? "small",
        instances: s.instances ?? 1,
        config: { ...defaultConfig(s.kind), ...(s.config ?? {}) },
      },
    })),
    edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target })),
  };
}

export const INCIDENTS: IncidentDef[] = [
  {
    id: "inc-meltdown",
    title: "Code Red at ticketblitz",
    company: "ticketblitz — event ticketing",
    users: 800_000,
    durationTicks: 90,
    revenuePerTick: 1800,
    brief: [
      "**09:02** — You just joined ticketblitz as the new infra lead. Calendar says 'onboarding'. Slack says **#incident-checkout-down (327 unread)**.",
      "A superstar tour went on sale at 09:00. The site is timing out. Every minute down is ~$1,800 in lost sales.",
      "The previous architect believed in 'keeping things simple': every request goes straight to the database. The database disagrees.",
      "Diagnose. Fix. You have full production access and zero context. Welcome aboard.",
    ],
    workload: {
      rpsPerKUsers: 12, readRatio: 0.85, staticRatio: 0.3, searchRatio: 0,
      storageGbPerDayPer10k: 6, peakMult: 1.5, skew: 0.8, needsStrongConsistency: true,
    },
    slo: { maxP95Ms: 400, minAvailabilityPct: 99, maxErrorRate: 0.05, maxMonthlyBudget: 25_000 },
    starter: build(
      [
        { id: "u", kind: "users", label: "Users", x: 60, y: 200 },
        { id: "lb", kind: "load_balancer", label: "ALB", x: 280, y: 200 },
        { id: "api", kind: "api_server", label: "Checkout API", x: 500, y: 200, instances: 12, config: { retries: true } },
        { id: "db", kind: "postgres", label: "Main DB", x: 740, y: 200, tier: "large", config: { indexing: "tuned" } },
      ],
      [["u", "lb"], ["lb", "api"], ["api", "db"]]
    ),
    scripted: [
      { atTick: 2, type: "traffic_spike", magnitude: 5, durationTicks: 80, announcement: "Tour tickets LIVE. Traffic is 5× and not coming down." },
    ],
    winCondition: { maxErrorRate: 0.05, stableTicks: 12 },
    debrief: {
      concept: "Read offload & retry storms under fan-in load",
      explanation: [
        "Every page view hit the database directly — for data that's identical for every user (seat maps, event details). A cache absorbs that fan-in; the DB should only see what's truly per-user.",
        "Worse: the API retried every failed call against the drowning DB, roughly doubling its load. Retries without a circuit breaker turn overload into collapse.",
      ],
      tradeoffs: [
        "Adding a cache mid-incident is a valid emergency move precisely because cache-aside needs no data migration.",
        "A rate limiter would have kept the site degraded-but-alive: serving 80% of users beats serving 0%.",
      ],
    },
  },

  {
    id: "inc-cache-down",
    title: "The Cache That Saved Too Well",
    company: "newsly — news aggregator",
    users: 2_000_000,
    durationTicks: 80,
    revenuePerTick: 900,
    brief: [
      "**14:30** — newsly's Redis cluster just dropped dead mid-news-cycle. The site went down with it.",
      "Here's the uncomfortable part: the cache was absorbing 85% of all reads. The database underneath was sized for the *remaining 15%*. Nobody ever tested the miss path.",
      "Restarting Redis gets you a cold, empty cache — and the thundering herd will kill the DB again before it warms up. Think before you act.",
    ],
    workload: {
      rpsPerKUsers: 10, readRatio: 0.95, staticRatio: 0.25, searchRatio: 0,
      storageGbPerDayPer10k: 3, peakMult: 1.4, skew: 0.6, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 350, minAvailabilityPct: 99, maxErrorRate: 0.05, maxMonthlyBudget: 30_000 },
    starter: build(
      [
        { id: "u", kind: "users", label: "Users", x: 60, y: 200 },
        { id: "lb", kind: "load_balancer", label: "ALB", x: 260, y: 200 },
        { id: "api", kind: "api_server", label: "API", x: 460, y: 200, instances: 24, config: { retries: true } },
        { id: "redis", kind: "redis", label: "Redis", x: 680, y: 120, config: { ttl: "long" } },
        { id: "db", kind: "mysql", label: "MySQL", x: 680, y: 290, tier: "medium", config: { indexing: "tuned" } },
      ],
      [["u", "lb"], ["lb", "api"], ["api", "redis"], ["api", "db"]]
    ),
    scripted: [
      { atTick: 2, type: "node_crash", targetKind: "redis", announcement: "Redis primary unreachable. Hit ratio: 0%. Database inbound: vertical line." },
    ],
    winCondition: { maxErrorRate: 0.05, stableTicks: 12 },
    debrief: {
      concept: "Cache dependency & the cold-start thundering herd",
      explanation: [
        "A cache that absorbs 85% of reads isn't an optimization anymore — it's load-bearing infrastructure, and its failure is a database 6×-overload event.",
        "Recovery order matters: bring the DB up to survivable capacity (replicas, bigger tier, rate limiting the edge) *before* warming the cache, or the herd kills it again.",
      ],
      tradeoffs: [
        "Sizing the DB for full cache-miss traffic doubles your cost for an event that happens rarely — most teams instead keep a rate limiter ready to degrade gracefully.",
        "Redis replication (a replica set for the cache itself) makes the cache crash a non-event. Caches deserve redundancy too once they're load-bearing.",
      ],
    },
  },

  {
    id: "inc-backlog",
    title: "Eight Million Messages Behind",
    company: "shipwell — logistics platform",
    users: 1_500_000,
    durationTicks: 90,
    revenuePerTick: 1100,
    brief: [
      "**11:15** — Warehouse scanners across the country send package-scan events through Kafka. Dashboards are showing data from **47 minutes ago** and falling further behind.",
      "Consumer lag: 8.2 million messages. Producers: fine. Brokers: fine. So what's wrong?",
      "Customers are calling support asking where their packages are. The COO is calling you.",
    ],
    workload: {
      rpsPerKUsers: 8, readRatio: 0.35, staticRatio: 0.05, searchRatio: 0,
      storageGbPerDayPer10k: 10, peakMult: 1.8, skew: 0.3, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 400, minAvailabilityPct: 99, maxErrorRate: 0.05, maxMonthlyBudget: 35_000 },
    starter: build(
      [
        { id: "u", kind: "users", label: "Scanners + Apps", x: 60, y: 200 },
        { id: "lb", kind: "load_balancer", label: "NLB", x: 250, y: 200 },
        { id: "api", kind: "api_server", label: "Ingest API", x: 440, y: 200, instances: 16 },
        { id: "kafka", kind: "kafka", label: "Kafka", x: 650, y: 140, config: { partitions: 4, keying: "balanced" } },
        { id: "workers", kind: "worker", label: "Consumers", x: 860, y: 140, instances: 2 },
        { id: "db", kind: "cassandra", label: "Event Store", x: 860, y: 300, instances: 4, config: { partitionKey: "balanced" } },
      ],
      [["u", "lb"], ["lb", "api"], ["api", "kafka"], ["kafka", "workers"], ["workers", "db"], ["api", "db"]]
    ),
    scripted: [
      { atTick: 5, type: "traffic_spike", magnitude: 2.2, durationTicks: 70, announcement: "Holiday shipping volume: scan events 2× normal, all day." },
    ],
    winCondition: { maxErrorRate: 0.05, stableTicks: 15 },
    debrief: {
      concept: "Consumer lag — the queue is fine, the drain is not",
      explanation: [
        "The brokers were healthy because Kafka's job is to *hold* messages — it was holding 8 million of them beautifully. The failure was downstream: consumer throughput < producer throughput, permanently.",
        "Two levers fix a drain problem: more consumers AND enough partitions for them to share. With 4 partitions, consumers 5+ stand idle — partition count caps consumer parallelism.",
      ],
      tradeoffs: [
        "Adding partitions is easy at creation and annoying later (rebalancing, ordering boundaries change). Overprovision partitions early.",
        "Catching up a deep backlog needs drain rate > arrival rate with margin — temporarily overscale workers, then scale back. Sizing for exactly steady-state means you never recover from any dip.",
      ],
    },
  },

  {
    id: "inc-hotshard",
    title: "One Shard To Rule Them All",
    company: "gamerly — game stats platform",
    users: 5_000_000,
    durationTicks: 80,
    revenuePerTick: 1300,
    brief: [
      "**20:05** — A new game launched tonight and gamerly tracks its live player stats. The stats DB is sharded 8 ways, so capacity *should* be fine…",
      "…except shard 3 is at 100% CPU and the other seven are napping. Latency alerts everywhere. The on-call DBA quit last week (unrelated, probably).",
      "Why does one shard have all the fun? Find out and spread the load.",
    ],
    workload: {
      rpsPerKUsers: 9, readRatio: 0.7, staticRatio: 0.1, searchRatio: 0,
      storageGbPerDayPer10k: 18, peakMult: 2, skew: 0.85, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 350, minAvailabilityPct: 99, maxErrorRate: 0.05, maxMonthlyBudget: 40_000 },
    starter: build(
      [
        { id: "u", kind: "users", label: "Players", x: 60, y: 200 },
        { id: "lb", kind: "load_balancer", label: "ALB", x: 250, y: 200 },
        { id: "k8s", kind: "k8s_cluster", label: "Stats Service", x: 450, y: 200, config: { minPods: 8, maxPods: 40 } },
        { id: "redis", kind: "redis", label: "Leaderboard Cache", x: 670, y: 120, config: { ttl: "long_jitter" } },
        { id: "db", kind: "mongodb", label: "Stats DB (sharded)", x: 670, y: 290, tier: "medium", config: { indexing: "tuned", shards: 8, shardKey: "monotonic" } },
      ],
      [["u", "lb"], ["lb", "k8s"], ["k8s", "redis"], ["k8s", "db"]]
    ),
    scripted: [
      { atTick: 3, type: "hot_key", durationTicks: 60, announcement: "🎮 Launch night: one new game id is receiving nearly every write on the platform." },
      { atTick: 5, type: "traffic_spike", magnitude: 2, durationTicks: 60, announcement: "Player count doubling as streamers come online." },
    ],
    winCondition: { maxErrorRate: 0.05, stableTicks: 12 },
    debrief: {
      concept: "Hot partitions & shard-key surgery",
      explanation: [
        "The shard key was the game id with monotonic insert patterns — tonight, one game IS the traffic, so one shard ate nearly everything. Eight shards, one bottleneck: paid for 8×, got 1×.",
        "Re-keying to a hashed/composite key (game id + player id bucket) spreads a single hot entity across all shards. The cache absorbing leaderboard reads bought time while writes rebalanced.",
      ],
      tradeoffs: [
        "Hashed keys kill cheap range queries ('top scores this hour' becomes scatter-gather). You traded query convenience for write survival.",
        "Live re-sharding under fire is the most expensive way to learn shard-key design. The cheap way: model your most-viral entity *before* picking the key.",
      ],
    },
  },

  {
    id: "inc-region",
    title: "The Region Is Down. The Region Is You.",
    company: "medichart — health records SaaS",
    users: 3_000_000,
    durationTicks: 90,
    revenuePerTick: 2500,
    brief: [
      "**03:11** — Your cloud provider's status page just turned red: a major regional outage. Half your capacity evaporated mid-sentence.",
      "medichart serves hospitals. Doctors are mid-shift, pulling up patient records. 'Down' is not a word you get to use.",
      "Everything lives in one region because 'multi-region was on the roadmap for Q3'. It is currently Q2. Survive the night, then build it right.",
    ],
    workload: {
      rpsPerKUsers: 7, readRatio: 0.9, staticRatio: 0.2, searchRatio: 0.05,
      storageGbPerDayPer10k: 8, peakMult: 1.3, skew: 0.2, needsStrongConsistency: true,
    },
    slo: { maxP95Ms: 400, minAvailabilityPct: 99.5, maxErrorRate: 0.04, maxMonthlyBudget: 50_000 },
    starter: build(
      [
        { id: "u", kind: "users", label: "Hospitals", x: 60, y: 200 },
        { id: "lb", kind: "load_balancer", label: "ALB", x: 250, y: 200 },
        { id: "api", kind: "api_server", label: "Records API", x: 450, y: 200, tier: "medium", instances: 10, config: { circuitBreaker: true } },
        { id: "redis", kind: "redis", label: "Session Cache", x: 660, y: 120 },
        { id: "db", kind: "postgres", label: "Records DB", x: 660, y: 290, tier: "large", config: { indexing: "tuned", readReplicas: 1 } },
        { id: "es", kind: "elasticsearch", label: "Search", x: 880, y: 200 },
      ],
      [["u", "lb"], ["lb", "api"], ["api", "redis"], ["api", "db"], ["api", "es"]]
    ),
    scripted: [
      { atTick: 3, type: "region_failure", magnitude: 0.5, durationTicks: 45, announcement: "🌩️ REGIONAL OUTAGE. ~50% of your instance capacity is unreachable. Provider ETA: 'investigating'." },
      { atTick: 60, type: "traffic_spike", magnitude: 1.5, durationTicks: 20, announcement: "Morning shift starting on the East Coast. Traffic climbing on your wounded fleet." },
    ],
    winCondition: { maxErrorRate: 0.04, stableTicks: 15 },
    debrief: {
      concept: "Disaster recovery & capacity for failure",
      explanation: [
        "When a region degrades, survival = (remaining capacity) > (current demand). You got through by overscaling what survived and shedding non-critical load — DR in its rawest form.",
        "The durable fix is capacity in more than one failure domain: multi-AZ first (cheap, easy), multi-region for the SLAs that justify it. Managed services (DynamoDB, SQS, ALB) are already multi-AZ — one reason they cost more on paper and less in incidents.",
      ],
      tradeoffs: [
        "N+1 region capacity means paying for headroom that idles ~99% of the time. For hospital software, that math closes easily; for a meme app, maybe not.",
        "Failover needs *practice* — an untested DR plan is a rumor. Game days exist because the first failover should never be the real one.",
      ],
    },
  },
];

export function incidentById(id: string): IncidentDef | undefined {
  return INCIDENTS.find((i) => i.id === id);
}
