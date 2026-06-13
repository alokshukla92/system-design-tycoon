import type { GraphSnapshot, ScriptedEvent, SimEvent } from "@/lib/types";
import type { EmergentSignal, EngineState, SignalType, TickContext } from "./engine";

// ─────────────────────────────────────────────────────────────────────────────
// Failure engine: converts emergent signals + scripted events into
// symptom-only incidents the player must investigate. Teaching text is
// attached to *resolution*, not occurrence — explanation comes after struggle.
// ─────────────────────────────────────────────────────────────────────────────

export interface FailureDefView {
  id: SignalType;
  title: (nodeLabel: string) => string;
  /** Symptoms only — never names the concept or the fix */
  symptom: (nodeLabel: string, value: number) => string;
  /** Richer diagnostics shown only when an Observability stack is deployed */
  diagnostic?: (nodeLabel: string, value: number) => string;
  /** Shown when the condition clears — THIS is where the lesson lands */
  lesson: string;
}

export const FAILURE_DEFS: Record<SignalType, FailureDefView> = {
  overload: {
    id: "overload",
    title: (n) => `${n}: CPU saturated`,
    symptom: (n) => `${n} is pegged. Queries are queueing; response times are climbing fast.`,
    diagnostic: (n, v) => `${n} utilization at ${(v * 100).toFixed(0)}%. Active connections piling up; lock waits increasing.`,
    lesson:
      "A node near 100% utilization doesn't degrade linearly — queueing theory says wait times explode as utilization approaches 1. Keep headroom (~70%) or add capacity before the cliff.",
  },
  compute_overload: {
    id: "compute_overload",
    title: (n) => `${n}: requests timing out`,
    symptom: (n) => `${n} can't keep up with incoming traffic. Users are seeing timeouts and 5xx errors.`,
    diagnostic: (n, v) => `${n} at ${(v * 100).toFixed(0)}% of capacity. Request queue overflowing; worker threads exhausted.`,
    lesson:
      "A single server has a hard ceiling. Vertical scaling (a bigger box) buys time at super-linear cost; horizontal scaling (more boxes behind a load balancer) is the long-term answer.",
  },
  unindexed_slow: {
    id: "unindexed_slow",
    title: (n) => `${n}: queries crawling`,
    symptom: (n, v) =>
      `Reads on ${n} now take ${v.toFixed(0)}ms and getting worse as data grows. CPU is busy but throughput keeps dropping.`,
    diagnostic: (n) => `${n}: query planner reports full collection/table scans on the hottest query patterns.`,
    lesson:
      "Without an index, every query scans the whole table — O(rows). Indexes make lookups O(log n) at the cost of slightly slower writes and extra storage. The fix that turns 5s queries back into 5ms ones.",
  },
  replication_lag: {
    id: "replication_lag",
    title: (n) => `${n}: replicas falling behind`,
    symptom: (n, v) =>
      `Users report saving data and then not seeing it. Replicas on ${n} are ${(v / 1000).toFixed(1)}s behind the primary.`,
    diagnostic: (n, v) => `${n} replication lag: ${v.toFixed(0)}ms and climbing with write volume.`,
    lesson:
      "Async replication means replicas serve stale data under write load — a read-your-writes violation. Mitigations: read your own writes from the primary, sticky sessions, or accept eventual consistency where it's harmless.",
  },
  hot_partition: {
    id: "hot_partition",
    title: (n) => `${n}: one shard is on fire`,
    symptom: (n) =>
      `${n} is sharded, but one shard is at 100% CPU while the others sit idle. Overall throughput is a fraction of what you paid for.`,
    diagnostic: (n) => `${n}: >80% of writes are landing on a single shard. Key distribution is heavily skewed.`,
    lesson:
      "Sharding only helps if the shard key spreads load. Monotonic keys (timestamps, auto-increment ids) route every new write to the same shard; celebrity users skew natural keys. Hashed or composite keys spread load — at the cost of expensive range queries.",
  },
  cache_stampede: {
    id: "cache_stampede",
    title: () => `Database flooded by sudden misses`,
    symptom: () =>
      `Cache hit ratio just fell off a cliff. Thousands of identical queries are hitting the database simultaneously. DB latency spiking.`,
    diagnostic: () => `Hot cache keys expired at the same moment; all requests are racing to recompute the same values.`,
    lesson:
      "Cache stampede: a hot key expires and every concurrent request misses at once, hammering the DB with identical queries. Fixes: TTL jitter (spread expiries), request coalescing (one refill, others wait), or background refresh.",
  },
  queue_backlog: {
    id: "queue_backlog",
    title: (n) => `${n}: backlog growing unbounded`,
    symptom: (n, v) =>
      `${n} has ${Math.round(v).toLocaleString()} messages queued and rising. Downstream data is minutes behind and falling further back.`,
    diagnostic: (n) => `${n}: producer rate exceeds total consumer drain rate. Consumer lag increasing monotonically.`,
    lesson:
      "A queue buys time, not throughput. If consumers are permanently slower than producers, the backlog grows forever. Fix the drain: more workers, more partitions (consumer parallelism is capped by partition count), or faster processing.",
  },
  queue_no_consumer: {
    id: "queue_no_consumer",
    title: (n) => `${n}: messages going in, nothing coming out`,
    symptom: (n) => `Writes are being acknowledged but the data never shows up anywhere. ${n} is accumulating messages with no consumer attached.`,
    diagnostic: (n) => `${n}: zero active consumers registered.`,
    lesson:
      "A queue without consumers is a black hole with an SLA. Every queue needs workers draining it — connect a worker pool to process messages into storage.",
  },
  disk_full: {
    id: "disk_full",
    title: (n) => `${n}: storage exhausted`,
    symptom: (n) => `${n} rejected all writes — disk is 100% full. The app is throwing write errors everywhere.`,
    diagnostic: (n) => `${n}: data volume at capacity. Write-ahead log cannot extend.`,
    lesson:
      "Storage is a capacity dimension people forget until it pages them at 3am. Watch growth rate, not just current usage. Fixes: bigger tier, sharding (splits data), TTL/archival policies.",
  },
  retry_storm: {
    id: "retry_storm",
    title: () => `Traffic amplifying itself`,
    symptom: () =>
      `Inbound traffic to the database is now far higher than user traffic explains. Every failure seems to spawn more requests. The overload is feeding itself.`,
    diagnostic: () => `Request rate ≈ 2× organic traffic. Retry headers on the flood of incoming queries.`,
    lesson:
      "Retry storm: clients retry failed calls against an already-overloaded dependency, multiplying load exactly when capacity is least available. Retries need budgets/backoff, and a circuit breaker to stop the flood and let the dependency recover.",
  },
  throttling: {
    id: "throttling",
    title: (n) => `${n}: requests throttled`,
    symptom: (n) => `${n} is returning ProvisionedThroughputExceeded on a chunk of requests — but you're nowhere near the table's total limit.`,
    diagnostic: (n) => `${n}: throttling concentrated on a single partition key.`,
    lesson:
      "Managed doesn't mean unlimited: DynamoDB enforces per-partition-key throughput. One hot key gets throttled regardless of table capacity. Fix the key design: composite keys, write sharding (key#1..N), or cache the hot item.",
  },
  breaker_open: {
    id: "breaker_open",
    title: (n) => `Circuit breaker open for ${n}`,
    symptom: (n) =>
      `Calls to ${n} are being rejected instantly instead of waiting. A trickle of probe traffic is testing recovery.`,
    lesson:
      "The breaker converted 'slow and failing' into 'fast and degraded' — users get instant errors instead of hangs, and the dependency gets breathing room to recover. Failing fast is a feature.",
  },
  search_on_db: {
    id: "search_on_db",
    title: (n) => `${n}: crushed by search queries`,
    symptom: (n) =>
      `A small fraction of requests — text searches — is consuming most of ${n}'s CPU. Each search query costs ~20× a normal read.`,
    diagnostic: (n) => `${n}: LIKE '%term%' queries doing full scans. No usable index for substring search.`,
    lesson:
      "Databases are terrible at full-text search: LIKE '%term%' can't use a B-tree index, so every search scans everything. A search engine (Elasticsearch) inverts the index — queries become cheap lookups. Pattern: DB as source of truth, async-indexed into search.",
  },
  crash_unrouted: {
    id: "crash_unrouted",
    title: (n) => `${n}: dead instance still receiving traffic`,
    symptom: (n) =>
      `An instance of ${n} crashed, and a slice of requests is failing with connection refused. Traffic is still being sent to the corpse.`,
    diagnostic: (n) => `${n}: 1+ instances unreachable; no health-checked load balancer rerouting around them.`,
    lesson:
      "Crashes are inevitable; sending traffic to crashed instances is optional. A load balancer with health checks detects dead targets and reroutes within seconds — that's the difference between a blip and an outage.",
  },
  duplicate_writes: {
    id: "duplicate_writes",
    title: () => `Customers reporting duplicate actions`,
    symptom: () =>
      `Support tickets incoming: double charges, duplicate messages, repeated orders. Some writes are being applied more than once.`,
    diagnostic: () => `Retried/redelivered writes applied multiple times. No deduplication on the write path.`,
    lesson:
      "Retries and at-least-once queues mean the same write WILL occasionally arrive twice. Idempotency keys (client-generated unique ids checked at the write path) make duplicates harmless. Non-negotiable for payments.",
  },
  stale_reads: {
    id: "stale_reads",
    title: (n) => `${n}: users seeing old data`,
    symptom: (n) => `Intermittent reports of vanished updates. Reads from ${n} sometimes return values from seconds ago, then flip back.`,
    lesson:
      "Consistency level ONE means a read can hit a replica that hasn't seen the latest write — eventual consistency in action. QUORUM reads/writes give read-your-writes at a latency cost. This is the CAP tradeoff as a config option.",
  },
};

