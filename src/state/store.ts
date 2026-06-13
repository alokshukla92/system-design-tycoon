import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import type {
  ArchNodeData,
  ComponentKind,
  GameMode,
  GraphSnapshot,
  IncidentDef,
  InterviewDef,
  LevelDef,
  MentorMessage,
  Scores,
  SimEvent,
  SimMetrics,
} from "@/lib/types";
import { CATALOG, defaultConfig } from "@/lib/catalog/components";
import {
  initialEngineState,
  stepSim,
  type EngineState,
  type TickContext,
} from "@/lib/simulation/engine";
import { initialFailureState, stepFailures, type FailureEngineState } from "@/lib/simulation/failures";
import { computeScores, explainScores, overallScore, type ScoreBreakdown } from "@/lib/simulation/scoring";
import { mentor } from "@/lib/mentor/mentor";
import { LEVELS, levelById } from "@/lib/game/levels";
import { incidentById } from "@/lib/game/incidents";
import { interviewById } from "@/lib/game/interviews";
import { evaluateInterview, type InterviewReport } from "@/lib/game/evaluate";

export type Phase = "design" | "running" | "paused" | "debrief";

export interface LevelResult {
  passed: boolean;
  scores: Scores;
  breakdown: ScoreBreakdown; // per-axis reasons + improvement tips
  overall: number;
  reasons: string[]; // human-readable pass/fail notes
  avgP95: number;
  avgAvailability: number;
  finalCost: number;
  lostRevenue?: number;
}

export type GameNode = Node<ArchNodeData>;

interface GameStore {
  // scenario
  mode: GameMode | null;
  level: LevelDef | null;
  incident: IncidentDef | null;
  interview: InterviewDef | null;
  phase: Phase;

  // canvas graph
  nodes: GameNode[];
  edges: Edge[];
  selectedNodeId: string | null;
  nodeCounter: number;

  // simulation
  engine: EngineState;
  failures: FailureEngineState;
  ctxPatch: { spikeMult: number; hotKeyActive: boolean; zoneOutage: number };
  tick: number;
  running: boolean;
  speed: 1 | 2 | 4;
  metricsHistory: SimMetrics[];
  events: SimEvent[];
  mentorMessages: MentorMessage[];
  mentorDelivered: string[];
  scores: Scores | null;
  scoreBreakdown: ScoreBreakdown | null;
  result: LevelResult | null;
  report: InterviewReport | null;
  lostRevenue: number;
  stableTicks: number;
  repairs: { nodeId: string; atTick: number }[];

  // persisted career progress
  progress: Record<string, { passed: boolean; overall: number }>;

  // actions
  startLevel: (id: string) => void;
  startIncident: (id: string) => void;
  startInterview: (id: string) => void;
  exitToMenu: () => void;

