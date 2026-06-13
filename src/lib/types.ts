// ─────────────────────────────────────────────────────────────────────────────
// Core domain types for System Design Tycoon
// ─────────────────────────────────────────────────────────────────────────────

export type ComponentCategory =
  | "traffic"
  | "network"
  | "compute"
  | "database"
  | "cache"
  | "messaging"
  | "search"
  | "observability";

export type ComponentKind =
  | "users"
  | "cdn"
  | "load_balancer"
  | "api_server"
  | "k8s_cluster"
  | "postgres"
  | "mysql"
  | "mongodb"
  | "cassandra"
  | "dynamodb"
  | "elasticsearch"
  | "redis"
  | "kafka"
  | "rabbitmq"
  | "sqs"
  | "worker"
  | "monitoring";

export type Consistency = "strong" | "eventual" | "tunable";

export interface Tier {
  id: string;
  label: string;
  /** Multiplier applied to base read/write capacity */
  capacityMult: number;
  /** Multiplier applied to base cost */
  costMult: number;
  storageGb: number;
}

export interface ComponentSpec {
  kind: ComponentKind;
  name: string;
  shortName: string;
  category: ComponentCategory;
  icon: string; // emoji glyph for the node
  description: string;
  /** Per single instance at the base tier */
  readCapacityRps: number;
  writeCapacityRps: number;
  baseLatencyMs: { read: number; write: number };
  costPerMonthUsd: number;
  consistency?: Consistency;
  tiers: Tier[];
  /** What configuration this component exposes in the inspector */
  config: ConfigField[];
  /** Surfaced ONLY in debriefs / after failures — never up-front */
  teachingNotes: string[];
  /** Tags for scenario fit scoring (e.g. interview rubric) */
  goodFor: string[];
  badFor: string[];
}

export type ConfigFieldType = "select" | "number" | "toggle";

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  options?: { value: string; label: string; hint?: string }[];
  min?: number;
  max?: number;
  default: string | number | boolean;
  hint?: string;
}

// ── Node instances on the canvas ─────────────────────────────────────────────

export interface NodeConfig {
  [key: string]: string | number | boolean;
}

export interface ArchNodeData {
  kind: ComponentKind;
  label: string;
  /** Tier id from spec.tiers */
  tier: string;
  /** Number of identical instances (horizontal scaling) */
  instances: number;
  config: NodeConfig;
  /** Live runtime state, written by the simulation each tick */
  runtime?: NodeRuntime;
  [key: string]: unknown; // React Flow node data must be Record-compatible
}

export interface NodeRuntime {
  utilization: number; // 0..n (>1 means overloaded)
  latencyMs: number;
  errorRate: number; // 0..1 of requests failing at this node
  inboundRps: number;
  servedRps: number;
  storagePct: number; // 0..1
  backlog: number; // queued messages (messaging) or pending conns
  replicationLagMs: number;
  crashed: boolean;
  crashedInstances: number;
  status: "ok" | "warn" | "crit" | "down";
  activeFailures: string[]; // failure ids currently affecting this node
}

// ── Simulation ───────────────────────────────────────────────────────────────

export interface WorkloadProfile {
  /** Requests per second per 1000 users at steady state */
  rpsPerKUsers: number;
  readRatio: number; // 0..1, remainder is writes
  /** Fraction of read traffic that is static/cacheable at the CDN */
  staticRatio: number;
  /** Fraction of reads that are search queries (need a search engine) */
  searchRatio: number;
  /** GB written per day per 10k users — drives storage fill */
  storageGbPerDayPer10k: number;
  /** Daily peak-to-average multiplier */
  peakMult: number;
  /** Does the product require strong consistency (payments etc.) */
  needsStrongConsistency: boolean;
  /** Hot-key skew: 0 = uniform, 1 = extremely skewed (celebrity problem) */
  skew: number;
  /** How full the starting database already is (0..1) — pre-existing data */
  initialDbFillPct?: number;
}

export interface SimMetrics {
  tick: number;
  totalRps: number;
  servedRps: number;
  p95LatencyMs: number;
  errorRate: number; // 0..1
  availabilityPct: number; // rolling
  costPerMonth: number;
  usersNow: number;
  queueBacklogTotal: number;
}

export type EventSeverity = "info" | "warn" | "crit" | "resolve" | "mentor";

export interface SimEvent {
  id: string;
  tick: number;
  severity: EventSeverity;
  title: string;
  /** Symptom-only description — the player investigates */
  detail: string;
  nodeId?: string;
  failureId?: string;
}

export interface ActiveFailure {
  id: string;
  defId: string;
  nodeId?: string;
  startedTick: number;
  /** undefined = until fixed */
  endsTick?: number;
  resolvedTick?: number;
}

export interface Scores {
  scalability: number;
  reliability: number;
  latency: number;
  cost: number;
  maintainability: number;
  complexity: number;
}

export interface GraphSnapshot {
  nodes: { id: string; data: ArchNodeData; position: { x: number; y: number } }[];
  edges: { id: string; source: string; target: string }[];
}

// ── Scenarios / game modes ───────────────────────────────────────────────────

export interface ScriptedEvent {
  /** Fires when sim reaches this tick */
  atTick: number;
  type:
    | "traffic_spike"
    | "node_crash"
    | "az_failure"
    | "region_failure"
    | "hot_key"
    | "bad_deploy"
    | "user_growth";
  magnitude?: number; // e.g. spike multiplier
  durationTicks?: number;
  targetKind?: ComponentKind; // crash targets a node of this kind
  announcement: string; // symptom-flavoured event log line
}

export interface SLO {
  maxP95Ms: number;
  minAvailabilityPct: number;
  maxErrorRate: number;
  maxMonthlyBudget: number;
}

export interface LevelDef {
  id: string;
  number: number;
  title: string;
  project: string;
  users: number;
  /** Users grow toward this over the run */
  usersEnd: number;
  durationTicks: number;
  brief: string[];
  workload: WorkloadProfile;
  slo: SLO;
  scripted: ScriptedEvent[];
  /** Component kinds available in the palette at this level */
  unlocked: ComponentKind[];
  /** Concept this level teaches — used by the debrief, shown only AFTER */
  debrief: { concept: string; explanation: string[]; tradeoffs: string[] };
  /** Optional starting architecture (else: 1 api server + 1 mongodb) */
  starter?: GraphSnapshot;
}

export interface IncidentDef {
  id: string;
  title: string;
  company: string;
  users: number;
  brief: string[];
  workload: WorkloadProfile;
  slo: SLO;
  durationTicks: number;
  /** Revenue burned per tick while error rate above threshold */
  revenuePerTick: number;
  starter: GraphSnapshot;
  /** Failures pre-armed at start */
  scripted: ScriptedEvent[];
  /** Predicate description checked to declare victory */
  winCondition: { maxErrorRate: number; stableTicks: number };
  debrief: { concept: string; explanation: string[]; tradeoffs: string[] };
}

export interface InterviewDef {
  id: string;
  title: string;
  prompt: string[];
  requirements: string[];
  workload: WorkloadProfile;
  /** Traffic tiers the design is stress-tested against */
  tiers: { users: number; label: string }[];
  slo: SLO;
}

export type GameMode = "campaign" | "incident" | "interview";

export interface MentorMessage {
  id: string;
  tick: number;
  text: string;
  kind: "question" | "observation" | "tradeoff" | "praise";
}
