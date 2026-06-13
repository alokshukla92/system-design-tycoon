import type { ComponentKind, ComponentSpec } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// The component catalog. Numbers are tuned for gameplay but directionally
// realistic: relative throughput, latency, and cost between technologies
// reflect real-world behavior so lessons transfer.
// ─────────────────────────────────────────────────────────────────────────────

const sizeTiers = (storageBase: number) => [
  { id: "small", label: "Small (2 vCPU)", capacityMult: 1, costMult: 1, storageGb: storageBase },
  { id: "medium", label: "Medium (4 vCPU)", capacityMult: 1.9, costMult: 2.1, storageGb: storageBase * 2 },
  { id: "large", label: "Large (8 vCPU)", capacityMult: 3.4, costMult: 4.4, storageGb: storageBase * 4 },
  { id: "xl", label: "XL (16 vCPU)", capacityMult: 5.5, costMult: 9.5, storageGb: storageBase * 8 },
  // Diminishing returns + super-linear cost: vertical scaling has a ceiling.
];

export const CATALOG: Record<ComponentKind, ComponentSpec> = {
  users: {
    kind: "users",
    name: "Users",
    shortName: "Users",
    category: "traffic",
    icon: "👥",
    description: "Your user base. Traffic originates here. You can't configure users — only survive them.",
    readCapacityRps: Infinity,
    writeCapacityRps: Infinity,
    baseLatencyMs: { read: 0, write: 0 },
    costPerMonthUsd: 0,
    tiers: [{ id: "base", label: "—", capacityMult: 1, costMult: 1, storageGb: 0 }],
    config: [],
    teachingNotes: [],
    goodFor: [],
    badFor: [],
  },

  cdn: {
    kind: "cdn",
    name: "CDN",
    shortName: "CDN",
    category: "network",
    icon: "🌍",
    description: "Edge cache for static content. Serves cached assets close to users, slashing latency and origin load.",
    readCapacityRps: 500_000,
    writeCapacityRps: 0,
    baseLatencyMs: { read: 15, write: 0 },
    costPerMonthUsd: 120,
    tiers: [{ id: "base", label: "Global edge", capacityMult: 1, costMult: 1, storageGb: 1000 }],
    config: [
      {
        key: "cacheRatio",
        label: "Static content cached",
        type: "select",
        options: [
          { value: "conservative", label: "Conservative (cache 60% of static)" },
          { value: "aggressive", label: "Aggressive (cache 95% of static)", hint: "Stale-content risk on deploys" },
        ],
        default: "conservative",
      },
    ],
    teachingNotes: [
      "A CDN only absorbs the *static/cacheable* share of reads (images, video segments, JS bundles). Dynamic API calls still hit your origin.",
      "For global products, CDN edge latency (~15ms) vs cross-ocean origin latency (~200ms) is the difference between usable and unusable.",
    ],
    goodFor: ["read-heavy", "static", "global", "video"],
    badFor: ["write-heavy", "dynamic-only"],
  },

  load_balancer: {
    kind: "load_balancer",
    name: "Load Balancer",
    shortName: "LB",
    category: "network",
    icon: "⚖️",
    description: "Distributes traffic across downstream targets. Health checks pull dead instances out of rotation.",
    readCapacityRps: 200_000,
    writeCapacityRps: 200_000,
    baseLatencyMs: { read: 2, write: 2 },
    costPerMonthUsd: 40,
    tiers: [{ id: "base", label: "Managed ALB", capacityMult: 1, costMult: 1, storageGb: 0 }],
    config: [
      {
        key: "healthChecks",
        label: "Health checks",
        type: "toggle",
        default: true,
        hint: "Reroute around crashed instances within seconds",
      },
    ],
    teachingNotes: [
      "A load balancer doesn't add capacity by itself — it lets you *use* the capacity of multiple servers behind it.",
      "Without health checks, a dead instance keeps receiving its share of traffic — every Nth request fails.",
    ],
    goodFor: ["horizontal-scaling", "availability"],
    badFor: [],
  },

  api_server: {
    kind: "api_server",
    name: "API Server",
    shortName: "API",
    category: "compute",
    icon: "🖥️",
    description: "Your application backend. Handles business logic. Scale vertically (bigger box) or horizontally (more instances behind a LB).",
    readCapacityRps: 600,
    writeCapacityRps: 600,
    baseLatencyMs: { read: 8, write: 12 },
    costPerMonthUsd: 70,
    tiers: sizeTiers(50),
    config: [
      {
        key: "retries",
        label: "Retry failed downstream calls",
        type: "toggle",
        default: false,
        hint: "Improves success rate… as long as downstream has headroom",
      },
      {
        key: "circuitBreaker",
        label: "Circuit breaker",
        type: "toggle",
        default: false,
        hint: "Stop calling a failing dependency; fail fast instead",
      },
      {
        key: "rateLimiter",
        label: "Rate limiter",
        type: "toggle",
        default: false,
        hint: "Shed excess load with 429s before it melts the backend",
      },
      {
        key: "idempotencyKeys",
        label: "Idempotency keys",
        type: "toggle",
        default: false,
        hint: "Make retried writes safe (no double charges)",
      },
    ],
    teachingNotes: [
      "Retries against an already-overloaded dependency *amplify* the load — a retry storm can turn a slowdown into a full outage.",
      "Circuit breakers convert 'slow and failing' into 'fast and degraded', which protects everything upstream.",
      "Rate limiting trades a few rejected requests for keeping the whole system alive. 429s are cheaper than a dead database.",
      "If you retry writes without idempotency keys, every timeout risks a duplicate write — double-charged customers.",
    ],
    goodFor: ["everything"],
    badFor: [],
  },

  k8s_cluster: {
    kind: "k8s_cluster",
    name: "Kubernetes Cluster",
    shortName: "K8s",
    category: "compute",
    icon: "☸️",
    description: "Container orchestration with horizontal pod autoscaling. Pods scale with load — after a scale-up delay.",
    readCapacityRps: 550,
    writeCapacityRps: 550,
    baseLatencyMs: { read: 9, write: 13 },
    costPerMonthUsd: 95, // per pod-equivalent + control-plane overhead
    tiers: [{ id: "base", label: "Per pod (2 vCPU)", capacityMult: 1, costMult: 1, storageGb: 20 }],
    config: [
      { key: "minPods", label: "Min pods", type: "number", min: 1, max: 50, default: 2 },
      { key: "maxPods", label: "Max pods", type: "number", min: 1, max: 200, default: 10 },
      {
        key: "retries", label: "Retry failed downstream calls", type: "toggle", default: false,
        hint: "Improves success rate… as long as downstream has headroom",
      },
      { key: "circuitBreaker", label: "Circuit breaker", type: "toggle", default: false },
      { key: "rateLimiter", label: "Rate limiter", type: "toggle", default: false },
      { key: "idempotencyKeys", label: "Idempotency keys", type: "toggle", default: false },
    ],
    teachingNotes: [
      "Autoscaling is not instant: metrics → HPA decision → pod schedule → image pull → ready. During a sudden spike you eat the overload until new pods are warm.",
      "Autoscaling handles gradual growth beautifully and sudden 10× spikes poorly. For known spikes (product launch), pre-scale.",
      "The autoscaler can't fix a database bottleneck — more pods hammering a saturated DB makes it *worse*.",
    ],
    goodFor: ["variable-load", "horizontal-scaling", "operations"],
    badFor: ["instant-spikes"],
  },

  postgres: {
    kind: "postgres",
    name: "PostgreSQL",
    shortName: "PG",
    category: "database",
    icon: "🐘",
    description: "Relational database. ACID transactions, joins, strong consistency. The default choice until it isn't.",
    readCapacityRps: 4000,
    writeCapacityRps: 900,
    baseLatencyMs: { read: 4, write: 8 },
    costPerMonthUsd: 110,
    consistency: "strong",
    tiers: sizeTiers(100),
    config: [
      {
        key: "indexing",
        label: "Indexing strategy",
        type: "select",
        options: [
          { value: "none", label: "Default (PK only)" },
          { value: "tuned", label: "Tuned indexes on hot queries", hint: "Faster reads, slightly slower writes" },
        ],
        default: "none",
      },
      {
        key: "readReplicas",
        label: "Read replicas",
        type: "number",
        min: 0,
        max: 5,
        default: 0,
        hint: "Each replica adds read capacity and a failover target — and replication lag",
      },
      {
        key: "connectionPooling",
        label: "Connection pooling (PgBouncer)",
        type: "toggle",
        default: false,
        hint: "Survive connection storms from many app instances",
      },
    ],
    teachingNotes: [
      "Without indexes, every query scans the table. At 1k rows nobody notices. At 10M rows a 5ms query becomes 5 seconds.",
      "Read replicas multiply READ capacity only. Writes still all land on the primary — replicas don't fix a write bottleneck.",
      "Replication is asynchronous: under heavy writes, replicas fall behind. Users see their own update 'disappear' — read-your-writes violation.",
      "Sharding relational DBs is possible but expensive in complexity: cross-shard joins and transactions mostly stop working.",
    ],
    goodFor: ["transactions", "relational", "consistency", "payments"],
    badFor: ["massive-write-scale", "unstructured"],
  },

  mysql: {
    kind: "mysql",
    name: "MySQL",
    shortName: "MySQL",
    category: "database",
    icon: "🐬",
    description: "Relational database. Very similar tradeoffs to PostgreSQL; battle-tested replication story.",
    readCapacityRps: 4200,
    writeCapacityRps: 850,
    baseLatencyMs: { read: 4, write: 8 },
    costPerMonthUsd: 100,
    consistency: "strong",
    tiers: sizeTiers(100),
    config: [
      {
        key: "indexing",
        label: "Indexing strategy",
        type: "select",
        options: [
          { value: "none", label: "Default (PK only)" },
          { value: "tuned", label: "Tuned indexes on hot queries" },
        ],
        default: "none",
      },
      { key: "readReplicas", label: "Read replicas", type: "number", min: 0, max: 5, default: 0 },
      { key: "connectionPooling", label: "Connection pooling", type: "toggle", default: false },
    ],
    teachingNotes: [
      "MySQL vs PostgreSQL is rarely the decision that matters. Indexing, replication, and sharding strategy matter 100× more.",
      "Replicas serve stale reads under write load. Decide per-query whether staleness is acceptable.",
    ],
    goodFor: ["transactions", "relational", "consistency"],
    badFor: ["massive-write-scale"],
  },

  mongodb: {
    kind: "mongodb",
    name: "MongoDB",
    shortName: "Mongo",
    category: "database",
    icon: "🍃",
    description: "Document database. Flexible schema, native sharding. Your shard key choice decides whether sharding saves you or burns you.",
    readCapacityRps: 3500,
    writeCapacityRps: 1500,
    baseLatencyMs: { read: 5, write: 6 },
    costPerMonthUsd: 120,
    consistency: "tunable",
    tiers: sizeTiers(120),
    config: [
      {
        key: "indexing",
        label: "Indexing strategy",
        type: "select",
        options: [
          { value: "none", label: "Default (_id only)" },
          { value: "tuned", label: "Tuned indexes on hot queries" },
        ],
        default: "none",
      },
      { key: "replicaSet", label: "Replica set members", type: "number", min: 0, max: 4, default: 0, hint: "Adds failover + read capacity" },
      {
        key: "shards",
        label: "Shards",
        type: "number",
        min: 1,
        max: 16,
        default: 1,
        hint: "Splits data + write load across shards",
      },
      {
        key: "shardKey",
        label: "Shard key",
        type: "select",
        options: [
          { value: "monotonic", label: "Timestamp / auto-id (monotonic)", hint: "All new writes go to ONE shard" },
          { value: "low_card", label: "Low-cardinality field (e.g. country)", hint: "A few huge shards, many idle" },
          { value: "hashed", label: "Hashed user/entity id", hint: "Even spread; range queries get expensive" },
        ],
        default: "monotonic",
      },
    ],
    teachingNotes: [
      "Sharding splits write load — IF the shard key spreads traffic. A monotonic key (timestamps, auto-ids) sends every new write to the same shard: you paid for 8 shards and use 1.",
      "A hashed shard key gives even distribution but makes range scans scatter-gather across all shards.",
      "Hot partitions are the classic sharding failure: one celebrity user, one viral post, one busy tenant overwhelming a single shard.",
    ],
    goodFor: ["flexible-schema", "write-scale", "documents"],
    badFor: ["multi-document-transactions", "complex-joins"],
  },

  cassandra: {
    kind: "cassandra",
    name: "Cassandra",
    shortName: "C*",
    category: "database",
    icon: "👁️",
    description: "Wide-column store built for massive write throughput across many nodes. Eventually consistent by default. No joins.",
    readCapacityRps: 2500,
    writeCapacityRps: 6000,
    baseLatencyMs: { read: 8, write: 3 },
    costPerMonthUsd: 150, // per node; minimum sensible cluster = 3
    consistency: "tunable",
    tiers: [{ id: "node", label: "Per node (8 vCPU)", capacityMult: 1, costMult: 1, storageGb: 500 }],
    config: [
      {
        key: "consistencyLevel",
        label: "Consistency level",
        type: "select",
        options: [
          { value: "one", label: "ONE — fastest, may read stale" },
          { value: "quorum", label: "QUORUM — balanced" },
          { value: "all", label: "ALL — strongest, slowest, fragile" },
        ],
        default: "one",
      },
      {
        key: "partitionKey",
        label: "Partition key design",
        type: "select",
        options: [
          { value: "skewed", label: "Natural key (can skew hot)" },
          { value: "balanced", label: "Composite/bucketed key (even spread)" },
        ],
        default: "skewed",
      },
    ],
    teachingNotes: [
      "Cassandra scales writes nearly linearly with nodes — that's its superpower. The price: eventual consistency and query patterns fixed at table-design time.",
      "Consistency level is the CAP dial in your hands: ONE = fast but stale-able, QUORUM = balanced, ALL = strong but any node failure blocks writes.",
      "Using Cassandra for relational/transactional workloads fights the tool. No joins, no multi-row ACID.",
    ],
    goodFor: ["write-heavy", "time-series", "scale", "availability"],
    badFor: ["transactions", "ad-hoc-queries", "small-scale"],
  },

  dynamodb: {
    kind: "dynamodb",
    name: "DynamoDB",
    shortName: "DDB",
    category: "database",
    icon: "⚡",
    description: "Fully managed key-value store. Autoscales, never needs patching. You pay per request — and hot keys get throttled.",
    readCapacityRps: 50_000,
    writeCapacityRps: 25_000,
    baseLatencyMs: { read: 5, write: 6 },
    costPerMonthUsd: 60, // base; usage cost computed in engine from RPS
    consistency: "tunable",
    tiers: [{ id: "ondemand", label: "On-demand", capacityMult: 1, costMult: 1, storageGb: 10_000 }],
    config: [
      {
        key: "keyDesign",
        label: "Partition key design",
        type: "select",
        options: [
          { value: "skewed", label: "Natural key (can skew hot)" },
          { value: "balanced", label: "Composite/sharded key (even spread)" },
        ],
        default: "skewed",
      },
    ],
    teachingNotes: [
      "Managed ≠ unlimited. DynamoDB partitions have per-key throughput limits; a hot key gets throttled no matter how much you pay.",
      "Pay-per-request pricing is glorious at low traffic and a budget line-item that makes your CFO cry at 100k RPS. Run the math both ways.",
    ],
    goodFor: ["key-value", "serverless", "predictable-access", "scale"],
    badFor: ["complex-queries", "cost-at-massive-scale", "hot-keys"],
  },

  elasticsearch: {
    kind: "elasticsearch",
    name: "Elasticsearch",
    shortName: "ES",
    category: "search",
    icon: "🔎",
    description: "Full-text search and analytics engine. The only thing here that makes search fast. Not a primary datastore.",
    readCapacityRps: 1500,
    writeCapacityRps: 800,
    baseLatencyMs: { read: 20, write: 30 },
    costPerMonthUsd: 220,
    consistency: "eventual",
    tiers: sizeTiers(200),
    config: [],
    teachingNotes: [
      "Search on a relational DB means LIKE '%term%' — a full table scan per query. A search engine inverts the index so queries are O(term), not O(rows).",
      "Elasticsearch is near-real-time and not durable like a primary DB. Standard pattern: source of truth in a DB, indexed into ES asynchronously.",
    ],
    goodFor: ["search", "analytics", "logs"],
    badFor: ["primary-store", "transactions"],
  },

  redis: {
    kind: "redis",
    name: "Redis",
    shortName: "Redis",
    category: "cache",
    icon: "🟥",
    description: "In-memory cache. Microsecond reads. Absorbs read load before it reaches the database — when the hit ratio cooperates.",
    readCapacityRps: 90_000,
    writeCapacityRps: 70_000,
    baseLatencyMs: { read: 1, write: 1 },
    costPerMonthUsd: 90,
    tiers: [
      { id: "small", label: "Small (8 GB RAM)", capacityMult: 1, costMult: 1, storageGb: 8 },
      { id: "medium", label: "Medium (32 GB RAM)", capacityMult: 1.6, costMult: 3, storageGb: 32 },
      { id: "large", label: "Large (128 GB RAM)", capacityMult: 2.2, costMult: 9, storageGb: 128 },
    ],
    config: [
      {
        key: "strategy",
        label: "Caching strategy",
        type: "select",
        options: [
          { value: "cache_aside", label: "Cache-aside (lazy)", hint: "App reads cache → miss → DB → fill" },
          { value: "write_through", label: "Write-through", hint: "Writes update cache + DB together" },
        ],
        default: "cache_aside",
      },
      {
        key: "ttl",
        label: "TTL",
        type: "select",
        options: [
          { value: "short", label: "Short (60s) — fresh data, more misses" },
          { value: "long", label: "Long (1h) — high hit ratio, staleness risk" },
          { value: "long_jitter", label: "Long + jitter + stampede lock", hint: "Prevents synchronized expiry" },
        ],
        default: "short",
      },
    ],
    teachingNotes: [
      "Cache-aside: first request after expiry misses and hits the DB. If a *hot* key expires, thousands of concurrent misses stampede the DB at once — the cache stampede.",
      "Fixes for stampedes: TTL jitter (spread expiry), request coalescing/locking (one miss refills, rest wait), or background refresh.",
      "Write-through keeps cache fresh at the cost of write latency; cache-aside is simpler but serves stale data up to TTL.",
      "A cache is not capacity you own — it's capacity you *borrow* as long as the hit ratio holds. Plan for the miss path surviving.",
    ],
    goodFor: ["read-heavy", "hot-data", "sessions", "latency"],
    badFor: ["source-of-truth", "large-objects"],
  },

  kafka: {
    kind: "kafka",
    name: "Kafka",
    shortName: "Kafka",
    category: "messaging",
    icon: "🪵",
    description: "Distributed commit log. Absorbs write bursts, decouples producers from consumers, replays history. Throughput scales with partitions.",
    readCapacityRps: 0,
    writeCapacityRps: 10_000, // per partition-ish abstraction at base
    baseLatencyMs: { read: 5, write: 4 },
    costPerMonthUsd: 250,
    tiers: [{ id: "cluster", label: "3-broker cluster", capacityMult: 1, costMult: 1, storageGb: 2000 }],
    config: [
      { key: "partitions", label: "Partitions", type: "number", min: 1, max: 64, default: 3, hint: "Max parallelism for consumers" },
      {
        key: "keying",
        label: "Partition keying",
        type: "select",
        options: [
          { value: "skewed", label: "By natural key (can skew)" },
          { value: "balanced", label: "Balanced keying" },
        ],
        default: "balanced",
      },
    ],
    teachingNotes: [
      "A queue doesn't make slow consumers fast — it buys you *time*. If consumers are permanently slower than producers, backlog grows forever and 'eventually' becomes 'never'.",
      "Consumer parallelism is capped by partition count. 4 partitions = at most 4 effective consumers per group.",
      "Kafka turns a synchronous write spike into an asynchronous drain — users get fast acks, the DB gets a smooth steady stream. The cost: data is eventually consistent downstream.",
    ],
    goodFor: ["write-bursts", "event-streaming", "decoupling", "replay"],
    badFor: ["request-response", "small-scale", "simplicity"],
  },

  rabbitmq: {
    kind: "rabbitmq",
    name: "RabbitMQ",
    shortName: "Rabbit",
    category: "messaging",
    icon: "🐰",
    description: "Classic message broker. Simpler than Kafka, lower throughput, rich routing. Great for task queues.",
    readCapacityRps: 0,
    writeCapacityRps: 4000,
    baseLatencyMs: { read: 3, write: 3 },
    costPerMonthUsd: 80,
    tiers: [{ id: "base", label: "Single broker", capacityMult: 1, costMult: 1, storageGb: 100 }],
    config: [],
    teachingNotes: [
      "RabbitMQ vs Kafka: Rabbit routes individual messages with acks (task queues); Kafka is a replayable log for streams. Pick by access pattern, not fashion.",
      "Rabbit holds messages in memory/disk per queue — deep backlogs hurt it much sooner than Kafka.",
    ],
    goodFor: ["task-queues", "routing", "simplicity"],
    badFor: ["massive-throughput", "replay"],
  },

  sqs: {
    kind: "sqs",
    name: "SQS",
    shortName: "SQS",
    category: "messaging",
    icon: "📨",
    description: "Fully managed queue. Nearly infinite buffer, zero ops, pay per message. At-least-once delivery — duplicates happen.",
    readCapacityRps: 0,
    writeCapacityRps: 30_000,
    baseLatencyMs: { read: 10, write: 10 },
    costPerMonthUsd: 20, // base; usage priced in engine
    tiers: [{ id: "base", label: "Managed", capacityMult: 1, costMult: 1, storageGb: 100_000 }],
    config: [],
    teachingNotes: [
      "SQS is at-least-once: consumers WILL occasionally see duplicates. Without idempotent processing, duplicates become double-sent emails and double-charged cards.",
      "Managed queues trade per-message cost for zero operations. At modest scale that's free money; at extreme scale, do the math.",
    ],
    goodFor: ["task-queues", "serverless", "zero-ops"],
    badFor: ["strict-ordering", "replay", "extreme-throughput-cost"],
  },

  worker: {
    kind: "worker",
    name: "Worker Pool",
    shortName: "Workers",
    category: "compute",
    icon: "⚙️",
    description: "Background consumers. Drain queues, process jobs, write results to storage. Scale instances to match the producer rate.",
    readCapacityRps: 0,
    writeCapacityRps: 400, // drain rate per instance
    baseLatencyMs: { read: 0, write: 20 },
    costPerMonthUsd: 60,
    tiers: sizeTiers(20),
    config: [
      { key: "idempotencyKeys", label: "Idempotent processing", type: "toggle", default: false, hint: "Safe under at-least-once delivery" },
    ],
    teachingNotes: [
      "Queue + workers is the throttle valve of system design: producers burst, workers drain at a sustainable rate.",
      "Size workers for the *average* rate plus catch-up headroom — not the peak. The queue absorbs the peak; that's its job.",
    ],
    goodFor: ["async-processing", "queues"],
    badFor: [],
  },

  monitoring: {
    kind: "monitoring",
    name: "Observability Stack",
    shortName: "O11y",
    category: "observability",
    icon: "📈",
    description: "Metrics, logs, traces, alerting. Doesn't serve traffic — reveals what's actually happening. Unlocks detailed diagnostics in the event log.",
    readCapacityRps: 0,
    writeCapacityRps: 0,
    baseLatencyMs: { read: 0, write: 0 },
    costPerMonthUsd: 150,
    tiers: [{ id: "base", label: "Metrics+Logs+Traces", capacityMult: 1, costMult: 1, storageGb: 500 }],
    config: [
      { key: "alerting", label: "Alerting rules", type: "toggle", default: true, hint: "Early warnings before users notice" },
    ],
    teachingNotes: [
      "Without observability you debug outages by vibes. With it, the event log tells you *which* node is saturated and *why* latency spiked.",
      "Alerts on symptoms (p95, error rate) beat alerts on causes (CPU) — users feel symptoms.",
    ],
    goodFor: ["operations", "debugging"],
    badFor: [],
  },
};

export const PALETTE_ORDER: ComponentCategory_Order[] = [
  { category: "network", label: "Networking" },
  { category: "compute", label: "Compute" },
  { category: "database", label: "Databases" },
  { category: "cache", label: "Caching" },
  { category: "messaging", label: "Messaging" },
  { category: "search", label: "Search" },
  { category: "observability", label: "Observability" },
];

interface ComponentCategory_Order {
  category: ComponentSpec["category"];
  label: string;
}

export function spec(kind: ComponentKind): ComponentSpec {
  return CATALOG[kind];
}

export function defaultConfig(kind: ComponentKind): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of CATALOG[kind].config) out[f.key] = f.default;
  return out;
}

export const DB_KINDS: ComponentKind[] = ["postgres", "mysql", "mongodb", "cassandra", "dynamodb"];
export const COMPUTE_KINDS: ComponentKind[] = ["api_server", "k8s_cluster"];
export const QUEUE_KINDS: ComponentKind[] = ["kafka", "rabbitmq", "sqs"];
