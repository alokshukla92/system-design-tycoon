import type {
  ArchNodeData,
  ComponentKind,
  GraphSnapshot,
  NodeRuntime,
  SimMetrics,
  WorkloadProfile,
} from "@/lib/types";
import { CATALOG } from "@/lib/catalog/components";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic tick-based simulation engine.
// 1 tick = 1 simulated minute. All math is pure given (state, graph, ctx).
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineNodeState {
  storedGb: number;
  backlog: number; // queued messages
  pods: number; // k8s current replicas
  breakerOpen: boolean;
  breakerTicks: number; // ticks breaker has been open
  highErrTicks: number; // consecutive ticks downstream was failing
  crashedInstances: number;
  stampedeTicks: number; // active cache-stampede countdown
  throttleTicks: number; // dynamodb hot-key throttle countdown
}

export interface EngineState {
  tick: number;
  nodes: Record<string, EngineNodeState>;
  successWindow: number[]; // last N tick success ratios → availability
  seed: number;
}

export interface TickContext {
  users: number;
  workload: WorkloadProfile;
  /** Traffic multiplier from spikes/viral events (1 = normal) */
  spikeMult: number;
  /** Celebrity / hot-key event active */
  hotKeyActive: boolean;
  /** Fraction of an AZ/region capacity knocked out (0 = none, 1 = total) */
  zoneOutage: number;
}

export type SignalType =
  | "overload"
  | "compute_overload"
  | "unindexed_slow"
  | "replication_lag"
  | "hot_partition"
  | "cache_stampede"
  | "queue_backlog"
  | "queue_no_consumer"
  | "disk_full"
  | "retry_storm"
  | "throttling"
  | "breaker_open"
  | "search_on_db"
  | "crash_unrouted"
  | "duplicate_writes"
  | "stale_reads";

export interface EmergentSignal {
  type: SignalType;
  nodeId: string;
  value: number; // signal-specific magnitude
}

export interface TickResult {
  state: EngineState;
  metrics: SimMetrics;
  runtimes: Record<string, NodeRuntime>;
  signals: EmergentSignal[];
}

// Deterministic RNG (mulberry32)
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function initialEngineState(seed = 42): EngineState {
  return { tick: 0, nodes: {}, successWindow: [], seed };
}

const DB_KINDS_SET = new Set<ComponentKind>(["postgres", "mysql", "mongodb", "cassandra", "dynamodb", "elasticsearch"]);

function nodeState(
  state: EngineState,
  id: string,
  kind: ComponentKind,
  data: ArchNodeData,
  initialFill = 0
): EngineNodeState {
  if (!state.nodes[id]) {
    const spec = CATALOG[kind];
    const tier = spec.tiers.find((t) => t.id === data.tier) ?? spec.tiers[0];
    state.nodes[id] = {
      storedGb: DB_KINDS_SET.has(kind) ? tier.storageGb * initialFill : 0,
      backlog: 0,
      pods: kind === "k8s_cluster" ? Number(data.config.minPods ?? 2) : 0,
      breakerOpen: false,
      breakerTicks: 0,
      highErrTicks: 0,
      crashedInstances: 0,
      stampedeTicks: 0,
      throttleTicks: 0,
    };
  }
  return state.nodes[id];
}

const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
const queueMult = (rho: number) => (rho >= 0.999 ? 25 : Math.min(25, 1 / (1 - rho)));

interface NodeView {
  id: string;
  data: ArchNodeData;
  kind: ComponentKind;
}

