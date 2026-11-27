import ELK from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/react";
import type { Classifier } from "../types/uml";

const elk = new ELK();

export interface ElkLayoutOptions {
  direction?: "DOWN" | "RIGHT";
  nodeSpacing?: number;
  layerSpacing?: number;
}

/**
 * Estimates a UML classifier node's rendered width & height so ELKjs computes
 * completely non-overlapping positions.
 */
export function estimateClassifierSize(clf: Classifier): { width: number; height: number } {
  const headerHeight = clf.kind !== "class" || clf.is_abstract ? 56 : 42;
  const propsHeight = Math.max(clf.properties.length, 1) * 22 + 16;
  const opsHeight = Math.max(clf.operations.length, 1) * 22 + 16;
  const litsHeight = clf.kind === "enumeration" ? clf.literals.length * 22 + 16 : 0;

  const longestLine = Math.max(
    clf.name.length + 6,
    ...clf.properties.map((p) => p.name.length + 14),
    ...clf.operations.map((o) => o.name.length + o.params.length * 10 + 12),
    24
  );

  return {
    width: Math.min(Math.max(longestLine * 8 + 32, 230), 380),
    height:
      clf.kind === "enumeration"
        ? headerHeight + litsHeight + 24
        : headerHeight + propsHeight + opsHeight + 24,
  };
}

/**
 * Runs ELKjs Sugiyama layered auto-layout with orthogonal edge routing on XYFlow nodes & edges.
 */
export async function applyElkAutoLayout<N extends Node>(
  nodes: N[],
  edges: Edge[],
  classifiers: Record<string, Classifier>,
  options: ElkLayoutOptions = {}
): Promise<N[]> {
  if (nodes.length === 0) return nodes;

  const direction = options.direction ?? "DOWN";
  const nodeSpacing = options.nodeSpacing ?? 64;
  const layerSpacing = options.layerSpacing ?? 90;

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": String(nodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: nodes.map((n) => {
      const clf = classifiers[n.id];
      const size = clf ? estimateClassifierSize(clf) : { width: 250, height: 150 };
      return {
        id: n.id,
        width: size.width,
        height: size.height,
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const laidOut = await elk.layout(graph);
  const posMap = new Map<string, { x: number; y: number }>();
  for (const child of laidOut.children ?? []) {
    posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return nodes.map((node) => {
    const pos = posMap.get(node.id);
    return pos ? { ...node, position: pos } : node;
  });
}
