import type { ComponentKind, GraphSnapshot, LevelDef } from "@/lib/types";
import { defaultConfig } from "@/lib/catalog/components";

// ─────────────────────────────────────────────────────────────────────────────
// Campaign: 10 levels from 100 users to 100M. Each level's core lesson is
// never announced up-front — it emerges from a failure the player must solve.
// ─────────────────────────────────────────────────────────────────────────────

let nid = 0;
function n(kind: ComponentKind, x: number, y: number, extra: Partial<{ tier: string; instances: number; config: Record<string, string | number | boolean> }> = {}) {
  return {
    id: `start-${kind}-${nid++}`,
    position: { x, y },
    data: {
      kind,
      label: kind === "users" ? "Users" : undefined as unknown as string,
      tier: extra.tier ?? "small",
      instances: extra.instances ?? 1,
      config: { ...defaultConfig(kind), ...(extra.config ?? {}) },
    },
  };
}

function starter(...kinds: ComponentKind[]): GraphSnapshot {
  nid = 0;
  const nodes = kinds.map((k, i) => {
    const node = n(k, 80 + i * 240, 160 + (i % 2) * 60);
    node.data.label = labelFor(k);
    return node;
  });
  const edges = nodes.slice(0, -1).map((node, i) => ({
    id: `start-e${i}`,
    source: node.id,
    target: nodes[i + 1].id,
  }));
  return { nodes, edges };
}

function labelFor(k: ComponentKind): string {
  const map: Partial<Record<ComponentKind, string>> = {
    users: "Users", api_server: "API Server", mongodb: "MongoDB", postgres: "PostgreSQL",
    redis: "Redis", load_balancer: "Load Balancer", kafka: "Kafka", cdn: "CDN",
  };
  return map[k] ?? k;
}

const BASE_UNLOCKS: ComponentKind[] = ["api_server", "mongodb", "postgres", "mysql"];

