import { BoumlProject, ValidationIssue } from './schema';

export function validateProject(project: BoumlProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const elements = Object.values(project.elements);
  const relations = Object.values(project.relations);

  // 1. Duplicate class names inside the same package
  const seenByPackage = new Map<string, string>();
  for (const el of elements) {
    if (el.kind === 'note' || el.kind === 'pseudostate') continue;
    const key = `${el.packageId}::${el.kind}::${el.name.toLowerCase()}`;
    if (seenByPackage.has(key)) {
      issues.push({
        id: `dup_${el.id}`,
        severity: 'error',
        code: 'UML-001',
        message: `Nom en double "${el.name}" dans le même package.`,
        elementId: el.id,
        suggestion: 'Renommez cet élément ou déplacez-le dans un autre package.',
      });
    } else {
      seenByPackage.set(key, el.id);
    }
  }

  // 2. Inheritance cycle detection (generalization)
  const parentMap = new Map<string, string[]>();
  for (const rel of relations) {
    if (rel.kind === 'generalization') {
      const list = parentMap.get(rel.sourceId) ?? [];
      list.push(rel.targetId);
      parentMap.set(rel.sourceId, list);
    }
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const detectCycle = (id: string): boolean => {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const parent of parentMap.get(id) ?? []) {
      if (detectCycle(parent)) return true;
    }
    stack.delete(id);
    return false;
  };

  for (const el of elements) {
    if (detectCycle(el.id)) {
      issues.push({
        id: `cycle_${el.id}`,
        severity: 'error',
        code: 'UML-002',
        message: `Cycle d'héritage détecté impliquant "${el.name}".`,
        elementId: el.id,
        suggestion: 'Supprimez ou inversez une relation de généralisation.',
      });
    }
  }

  // 3. Unimplemented interface operations
  for (const rel of relations) {
    if (rel.kind !== 'realization') continue;
    const impl = project.elements[rel.sourceId];
    const iface = project.elements[rel.targetId];
    if (!impl || !iface || impl.isAbstract || impl.kind === 'abstract_class') continue;

    const implNames = new Set(impl.operations.map((o) => o.name));
    for (const reqOp of iface.operations) {
      if (!implNames.has(reqOp.name)) {
        issues.push({
          id: `unimpl_${impl.id}_${reqOp.id}`,
          severity: 'warning',
          code: 'UML-003',
          message: `La classe "${impl.name}" n'implémente pas "${reqOp.name}()" de l'interface "${iface.name}".`,
          elementId: impl.id,
          relationId: rel.id,
          suggestion: `Utilisez le clic droit sur "${impl.name}" → "Implémenter les méthodes manquantes".`,
        });
      }
    }
  }

  // 4. Dangling relations (BouML RelationData::Unconsistent parity)
  for (const rel of relations) {
    if (!project.elements[rel.sourceId] || !project.elements[rel.targetId]) {
      issues.push({
        id: `dangling_${rel.id}`,
        severity: 'error',
        code: 'UML-004',
        message: `Relation incohérente (${rel.kind}) pointant vers un élément supprimé.`,
        relationId: rel.id,
        suggestion: 'Supprimez cette relation orpheline.',
      });
    }
  }

  // 5. Abstract methods in non-abstract class
  for (const el of elements) {
    if (el.kind === 'class' && !el.isAbstract) {
      const hasAbstractOp = el.operations.some((op) => op.isAbstract);
      if (hasAbstractOp) {
        issues.push({
          id: `abs_${el.id}`,
          severity: 'warning',
          code: 'UML-005',
          message: `La classe concrète "${el.name}" contient des méthodes abstraites.`,
          elementId: el.id,
          suggestion: 'Marquez la classe comme abstraite ou rendez les méthodes concrètes.',
        });
      }
    }
  }

  // 6. God Class heuristic (SOLID SRP check)
  for (const el of elements) {
    if (el.kind === 'class' && el.attributes.length + el.operations.length > 18) {
      issues.push({
        id: `srp_${el.id}`,
        severity: 'info',
        code: 'SOLID-SRP',
        message: `La classe "${el.name}" comporte ${el.attributes.length + el.operations.length} membres (risque de violation du principe SRP).`,
        elementId: el.id,
        suggestion: 'Demandez à Gemini 3.5 Flash Lite de proposer un découpage SOLID.',
      });
    }
  }

  return issues;
}
