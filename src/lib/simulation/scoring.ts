import type { ComponentKind, GraphSnapshot, Scores, SimMetrics, SLO, WorkloadProfile } from "@/lib/types";
import { CATALOG } from "@/lib/catalog/components";
import { capacityOf, initialEngineState, stepSim, type EngineState, type TickContext } from "./engine";

// ─────────────────────────────────────────────────────────────────────────────
// Six-axis scoring. Recomputed live; used for level pass/fail and the
// interview rubric. 0–100 per axis.
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export interface SpofReport {
  spofs: string[]; // node labels that are single points of failure
  hasLb: boolean;
  hasReplication: boolean;
  hasBreakerOrLimiter: boolean;
  hasObservability: boolean;
}

export function analyzeSpofs(graph: GraphSnapshot): SpofReport {
  const spofs: string[] = [];
  let hasLb = false;
  let hasReplication = false;
  let hasBreakerOrLimiter = false;
  let hasObservability = false;

  for (const n of graph.nodes) {
    const { kind } = n.data;
    if (kind === "users" || kind === "monitoring") {
      if (kind === "monitoring") hasObservability = true;
      continue;
    }
    if (kind === "load_balancer") hasLb = true;
    const cfg = n.data.config;
    if (cfg.circuitBreaker === true || cfg.rateLimiter === true) hasBreakerOrLimiter = true;

    const replicas = Number(cfg.readReplicas ?? cfg.replicaSet ?? 0) || 0;
    const instances =
      n.data.kind === "k8s_cluster" ? Number(cfg.minPods ?? 2) : Math.max(1, n.data.instances);
    const shards = Number(cfg.shards ?? 1) || 1;
    if (replicas > 0 || instances > 1 || shards > 1) {
      if (["postgres", "mysql", "mongodb", "cassandra"].includes(kind)) hasReplication = true;
      continue; // redundant — not a SPOF
    }
    if (kind === "dynamodb" || kind === "sqs" || kind === "cdn" || kind === "load_balancer") continue; // managed multi-AZ
    spofs.push(n.data.label);
  }
  return { spofs, hasLb, hasReplication, hasBreakerOrLimiter, hasObservability };
}

/**
 * Stress-test scalability: simulate the architecture at increasing load
 * until error rate exceeds 5%; score = headroom relative to target users.
 */
export function findCapacityCeiling(graph: GraphSnapshot, workload: WorkloadProfile, targetUsers: number): number {
  const multipliers = [0.25, 0.5, 1, 1.5, 2, 3, 5, 8];
  let ceiling = 0;
  for (const m of multipliers) {
    const users = targetUsers * m;
    let st: EngineState = initialEngineState(7);
    const ctx: TickContext = { users, workload, spikeMult: 1, hotKeyActive: false, zoneOutage: 0 };
    // warm a few ticks so autoscaling/backlog settle
    let lastErr = 0;
    for (let i = 0; i < 6; i++) {
      const r = stepSim(st, graph, ctx, { silent: true });
      st = r.state;
      lastErr = r.metrics.errorRate;
    }
    if (lastErr <= 0.05) ceiling = users;
    else break;
  }
  return ceiling;
}

export interface ScoreInput {
  graph: GraphSnapshot;
  workload: WorkloadProfile;
  targetUsers: number;
  slo: SLO;
  /** recent metrics window (last N ticks) — empty before first run */
  recent: SimMetrics[];
  /**
   * Component kinds the player can actually place right now (campaign levels
   * gate the palette). When omitted, everything is assumed available
   * (incident / interview modes). Scores never penalize, and tips never
   * suggest, a component that isn't available yet.
   */
  available?: ComponentKind[];
}

const canUse = (available: ComponentKind[] | undefined, kind: ComponentKind) =>
  !available || available.includes(kind);