// ── Failure tracker ──────────────────────────────────────────────────────────

export interface TrackedFailure {
  id: string; // unique instance id
  defId: SignalType;
  nodeId: string;
  startedTick: number;
  lastSeenTick: number;
  resolvedTick?: number;
  announced: boolean;
}

export interface FailureEngineState {
  active: TrackedFailure[];
  resolved: TrackedFailure[];
  counter: number;
  /** scripted events already fired (by index) */
  firedScripted: number[];
  /** ticks remaining of spike / hotkey / zone outage */
  spikeTicksLeft: number;
  spikeMult: number;
  hotKeyTicksLeft: number;
  zoneOutageTicksLeft: number;
  zoneOutageMagnitude: number;
}

export function initialFailureState(): FailureEngineState {
  return {
    active: [],
    resolved: [],
    counter: 0,
    firedScripted: [],
    spikeTicksLeft: 0,
    spikeMult: 1,
    hotKeyTicksLeft: 0,
    zoneOutageTicksLeft: 0,
    zoneOutageMagnitude: 0,
  };
}

const GRACE_TICKS = 3; // signal must persist before announcing
const CLEAR_TICKS = 4; // signal must be absent before declaring resolved

export interface FailureTickInput {
  tick: number;
  signals: EmergentSignal[];
  scripted: ScriptedEvent[];
  graph: GraphSnapshot;
  engineState: EngineState;
  hasObservability: boolean;
}

