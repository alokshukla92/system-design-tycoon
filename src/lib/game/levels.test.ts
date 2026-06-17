import { describe, expect, it } from "vitest";
import { LEVELS } from "./levels";
import type { GraphSnapshot, LevelDef } from "@/lib/types";
import { initialEngineState, stepSim, type EngineState, type TickContext } from "@/lib/simulation/engine";
import { initialFailureState, stepFailures, type FailureEngineState } from "@/lib/simulation/failures";
import { computeScores, explainScores } from "@/lib/simulation/scoring";
import { defaultConfig } from "@/lib/catalog/components";

const REPAIR_DELAY = 18; // must match the store

// ─────────────────────────────────────────────────────────────────────────────
// Game-balance regression tests: each early level must FAIL with the stock
// starter (so the lesson fires) and PASS with the intended fix. If a tuning
// change breaks either direction, the level stops teaching.
// ─────────────────────────────────────────────────────────────────────────────

interface RunStats {
  avgErrLast40: number;
  maxP95Last40: number;
}

function playLevel(level: LevelDef, graph: GraphSnapshot): RunStats {
  let st: EngineState = initialEngineState(3);
  const errs: number[] = [];
  const p95s: number[] = [];
  for (let tick = 1; tick <= level.durationTicks; tick++) {
    const users = Math.round(level.users + (level.usersEnd - level.users) * (tick / level.durationTicks));
    // emulate scripted traffic spikes the way the failure engine applies them
    let spikeMult = 1;
    for (const ev of level.scripted) {
      if (ev.type === "traffic_spike" || ev.type === "bad_deploy") {
        const dur = ev.durationTicks ?? 10;
        if (tick >= ev.atTick && tick < ev.atTick + dur) spikeMult = Math.max(spikeMult, ev.magnitude ?? 2);
      }
    }
    const ctx: TickContext = {
      users,
      workload: level.workload,
      spikeMult,
      hotKeyActive: level.scripted.some(
        (ev) => ev.type === "hot_key" && tick >= ev.atTick && tick < ev.atTick + (ev.durationTicks ?? 10)
      ),
      zoneOutage: 0,
    };
    const r = stepSim(st, graph, ctx);
    st = r.state;
    errs.push(r.metrics.errorRate);
    p95s.push(r.metrics.p95LatencyMs);
  }
  const last40e = errs.slice(-40);
  const last40p = p95s.slice(-40);
  return {
    avgErrLast40: last40e.reduce((a, b) => a + b, 0) / last40e.length,
    maxP95Last40: Math.max(...last40p),
  };
}

function withConfig(graph: GraphSnapshot, kind: string, patch: Record<string, string | number | boolean>, tier?: string): GraphSnapshot {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.data.kind === kind
        ? { ...n, data: { ...n.data, tier: tier ?? n.data.tier, config: { ...n.data.config, ...patch } } }
        : n
    ),
  };
}

// Crash-aware harness: replays a level THROUGH the failure engine (scripted
// node crashes + repairs), exactly as the store does. Needed for levels whose
// lesson is surviving a failure.
function playLevelWithCrashes(level: LevelDef, graph: GraphSnapshot) {
  let eng: EngineState = initialEngineState(7);
  let fail: FailureEngineState = initialFailureState();
  let ctxPatch = { spikeMult: 1, hotKeyActive: false, zoneOutage: 0 };
  let repairs: { nodeId: string; atTick: number }[] = [];
  const errs: number[] = [];
  const avails: number[] = [];
  for (let tick = 1; tick <= level.durationTicks; tick++) {
    const users = Math.round(level.users + (level.usersEnd - level.users) * (tick / level.durationTicks));
    const r = stepSim(eng, graph, { users, workload: level.workload, ...ctxPatch });
    const f = stepFailures(fail, {
      tick, signals: r.signals, scripted: level.scripted, graph, engineState: r.state, hasObservability: true,
    });
    for (const cr of f.crashRequests) {
      const ns = r.state.nodes[cr.nodeId];
      if (ns) { ns.crashedInstances += cr.instances; repairs.push({ nodeId: cr.nodeId, atTick: tick + REPAIR_DELAY }); }
    }
    for (const rp of repairs.filter((x) => x.atTick <= tick)) {
      const ns = r.state.nodes[rp.nodeId];
      if (ns && ns.crashedInstances > 0) ns.crashedInstances -= 1;
    }
    repairs = repairs.filter((x) => x.atTick > tick);
    eng = r.state; fail = f.state; ctxPatch = f.ctxPatch;
    errs.push(r.metrics.errorRate);
    avails.push(r.metrics.availabilityPct);
  }
  const last = <T>(a: T[]) => a.slice(-40);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return { avgErr: avg(last(errs)), avgAvail: avg(last(avails)) };
}

