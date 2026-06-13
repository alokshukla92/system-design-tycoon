import { describe, expect, it } from "vitest";
import type { ArchNodeData, GraphSnapshot, WorkloadProfile } from "@/lib/types";
import { defaultConfig } from "@/lib/catalog/components";
import { initialEngineState, stepSim, type EngineState, type TickContext } from "./engine";
import { initialFailureState, stepFailures } from "./failures";
import { analyzeSpofs, computeScores } from "./scoring";

// ── helpers ──────────────────────────────────────────────────────────────────

let idc = 0;
function node(kind: ArchNodeData["kind"], overrides: Partial<ArchNodeData> = {}) {
  const id = `${kind}-${idc++}`;
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      kind,
      label: kind,
      tier: "small",
      instances: 1,
      config: { ...defaultConfig(kind), ...(overrides.config ?? {}) },
      ...overrides,
      // config merge above must win
    } as ArchNodeData,
  };
}

function graph(nodes: ReturnType<typeof node>[], edges: [string, string][]): GraphSnapshot {
  return {
    nodes,
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t })),
  };
}

const WORKLOAD: WorkloadProfile = {
  rpsPerKUsers: 10,
  readRatio: 0.9,
  staticRatio: 0.3,
  searchRatio: 0,
  storageGbPerDayPer10k: 1,
  peakMult: 1,
  skew: 0.2,
  needsStrongConsistency: false,
};

