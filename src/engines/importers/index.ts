import {
  createId,
  DiagramKind,
  UmlElement,
  UmlRelation,
} from '../../model/schema';
import { parsePlantUml } from '../plantuml/parser';
import { extractPreservedBodies } from '../codegen/preservedBody';
import yaml from 'js-yaml';

export interface ImportResult {
  sourceName: string;
  diagramKind: DiagramKind;
  elements: UmlElement[];
  relations: UmlRelation[];
  preservedBodies?: Record<string, string>;
}

/**
 * Reverse-engineer source code (TypeScript, Java, C++, Python, PHP, Rust, Go)
 */
export function reverseSourceCode(
  filename: string,
  content: string,
  packageId: string
): ImportResult {
  const elements: UmlElement[] = [];
  const relations: UmlRelation[] = [];
  const byName = new Map<string, UmlElement>();
  const preservedBodies = extractPreservedBodies(content);

  const ensure = (name: string, kind: UmlElement['kind'] = 'class'): UmlElement => {
    const existing = byName.get(name);
    if (existing) return existing;
    const el: UmlElement = {
      id: createId('el'),
      packageId,
      kind,
      name,
      taggedValues: {},
      visibility: 'public',
      isAbstract: kind === 'interface' || kind === 'abstract_class',
      attributes: [],
      operations: [],
      enumLiterals: kind === 'enum' ? [] : undefined,
    };
    byName.set(name, el);
    elements.push(el);
    return el;
  };

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'py') {
    const classRegex = /^class\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?\s*:/gm;
    let m: RegExpExecArray | null;
    while ((m = classRegex.exec(content)) !== null) {
      const name = m[1];
      const bases = (m[2] ?? '')
        .split(',')
        .map((b) => b.trim())
        .filter((b) => b && b !== 'object' && b !== 'ABC');
      const isEnum = bases.includes('Enum');
      const el = ensure(name, isEnum ? 'enum' : 'class');
      for (const b of bases.filter((x) => x !== 'Enum')) {
        const parent = ensure(b, 'class');
        relations.push({
          id: createId('rel'),
          kind: 'generalization',
          sourceId: el.id,
          targetId: parent.id,
        });
      }
      // Extract methods inside class indentation block
      const rest = content.slice(m.index + m[0].length);
      const blockLines = rest.split(/\r?\n/);
      for (const bl of blockLines) {
        if (bl.length > 0 && !bl.startsWith(' ') && !bl.startsWith('\t')) break;
        const defMatch = bl.match(/^\s+def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/);
        if (defMatch) {
          const opName = defMatch[1];
          if (opName === '__init__') {
            const params = defMatch[2]
              .split(',')
              .map((p) => p.trim())
              .filter((p) => p && p !== 'self');
            for (const p of params) {
              const [pName, pType] = p.split(':').map((x) => x.trim());
              if (pName) {
                el.attributes.push({
                  id: createId('att'),
                  name: pName,
                  type: (pType || 'any').split('=')[0].trim(),
                  visibility: pName.startsWith('_') ? 'private' : 'public',
                });
              }
            }
          } else {
            const params = defMatch[2]
              .split(',')
              .map((p) => p.trim())
              .filter((p) => p && p !== 'self' && p !== 'cls')
              .map((p) => {
                const [pName, pType] = p.split(':').map((x) => x.trim());
                return { id: createId('p'), name: pName, type: (pType || 'any').split('=')[0].trim() };
              });
            el.operations.push({
              id: createId('op'),
              name: opName,
              returnType: defMatch[3]?.trim() || 'void',
              visibility: opName.startsWith('_') ? 'private' : 'public',
              parameters: params,
            });
          }
        }
      }
    }
  } else {
    // C++, Java, TypeScript, PHP, Rust, Go structural class/interface/struct/enum extractor
    const declRegex =
      /(?:export\s+|public\s+|private\s+|protected\s+)?(abstract\s+class|class|interface|enum|struct|trait)\s+([A-Za-z_]\w*)(?:<[^>]+>)?(?:\s*(?:extends|:)\s*([A-Za-z0-9_,\s:]+?))?(?:\s*implements\s+([A-Za-z0-9_,\s]+?))?\s*\{/g;

    let m: RegExpExecArray | null;
    while ((m = declRegex.exec(content)) !== null) {
      const [, rawKw, name, extClause, implClause] = m;
      const kw = rawKw.toLowerCase();
      const kind: UmlElement['kind'] =
        kw === 'interface' || kw === 'trait'
          ? 'interface'
          : kw === 'enum'
            ? 'enum'
            : kw === 'struct'
              ? 'struct'
              : kw.startsWith('abstract')
                ? 'abstract_class'
                : 'class';
      const el = ensure(name, kind);

      if (extClause) {
        for (const base of extClause.split(',').map((s) => s.replace(/public|private|protected|virtual/g, '').trim()).filter(Boolean)) {
          const parent = ensure(base, 'class');
          relations.push({
            id: createId('rel'),
            kind: 'generalization',
            sourceId: el.id,
            targetId: parent.id,
          });
        }
      }
      if (implClause) {
        for (const iface of implClause.split(',').map((s) => s.trim()).filter(Boolean)) {
          const parent = ensure(iface, 'interface');
          relations.push({
            id: createId('rel'),
            kind: 'realization',
            sourceId: el.id,
            targetId: parent.id,
          });
        }
      }

      // Extract balanced block
      let depth = 1;
      let idx = m.index + m[0].length;
      while (idx < content.length && depth > 0) {
        if (content[idx] === '{') depth++;
        else if (content[idx] === '}') depth--;
        idx++;
      }
      const body = content.slice(m.index + m[0].length, idx - 1);

      if (kind === 'enum') {
        const lits = body
          .split(/[,\n]/)
          .map((l) => l.replace(/=.*$/, '').replace(/case\s+/, '').replace(/;$/, '').trim())
          .filter((l) => /^[A-Za-z_]\w*$/.test(l));
        el.enumLiterals = lits;
        continue;
      }

      for (const rawLine of body.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;

        // TS/Rust-like method: public foo(a: string): number
        const tsMethod = line.match(
          /^(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(async)\s+)?(?:fn\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::|->)?\s*([A-Za-z0-9_<>\[\]| ?]+)?\s*[\{;]?$/
        );
        if (tsMethod && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(tsMethod[4])) {
          const [, vis, stat, isAsync, opName, rawParams, ret] = tsMethod;
          const params = rawParams
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p && !p.startsWith('&self') && !p.startsWith('&mut self'))
            .map((p) => {
              const colon = p.split(':').map((x) => x.trim());
              if (colon.length >= 2) {
                return { id: createId('p'), name: colon[0].replace(/^mut\s+/, ''), type: colon[1] };
              }
              const sp = p.split(/\s+/);
              return {
                id: createId('p'),
                type: sp.length > 1 ? sp.slice(0, -1).join(' ') : 'any',
                name: sp[sp.length - 1],
              };
            });
          el.operations.push({
            id: createId('op'),
            name: opName,
            returnType: ret?.trim() || 'void',
            visibility: (vis as UmlElement['visibility']) || 'public',
            isStatic: Boolean(stat),
            isAsync: Boolean(isAsync),
            parameters: params,
          });
          continue;
        }

        // Java/C++/PHP method: public int calculate(int a)
        const cMethod = line.match(
          /^(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(virtual)\s+)?([A-Za-z0-9_:<>]+)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/
        );
        if (cMethod && !['if', 'for', 'while', 'switch', 'return', 'new'].includes(cMethod[4])) {
          const [, vis, stat, virt, ret, opName, rawParams] = cMethod;
          const params = rawParams
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => {
              const sp = p.split(/\s+/);
              return {
                id: createId('p'),
                type: sp.length > 1 ? sp.slice(0, -1).join(' ') : 'any',
                name: sp[sp.length - 1].replace(/^\$/, ''),
              };
            });
          el.operations.push({
            id: createId('op'),
            name: opName,
            returnType: ret,
            visibility: (vis as UmlElement['visibility']) || 'public',
            isStatic: Boolean(stat),
            isVirtual: Boolean(virt),
            parameters: params,
          });
          continue;
        }

        // Attribute TS/Rust: private id: string;
        const tsAttr = line.match(
          /^(?:(public|private|protected|pub)\s+)?(?:(static)\s+)?(?:(readonly|final|const)\s+)?([A-Za-z_]\w*)\s*:\s*([^;=]+)(?:=\s*([^;]+))?[;,]?$/
        );
        if (tsAttr) {
          const [, vis, stat, ro, attName, attType, defVal] = tsAttr;
          el.attributes.push({
            id: createId('att'),
            name: attName,
            type: attType.trim(),
            visibility: vis === 'pub' ? 'public' : ((vis as UmlElement['visibility']) || 'private'),
            isStatic: Boolean(stat),
            isReadOnly: Boolean(ro),
            defaultValue: defVal?.trim(),
          });
          continue;
        }

        // Attribute Java/C++: private String email;
        const cAttr = line.match(
          /^(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(final|const)\s+)?([A-Za-z0-9_:<>\[\]]+)\s+\$?([A-Za-z_]\w*)\s*(?:=\s*([^;]+))?;$/
        );
        if (cAttr && !['return', 'throw', 'package', 'import'].includes(cAttr[4])) {
          const [, vis, stat, ro, attType, attName, defVal] = cAttr;
          el.attributes.push({
            id: createId('att'),
            name: attName,
            type: attType,
            visibility: (vis as UmlElement['visibility']) || 'private',
            isStatic: Boolean(stat),
            isReadOnly: Boolean(ro),
            defaultValue: defVal?.trim(),
          });
        }
      }
    }
  }

  return {
    sourceName: filename,
    diagramKind: 'class',
    elements,
    relations,
    preservedBodies,
  };
}

