import React, { useCallback, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  Edge,
  MiniMap,
  Node,
  NodeChange,
  ReactFlow,
  ReactFlowInstance,
} from '@xyflow/react';
import { useProjectStore } from '../../store/useProjectStore';
import { UmlNode } from './UmlNode';
import { UmlEdge } from './UmlEdge';
import { COMMON_MULTIPLICITIES, RelationKind } from '../../model/schema';

const nodeTypes = { umlNode: UmlNode };
const edgeTypes = { umlEdge: UmlEdge };

export const UmlCanvas: React.FC = () => {
  const {
    project,
    activeDiagramId,
    selectedElementId,
    selectedRelationId,
    selectElement,
    selectRelation,
    updateNodePosition,
    addRelation,
    updateRelation,
    openContextMenu,
  } = useProjectStore();

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [quickLinkRelId, setQuickLinkRelId] = useState<string | null>(null);

  const diagram = project.diagrams[activeDiagramId];

  const nodes: Node[] = useMemo(() => {
    if (!diagram) return [];
    return diagram.nodes
      .map((pos) => {
        const el = project.elements[pos.elementId];
        if (!el) return null;
        return {
          id: el.id,
          type: 'umlNode',
          position: { x: pos.x, y: pos.y },
          selected: selectedElementId === el.id,
          data: { element: el },
        } as Node;
      })
      .filter((n): n is Node => n !== null);
  }, [diagram, project.elements, selectedElementId]);

  const edges: Edge[] = useMemo(() => {
    if (!diagram) return [];
    return diagram.relationIds
      .map((rid) => {
        const rel = project.relations[rid];
        if (!rel) return null;
        return {
          id: rel.id,
          type: 'umlEdge',
          source: rel.sourceId,
          target: rel.targetId,
          selected: selectedRelationId === rel.id,
          data: { relation: rel },
        } as Edge;
      })
      .filter((e): e is Edge => e !== null);
  }, [diagram, project.relations, selectedRelationId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) {
          updateNodePosition(ch.id, ch.position.x, ch.position.y);
        }
      }
    },
    [updateNodePosition]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      const newRelId = addRelation(conn.source, conn.target);
      setQuickLinkRelId(newRelId);
    },
    [addRelation]
  );

  const quickRel = quickLinkRelId ? project.relations[quickLinkRelId] : undefined;

  return (
    <div
      className="relative flex-1 h-full bg-slate-950"
      onContextMenu={(e) => {
        // Hard block native WebView context menu anywhere inside canvas container
        e.preventDefault();
      }}
    >
      {/* UML 2.5 SVG Marker Definitions */}
      <svg className="absolute w-0 h-0 pointer-events-none">
        <defs>
          <marker
            id="uml-triangle-hollow"
            viewBox="0 0 14 14"
            refX="13"
            refY="7"
            markerWidth="12"
            markerHeight="12"
            orient="auto"
          >
            <path d="M 1 1 L 13 7 L 1 13 Z" fill="#020617" stroke="#34d399" strokeWidth="1.6" />
          </marker>
          <marker
            id="uml-arrow-open"
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="10"
            markerHeight="10"
            orient="auto"
          >
            <path d="M 1 1 L 10 6 L 1 11" fill="none" stroke="#94a3b8" strokeWidth="1.6" />
          </marker>
          <marker
            id="uml-diamond-filled"
            viewBox="0 0 16 12"
            refX="1"
            refY="6"
            markerWidth="14"
            markerHeight="10"
            orient="auto"
          >
            <path d="M 1 6 L 8 1 L 15 6 L 8 11 Z" fill="#f59e0b" stroke="#f59e0b" strokeWidth="1.2" />
          </marker>
          <marker
            id="uml-diamond-hollow"
            viewBox="0 0 16 12"
            refX="1"
            refY="6"
            markerWidth="14"
            markerHeight="10"
            orient="auto"
          >
            <path d="M 1 6 L 8 1 L 15 6 L 8 11 Z" fill="#020617" stroke="#38bdf8" strokeWidth="1.5" />
          </marker>
        </defs>
      </svg>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={setRfInstance}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          selectElement(node.id);
          openContextMenu(null);
          setQuickLinkRelId(null);
        }}
        onEdgeClick={(_, edge) => {
          selectRelation(edge.id);
          openContextMenu(null);
        }}
        onPaneClick={() => {
          selectElement(null);
          selectRelation(null);
          openContextMenu(null);
          setQuickLinkRelId(null);
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          e.stopPropagation();
          selectElement(node.id);
          openContextMenu({
            x: e.clientX,
            y: e.clientY,
            targetType: 'node',
            targetId: node.id,
          });
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          e.stopPropagation();
          selectRelation(edge.id);
          openContextMenu({
            x: e.clientX,
            y: e.clientY,
            targetType: 'edge',
            targetId: edge.id,
          });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const flowPos = rfInstance
            ? rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
            : { x: 200, y: 150 };
          openContextMenu({
            x: e.clientX,
            y: e.clientY,
            targetType: 'canvas',
            canvasPosition: flowPos,
          });
        }}
        fitView
        minZoom={0.2}
        maxZoom={2.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
        <Controls />
        <MiniMap
          nodeColor="#4f46e5"
          maskColor="rgba(2, 6, 23, 0.7)"
        />
      </ReactFlow>

      {/* Visual Quick Relation & Cardinality Picker after drawing a link */}
      {quickRel && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-md border border-indigo-500/60 rounded-xl shadow-2xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-indigo-300">Lien créé :</span>
          <select
            value={quickRel.kind}
            onChange={(e) => updateRelation(quickRel.id, { kind: e.target.value as RelationKind })}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
          >
            <option value="directional_association">Association (--&gt;)</option>
            <option value="association">Association simple (--)</option>
            <option value="generalization">Héritage (--|&gt;)</option>
            <option value="realization">Implémentation (..|&gt;)</option>
            <option value="aggregation">Agrégation (o--)</option>
            <option value="composition">Composition (*--)</option>
            <option value="dependency">Dépendance (..&gt;)</option>
            <option value="transition">Transition</option>
            <option value="message">Message Séquence</option>
          </select>

          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <span>Cardinalité :</span>
            <select
              value={quickRel.sourceMultiplicity ?? ''}
              onChange={(e) => updateRelation(quickRel.id, { sourceMultiplicity: e.target.value })}
              className="bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs"
            >
              {COMMON_MULTIPLICITIES.map((m) => (
                <option key={`s_${m}`} value={m}>
                  {m || '—'}
                </option>
              ))}
            </select>
            <span>→</span>
            <select
              value={quickRel.targetMultiplicity ?? ''}
              onChange={(e) => updateRelation(quickRel.id, { targetMultiplicity: e.target.value })}
              className="bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs"
            >
              {COMMON_MULTIPLICITIES.map((m) => (
                <option key={`t_${m}`} value={m}>
                  {m || '—'}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setQuickLinkRelId(null)}
            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-md cursor-pointer"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
};
