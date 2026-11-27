import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Connection,
  ConnectionMode,
  Controls,
  Edge,
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  ReactFlow,
  ReactFlowInstance,
} from '@xyflow/react';
import { useProjectStore } from '../../store/useProjectStore';
import { UmlNode } from './UmlNode';
import { UmlEdge } from './UmlEdge';
import { COMMON_MULTIPLICITIES, RelationKind, SequenceFragment } from '../../model/schema';
import {
  SEQUENCE_LIFELINE_Y,
  SEQUENCE_MESSAGE_START_Y,
  SEQUENCE_MESSAGE_STEP_Y,
} from '../../engines/layout/elkLayout';
import { CropRect } from '../../utils/pngExport';

/**
 * Visual background box for Sequence Combined Fragments (alt/else, opt, loop).
 */
const FragmentNode: React.FC<NodeProps> = ({ data }) => {
  const frag = (data as { fragment: SequenceFragment; width: number; height: number; elseOffsetY?: number });
  return (
    <div
      style={{ width: frag.width, height: frag.height }}
      className="relative rounded-lg border-2 border-indigo-400/60 bg-indigo-500/5 pointer-events-none"
    >
      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-indigo-600/85 text-white text-[10px] font-bold uppercase rounded-br-lg rounded-tl-md">
        <span>{frag.fragment.kind}</span>
        {frag.fragment.condition && (
          <span className="font-mono font-normal normal-case text-indigo-100">
            [{frag.fragment.condition}]
          </span>
        )}
      </div>
      {frag.elseOffsetY !== undefined && (
        <div
          style={{ top: frag.elseOffsetY }}
          className="absolute left-0 right-0 border-t-2 border-dashed border-indigo-400/60 px-2 pt-0.5"
        >
          <span className="text-[10px] font-mono text-indigo-300 bg-slate-900/90 px-1.5 rounded">
            else{frag.fragment.elseCondition ? ` [${frag.fragment.elseCondition}]` : ''}
          </span>
        </div>
      )}
    </div>
  );
};

const nodeTypes = { umlNode: UmlNode, fragmentNode: FragmentNode };
const edgeTypes = { umlEdge: UmlEdge };

