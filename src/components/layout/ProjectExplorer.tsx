import React, { useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Folder,
  Layers,
  Plus,
  Upload,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { DIAGRAM_LABELS, DiagramKind } from '../../model/schema';

const ALL_DIAGRAM_KINDS: DiagramKind[] = [
  'class',
  'usecase',
  'sequence',
  'communication',
  'component',
  'deployment',
  'activity',
  'state',
  'object',
];

export const ProjectExplorer: React.FC = () => {
  const {
    project,
    activeDiagramId,
    selectedElementId,
    setActiveDiagram,
    selectElement,
    addDiagram,
    addPackage,
    openContextMenu,
    importFiles,
  } = useProjectStore();

  const [newDiagKind, setNewDiagKind] = useState<DiagramKind>('class');
  const [showNewDiag, setShowNewDiag] = useState(false);
  const [expandedPkgs, setExpandedPkgs] = useState<Record<string, boolean>>({});

  const togglePkg = (id: string) =>
    setExpandedPkgs((p) => ({ ...p, [id]: !(p[id] ?? true) }));

  const handleManualImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const loaded: Array<{ name: string; content: string }> = [];
    for (const f of Array.from(fileList)) {
      loaded.push({ name: f.name, content: await f.text() });
    }
    await importFiles(loaded);
    e.target.value = '';
  };

  return (
    <aside
      onContextMenu={(e) => e.preventDefault()}
      className="w-60 bg-slate-900/90 border-r border-slate-800 flex flex-col shrink-0 overflow-hidden"
    >
      {/* Diagrams section */}
      <div className="p-2.5 border-b border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Diagrammes ({Object.keys(project.diagrams).length})
          </span>
          <button
            onClick={() => setShowNewDiag((v) => !v)}
            className="p-1 rounded hover:bg-slate-800 text-indigo-400 cursor-pointer"
            title="Nouveau diagramme UML"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {showNewDiag && (
          <div className="mb-2 p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
            <select
              value={newDiagKind}
              onChange={(e) => setNewDiagKind(e.target.value as DiagramKind)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
            >
              {ALL_DIAGRAM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DIAGRAM_LABELS[k]}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                addDiagram(DIAGRAM_LABELS[newDiagKind], newDiagKind);
                setShowNewDiag(false);
              }}
              className="w-full py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-medium text-white cursor-pointer"
            >
              Créer le diagramme
            </button>
          </div>
        )}

        <div className="space-y-0.5 max-h-44 overflow-y-auto">
          {Object.values(project.diagrams).map((diag) => (
            <button
              key={diag.id}
              onClick={() => setActiveDiagram(diag.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  targetType: 'explorer-diagram',
                  targetId: diag.id,
                });
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors cursor-pointer ${
                diag.id === activeDiagramId
                  ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                  : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <div className="truncate">
                <div className="truncate font-medium">{diag.name}</div>
                <div className="text-[10px] text-slate-500">{DIAGRAM_LABELS[diag.kind]}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Packages & Model Elements Tree */}
      <div className="flex-1 p-2.5 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Explorateur Modèle
          </span>
          <button
            onClick={() => addPackage(`package_${project.packages.length + 1}`, project.packages[0]?.id ?? null)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            title="Nouveau package"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-1">
          {project.packages.map((pkg) => {
            const expanded = expandedPkgs[pkg.id] ?? true;
            const pkgEls = Object.values(project.elements).filter((e) => e.packageId === pkg.id);
            return (
              <div key={pkg.id}>
                <button
                  onClick={() => togglePkg(pkg.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      targetType: 'explorer-package',
                      targetId: pkg.id,
                    });
                  }}
                  className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  {expanded ? (
                    <ChevronDown className="w-3 h-3 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-slate-500" />
                  )}
                  <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate font-medium">{pkg.name}</span>
                  <span className="ml-auto text-[10px] text-slate-500">{pkgEls.length}</span>
                </button>

                {expanded && (
                  <div className="ml-4 pl-2 border-l border-slate-800 space-y-0.5 mt-0.5">
                    {pkgEls.map((el) => (
                      <button
                        key={el.id}
                        onClick={() => selectElement(el.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          selectElement(el.id);
                          openContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            targetType: 'explorer-element',
                            targetId: el.id,
                          });
                        }}
                        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left transition-colors cursor-pointer ${
                          selectedElementId === el.id
                            ? 'bg-indigo-600/30 text-indigo-200'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                        }`}
                      >
                        <Box className="w-3 h-3 text-indigo-400 shrink-0" />
                        <span className="truncate">{el.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Universal Import Drop Hint */}
      <div className="p-2.5 border-t border-slate-800 bg-slate-950/60">
        <label className="flex items-center justify-center gap-2 w-full py-2 px-2 rounded-lg border border-dashed border-slate-700 hover:border-indigo-500 text-xs text-slate-300 hover:text-indigo-200 transition-colors cursor-pointer">
          <Upload className="w-3.5 h-3.5 text-indigo-400" />
          <span>Importer Code / .puml / .sql</span>
          <input
            type="file"
            multiple
            accept=".puml,.plantuml,.mmd,.sql,.xmi,.yaml,.yml,.json,.ts,.tsx,.java,.cpp,.h,.hpp,.py,.php,.rs,.go"
            onChange={handleManualImport}
            className="hidden"
          />
        </label>
        <p className="text-[10px] text-slate-500 text-center mt-1">
          Ou glissez-déposez vos fichiers sur le canvas
        </p>
      </div>
    </aside>
  );
};
