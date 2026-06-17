"use client";

import { useCallback, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useGame, type GameNode } from "@/state/store";
import type { ComponentKind } from "@/lib/types";
import { ArchNode } from "./ArchNode";
import { TrafficEdge } from "./TrafficEdge";

const nodeTypes = { arch: ArchNode };
const edgeTypes = { traffic: TrafficEdge };

function CanvasInner() {
  const nodes = useGame((s) => s.nodes);
  const edges = useGame((s) => s.edges);
  const onNodesChange = useGame((s) => s.onNodesChange);
  const onEdgesChange = useGame((s) => s.onEdgesChange);
  const onConnect = useGame((s) => s.onConnect);
  const addNode = useGame((s) => s.addNode);
  const selectNode = useGame((s) => s.selectNode);
  const theme = useGame((s) => s.theme);
  const { screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData("application/sdt-component") as ComponentKind;
      if (!kind) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(kind, { x: position.x - 65, y: position.y - 30 });
    },
    [screenToFlowPosition, addNode]
  );

  return (
    <div ref={wrapper} className="h-full w-full">
      <ReactFlow<GameNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => selectNode(n.id)}
        onPaneClick={() => selectNode(null)}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        colorMode={theme}
        fitView
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(var(--rf-dot))" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
