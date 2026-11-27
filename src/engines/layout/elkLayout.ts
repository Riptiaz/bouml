import ELK, { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { BoumlProject, DiagramNodePosition } from '../../model/schema';

const elk = new ELK();

export const SEQUENCE_LIFELINE_Y = 40;
export const SEQUENCE_LIFELINE_GAP_X = 310;
export const SEQUENCE_MESSAGE_START_Y = 132;
export const SEQUENCE_MESSAGE_STEP_Y = 66;

export function estimateNodeSize(
  project: BoumlProject,
  elementId: string
): { width: number; height: number } {
  const el = project.elements[elementId];
  if (!el) return { width: 220, height: 120 };

  if (el.kind === 'pseudostate') return { width: 44, height: 44 };
  if (el.kind === 'actor') return { width: 120, height: 110 };
  if (el.kind === 'usecase') return { width: 190, height: 74 };
  if (el.kind === 'lifeline') return { width: 170, height: 64 };
  if (el.kind === 'state') {
    const extras = [el.stateEntry, el.stateDo, el.stateExit].filter(Boolean).length;
    return { width: 200, height: 70 + extras * 22 };
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

/**
 * Dedicated Sequence Diagram Lifeline Layout:
 * Aligns all participants/actors horizontally along the top row (y = SEQUENCE_LIFELINE_Y),
 * spaced evenly on X, with vertical lifeline height sized to fit all chronological messages.
 */
function computeSequenceLayout(
  project: BoumlProject,
  diagramId: string
): DiagramNodePosition[] {
  const diagram = project.diagrams[diagramId];
  if (!diagram) return [];

  const msgCount = diagram.relationIds
    .map((rid) => project.relations[rid])
    .filter((r) => Boolean(r && r.kind === 'message')).length;

  const lifelineHeight = Math.max(
    320,
    SEQUENCE_MESSAGE_START_Y + Math.max(1, msgCount) * SEQUENCE_MESSAGE_STEP_Y + 80
  );

  // Order actors first, then lifelines/participants in declaration order
  const sortedNodes = [...diagram.nodes].sort((a, b) => {
    const elA = project.elements[a.elementId];
    const elB = project.elements[b.elementId];
    const aActor = elA?.kind === 'actor' ? 0 : 1;
    const bActor = elB?.kind === 'actor' ? 0 : 1;
    return aActor - bActor;
  });

  return sortedNodes.map((n, idx) => ({
    elementId: n.elementId,
    x: 60 + idx * SEQUENCE_LIFELINE_GAP_X,
    y: SEQUENCE_LIFELINE_Y,
    width: 170,
    height: lifelineHeight,
  }));
}

/**
 * Improved State Diagram Layout:
 * Uses generous node/layer/edge spacing so transition labels and self-loops never collide,
 * and separates multiple composite state machines (stateGroup) cleanly side-by-side.
 */
async function computeStateLayout(
  project: BoumlProject,
  diagramId: string,
  direction: 'DOWN' | 'RIGHT' | 'UP' | 'LEFT'
): Promise<DiagramNodePosition[]> {
  const diagram = project.diagrams[diagramId];
  if (!diagram) return [];

  const groups = new Map<string, typeof diagram.nodes>();
  for (const n of diagram.nodes) {
    const el = project.elements[n.elementId];
    const key = el?.stateGroup ?? '__default__';
    const list = groups.get(key) ?? [];
    list.push(n);
    groups.set(key, list);
  }

  const results: DiagramNodePosition[] = [];
  let offsetY = 40;

  for (const [, groupNodes] of groups.entries()) {
    const nodeIds = new Set(groupNodes.map((n) => n.elementId));
    // Exclude self-loops from ELK edges (handled visually by UmlEdge) so ELK doesn't distort rank spacing
    const groupEdges = diagram.relationIds
      .map((rid) => project.relations[rid])
      .filter(
        (r) =>
          r &&
          r.sourceId !== r.targetId &&
          nodeIds.has(r.sourceId) &&
          nodeIds.has(r.targetId)
      );

    const graph: ElkNode = {
      id: `${diagram.id}_grp`,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        'elk.spacing.nodeNode': '96',
        'elk.layered.spacing.nodeNodeBetweenLayers': '136',
        'elk.spacing.edgeNode': '48',
        'elk.spacing.edgeEdge': '36',
        'elk.layered.spacing.edgeNodeBetweenLayers': '48',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      },
      children: groupNodes.map((n) => {
        const size = estimateNodeSize(project, n.elementId);
        return {
          id: n.elementId,
          width: n.width ?? size.width,
          height: n.height ?? size.height,
        };
      }),
      edges: groupEdges.map((r) => ({
        id: r.id,
        sources: [r.sourceId],
        targets: [r.targetId],
      })),
    };

    const laidOut = await elk.layout(graph);
    let maxBottom = 0;
    for (const child of laidOut.children ?? []) {
      const y = Math.round((child.y ?? 0) + offsetY);
      const h = child.height ?? 80;
      maxBottom = Math.max(maxBottom, y + h);
      results.push({
        elementId: child.id,
        x: Math.round((child.x ?? 0) + 40),
        y,
        width: child.width,
        height: child.height,
      });
    }
    offsetY = maxBottom + 120;
  }

  return results;
}

export async function computeElkLayout(
  project: BoumlProject,
  diagramId: string,
  direction: 'DOWN' | 'RIGHT' | 'UP' | 'LEFT' = 'DOWN'
): Promise<DiagramNodePosition[]> {
  const diagram = project.diagrams[diagramId];
  if (!diagram) return [];

  if (diagram.kind === 'sequence') {
    return computeSequenceLayout(project, diagramId);
  }

  if (diagram.kind === 'state') {
    return computeStateLayout(project, diagramId, direction);
  }

  // Class, UseCase, Component, Deployment, Activity, Object: preserve existing proven ELK layout
  const nodeIds = new Set(diagram.nodes.map((n) => n.elementId));

  const graph: ElkNode = {
    id: diagram.id,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '110',
      'elk.layered.spacing.nodeNodeBetweenLayers': '140',
      'elk.spacing.edgeNode': '56',
      'elk.spacing.edgeEdge': '42',
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
