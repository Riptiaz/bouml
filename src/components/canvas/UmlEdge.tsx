import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
} from '@xyflow/react';
import { UmlRelation } from '../../model/schema';
import { useProjectStore } from '../../store/useProjectStore';
import {
  SEQUENCE_LIFELINE_Y,
  SEQUENCE_MESSAGE_START_Y,
  SEQUENCE_MESSAGE_STEP_Y,
} from '../../engines/layout/elkLayout';

export interface ObstacleBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UmlEdgeData extends Record<string, unknown> {
  relation: UmlRelation;
  diagramKind?: string;
  sourceCenterX?: number;
  targetCenterX?: number;
  messageIndex?: number;
  parallelIndex?: number;
  parallelCount?: number;
  selfLoopIndex?: number;
  obstacleBoxes?: ObstacleBox[];
}

function findBlockingObstacles(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sourceId: string,
  targetId: string,
  obstacles: ObstacleBox[]
): ObstacleBox[] {
  const minX = Math.min(sx, tx) + 8;
  const maxX = Math.max(sx, tx) - 8;
  const minY = Math.min(sy, ty) - 18;
  const maxY = Math.max(sy, ty) + 18;

  return obstacles.filter((obs) => {
    if (obs.id === sourceId || obs.id === targetId) return false;
    const obsRight = obs.x + obs.width;
    const obsBottom = obs.y + obs.height;
    return obsRight > minX && obs.x < maxX && obsBottom > minY && obs.y < maxY;
  });
}