/** Effective read/write capacity of a node instance group right now. */
export function capacityOf(
  n: NodeView,
  ns: EngineNodeState,
  ctx: TickContext
): { read: number; write: number; tierStorageGb: number; aliveInstances: number; totalInstances: number } {
  const spec = CATALOG[n.kind];
  const tier = spec.tiers.find((t) => t.id === n.data.tier) ?? spec.tiers[0];
  const cfg = n.data.config;

  let totalInstances = Math.max(1, n.data.instances);
  if (n.kind === "k8s_cluster") totalInstances = Math.max(1, Math.round(ns.pods));

  const zoneLost = Math.floor(totalInstances * ctx.zoneOutage);
  const aliveInstances = Math.max(0, totalInstances - ns.crashedInstances - zoneLost);

  let read = spec.readCapacityRps * tier.capacityMult;
  let write = spec.writeCapacityRps * tier.capacityMult;
  let storageGb = tier.storageGb;

  // Databases: indexing, replicas, shards
  if (n.kind === "postgres" || n.kind === "mysql" || n.kind === "mongodb") {
    const indexed = cfg.indexing === "tuned";
    if (!indexed) {
      // Unindexed read capacity collapses as data grows (sequential scans).
      const fill = Math.min(1, ns.storedGb / Math.max(1, storageGb));
      read = read / (1 + fill * 14);
    } else {
      write *= 0.92; // index maintenance overhead
    }
    const replicas = num(cfg.readReplicas ?? cfg.replicaSet, 0);
    read *= 1 + replicas * 0.9; // each replica ≈ +90% read capacity
    if (n.kind === "mongodb") {
      const shards = Math.max(1, num(cfg.shards, 1));
      let eff = 1;
      if (shards > 1) {
        if (cfg.shardKey === "hashed") eff = shards * 0.95;
        else if (cfg.shardKey === "low_card") eff = Math.min(shards, 3) * 0.6;
        else eff = 1.15; // monotonic: all new writes land on one shard
      }
      write *= eff;
      read *= shards > 1 ? Math.max(1, shards * 0.8) : 1;
      storageGb *= shards;
    }
  }

  if (n.kind === "cassandra") {
    // Near-linear write scaling with nodes; key design caps it
    const keyEff = cfg.partitionKey === "balanced" ? 0.95 : Math.max(0.3, 0.95 - ctx.workload.skew * 0.6);
    read *= aliveInstances * 0.85;
    write *= aliveInstances * keyEff;
    storageGb *= totalInstances;
    return { read, write, tierStorageGb: storageGb, aliveInstances, totalInstances };
  }

  if (n.kind === "dynamodb") {
    // Hot key throttling handled in the flow; capacity itself is huge
    return { read, write, tierStorageGb: storageGb, aliveInstances: 1, totalInstances: 1 };
  }

  if (n.kind === "kafka") {
    const partitions = Math.max(1, num(cfg.partitions, 3));
    const keyEff = cfg.keying === "balanced" ? 0.9 : Math.max(0.25, 0.9 - ctx.workload.skew * 0.7);
    write = spec.writeCapacityRps * Math.min(partitions, 64) * keyEff * 0.4;
    storageGb = tier.storageGb;
    return { read, write, tierStorageGb: storageGb, aliveInstances, totalInstances };
  }

  // Per-instance kinds scale linearly with alive instances
  read *= Math.max(0, aliveInstances);
  write *= Math.max(0, aliveInstances);
  storageGb *= Math.max(1, totalInstances);
  return { read, write, tierStorageGb: storageGb, aliveInstances, totalInstances };
}

/** Monthly cost of a node group, including usage-priced services. */
export function costOf(n: NodeView, ns: EngineNodeState, servedRps: number): number {
  const spec = CATALOG[n.kind];
  const tier = spec.tiers.find((t) => t.id === n.data.tier) ?? spec.tiers[0];
  let instances = Math.max(1, n.data.instances);
  if (n.kind === "k8s_cluster") instances = Math.max(1, Math.round(ns.pods));
  let cost = spec.costPerMonthUsd * tier.costMult * instances;
  // Replicas and shards are real machines — they cost like the primary.
  const replicas = num(n.data.config.readReplicas ?? n.data.config.replicaSet, 0);
  if (replicas > 0) cost *= 1 + replicas;
  const shards = num(n.data.config.shards, 1);
  if (shards > 1) cost *= shards;
  // Usage pricing (per ~million requests over a month: rps × 2.63)
  if (n.kind === "dynamodb") cost += servedRps * 2.63 * 0.45;
  if (n.kind === "sqs") cost += servedRps * 2.63 * 0.4;
  if (n.kind === "cdn") cost += servedRps * 2.63 * 0.02;
  return cost;
}

interface Adjacency {
  out: Record<string, string[]>;
  byKind: (kinds: ComponentKind[]) => NodeView[];
  views: NodeView[];
  byId: Record<string, NodeView>;
}

function buildAdjacency(graph: GraphSnapshot): Adjacency {
  const out: Record<string, string[]> = {};
  for (const e of graph.edges) {
    (out[e.source] ??= []).push(e.target);
  }
  const views: NodeView[] = graph.nodes.map((n) => ({ id: n.id, data: n.data, kind: n.data.kind }));
  const byId: Record<string, NodeView> = {};
  for (const v of views) byId[v.id] = v;
  return {
    out,
    views,
    byId,
    byKind: (kinds) => views.filter((v) => kinds.includes(v.kind)),
  };
}

