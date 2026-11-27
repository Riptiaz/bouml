import React, { useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Download,
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  Moon,
  Plus,
  Redo2,
  Save,
  SaveAll,
  Settings,
  Sparkles,
  Sun,
  Undo2,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { BoumlProject } from '../../model/schema';
import { saveAsFile, saveProjectFile } from '../../utils/fileSystem';

export const Toolbar: React.FC = () => {
  const {
    project,
    past,
    future,
    theme,
    toggleTheme,
    undo,
    redo,
    newProject,
    loadProject,
    addElement,
    runAutoLayout,
    setActiveModal,
    openAiAssistant,
    issues,
    rightPanelTab,
    setRightPanelTab,
    showToast,
  } = useProjectStore();

  const openFileRef = useRef<HTMLInputElement>(null);

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;

  const suggestedFilename = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'projet'}.bouml.json`;

  const handleSave = async () => {
    const res = await saveProjectFile(suggestedFilename, JSON.stringify(project, null, 2));
    if (res.saved) {
      showToast(`Projet enregistré (${res.filename ?? suggestedFilename}).`, 'success');
    }
  };

  const handleSaveAs = async () => {
    const res = await saveAsFile({
      suggestedName: suggestedFilename,
      content: JSON.stringify(project, null, 2),
      mimeType: 'application/json',
      description: 'Projet BouML v2 (.bouml.json)',
      extensions: ['.json'],
      linkAsProjectFile: true,
    });
    if (res.saved) {
      showToast(`Projet enregistré sous "${res.filename ?? suggestedFilename}".`, 'success');
    }
  };

  const handleOpenFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BoumlProject;
      if (parsed.schemaVersion === '2.0' && parsed.elements && parsed.diagrams) {
        loadProject(parsed);
        showToast(`Projet "${parsed.name}" chargé.`, 'success');
      } else {
        showToast('Fichier projet BouML v2 invalide.', 'error');
      }
    } catch {
      showToast('Impossible de lire le fichier JSON.', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const btnCls =
    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800 border border-transparent hover:border-slate-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <header className="h-12 bg-slate-900/95 border-b border-slate-800 px-3 flex items-center justify-between gap-2 shrink-0">
      {/* Left: Brand & File ops */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-2 pr-2 border-r border-slate-800">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-black text-xs text-white shadow">
            B2
          </div>
          <div className="leading-tight">
            <div className="text-xs font-bold text-white tracking-tight">BouML v2</div>
            <div className="text-[10px] text-slate-400 truncate max-w-[130px]">{project.name}</div>
          </div>
        </div>

        <button className={btnCls} onClick={() => newProject()} title="Nouveau projet">
          <FilePlus2 className="w-3.5 h-3.5 text-slate-300" />
        </button>
        <button className={btnCls} onClick={() => openFileRef.current?.click()} title="Ouvrir (.bouml.json)">
          <FolderOpen className="w-3.5 h-3.5 text-slate-300" />
        </button>
        <input ref={openFileRef} type="file" accept=".json" className="hidden" onChange={handleOpenFile} />
        <button className={btnCls} onClick={handleSave} title="Enregistrer (Ctrl+S)">
          <Save className="w-3.5 h-3.5 text-slate-300" />
        </button>
        <button className={btnCls} onClick={handleSaveAs} title="Enregistrer sous... (Ctrl+Shift+S)">
          <SaveAll className="w-3.5 h-3.5 text-slate-300" />
        </button>

        <div className="h-5 w-px bg-slate-800 mx-0.5" />

        <button className={btnCls} onClick={undo} disabled={past.length === 0} title="Annuler (Ctrl+Z)">
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button className={btnCls} onClick={redo} disabled={future.length === 0} title="Rétablir (Ctrl+Y)">
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        <div className="h-5 w-px bg-slate-800 mx-0.5" />

        {/* Quick Create */}
        <button
          className={btnCls}
          onClick={() => addElement('class', `Classe${Object.keys(project.elements).length + 1}`)}
        >
          <Plus className="w-3.5 h-3.5 text-indigo-400" />
          Classe
        </button>
        <button
          className={btnCls}
          onClick={() => addElement('interface', `IInterface${Object.keys(project.elements).length + 1}`)}
        >
          <Plus className="w-3.5 h-3.5 text-emerald-400" />
          Interface
        </button>
        <button
          className={btnCls}
          onClick={() => runAutoLayout()}
          title="Réorganiser automatiquement le diagramme (ELK / Lifelines)"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-cyan-400" />
          Auto-Layout
        </button>
      </div>

      {/* Right: Unified AI Assistant + Validation + Code Preview + Export + Theme + Settings */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => openAiAssistant()}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 shadow-md shadow-indigo-500/20 transition-all cursor-pointer"
          title="Modifier le diagramme actuel ou générer depuis un cahier des charges"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Assistant IA
        </button>

        <button
          onClick={() => setActiveModal('validation')}
          className={`${btnCls} ${errorCount > 0 ? 'text-rose-300 border-rose-500/40 bg-rose-950/30' : ''}`}
          title="Vérification de cohérence UML & SOLID"
        >
          {errorCount > 0 || warnCount > 0 ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          )}
          <span>{errorCount + warnCount}</span>
        </button>

        <button
          onClick={() => setRightPanelTab(rightPanelTab === 'code' ? 'inspector' : 'code')}
          className={`${btnCls} ${rightPanelTab === 'code' ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200' : ''}`}
          title="Aperçu Code Temps Réel"
        >
          <Code2 className="w-3.5 h-3.5 text-cyan-400" />
          Code
        </button>

        <button
          onClick={() => setActiveModal('export')}
          className={btnCls}
          title="Exporter en PNG, Code, PlantUML, HTML Doc, XMI 2.1"
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          Exporter
        </button>

        <button
          onClick={toggleTheme}
          className={btnCls}
          title={theme === 'dark' ? 'Passer en Thème Clair' : 'Passer en Thème Sombre'}
        >
          {theme === 'dark' ? (
            <Sun className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-indigo-500" />
          )}
        </button>

        <button
          onClick={() => setActiveModal('ai_settings')}
          className={btnCls}
          title="Paramètres → Intelligence Artificielle"
        >
          <Settings className="w-3.5 h-3.5 text-slate-300" />
        </button>
      </div>
    </header>
  );
};