export const UmlCanvas: React.FC = () => {
  const {
    project,
    activeDiagramId,
    selectedElementId,
    selectedRelationId,
    theme,
    pngCropMode,
    finishPngCrop,
    selectElement,
    selectRelation,
    updateNodePosition,
    addRelation,
    updateRelation,
    openContextMenu,
  } = useProjectStore();

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [quickLinkRelId, setQuickLinkRelId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Interactive PNG rectangular area selection state
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropCurrent, setCropCurrent] = useState<{ x: number; y: number } | null>(null);

  const diagram = project.diagrams[activeDiagramId];

  useEffect(() => {
    if (!rfInstance || !diagram || diagram.nodes.length === 0) return;
    const t = setTimeout(() => {
      rfInstance.fitView({ padding: 0.22, duration: 250 });
    }, 50);
    return () => clearTimeout(t);
  }, [rfInstance, activeDiagramId, diagram?.nodes.length]);

  const nodes: Node[] = useMemo(() => {
    if (!diagram) return [];

    const result: Node[] = [];

    // Add background combined fragment frames for sequence diagrams
    if (diagram.kind === 'sequence' && diagram.fragments && diagram.fragments.length > 0) {
      const xs = diagram.nodes.map((n) => n.x);
      const minX = xs.length > 0 ? Math.min(...xs) - 24 : 36;
      const maxX = xs.length > 0 ? Math.max(...xs) + 194 : 600;
      const width = Math.max(300, maxX - minX);

      for (const frag of diagram.fragments) {
        const topY =
          SEQUENCE_LIFELINE_Y +
          SEQUENCE_MESSAGE_START_Y +
          (frag.startOrder - 1) * SEQUENCE_MESSAGE_STEP_Y -
          32;
        const bottomY =
          SEQUENCE_LIFELINE_Y +
          SEQUENCE_MESSAGE_START_Y +
          (frag.endOrder - 1) * SEQUENCE_MESSAGE_STEP_Y +
          28;
        const height = Math.max(76, bottomY - topY);
        const elseOffsetY =
          frag.elseStartOrder !== undefined
            ? SEQUENCE_LIFELINE_Y +
              SEQUENCE_MESSAGE_START_Y +
              (frag.elseStartOrder - 1) * SEQUENCE_MESSAGE_STEP_Y -
              24 -
              topY
            : undefined;

        result.push({
          id: frag.id,
          type: 'fragmentNode',
          position: { x: minX, y: topY },
          draggable: false,
          selectable: false,
          zIndex: -1,
          data: { fragment: frag, width, height, elseOffsetY },
        });
      }
    }

    for (const pos of diagram.nodes) {
      const el = project.elements[pos.elementId];
      if (!el) continue;
      result.push({
        id: el.id,
        type: 'umlNode',
        position: { x: pos.x, y: pos.y },
        selected: selectedElementId === el.id,
        data: {
          element: el,
          diagramKind: diagram.kind,
          lifelineHeight: pos.height,
        },
      });
    }

    return result;
  }, [diagram, project.elements, selectedElementId]);

  const edges: Edge[] = useMemo(() => {
    if (!diagram) return [];
    const posMap = new Map(diagram.nodes.map((n) => [n.elementId, n]));
    const orderedRels = diagram.relationIds
      .map((rid) => project.relations[rid])
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    if (diagram.kind === 'sequence') {
      orderedRels.sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0));
    }

    // Group non-sequence edges by unordered node pair for parallel lane separation
    const pairGroups = new Map<string, string[]>();
    const selfLoopGroups = new Map<string, string[]>();
    for (const rel of orderedRels) {
      if (rel.sourceId === rel.targetId) {
        const list = selfLoopGroups.get(rel.sourceId) ?? [];
        list.push(rel.id);
        selfLoopGroups.set(rel.sourceId, list);
      } else {
        const pairKey =
          rel.sourceId < rel.targetId
            ? `${rel.sourceId}::${rel.targetId}`
            : `${rel.targetId}::${rel.sourceId}`;
        const list = pairGroups.get(pairKey) ?? [];
        list.push(rel.id);
        pairGroups.set(pairKey, list);
      }
    }

    return orderedRels.map((rel, idx) => {
      const srcPos = posMap.get(rel.sourceId);
      const tgtPos = posMap.get(rel.targetId);
      const isSelf = rel.sourceId === rel.targetId;

      let sourceHandle: string | undefined;
      let targetHandle: string | undefined;

      if (diagram.kind !== 'sequence') {
        if (isSelf) {
          sourceHandle = 'bottom';
          targetHandle = 'bottom';
        } else if (srcPos && tgtPos) {
          const dx = tgtPos.x - srcPos.x;
          const dy = tgtPos.y - srcPos.y;
          if (Math.abs(dx) >= Math.abs(dy)) {
            sourceHandle = dx >= 0 ? 'right' : 'left';
            targetHandle = dx >= 0 ? 'left' : 'right';
          } else {
            sourceHandle = dy >= 0 ? 'bottom' : 'top';
            targetHandle = dy >= 0 ? 'top' : 'bottom';
          }
        }
      }

      const pairKey =
        rel.sourceId < rel.targetId
          ? `${rel.sourceId}::${rel.targetId}`
          : `${rel.targetId}::${rel.sourceId}`;
      const siblings = isSelf ? [] : pairGroups.get(pairKey) ?? [rel.id];
      const selfSiblings = isSelf ? selfLoopGroups.get(rel.sourceId) ?? [rel.id] : [];

      return {
        id: rel.id,
        type: 'umlEdge',
        source: rel.sourceId,
        target: rel.targetId,
        sourceHandle,
        targetHandle,
        selected: selectedRelationId === rel.id,
        data: {
          relation: rel,
          diagramKind: diagram.kind,
          sourceCenterX: srcPos ? srcPos.x + (srcPos.width ?? 170) / 2 : undefined,
          targetCenterX: tgtPos ? tgtPos.x + (tgtPos.width ?? 170) / 2 : undefined,
          messageIndex: rel.sequenceOrder ?? idx + 1,
          parallelIndex: siblings.indexOf(rel.id),
          parallelCount: siblings.length,
          selfLoopIndex: selfSiblings.indexOf(rel.id),
        },
      } as Edge;
    });
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
      if (!conn.source || !conn.target) return;
      const newRelId = addRelation(conn.source, conn.target);
      setQuickLinkRelId(newRelId);
    },
    [addRelation]
  );

  const quickRel = quickLinkRelId ? project.relations[quickLinkRelId] : undefined;

  const activeCropBox: CropRect | null =
    cropStart && cropCurrent
      ? {
          x: Math.min(cropStart.x, cropCurrent.x),
          y: Math.min(cropStart.y, cropCurrent.y),
          width: Math.abs(cropCurrent.x - cropStart.x),
          height: Math.abs(cropCurrent.y - cropStart.y),
        }
      : null;

  return (
    <div
      id="bouml-canvas-capture-root"
      ref={containerRef}
      className="relative flex-1 h-full bg-slate-950"
      onContextMenu={(e) => {
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
            <path
              d="M 1 1 L 13 7 L 1 13 Z"
              fill={theme === 'light' ? '#f8fafc' : '#020617'}
              stroke="#34d399"
              strokeWidth="1.6"
            />
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
            <path
              d="M 1 6 L 8 1 L 15 6 L 8 11 Z"
              fill={theme === 'light' ? '#f8fafc' : '#020617'}
              stroke="#38bdf8"
              strokeWidth="1.5"
            />
          </marker>
        </defs>
      </svg>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        onInit={setRfInstance}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          if (node.type === 'fragmentNode') return;
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
          if (node.type === 'fragmentNode') return;
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
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={theme === 'light' ? '#cbd5e1' : '#1e293b'}
        />
        <Controls />
        <MiniMap
          nodeColor="#4f46e5"
          maskColor={theme === 'light' ? 'rgba(241, 245, 249, 0.7)' : 'rgba(2, 6, 23, 0.7)'}
        />
      </ReactFlow>

      {/* Interactive PNG Area Crop Selection Overlay */}
      {pngCropMode && (
        <div
          data-export-ignore="true"
          className="absolute inset-0 z-40 cursor-crosshair bg-slate-950/35"
          onMouseDown={(e) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            setCropStart(pt);
            setCropCurrent(pt);
          }}
          onMouseMove={(e) => {
            if (!cropStart) return;
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            setCropCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }}
          onMouseUp={() => {
            const finalBox = activeCropBox;
            setCropStart(null);
            setCropCurrent(null);
            if (finalBox && finalBox.width >= 16 && finalBox.height >= 16) {
              finishPngCrop(finalBox);
            }
          }}
        >
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-900 border border-indigo-500 rounded-xl px-4 py-2 shadow-xl flex items-center gap-3 text-xs text-white">
            <span>Glissez la souris pour tracer la zone à exporter en PNG</span>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                setCropStart(null);
                setCropCurrent(null);
                finishPngCrop(null);
              }}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              Annuler
            </button>
          </div>

          {activeCropBox && (
            <div
              style={{
                left: activeCropBox.x,
                top: activeCropBox.y,
                width: activeCropBox.width,
                height: activeCropBox.height,
              }}
              className="absolute border-2 border-indigo-400 bg-indigo-500/20 pointer-events-none"
            />
          )}
        </div>
      )}

      {/* Visual Quick Relation & Cardinality Picker after drawing a link */}
      {quickRel && (
        <div
          data-export-ignore="true"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-md border border-indigo-500/60 rounded-xl shadow-2xl px-4 py-3 flex flex-wrap items-center gap-3"
        >
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
            <option value="include">Include (..&gt; «include»)</option>
            <option value="extend">Extend (..&gt; «extend»)</option>
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
