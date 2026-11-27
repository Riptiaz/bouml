import {
  BoumlProject,
  createId,
  UmlDiagram,
  UmlElement,
  UmlOperation,
  UmlRelation,
  ValidationIssue,
} from './schema';
import { validateProject } from './validator';

/**
 * Removes elements and relations that are not referenced by any diagram in the project
 * (useful after AI edits or manual deletions to avoid orphan duplicates).
 */
export function cleanupOrphanElements(project: BoumlProject): {
  project: BoumlProject;
  removedCount: number;
} {
  const usedElementIds = new Set<string>();
  const usedRelationIds = new Set<string>();

  for (const diag of Object.values(project.diagrams)) {
    for (const n of diag.nodes) usedElementIds.add(n.elementId);
    for (const rid of diag.relationIds) usedRelationIds.add(rid);
  }

  let removedCount = 0;
  const nextElements: Record<string, UmlElement> = {};
  for (const [id, el] of Object.entries(project.elements)) {
    if (usedElementIds.has(id)) {
      nextElements[id] = el;
    } else {
      removedCount++;
    }
  }

  const nextRelations: Record<string, UmlRelation> = {};
  for (const [id, rel] of Object.entries(project.relations)) {
    if (
      usedRelationIds.has(id) &&
      nextElements[rel.sourceId] &&
      nextElements[rel.targetId]
    ) {
      nextRelations[id] = rel;
    } else {
      removedCount++;
    }
  }

  const nextDiagrams: Record<string, UmlDiagram> = {};
  for (const [did, d] of Object.entries(project.diagrams)) {
    nextDiagrams[did] = {
      ...d,
      nodes: d.nodes.filter((n) => Boolean(nextElements[n.elementId])),
      relationIds: d.relationIds.filter((rid) => Boolean(nextRelations[rid])),
    };
  }

  return {
    project: {
      ...project,
      elements: nextElements,
      relations: nextRelations,
      diagrams: nextDiagrams,
    },
    removedCount,
  };
}

function countDiagramRefs(project: BoumlProject, elementId: string): number {
  let count = 0;
  for (const d of Object.values(project.diagrams)) {
    if (d.nodes.some((n) => n.elementId === elementId)) count++;
  }
  return count;
}

/**
 * Automatically fixes a single UML ValidationIssue based on its error code.
 */
