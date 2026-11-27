import ELK, { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { BoumlProject, DiagramNodePosition } from '../../model/schema';

const elk = new ELK();

export function estimateNodeSize(
  project: BoumlProject,
  elementId: string
): { width: number; height: number } {
  const el = project.elements[elementId];
  if (!el) return { width: 220, height: 120 };

  if (el.kind === 'pseudostate') return { width: 44, height: 44 };
  if (el.kind === 'actor') return { width: 120, height: 110 };
  if (el.kind === 'usecase') return { width: 190, height: 74 };
  if (el.kind === 'state') {
    const extras = [el.stateEntry, el.stateDo, el.stateExit].filter(Boolean).length;
    return { width: 190, height: 64 + extras * 20 };
  }

  const memberCount =
    el.attributes.length + el.operations.length + (el.enumLiterals?.length ?? 0);
  const longestText = Math.max(
    el.name.length,
    ...el.attributes.map((a) => `${a.name}: ${a.type}`.length),
    ...el.operations.map(
      (o) =>
        `${o.name}(${o.parameters.map((p) => `${p.name}: ${p.type}`).join(', ')}): ${o.returnType}`.length
    ),
    ...(el.enumLiterals ?? []).map((l) => l.length)
  );

  const width = Math.min(380, Math.max(220, longestText * 7.2 + 48));
  const height = Math.max(96, 68 + memberCount * 22);
  return { width, height };
}

export async function computeElkLayout(
  project: BoumlProject,
  diagramId: string,
  direction: 'DOWN' | 'RIGHT' | 'UP' | 'LEFT' = 'DOWN'
): Promise<DiagramNodePosition[]> {
  const diagram = project.diagrams[diagramId];
  if (!diagram) return [];

  const nodeIds = new Set(diagram.nodes.map((n) => n.elementId));

  const graph: ElkNode = {
    id: diagram.id,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '64',
      'elk.layered.spacing.nodeNodeBetweenLayers': '88',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    },
    children: diagram.nodes.map((n) => {
      const size = estimateNodeSize(project, n.elementId);
      return {
        id: n.elementId,
        width: n.width ?? size.width,
        height: n.height ?? size.height,
      };
    }),
    edges: diagram.relationIds
      .map((rid) => project.relations[rid])
      .filter((r) => r && nodeIds.has(r.sourceId) && nodeIds.has(r.targetId))
      .map((r) => ({
        id: r.id,
        sources: [r.sourceId],
        targets: [r.targetId],
      })),
  };

  const laidOut = await elk.layout(graph);
  return (laidOut.children ?? []).map((child) => ({
    elementId: child.id,
    x: Math.round(child.x ?? 0),
    y: Math.round(child.y ?? 0),
    width: child.width,
    height: child.height,
  }));
}