export const LEVELS: LevelDef[] = [
  {
    id: "l1",
    number: 1,
    title: "Day One",
    project: "linkly — a URL shortener",
    users: 100,
    usersEnd: 15_000,
    durationTicks: 100,
    brief: [
      "You quit your job. You built **linkly**, a URL shortener, over a weekend: one API server, one MongoDB, and a dream.",
      "It just got posted on Hacker News.",
      "Users create short links (writes) and follow them (reads). Keep the site alive while traffic grows 150× — and keep the burn rate under control. You have no investors yet.",
      "Tip: you can pause anytime, and redesign while the simulation runs. Watch the utilization bars.",
    ],
    workload: {
      rpsPerKUsers: 12, readRatio: 0.92, staticRatio: 0.05, searchRatio: 0,
      storageGbPerDayPer10k: 0.5, peakMult: 1.6, skew: 0.25, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 400, minAvailabilityPct: 98, maxErrorRate: 0.04, maxMonthlyBudget: 500 },
    scripted: [
      { atTick: 10, type: "user_growth", announcement: "Front page of Hacker News. Here they come." },
      { atTick: 78, type: "traffic_spike", magnitude: 5, durationTicks: 14, announcement: "A celebrity just tweeted a linkly link. Traffic is going vertical." },
    ],
    unlocked: BASE_UNLOCKS,
    starter: starter("users", "api_server", "mongodb"),
    debrief: {
      concept: "Vertical scaling & the single-server ceiling",
      explanation: [
        "Your first bottleneck was raw capacity: one small server has a hard requests-per-second ceiling, and queueing theory makes latency explode *before* you hit it — at ~80% utilization, wait times are already climbing fast.",
        "Upgrading the instance (vertical scaling) is the right first move: zero architectural change, immediate headroom. But notice the price curve — each tier costs roughly double for less-than-double capacity.",
      ],
      tradeoffs: [
        "Vertical scaling: simple, instant, no code changes — but super-linear cost and a hard ceiling (there is always a biggest box).",
        "Keeping headroom (~30%) costs money but buys you survival during spikes you didn't predict.",
      ],
    },
  },

  {
    id: "l2",
    number: 2,
    title: "The Slow Burn",
    project: "linkly — growing up",
    users: 15_000,
    usersEnd: 28_000,
    durationTicks: 110,
    brief: [
      "linkly survived launch. You raised a small angel round. Users keep coming — and they keep *creating data*: the links collection is already 70% of your disk.",
      "Lately, support tickets mention the dashboard 'taking forever'. Your server isn't even that busy. Something else is rotting.",
      "Grow to 28,000 users without latency falling off a cliff.",
    ],
    workload: {
      rpsPerKUsers: 12, readRatio: 0.9, staticRatio: 0.05, searchRatio: 0,
      storageGbPerDayPer10k: 40, peakMult: 1.6, skew: 0.25, needsStrongConsistency: false,
      initialDbFillPct: 0.7,
    },
    slo: { maxP95Ms: 300, minAvailabilityPct: 99, maxErrorRate: 0.02, maxMonthlyBudget: 900 },
    scripted: [
      { atTick: 20, type: "user_growth", announcement: "Your database has 10× the documents it had a month ago." },
      { atTick: 70, type: "traffic_spike", magnitude: 2, durationTicks: 15, announcement: "Marketing ran a promo. Read traffic doubling." },
    ],
    unlocked: BASE_UNLOCKS,
    starter: (() => {
      nid = 0;
      const u = n("users", 80, 180);
      u.data.label = "Users";
      const api = n("api_server", 330, 180, { tier: "medium" });
      api.data.label = "API Server";
      const db = n("mongodb", 580, 180);
      db.data.label = "MongoDB";
      return {
        nodes: [u, api, db],
        edges: [
          { id: "start-e0", source: u.id, target: api.id },
          { id: "start-e1", source: api.id, target: db.id },
        ],
      };
    })(),
    debrief: {
      concept: "Indexing — O(n) scans vs O(log n) lookups",
      explanation: [
        "Your queries were fine at 1k rows and dying at 10M — classic unindexed growth. Without an index, the database scans every row for every query, so query cost grows linearly with data size even when traffic doesn't.",
        "An index is a sorted lookup structure (usually a B-tree): finds rows in O(log n). The 'tuned indexes' option turned 5-second scans back into 5-millisecond lookups.",
      ],
      tradeoffs: [
        "Indexes cost write performance (every insert updates the index too — ~8% in our sim) and storage. Index what you query, not everything.",
        "This failure mode is invisible in dev and brutal in prod: small test data hides O(n) scans. Watch query plans, not just CPU.",
      ],
    },
  },

  {
    id: "l3",
    number: 3,
    title: "Chatterbox",
    project: "chatter — a messaging app",
    users: 10_000,
    usersEnd: 60_000,
    durationTicks: 120,
    brief: [
      "Pivot! linkly's growth flattened, but users loved the comments feature. You rebuilt it as **chatter** — a messaging app.",
      "Users send messages, read conversations, and hammer the same hot threads. Reads outnumber writes 4:1, and the same popular group chats get read thousands of times a second.",
      "Your database is doing the same work over and over. Survive to 60k users within budget.",
    ],
    workload: {
      rpsPerKUsers: 28, readRatio: 0.8, staticRatio: 0.1, searchRatio: 0,
      storageGbPerDayPer10k: 8, peakMult: 1.8, skew: 0.55, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 250, minAvailabilityPct: 99, maxErrorRate: 0.02, maxMonthlyBudget: 1600 },
    scripted: [
      { atTick: 30, type: "traffic_spike", magnitude: 2.5, durationTicks: 20, announcement: "A streamer told their fans to join chatter. Concurrents doubling." },
      { atTick: 80, type: "hot_key", durationTicks: 15, announcement: "One group chat has 40,000 members and they are all VERY online right now." },
    ],
    unlocked: [...BASE_UNLOCKS, "redis"],
    debrief: {
      concept: "Caching — and the stampede that comes with it",
      explanation: [
        "Most read traffic was the *same data over and over* — perfect cache material. Redis serves hot reads from memory in ~1ms and absorbs them before they reach the database.",
        "Then a hot key expired and thousands of concurrent requests all missed at the same instant — a cache stampede that flattened your DB worse than having no cache (because you'd sized the DB assuming the cache).",
      ],
      tradeoffs: [
        "Cache-aside is simple but serves stale data up to TTL. Short TTL = fresher data, more misses. Long TTL = better hit ratio, more staleness — and bigger stampedes.",
        "TTL jitter and request coalescing cost nothing and prevent synchronized expiry. There is no good reason to skip them in production.",
        "A cache is borrowed capacity: always ask 'what happens on the miss path?' — because one day the cache will be cold.",
      ],
    },
  },

  {
    id: "l4",
    number: 4,
    title: "The 3AM Page",
    project: "chatter — now with stakes",
    users: 60_000,
    usersEnd: 120_000,
    durationTicks: 120,
    brief: [
      "chatter raised a Series A. You have paying teams now, and an SLA with teeth: 99.5% availability.",
      "Everything runs through one database instance. The investors asked about your disaster story in the board meeting. You changed the subject.",
      "Hardware fails. It always does. Be ready.",
    ],
    workload: {
      rpsPerKUsers: 28, readRatio: 0.8, staticRatio: 0.1, searchRatio: 0,
      storageGbPerDayPer10k: 8, peakMult: 1.8, skew: 0.4, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 250, minAvailabilityPct: 99.5, maxErrorRate: 0.015, maxMonthlyBudget: 3000 },
    scripted: [
      { atTick: 35, type: "node_crash", targetKind: "mongodb", announcement: "🔥 Early tremor: a database instance briefly dropped. A warning shot." },
      { atTick: 36, type: "node_crash", targetKind: "postgres", announcement: "🔥 Early tremor: a database instance briefly dropped. A warning shot." },
      { atTick: 88, type: "node_crash", targetKind: "mongodb", announcement: "🔥 3AM PAGE: a primary database instance just died under peak load. Do you have a failover?" },
      { atTick: 89, type: "node_crash", targetKind: "postgres", announcement: "🔥 3AM PAGE: a primary database instance just died under peak load. Do you have a failover?" },
    ],
    unlocked: [...BASE_UNLOCKS, "redis", "monitoring"],
    debrief: {
      concept: "Replication — redundancy as a way of life",
      explanation: [
        "A single database instance is a single point of failure: when it died, 100% of your product died with it. Replication keeps live copies on independent machines — one fails, another serves.",
        "Replicas also add read capacity for free(ish). But the write stream still flows through one primary, and copies arrive *asynchronously* — replicas lag behind under write load.",
      ],
      tradeoffs: [
        "Each replica costs as much as the primary. Availability is a thing you buy.",
        "Async replication = eventual consistency on replicas: a user can write, then read a replica that hasn't caught up, and see their data 'missing'. Read-your-writes needs primary reads or sticky routing.",
        "Observability isn't optional at this scale — without monitoring you learn about outages from Twitter.",
      ],
    },
  },

  {
    id: "l5",
    number: 5,
    title: "Picture This",
    project: "snapgram — photo sharing",
    users: 100_000,
    usersEnd: 400_000,
    durationTicks: 130,
    brief: [
      "Your chat empire funds a new bet: **snapgram**, a photo-sharing app. Feeds, likes, follows — read-heavy, bursty, and growing terrifyingly fast.",
      "No single server you can buy will handle this. You've hit the top of the vertical ladder.",
      "Scale OUT, not up. Get to 400k users.",
    ],
    workload: {
      rpsPerKUsers: 14, readRatio: 0.88, staticRatio: 0.5, searchRatio: 0.02,
      storageGbPerDayPer10k: 25, peakMult: 2, skew: 0.6, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 300, minAvailabilityPct: 99.5, maxErrorRate: 0.015, maxMonthlyBudget: 7000 },
    scripted: [
      { atTick: 25, type: "traffic_spike", magnitude: 2.5, durationTicks: 18, announcement: "snapgram is the #3 app in the App Store today." },
      { atTick: 70, type: "node_crash", targetKind: "api_server", announcement: "An API instance crashed during the rush." },
      { atTick: 71, type: "node_crash", targetKind: "k8s_cluster", announcement: "A pod just got OOM-killed during the rush." },
    ],
    unlocked: [...BASE_UNLOCKS, "redis", "monitoring", "load_balancer", "k8s_cluster", "cdn"],
    debrief: {
      concept: "Horizontal scaling & load balancing",
      explanation: [
        "One big server has a ceiling; many small servers don't. A load balancer spreads requests across N instances and — critically — health-checks them, so a crashed instance is pulled from rotation in seconds instead of failing every Nth request.",
        "Kubernetes adds autoscaling: pods scale with load. But scale-up takes minutes (metrics → scheduling → image pull → warm), so sudden spikes still hurt before new pods arrive.",
        "A CDN absorbed your static traffic (photos!) at the edge — half your read load never touched your servers at all.",
      ],
      tradeoffs: [
        "Horizontal scaling requires stateless services — state pushed down to DB/cache. That's an architecture decision, not a checkbox.",
        "Autoscaling trades cost-efficiency for spike-vulnerability. For predictable launches: pre-scale.",
        "More instances = more things to observe, deploy, and debug. The LB is now critical infrastructure.",
      ],
    },
  },

  {
    id: "l6",
    number: 6,
    title: "A Million Little Writes",
    project: "snapgram — the write wall",
    users: 1_000_000,
    usersEnd: 2_500_000,
    durationTicks: 140,
    brief: [
      "One million users. The cache eats your reads, the CDN eats your images… and the write traffic — posts, likes, comments — is all converging on one primary database that has nowhere left to go.",
      "Read replicas don't help: every write still lands on the primary. You need to split the *data itself*.",
      "Oh, and a certain pop star just joined snapgram. Good luck.",
    ],
    workload: {
      rpsPerKUsers: 14, readRatio: 0.82, staticRatio: 0.5, searchRatio: 0.02,
      storageGbPerDayPer10k: 25, peakMult: 2, skew: 0.65, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 300, minAvailabilityPct: 99.5, maxErrorRate: 0.015, maxMonthlyBudget: 16_000 },
    scripted: [
      { atTick: 35, type: "user_growth", announcement: "Write volume has tripled this quarter. The primary is sweating." },
      { atTick: 75, type: "hot_key", durationTicks: 20, announcement: "⭐ The pop star posted. 40 million fans are liking it. Right now." },
    ],
    unlocked: [...BASE_UNLOCKS, "redis", "monitoring", "load_balancer", "k8s_cluster", "cdn"],
    debrief: {
      concept: "Sharding & partitioning — and the hot-partition trap",
      explanation: [
        "Replication copies the same data; sharding *splits* it. Each shard owns a slice of the keyspace and takes a slice of the writes — the only way past a single primary's write ceiling.",
        "But sharding is only as good as the shard key. A monotonic key (timestamp, auto-id) routes every new write to one shard. A celebrity user makes any natural key skew. A hashed key spreads load evenly — and makes range queries scatter-gather.",
      ],
      tradeoffs: [
        "Sharding multiplies cost and operational complexity: rebalancing, cross-shard queries, no cheap transactions across shards.",
        "Shard-key choice is nearly permanent — re-sharding live data is one of the most painful migrations in engineering. Spend the design time up front.",
        "Hot partitions hide until a hot *entity* shows up. Design for your most viral user, not your average one.",
      ],
    },
  },

  {
    id: "l7",
    number: 7,
    title: "Surge",
    project: "swiftride — ride hailing",
    users: 3_000_000,
    usersEnd: 6_000_000,
    durationTicks: 140,
    brief: [
      "New venture: **swiftride**. Every driver's phone sends a location ping every few seconds. Writes outnumber reads three to one, and they arrive in brutal rush-hour bursts.",
      "Your databases cannot swallow rush hour in real time. Stop trying. Let writes wait in line.",
      "It's 8:55am on a rainy Monday. Surge incoming.",
    ],
    workload: {
      rpsPerKUsers: 6, readRatio: 0.3, staticRatio: 0.05, searchRatio: 0,
      storageGbPerDayPer10k: 15, peakMult: 3.2, skew: 0.3, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 350, minAvailabilityPct: 99.5, maxErrorRate: 0.02, maxMonthlyBudget: 30_000 },
    scripted: [
      { atTick: 30, type: "traffic_spike", magnitude: 3, durationTicks: 25, announcement: "🌧️ Rain + rush hour. Ping volume tripling for the next half hour." },
      { atTick: 90, type: "traffic_spike", magnitude: 4, durationTicks: 20, announcement: "A stadium concert just ended. 60,000 people want rides simultaneously." },
    ],
    unlocked: [...BASE_UNLOCKS, "redis", "monitoring", "load_balancer", "k8s_cluster", "cdn", "kafka", "rabbitmq", "sqs", "worker", "cassandra"],
    debrief: {
      concept: "Asynchronous processing — queues as shock absorbers",
      explanation: [
        "Synchronous writes mean your database must absorb the *peak*. A queue (Kafka) changes the contract: producers get an instant ack, messages buffer, and workers drain them at a sustainable rate. The DB sees a smooth stream instead of a tsunami.",
        "The backlog became your key health metric: rising backlog = consumers too slow. Consumer parallelism is capped by partition count — more workers than partitions just idle.",
        "Cassandra also entered the chat: write-optimized, scales writes linearly with nodes — built for exactly this firehose.",
      ],
      tradeoffs: [
        "Async means eventual: the data a user reads may be seconds behind reality. For location pings, fine. For bank balances, not fine.",
        "A queue buys time, not throughput — if drain rate < arrival rate forever, the backlog grows forever.",
        "Kafka is serious operational machinery. At small scale, SQS/RabbitMQ give you 80% of the benefit with 20% of the ops burden.",
      ],
    },
  },

  {
    id: "l8",
    number: 8,
    title: "Checkout",
    project: "shoply — e-commerce at scale",
    users: 8_000_000,
    usersEnd: 15_000_000,
    durationTicks: 150,
    brief: [
      "**shoply** processes real money now. Carts, payments, inventory — and a Black-Friday-sized sale event on the calendar.",
      "Money makes everything harder: a dropped write is lost revenue, a *duplicated* write is a double-charged customer and a viral tweet.",
      "Your retries, your queues, your failovers — all of them can duplicate or drop work. Design for exactly-once *effects* in an at-least-once world.",
    ],
    workload: {
      rpsPerKUsers: 10, readRatio: 0.75, staticRatio: 0.35, searchRatio: 0.08,
      storageGbPerDayPer10k: 12, peakMult: 2.5, skew: 0.45, needsStrongConsistency: true,
    },
    slo: { maxP95Ms: 350, minAvailabilityPct: 99.9, maxErrorRate: 0.01, maxMonthlyBudget: 55_000 },
    scripted: [
      { atTick: 40, type: "traffic_spike", magnitude: 4, durationTicks: 30, announcement: "🛍️ The Big Sale is LIVE. Checkout traffic 4×." },
      { atTick: 55, type: "node_crash", targetKind: "api_server", announcement: "An API instance died mid-sale. Requests in flight were lost… or were they?" },
      { atTick: 56, type: "node_crash", targetKind: "k8s_cluster", announcement: "A pod died mid-sale. Requests in flight were lost… or were they?" },
      { atTick: 100, type: "bad_deploy", magnitude: 1.8, durationTicks: 15, announcement: "🚀 Someone shipped an unoptimized query to checkout. DB load climbing." },
    ],
    unlocked: [...BASE_UNLOCKS, "redis", "monitoring", "load_balancer", "k8s_cluster", "cdn", "kafka", "rabbitmq", "sqs", "worker", "cassandra", "dynamodb", "elasticsearch"],
    debrief: {
      concept: "Distributed transactions, idempotency & CAP in production",
      explanation: [
        "At-least-once delivery (retries, queues, failovers) means duplicate writes are a *certainty*, not a risk. Idempotency keys — a client-generated unique id checked before applying a write — make the duplicate a no-op. That's how payment systems sleep at night.",
        "CAP theorem stopped being theory: during the partition you chose either consistency (reject writes, stay correct) or availability (accept writes, reconcile later). Payments choose consistency; carts choose availability. *Per-operation*, not per-system.",
        "Search moved to Elasticsearch — product search on the primary DB was eating 20× CPU per query.",
      ],
      tradeoffs: [
        "Strong consistency costs latency and availability (coordination is expensive). Reserve it for money and inventory; let browsing be eventual.",
        "Idempotency requires a dedup store and discipline in every write path — boring, unglamorous, and absolutely mandatory.",
        "Two-phase commit across services is usually a trap at scale; sagas (compensating actions) trade atomicity for availability.",
      ],
    },
  },

  {
    id: "l9",
    number: 9,
    title: "The Stream Must Flow",
    project: "streamio — global video",
    users: 30_000_000,
    usersEnd: 60_000_000,
    durationTicks: 150,
    brief: [
      "**streamio** serves video to the planet. 97% of traffic is reads, most of it the same popular shows, watched from every continent.",
      "Tonight: the season finale of your flagship show premieres globally. Also tonight (you don't know this yet): your primary region is going to have a Very Bad Day.",
      "The show must not stop.",
    ],
    workload: {
      rpsPerKUsers: 20, readRatio: 0.97, staticRatio: 0.85, searchRatio: 0.02,
      storageGbPerDayPer10k: 5, peakMult: 2.8, skew: 0.7, needsStrongConsistency: false,
    },
    slo: { maxP95Ms: 200, minAvailabilityPct: 99.9, maxErrorRate: 0.008, maxMonthlyBudget: 130_000 },
    scripted: [
      { atTick: 40, type: "traffic_spike", magnitude: 2.8, durationTicks: 40, announcement: "🎬 Season finale premiere. The whole planet pressed play." },
      { atTick: 70, type: "region_failure", magnitude: 0.55, durationTicks: 25, announcement: "🌩️ Major cloud region degradation. Half your primary-region capacity is GONE." },
    ],
    unlocked: [...BASE_UNLOCKS, "redis", "monitoring", "load_balancer", "k8s_cluster", "cdn", "kafka", "rabbitmq", "sqs", "worker", "cassandra", "dynamodb", "elasticsearch"],
    debrief: {
      concept: "CDN, multi-region & disaster recovery",
      explanation: [
        "At streaming scale the CDN isn't an optimization — it IS the product. 85%+ of bytes served from edge caches means your origin handles metadata, not video. Edge latency is also the only way to beat the speed of light.",
        "The region failure taught the multi-region lesson: redundancy must extend to *geography*. Capacity spread across regions (more instances, managed multi-AZ services) survives a regional outage; a single-region masterpiece does not.",
      ],
      tradeoffs: [
        "Multi-region active-active doubles infrastructure cost and forces you to answer 'which region owns this write?' — data consistency across regions is genuinely hard.",
        "DR has tiers: backups (hours to recover) → warm standby (minutes) → active-active (seconds). Each tier costs roughly an order of magnitude more. Buy what your SLA actually requires.",
        "Overprovisioning for failure means most days you're paying for capacity you don't use. That's not waste — that's insurance.",
      ],
    },
  },

  {
    id: "l10",
    number: 10,
    title: "Planet Scale",
    project: "your empire — all products, one platform",
    users: 100_000_000,
    usersEnd: 150_000_000,
    durationTicks: 160,
    brief: [
      "The board merged everything: chat, photos, rides, shopping, video — one platform, one hundred million users, one CTO. You.",
      "Everything you've learned applies at once: caching, sharding, queues, redundancy, idempotency, observability, multi-region. And the CFO wants the infra bill *down* 10% this quarter.",
      "There is no next level. This is the job.",
    ],
    workload: {
      rpsPerKUsers: 15, readRatio: 0.85, staticRatio: 0.5, searchRatio: 0.05,
      storageGbPerDayPer10k: 20, peakMult: 2.5, skew: 0.6, needsStrongConsistency: true,
    },
    slo: { maxP95Ms: 250, minAvailabilityPct: 99.95, maxErrorRate: 0.005, maxMonthlyBudget: 280_000 },
    scripted: [
      { atTick: 30, type: "traffic_spike", magnitude: 2.2, durationTicks: 25, announcement: "New Year's Eve. Every product is peaking simultaneously." },
      { atTick: 60, type: "hot_key", durationTicks: 18, announcement: "⭐ A celebrity wedding is being live-streamed, chatted, photographed and shopped. One entity, all products." },
      { atTick: 95, type: "region_failure", magnitude: 0.5, durationTicks: 20, announcement: "🌩️ Regional outage. Again. It's always DNS. (It's not DNS.)" },
      { atTick: 125, type: "bad_deploy", magnitude: 1.7, durationTicks: 12, announcement: "🚀 A holiday-eve deploy. Bold. Query load climbing." },
    ],
    unlocked: [...BASE_UNLOCKS, "redis", "monitoring", "load_balancer", "k8s_cluster", "cdn", "kafka", "rabbitmq", "sqs", "worker", "cassandra", "dynamodb", "elasticsearch"],
    debrief: {
      concept: "Systems thinking at global scale",
      explanation: [
        "No single technique saved you here — the *composition* did: CDN absorbing edge reads, caches absorbing hot reads, queues absorbing write bursts, shards splitting write load, replicas and regions absorbing failures, breakers stopping cascades, observability telling you which of these was the problem.",
        "Notice what scale actually changed: not the concepts, but the consequences. Every small sloppiness (a missing index, a hot key, an unjittered TTL) that was survivable at 10k users became an outage at 100M.",
      ],
      tradeoffs: [
        "Cost-performance is now a first-class engineering axis: at this scale, a 10% efficiency win pays several engineers' salaries.",
        "Complexity is the silent killer: every component you add is something that pages someone. The best architects delete components as often as they add them.",
        "There is no 'done' — traffic shifts, hot spots move, hardware dies. You don't build a system that can't fail; you build one that fails small.",
      ],
    },
  },
];

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

export function defaultStarter(): GraphSnapshot {
  return starter("users", "api_server", "mongodb");
}
