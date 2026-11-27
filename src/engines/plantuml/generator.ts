import {
  BoumlProject,
  SequenceFragment,
  UmlDiagram,
  UmlElement,
  UmlRelation,
  VISIBILITY_SYMBOLS,
} from '../../model/schema';

function sanitizeId(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
  return cleaned.length > 0 ? cleaned : 'Element';
}

function relationArrow(rel: UmlRelation): string {
  switch (rel.kind) {
    case 'generalization':
      return '--|>';
    case 'realization':
      return '..|>';
    case 'composition':
      return '*--';
    case 'aggregation':
      return 'o--';
    case 'directional_association':
      return '-->';
    case 'dependency':
      return '..>';
    case 'include':
      return '..>';
    case 'extend':
      return '..>';
    case 'transition':
      return '-->';
    case 'flow':
      return '-->';
    case 'message':
      if (rel.messageKind === 'async') return '->>';
      if (rel.messageKind === 'return') return '-->';
      return '->';
    case 'association':
    default:
      return '--';
  }
}

function renderClassMemberBlock(el: UmlElement): string[] {
  const lines: string[] = [];
  const stereo = el.stereotype ? ` <<${el.stereotype}>>` : '';
  const generics =
    el.generics && el.generics.length > 0
      ? `<${el.generics.map((g) => (g.extendsType ? `${g.name} extends ${g.extendsType}` : g.name)).join(', ')}>`
      : '';

  let keyword = 'class';
  if (el.kind === 'interface') keyword = 'interface';
  else if (el.kind === 'abstract_class' || el.isAbstract) keyword = 'abstract class';
  else if (el.kind === 'enum') keyword = 'enum';
  else if (el.kind === 'struct') keyword = 'struct';
  else if (el.kind === 'record') keyword = 'class';

  lines.push(`${keyword} "${el.name}" as ${sanitizeId(el.name)}${generics}${stereo} {`);

  if (el.kind === 'enum' && el.enumLiterals) {
    for (const lit of el.enumLiterals) {
      lines.push(`  ${lit}`);
    }
  }

  for (const att of el.attributes) {
    const vis = VISIBILITY_SYMBOLS[att.visibility];
    const mods: string[] = [];
    if (att.isStatic) mods.push('{static}');
    const ro = att.isReadOnly ? ' {readOnly}' : '';
    const mult = att.multiplicity ? `[${att.multiplicity}]` : '';
    const def = att.defaultValue ? ` = ${att.defaultValue}` : '';
    const modPrefix = mods.length > 0 ? `${mods.join(' ')} ` : '';
    lines.push(`  ${modPrefix}${vis}${att.name} : ${att.type}${mult}${def}${ro}`);
  }

  for (const op of el.operations) {
    const vis = VISIBILITY_SYMBOLS[op.visibility];
    const mods: string[] = [];
    if (op.isStatic) mods.push('{static}');
    if (op.isAbstract) mods.push('{abstract}');
    const modPrefix = mods.length > 0 ? `${mods.join(' ')} ` : '';
    const params = op.parameters
      .map((p) => `${p.name}: ${p.type}${p.defaultValue ? ` = ${p.defaultValue}` : ''}`)
      .join(', ');
    const ret = op.returnType ? ` : ${op.returnType}` : '';
    const cnst = op.isConst ? ' {const}' : '';
    lines.push(`  ${modPrefix}${vis}${op.name}(${params})${ret}${cnst}`);
  }

  lines.push('}');
  return lines;
}

