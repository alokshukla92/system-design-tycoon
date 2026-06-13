"use client";

import { memo } from "react";
import { BaseEdge, getSmoothStepPath, useNodesData, type EdgeProps } from "@xyflow/react";
import type { GameNode } from "@/state/store";

export const TrafficEdge = memo(function TrafficEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const targetNode = useNodesData<GameNode>(target);
  const sourceNode = useNodesData<GameNode>(source);
  const rt = targetNode?.data.runtime;
  const srcRt = sourceNode?.data.runtime;

  const flowing = (srcRt?.servedRps ?? 0) > 0.5 || (rt?.inboundRps ?? 0) > 0.5;
  const erroring = rt?.status === "crit" || rt?.status === "down";
  const busy = (rt?.inboundRps ?? 0) > 2000;

  const cls = erroring ? "edge-flow-error" : flowing ? (busy ? "edge-flow-fast" : "edge-flow") : undefined;
  const stroke = erroring ? "#f87171" : flowing ? "#60a5fa" : "#3d4a75";

  return (
    <BaseEdge
      id={id}
      path={path}
      className={cls}
      style={{ stroke, strokeWidth: erroring || busy ? 2.2 : 1.5 }}
    />
  );
});
