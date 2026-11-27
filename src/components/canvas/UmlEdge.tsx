import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getSmoothStepPath,
} from '@xyflow/react';
import { UmlRelation } from '../../model/schema';
import { useProjectStore } from '../../store/useProjectStore';

export interface UmlEdgeData extends Record<string, unknown> {
  relation: UmlRelation;
}

export const UmlEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}) => {
  const rel = (data as UmlEdgeData)?.relation;
  const { selectRelation, openContextMenu } = useProjectStore();

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  if (!rel) return null;

  const isDashed =
    rel.kind === 'realization' ||
    rel.kind === 'dependency' ||
    rel.kind === 'include' ||
    rel.kind === 'extend';

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
    rel.kind === 'include' ? '«include»' : rel.kind === 'extend' ? '«extend»' : rel.stereotype ? `«${rel.stereotype}»` : '',
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
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium border cursor-pointer ${
              selected
                ? 'bg-indigo-950 border-indigo-400 text-indigo-100'
                : 'bg-slate-900/95 border-slate-700 text-slate-200 hover:border-indigo-400'
            }`}
          >
            {centerText}
          </div>
        )}

        {rel.sourceMultiplicity && (
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

        {rel.targetMultiplicity && (
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