describe("level 4 balance — replication survives a DB crash", () => {
  const level = LEVELS[3];
  const u = { id: "u", position: { x: 0, y: 0 }, data: { kind: "users", label: "Users", tier: "base", instances: 1, config: {} } } as never;
  const mkApi = (n: number) => ({ id: `api${Math.random()}`, position: { x: 0, y: 0 }, data: { kind: "api_server", label: "API", tier: "large", instances: n, config: defaultConfig("api_server") } } as never);
  const mkRedis = () => ({ id: "rd", position: { x: 0, y: 0 }, data: { kind: "redis", label: "Redis", tier: "small", instances: 3, config: defaultConfig("redis") } } as never);
  const mkMongo = (instances: number, replicaSet: number) => ({ id: "db", position: { x: 0, y: 0 }, data: { kind: "mongodb", label: "MongoDB", tier: "medium", instances, config: { ...defaultConfig("mongodb"), indexing: "tuned", replicaSet } } } as never);
  const id = (x: never) => (x as { id: string }).id;
  const build = (mongo: never) => {
    const a1 = mkApi(4), a2 = mkApi(4), rd = mkRedis();
    return {
      nodes: [u, a1, a2, rd, mongo],
      edges: [
        { id: "e0", source: id(u), target: id(a1) },
        { id: "e1", source: id(u), target: id(a2) },
        { id: "e2", source: id(a1), target: id(rd) },
        { id: "e3", source: id(a1), target: id(mongo) },
        { id: "e4", source: id(a2), target: id(mongo) },
      ],
    } as GraphSnapshot;
  };

  it("a SINGLE-instance database is destroyed by the crash (lesson fires)", () => {
    const r = playLevelWithCrashes(level, build(mkMongo(1, 0)));
    const failed = r.avgAvail < level.slo.minAvailabilityPct || r.avgErr > level.slo.maxErrorRate;
    expect(failed).toBe(true);
  });

  it("a REPLICATED database survives the crash and passes the SLO", () => {
    const r = playLevelWithCrashes(level, build(mkMongo(2, 2)));
    expect(r.avgAvail).toBeGreaterThanOrEqual(level.slo.minAvailabilityPct);
    expect(r.avgErr).toBeLessThanOrEqual(level.slo.maxErrorRate);
  });
});

describe("level 1 balance — single-server ceiling", () => {
  const level = LEVELS[0];
  const starter = level.starter!;

  it("stock starter melts during the celebrity spike (lesson fires)", () => {
    const stats = playLevel(level, starter);
    expect(stats.avgErrLast40).toBeGreaterThan(level.slo.maxErrorRate);
  });

  it("upgrading the API server tier survives the level (fix works, within budget)", () => {
    const fixed = withConfig(starter, "api_server", {}, "medium");
    const stats = playLevel(level, fixed);
    expect(stats.avgErrLast40).toBeLessThan(level.slo.maxErrorRate);
    expect(stats.maxP95Last40).toBeLessThan(level.slo.maxP95Ms);
  });
});

