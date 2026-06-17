"use client";

import { useGame } from "@/state/store";
import { Sparkline, Stat } from "@/components/ui";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function MetricsPanel() {
  const history = useGame((s) => s.metricsHistory);
  const level = useGame((s) => s.level);
  const incident = useGame((s) => s.incident);
  const interview = useGame((s) => s.interview);
  const lostRevenue = useGame((s) => s.lostRevenue);
  const m = history[history.length - 1];
  const slo = level?.slo ?? incident?.slo ?? interview?.slo;

  // Before the run there are no live metrics — show the targets the player is
  // designing toward (especially the budget) so they're never flying blind.
  if (!m) {
    if (!slo) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-ink-500">
          Metrics appear when the simulation runs.
        </div>
      );
    }
    return (
      <div className="flex h-full items-center gap-6 overflow-x-auto px-4">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          🎯 Targets
        </span>
        <Stat label="p95 latency" value={`≤ ${slo.maxP95Ms}ms`} />
        <Stat label="Availability" value={`≥ ${slo.minAvailabilityPct}%`} />
        <Stat label="Error rate" value={`≤ ${(slo.maxErrorRate * 100).toFixed(1)}%`} />
        {!incident && (
          <Stat label="Budget" value={`$${fmt(slo.maxMonthlyBudget)}/mo`} tone="warn" />
        )}
        <span className="ml-auto shrink-0 text-[10px] text-ink-500">
          ▶ Launch to see live metrics against these targets
        </span>
      </div>
    );
  }

  const win = history.slice(-90);

  return (
    <div className="grid h-full grid-cols-3 items-center gap-x-6 gap-y-2 px-4 py-2 lg:grid-cols-6">
      <MetricCell
        label="Users"
        value={fmt(m.usersNow)}
        data={win.map((x) => x.usersNow)}
        stroke="#a78bfa"
      />
      <MetricCell
        label="Traffic"
        value={`${fmt(m.totalRps)} rps`}
        data={win.map((x) => x.totalRps)}
        stroke="#60a5fa"
      />
      <MetricCell
        label="p95 latency"
        value={`${m.p95LatencyMs}ms`}
        tone={slo && m.p95LatencyMs > slo.maxP95Ms ? "crit" : "default"}
        sub={slo ? `SLO ≤ ${slo.maxP95Ms}ms` : undefined}
        data={win.map((x) => x.p95LatencyMs)}
        stroke="#fbbf24"
      />
      <MetricCell
        label="Error rate"
        value={`${(m.errorRate * 100).toFixed(2)}%`}
        tone={slo && m.errorRate > slo.maxErrorRate ? "crit" : m.errorRate > 0.001 ? "warn" : "ok"}
        sub={slo ? `SLO ≤ ${(slo.maxErrorRate * 100).toFixed(1)}%` : undefined}
        data={win.map((x) => x.errorRate * 100)}
        stroke="#f87171"
      />
      <MetricCell
        label="Availability"
        value={`${m.availabilityPct.toFixed(2)}%`}
        tone={slo && m.availabilityPct < slo.minAvailabilityPct ? "crit" : "ok"}
        sub={slo ? `SLO ≥ ${slo.minAvailabilityPct}%` : undefined}
        data={win.map((x) => x.availabilityPct)}
        stroke="#34d399"
      />
      <MetricCell
        label={incident ? "Revenue lost" : "Infra cost"}
        value={incident ? `$${fmt(lostRevenue)}` : `$${fmt(m.costPerMonth)}/mo`}
        tone={
          incident
            ? lostRevenue > 0
              ? "crit"
              : "ok"
            : slo && m.costPerMonth > slo.maxMonthlyBudget
              ? "crit"
              : "default"
        }
        sub={!incident && slo ? `Budget $${fmt(slo.maxMonthlyBudget)}/mo` : undefined}
        data={win.map((x) => x.costPerMonth)}
        stroke="#8b98c2"
      />
    </div>
  );
}

function MetricCell({
  label,
  value,
  sub,
  tone = "default",
  data,
  stroke,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "ok" | "warn" | "crit";
  data: number[];
  stroke: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Stat label={label} value={value} sub={sub} tone={tone} />
      <Sparkline data={data} stroke={stroke} width={90} height={26} />
    </div>
  );
}
