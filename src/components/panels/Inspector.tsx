"use client";

import { CATALOG } from "@/lib/catalog/components";
import { useGame } from "@/state/store";
import { Badge, Button, NumberInput, Select, Toggle, cn } from "@/components/ui";

export function Inspector() {
  const selectedId = useGame((s) => s.selectedNodeId);
  const node = useGame((s) => s.nodes.find((n) => n.id === s.selectedNodeId));
  const updateNodeData = useGame((s) => s.updateNodeData);
  const updateNodeConfig = useGame((s) => s.updateNodeConfig);
  const removeNode = useGame((s) => s.removeNode);

  if (!selectedId || !node) {
    return (
      <div className="p-4 text-center text-xs text-ink-500">
        Select a component to configure it.
      </div>
    );
  }

  const spec = CATALOG[node.data.kind];
  const isUsers = node.data.kind === "users";
  const rt = node.data.runtime;
  const supportsInstances = !["users", "cdn", "dynamodb", "sqs", "load_balancer", "monitoring", "k8s_cluster", "kafka"].includes(node.data.kind);

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink-100">
            <span>{spec.icon}</span> {node.data.label}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-ink-400">{spec.description}</p>
        </div>
      </div>

      {rt && !isUsers && (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-ink-700 bg-ink-900 p-2 text-[11px]">
          <div>
            <span className="text-ink-500">Utilization</span>{" "}
            <span className={cn("font-mono", rt.utilization > 0.95 ? "text-crit" : rt.utilization > 0.75 ? "text-warn" : "text-ok")}>
              {Math.round(Math.min(rt.utilization, 9.99) * 100)}%
            </span>
          </div>
          <div>
            <span className="text-ink-500">Latency</span>{" "}
            <span className="font-mono text-ink-200">{rt.latencyMs.toFixed(0)}ms</span>
          </div>
          <div>
            <span className="text-ink-500">Traffic</span>{" "}
            <span className="font-mono text-ink-200">{Math.round(rt.servedRps).toLocaleString()} rps</span>
          </div>
          <div>
            <span className="text-ink-500">Errors</span>{" "}
            <span className={cn("font-mono", rt.errorRate > 0.02 ? "text-crit" : "text-ink-200")}>
              {(rt.errorRate * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {!isUsers && spec.tiers.length > 1 && (
        <Field label="Instance size" hint="Vertical scaling — bigger box, super-linear cost">
          <Select
            value={node.data.tier}
            onChange={(v) => updateNodeData(selectedId, { tier: v })}
            options={spec.tiers.map((t) => ({ value: t.id, label: t.label }))}
          />
        </Field>
      )}

      {supportsInstances && (
        <Field label="Instances" hint="Horizontal scaling — more identical boxes">
          <NumberInput
            value={node.data.instances}
            min={1}
            max={100}
            onChange={(v) => updateNodeData(selectedId, { instances: v })}
          />
        </Field>
      )}

      {spec.config.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          {f.type === "select" && (
            <Select
              value={String(node.data.config[f.key] ?? f.default)}
              onChange={(v) => updateNodeConfig(selectedId, f.key, v)}
              options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
            />
          )}
          {f.type === "number" && (
            <NumberInput
              value={Number(node.data.config[f.key] ?? f.default)}
              min={f.min}
              max={f.max}
              onChange={(v) => updateNodeConfig(selectedId, f.key, v)}
            />
          )}
          {f.type === "toggle" && (
            <Toggle
              checked={node.data.config[f.key] === true}
              onChange={(v) => updateNodeConfig(selectedId, f.key, v)}
            />
          )}
        </Field>
      ))}

      {!isUsers && (
        <div className="space-y-2 border-t border-ink-700 pt-3">
          <div className="flex flex-wrap gap-1">
            {spec.consistency && <Badge tone="accent">{spec.consistency} consistency</Badge>}
            <Badge>${spec.costPerMonthUsd}/mo base</Badge>
          </div>
          <Button variant="danger" className="w-full" onClick={() => removeNode(selectedId)}>
            Remove component
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-ink-200">{label}</span>
      </div>
      {children}
      {hint && <p className="mt-1 text-[10px] leading-snug text-ink-500">{hint}</p>}
    </div>
  );
}
