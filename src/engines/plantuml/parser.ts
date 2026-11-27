import {
  createId,
  DiagramKind,
  ElementKind,
  RelationKind,
  SequenceFragment,
  SequenceFragmentKind,
  UmlAttribute,
  UmlElement,
  UmlOperation,
  UmlParameter,
  UmlRelation,
  Visibility,
} from '../../model/schema';

export interface ParsedPlantUmlResult {
  title?: string;
  diagramKind: DiagramKind;
  elements: UmlElement[];
  relations: UmlRelation[];
  fragments: SequenceFragment[];
  subsystems: string[];
  packages: string[];
}

function parseVisibility(sym?: string): Visibility {
  switch (sym?.trim().toLowerCase()) {
    case '+':
    case 'public':
      return 'public';
    case '#':
    case 'protected':
      return 'protected';
    case '-':
    case 'private':
      return 'private';
    case '~':
    case 'package':
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
    if (label?.toLowerCase().includes('include')) return 'include';
    if (label?.toLowerCase().includes('extend')) return 'extend';
    return 'dependency';
  }
  if (arrow.includes('-->') || arrow.includes('<--')) {
    if (label?.toLowerCase().includes('<<extend>>')) return 'extend';
    if (label?.toLowerCase().includes('<<include>>')) return 'include';
    return 'directional_association';
  }
  if (arrow.includes('->>') || arrow.includes('->')) return 'message';
  return 'association';
}

function cleanStereotype(raw?: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/^<<|>>$/g, '').trim();
  if (!cleaned || cleaned.length > 32) return undefined;
  return cleaned;
}