describe("level 2 balance — indexing", () => {
  const level = LEVELS[1];
  const starter = level.starter!;

  it("unindexed DB blows the latency/error SLO as data grows (lesson fires)", () => {
    const stats = playLevel(level, starter);
    const failed = stats.avgErrLast40 > level.slo.maxErrorRate || stats.maxP95Last40 > level.slo.maxP95Ms;
    expect(failed).toBe(true);
  });

  it("tuned indexes fix it without new hardware", () => {
    const fixed = withConfig(starter, "mongodb", { indexing: "tuned" });
    const stats = playLevel(level, fixed);
    expect(stats.avgErrLast40).toBeLessThan(level.slo.maxErrorRate);
    expect(stats.maxP95Last40).toBeLessThan(level.slo.maxP95Ms);
  });
});

describe("score breakdown — actionable reasons + tips", () => {
  const slo = { maxP95Ms: 300, minAvailabilityPct: 99, maxErrorRate: 0.02, maxMonthlyBudget: 5000 };
  const workload = LEVELS[1].workload;

  function mk(kind: string, cfg: Record<string, string | number | boolean> = {}, instances = 1) {
    return {
      id: `${kind}-${Math.random().toString(36).slice(2)}`,
      position: { x: 0, y: 0 },
      data: { kind, label: kind, tier: "small", instances, config: { ...defaultConfig(kind as never), ...cfg } },
    } as never;
  }

  it("a single-instance DB is reported as a SPOF with a fix that names the component", () => {
    const u = mk("users");
    const api = mk("api_server");
    const db = mk("mongodb", { indexing: "tuned" });
    const graph = {
      nodes: [u, api, db],
      edges: [
        { id: "e0", source: (u as { id: string }).id, target: (api as { id: string }).id },
        { id: "e1", source: (api as { id: string }).id, target: (db as { id: string }).id },
      ],
    };
    const input = { graph, workload, targetUsers: 28_000, slo, recent: [] };
    const scores = computeScores(input);
    const breakdown = explainScores(input, scores);

    // reliability is dinged and the reasons mention both single-instance nodes
    expect(scores.reliability).toBeLessThan(75);
    const relText = breakdown.reliability.reasons.join(" ");
    expect(relText).toContain("Single point of failure");
    // and there is at least one concrete, actionable tip
    expect(breakdown.reliability.tips.length).toBeGreaterThan(0);
  });

  it("tips never suggest a component the level hasn't unlocked yet", () => {
    const u = mk("users");
    const api = mk("api_server");
    const db = mk("postgres", { indexing: "tuned" });
    const graph = {
      nodes: [u, api, db],
      edges: [
        { id: "e0", source: (u as { id: string }).id, target: (api as { id: string }).id },
        { id: "e1", source: (api as { id: string }).id, target: (db as { id: string }).id },
      ],
    };

    // Level 1 palette: no load balancer, no redis
    const gatedInput = { graph, workload, targetUsers: 15_000, slo, recent: [], available: LEVELS[0].unlocked };
    const gated = explainScores(gatedInput, computeScores(gatedInput));
    const gatedRel = gated.reliability.tips.join(" ").toLowerCase();
    expect(gatedRel).toContain("instance"); // still tells you to scale out
    expect(gatedRel).not.toContain("load balancer"); // but not via a locked component

    // Everything unlocked → the LB suggestion is allowed back in
    const openInput = { graph, workload, targetUsers: 15_000, slo, recent: [] };
    const open = explainScores(openInput, computeScores(openInput));
    expect(open.reliability.tips.join(" ").toLowerCase()).toContain("load balancer");
  });

  it("a redundant design has no reliability complaints", () => {
    const u = mk("users");
    const lb = mk("load_balancer");
    const api = mk("api_server", {}, 3);
    const db = mk("mongodb", { indexing: "tuned", replicaSet: 2 });
    const graph = {
      nodes: [u, lb, api, db],
      edges: [
        { id: "e0", source: (u as { id: string }).id, target: (lb as { id: string }).id },
        { id: "e1", source: (lb as { id: string }).id, target: (api as { id: string }).id },
        { id: "e2", source: (api as { id: string }).id, target: (db as { id: string }).id },
      ],
    };
    const input = { graph, workload, targetUsers: 28_000, slo, recent: [] };
    const scores = computeScores(input);
    const breakdown = explainScores(input, scores);
    expect(breakdown.reliability.reasons.length).toBe(0);
  });
});
