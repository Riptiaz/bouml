import {
  createId,
  DiagramKind,
  ElementKind,
  RelationKind,
  UmlAttribute,
  UmlElement,
  UmlOperation,
  UmlParameter,
  UmlRelation,
  Visibility,
} from '../../model/schema';

export interface ParsedPlantUmlResult {
  diagramKind: DiagramKind;
  elements: UmlElement[];
  relations: UmlRelation[];
}

function parseVisibility(sym?: string): Visibility {
  switch (sym) {
    case '+':
      return 'public';
    case '#':
      return 'protected';
    case '-':
      return 'private';
    case '~':
      return 'package';
    default:
      return 'public';
  }
}

function parseRelationKind(arrow: string, label?: string): RelationKind {
  if (arrow.includes('--|>') || arrow.includes('<|--')) return 'generalization';
  if (arrow.includes('..|>') || arrow.includes('<|..')) return 'realization';
  if (arrow.includes('*--') || arrow.includes('--*')) return 'composition';
  if (arrow.includes('o--') || arrow.includes('--o')) return 'aggregation';
  if (arrow.includes('..>') || arrow.includes('<..')) {
    if (label?.includes('include')) return 'include';
    if (label?.includes('extend')) return 'extend';
    return 'dependency';
  }
  if (arrow.includes('-->') || arrow.includes('<--')) return 'directional_association';
  if (arrow.includes('->>') || arrow.includes('->')) return 'message';
  return 'association';
}

