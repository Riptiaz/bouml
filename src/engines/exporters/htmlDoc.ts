import { BoumlProject, DIAGRAM_LABELS, VISIBILITY_SYMBOLS } from '../../model/schema';
import { generatePlantUml } from '../plantuml/generator';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportHtmlDocumentation(project: BoumlProject): string {
  const elements = Object.values(project.elements);
  const diagrams = Object.values(project.diagrams);

  const elementsHtml = elements
    .map((el) => {
      const attrs = el.attributes
        .map(
          (a) =>
            `<li><code>${VISIBILITY_SYMBOLS[a.visibility]} ${escapeHtml(a.name)} : ${escapeHtml(a.type)}</code></li>`
        )
        .join('');
      const ops = el.operations
        .map(
          (o) =>
            `<li><code>${VISIBILITY_SYMBOLS[o.visibility]} ${escapeHtml(o.name)}(${o.parameters.map((p) => `${escapeHtml(p.name)}: ${escapeHtml(p.type)}`).join(', ')}) : ${escapeHtml(o.returnType)}</code></li>`
        )
        .join('');
      return `
      <section class="card" id="${el.id}">
        <div class="badge">${escapeHtml(el.kind)}${el.stereotype ? ` &laquo;${escapeHtml(el.stereotype)}&raquo;` : ''}</div>
        <h3>${escapeHtml(el.name)}</h3>
        ${el.description ? `<p class="desc">${escapeHtml(el.description)}</p>` : ''}
        ${attrs ? `<h4>Attributs</h4><ul>${attrs}</ul>` : ''}
        ${ops ? `<h4>Opérations</h4><ul>${ops}</ul>` : ''}
      </section>`;
    })
    .join('\n');

  const diagramsHtml = diagrams
    .map(
      (d) => `
      <section class="card">
        <div class="badge">${escapeHtml(DIAGRAM_LABELS[d.kind])}</div>
        <h3>${escapeHtml(d.name)}</h3>
        <pre><code>${escapeHtml(generatePlantUml(project, d.id))}</code></pre>
      </section>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Documentation UML — ${escapeHtml(project.name)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; line-height: 1.5; }
    h1, h2, h3 { color: #f8fafc; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; }
    .badge { display: inline-block; font-size: 12px; color: #a5b4fc; background: #312e81; padding: 2px 8px; border-radius: 999px; margin-bottom: 6px; }
    .desc { color: #94a3b8; font-size: 14px; }
    code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; color: #cbd5e1; }
    pre { background: #020617; padding: 12px; border-radius: 8px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>${escapeHtml(project.name)}</h1>
  <p class="desc">${escapeHtml(project.description || 'Documentation générée par BouML v2')}</p>
  <h2>Diagrammes (${diagrams.length})</h2>
  <div class="grid">${diagramsHtml}</div>
  <h2>Éléments du modèle (${elements.length})</h2>
  <div class="grid">${elementsHtml}</div>
</body>
</html>`;
}
