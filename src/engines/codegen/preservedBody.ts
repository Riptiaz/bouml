import { TargetLanguage } from '../../model/schema';

export function getBodyMarkers(
  lang: TargetLanguage,
  operationId: string
): { begin: string; end: string } {
  if (lang === 'python') {
    return {
      begin: `## Bouml preserved body begin ${operationId}`,
      end: `## Bouml preserved body end ${operationId}`,
    };
  }
  if (lang === 'sql') {
    return {
      begin: `-- Bouml preserved body begin ${operationId}`,
      end: `-- Bouml preserved body end ${operationId}`,
    };
  }
  return {
    begin: `// Bouml preserved body begin ${operationId}`,
    end: `// Bouml preserved body end ${operationId}`,
  };
}

export function wrapPreservedBody(
  lang: TargetLanguage,
  operationId: string,
  body: string | undefined,
  indent: string,
  preserveBodies: boolean
): string {
  const defaultStub =
    lang === 'python'
      ? 'pass'
      : lang === 'rust'
        ? 'todo!()'
        : '// TODO: implement';

  const content = (body && body.trim().length > 0 ? body : defaultStub)
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');

  if (!preserveBodies) {
    return content;
  }

  const { begin, end } = getBodyMarkers(lang, operationId);
  return `${indent}${begin}\n${content}\n${indent}${end}`;
}

/**
 * Extracts all BouML preserved method bodies from existing source code
 * for lossless round-trip regeneration.
 */
export function extractPreservedBodies(
  sourceCode: string
): Record<string, string> {
  const result: Record<string, string> = {};
  const regex =
    /(?:\/\/|##|--)\s*Bouml preserved body begin\s+([A-Za-z0-9_-]+)\s*\r?\n([\s\S]*?)\r?\n\s*(?:\/\/|##|--)\s*Bouml preserved body end\s+\1/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(sourceCode)) !== null) {
    const opId = match[1];
    const rawBody = match[2];
    const lines = rawBody.split(/\r?\n/);
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const minIndent = nonEmpty.reduce((min, l) => {
      const spaces = l.match(/^(\s*)/)?.[1].length ?? 0;
      return Math.min(min, spaces);
    }, Infinity);
    const dedented =
      minIndent === Infinity
        ? rawBody.trim()
        : lines.map((l) => l.slice(minIndent)).join('\n');
    result[opId] = dedented;
  }
  return result;
}