function renderSequenceWithFragments(
  project: BoumlProject,
  ordered: UmlRelation[],
  fragments: SequenceFragment[]
): string[] {
  const lines: string[] = [];
  const sortedFrags = [...fragments].sort(
    (a, b) => a.startOrder - b.startOrder || b.endOrder - a.endOrder
  );
  const openStack: SequenceFragment[] = [];

  for (let idx = 0; idx < ordered.length; idx++) {
    const rel = ordered[idx];
    const order = rel.sequenceOrder ?? idx + 1;

    // Close fragments that ended before this message
    while (openStack.length > 0 && openStack[openStack.length - 1].endOrder < order) {
      openStack.pop();
      lines.push(`${'  '.repeat(openStack.length)}end`);
    }

    // Check if an open alt fragment transitions to else at this order
    for (let s = openStack.length - 1; s >= 0; s--) {
      const f = openStack[s];
      if (f.kind === 'alt' && f.elseStartOrder === order) {
        const cond = f.elseCondition ? ` ${f.elseCondition}` : '';
        lines.push(`${'  '.repeat(s)}else${cond}`);
      }
    }

    // Open any fragments starting at this order
    for (const f of sortedFrags) {
      if (f.startOrder === order && !openStack.some((o) => o.id === f.id)) {
        const cond = f.condition ? ` ${f.condition}` : '';
        lines.push(`${'  '.repeat(openStack.length)}${f.kind}${cond}`);
        openStack.push(f);
      }
    }

    const src = project.elements[rel.sourceId];
    const tgt = project.elements[rel.targetId];
    if (!src || !tgt) continue;
    const indent = '  '.repeat(openStack.length);
    lines.push(
      `${indent}${sanitizeId(src.name)} ${relationArrow(rel)} ${sanitizeId(tgt.name)} : ${rel.label || rel.trigger || 'call()'}`
    );
  }

  while (openStack.length > 0) {
    openStack.pop();
    lines.push(`${'  '.repeat(openStack.length)}end`);
  }

  return lines;
}

