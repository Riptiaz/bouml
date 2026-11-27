import { BoumlProject, TargetLanguage, UmlElement } from '../../model/schema';
import {
  GeneratedFile,
  generateCpp,
  generateGo,
  generateIdl,
  generateJava,
  generatePhp,
  generatePython,
  generateRust,
  generateSql,
  generateStateMachineCode,
  generateTypeScript,
} from './generators';

export type { GeneratedFile };
export { extractPreservedBodies, getBodyMarkers } from './preservedBody';
export { generateStateMachineCode };

const CODE_ELIGIBLE_KINDS = new Set([
  'class',
  'interface',
  'abstract_class',
  'enum',
  'struct',
  'record',
]);

export function generateElementCode(
  project: BoumlProject,
  element: UmlElement,
  lang: TargetLanguage
): GeneratedFile[] {
  if (!CODE_ELIGIBLE_KINDS.has(element.kind)) {
    return [
      {
        filename: `${element.name}.txt`,
        language: lang,
        content: `// L'élément "${element.name}" (${element.kind}) n'est pas directement générable en code ${lang}.`,
      },
    ];
  }

  switch (lang) {
    case 'cpp':
      return generateCpp(project, element);
    case 'java':
      return generateJava(project, element);
    case 'python':
      return generatePython(project, element);
    case 'typescript':
      return generateTypeScript(project, element);
    case 'php':
      return generatePhp(project, element);
    case 'sql':
      return generateSql(project, element);
    case 'rust':
      return generateRust(project, element);
    case 'go':
      return generateGo(project, element);
    case 'idl':
      return generateIdl(project, element);
  }
}

export function generateProjectCode(
  project: BoumlProject,
  lang: TargetLanguage
): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  for (const el of Object.values(project.elements)) {
    if (CODE_ELIGIBLE_KINDS.has(el.kind)) {
      files.push(...generateElementCode(project, el, lang));
    }
  }
  return files;
}