/**
 * Import Mermaid (.mmd) class diagrams
 */
export function importMermaid(filename: string, content: string, packageId: string): ImportResult {
  // Convert Mermaid classDiagram syntax into PlantUML-compatible syntax and reuse parser
  const normalized = content
    .replace(/^classDiagram\s*$/gm, '')
    .replace(/<\|--/g, '<|--')
    .replace(/<\|\.\./g, '<|..')
    .replace(/--\|>/g, '--|>')
    .replace(/\.\.\|>/g, '..|>');
  const parsed = parsePlantUml(normalized, packageId);
  return {
    sourceName: filename,
    diagramKind: parsed.diagramKind,
    elements: parsed.elements,
    relations: parsed.relations,
  };
}

/**
 * Import SQL DDL (.sql) CREATE TABLE statements
 */
export function importSql(filename: string, content: string, packageId: string): ImportResult {
  const elements: UmlElement[] = [];
  const relations: UmlRelation[] = [];
  const byTable = new Map<string, UmlElement>();

  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([A-Za-z_]\w*)[`"']?\s*\(([\s\S]*?)\);/gi;
  let m: RegExpExecArray | null;
  const pendingFks: Array<{ fromTable: string; toTable: string; col: string }> = [];

  while ((m = tableRegex.exec(content)) !== null) {
    const rawName = m[1];
    const className = rawName
      .split('_')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');
    const el: UmlElement = {
      id: createId('el'),
      packageId,
      kind: 'class',
      name: className,
      stereotype: 'Table',
      taggedValues: { table: rawName },
      visibility: 'public',
      attributes: [],
      operations: [],
    };
    byTable.set(rawName.toLowerCase(), el);
    elements.push(el);

    const bodyLines = m[2].split(/,\s*\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of bodyLines) {
      if (/^(PRIMARY|UNIQUE|CONSTRAINT|INDEX|KEY)\b/i.test(line)) {
        const fkMatch = line.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+[`"']?([A-Za-z_]\w*)[`"']?/i);
        if (fkMatch) {
          pendingFks.push({ fromTable: rawName.toLowerCase(), toTable: fkMatch[2].toLowerCase(), col: fkMatch[1].trim() });
        }
        continue;
      }
      const colMatch = line.match(/^[`"']?([A-Za-z_]\w*)[`"']?\s+([A-Za-z0-9_()]+)/);
      if (colMatch) {
        const colName = colMatch[1];
        const sqlType = colMatch[2].toUpperCase();
        const umlType = sqlType.startsWith('INT') || sqlType.startsWith('SERIAL')
          ? 'int'
          : sqlType.startsWith('BIGINT')
            ? 'long'
            : sqlType.startsWith('BOOL')
              ? 'bool'
              : sqlType.startsWith('DOUBLE') || sqlType.startsWith('NUMERIC') || sqlType.startsWith('DECIMAL')
                ? 'double'
                : sqlType.startsWith('TIMESTAMP') || sqlType.startsWith('DATETIME')
                  ? 'DateTime'
                  : sqlType.startsWith('DATE')
                    ? 'Date'
                    : sqlType === 'UUID'
                      ? 'UUID'
                      : 'string';

        el.attributes.push({
          id: createId('att'),
          name: colName,
          type: umlType,
          visibility: 'private',
          isReadOnly: /PRIMARY\s+KEY/i.test(line),
        });

        const inlineFk = line.match(/REFERENCES\s+[`"']?([A-Za-z_]\w*)[`"']?/i);
        if (inlineFk) {
          pendingFks.push({ fromTable: rawName.toLowerCase(), toTable: inlineFk[1].toLowerCase(), col: colName });
        }
      }
    }
  }

  for (const fk of pendingFks) {
    const src = byTable.get(fk.fromTable);
    const tgt = byTable.get(fk.toTable);
    if (src && tgt) {
      relations.push({
        id: createId('rel'),
        kind: 'directional_association',
        sourceId: src.id,
        targetId: tgt.id,
        sourceMultiplicity: '0..*',
        targetMultiplicity: '1',
        label: fk.col,
      });
    }
  }

  return { sourceName: filename, diagramKind: 'class', elements, relations };
}

/**
 * Import OpenAPI 3.x JSON or YAML schemas
 */
export function importOpenApi(filename: string, content: string, packageId: string): ImportResult {
  const doc = (filename.endsWith('.json') ? JSON.parse(content) : yaml.load(content)) as Record<string, any>;
  const schemas: Record<string, any> = doc?.components?.schemas ?? doc?.definitions ?? {};
  const elements: UmlElement[] = [];
  const relations: UmlRelation[] = [];
  const byName = new Map<string, UmlElement>();

  for (const [name, schema] of Object.entries(schemas)) {
    const isEnum = Array.isArray(schema?.enum);
    const el: UmlElement = {
      id: createId('el'),
      packageId,
      kind: isEnum ? 'enum' : 'class',
      name,
      stereotype: 'DTO',
      description: schema?.description,
      taggedValues: {},
      visibility: 'public',
      attributes: [],
      operations: [],
      enumLiterals: isEnum ? schema.enum.map(String) : undefined,
    };
    byName.set(name, el);
    elements.push(el);
  }

  for (const [name, schema] of Object.entries(schemas)) {
    const el = byName.get(name);
    if (!el || !schema?.properties) continue;
    for (const [propName, propDef] of Object.entries<any>(schema.properties)) {
      if (propDef?.$ref) {
        const refName = String(propDef.$ref).split('/').pop()!;
        const tgt = byName.get(refName);
        if (tgt) {
          relations.push({
            id: createId('rel'),
            kind: 'directional_association',
            sourceId: el.id,
            targetId: tgt.id,
            targetRole: propName,
            targetMultiplicity: '1',
          });
        }
        el.attributes.push({ id: createId('att'), name: propName, type: refName, visibility: 'public' });
      } else if (propDef?.type === 'array' && propDef?.items?.$ref) {
        const refName = String(propDef.items.$ref).split('/').pop()!;
        const tgt = byName.get(refName);
        if (tgt) {
          relations.push({
            id: createId('rel'),
            kind: 'composition',
            sourceId: el.id,
            targetId: tgt.id,
            targetRole: propName,
            targetMultiplicity: '0..*',
          });
        }
        el.attributes.push({ id: createId('att'), name: propName, type: `List<${refName}>`, visibility: 'public' });
      } else {
        const t = propDef?.type === 'integer' ? 'int' : propDef?.type === 'number' ? 'double' : propDef?.type === 'boolean' ? 'bool' : 'string';
        el.attributes.push({ id: createId('att'), name: propName, type: t, visibility: 'public' });
      }
    }
  }

  return { sourceName: filename, diagramKind: 'class', elements, relations };
}

/**
 * Import XMI 2.1 UML files (BouML xmi2import parity)
 */
export function importXmi(filename: string, content: string, packageId: string): ImportResult {
  const elements: UmlElement[] = [];
  const relations: UmlRelation[] = [];
  const xmiIdMap = new Map<string, UmlElement>();

  const classRegex = /<packagedElement[^>]*xmi:type="uml:(Class|Interface|Enumeration)"[^>]*xmi:id="([^"]+)"[^>]*name="([^"]+)"[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = classRegex.exec(content)) !== null) {
    const [, xmiType, xmiId, name] = m;
    const el: UmlElement = {
      id: createId('el'),
      packageId,
      kind: xmiType === 'Interface' ? 'interface' : xmiType === 'Enumeration' ? 'enum' : 'class',
      name,
      taggedValues: { xmiId },
      visibility: 'public',
      attributes: [],
      operations: [],
    };
    xmiIdMap.set(xmiId, el);
    elements.push(el);
  }

  const genRegex = /<generalization[^>]*general="([^"]+)"/gi;
  while ((m = genRegex.exec(content)) !== null) {
    const tgt = xmiIdMap.get(m[1]);
    if (tgt && elements.length > 1) {
      relations.push({
        id: createId('rel'),
        kind: 'generalization',
        sourceId: elements[elements.length - 1].id,
        targetId: tgt.id,
      });
    }
  }

  return { sourceName: filename, diagramKind: 'class', elements, relations };
}

/**
 * Universal Drag & Drop router
 */
export function importUniversalFile(
  filename: string,
  content: string,
  packageId: string
): ImportResult {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.puml') || lower.endsWith('.plantuml') || lower.endsWith('.pu')) {
    const parsed = parsePlantUml(content, packageId);
    return { sourceName: filename, ...parsed };
  }
  if (lower.endsWith('.mmd') || lower.endsWith('.mermaid')) {
    return importMermaid(filename, content, packageId);
  }
  if (lower.endsWith('.sql')) {
    return importSql(filename, content, packageId);
  }
  if (lower.endsWith('.xmi')) {
    return importXmi(filename, content, packageId);
  }
  if (
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    (lower.endsWith('.json') && (content.includes('"openapi"') || content.includes('"swagger"')))
  ) {
    return importOpenApi(filename, content, packageId);
  }
  return reverseSourceCode(filename, content, packageId);
}