export interface FailureTickOutput {
  state: FailureEngineState;
  events: SimEvent[];
  /** mutations the sim must apply next tick */
  ctxPatch: Pick<TickContext, "spikeMult" | "hotKeyActive" | "zoneOutage">;
  crashRequests: { nodeId: string; instances: number }[];
}

export function stepFailures(prev: FailureEngineState, input: FailureTickInput): FailureTickOutput {
  const state: FailureEngineState = {
    ...prev,
    active: prev.active.map((f) => ({ ...f })),
    resolved: [...prev.resolved],
    firedScripted: [...prev.firedScripted],
  };
  const events: SimEvent[] = [];
  const crashRequests: { nodeId: string; instances: number }[] = [];
  const labelOf = (nodeId: string) =>
    input.graph.nodes.find((n) => n.id === nodeId)?.data.label ?? "component";

  // ── 1. Scripted events ──────────────────────────────────────────────────
  input.scripted.forEach((ev, idx) => {
    if (input.tick !== ev.atTick || state.firedScripted.includes(idx)) return;
    state.firedScripted.push(idx);
    const dur = ev.durationTicks ?? 10;
    switch (ev.type) {
      case "traffic_spike":
        state.spikeTicksLeft = dur;
        state.spikeMult = ev.magnitude ?? 5;
        break;
      case "hot_key":
        state.hotKeyTicksLeft = dur;
        break;
      case "az_failure":
        state.zoneOutageTicksLeft = dur;
        state.zoneOutageMagnitude = ev.magnitude ?? 0.33;
        break;
      case "region_failure":
        state.zoneOutageTicksLeft = dur;
        state.zoneOutageMagnitude = ev.magnitude ?? 0.66;
        break;
      case "node_crash": {
        const target = input.graph.nodes.find((n) => n.data.kind === ev.targetKind);
        if (target) crashRequests.push({ nodeId: target.id, instances: 1 });
        break;
      }
      case "bad_deploy":
        state.spikeTicksLeft = dur;
        state.spikeMult = ev.magnitude ?? 1.6; // bad code = heavier queries
        break;
      case "user_growth":
        break; // handled by run controller
    }
    events.push({
      id: `ev-${input.tick}-${idx}`,
      tick: input.tick,
      severity: ev.type === "user_growth" ? "info" : "crit",
      title: scriptedTitle(ev),
      detail: ev.announcement,
    });
  });

  // decay timed effects
  if (state.spikeTicksLeft > 0) state.spikeTicksLeft -= 1;
  else state.spikeMult = 1;
  if (state.hotKeyTicksLeft > 0) state.hotKeyTicksLeft -= 1;
  if (state.zoneOutageTicksLeft > 0) state.zoneOutageTicksLeft -= 1;
  else state.zoneOutageMagnitude = 0;

  // ── 2. Emergent signals → tracked failures ──────────────────────────────
  const seenKeys = new Set<string>();
  for (const sig of input.signals) {
    const key = `${sig.type}:${sig.nodeId}`;
    seenKeys.add(key);
    let tracked = state.active.find((f) => f.defId === sig.type && f.nodeId === sig.nodeId);
    if (!tracked) {
      tracked = {
        id: `f${state.counter++}`,
        defId: sig.type,
        nodeId: sig.nodeId,
        startedTick: input.tick,
        lastSeenTick: input.tick,
        announced: false,
      };
      state.active.push(tracked);
    }
    tracked.lastSeenTick = input.tick;

    // announce once symptom persisted past grace period
    if (!tracked.announced && input.tick - tracked.startedTick >= GRACE_TICKS) {
      tracked.announced = true;
      const def = FAILURE_DEFS[sig.type];
      const label = labelOf(sig.nodeId);
      const detail =
        input.hasObservability && def.diagnostic
          ? `${def.symptom(label, sig.value)}\n🔬 ${def.diagnostic(label, sig.value)}`
          : def.symptom(label, sig.value);
      events.push({
        id: `${tracked.id}-announce`,
        tick: input.tick,
        severity: "crit",
        title: def.title(label),
        detail,
        nodeId: sig.nodeId,
        failureId: tracked.id,
      });
    }
  }

  // ── 3. Resolution detection: signal gone long enough → lesson drops ─────
  for (const f of [...state.active]) {
    if (input.tick - f.lastSeenTick >= CLEAR_TICKS) {
      state.active = state.active.filter((x) => x.id !== f.id);
      f.resolvedTick = input.tick;
      state.resolved.push(f);
      if (f.announced) {
        const def = FAILURE_DEFS[f.defId];
        events.push({
          id: `${f.id}-resolved`,
          tick: input.tick,
          severity: "resolve",
          title: `Resolved: ${def.title(labelOf(f.nodeId))}`,
          detail: `📚 ${def.lesson}`,
          nodeId: f.nodeId,
          failureId: f.id,
        });
      }
    }
  }

  return {
    state,
    events,
    ctxPatch: {
      spikeMult: state.spikeTicksLeft > 0 ? state.spikeMult : 1,
      hotKeyActive: state.hotKeyTicksLeft > 0,
      zoneOutage: state.zoneOutageTicksLeft > 0 ? state.zoneOutageMagnitude : 0,
    },
    crashRequests,
  };
}

function scriptedTitle(ev: ScriptedEvent): string {
  switch (ev.type) {
    case "traffic_spike": return "🔥 Traffic spike";
    case "node_crash": return "💥 Instance crash";
    case "az_failure": return "🌩️ Availability zone failure";
    case "region_failure": return "🌍 Region failure";
    case "hot_key": return "⭐ Viral activity";
    case "bad_deploy": return "🚀 Deploy gone wrong";
    case "user_growth": return "📈 Growth milestone";
  }
}