export function generatePlantUml(project: BoumlProject, diagramId?: string): string {
  const diagram: UmlDiagram | undefined = diagramId
    ? project.diagrams[diagramId]
    : Object.values(project.diagrams)[0];

  const lines: string[] = ['@startuml'];
  lines.push(`' Généré automatiquement par BouML v2 — Projet: ${project.name}`);
  lines.push('skinparam shadowing false');
  lines.push('skinparam classAttributeIconSize 0');

  const kind = diagram?.kind ?? 'class';

  if (kind !== 'sequence') {
    if (diagram?.layoutDirection === 'RIGHT') {
      lines.push('left to right direction');
    } else {
      lines.push('top to bottom direction');
    }
  }
  lines.push('');

  const activeElements: UmlElement[] = diagram
    ? diagram.nodes.map((n) => project.elements[n.elementId]).filter(Boolean)
    : Object.values(project.elements);

  const activeRelations: UmlRelation[] = diagram
    ? diagram.relationIds.map((rid) => project.relations[rid]).filter(Boolean)
    : Object.values(project.relations);

  if (kind === 'sequence') {
    for (const el of activeElements) {
      const kw = el.kind === 'actor' ? 'actor' : 'participant';
      lines.push(`${kw} "${el.name}" as ${sanitizeId(el.name)}`);
    }
    lines.push('');
    const ordered = [...activeRelations].sort(
      (a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0)
    );
    const fragments = diagram?.fragments ?? [];
    if (fragments.length > 0) {
      lines.push(...renderSequenceWithFragments(project, ordered, fragments));
    } else {
      for (const rel of ordered) {
        const src = project.elements[rel.sourceId];
        const tgt = project.elements[rel.targetId];
        if (!src || !tgt) continue;
        lines.push(
          `${sanitizeId(src.name)} ${relationArrow(rel)} ${sanitizeId(tgt.name)} : ${rel.label || rel.trigger || 'call()'}`
        );
      }
    }
    lines.push('@enduml');
    return lines.join('\n');
  }

  if (kind === 'state') {
    // Group states by stateGroup so multiple state machines encapsulate cleanly inside state "ClassName" { ... }
    const grouped = new Map<string, UmlElement[]>();
    const ungrouped: UmlElement[] = [];

    for (const el of activeElements) {
      if (el.stateGroup) {
        const list = grouped.get(el.stateGroup) ?? [];
        list.push(el);
        grouped.set(el.stateGroup, list);
      } else {
        ungrouped.push(el);
      }
    }

    const renderStateNode = (el: UmlElement, indent: string) => {
      if (el.kind !== 'state') return;
      lines.push(`${indent}state "${el.name}" as ${sanitizeId(el.name)}`);
      if (el.stateEntry) lines.push(`${indent}${sanitizeId(el.name)} : entry / ${el.stateEntry}`);
      if (el.stateDo) lines.push(`${indent}${sanitizeId(el.name)} : do / ${el.stateDo}`);
      if (el.stateExit) lines.push(`${indent}${sanitizeId(el.name)} : exit / ${el.stateExit}`);
    };

    const renderTransition = (rel: UmlRelation, indent: string) => {
      const src = project.elements[rel.sourceId];
      const tgt = project.elements[rel.targetId];
      if (!src || !tgt) return;
      const srcRef =
        src.kind === 'pseudostate' && src.pseudoStateKind === 'initial'
          ? '[*]'
          : sanitizeId(src.name);
      const tgtRef =
        tgt.kind === 'pseudostate' && tgt.pseudoStateKind === 'final'
          ? '[*]'
          : sanitizeId(tgt.name);
      const labelParts = [
        rel.trigger,
        rel.guard ? `[${rel.guard}]` : '',
        rel.effect ? `/ ${rel.effect}` : '',
        rel.label,
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(`${indent}${srcRef} --> ${tgtRef}${labelParts ? ` : ${labelParts}` : ''}`);
    };

    const emittedRelIds = new Set<string>();

    for (const [groupName, groupEls] of grouped.entries()) {
      const groupIdSet = new Set(groupEls.map((e) => e.id));
      lines.push(`state "${groupName}" {`);
      for (const el of groupEls) renderStateNode(el, '  ');
      for (const rel of activeRelations) {
        if (groupIdSet.has(rel.sourceId) && groupIdSet.has(rel.targetId)) {
          renderTransition(rel, '  ');
          emittedRelIds.add(rel.id);
        }
      }
      lines.push('}', '');
    }

    for (const el of ungrouped) {
      // Never emit an isolated state node that merely mirrors a stateGroup name
      if (el.kind === 'state' && grouped.has(el.name)) continue;
      renderStateNode(el, '');
    }

    const remainingRels = activeRelations.filter((r) => !emittedRelIds.has(r.id));
    if (remainingRels.length > 0) {
      lines.push('');
      for (const rel of remainingRels) renderTransition(rel, '');
    }

    lines.push('@enduml');
    return lines.join('\n');
  }

  if (kind === 'usecase') {
    const actors = activeElements.filter((e) => e.kind === 'actor');
    const notes = activeElements.filter((e) => e.kind === 'note');
    const usecases = activeElements.filter((e) => e.kind === 'usecase');

    for (const el of actors) {
      lines.push(`actor "${el.name}" as ${sanitizeId(el.name)}`);
    }
    if (actors.length > 0) lines.push('');

    const bySubsystem = new Map<string, UmlElement[]>();
    const standaloneUcs: UmlElement[] = [];

    for (const uc of usecases) {
      if (uc.subsystem) {
        const list = bySubsystem.get(uc.subsystem) ?? [];
        list.push(uc);
        bySubsystem.set(uc.subsystem, list);
      } else {
        standaloneUcs.push(uc);
      }
    }

    for (const [subName, ucs] of bySubsystem.entries()) {
      lines.push(`rectangle "${subName}" {`);
      for (const uc of ucs) {
        lines.push(`  usecase "${uc.name}" as ${sanitizeId(uc.name)}`);
      }
      lines.push('}', '');
    }

    for (const uc of standaloneUcs) {
      lines.push(`usecase "${uc.name}" as ${sanitizeId(uc.name)}`);
    }
    for (const n of notes) {
      lines.push(`note "${n.description || n.name}" as ${sanitizeId(n.name)}`);
    }

    lines.push('');
    for (const rel of activeRelations) {
      const src = project.elements[rel.sourceId];
      const tgt = project.elements[rel.targetId];
      if (!src || !tgt) continue;
      const stereo =
        rel.kind === 'include'
          ? '<<include>>'
          : rel.kind === 'extend'
            ? '<<extend>>'
            : rel.label || '';
      lines.push(
        `${sanitizeId(src.name)} ${relationArrow(rel)} ${sanitizeId(tgt.name)}${stereo ? ` : ${stereo}` : ''}`
      );
    }
    lines.push('@enduml');
    return lines.join('\n');
  }

  if (kind === 'component' || kind === 'deployment') {
    for (const el of activeElements) {
      const kw =
        el.kind === 'node'
          ? 'node'
          : el.kind === 'artifact'
            ? 'artifact'
            : el.kind === 'interface'
              ? 'interface'
              : 'component';
      const stereo = el.stereotype ? ` <<${el.stereotype}>>` : '';
      lines.push(`${kw} "${el.name}" as ${sanitizeId(el.name)}${stereo}`);
    }
    lines.push('');
    for (const rel of activeRelations) {
      const src = project.elements[rel.sourceId];
      const tgt = project.elements[rel.targetId];
      if (!src || !tgt) continue;
      lines.push(
        `${sanitizeId(src.name)} ${relationArrow(rel)} ${sanitizeId(tgt.name)}${rel.label ? ` : ${rel.label}` : ''}`
      );
    }
    lines.push('@enduml');
    return lines.join('\n');
  }

  if (kind === 'activity') {
    lines.push('start');
    for (const el of activeElements) {
      if (el.kind === 'activity_action') {
        lines.push(`:${el.name};`);
      }
    }
    lines.push('stop');
    lines.push('@enduml');
    return lines.join('\n');
  }

  if (kind === 'object') {
    for (const el of activeElements) {
      lines.push(`object "${el.name}" as ${sanitizeId(el.name)} {`);
      for (const att of el.attributes) {
        lines.push(`  ${att.name} = ${att.defaultValue || 'null'}`);
      }
      lines.push('}');
    }
    lines.push('');
    for (const rel of activeRelations) {
      const src = project.elements[rel.sourceId];
      const tgt = project.elements[rel.targetId];
      if (!src || !tgt) continue;
      lines.push(
        `${sanitizeId(src.name)} -- ${sanitizeId(tgt.name)}${rel.label ? ` : ${rel.label}` : ''}`
      );
    }
    lines.push('@enduml');
    return lines.join('\n');
  }

  // Default: Class / Communication diagram
  const byPkg = new Map<string, UmlElement[]>();
  for (const el of activeElements) {
    const list = byPkg.get(el.packageId) ?? [];
    list.push(el);
    byPkg.set(el.packageId, list);
  }

  for (const [pkgId, els] of byPkg.entries()) {
    const pkg = project.packages.find((p) => p.id === pkgId);
    if (pkg && byPkg.size > 1) {
      lines.push(`package "${pkg.name}" {`);
    }
    for (const el of els) {
      if (el.kind === 'note') {
        lines.push(`note "${el.description || el.name}" as ${sanitizeId(el.name)}`);
      } else {
        const block = renderClassMemberBlock(el);
        for (const l of block) {
          lines.push(pkg && byPkg.size > 1 ? `  ${l}` : l);
        }
      }
      lines.push('');
    }
    if (pkg && byPkg.size > 1) {
      lines.push('}');
      lines.push('');
    }
  }

  for (const rel of activeRelations) {
    const src = project.elements[rel.sourceId];
    const tgt = project.elements[rel.targetId];
    if (!src || !tgt) continue;
    const srcMult = rel.sourceMultiplicity ? ` "${rel.sourceMultiplicity}"` : '';
    const tgtMult = rel.targetMultiplicity ? ` "${rel.targetMultiplicity}"` : '';
    const label =
      rel.kind === 'extend'
        ? '<<extend>>'
        : rel.kind === 'include'
          ? '<<include>>'
          : rel.label || rel.targetRole || (rel.stereotype ? `<<${rel.stereotype}>>` : '');
    lines.push(
      `${sanitizeId(src.name)}${srcMult} ${relationArrow(rel)}${tgtMult} ${sanitizeId(tgt.name)}${label ? ` : ${label}` : ''}`
    );
  }

  lines.push('@enduml');
  return lines.join('\n');
}
