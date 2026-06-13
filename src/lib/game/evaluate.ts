import type { GraphSnapshot, InterviewDef, Scores, SimMetrics } from "@/lib/types";
import { initialEngineState, stepSim, type EngineState, type TickContext } from "@/lib/simulation/engine";
import { analyzeSpofs, computeScores, overallScore } from "@/lib/simulation/scoring";

// ─────────────────────────────────────────────────────────────────────────────
// Interview rubric: simulate the candidate's design at each traffic tier
// (including a hot-key stress pass) and produce an interviewer-style report.
// ─────────────────────────────────────────────────────────────────────────────

export interface TierResult {
  label: string;
  users: number;
  passed: boolean;
  p95Ms: number;
  errorRate: number;
  availabilityPct: number;
  costPerMonth: number;
  underStress: { passed: boolean; errorRate: number };
}

export interface InterviewReport {
  tierResults: TierResult[];
  scores: Scores;
  overall: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
}

function simulateTier(graph: GraphSnapshot, iv: InterviewDef, users: number, hotKey: boolean): SimMetrics {
  let st: EngineState = initialEngineState(13);
  const ctx: TickContext = {
    users,
    workload: iv.workload,
    spikeMult: hotKey ? iv.workload.peakMult : 1,
    hotKeyActive: hotKey,
    zoneOutage: 0,
  };
  let metrics: SimMetrics | null = null;
  for (let i = 0; i < 12; i++) {
    const r = stepSim(st, graph, ctx, { silent: true });
    st = r.state;
    metrics = r.metrics;
  }
  return metrics!;
}

export function evaluateInterview(graph: GraphSnapshot, iv: InterviewDef): InterviewReport {
  const tierResults: TierResult[] = iv.tiers.map((tier) => {
    const calm = simulateTier(graph, iv, tier.users, false);
    const stressed = simulateTier(graph, iv, tier.users, true);
    return {
      label: tier.label,
      users: tier.users,
      passed:
        calm.errorRate <= iv.slo.maxErrorRate * 2 &&
        calm.p95LatencyMs <= iv.slo.maxP95Ms * 1.5 &&
        calm.costPerMonth <= iv.slo.maxMonthlyBudget,
      p95Ms: calm.p95LatencyMs,
      errorRate: calm.errorRate,
      availabilityPct: calm.availabilityPct,
      costPerMonth: calm.costPerMonth,
      underStress: { passed: stressed.errorRate <= 0.08, errorRate: stressed.errorRate },
    };
  });

  const topTier = iv.tiers[iv.tiers.length - 1];
  const scores = computeScores({
    graph,
    workload: iv.workload,
    targetUsers: topTier.users,
    slo: iv.slo,
    recent: [simulateTier(graph, iv, topTier.users, false)],
  });
  const overall = overallScore(scores);

  // ── interviewer narrative ────────────────────────────────────────────────
  const strengths: string[] = [];
  const gaps: string[] = [];
  const spof = analyzeSpofs(graph);
  const kinds = new Set(graph.nodes.map((n) => n.data.kind));

  const playerNodes = graph.nodes.filter((n) => n.data.kind !== "users");
  if (playerNodes.length < 2) gaps.push("There's barely a design here — where do requests go? Where does data live?");
  else if (spof.spofs.length === 0) strengths.push("No single point of failure — every stateful component has redundancy.");
  else gaps.push(`Single points of failure: ${spof.spofs.join(", ")}. One hardware fault takes the product down.`);

  if (kinds.has("redis")) strengths.push("Cache layer absorbs hot reads before they reach the database.");
  else if (iv.workload.readRatio > 0.8) gaps.push("Read-heavy workload with no cache — the database absorbs every repeated read.");

  if (kinds.has("cdn") && iv.workload.staticRatio > 0.3) strengths.push("CDN serves static content at the edge — both a latency and an origin-load win.");
  if (!kinds.has("cdn") && iv.workload.staticRatio > 0.5) gaps.push("Heavily static workload with no CDN — origin pays for every byte, users pay in latency.");

  const hasQueue = kinds.has("kafka") || kinds.has("rabbitmq") || kinds.has("sqs");
  if (hasQueue && iv.workload.readRatio < 0.7) strengths.push("Write bursts are decoupled through a queue — the database sees a sustainable drain rate.");
  if (!hasQueue && iv.workload.readRatio < 0.6) gaps.push("Write-heavy and fully synchronous — every burst lands directly on the database.");

  if (kinds.has("elasticsearch") && iv.workload.searchRatio > 0.02) strengths.push("Search traffic routed to a real search engine instead of LIKE-scans on the primary store.");
  if (!kinds.has("elasticsearch") && iv.workload.searchRatio > 0.03) gaps.push("Search requirement unmet — search queries will hammer the primary database at ~20× normal read cost.");

  const hotKeyOk = tierResults.every((t) => t.underStress.passed);
  if (hotKeyOk) strengths.push("Design survives the hot-key/viral stress pass at every tier.");
  else gaps.push("Hot-key stress melts the design — think shard-key choice, caching of hot entities, and load shedding.");

  if (spof.hasBreakerOrLimiter) strengths.push("Backpressure patterns (circuit breaker / rate limiter) protect against cascading failure.");
  else gaps.push("No circuit breaker or rate limiter — an overload anywhere becomes an outage everywhere.");

  if (spof.hasObservability) strengths.push("Observability included — you'll debug with data, not vibes.");
  else gaps.push("No observability stack. An interviewer will always ask: how do you know what's wrong?");

  if (scores.complexity < 60) gaps.push("Over-engineered for the requirement — every extra component is operational surface. Could you defend each box in this diagram?");
  if (scores.cost < 50) gaps.push("Cost is far over budget at the target scale. Architecture reviews include the bill.");

  const passedAll = tierResults.every((t) => t.passed);
  const passedAny = tierResults.some((t) => t.passed);
  const verdict = !passedAny
    ? "No Hire (today) — the design doesn't serve traffic at any tier. Build the basic request path first, then come back."
    : overall >= 85 && passedAll && hotKeyOk
      ? "Strong Hire — this design scales, survives failure, and respects the budget."
      : overall >= 70 && passedAll
        ? "Hire — solid fundamentals with some rough edges worth discussing."
        : overall >= 55
          ? "Lean Hire — the skeleton is right, but key failure modes are unhandled."
          : "No Hire (today) — revisit the fundamentals this design skips, then try again.";

  return { tierResults, scores, overall, verdict, strengths, gaps };
}
