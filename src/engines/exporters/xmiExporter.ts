import { BoumlProject } from '../../model/schema';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function exportXmi2(project: BoumlProject): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1" xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">',
    `  <uml:Model xmi:id="${esc(project.id)}" name="${esc(project.name)}">`,
  ];

  for (const el of Object.values(project.elements)) {
    const xmiType =
      el.kind === 'interface'
        ? 'uml:Interface'
        : el.kind === 'enum'
          ? 'uml:Enumeration'
          : el.kind === 'usecase'
            ? 'uml:UseCase'
            : el.kind === 'actor'
              ? 'uml:Actor'
              : 'uml:Class';
    lines.push(`    <packagedElement xmi:type="${xmiType}" xmi:id="${esc(el.id)}" name="${esc(el.name)}">`);
    for (const att of el.attributes) {
      lines.push(
        `      <ownedAttribute xmi:id="${esc(att.id)}" name="${esc(att.name)}" visibility="${att.visibility}" type="${esc(att.type)}" />`
      );
    }
    for (const op of el.operations) {
      lines.push(`      <ownedOperation xmi:id="${esc(op.id)}" name="${esc(op.name)}" visibility="${op.visibility}">`);
      for (const p of op.parameters) {
        lines.push(`        <ownedParameter xmi:id="${esc(p.id)}" name="${esc(p.name)}" type="${esc(p.type)}" />`);
      }
      lines.push('      </ownedOperation>');
    }
    lines.push('    </packagedElement>');
  }

  lines.push('  </uml:Model>', '</xmi:XMI>');
  return lines.join('\n');
}
