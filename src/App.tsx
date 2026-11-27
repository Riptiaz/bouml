import React, { useEffect } from 'react';
import { Code2, FileCode2, SlidersHorizontal } from 'lucide-react';
import { Toolbar } from './components/layout/Toolbar';
import { ProjectExplorer } from './components/layout/ProjectExplorer';
import { UmlCanvas } from './components/canvas/UmlCanvas';
import { ContextMenu } from './components/canvas/ContextMenu';
import { GuidedInspector } from './components/inspector/GuidedInspector';
import { CodePreviewPanel } from './components/codepreview/CodePreviewPanel';
import { StudioModals } from './components/modals/StudioModals';
import { DragDropOverlay } from './components/dropzone/DragDropOverlay';
import { useProjectStore } from './store/useProjectStore';
import { saveAsFile, saveProjectFile } from './utils/fileSystem';

export const App: React.FC = () => {
  const {
    rightPanelTab,
    setRightPanelTab,
    undo,
    redo,
    toast,
    project,
    activeDiagramId,
    showToast,
  } = useProjectStore();

  // Global guarantee: NEVER show native WebView context menu anywhere in the app
  // (except standard text copy/paste inside explicit input/textarea fields).
  useEffect(() => {
    const blockWebviewContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (!isTextInput) {
        e.preventDefault();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const currProj = useProjectStore.getState().project;
        const suggested = `${currProj.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'projet'}.bouml.json`;
        if (e.shiftKey) {
          void saveAsFile({
            suggestedName: suggested,
            content: JSON.stringify(currProj, null, 2),
            mimeType: 'application/json',
            description: 'Projet BouML v2 (.bouml.json)',
            extensions: ['.json'],
            linkAsProjectFile: true,
          }).then((res) => {
            if (res.saved) showToast(`Projet enregistré sous "${res.filename ?? suggested}".`, 'success');
          });
        } else {
          void saveProjectFile(suggested, JSON.stringify(currProj, null, 2)).then((res) => {
            if (res.saved) showToast(`Projet enregistré (${res.filename ?? suggested}).`, 'success');
          });
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('contextmenu', blockWebviewContextMenu, { capture: false });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('contextmenu', blockWebviewContextMenu, { capture: false });
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [undo, redo, showToast]);

  const activeDiag = project.diagrams[activeDiagramId];

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <Toolbar />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <ProjectExplorer />

        <main className="flex-1 flex flex-col min-w-0 relative">
          <UmlCanvas />

          {/* Status bar */}
          <footer className="h-6 bg-slate-900 border-t border-slate-800 px-3 flex items-center justify-between text-[10px] text-slate-400 shrink-0">
            <div className="flex items-center gap-3">
              <span>Diagramme : <strong className="text-slate-200">{activeDiag?.name ?? '—'}</strong></span>
              <span>Éléments : {Object.keys(project.elements).length}</span>
              <span>Relations : {Object.keys(project.relations).length}</span>
            </div>
            <div>
              Clic droit sur une classe ou le canvas pour le menu UML • Glissez un lien entre deux poignées
            </div>
          </footer>
        </main>

        {/* Right Panel: Guided Inspector / Real-Time Code Split View / PlantUML Sync */}
        <aside
          onContextMenu={(e) => {
            const t = e.target as HTMLElement;
            if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') e.preventDefault();
          }}
          className="w-88 bg-slate-900/95 border-l border-slate-800 flex flex-col shrink-0 overflow-hidden"
        >
          <div className="flex border-b border-slate-800 shrink-0">
            <button
              onClick={() => setRightPanelTab('inspector')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                rightPanelTab === 'inspector'
                  ? 'border-indigo-500 text-indigo-300 bg-slate-950/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Inspecteur
            </button>
            <button
              onClick={() => setRightPanelTab('code')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                rightPanelTab === 'code'
                  ? 'border-cyan-500 text-cyan-300 bg-slate-950/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Code Live
            </button>
            <button
              onClick={() => setRightPanelTab('plantuml')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                rightPanelTab === 'plantuml'
                  ? 'border-emerald-500 text-emerald-300 bg-slate-950/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              PlantUML
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {rightPanelTab === 'inspector' && <GuidedInspector />}
            {rightPanelTab === 'code' && <CodePreviewPanel mode="code" />}
            {rightPanelTab === 'plantuml' && <CodePreviewPanel mode="plantuml" />}
          </div>
        </aside>
      </div>

      <ContextMenu />
      <StudioModals />
      <DragDropOverlay />

      {toast && (
        <div
          className={`fixed bottom-9 right-4 z-50 px-3.5 py-2 rounded-lg shadow-xl border text-xs font-medium ${
            toast.kind === 'error'
              ? 'bg-rose-950 border-rose-500/60 text-rose-100'
              : toast.kind === 'success'
                ? 'bg-emerald-950 border-emerald-500/60 text-emerald-100'
                : 'bg-slate-900 border-indigo-500/60 text-indigo-100'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default App;