/** Nodes reachable from `fromId` matching kinds (1 hop, or through LB) */
function downstream(adj: Adjacency, fromId: string, kinds: ComponentKind[]): NodeView[] {
  const direct = (adj.out[fromId] ?? []).map((id) => adj.byId[id]).filter(Boolean);
  const hits = direct.filter((v) => kinds.includes(v.kind));
  // also look through load balancers
  for (const lb of direct.filter((v) => v.kind === "load_balancer")) {
    for (const id of adj.out[lb.id] ?? []) {
      const v = adj.byId[id];
      if (v && kinds.includes(v.kind)) hits.push(v);
    }
  }
  return hits;
}

const COMPUTE: ComponentKind[] = ["api_server", "k8s_cluster"];
const DBS: ComponentKind[] = ["postgres", "mysql", "mongodb", "cassandra", "dynamodb"];
const QUEUES: ComponentKind[] = ["kafka", "rabbitmq", "sqs"];

export interface FlowOptions {
  /** When true the run is for scoring only (no signal emission needed) */
  silent?: boolean;
}

export function stepSim(
  prev: EngineState,
  graph: GraphSnapshot,
  ctx: TickContext,
  _opts: FlowOptions = {}
): TickResult {
  // clone shallow state (node states mutated on the clone)
  const state: EngineState = {
    tick: prev.tick + 1,
    nodes: Object.fromEntries(Object.entries(prev.nodes).map(([k, v]) => [k, { ...v }])),
    successWindow: [...prev.successWindow],
    seed: prev.seed,
  };
  const random = rng(state.seed + state.tick * 7919);
  const adj = buildAdjacency(graph);
  const signals: EmergentSignal[] = [];
  const runtimes: Record<string, NodeRuntime> = {};

  const W = ctx.workload;
  // Diurnal wave + spike events
  const diurnal = 1 + (W.peakMult - 1) * 0.5 * (1 + Math.sin((state.tick / 120) * Math.PI * 2));
  const totalRps = (ctx.users / 1000) * W.rpsPerKUsers * diurnal * ctx.spikeMult;
  let readRps = totalRps * W.readRatio;
  let writeRps = totalRps * (1 - W.readRatio);
  const searchRps = readRps * W.searchRatio;
  readRps -= searchRps;

  let lostRps = 0; // requests that failed somewhere
  let latencyAccum = 0; // demand-weighted latency of successful requests
  let servedAccum = 0;

  const ensure = (v: NodeView) => nodeState(state, v.id, v.kind, v.data, W.initialDbFillPct ?? 0);
  const baseRuntime = (): NodeRuntime => ({
    utilization: 0,
    latencyMs: 0,
    errorRate: 0,
    inboundRps: 0,
    servedRps: 0,
    storagePct: 0,
    backlog: 0,
    replicationLagMs: 0,
    crashed: false,
    crashedInstances: 0,
    status: "ok",
    activeFailures: [],
  });
  for (const v of adj.views) runtimes[v.id] = baseRuntime();

  // ── Entry: users → cdn? → (lb?) → compute ─────────────────────────────────
  const usersNode = adj.views.find((v) => v.kind === "users");
  const entryTargets = usersNode ? (adj.out[usersNode.id] ?? []).map((id) => adj.byId[id]).filter(Boolean) : [];

  // CDN absorbs static reads
  let cdnLatency = 0;
  const cdn = entryTargets.find((v) => v.kind === "cdn") ?? adj.views.find((v) => v.kind === "cdn" && entryTargets.some((t) => (adj.out[t.id] ?? []).includes(v.id)));
  if (cdn) {
    const ns = ensure(cdn);
    const ratio = cdn.data.config.cacheRatio === "aggressive" ? 0.95 : 0.6;
    const absorbed = readRps * W.staticRatio * ratio;
    readRps -= absorbed;
    const cap = capacityOf(cdn, ns, ctx);
    const rho = absorbed / Math.max(1, cap.read);
    const rt = runtimes[cdn.id];
    rt.inboundRps = absorbed;
    rt.servedRps = absorbed;
    rt.utilization = rho;
    rt.latencyMs = CATALOG.cdn.baseLatencyMs.read * queueMult(Math.min(rho, 0.98));
    cdnLatency = rt.latencyMs;
    latencyAccum += absorbed * rt.latencyMs;
    servedAccum += absorbed;
  }

  // Compute layer: all compute nodes reachable from users (direct or via lb/cdn)
  const computeSet = new Map<string, NodeView>();
  const lbs: NodeView[] = [];
  const visit = (v: NodeView) => {
    if (COMPUTE.includes(v.kind)) computeSet.set(v.id, v);
    if (v.kind === "load_balancer" || v.kind === "cdn") {
      if (v.kind === "load_balancer") lbs.push(v);
      for (const id of adj.out[v.id] ?? []) {
        const t = adj.byId[id];
        if (t && (COMPUTE.includes(t.kind) || t.kind === "load_balancer")) visit(t);
      }
    }
  };
  entryTargets.forEach(visit);
  const computes = [...computeSet.values()];

  const dynamicDemand = readRps + writeRps + searchRps;

  if (computes.length === 0) {
    // No backend at all — everything fails.
    lostRps += dynamicDemand;
  }

  // LB capacity check + latency
  let lbLatency = 0;
  for (const lb of lbs) {
    const ns = ensure(lb);
    const cap = capacityOf(lb, ns, ctx);
    const rho = dynamicDemand / Math.max(1, cap.read);
    const rt = runtimes[lb.id];
    rt.inboundRps = dynamicDemand;
    rt.utilization = rho;
    rt.latencyMs = CATALOG.load_balancer.baseLatencyMs.read * queueMult(Math.min(rho, 0.98));
    rt.servedRps = Math.min(dynamicDemand, cap.read);
    lbLatency = Math.max(lbLatency, rt.latencyMs);
  }

  // Split traffic across compute nodes.
  // Crashed instances inside a group: LB health checks reroute; without LB
  // (or with checks off) the crashed share simply fails.
  let acceptedRead = 0;
  let acceptedWrite = 0;
  let acceptedSearch = 0;
  let computeLatency = 0;
  let rateLimited = 0;
  const shares = computes.length;

  // Retry/breaker flags from any compute node (applied to downstream calls)
  const anyCfg = (key: string) => computes.some((c) => c.data.config[key] === true);
  const retriesOn = anyCfg("retries");
  const breakerOn = anyCfg("circuitBreaker");
  const limiterOn = anyCfg("rateLimiter");
  const idemOn = anyCfg("idempotencyKeys");

  for (const c of computes) {
    const ns = ensure(c);
    const rt = runtimes[c.id];
    const share = dynamicDemand / shares;
    const cap = capacityOf(c, ns, ctx);

    // K8s autoscaling: pods drift toward target with delay (20%/tick)
    if (c.kind === "k8s_cluster") {
      const minPods = num(c.data.config.minPods, 2);
      const maxPods = num(c.data.config.maxPods, 10);
      const perPod = CATALOG.k8s_cluster.readCapacityRps;
      const target = Math.min(maxPods, Math.max(minPods, Math.ceil(share / (perPod * 0.65))));
      const delta = target - ns.pods;
      ns.pods = Math.max(minPods, Math.min(maxPods, ns.pods + Math.sign(delta) * Math.max(0.4, Math.abs(delta) * 0.2)));
    }

    const groupCap = cap.read; // compute treats read/write the same
    const healthChecked = lbs.length > 0 && lbs.every((lb) => lb.data.config.healthChecks !== false);
    const deadShare =
      cap.totalInstances > 0 && !healthChecked
        ? (ns.crashedInstances + Math.floor(cap.totalInstances * ctx.zoneOutage)) / cap.totalInstances
        : 0;

    let inbound = share;
    const failedByDead = inbound * deadShare;
    inbound -= failedByDead;
    lostRps += failedByDead;
    if (failedByDead > 1) signals.push({ type: "crash_unrouted", nodeId: c.id, value: failedByDead });

    let accepted = inbound;
    if (limiterOn && inbound > groupCap * 0.92) {
      const shed = inbound - groupCap * 0.92;
      accepted = groupCap * 0.92;
      rateLimited += shed;
      lostRps += shed; // 429s — counted as errors but they protect downstream
    }

    const rho = accepted / Math.max(1, groupCap);
    let nodeErr = 0;
    if (rho > 1) {
      const excess = accepted - groupCap;
      nodeErr = excess / accepted;
      lostRps += excess;
      accepted = groupCap;
      signals.push({ type: "compute_overload", nodeId: c.id, value: rho });
    }

    rt.inboundRps = share;
    rt.servedRps = accepted;
    rt.utilization = rho;
    rt.errorRate = nodeErr + deadShare;
    rt.latencyMs = CATALOG[c.kind].baseLatencyMs.read * queueMult(Math.min(rho, 0.98));
    rt.crashedInstances = ns.crashedInstances;
    computeLatency = Math.max(computeLatency, rt.latencyMs);

    const frac = accepted / Math.max(1, dynamicDemand);
    acceptedRead += readRps * frac;
    acceptedWrite += writeRps * frac;
    acceptedSearch += searchRps * frac;
  }

  // ── Downstream from compute: cache / search / queue / db ──────────────────
  const dbNodes = computes.flatMap((c) => downstream(adj, c.id, DBS));
  const cacheNodes = computes.flatMap((c) => downstream(adj, c.id, ["redis"]));
  const searchNodes = computes.flatMap((c) => downstream(adj, c.id, ["elasticsearch"]));
  const queueNodes = computes.flatMap((c) => downstream(adj, c.id, QUEUES));
  const uniq = <T extends NodeView>(arr: T[]) => [...new Map(arr.map((v) => [v.id, v])).values()];
  const dbs = uniq(dbNodes);
  const caches = uniq(cacheNodes);
  const searches = uniq(searchNodes);
  const queues = uniq(queueNodes);

  let dbReadDemand = acceptedRead;
  let readPathLatency = 0;

  // Cache absorbs reads
  if (caches.length > 0 && acceptedRead > 0) {
    const cache = caches[0];
    const ns = ensure(cache);
    const cfg = cache.data.config;
    let hit =
      cfg.ttl === "short" ? 0.68 : 0.86;
    if (cfg.strategy === "write_through") hit += 0.04;

    // Cache stampede: hot key expiry without jitter/locking
    if (
      cfg.ttl !== "long_jitter" &&
      ns.stampedeTicks === 0 &&
      (ctx.hotKeyActive || (W.skew > 0.45 && random() < 0.012))
    ) {
      ns.stampedeTicks = 4;
    }
    if (ns.stampedeTicks > 0) {
      ns.stampedeTicks -= 1;
      hit *= 0.35; // synchronized misses flood the DB
      signals.push({ type: "cache_stampede", nodeId: cache.id, value: 1 - hit });
    }

    const cap = capacityOf(cache, ns, ctx);
    const wanted = acceptedRead * hit;
    const servedFromCache = Math.min(wanted, cap.read);
    const rho = wanted / Math.max(1, cap.read);
    dbReadDemand = acceptedRead - servedFromCache;

    const rt = runtimes[cache.id];
    rt.inboundRps = acceptedRead;
    rt.servedRps = servedFromCache;
    rt.utilization = rho;
    rt.latencyMs = CATALOG.redis.baseLatencyMs.read * queueMult(Math.min(rho, 0.98));
    rt.crashedInstances = ns.crashedInstances;
    if (ns.crashedInstances > 0) {
      // cache down → everything misses
      dbReadDemand = acceptedRead;
      rt.servedRps = 0;
      rt.crashed = true;
    }
    readPathLatency += rt.latencyMs;
  }

  // Search traffic
  let searchToDb = 0;
  if (acceptedSearch > 0) {
    if (searches.length > 0) {
      const es = searches[0];
      const ns = ensure(es);
      const cap = capacityOf(es, ns, ctx);
      const rho = acceptedSearch / Math.max(1, cap.read);
      const served = Math.min(acceptedSearch, cap.read);
      lostRps += acceptedSearch - served;
      const rt = runtimes[es.id];
      rt.inboundRps = acceptedSearch;
      rt.servedRps = served;
      rt.utilization = rho;
      rt.latencyMs = CATALOG.elasticsearch.baseLatencyMs.read * queueMult(Math.min(rho, 0.98));
      latencyAccum += served * (computeLatency + rt.latencyMs);
      servedAccum += served;
      if (rho > 0.9) signals.push({ type: "overload", nodeId: es.id, value: rho });
    } else {
      // Search queries hammer the DB at ~18× the cost of a normal read
      searchToDb = acceptedSearch * 18;
      if (dbs.length > 0 && acceptedSearch > 5) {
        signals.push({ type: "search_on_db", nodeId: dbs[0].id, value: acceptedSearch });
      }
    }
  }

  // Write path: queue decouples, else direct to DB
  let dbWriteDemand = acceptedWrite;
  let writeAckLatency = 0;
  if (queues.length > 0 && acceptedWrite > 0) {
    const q = queues[0];
    const ns = ensure(q);
    const cap = capacityOf(q, ns, ctx);
    const rho = acceptedWrite / Math.max(1, cap.write);
    const enq = Math.min(acceptedWrite, cap.write);
    lostRps += acceptedWrite - enq;
    if (rho > 1) signals.push({ type: "hot_partition", nodeId: q.id, value: rho });

    // Workers drain the queue into the DB
    const workers = uniq(downstream(adj, q.id, ["worker"]));
    let drainCap = 0;
    for (const w of workers) {
      const wns = ensure(w);
      const wcap = capacityOf(w, wns, ctx);
      drainCap += wcap.write;
    }
    // consumer parallelism capped by partitions (kafka)
    if (q.kind === "kafka") {
      const partitions = Math.max(1, num(q.data.config.partitions, 3));
      drainCap = Math.min(drainCap, partitions * 420);
    }
    const backlogBefore = ns.backlog;
    // ticks are minutes: net flow × 60 s
    ns.backlog = Math.max(0, ns.backlog + (enq - drainCap) * 60);
    const drained = Math.min(drainCap, enq + backlogBefore / 60);
    dbWriteDemand = drained; // DB sees smooth drain, not the burst

    const rt = runtimes[q.id];
    rt.inboundRps = acceptedWrite;
    rt.servedRps = enq;
    rt.utilization = rho;
    rt.backlog = ns.backlog;
    rt.latencyMs = CATALOG[q.kind].baseLatencyMs.write * queueMult(Math.min(rho, 0.98));
    writeAckLatency = rt.latencyMs;

    if (workers.length === 0 && enq > 1) {
      signals.push({ type: "queue_no_consumer", nodeId: q.id, value: ns.backlog });
    } else if (ns.backlog > 30_000 && ns.backlog > backlogBefore) {
      signals.push({ type: "queue_backlog", nodeId: q.id, value: ns.backlog });
    }

    for (const w of workers) {
      const wns = ensure(w);
      const wcap = capacityOf(w, wns, ctx);
      const wrho = dbWriteDemand / Math.max(1, drainCap);
      const wrt = runtimes[w.id];
      wrt.inboundRps = dbWriteDemand * (wcap.write / Math.max(1, drainCap));
      wrt.servedRps = wrt.inboundRps;
      wrt.utilization = wrho;
      wrt.latencyMs = CATALOG.worker.baseLatencyMs.write;
      // At-least-once + no idempotency → duplicate writes sneak through
      if (q.kind === "sqs" && w.data.config.idempotencyKeys !== true && wrt.servedRps > 10 && random() < 0.02) {
        signals.push({ type: "duplicate_writes", nodeId: w.id, value: wrt.servedRps * 0.01 });
      }
    }
  }

  // ── Databases ──────────────────────────────────────────────────────────────
  let dbLatencyRead = 0;
  let dbLatencyWrite = 0;
  let dbErr = 0;
  if (dbs.length > 0) {
    const readShare = (dbReadDemand + searchToDb) / dbs.length;
    const writeShare = dbWriteDemand / dbs.length;
    for (const db of dbs) {
      const ns = ensure(db);
      const cfg = db.data.config;
      const cap = capacityOf(db, ns, ctx);
      const rt = runtimes[db.id];

      let readDemandHere = readShare;
      let writeDemandHere = writeShare;

      // Retry amplification: when this DB was erroring last tick and retries
      // are on, demand inflates. Breaker (if open) sheds instead.
      const prevNs = prev.nodes[db.id];
      const wasFailing = (prevNs?.highErrTicks ?? 0) > 0;
      if (wasFailing && retriesOn && !ns.breakerOpen) {
        const amp = 1.9; // each failed call retried ~once more, plus timeouts piling
        readDemandHere *= amp;
        writeDemandHere *= amp;
        signals.push({ type: "retry_storm", nodeId: db.id, value: amp });
        if (!idemOn && writeDemandHere > 10) {
          signals.push({ type: "duplicate_writes", nodeId: db.id, value: writeDemandHere * 0.02 });
        }
      }

      // Circuit breaker: open after 3 failing ticks; while open, only a probe
      // trickle reaches the DB and the rest fails fast upstream.
      if (breakerOn) {
        if (ns.highErrTicks >= 3 && !ns.breakerOpen) {
          ns.breakerOpen = true;
          ns.breakerTicks = 0;
        }
        if (ns.breakerOpen) {
          ns.breakerTicks += 1;
          const shedR = readDemandHere * 0.9;
          const shedW = writeDemandHere * 0.9;
          readDemandHere *= 0.1;
          writeDemandHere *= 0.1;
          lostRps += shedR + shedW; // fail fast — errors, but cheap ones
          signals.push({ type: "breaker_open", nodeId: db.id, value: ns.breakerTicks });
        }
      }

      // Hot partition / hot key (sharded mongo with bad key, ddb skewed key)
      let hotCap = 1;
      if (db.kind === "mongodb" && num(cfg.shards, 1) > 1 && cfg.shardKey !== "hashed" && (ctx.hotKeyActive || W.skew > 0.5)) {
        hotCap = 0.45;
        signals.push({ type: "hot_partition", nodeId: db.id, value: W.skew });
      }
      if (db.kind === "dynamodb" && cfg.keyDesign === "skewed" && (ctx.hotKeyActive || W.skew > 0.5)) {
        // per-key throttle: cap a chunk of traffic
        ns.throttleTicks = 2;
      }
      let throttled = 0;
      if (db.kind === "dynamodb" && ns.throttleTicks > 0) {
        ns.throttleTicks -= 1;
        throttled = (readDemandHere + writeDemandHere) * 0.25;
        lostRps += throttled;
        readDemandHere *= 0.75;
        writeDemandHere *= 0.75;
        signals.push({ type: "throttling", nodeId: db.id, value: throttled });
      }

      const effRead = cap.read * hotCap;
      const effWrite = cap.write * hotCap;
      // Cassandra ALL: any dead node blocks writes
      let consistencyPenalty = 1;
      if (db.kind === "cassandra") {
        if (cfg.consistencyLevel === "all" && (ns.crashedInstances > 0 || ctx.zoneOutage > 0)) consistencyPenalty = 0;
        if (cfg.consistencyLevel === "quorum") consistencyPenalty = 0.92;
        if (cfg.consistencyLevel === "one" && writeDemandHere > effWrite * 0.5 && random() < 0.05) {
          signals.push({ type: "stale_reads", nodeId: db.id, value: 1 });
        }
      }

      const rhoR = readDemandHere / Math.max(1, effRead);
      const rhoW = writeDemandHere / Math.max(1, effWrite * consistencyPenalty);
      const rho = Math.max(rhoR, rhoW);

      let servedR = Math.min(readDemandHere, effRead);
      let servedW = Math.min(writeDemandHere, effWrite * consistencyPenalty);
      if (cap.aliveInstances === 0) {
        servedR = 0;
        servedW = 0;
        rt.crashed = true;
      }
      const failedHere = readDemandHere + writeDemandHere - servedR - servedW;
      lostRps += failedHere;
      const errHere = failedHere / Math.max(1, readDemandHere + writeDemandHere);

      ns.highErrTicks = errHere > 0.08 ? ns.highErrTicks + 1 : 0;
      if (ns.breakerOpen && errHere < 0.05 && ns.breakerTicks > 4) {
        ns.breakerOpen = false; // half-open probe succeeded
      }

      // Storage fill
      const gbPerTick = (W.storageGbPerDayPer10k * (ctx.users / 10_000)) / (24 * 60);
      ns.storedGb += gbPerTick / Math.max(1, dbs.length);
      const storagePct = Math.min(1, ns.storedGb / Math.max(1, cap.tierStorageGb));
      if (storagePct >= 1) {
        lostRps += servedW;
        servedW = 0;
        signals.push({ type: "disk_full", nodeId: db.id, value: 1 });
      }

      // Replication lag for replicated SQL/Mongo
      const replicas = num(cfg.readReplicas ?? cfg.replicaSet, 0);
      let lagMs = 0;
      if (replicas > 0) {
        const wUtil = Math.min(1.5, rhoW);
        lagMs = wUtil < 0.5 ? 10 : 10 + Math.pow(wUtil - 0.5, 2) * 9000;
        if (lagMs > 800) signals.push({ type: "replication_lag", nodeId: db.id, value: lagMs });
      }

      const spec = CATALOG[db.kind];
      const indexPenalty =
        (db.kind === "postgres" || db.kind === "mysql" || db.kind === "mongodb") && cfg.indexing !== "tuned"
          ? 1 + Math.min(1, ns.storedGb / Math.max(1, cap.tierStorageGb)) * 14
          : 1;
      const latR = spec.baseLatencyMs.read * indexPenalty * queueMult(Math.min(rhoR, 0.98));
      const latW = spec.baseLatencyMs.write * queueMult(Math.min(rhoW, 0.98));
      if (indexPenalty > 6 && servedR > 5) signals.push({ type: "unindexed_slow", nodeId: db.id, value: latR });
      if (rho > 0.9 && cap.aliveInstances > 0) signals.push({ type: "overload", nodeId: db.id, value: rho });

      rt.inboundRps = readDemandHere + writeDemandHere;
      rt.servedRps = servedR + servedW;
      rt.utilization = rho;
      rt.errorRate = errHere;
      rt.latencyMs = Math.max(latR, latW);
      rt.storagePct = storagePct;
      rt.replicationLagMs = lagMs;
      rt.crashedInstances = ns.crashedInstances;

      dbLatencyRead = Math.max(dbLatencyRead, latR);
      dbLatencyWrite = Math.max(dbLatencyWrite, latW);
      dbErr = Math.max(dbErr, errHere);
    }
  } else if (dbReadDemand + dbWriteDemand > 0.05 && computes.length > 0) {
    // No database connected — nothing persists, everything dynamic fails
    lostRps += dbReadDemand + dbWriteDemand;
  }

  // ── Aggregate latency/error metrics ────────────────────────────────────────
  const servedReads = Math.max(0, dbReadDemand >= 0 ? acceptedRead - Math.max(0, dbErr * acceptedRead * 0.5) : acceptedRead);
  const cacheServed = caches.length > 0 ? runtimes[caches[0].id].servedRps : 0;

  // read latency: cache hits fast, misses pay DB price
  const missShare = acceptedRead > 0 ? Math.max(0, acceptedRead - cacheServed) / acceptedRead : 1;
  const readLat = lbLatency + computeLatency + readPathLatency + missShare * dbLatencyRead;
  const writeLat =
    lbLatency + computeLatency + (queues.length > 0 ? writeAckLatency : dbLatencyWrite);

  latencyAccum += servedReads * readLat + acceptedWrite * writeLat;
  servedAccum += servedReads + acceptedWrite;

  const meanLat = servedAccum > 0 ? latencyAccum / servedAccum : 0;
  const p95 = meanLat * 1.7 + 5;

  const offered = totalRps;
  const failed = Math.min(offered, lostRps);
  const successRatio = offered > 0 ? Math.max(0, 1 - failed / offered) : 1;
  state.successWindow.push(successRatio);
  if (state.successWindow.length > 60) state.successWindow.shift();
  const availability =
    (state.successWindow.reduce((a, b) => a + b, 0) / Math.max(1, state.successWindow.length)) * 100;

  // total cost
  let cost = 0;
  for (const v of adj.views) {
    const ns = ensure(v);
    cost += costOf(v, ns, runtimes[v.id]?.servedRps ?? 0);
  }

  // statuses
  for (const v of adj.views) {
    const rt = runtimes[v.id];
    const ns = state.nodes[v.id];
    if (rt.crashed || (ns && ns.crashedInstances >= Math.max(1, v.data.instances))) rt.status = "down";
    else if (rt.utilization > 1 || rt.errorRate > 0.15 || rt.storagePct >= 1) rt.status = "crit";
    else if (rt.utilization > 0.75 || rt.errorRate > 0.02 || rt.storagePct > 0.85 || rt.backlog > 30_000)
      rt.status = "warn";
    else rt.status = "ok";
  }

  if (usersNode) {
    const rt = runtimes[usersNode.id];
    rt.inboundRps = offered;
    rt.servedRps = Math.max(0, offered - failed);
  }

  const backlogTotal = Object.values(state.nodes).reduce((a, n) => a + n.backlog, 0);

  const metrics: SimMetrics = {
    tick: state.tick,
    totalRps: offered,
    servedRps: Math.max(0, offered - failed),
    p95LatencyMs: Math.round(p95),
    errorRate: offered > 0 ? failed / offered : 0,
    availabilityPct: availability,
    costPerMonth: Math.round(cost),
    usersNow: ctx.users,
    queueBacklogTotal: Math.round(backlogTotal),
  };

  return { state, metrics, runtimes, signals };
}
