import type { GraphSnapshot, MentorMessage, SimMetrics, WorkloadProfile } from "@/lib/types";
import type { EmergentSignal } from "@/lib/simulation/engine";
import { analyzeSpofs } from "@/lib/simulation/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// Priya — Staff Engineer mentor. Socratic: asks questions, names tradeoffs,
// NEVER gives the answer. Rule-based and pluggable (MentorProvider) so a
// Claude-API-backed mentor can swap in later.
// ─────────────────────────────────────────────────────────────────────────────

export interface MentorContext {
  graph: GraphSnapshot;
  workload: WorkloadProfile;
  targetUsers: number;
  metrics: SimMetrics | null;
  signals: EmergentSignal[];
  /** ids of rules already delivered this level (dedupe) */
  delivered: Set<string>;
  tick: number;
}

export interface MentorProvider {
  advise(ctx: MentorContext): MentorMessage[];
}

interface MentorRule {
  id: string;
  kind: MentorMessage["kind"];
  /** Higher fires first when several match */
  priority: number;
  when: (ctx: MentorContext) => boolean;
  say: (ctx: MentorContext) => string;
}

const has = (ctx: MentorContext, kind: string) => ctx.graph.nodes.some((n) => n.data.kind === kind);
const nodesOf = (ctx: MentorContext, kind: string) => ctx.graph.nodes.filter((n) => n.data.kind === kind);
const sig = (ctx: MentorContext, type: string) => ctx.signals.some((s) => s.type === type);