export function fixValidationIssue(
  project: BoumlProject,
  issue: ValidationIssue
): { project: BoumlProject; fixed: boolean; summary: string } {
  // UML-001: Duplicate element name in same package -> remove unused duplicate or merge into primary
  if (issue.code === 'UML-001' && issue.elementId) {
    const dupEl = project.elements[issue.elementId];
    if (!dupEl) return { project, fixed: false, summary: 'Élément introuvable.' };

    const matching = Object.values(project.elements).filter(
      (e) =>
        e.packageId === dupEl.packageId &&
        e.kind === dupEl.kind &&
        e.name.toLowerCase() === dupEl.name.toLowerCase()
    );

    if (matching.length < 2) {
      return { project, fixed: false, summary: 'Doublon déjà résolu.' };
    }

    // Pick best keeper: most diagram references, then most members (attributes + operations)
    const sorted = [...matching].sort((a, b) => {
      const refDiff = countDiagramRefs(project, b.id) - countDiagramRefs(project, a.id);
      if (refDiff !== 0) return refDiff;
      return (
        b.attributes.length + b.operations.length - (a.attributes.length + a.operations.length)
      );
    });

    const keeper = sorted[0];
    const toRemoveIds = new Set(sorted.slice(1).map((e) => e.id));

    const nextElements: Record<string, UmlElement> = {};
    for (const [id, el] of Object.entries(project.elements)) {
      if (!toRemoveIds.has(id)) nextElements[id] = el;
    }

    // Rewire relations pointing to removed duplicates -> keeper
    const nextRelations: Record<string, UmlRelation> = {};
    for (const [rid, rel] of Object.entries(project.relations)) {
      const src = toRemoveIds.has(rel.sourceId) ? keeper.id : rel.sourceId;
      const tgt = toRemoveIds.has(rel.targetId) ? keeper.id : rel.targetId;
      if (nextElements[src] && nextElements[tgt]) {
        nextRelations[rid] = { ...rel, sourceId: src, targetId: tgt };
      }
    }

    // Update diagram nodes (deduplicating keeper if already present)
    const nextDiagrams: Record<string, UmlDiagram> = {};
    for (const [did, d] of Object.entries(project.diagrams)) {
      const seen = new Set<string>();
      const nextNodes = [];
      for (const n of d.nodes) {
        const mappedId = toRemoveIds.has(n.elementId) ? keeper.id : n.elementId;
        if (!nextElements[mappedId] || seen.has(mappedId)) continue;
        seen.add(mappedId);
        nextNodes.push({ ...n, elementId: mappedId });
      }
      nextDiagrams[did] = {
        ...d,
        nodes: nextNodes,
        relationIds: d.relationIds.filter((rid) => Boolean(nextRelations[rid])),
      };
    }

    return {
      project: {
        ...project,
        elements: nextElements,
        relations: nextRelations,
        diagrams: nextDiagrams,
      },
      fixed: true,
      summary: `${toRemoveIds.size} doublon(s) de « ${keeper.name} » supprimé(s) et fusionné(s).`,
    };
  }

  // UML-002: Inheritance cycle -> remove the cyclic generalization on this element
  if (issue.code === 'UML-002' && issue.elementId) {
    const cyclicRel = Object.values(project.relations).find(
      (r) => r.kind === 'generalization' && r.sourceId === issue.elementId
    );
    if (!cyclicRel) return { project, fixed: false, summary: 'Aucune relation cyclique trouvée.' };
    const { [cyclicRel.id]: _, ...restRels } = project.relations;
    const nextDiagrams: Record<string, UmlDiagram> = {};
    for (const [did, d] of Object.entries(project.diagrams)) {
      nextDiagrams[did] = {
        ...d,
        relationIds: d.relationIds.filter((rid) => rid !== cyclicRel.id),
      };
    }
    return {
      project: { ...project, relations: restRels, diagrams: nextDiagrams },
      fixed: true,
      summary: 'Cycle d\'héritage rompu.',
    };
  }

  // UML-003: Unimplemented interface operations -> auto-implement missing methods
  if (issue.code === 'UML-003' && issue.elementId) {
    const el = project.elements[issue.elementId];
    if (!el) return { project, fixed: false, summary: 'Classe introuvable.' };
    const existingNames = new Set(el.operations.map((o) => o.name));
    const additions: UmlOperation[] = [];
    for (const rel of Object.values(project.relations)) {
      if (rel.sourceId === el.id && (rel.kind === 'realization' || rel.kind === 'generalization')) {
        const parent = project.elements[rel.targetId];
        if (!parent) continue;
        for (const op of parent.operations) {
          if ((op.isAbstract || parent.kind === 'interface') && !existingNames.has(op.name)) {
            existingNames.add(op.name);
            additions.push({
              ...op,
              id: createId('op'),
              isAbstract: false,
              parameters: op.parameters.map((p) => ({ ...p, id: createId('p') })),
            });
          }
        }
      }
    }
    if (additions.length === 0) return { project, fixed: false, summary: 'Déjà implémenté.' };
    return {
      project: {
        ...project,
        elements: {
          ...project.elements,
          [el.id]: { ...el, operations: [...el.operations, ...additions] },
        },
      },
      fixed: true,
      summary: `${additions.length} méthode(s) d'interface implémentée(s) dans « ${el.name} ».`,
    };
  }

  // UML-004: Dangling relation -> delete orphan relation
  if (issue.code === 'UML-004' && issue.relationId) {
    const { [issue.relationId]: _, ...restRels } = project.relations;
    const nextDiagrams: Record<string, UmlDiagram> = {};
    for (const [did, d] of Object.entries(project.diagrams)) {
      nextDiagrams[did] = {
        ...d,
        relationIds: d.relationIds.filter((rid) => rid !== issue.relationId),
      };
    }
    return {
      project: { ...project, relations: restRels, diagrams: nextDiagrams },
      fixed: true,
      summary: 'Relation orpheline supprimée.',
    };
  }

  // UML-005: Abstract methods inside concrete class -> mark class abstract
  if (issue.code === 'UML-005' && issue.elementId) {
    const el = project.elements[issue.elementId];
    if (!el) return { project, fixed: false, summary: 'Classe introuvable.' };
    return {
      project: {
        ...project,
        elements: {
          ...project.elements,
          [el.id]: { ...el, kind: 'abstract_class', isAbstract: true },
        },
      },
      fixed: true,
      summary: `Classe « ${el.name} » marquée comme abstraite.`,
    };
  }

  return { project, fixed: false, summary: 'Correction manuelle ou IA requise.' };
}

/**
 * Runs orphan cleanup + fixes all auto-fixable UML validation issues in one pass.
 */
export function fixAllValidationIssues(project: BoumlProject): {
  project: BoumlProject;
  fixedCount: number;
} {
  let current = cleanupOrphanElements(project).project;
  let fixedCount = 0;

  for (let pass = 0; pass < 6; pass++) {
    const issues = validateProject(current).filter((i) => i.code !== 'SOLID-SRP');
    if (issues.length === 0) break;
    let progress = false;
    for (const issue of issues) {
      const res = fixValidationIssue(current, issue);
      if (res.fixed) {
        current = res.project;
        fixedCount++;
        progress = true;
        break; // Re-validate after structural mutation
      }
    }
    if (!progress) break;
  }

  return { project: current, fixedCount };
}