export function computeScores(input: ScoreInput): Scores {
  const { graph, workload, targetUsers, slo, recent, available } = input;
  const spof = analyzeSpofs(graph);
  const playerNodes = graph.nodes.filter((n) => n.data.kind !== "users");

  // ── Scalability: capacity ceiling vs target ────────────────────────────
  const ceiling = findCapacityCeiling(graph, workload, targetUsers);
  const headroom = ceiling / Math.max(1, targetUsers);
  const scalability = clamp(headroom >= 2 ? 100 : headroom * 50);

  // ── Reliability: redundancy + protective patterns ──────────────────────
  let reliability = 100;
  reliability -= spof.spofs.length * 18;
  if (!spof.hasLb && targetUsers > 20_000 && canUse(available, "load_balancer")) reliability -= 15;
  if (!spof.hasBreakerOrLimiter && targetUsers > 100_000) reliability -= 12;
  if (!spof.hasObservability && targetUsers > 50_000) reliability -= 8;
  if (recent.length > 0) {
    const avgAvail = recent.reduce((a, m) => a + m.availabilityPct, 0) / recent.length;
    reliability = reliability * 0.6 + clamp((avgAvail - 90) * 10) * 0.4;
  }
  reliability = clamp(reliability);

  // ── Latency: observed p95 vs SLO ───────────────────────────────────────
  let latency = 70; // unknown until simulated
  if (recent.length > 0) {
    const avgP95 = recent.reduce((a, m) => a + m.p95LatencyMs, 0) / recent.length;
    latency = clamp(avgP95 <= slo.maxP95Ms ? 100 - (avgP95 / slo.maxP95Ms) * 30 : 70 - ((avgP95 - slo.maxP95Ms) / slo.maxP95Ms) * 70);
  }

  // ── Cost: monthly spend vs budget ──────────────────────────────────────
  let cost = 80;
  if (recent.length > 0) {
    const spend = recent[recent.length - 1].costPerMonth;
    const ratio = spend / Math.max(1, slo.maxMonthlyBudget);
    cost = clamp(ratio <= 0.6 ? 100 : ratio <= 1 ? 100 - (ratio - 0.6) * 125 : 50 - (ratio - 1) * 80);
  }

  // ── Maintainability: hygiene of the design ─────────────────────────────
  let maintainability = 100;
  const kinds = new Set(playerNodes.map((n) => n.data.kind));
  const dbKinds = [...kinds].filter((k) => ["postgres", "mysql", "mongodb", "cassandra", "dynamodb"].includes(k));
  if (dbKinds.length > 2) maintainability -= (dbKinds.length - 2) * 15; // polyglot sprawl
  const msgKinds = [...kinds].filter((k) => ["kafka", "rabbitmq", "sqs"].includes(k));
  if (msgKinds.length > 1) maintainability -= (msgKinds.length - 1) * 12;
  if (!spof.hasObservability && targetUsers > 10_000) maintainability -= 15;
  // disconnected nodes = clutter
  const connected = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
  const orphans = playerNodes.filter((n) => !connected.has(n.id)).length;
  maintainability -= orphans * 10;
  maintainability = clamp(maintainability);

  // ── Complexity: penalize over-engineering for the CURRENT scale ───────
  // count "complexity points"; budget grows with log10(users)
  let points = 0;
  for (const n of playerNodes) {
    const cat = CATALOG[n.data.kind].category;
    points += cat === "messaging" ? 3 : cat === "search" ? 2.5 : cat === "database" ? 2 : 1;
    if (Number(n.data.config.shards ?? 1) > 1) points += 2;
  }
  const budget = Math.max(3, (Math.log10(Math.max(100, targetUsers)) - 1) * 5); // 100→3, 1M→20, 100M→30
  const complexity = clamp(points <= budget ? 100 : 100 - (points - budget) * 8);

  return {
    scalability: Math.round(scalability),
    reliability: Math.round(reliability),
    latency: Math.round(latency),
    cost: Math.round(cost),
    maintainability: Math.round(maintainability),
    complexity: Math.round(complexity),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Score breakdown: for every axis, WHY the points were lost and WHAT to do.
// Cheap to compute (no extra simulations) — derived from structural analysis
// plus the already-computed scores and recent metrics.
// ─────────────────────────────────────────────────────────────────────────────

export interface AxisExplanation {
  reasons: string[]; // what cost you points (empty when the axis is clean)
  tips: string[]; // concrete actions to raise the score
}
export type ScoreBreakdown = Record<keyof Scores, AxisExplanation>;

const DB_KINDS = ["postgres", "mysql", "mongodb", "cassandra", "dynamodb"];
const COMPUTE_KINDS = ["api_server", "k8s_cluster"];

/** Highest-utilization player node from the last simulated tick, if any. */
function bottleneck(graph: GraphSnapshot): { label: string; util: number; kind: string } | null {
  let best: { label: string; util: number; kind: string } | null = null;
  for (const n of graph.nodes) {
    if (n.data.kind === "users") continue;
    const rt = n.data.runtime;
    if (rt && (!best || rt.utilization > best.util)) best = { label: n.data.label, util: rt.utilization, kind: n.data.kind };
  }
  return best && best.util > 0.6 ? best : null;
}

export function explainScores(input: ScoreInput, scores: Scores): ScoreBreakdown {
  const { graph, targetUsers, slo, recent, available } = input;
  const hasLbUnlocked = canUse(available, "load_balancer");
  const hasRedisUnlocked = canUse(available, "redis");
  const spof = analyzeSpofs(graph);
  const playerNodes = graph.nodes.filter((n) => n.data.kind !== "users");
  const kinds = new Set(playerNodes.map((n) => n.data.kind));
  const usersLabel = targetUsers >= 1_000_000 ? `${targetUsers / 1_000_000}M` : `${Math.round(targetUsers / 1000)}k`;
  const neck = bottleneck(graph);

  const out: ScoreBreakdown = {
    scalability: { reasons: [], tips: [] },
    reliability: { reasons: [], tips: [] },
    latency: { reasons: [], tips: [] },
    cost: { reasons: [], tips: [] },
    maintainability: { reasons: [], tips: [] },
    complexity: { reasons: [], tips: [] },
  };

  // ── Reliability ──────────────────────────────────────────────────────────
  for (const label of spof.spofs) {
    out.reliability.reasons.push(`Single point of failure: ${label} — one hardware fault takes it down (−18)`);
    const lbClause = hasLbUnlocked ? ", or put it behind a load balancer" : "";
    out.reliability.tips.push(
      DB_KINDS.includes(graph.nodes.find((n) => n.data.label === label)?.data.kind ?? "")
        ? `Add a replica to ${label} (replicas / replica-set members) so a failover target exists`
        : `Run ${label} as 2+ instances (raise its instance count${lbClause})`
    );
  }
  if (!spof.hasLb && targetUsers > 20_000 && hasLbUnlocked) {
    out.reliability.reasons.push(`No load balancer at ${usersLabel} users (−15)`);
    out.reliability.tips.push("Add a Load Balancer in front of your compute tier and run multiple instances");
  }
  if (!spof.hasBreakerOrLimiter && targetUsers > 100_000) {
    out.reliability.reasons.push(`No circuit breaker or rate limiter at this scale (−12)`);
    out.reliability.tips.push("Enable a circuit breaker or rate limiter on your API/compute to stop cascading failure");
  }
  if (!spof.hasObservability && targetUsers > 50_000) {
    out.reliability.reasons.push(`No observability stack at this scale (−8)`);
    out.reliability.tips.push("Add an Observability stack so you can see failures before users do");
  }
  if (recent.length > 0) {
    const avgAvail = recent.reduce((a, m) => a + m.availabilityPct, 0) / recent.length;
    if (avgAvail < slo.minAvailabilityPct)
      out.reliability.reasons.push(`Observed availability ${avgAvail.toFixed(2)}% during the run (target ≥ ${slo.minAvailabilityPct}%)`);
  }

  // ── Scalability ──────────────────────────────────────────────────────────
  if (scores.scalability < 100) {
    out.scalability.reasons.push(
      `Capacity ceiling is only ~${(scores.scalability / 50).toFixed(1)}× the target — little headroom for spikes`
    );
    const cacheClause = hasRedisUnlocked ? ", or cache its load" : "";
    const cacheItem = hasRedisUnlocked ? "a cache, " : "";
    out.scalability.tips.push(
      neck
        ? `${neck.label} saturates first (${Math.round(Math.min(neck.util, 9.99) * 100)}% utilized) — scale it out, add replicas${cacheClause}`
        : `Add capacity to the tier that saturates first: more instances, read replicas, ${cacheItem}or sharding`
    );
    // The load balancer splits traffic evenly across compute NODES, not by size.
    if (neck && COMPUTE_KINDS.includes(neck.kind)) {
      out.scalability.tips.push(
        "Keep your compute nodes the same size — traffic splits evenly across them, so the smallest one saturates first and caps everything. One node with more instances avoids this.",
      );
    }
    // Writes funnel into one primary regardless of replicas — that needs sharding.
    if (neck && DB_KINDS.includes(neck.kind) && Number(graph.nodes.find((n) => n.data.label === neck.label)?.data.config.shards ?? 1) <= 1) {
      out.scalability.tips.push(
        "Replicas multiply reads, but every write still hits one primary. To raise write capacity you must shard (split the data) — with a hashed key so load spreads evenly.",
      );
    }
  }

  // ── Latency ──────────────────────────────────────────────────────────────
  if (recent.length > 0) {
    const avgP95 = recent.reduce((a, m) => a + m.p95LatencyMs, 0) / recent.length;
    if (avgP95 > slo.maxP95Ms) {
      out.latency.reasons.push(`p95 latency ${Math.round(avgP95)}ms exceeded the ${slo.maxP95Ms}ms target`);
      out.latency.tips.push(
        neck
          ? `${neck.label} is near saturation — latency climbs steeply past ~80%. ${hasRedisUnlocked ? "Cache its reads (Redis), " : ""}add replicas, index hot queries, or scale it`
          : `${hasRedisUnlocked ? "Cache hot reads with Redis, " : ""}add read replicas, index hot queries, or scale the busiest tier`
      );
    } else if (scores.latency < 85) {
      out.latency.reasons.push(`p95 latency ${Math.round(avgP95)}ms (target ${slo.maxP95Ms}ms) — passing, but not much margin`);
      out.latency.tips.push("More headroom on the busiest tier keeps latency flat during spikes");
    }
  }

  // ── Cost ─────────────────────────────────────────────────────────────────
  if (recent.length > 0) {
    const spend = recent[recent.length - 1].costPerMonth;
    const pricey = playerNodes.find(
      (n) => (n.data.tier === "xl" || n.data.tier === "large") && (COMPUTE_KINDS.includes(n.data.kind) || DB_KINDS.includes(n.data.kind) || n.data.kind === "worker")
    );
    if (spend > slo.maxMonthlyBudget) {
      const over = spend - slo.maxMonthlyBudget;
      out.cost.reasons.push(`$${spend.toLocaleString()}/mo is $${over.toLocaleString()} over the $${slo.maxMonthlyBudget.toLocaleString()}/mo budget`);
      if (pricey) {
        out.cost.tips.push(
          `${pricey.data.label} is on the ${pricey.data.tier.toUpperCase()} tier — vertical scaling is cost-inefficient (XL ≈ 9.5× the price for 5.5× the capacity). Drop it to a smaller tier and add instances for the same throughput at lower cost.`
        );
      }
      out.cost.tips.push("Also trim over-provisioned replicas/shards and remove any component you don't need.");
    } else if (scores.cost < 75) {
      out.cost.reasons.push(`Spend is ${Math.round((spend / slo.maxMonthlyBudget) * 100)}% of budget — getting expensive`);
      out.cost.tips.push(
        pricey
          ? `${pricey.data.label} (${pricey.data.tier.toUpperCase()}) is your priciest-per-request tier — smaller instances scaled out cost less for the same capacity.`
          : "Look for a smaller instance tier or fewer instances that still meets the SLO."
      );
    }
  }

  // ── Maintainability ──────────────────────────────────────────────────────
  const dbKinds = [...kinds].filter((k) => DB_KINDS.includes(k));
  if (dbKinds.length > 2) {
    out.maintainability.reasons.push(`${dbKinds.length} different database technologies — operational sprawl (−${(dbKinds.length - 2) * 15})`);
    out.maintainability.tips.push("Consolidate to one or two datastores unless a workload genuinely needs a third");
  }
  const msgKinds = [...kinds].filter((k) => ["kafka", "rabbitmq", "sqs"].includes(k));
  if (msgKinds.length > 1) {
    out.maintainability.reasons.push(`${msgKinds.length} messaging systems to operate (−${(msgKinds.length - 1) * 12})`);
    out.maintainability.tips.push("Standardize on a single message broker where you can");
  }
  if (!spof.hasObservability && targetUsers > 10_000) {
    out.maintainability.reasons.push("No observability stack — you'd debug outages blind (−15)");
    out.maintainability.tips.push("Add an Observability stack (metrics, logs, traces)");
  }
  const connected = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
  const orphans = playerNodes.filter((n) => !connected.has(n.id));
  if (orphans.length > 0) {
    out.maintainability.reasons.push(`${orphans.length} disconnected component(s): ${orphans.map((n) => n.data.label).join(", ")} (−${orphans.length * 10})`);
    out.maintainability.tips.push("Wire up or delete components that aren't connected to anything");
  }

  // ── Complexity / Simplicity ──────────────────────────────────────────────
  if (scores.complexity < 90) {
    out.complexity.reasons.push(`Over-engineered for ${usersLabel} users — too many heavyweight components for this scale`);
    out.complexity.tips.push("Remove queues, extra datastores, or sharding you don't need yet. The simplest design that meets the SLO wins");
  }

  return out;
}

/** Quick what-if: score delta if a component were added. Used for the palette hover hints. */
export function overallScore(s: Scores): number {
  return Math.round(
    s.scalability * 0.25 + s.reliability * 0.25 + s.latency * 0.2 + s.cost * 0.1 + s.maintainability * 0.1 + s.complexity * 0.1
  );
}

export { capacityOf };
