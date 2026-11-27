import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { LANGUAGE_LABELS, TargetLanguage } from '../../model/schema';
import { generateElementCode, generateStateMachineCode } from '../../engines/codegen';
import { generatePlantUml } from '../../engines/plantuml/generator';

const ALL_LANGS: TargetLanguage[] = [
  'typescript',
  'cpp',
  'java',
  'python',
  'php',
  'sql',
  'rust',
  'go',
  'idl',
];

export const CodePreviewPanel: React.FC<{ mode: 'code' | 'plantuml' }> = ({ mode }) => {
  const {
    project,
    activeDiagramId,
    selectedElementId,
    targetLanguage,
    setTargetLanguage,
    applyPlantUmlToActiveDiagram,
    showToast,
  } = useProjectStore();

  const [copied, setCopied] = useState(false);
  const [activeFileIdx, setActiveFileIdx] = useState(0);

  const selectedEl = selectedElementId ? project.elements[selectedElementId] : undefined;
  const activeDiag = project.diagrams[activeDiagramId];

  const generatedFiles = useMemo(() => {
    if (activeDiag?.kind === 'state' && !selectedEl) {
      return [generateStateMachineCode(project, activeDiag.id, targetLanguage)];
    }
    if (selectedEl) {
      return generateElementCode(project, selectedEl, targetLanguage);
    }
    const firstClass = Object.values(project.elements).find((e) => e.kind === 'class');
    if (firstClass) return generateElementCode(project, firstClass, targetLanguage);
    return [{ filename: 'empty.txt', language: targetLanguage, content: '// Sélectionnez une classe sur le canvas pour prévisualiser le code généré.' }];
  }, [project, selectedEl, activeDiag, targetLanguage]);

  const safeIdx = Math.min(activeFileIdx, Math.max(0, generatedFiles.length - 1));
  const currentFile = generatedFiles[safeIdx];

  const syncedPlantUml = useMemo(
    () => generatePlantUml(project, activeDiagramId),
    [project, activeDiagramId]
  );

  const [pumlDraft, setPumlDraft] = useState(syncedPlantUml);
  useEffect(() => {
    setPumlDraft(syncedPlantUml);
  }, [syncedPlantUml]);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    showToast('Copié dans le presse-papiers.', 'success');
    setTimeout(() => setCopied(false), 1800);
  };

  if (mode === 'plantuml') {
    return (
      <div className="flex flex-col h-full">
        <div className="p-2.5 border-b border-slate-800 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-emerald-300">
            PlantUML Synchronisé (Bidirectionnel)
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => applyPlantUmlToActiveDiagram(pumlDraft)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/25 hover:bg-emerald-600/40 text-[11px] text-emerald-200 cursor-pointer"
              title="Appliquer le code PlantUML au diagramme"
            >
              <RefreshCw className="w-3 h-3" />
              Sync → Canvas
            </button>
            <button
              onClick={() => handleCopy(pumlDraft)}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              title="Copier le code PlantUML"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        <textarea
          value={pumlDraft}
          onChange={(e) => setPumlDraft(e.target.value)}
          spellCheck={false}
          className="flex-1 w-full bg-slate-950 p-3 font-mono text-xs text-emerald-200/95 outline-none resize-none leading-relaxed"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2.5 border-b border-slate-800 flex items-center justify-between gap-2">
        <select
          value={targetLanguage}
          onChange={(e) => {
            setTargetLanguage(e.target.value as TargetLanguage);
            setActiveFileIdx(0);
          }}
          className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-cyan-200 font-medium"
        >
          {ALL_LANGS.map((lang) => (
            <option key={lang} value={lang}>
              {LANGUAGE_LABELS[lang]}
            </option>
          ))}
        </select>

        <button
          onClick={() => handleCopy(currentFile.content)}
          className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          Copier
        </button>
      </div>

      {generatedFiles.length > 1 && (
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-2 pt-1.5 gap-1">
          {generatedFiles.map((f, idx) => (
            <button
              key={f.filename}
              onClick={() => setActiveFileIdx(idx)}
              className={`px-2.5 py-1 text-[11px] font-mono rounded-t cursor-pointer ${
                idx === safeIdx
                  ? 'bg-slate-900 text-cyan-300 border-t border-x border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.filename}
            </button>
          ))}
        </div>
      )}

      <div className="px-3 py-1.5 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-mono">
        <span>{currentFile.filename}</span>
        <span className="text-emerald-400/90">Corps préservés BouML actifs</span>
      </div>

      <pre className="flex-1 overflow-auto bg-slate-950 p-3 font-mono text-xs text-slate-200 leading-relaxed whitespace-pre">
        <code>{currentFile.content}</code>
      </pre>
    </div>
  );
};