const RULES: MentorRule[] = [
  // ── design-time observations ───────────────────────────────────────────
  {
    id: "mongo-no-index",
    kind: "question",
    priority: 60,
    when: (c) =>
      nodesOf(c, "mongodb").concat(nodesOf(c, "postgres"), nodesOf(c, "mysql"))
        .some((n) => n.data.config.indexing !== "tuned") && c.targetUsers >= 1000,
    say: () =>
      "I see your database is running with default indexes only. Right now every query walks the whole table. What do you think happens to read latency when that table is a thousand times bigger?",
  },
  {
    id: "single-db-spof",
    kind: "question",
    priority: 55,
    when: (c) => c.targetUsers >= 20_000 && analyzeSpofs(c.graph).spofs.length > 0,
    say: (c) => {
      const s = analyzeSpofs(c.graph).spofs[0];
      return `Walk me through what happens to your users if ${s} dies right now. Not "if" — when. Hardware fails. What's your story?`;
    },
  },
  {
    id: "no-lb-multi-api",
    kind: "question",
    priority: 50,
    when: (c) => nodesOf(c, "api_server").some((n) => n.data.instances > 1) && !has(c, "load_balancer"),
    say: () =>
      "You have several API instances but nothing in front of them deciding who gets which request. How does a user's request find a healthy instance?",
  },
  {
    id: "retries-no-idem",
    kind: "question",
    priority: 70,
    when: (c) =>
      c.graph.nodes.some((n) => n.data.config.retries === true && n.data.config.idempotencyKeys !== true) &&
      c.workload.needsStrongConsistency,
    say: () =>
      "You enabled retries on a system that takes payments. A request times out, the client retries, but the first one actually succeeded. What did you just do to that customer's card?",
  },
  {
    id: "retries-no-breaker",
    kind: "question",
    priority: 45,
    when: (c) =>
      c.graph.nodes.some((n) => n.data.config.retries === true && n.data.config.circuitBreaker !== true),
    say: () =>
      "Retries make individual requests more likely to succeed. Now imagine the database is already drowning — and every failed request comes back for seconds. What does the database experience?",
  },
  {
    id: "kafka-tiny-scale",
    kind: "tradeoff",
    priority: 40,
    when: (c) => (has(c, "kafka") || has(c, "cassandra")) && c.targetUsers < 5_000,
    say: () =>
      "Kafka and Cassandra at this scale… You can absolutely do it. You'll also spend your weekends operating a distributed cluster for traffic a single Postgres box would yawn at. Complexity is a cost you pay every day. What's it buying you here?",
  },
  {
    id: "queue-no-workers",
    kind: "question",
    priority: 75,
    when: (c) =>
      ["kafka", "rabbitmq", "sqs"].some((k) =>
        nodesOf(c, k).some((q) => !c.graph.edges.some((e) => e.source === q.id))
      ),
    say: () =>
      "Messages are flowing into your queue. Trace one for me: where does it go next? Take your time — I'll wait.",
  },
  {
    id: "mono-shard-key",
    kind: "question",
    priority: 65,
    when: (c) =>
      nodesOf(c, "mongodb").some((n) => Number(n.data.config.shards ?? 1) > 1 && n.data.config.shardKey === "monotonic"),
    say: () =>
      "You sharded on a timestamp-style key. New writes always have the newest timestamp. Which shard receives them? …All right, and which shards receive the rest?",
  },
  {
    id: "cache-aside-staleness",
    kind: "tradeoff",
    priority: 30,
    when: (c) => nodesOf(c, "redis").some((n) => n.data.config.ttl === "long"),
    say: () =>
      "Long TTL means a great hit ratio — and data that can be an hour stale. For a product feed, who cares. For an account balance? Decide per use case, not per cache.",
  },
  {
    id: "no-cdn-global",
    kind: "question",
    priority: 35,
    when: (c) => c.targetUsers >= 10_000_000 && !has(c, "cdn") && c.workload.staticRatio > 0.3,
    say: () =>
      "A user in São Paulo requests an image from your servers. Every. Single. Time. What's the speed of light got to say about your latency SLO?",
  },
  {
    id: "no-observability",
    kind: "question",
    priority: 25,
    when: (c) => c.targetUsers >= 50_000 && !has(c, "monitoring"),
    say: () =>
      "Quick question: when this system breaks at 3am — and it will — how exactly will you know what's wrong? Describe your debugging session to me.",
  },
  {
    id: "es-as-primary",
    kind: "question",
    priority: 68,
    when: (c) => has(c, "elasticsearch") && !["postgres", "mysql", "mongodb", "cassandra", "dynamodb"].some((k) => has(c, k)),
    say: () =>
      "Elasticsearch is holding your only copy of the data. It's a search engine — it drops writes under pressure and recovery is best-effort. Are you comfortable with 'best effort' for your source of truth?",
  },
  {
    id: "sql-write-wall",
    kind: "question",
    priority: 42,
    when: (c) =>
      c.targetUsers >= 2_000_000 &&
      (1 - c.workload.readRatio) * (c.targetUsers / 1000) * c.workload.rpsPerKUsers > 2500 &&
      (has(c, "postgres") || has(c, "mysql")) &&
      !has(c, "cassandra") && !has(c, "kafka") && !nodesOf(c, "mongodb").some((n) => Number(n.data.config.shards ?? 1) > 1),
    say: () =>
      "Read replicas multiply reads, but every write still lands on one primary. Do the math with me: at this traffic, how many writes per second is that single box absorbing?",
  },

  // ── live-failure reactions (Socratic, not answers) ─────────────────────
  {
    id: "sig-stampede",
    kind: "question",
    priority: 90,
    when: (c) => sig(c, "cache_stampede"),
    say: () =>
      "Interesting — your cache hit ratio just cratered and the DB got flattened by thousands of *identical* queries, all at once. What do they have in common? What just expired?",
  },
  {
    id: "sig-retry-storm",
    kind: "question",
    priority: 92,
    when: (c) => sig(c, "retry_storm"),
    say: () =>
      "Look at the inbound rate on that database — it's roughly double what your users generate. Where is the extra traffic coming from? Check what your own services do when a call fails.",
  },
  {
    id: "sig-hot-partition",
    kind: "question",
    priority: 88,
    when: (c) => sig(c, "hot_partition"),
    say: () =>
      "Seven of your eight shards are idle and one is on fire. The cluster is fine; the *distribution* isn't. What decides which shard a write lands on?",
  },
  {
    id: "sig-backlog",
    kind: "question",
    priority: 85,
    when: (c) => sig(c, "queue_backlog"),
    say: () =>
      "Your queue depth only ever goes up. A queue that never drains isn't a buffer, it's a graveyard with retention settings. Which side of the queue is the problem — in, or out?",
  },
  {
    id: "sig-replication-lag",
    kind: "question",
    priority: 80,
    when: (c) => sig(c, "replication_lag"),
    say: () =>
      "Users write data, refresh, and it's gone — then it reappears. Spooky? Check *which* node served their read versus which one took their write.",
  },
  {
    id: "sig-disk",
    kind: "question",
    priority: 87,
    when: (c) => sig(c, "disk_full"),
    say: () =>
      "The disk filled up and writes are bouncing. Storage grows every single day — this was visible weeks ago. What would have warned you? And what's your plan beyond 'bigger disk'?",
  },
  {
    id: "sig-search",
    kind: "question",
    priority: 78,
    when: (c) => sig(c, "search_on_db"),
    say: () =>
      "A handful of search queries is eating most of your database CPU. Think about what `LIKE '%term%'` forces the database to read. Is there an index that can help it? Why not?",
  },
  {
    id: "sig-throttle",
    kind: "question",
    priority: 82,
    when: (c) => sig(c, "throttling"),
    say: () =>
      "DynamoDB is throttling you while the table is nowhere near its limit. The limit isn't on the table. What's the unit DynamoDB actually partitions your throughput by?",
  },
  {
    id: "sig-dup-writes",
    kind: "question",
    priority: 84,
    when: (c) => sig(c, "duplicate_writes"),
    say: () =>
      "Customers are being charged twice. Your retries and your queue both promise 'at least once' delivery. What in your write path makes 'twice' harmless? …Anything?",
  },

  // ── praise (rare, earned) ──────────────────────────────────────────────
  {
    id: "praise-breaker",
    kind: "praise",
    priority: 20,
    when: (c) => sig(c, "breaker_open"),
    say: () =>
      "See that? Errors went fast and flat instead of slow and cascading — the breaker is doing its job, and the database finally has room to recover. This is what failing *well* looks like.",
  },
  {
    id: "praise-headroom",
    kind: "praise",
    priority: 5,
    when: (c) =>
      c.metrics !== null &&
      c.metrics.errorRate < 0.005 &&
      c.metrics.p95LatencyMs < 200 &&
      c.tick > 30 &&
      analyzeSpofs(c.graph).spofs.length === 0,
    say: () =>
      "No single point of failure, latency flat, errors near zero. I have nothing to ask you right now — which, from me, is high praise.",
  },
];

export class RuleBasedMentor implements MentorProvider {
  advise(ctx: MentorContext): MentorMessage[] {
    const matched = RULES.filter((r) => !ctx.delivered.has(r.id) && r.when(ctx)).sort(
      (a, b) => b.priority - a.priority
    );
    // deliver at most one message per call — mentors don't monologue
    const rule = matched[0];
    if (!rule) return [];
    ctx.delivered.add(rule.id);
    return [
      {
        id: `mentor-${rule.id}-${ctx.tick}`,
        tick: ctx.tick,
        text: rule.say(ctx),
        kind: rule.kind,
      },
    ];
  }
}

export const mentor: MentorProvider = new RuleBasedMentor();