function run(g: GraphSnapshot, ctx: Partial<TickContext>, ticks = 8) {
  let st: EngineState = initialEngineState(1);
  const full: TickContext = {
    users: 1000,
    workload: WORKLOAD,
    spikeMult: 1,
    hotKeyActive: false,
    zoneOutage: 0,
    ...ctx,
  };
  let last;
  for (let i = 0; i < ticks; i++) {
    last = stepSim(st, g, full);
    st = last.state;
  }
  return last!;
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("basic flow", () => {
  it("small load on simple stack succeeds with low latency", () => {
    const u = node("users");
    const api = node("api_server");
    const db = node("mongodb");
    const g = graph([u, api, db], [[u.id, api.id], [api.id, db.id]]);
    const r = run(g, { users: 100 });
    expect(r.metrics.errorRate).toBeLessThan(0.01);
    expect(r.metrics.p95LatencyMs).toBeLessThan(120);
  });

  it("no backend means total failure", () => {
    const u = node("users");
    const g = graph([u], []);
    const r = run(g, { users: 1000 });
    expect(r.metrics.errorRate).toBeGreaterThan(0.9);
  });

  it("compute without a database fails dynamic traffic", () => {
    const u = node("users");
    const api = node("api_server");
    const g = graph([u, api], [[u.id, api.id]]);
    const r = run(g, { users: 100 });
    expect(r.metrics.errorRate).toBeGreaterThan(0.5);
  });
});

describe("overload mechanics", () => {
  it("single API server melts under 10k users and emits overload signal", () => {
    const u = node("users");
    const api = node("api_server"); // 600 rps capacity vs 100 rps... use more users
    const db = node("postgres", { config: { indexing: "tuned" } });
    const g = graph([u, api, db], [[u.id, api.id], [api.id, db.id]]);
    const r = run(g, { users: 100_000 }); // 1000 rps > 600 cap
    expect(r.metrics.errorRate).toBeGreaterThan(0.1);
    expect(r.signals.some((s) => s.type === "compute_overload")).toBe(true);
  });

  it("horizontal scaling behind LB fixes compute overload", () => {
    const u = node("users");
    const lb = node("load_balancer");
    const api = node("api_server", { instances: 4 });
    const db = node("postgres", { config: { indexing: "tuned", readReplicas: 2 } });
    const g = graph([u, lb, api, db], [[u.id, lb.id], [lb.id, api.id], [api.id, db.id]]);
    const r = run(g, { users: 100_000 });
    expect(r.metrics.errorRate).toBeLessThan(0.05);
  });

  it("latency rises sharply near saturation (queueing)", () => {
    const u = node("users");
    const api = node("api_server", { instances: 10 });
    const db = node("postgres", { config: { indexing: "tuned" } });
    const g = graph([u, api, db], [[u.id, api.id], [api.id, db.id]]);
    const calm = run(g, { users: 30_000 }); // DB read ~265 rps vs 4000
    const hot = run(g, { users: 420_000 }); // DB read ~3700 rps vs 4000 → rho≈0.93
    expect(hot.metrics.p95LatencyMs).toBeGreaterThan(calm.metrics.p95LatencyMs * 2);
  });
});

describe("caching", () => {
  it("redis absorbs most read traffic from the DB", () => {
    const u = node("users");
    const api = node("api_server", { instances: 10 });
    const db = node("postgres", { config: { indexing: "tuned" } });
    const redis = node("redis");
    const gNoCache = graph([u, api, db], [[u.id, api.id], [api.id, db.id]]);
    const gCache = graph(
      [u, api, db, redis],
      [[u.id, api.id], [api.id, redis.id], [api.id, db.id]]
    );
    const without = run(gNoCache, { users: 500_000 });
    const withCache = run(gCache, { users: 500_000 });
    const dbRt = (r: typeof without) => r.runtimes[db.id];
    expect(dbRt(withCache).inboundRps).toBeLessThan(dbRt(without).inboundRps * 0.6);
    expect(withCache.metrics.errorRate).toBeLessThan(without.metrics.errorRate);
  });

  it("hot key without jitter causes cache stampede", () => {
    const u = node("users");
    const api = node("api_server", { instances: 10 });
    const db = node("postgres", { config: { indexing: "tuned" } });
    const redis = node("redis", { config: { ttl: "long" } });
    const g = graph([u, api, db, redis], [[u.id, api.id], [api.id, redis.id], [api.id, db.id]]);
    const r = run(g, { users: 200_000, hotKeyActive: true }, 3);
    expect(r.signals.some((s) => s.type === "cache_stampede")).toBe(true);
  });

  it("jittered TTL prevents the stampede", () => {
    const u = node("users");
    const api = node("api_server", { instances: 10 });
    const db = node("postgres", { config: { indexing: "tuned" } });
    const redis = node("redis", { config: { ttl: "long_jitter" } });
    const g = graph([u, api, db, redis], [[u.id, api.id], [api.id, redis.id], [api.id, db.id]]);
    const r = run(g, { users: 200_000, hotKeyActive: true }, 6);
    expect(r.signals.some((s) => s.type === "cache_stampede")).toBe(false);
  });
});

describe("indexing", () => {
  it("unindexed DB read capacity collapses as data grows", () => {
    const u = node("users");
    const api = node("api_server", { instances: 6 });
    const db = node("postgres"); // indexing: none
    const g = graph([u, api, db], [[u.id, api.id], [api.id, db.id]]);
    // lots of users → storage fills fast; run long
    let st = initialEngineState(1);
    const ctx: TickContext = { users: 200_000, workload: { ...WORKLOAD, storageGbPerDayPer10k: 300 }, spikeMult: 1, hotKeyActive: false, zoneOutage: 0 };
    let early, late;
    for (let i = 0; i < 60; i++) {
      const r = stepSim(st, g, ctx);
      st = r.state;
      if (i === 5) early = r;
      late = r;
    }
    expect(late!.runtimes[db.id].latencyMs).toBeGreaterThan(early!.runtimes[db.id].latencyMs * 1.5);
    expect(late!.signals.some((s) => s.type === "unindexed_slow" || s.type === "overload")).toBe(true);
  });
});

describe("queues and workers", () => {
  it("kafka without workers grows unbounded backlog and signals", () => {
    const u = node("users");
    const api = node("api_server", { instances: 10 });
    const db = node("postgres", { config: { indexing: "tuned" } });
    const kafka = node("kafka");
    const g = graph(
      [u, api, db, kafka],
      [[u.id, api.id], [api.id, kafka.id], [api.id, db.id]]
    );
    const r = run(g, { users: 200_000, workload: { ...WORKLOAD, readRatio: 0.5 } }, 10);
    expect(r.runtimes[kafka.id].backlog).toBeGreaterThan(10_000);
    expect(r.signals.some((s) => s.type === "queue_no_consumer")).toBe(true);
  });

  it("queue + workers smooths a write burst: DB sees drain rate, backlog absorbs the spike", () => {
    const u = node("users");
    const api = node("api_server", { instances: 30 });
    const db = node("postgres", { config: { indexing: "tuned" } });
    const kafka = node("kafka", { config: { partitions: 16 } });
    const workers = node("worker", { instances: 5 }); // drain 2000 wps
    const g = graph(
      [u, api, db, kafka, workers],
      [[u.id, api.id], [api.id, kafka.id], [kafka.id, workers.id], [workers.id, db.id], [api.id, db.id]]
    );
    // offered writes ≈ 9600 wps — far above worker drain (2000)
    const r = run(g, { users: 300_000, workload: { ...WORKLOAD, readRatio: 0.2 }, spikeMult: 4 }, 6);
    // DB write demand capped at drain rate; the burst parks in the backlog
    expect(r.runtimes[db.id].inboundRps).toBeLessThan(5000);
    expect(r.runtimes[kafka.id].backlog).toBeGreaterThan(10_000);
    // users got fast queue acks — error rate far below the 80% the DB alone would produce
    expect(r.metrics.errorRate).toBeLessThan(0.25);
  });
});

describe("retry storms and breakers", () => {
  function overloadedDbGraph(opts: { retries: boolean; breaker: boolean }) {
    const u = node("users");
    const api = node("api_server", {
      instances: 40,
      config: { retries: opts.retries, circuitBreaker: opts.breaker },
    });
    const db = node("postgres", { config: { indexing: "tuned" } }); // 4000 read cap
    return { g: graph([u, api, db], [[u.id, api.id], [api.id, db.id]]), db };
  }

  it("retries amplify load on a failing DB", () => {
    const withRetry = overloadedDbGraph({ retries: true, breaker: false });
    const r = run(withRetry.g, { users: 700_000 }, 8); // ~6300 read rps > 4000
    expect(r.signals.some((s) => s.type === "retry_storm" && s.nodeId === withRetry.db.id)).toBe(true);
    const plain = overloadedDbGraph({ retries: false, breaker: false });
    const noRetry = run(plain.g, { users: 700_000 }, 8);
    expect(r.runtimes[withRetry.db.id].inboundRps).toBeGreaterThan(noRetry.runtimes[plain.db.id].inboundRps * 1.4);
  });

  it("circuit breaker opens under sustained failure and sheds load", () => {
    const { g, db } = overloadedDbGraph({ retries: true, breaker: true });
    const r = run(g, { users: 700_000 }, 12);
    expect(r.signals.some((s) => s.type === "breaker_open" && s.nodeId === db.id)).toBe(true);
    expect(r.runtimes[db.id].utilization).toBeLessThan(1.2); // breathing room restored
  });
});

describe("sharding", () => {
  it("hashed shard key multiplies write capacity; monotonic key does not", () => {
    const u = node("users");
    const api = node("api_server", { instances: 30 });
    const writeHeavy = { ...WORKLOAD, readRatio: 0.2 };
    const mk = (shardKey: string) => {
      const db = node("mongodb", { config: { indexing: "tuned", shards: 8, shardKey } });
      return { db, g: graph([u, api, db], [[u.id, api.id], [api.id, db.id]]) };
    };
    const hashed = mk("hashed");
    const mono = mk("monotonic");
    const rHashed = run(hashed.g, { users: 800_000, workload: writeHeavy }, 6);
    const rMono = run(mono.g, { users: 800_000, workload: writeHeavy }, 6);
    expect(rHashed.metrics.errorRate).toBeLessThan(0.05);
    expect(rMono.metrics.errorRate).toBeGreaterThan(0.3);
  });
});

describe("crashes and health checks", () => {
  it("crashed instance without LB causes errors; LB health checks reroute", () => {
    const u = node("users");
    const mkApi = () => node("api_server", { instances: 4 });
    const db1 = node("postgres", { config: { indexing: "tuned" } });
    const api1 = mkApi();
    const gNoLb = graph([u, api1, db1], [[u.id, api1.id], [api1.id, db1.id]]);

    const api2 = mkApi();
    const db2 = node("postgres", { config: { indexing: "tuned" } });
    const lb = node("load_balancer");
    const gLb = graph([u, lb, api2, db2], [[u.id, lb.id], [lb.id, api2.id], [api2.id, db2.id]]);

    // crash one instance in both
    let st1 = initialEngineState(1);
    st1.nodes[api1.id] = { storedGb: 0, backlog: 0, pods: 0, breakerOpen: false, breakerTicks: 0, highErrTicks: 0, crashedInstances: 1, stampedeTicks: 0, throttleTicks: 0 };
    const ctx: TickContext = { users: 60_000, workload: WORKLOAD, spikeMult: 1, hotKeyActive: false, zoneOutage: 0 };
    const r1 = stepSim(st1, gNoLb, ctx);

    let st2 = initialEngineState(1);
    st2.nodes[api2.id] = { ...st1.nodes[api1.id] };
    const r2 = stepSim(st2, gLb, ctx);

    expect(r1.metrics.errorRate).toBeGreaterThan(0.15);
    expect(r2.metrics.errorRate).toBeLessThan(0.05);
  });
});

describe("failure engine", () => {
  it("announces persistent failures with symptoms and lessons on resolve", () => {
    const u = node("users");
    const api = node("api_server");
    const db = node("postgres", { config: { indexing: "tuned" } });
    const g = graph([u, api, db], [[u.id, api.id], [api.id, db.id]]);

    let eng = initialEngineState(1);
    let fail = initialFailureState();
    const hot: TickContext = { users: 100_000, workload: WORKLOAD, spikeMult: 1, hotKeyActive: false, zoneOutage: 0 };
    const announced: string[] = [];
    const lessons: string[] = [];
    for (let t = 1; t <= 20; t++) {
      // after tick 10, "fix" by scaling out (simulate redesign)
      const fixed = t > 10;
      const gg = fixed
        ? graph([u, { ...api, data: { ...api.data, instances: 6 } }, db], [[u.id, api.id], [api.id, db.id]])
        : g;
      const r = stepSim(eng, gg, hot);
      eng = r.state;
      const f = stepFailures(fail, {
        tick: t, signals: r.signals, scripted: [], graph: gg, engineState: eng, hasObservability: false,
      });
      fail = f.state;
      for (const e of f.events) {
        if (e.severity === "crit") announced.push(e.title);
        if (e.severity === "resolve") lessons.push(e.detail);
      }
    }
    expect(announced.length).toBeGreaterThan(0);
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.join(" ")).toContain("📚");
  });
});