function parseParameters(rawParams: string): UmlParameter[] {
  if (!rawParams.trim()) return [];
  const params: UmlParameter[] = [];
  let current = '';
  let angleDepth = 0;
  for (const ch of rawParams) {
    if (ch === '<') angleDepth++;
    else if (ch === '>') angleDepth = Math.max(0, angleDepth - 1);
    if (ch === ',' && angleDepth === 0) {
      if (current.trim()) params.push(parseSingleParam(current.trim()));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(parseSingleParam(current.trim()));
  return params;
}

function parseSingleParam(raw: string): UmlParameter {
  let defaultValue: string | undefined;
  let main = raw;
  const eqIdx = raw.indexOf('=');
  if (eqIdx !== -1) {
    defaultValue = raw.slice(eqIdx + 1).trim();
    main = raw.slice(0, eqIdx).trim();
  }

  const dirMatch = main.match(/^(in|out|inout)\s+(.+)$/i);
  const direction = dirMatch ? (dirMatch[1].toLowerCase() as UmlParameter['direction']) : undefined;
  if (dirMatch) main = dirMatch[2].trim();

  const colonIdx = main.indexOf(':');
  if (colonIdx !== -1 && !main.slice(colonIdx, colonIdx + 2).startsWith('::')) {
    const name = main.slice(0, colonIdx).trim();
    const type = main.slice(colonIdx + 1).trim();
    return { id: createId('p'), name, type: type || 'any', direction, defaultValue };
  }

  const tokens = main.split(/\s+/);
  if (tokens.length >= 2) {
    const name = tokens[tokens.length - 1].replace(/^[&*]+/, '');
    const type = tokens.slice(0, -1).join(' ');
    return { id: createId('p'), name, type, direction, defaultValue };
  }

  return { id: createId('p'), name: main, type: 'any', direction, defaultValue };
}

export function parsePlantUml(source: string, defaultPackageId: string): ParsedPlantUmlResult {
  const stripped = source
    .replace(/```(?:plantuml|puml|uml)?/gi, '')
    .replace(/```/g, '')
    // Normalize common localization / serialization bugs automatically
    .replace(/\{statique\}/gi, '{static}')
    .replace(/\{\s*,\s*\}/g, '');

  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith("'") &&
        !l.startsWith('//') &&
        !l.startsWith('@') &&
        !l.startsWith('skinparam') &&
        !l.startsWith('hide ') &&
        !l.startsWith('show ') &&
        !l.startsWith('left to right') &&
        !l.startsWith('top to bottom')
    );

  const byAlias = new Map<string, UmlElement>();
  const elements: UmlElement[] = [];
  const relations: UmlRelation[] = [];
  const fragments: SequenceFragment[] = [];
  const subsystems: string[] = [];
  const packages: string[] = [];

  let diagramKind: DiagramKind = 'class';
  let title: string | undefined;
  let currentBlock: UmlElement | null = null;
  const containerStack: Array<{ type: 'package' | 'subsystem' | 'state_group'; name: string }> = [];
  const fragmentStack: SequenceFragment[] = [];
  let messageCounter = 0;

  const activeStateGroup = (): string | undefined => {
    for (let i = containerStack.length - 1; i >= 0; i--) {
      if (containerStack[i].type === 'state_group') return containerStack[i].name;
    }
    return undefined;
  };

  const activeSubsystem = (): string | undefined => {
    for (let i = containerStack.length - 1; i >= 0; i--) {
      if (containerStack[i].type === 'subsystem') return containerStack[i].name;
    }
    return undefined;
  };

  const ensureElement = (rawName: string, kind: ElementKind = 'class'): UmlElement => {
    const clean = rawName.replace(/^"|"$/g, '').trim();
    const sg = activeStateGroup();
    const lookupKey = kind === 'state' || kind === 'pseudostate' ? `${sg ?? ''}::${clean}` : clean;
    const existing = byAlias.get(lookupKey) ?? byAlias.get(clean);
    if (existing && (kind !== 'pseudostate' || existing.stateGroup === sg)) {
      return existing;
    }
    const el: UmlElement = {
      id: createId('el'),
      packageId: defaultPackageId,
      kind,
      name: clean,
      taggedValues: {},
      visibility: 'public',
      isAbstract: kind === 'abstract_class' || kind === 'interface',
      attributes: [],
      operations: [],
      enumLiterals: kind === 'enum' ? [] : undefined,
      stateGroup: kind === 'state' || kind === 'pseudostate' ? sg : undefined,
      subsystem: kind === 'usecase' ? activeSubsystem() : undefined,
    };
    byAlias.set(lookupKey, el);
    if (!byAlias.has(clean)) byAlias.set(clean, el);
    elements.push(el);
    return el;
  };

  for (const line of lines) {
    // Title
    const titleMatch = line.match(/^title\s+(.+)$/i);
    if (titleMatch) {
      title = titleMatch[1].replace(/^"|"$/g, '').trim();
      continue;
    }

    // Closing brace
    if (line === '}') {
      if (currentBlock) {
        currentBlock = null;
      } else if (containerStack.length > 0) {
        containerStack.pop();
      }
      continue;
    }

    // Sequence combined fragments: alt / else / opt / loop / end
    const fragOpen = line.match(/^(alt|opt|loop)\b\s*(.*)$/i);
    if (fragOpen && !currentBlock) {
      diagramKind = 'sequence';
      const kindRaw = fragOpen[1].toLowerCase() as SequenceFragmentKind;
      const cond = fragOpen[2].trim();
      const parentId = fragmentStack.length > 0 ? fragmentStack[fragmentStack.length - 1].id : undefined;
      const frag: SequenceFragment = {
        id: createId('frag'),
        kind: kindRaw,
        condition: cond,
        parentId,
        startOrder: messageCounter + 1,
        endOrder: messageCounter + 1,
      };
      fragmentStack.push(frag);
      fragments.push(frag);
      continue;
    }

    const fragElse = line.match(/^else\b\s*(.*)$/i);
    if (fragElse && !currentBlock && fragmentStack.length > 0) {
      const top = fragmentStack[fragmentStack.length - 1];
      if (top.kind === 'alt') {
        top.elseCondition = fragElse[1].trim() || undefined;
        top.elseStartOrder = messageCounter + 1;
      }
      continue;
    }

    if (/^end$/i.test(line) && !currentBlock && fragmentStack.length > 0) {
      const closed = fragmentStack.pop()!;
      closed.endOrder = Math.max(closed.startOrder, messageCounter);
      continue;
    }

    // Composite state container: state "Train" {  or  state "Train" as Train {
    const compositeStateMatch = line.match(
      /^state\s+(?:"([^"]+)"|([^\s{]+))(?:\s+as\s+\S+)?\s*\{$/i
    );
    if (compositeStateMatch && !currentBlock) {
      diagramKind = 'state';
      const groupName = (compositeStateMatch[1] || compositeStateMatch[2]).trim();
      containerStack.push({ type: 'state_group', name: groupName });
      continue;
    }

    // Subsystem rectangle container in UseCase diagrams: rectangle "Sous-Système" {
    const rectMatch = line.match(
      /^rectangle\s+(?:"([^"]+)"|([^\s{]+))(?:\s+as\s+\S+)?\s*\{$/i
    );
    if (rectMatch && !currentBlock) {
      const subName = (rectMatch[1] || rectMatch[2]).trim();
      if (!subsystems.includes(subName)) subsystems.push(subName);
      containerStack.push({ type: 'subsystem', name: subName });
      continue;
    }

    // Package / Namespace block
    const pkgMatch = line.match(/^(?:package|namespace)\s+(?:"([^"]+)"|([^\s{]+))\s*\{?$/i);
    if (pkgMatch && !currentBlock) {
      const pkgName = (pkgMatch[1] || pkgMatch[2]).trim();
      if (!packages.includes(pkgName)) packages.push(pkgName);
      if (line.endsWith('{')) containerStack.push({ type: 'package', name: pkgName });
      continue;
    }

    // Separator lines inside class blocks
    if (currentBlock && /^(--|==|\.\.|__)/.test(line)) {
      continue;
    }

    // Members inside class/interface/enum block
    if (currentBlock) {
      if (currentBlock.kind === 'enum' && !line.includes('(') && !line.includes(':')) {
        const lit = line.replace(/,$/, '').trim();
        if (lit) currentBlock.enumLiterals = [...(currentBlock.enumLiterals ?? []), lit];
        continue;
      }

      const isStatic = /\{static\}|\bstatic\b/i.test(line);
      const isAbstract = /\{abstract\}|\babstract\b/i.test(line);
      const isVirtual = /\{virtual\}|\bvirtual\b/i.test(line);
      const isAsync = /\{async\}|\basync\b/i.test(line);
      const isReadOnly = /\{readOnly\}|\{readonly\}|\{final\}|\breadonly\b/i.test(line);
      const isConst =
        /\{const\}|\{query\}/i.test(line) ||
        /\)\s*(?::\s*[^\n{]+)?\s+\bconst\b\s*$/i.test(line) ||
        /\)\s+\bconst\b\s*(?::|$)/i.test(line);

      const cleaned = line
        .replace(/\{(?:static|abstract|virtual|async|const|query|readOnly|readonly|final|field|method)\}/gi, '')
        .replace(/\b(?:static|abstract|virtual|async|readonly)\b/gi, '')
        .replace(/\s+\bconst\b\s*$/i, '')
        .replace(/\)\s+\bconst\b\s*:/i, ') :')
        .replace(/\s+/g, ' ')
        .trim();

      const opMatch = cleaned.match(
        /^([+#\-~]|(?:public|private|protected|package)\s+)?\s*(?:~?[A-Za-z_][\w]*::)?(~?[A-Za-z_][\w]*)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/
      );
      if (opMatch) {
        const [, visSym, name, rawParams, rawRet] = opMatch;
        const isConstructor = name === currentBlock.name || name === `~${currentBlock.name}`;
        const returnType = rawRet
          ? rawRet.replace(/\bconst\b/gi, '').trim()
          : isConstructor
            ? ''
            : 'void';

        const op: UmlOperation = {
          id: createId('op'),
          name,
          returnType,
          visibility: parseVisibility(visSym),
          parameters: parseParameters(rawParams),
          isStatic,
          isAbstract,
          isVirtual,
          isConst,
          isAsync,
        };
        currentBlock.operations.push(op);
        continue;
      }

      const attColonMatch = cleaned.match(
        /^([+#\-~]|(?:public|private|protected|package)\s+)?\s*([A-Za-z_][\w]*)\s*:\s*([^=]+)(?:=\s*(.+))?$/
      );
      if (attColonMatch) {
        const [, visSym, name, rawType, defVal] = attColonMatch;
        const att: UmlAttribute = {
          id: createId('att'),
          name: name.trim(),
          type: rawType.replace(/\bconst\b/gi, '').trim(),
          visibility: parseVisibility(visSym),
          defaultValue: defVal?.trim(),
          isStatic,
          isReadOnly: isReadOnly || /\bconst\b/i.test(rawType),
        };
        currentBlock.attributes.push(att);
        continue;
      }

      const attSpaceMatch = cleaned.match(
        /^([+#\-~]|(?:public|private|protected|package)\s+)?\s*([A-Za-z_][\w:<>,\[\]*&]+)\s+([A-Za-z_][\w]*)(?:\s*=\s*(.+))?$/
      );
      if (attSpaceMatch) {
        const [, visSym, rawType, name, defVal] = attSpaceMatch;
        const att: UmlAttribute = {
          id: createId('att'),
          name: name.trim(),
          type: rawType.trim(),
          visibility: parseVisibility(visSym),
          defaultValue: defVal?.trim(),
          isStatic,
          isReadOnly,
        };
        currentBlock.attributes.push(att);
      }
      continue;
    }

    // State entry/do/exit action line: StateName : entry / init()
    const stateActionMatch = line.match(/^([A-Za-z_][\w]*)\s*:\s*(entry|do|exit)\s*\/\s*(.+)$/i);
    if (stateActionMatch) {
      diagramKind = 'state';
      const [, stateAlias, actionKind, actionText] = stateActionMatch;
      const st = ensureElement(stateAlias, 'state');
      const k = actionKind.toLowerCase();
      if (k === 'entry') st.stateEntry = actionText.trim();
      else if (k === 'do') st.stateDo = actionText.trim();
      else if (k === 'exit') st.stateExit = actionText.trim();
      continue;
    }

    // Actor / Usecase / Component / Node / Artifact / State / Sequence Participants
    const simpleMatch = line.match(
      /^(actor|usecase|component|node|artifact|state|participant|boundary|control|entity|database|collections|queue)\s+(?:"([^"]+)"|([^\s{<]+))(?:\s+as\s+(\S+))?(?:\s*<<([^>]+)>>)?/i
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
      } else if (
        kw === 'participant' ||
        kw === 'boundary' ||
        kw === 'control' ||
        kw === 'entity' ||
        kw === 'database' ||
        kw === 'collections' ||
        kw === 'queue'
      ) {
        kind = 'lifeline';
        diagramKind = 'sequence';
      }
      const el = ensureElement(name, kind);
      el.stereotype = cleanStereotype(stereo);
      if (alias) {
        const sg = activeStateGroup();
        byAlias.set(kind === 'state' ? `${sg ?? ''}::${alias}` : alias, el);
        byAlias.set(alias, el);
      }
      continue;
    }

    // Class / Interface / Abstract Class / Enum / Struct
    const classMatch = line.match(
      /^(abstract\s+class|abstract|class|interface|enum|struct)\s+(?:"([^"]+)"|([A-Za-z_][\w]*))(?:\s+as\s+(\S+))?(?:<([^>]+)>)?(?:\s*<<([^>]+)>>)?\s*(\{)?/i
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
      el.stereotype = cleanStereotype(stereo);
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

      // Promote to sequence diagram if sequence message arrow (-> or ->>) is used
      if (arrow === '->' || arrow === '->>') {
        diagramKind = 'sequence';
      }

      const resolveNode = (token: string, isTarget: boolean): UmlElement => {
        if (token === '[*]') {
          diagramKind = 'state';
          const sg = activeStateGroup();
          const psName = isTarget ? (sg ? `${sg}_Final` : 'Final') : sg ? `${sg}_Initial` : 'Initial';
          const ps = ensureElement(psName, 'pseudostate');
          ps.pseudoStateKind = isTarget ? 'final' : 'initial';
          ps.stateGroup = sg;
          return ps;
        }
        return ensureElement(
          token,
          diagramKind === 'state' ? 'state' : diagramKind === 'sequence' ? 'lifeline' : 'class'
        );
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

      let seqOrder: number | undefined;
      if (kind === 'message') {
        messageCounter++;
        seqOrder = messageCounter;
        for (const f of fragmentStack) {
          f.endOrder = messageCounter;
        }
      }

      const cleanedLabel = rawLabel?.replace(/<<include>>|<<extend>>/gi, '').trim();

      relations.push({
        id: createId('rel'),
        kind,
        sourceId: source.id,
        targetId: target.id,
        sourceMultiplicity: reversed ? tgtMult : srcMult,
        targetMultiplicity: reversed ? srcMult : tgtMult,
        label: cleanedLabel || undefined,
        stereotype:
          kind === 'include' ? 'include' : kind === 'extend' ? 'extend' : undefined,
        messageKind:
          kind === 'message'
            ? arrow.includes('-->')
              ? 'return'
              : arrow.includes('->>')
                ? 'async'
                : 'sync'
            : undefined,
        sequenceOrder: seqOrder,
      });
    }
  }

  return { title, diagramKind, elements, relations, fragments, subsystems, packages };
}

/**
 * Parses one or multiple @startuml ... @enduml blocks returned by AI or multi-diagram files.
 */
export function parsePlantUmlBlocks(
  rawText: string,
  defaultPackageId: string
): ParsedPlantUmlResult[] {
  const blocks: string[] = [];
  const regex = /@startuml[\s\S]*?@enduml/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawText)) !== null) {
    blocks.push(match[0]);
  }
  if (blocks.length === 0) {
    const single = parsePlantUml(rawText, defaultPackageId);
    return single.elements.length > 0 ? [single] : [];
  }
  return blocks
    .map((b) => parsePlantUml(b, defaultPackageId))
    .filter((res) => res.elements.length > 0);
}
