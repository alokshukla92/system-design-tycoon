"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GameNode } from "@/state/store";
import { CATALOG } from "@/lib/catalog/components";
import { cn, Meter } from "@/components/ui";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export const ArchNode = memo(function ArchNode({ data, selected }: NodeProps<GameNode>) {
  const spec = CATALOG[data.kind];
  const rt = data.runtime;
  const status = rt?.status ?? "ok";
  const isUsers = data.kind === "users";

  const ring =
    status === "down"
      ? "border-crit"
      : status === "crit"
        ? "border-crit"
        : status === "warn"
          ? "border-warn"
          : selected
            ? "border-accent"
            : "border-ink-600";

  const tierLabel = spec.tiers.length > 1 ? spec.tiers.find((t) => t.id === data.tier)?.label?.split(" ")[0] : null;

  return (
    <div
      className={cn(
        "min-w-[130px] rounded-lg border-2 bg-ink-850 px-2.5 py-2 shadow-lg transition-colors",
        ring,
        (status === "crit" || status === "down") && "node-alarm"
      )}
    >
      {!isUsers && <Handle type="target" position={Position.Left} />}
      <Handle type="source" position={Position.Right} />

      <div className="flex items-center gap-1.5">
        <span className="text-lg leading-none">{spec.icon}</span>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-ink-100">{data.label}</div>
          <div className="text-[9px] text-ink-400">
            {isUsers && rt
              ? `${fmt(rt.inboundRps)} rps offered`
              : [
                  tierLabel,
                  data.instances > 1 ? `×${data.instances}` : null,
                  data.kind === "k8s_cluster" ? `${data.config.minPods}–${data.config.maxPods} pods` : null,
                  Number(data.config.shards ?? 1) > 1 ? `${data.config.shards} shards` : null,
                  Number(data.config.readReplicas ?? data.config.replicaSet ?? 0) > 0
                    ? `+${data.config.readReplicas ?? data.config.replicaSet} repl`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || spec.shortName}
          </div>
        </div>
      </div>

      {rt && !isUsers && (
        <div className="mt-1.5 space-y-1">
          {status === "down" ? (
            <div className="rounded bg-crit/20 px-1 py-0.5 text-center text-[9px] font-bold text-crit">DOWN</div>
          ) : (
            <>
              <div className="flex items-center justify-between text-[9px] text-ink-400">
                <span>{fmt(rt.servedRps)} rps</span>
                <span className={cn(rt.utilization > 0.95 ? "text-crit" : rt.utilization > 0.75 ? "text-warn" : "text-ink-300")}>
                  {Math.round(Math.min(rt.utilization, 9.99) * 100)}%
                </span>
              </div>
              <Meter value={rt.utilization} />
              {rt.storagePct > 0.5 && (
                <div className="flex items-center gap-1 text-[9px] text-ink-400">
                  <span className="shrink-0">💾</span>
                  <Meter value={rt.storagePct} className="flex-1" />
                </div>
              )}
              {rt.backlog > 500 && (
                <div className={cn("text-[9px]", rt.backlog > 30_000 ? "text-crit" : "text-warn")}>
                  📥 {fmt(rt.backlog)} queued
                </div>
              )}
              {rt.replicationLagMs > 300 && (
                <div className={cn("text-[9px]", rt.replicationLagMs > 1500 ? "text-crit" : "text-warn")}>
                  ⏳ lag {(rt.replicationLagMs / 1000).toFixed(1)}s
                </div>
              )}
              {rt.crashedInstances > 0 && (
                <div className="text-[9px] text-crit">💀 {rt.crashedInstances} instance(s) down</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});