describe("scoring", () => {
  it("flags SPOFs and rewards redundancy", () => {
    const u = node("users");
    const api = node("api_server");
    const db = node("postgres");
    const g1 = graph([u, api, db], [[u.id, api.id], [api.id, db.id]]);
    const report = analyzeSpofs(g1);
    expect(report.spofs.length).toBe(2); // api + db both single

    const api2 = node("api_server", { instances: 3 });
    const db2 = node("postgres", { config: { readReplicas: 2 } });
    const lb = node("load_balancer");
    const g2 = graph([u, lb, api2, db2], [[u.id, lb.id], [lb.id, api2.id], [api2.id, db2.id]]);
    expect(analyzeSpofs(g2).spofs.length).toBe(0);
  });

  it("penalizes over-engineering at tiny scale", () => {
    const u = node("users");
    const api = node("api_server");
    const db = node("postgres", { config: { indexing: "tuned" } });
    const slo = { maxP95Ms: 500, minAvailabilityPct: 99, maxErrorRate: 0.01, maxMonthlyBudget: 1000 };

    const simple = computeScores({
      graph: graph([u, api, db], [[u.id, api.id], [api.id, db.id]]),
      workload: WORKLOAD, targetUsers: 100, slo, recent: [],
    });

    const kafka = node("kafka");
    const cass = node("cassandra");
    const es = node("elasticsearch");
    const over = computeScores({
      graph: graph([u, api, db, kafka, cass, es], [[u.id, api.id], [api.id, db.id], [api.id, kafka.id], [api.id, cass.id], [api.id, es.id]]),
      workload: WORKLOAD, targetUsers: 100, slo, recent: [],
    });
    expect(over.complexity).toBeLessThan(simple.complexity - 20);
  });
});