  onNodesChange: (changes: NodeChange<GameNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void;
  addNode: (kind: ComponentKind, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  updateNodeData: (id: string, patch: Partial<ArchNodeData>) => void;
  updateNodeConfig: (id: string, key: string, value: string | number | boolean) => void;
  selectNode: (id: string | null) => void;

  run: () => void;
  pause: () => void;
  setSpeed: (s: 1 | 2 | 4) => void;
  tickOnce: () => void;
  resetRun: () => void;
  submitInterview: () => void;
  refreshScores: () => void;
  dismissResult: () => void;
}

function toSnapshot(nodes: GameNode[], edges: Edge[]): GraphSnapshot {
  return {
    nodes: nodes.map((n) => ({ id: n.id, data: n.data, position: n.position })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function fromSnapshot(snap: GraphSnapshot): { nodes: GameNode[]; edges: Edge[] } {
  return {
    nodes: snap.nodes.map((n) => ({
      id: n.id,
      type: "arch",
      position: n.position,
      data: n.data,
      deletable: n.data.kind !== "users",
    })),
    edges: snap.edges.map((e) => ({ ...e, type: "traffic" })),
  };
}

function targetUsersOf(s: Pick<GameStore, "mode" | "level" | "incident" | "interview">): number {
  if (s.mode === "campaign" && s.level) return s.level.usersEnd;
  if (s.mode === "incident" && s.incident) return s.incident.users;
  if (s.mode === "interview" && s.interview) return s.interview.tiers[s.interview.tiers.length - 1].users;
  return 1000;
}

function scenarioOf(s: Pick<GameStore, "mode" | "level" | "incident" | "interview">) {
  if (s.mode === "campaign") return s.level;
  if (s.mode === "incident") return s.incident;
  return null;
}

const REPAIR_DELAY = 18; // ticks until a crashed instance is replaced

const freshRun = {
  engine: initialEngineState(),
  failures: initialFailureState(),
  ctxPatch: { spikeMult: 1, hotKeyActive: false, zoneOutage: 0 },
  tick: 0,
  running: false,
  metricsHistory: [] as SimMetrics[],
  events: [] as SimEvent[],
  mentorMessages: [] as MentorMessage[],
  mentorDelivered: [] as string[],
  scores: null,
  scoreBreakdown: null,
  result: null,
  report: null,
  lostRevenue: 0,
  stableTicks: 0,
  repairs: [] as { nodeId: string; atTick: number }[],
};

export const useGame = create<GameStore>()(
  persist(
    (set, get) => ({
      mode: null,
      level: null,
      incident: null,
      interview: null,
      phase: "design",
      nodes: [],
      edges: [],
      selectedNodeId: null,
      nodeCounter: 0,
      speed: 1,
      progress: {},
      ...freshRun,

      startLevel: (id) => {
        const level = levelById(id);
        if (!level) return;
        const starter = level.starter ?? {
          nodes: [
            { id: "u0", position: { x: 60, y: 200 }, data: { kind: "users" as ComponentKind, label: "Users", tier: "base", instances: 1, config: {} } },
          ],
          edges: [],
        };
        const { nodes, edges } = fromSnapshot(starter);
        set({
          ...freshRun,
          mode: "campaign",
          level,
          incident: null,
          interview: null,
          phase: "design",
          nodes,
          edges,
          selectedNodeId: null,
          nodeCounter: 100,
        });
        get().refreshScores();
      },

      startIncident: (id) => {
        const incident = incidentById(id);
        if (!incident) return;
        const { nodes, edges } = fromSnapshot(incident.starter);
        set({
          ...freshRun,
          mode: "incident",
          level: null,
          incident,
          interview: null,
          phase: "design",
          nodes,
          edges,
          selectedNodeId: null,
          nodeCounter: 100,
        });
        get().refreshScores();
      },

      startInterview: (id) => {
        const interview = interviewById(id);
        if (!interview) return;
        set({
          ...freshRun,
          mode: "interview",
          level: null,
          incident: null,
          interview,
          phase: "design",
          nodes: fromSnapshot({
            nodes: [{ id: "u0", position: { x: 60, y: 220 }, data: { kind: "users", label: "Users", tier: "base", instances: 1, config: {} } }],
            edges: [],
          }).nodes,
          edges: [],
          selectedNodeId: null,
          nodeCounter: 100,
        });
      },

      exitToMenu: () =>
        set({ ...freshRun, mode: null, level: null, incident: null, interview: null, phase: "design", nodes: [], edges: [], selectedNodeId: null }),

      onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
      onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

      onConnect: (conn) => {
        if (!conn.source || !conn.target || conn.source === conn.target) return;
        const { edges } = get();
        if (edges.some((e) => e.source === conn.source && e.target === conn.target)) return;
        set({
          edges: [
            ...edges,
            { id: `e-${conn.source}-${conn.target}`, source: conn.source, target: conn.target, type: "traffic" },
          ],
        });
        get().refreshScores();
        maybeDesignAdvice(get, set);
      },

      addNode: (kind, position) => {
        const { nodeCounter, nodes } = get();
        const spec = CATALOG[kind];
        const id = `n${nodeCounter}`;
        const node: GameNode = {
          id,
          type: "arch",
          position,
          data: {
            kind,
            label: spec.shortName === spec.name ? spec.name : spec.name,
            tier: spec.tiers[0].id,
            instances: 1,
            config: defaultConfig(kind),
          },
        };
        set({ nodes: [...nodes, node], nodeCounter: nodeCounter + 1, selectedNodeId: id });
        get().refreshScores();
        maybeDesignAdvice(get, set);
      },

      removeNode: (id) => {
        const { nodes, edges } = get();
        const node = nodes.find((n) => n.id === id);
        if (!node || node.data.kind === "users") return;
        set({
          nodes: nodes.filter((n) => n.id !== id),
          edges: edges.filter((e) => e.source !== id && e.target !== id),
          selectedNodeId: null,
        });
        get().refreshScores();
      },

      updateNodeData: (id, patch) => {
        set({
          nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
        });
        get().refreshScores();
      },

      updateNodeConfig: (id, key, value) => {
        set({
          nodes: get().nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n
          ),
        });
        get().refreshScores();
        maybeDesignAdvice(get, set);
      },

      selectNode: (id) => set({ selectedNodeId: id }),

      run: () => {
        const s = get();
        if (s.mode === "interview") return;
        if (s.phase === "debrief") return;
        set({ running: true, phase: "running" });
      },
      pause: () => set({ running: false, phase: "paused" }),
      setSpeed: (speed) => set({ speed }),

      resetRun: () => {
        const s = get();
        if (s.mode === "campaign" && s.level) get().startLevel(s.level.id);
        else if (s.mode === "incident" && s.incident) get().startIncident(s.incident.id);
      },

      dismissResult: () => set({ phase: "paused", running: false }),

      refreshScores: () => {
        const s = get();
        const scenario = scenarioOf(s);
        const slo = scenario?.slo ?? s.interview?.slo;
        const workload = scenario?.workload ?? s.interview?.workload;
        if (!slo || !workload) return;
        try {
          const scoreInput = {
            graph: toSnapshot(s.nodes, s.edges),
            workload,
            targetUsers: targetUsersOf(s),
            slo,
            recent: s.metricsHistory.slice(-20),
          };
          const scores = computeScores(scoreInput);
          set({ scores, scoreBreakdown: explainScores(scoreInput, scores) });
        } catch {
          // scoring must never crash the game
        }
      },

      submitInterview: () => {
        const s = get();
        if (!s.interview) return;
        const report = evaluateInterview(toSnapshot(s.nodes, s.edges), s.interview);
        set({ report, phase: "debrief", running: false });
      },

      tickOnce: () => {
        const s = get();
        if (!s.running || s.phase !== "running") return;
        const scenario = scenarioOf(s);
        if (!scenario) return;

        const tick = s.tick + 1;
        const duration = scenario.durationTicks;

        // user growth: linear ramp from start to end
        const startUsers = scenario.users;
        const endUsers = "usersEnd" in scenario ? (scenario as LevelDef).usersEnd : scenario.users;
        const usersNow = Math.round(startUsers + (endUsers - startUsers) * Math.min(1, tick / duration));

        const graph = toSnapshot(s.nodes, s.edges);
        const ctx: TickContext = {
          users: usersNow,
          workload: scenario.workload,
          spikeMult: s.ctxPatch.spikeMult,
          hotKeyActive: s.ctxPatch.hotKeyActive,
          zoneOutage: s.ctxPatch.zoneOutage,
        };

        const r = stepSim(s.engine, graph, ctx);

        const hasObservability = s.nodes.some((n) => n.data.kind === "monitoring");
        const f = stepFailures(s.failures, {
          tick,
          signals: r.signals,
          scripted: scenario.scripted,
          graph,
          engineState: r.state,
          hasObservability,
        });

        // apply crash requests + due repairs
        const repairs = [...s.repairs];
        for (const cr of f.crashRequests) {
          const ns = r.state.nodes[cr.nodeId];
          if (ns) {
            ns.crashedInstances += cr.instances;
            repairs.push({ nodeId: cr.nodeId, atTick: tick + REPAIR_DELAY });
          }
        }
        const dueRepairs = repairs.filter((rp) => rp.atTick <= tick);
        for (const rp of dueRepairs) {
          const ns = r.state.nodes[rp.nodeId];
          if (ns && ns.crashedInstances > 0) ns.crashedInstances -= 1;
        }
        const pendingRepairs = repairs.filter((rp) => rp.atTick > tick);

        // write runtimes into node data so custom nodes re-render with live state
        const nodes = s.nodes.map((n) => {
          const rt = r.runtimes[n.id];
          return rt ? { ...n, data: { ...n.data, runtime: rt } } : n;
        });

        // mentor (every 4 ticks, design+signal aware)
        let mentorMessages = s.mentorMessages;
        const delivered = new Set(s.mentorDelivered);
        if (tick % 4 === 0) {
          const msgs = mentor.advise({
            graph,
            workload: scenario.workload,
            targetUsers: targetUsersOf(s),
            metrics: r.metrics,
            signals: r.signals,
            delivered,
            tick,
          });
          if (msgs.length > 0) mentorMessages = [...mentorMessages, ...msgs];
        }

        const metricsHistory = [...s.metricsHistory, r.metrics].slice(-180);
        const events = [...s.events, ...f.events].slice(-200);

        // ── mode-specific bookkeeping ──────────────────────────────────────
        let lostRevenue = s.lostRevenue;
        let stableTicks = s.stableTicks;
        let phase: Phase = s.phase;
        let running: boolean = s.running;
        let result = s.result;
        let progress = s.progress;

        if (s.mode === "incident" && s.incident) {
          const inc = s.incident;
          if (r.metrics.errorRate > inc.winCondition.maxErrorRate) {
            lostRevenue += inc.revenuePerTick;
            stableTicks = 0;
          } else {
            stableTicks += 1;
          }
          const won = stableTicks >= inc.winCondition.stableTicks && tick > 10;
          const timeUp = tick >= duration;
          if (won || timeUp) {
            running = false;
            phase = "debrief";
            const incInput = {
              graph, workload: inc.workload, targetUsers: inc.users, slo: inc.slo,
              recent: metricsHistory.slice(-20),
            };
            const scores = computeScores(incInput);
            result = {
              passed: won,
              scores,
              breakdown: explainScores(incInput, scores),
              overall: overallScore(scores),
              reasons: won
                ? [`Service stabilized after ${tick} minutes.`, `Revenue lost during the incident: $${Math.round(lostRevenue).toLocaleString()}.`]
                : [`Time ran out with the service still unstable.`, `Revenue lost: $${Math.round(lostRevenue).toLocaleString()}.`],
              avgP95: avg(metricsHistory.slice(-20).map((m) => m.p95LatencyMs)),
              avgAvailability: avg(metricsHistory.slice(-20).map((m) => m.availabilityPct)),
              finalCost: r.metrics.costPerMonth,
              lostRevenue,
            };
            progress = { ...progress, [inc.id]: { passed: won, overall: result.overall } };
          }
        }

        if (s.mode === "campaign" && s.level && tick >= duration) {
          running = false;
          phase = "debrief";
          const lvl = s.level;
          const win = metricsHistory.slice(-Math.min(40, metricsHistory.length));
          const avgAvail = avg(win.map((m) => m.availabilityPct));
          const avgP95 = avg(win.map((m) => m.p95LatencyMs));
          const avgErr = avg(win.map((m) => m.errorRate));
          const finalCost = r.metrics.costPerMonth;
          const reasons: string[] = [];
          let passed = true;
          if (avgAvail < lvl.slo.minAvailabilityPct) { passed = false; reasons.push(`Availability ${avgAvail.toFixed(2)}% < required ${lvl.slo.minAvailabilityPct}%`); }
          else reasons.push(`Availability ${avgAvail.toFixed(2)}% ✓`);
          if (avgP95 > lvl.slo.maxP95Ms) { passed = false; reasons.push(`p95 latency ${Math.round(avgP95)}ms > limit ${lvl.slo.maxP95Ms}ms`); }
          else reasons.push(`p95 latency ${Math.round(avgP95)}ms ✓`);
          if (avgErr > lvl.slo.maxErrorRate) { passed = false; reasons.push(`Error rate ${(avgErr * 100).toFixed(2)}% > limit ${(lvl.slo.maxErrorRate * 100).toFixed(1)}%`); }
          else reasons.push(`Error rate ${(avgErr * 100).toFixed(2)}% ✓`);
          if (finalCost > lvl.slo.maxMonthlyBudget) { passed = false; reasons.push(`Cost $${finalCost.toLocaleString()}/mo > budget $${lvl.slo.maxMonthlyBudget.toLocaleString()}/mo`); }
          else reasons.push(`Cost $${finalCost.toLocaleString()}/mo within budget ✓`);

          const lvlInput = {
            graph, workload: lvl.workload, targetUsers: lvl.usersEnd, slo: lvl.slo,
            recent: metricsHistory.slice(-20),
          };
          const scores = computeScores(lvlInput);
          result = {
            passed, scores, breakdown: explainScores(lvlInput, scores), overall: overallScore(scores), reasons,
            avgP95, avgAvailability: avgAvail, finalCost,
          };
          progress = { ...progress, [lvl.id]: { passed, overall: result.overall } };
        }

        set({
          tick,
          engine: r.state,
          failures: f.state,
          ctxPatch: f.ctxPatch,
          nodes,
          metricsHistory,
          events,
          mentorMessages,
          mentorDelivered: [...delivered],
          repairs: pendingRepairs,
          lostRevenue,
          stableTicks,
          phase,
          running,
          result,
          progress,
        });

        // periodic score refresh (cheap-ish; avoid every tick)
        if (tick % 8 === 0) get().refreshScores();
      },
    }),
    {
      name: "sdt-progress",
      partialize: (s) => ({ progress: s.progress }),
    }
  )
);

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Design-time mentor advice (no live metrics) — throttled by rule dedupe. */
function maybeDesignAdvice(
  get: () => GameStore,
  set: (p: Partial<GameStore>) => void
) {
  const s = get();
  const scenario = scenarioOf(s) ?? s.interview;
  if (!scenario) return;
  const delivered = new Set(s.mentorDelivered);
  const msgs = mentor.advise({
    graph: toSnapshot(s.nodes, s.edges),
    workload: scenario.workload,
    targetUsers: targetUsersOf(s),
    metrics: null,
    signals: [],
    delivered,
    tick: s.tick,
  });
  if (msgs.length > 0) {
    set({
      mentorMessages: [...s.mentorMessages, ...msgs],
      mentorDelivered: [...delivered],
    });
  }
}

/** Campaign levels list + unlock state for the level-select screen. */
export function unlockedLevels(progress: Record<string, { passed: boolean }>): string[] {
  const ids: string[] = [];
  for (let i = 0; i < LEVELS.length; i++) {
    ids.push(LEVELS[i].id);
    if (!progress[LEVELS[i].id]?.passed) break;
  }
  return ids;
}