export const UmlEdge: React.FC<EdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}) => {
  const edgeData = data as UmlEdgeData | undefined;
  const rel = edgeData?.relation;
  const { selectRelation, openContextMenu } = useProjectStore();

  const isSequenceMessage = edgeData?.diagramKind === 'sequence' && rel?.kind === 'message';
  const isSelfLoop = source === target;
  const parallelIndex = edgeData?.parallelIndex ?? 0;
  const parallelCount = edgeData?.parallelCount ?? 1;
  const selfLoopIndex = edgeData?.selfLoopIndex ?? 0;
  const obstacles = edgeData?.obstacleBoxes ?? [];

  let edgePath = '';
  let labelX = 0;
  let labelY = 0;

  if (isSequenceMessage && rel) {
    const order = edgeData?.messageIndex ?? rel.sequenceOrder ?? 1;
    const msgY =
      SEQUENCE_LIFELINE_Y + SEQUENCE_MESSAGE_START_Y + (order - 1) * SEQUENCE_MESSAGE_STEP_Y;
    const sx = edgeData?.sourceCenterX ?? sourceX;
    const tx = edgeData?.targetCenterX ?? targetX;

    if (isSelfLoop || Math.abs(sx - tx) < 10) {
      const loopW = 68;
      const loopH = 30;
      edgePath = `M ${sx} ${msgY} L ${sx + loopW} ${msgY} L ${sx + loopW} ${msgY + loopH} L ${sx} ${msgY + loopH}`;
      labelX = sx + loopW + 10;
      labelY = msgY + loopH / 2;
    } else {
      edgePath = `M ${sx} ${msgY} L ${tx} ${msgY}`;
      labelX = (sx + tx) / 2;
      labelY = msgY - 16;
    }
  } else if (isSelfLoop) {
    // Route self-loops strictly OUTSIDE below the bottom handle so they are NEVER hidden behind the node
    const drop = 56 + selfLoopIndex * 42;
    const spread = 44 + selfLoopIndex * 18;
    const startX = sourceX - 14;
    const endX = sourceX + 18;
    edgePath = `M ${startX} ${sourceY} C ${startX - spread} ${sourceY + drop}, ${endX + spread} ${sourceY + drop}, ${endX} ${sourceY + 2}`;
    labelX = sourceX + 2;
    labelY = sourceY + drop + 12;
  } else {
    const blockers = findBlockingObstacles(
      sourceX,
      sourceY,
      targetX,
      targetY,
      source,
      target,
      obstacles
    );

    if (blockers.length > 0) {
      // Detour cleanly ABOVE or BELOW all blocking nodes with generous 44px clearance margin
      const minObsTop = Math.min(...blockers.map((b) => b.y));
      const maxObsBottom = Math.max(...blockers.map((b) => b.y + b.height));
      const avgY = (sourceY + targetY) / 2;
      const distAbove = Math.abs(avgY - (minObsTop - 44));
      const distBelow = Math.abs(avgY - (maxObsBottom + 44));
      const extraLane = parallelCount > 1 ? (parallelIndex - (parallelCount - 1) / 2) * 32 : 0;
      const detourY =
        distAbove <= distBelow
          ? minObsTop - 48 - Math.abs(extraLane)
          : maxObsBottom + 48 + Math.abs(extraLane);

      const exitX = sourceX + (targetX >= sourceX ? 24 : -24);
      const enterX = targetX + (targetX >= sourceX ? -24 : 24);
      edgePath = `M ${sourceX} ${sourceY} L ${exitX} ${sourceY} L ${exitX} ${detourY} L ${enterX} ${detourY} L ${enterX} ${targetY} L ${targetX} ${targetY}`;
      labelX = (exitX + enterX) / 2;
      labelY = detourY;
    } else if (parallelCount > 1) {
      // Separate parallel / bidirectional edges cleanly with distinct curved lanes & non-overlapping labels
      const laneOffset = (parallelIndex - (parallelCount - 1) / 2) * 56;
      const dx = targetX - sourceX;
      const dy = targetY - sourceY;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const midX = (sourceX + targetX) / 2 + nx * laneOffset;
      const midY = (sourceY + targetY) / 2 + ny * laneOffset;

      edgePath = `M ${sourceX} ${sourceY} Q ${midX} ${midY} ${targetX} ${targetY}`;
      labelX = 0.25 * sourceX + 0.5 * midX + 0.25 * targetX;
      labelY = 0.25 * sourceY + 0.5 * midY + 0.25 * targetY;
    } else {
      const [p, lx, ly] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 14,
        offset: 32,
      });
      edgePath = p;
      labelX = lx;
      labelY = ly;
    }
  }

  if (!rel) return null;

  const isDashed =
    rel.kind === 'realization' ||
    rel.kind === 'dependency' ||
    rel.kind === 'include' ||
    rel.kind === 'extend' ||
    (rel.kind === 'message' && rel.messageKind === 'return');

  const strokeColor = selected
    ? '#818cf8'
    : rel.kind === 'generalization' || rel.kind === 'realization'
      ? '#34d399'
      : rel.kind === 'composition'
        ? '#f59e0b'
        : rel.kind === 'aggregation'
          ? '#38bdf8'
          : rel.kind === 'transition'
            ? '#c084fc'
            : rel.kind === 'message'
              ? '#60a5fa'
              : '#94a3b8';

  const markerEnd =
    rel.kind === 'generalization' || rel.kind === 'realization'
      ? 'url(#uml-triangle-hollow)'
      : rel.kind === 'association'
        ? undefined
        : 'url(#uml-arrow-open)';

  const markerStart =
    rel.kind === 'composition'
      ? 'url(#uml-diamond-filled)'
      : rel.kind === 'aggregation'
        ? 'url(#uml-diamond-hollow)'
        : undefined;

  const centerText = [
    rel.kind === 'include'
      ? '«include»'
      : rel.kind === 'extend'
        ? '«extend»'
        : rel.stereotype
          ? `«${rel.stereotype}»`
          : '',
    rel.trigger,
    rel.guard ? `[${rel.guard}]` : '',
    rel.label || rel.targetRole,
  ]
    .filter(Boolean)
    .join(' ');

  const srcBadgeX = sourceX + (targetX - sourceX) * 0.16;
  const srcBadgeY = sourceY + (targetY - sourceY) * 0.16;
  const tgtBadgeX = targetX - (targetX - sourceX) * 0.16;
  const tgtBadgeY = targetY - (targetY - sourceY) * 0.16;

  const onCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selectRelation(rel.id);
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetType: 'edge',
      targetId: rel.id,
    });
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{
          stroke: strokeColor,
          strokeWidth: selected ? 2.5 : 1.85,
          strokeDasharray: isDashed ? '6 4' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        {centerText && (
          <div
            onClick={() => selectRelation(rel.id)}
            onContextMenu={onCtx}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 30,
            }}
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium border shadow-sm cursor-pointer whitespace-nowrap ${
              selected
                ? 'bg-indigo-950 border-indigo-400 text-indigo-100'
                : 'bg-slate-900/95 border-slate-700 text-slate-200 hover:border-indigo-400'
            }`}
          >
            {isSequenceMessage && rel.sequenceOrder ? `${rel.sequenceOrder}. ` : ''}
            {centerText}
          </div>
        )}

        {!isSequenceMessage && !isSelfLoop && rel.sourceMultiplicity && (
          <div
            onContextMenu={onCtx}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${srcBadgeX}px,${srcBadgeY}px)`,
              pointerEvents: 'all',
              zIndex: 25,
            }}
            className="px-1.5 py-0.2 rounded bg-slate-950/90 border border-slate-700/80 text-[10px] font-mono text-amber-300"
          >
            {rel.sourceMultiplicity}
          </div>
        )}

        {!isSequenceMessage && !isSelfLoop && rel.targetMultiplicity && (
          <div
            onContextMenu={onCtx}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${tgtBadgeX}px,${tgtBadgeY}px)`,
              pointerEvents: 'all',
              zIndex: 25,
            }}
            className="px-1.5 py-0.2 rounded bg-slate-950/90 border border-slate-700/80 text-[10px] font-mono text-amber-300"
          >
            {rel.targetMultiplicity}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
};