export function parsePlantUml(source: string, packageId: string): ParsedPlantUmlResult {
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("'") && !l.startsWith('@') && !l.startsWith('skinparam'));

  const byAlias = new Map<string, UmlElement>();
  const elements: UmlElement[] = [];
  const relations: UmlRelation[] = [];
  let diagramKind: DiagramKind = 'class';

  const ensureElement = (rawName: string, kind: ElementKind = 'class'): UmlElement => {
    const clean = rawName.replace(/^"|"$/g, '').trim();
    const existing = byAlias.get(clean);
    if (existing) return existing;
    const el: UmlElement = {
      id: createId('el'),
      packageId,
      kind,
      name: clean,
      taggedValues: {},
      visibility: 'public',
      isAbstract: kind === 'abstract_class' || kind === 'interface',
      attributes: [],
      operations: [],
      enumLiterals: kind === 'enum' ? [] : undefined,
    };
    byAlias.set(clean, el);
    elements.push(el);
    return el;
  };

  let currentBlock: UmlElement | null = null;

  for (const line of lines) {
    if (line === '}') {
      currentBlock = null;
      continue;
    }

    if (currentBlock) {
      // Enum literal
      if (currentBlock.kind === 'enum' && !line.includes('(') && !line.includes(':')) {
        currentBlock.enumLiterals = [...(currentBlock.enumLiterals ?? []), line.replace(/,$/, '')];
        continue;
      }

      const isStatic = line.includes('{static}');
      const isAbstract = line.includes('{abstract}');
      const cleaned = line.replace(/\{static\}|\{abstract\}/g, '').trim();

      // Operation: +method(a: int, b: string) : void
      const opMatch = cleaned.match(/^([+#\-~])?\s*([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/);
      if (opMatch) {
        const [, visSym, name, rawParams, rawRet] = opMatch;
        const params: UmlParameter[] = rawParams
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => {
            const parts = p.split(':').map((x) => x.trim());
            if (parts.length >= 2) {
              return { id: createId('p'), name: parts[0], type: parts[1] };
            }
            const spaceParts = p.split(/\s+/);
            return {
              id: createId('p'),
              type: spaceParts.length > 1 ? spaceParts[0] : 'any',
              name: spaceParts.length > 1 ? spaceParts[1] : spaceParts[0],
            };
          });

        const op: UmlOperation = {
          id: createId('op'),
          name,
          returnType: rawRet?.trim() || 'void',
          visibility: parseVisibility(visSym),
          parameters: params,
          isStatic,
          isAbstract,
        };
        currentBlock.operations.push(op);
        continue;
      }

      // Attribute: -id : UUID
      const attMatch = cleaned.match(/^([+#\-~])?\s*([A-Za-z_][\w]*)\s*:\s*([^={}]+)(?:=\s*([^{]+))?/);
      if (attMatch) {
        const [, visSym, name, type, defVal] = attMatch;
        const att: UmlAttribute = {
          id: createId('att'),
          name,
          type: type.trim(),
          visibility: parseVisibility(visSym),
          defaultValue: defVal?.trim(),
          isStatic,
          isReadOnly: cleaned.includes('{readOnly}'),
        };
        currentBlock.attributes.push(att);
      }
      continue;
    }

    // Actor / Usecase / Component / Node / State / Participant
    const simpleMatch = line.match(
      /^(actor|usecase|component|node|artifact|state|participant)\s+(?:"([^"]+)"|(\S+))(?:\s+as\s+(\S+))?(?:\s*<<([^>]+)>>)?/i
    );
    if (simpleMatch) {
      const [, kwRaw, quoted, bare, alias, stereo] = simpleMatch;
      const kw = kwRaw.toLowerCase();
      const name = quoted || bare;
      let kind: ElementKind = 'class';
      if (kw === 'actor') {
        kind = 'actor';
        if (diagramKind === 'class') diagramKind = 'usecase';
      } else if (kw === 'usecase') {
        kind = 'usecase';
        diagramKind = 'usecase';
      } else if (kw === 'component') {
        kind = 'component';
        diagramKind = 'component';
      } else if (kw === 'node') {
        kind = 'node';
        diagramKind = 'deployment';
      } else if (kw === 'artifact') {
        kind = 'artifact';
      } else if (kw === 'state') {
        kind = 'state';
        diagramKind = 'state';
      } else if (kw === 'participant') {
        kind = 'lifeline';
        diagramKind = 'sequence';
      }
      const el = ensureElement(name, kind);
      if (stereo) el.stereotype = stereo.trim();
      if (alias) byAlias.set(alias, el);
      continue;
    }

    // Class / Interface / Abstract Class / Enum / Struct
    const classMatch = line.match(
      /^(abstract\s+class|class|interface|enum|struct)\s+(?:"([^"]+)"|([A-Za-z_][\w]*))(?:\s+as\s+(\S+))?(?:<([^>]+)>)?(?:\s*<<([^>]+)>>)?\s*(\{)?/i
    );
    if (classMatch) {
      const [, kwRaw, quoted, bare, alias, genericsRaw, stereo, openBrace] = classMatch;
      const kw = kwRaw.toLowerCase();
      const name = quoted || bare;
      const kind: ElementKind =
        kw === 'interface'
          ? 'interface'
          : kw === 'enum'
            ? 'enum'
            : kw === 'struct'
              ? 'struct'
              : kw.startsWith('abstract')
                ? 'abstract_class'
                : 'class';
      const el = ensureElement(name, kind);
      if (stereo) el.stereotype = stereo.trim();
      if (genericsRaw) {
        el.generics = genericsRaw.split(',').map((g) => ({ name: g.trim() }));
      }
      if (alias) byAlias.set(alias, el);
      if (openBrace) currentBlock = el;
      continue;
    }

    // Relation line: A "1" --> "0..*" B : label
    const relMatch = line.match(
      /^(\[\*\]|[A-Za-z_][\w]*)\s*(?:"([^"]+)")?\s*(<\|--|--\|>|<\|\.\.|\.\.\|>|\*--|--\*|o--|--o|<--|\.\.>|<\.\.|-->|->>|->|--)\s*(?:"([^"]+)")?\s*(\[\*\]|[A-Za-z_][\w]*)\s*(?::\s*(.+))?$/
    );
    if (relMatch) {
      const [, rawSrc, srcMult, arrow, tgtMult, rawTgt, rawLabel] = relMatch;
      const reversed = arrow.startsWith('<') || arrow.endsWith('*') || arrow.endsWith('o');

      const resolveNode = (token: string, isTarget: boolean): UmlElement => {
        if (token === '[*]') {
          diagramKind = 'state';
          const psName = isTarget ? 'Final' : 'Initial';
          const ps = ensureElement(psName, 'pseudostate');
          ps.pseudoStateKind = isTarget ? 'final' : 'initial';
          return ps;
        }
        return ensureElement(token, diagramKind === 'state' ? 'state' : 'class');
      };

      const a = resolveNode(rawSrc, false);
      const b = resolveNode(rawTgt, true);
      const source = reversed ? b : a;
      const target = reversed ? a : b;
      const kind =
        diagramKind === 'state'
          ? 'transition'
          : diagramKind === 'sequence'
            ? 'message'
            : parseRelationKind(arrow, rawLabel);

      relations.push({
        id: createId('rel'),
        kind,
        sourceId: source.id,
        targetId: target.id,
        sourceMultiplicity: reversed ? tgtMult : srcMult,
        targetMultiplicity: reversed ? srcMult : tgtMult,
        label: rawLabel?.replace(/<<|>>/g, '').trim(),
        sequenceOrder: kind === 'message' ? relations.length + 1 : undefined,
      });
    }
  }

  return { diagramKind, elements, relations };
}
