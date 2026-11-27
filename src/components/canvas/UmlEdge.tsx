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

export interface UmlEdgeData extends Record<string, unknown> {
  relation: UmlRelation;
  diagramKind?: string;
  sourceCenterX?: number;
  targetCenterX?: number;
  messageIndex?: number;
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

  let edgePath = '';
  let labelX = 0;
  let labelY = 0;

  if (isSequenceMessage && rel) {
    const order = edgeData?.messageIndex ?? rel.sequenceOrder ?? 1;
    const msgY = SEQUENCE_LIFELINE_Y + SEQUENCE_MESSAGE_START_Y + (order - 1) * SEQUENCE_MESSAGE_STEP_Y;
    const sx = edgeData?.sourceCenterX ?? sourceX;
    const tx = edgeData?.targetCenterX ?? targetX;

    if (isSelfLoop || Math.abs(sx - tx) < 10) {
      // Self-call arrow on the right of the lifeline
      const loopW = 54;
      const loopH = 28;
      edgePath = `M ${sx} ${msgY} L ${sx + loopW} ${msgY} L ${sx + loopW} ${msgY + loopH} L ${sx} ${msgY + loopH}`;
      labelX = sx + loopW + 6;
      labelY = msgY + loopH / 2;
    } else {
      edgePath = `M ${sx} ${msgY} L ${tx} ${msgY}`;
      labelX = (sx + tx) / 2;
      labelY = msgY - 14;
    }
  } else if (isSelfLoop) {
    // Clean external reflexive loop for state transitions / self-associations
    const rX = sourceX + 20;
    const rY = sourceY - 16;
    edgePath = `M ${rX} ${rY} C ${rX + 68} ${rY - 58}, ${rX + 68} ${rY + 58}, ${rX} ${rY + 24}`;
    labelX = rX + 64;
    labelY = rY - 4;
  } else {
    const [p, lx, ly] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 12,
    });
    edgePath = p;
    labelX = lx;
    labelY = ly;
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
          strokeWidth: selected ? 2.5 : 1.75,
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
            }}
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium border cursor-pointer whitespace-nowrap ${
              selected
                ? 'bg-indigo-950 border-indigo-400 text-indigo-100'
                : 'bg-slate-900/95 border-slate-700 text-slate-200 hover:border-indigo-400'
            }`}
          >
            {isSequenceMessage && rel.sequenceOrder ? `${rel.sequenceOrder}. ` : ''}
            {centerText}
          </div>
        )}

        {!isSequenceMessage && rel.sourceMultiplicity && (
          <div
            onContextMenu={onCtx}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${srcBadgeX}px,${srcBadgeY}px)`,
              pointerEvents: 'all',
            }}
            className="px-1.5 py-0.2 rounded bg-slate-950/90 border border-slate-700/80 text-[10px] font-mono text-amber-300"
          >
            {rel.sourceMultiplicity}
          </div>
        )}

        {!isSequenceMessage && rel.targetMultiplicity && (
          <div
            onContextMenu={onCtx}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${tgtBadgeX}px,${tgtBadgeY}px)`,
              pointerEvents: 'all',
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
