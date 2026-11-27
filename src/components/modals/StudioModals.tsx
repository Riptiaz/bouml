import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  KeyRound,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import {
  askGeminiCopilot,
  CopilotAction,
  GEMINI_MODEL,
  generateUmlFromSpec,
  loadApiKey,
  saveApiKey,
  testGeminiConnection,
} from '../../ai/geminiClient';
import { generateProjectCode } from '../../engines/codegen';
import { generatePlantUml } from '../../engines/plantuml/generator';
import { exportHtmlDocumentation } from '../../engines/exporters/htmlDoc';
import { exportXmi2 } from '../../engines/exporters/xmiExporter';
import { LANGUAGE_LABELS } from '../../model/schema';

export const StudioModals: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    project,
    activeDiagramId,
    targetLanguage,
    issues,
    selectElement,
    applyAiPlantUml,
    applyPlantUmlToActiveDiagram,
    applyMethodBodies,
    applyAiTestClass,
    copilotContext,
    showToast,
  } = useProjectStore();

  // AI Settings state
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Spec Wizard state
  const [specText, setSpecText] = useState('');
  const [generatingSpec, setGeneratingSpec] = useState(false);

  // Copilot state
  const [copilotAction, setCopilotAction] = useState<CopilotAction>('audit_solid');
  const [customPrompt, setCustomPrompt] = useState('');
  const [copilotAnswer, setCopilotAnswer] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);

  useEffect(() => {
    loadApiKey().then(setApiKey);
  }, [activeModal]);

  const executeCopilot = async (actionToRun: CopilotAction) => {
    const key = apiKey || (await loadApiKey());
    if (!key) {
      showToast('Configurez d\'abord votre clé API Google AI Studio.', 'error');
      setActiveModal('ai_settings');
      return;
    }
    setCopilotLoading(true);
    setCopilotAnswer('');
    try {
      const targetEl = copilotContext?.elementId
        ? project.elements[copilotContext.elementId] ?? null
        : null;
      const result = await askGeminiCopilot(
        key,
        actionToRun,
        project,
        targetEl,
        targetLanguage,
        customPrompt
      );

      if (result.kind === 'bodies' && targetEl) {
        const applied = applyMethodBodies(targetEl.id, targetLanguage, result.bodies);
        if (applied > 0) {
          setActiveModal(null);
          return;
        }
      } else if (result.kind === 'test_class' && targetEl) {
        await applyAiTestClass(targetEl.id, targetLanguage, result.plantUml, result.bodies);
        setActiveModal(null);
        return;
      } else if (result.kind === 'plantuml') {
        await applyPlantUmlToActiveDiagram(result.plantUml);
        if (result.summary) {
          showToast(`SOLID appliqué : ${result.summary}`, 'success');
        }
        setActiveModal(null);
        return;
      } else if (result.kind === 'text') {
        setCopilotAnswer(result.text);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setCopilotLoading(false);
    }
  };

  useEffect(() => {
    if (activeModal === 'copilot' && copilotContext?.initialAction) {
      setCopilotAction(copilotContext.initialAction);
      setCopilotAnswer('');
      // Auto-run non-custom right-click AI actions immediately so user sees result directly
      if (copilotContext.initialAction !== 'custom') {
        void executeCopilot(copilotContext.initialAction);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal, copilotContext]);

  if (!activeModal) return null;

  const close = () => setActiveModal(null);

  const downloadText = (filename: string, content: string, mime = 'text/plain') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveKey = async () => {
    await saveApiKey(apiKey);
    showToast('Clé API Google AI Studio enregistrée de manière sécurisée.', 'success');
  };

  const handleTestKey = async () => {
    setTesting(true);
    setTestResult(null);
    await saveApiKey(apiKey);
    const res = await testGeminiConnection(apiKey);
    setTestResult(res);
    setTesting(false);
  };

  const handleSpecFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.pdf')) {
      // Basic text extraction fallback for PDF streams in web/desktop
      const buf = await file.arrayBuffer();
      const raw = new TextDecoder('latin1').decode(buf);
      const readable = raw.replace(/[^\x20-\x7E\xA0-\xFF\n\r]/g, ' ').replace(/\s{3,}/g, '\n');
      setSpecText(readable.slice(0, 24000));
      showToast(`Fichier PDF "${file.name}" chargé.`, 'info');
    } else {
      setSpecText(await file.text());
      showToast(`Cahier des charges "${file.name}" chargé.`, 'info');
    }
    e.target.value = '';
  };

  const handleRunSpecToUml = async () => {
    if (!specText.trim()) {
      showToast('Veuillez saisir ou importer un cahier des charges.', 'error');
      return;
    }
    const key = apiKey || (await loadApiKey());
    if (!key) {
      showToast('Configurez d\'abord votre clé API Google AI Studio.', 'error');
      setActiveModal('ai_settings');
      return;
    }
    setGeneratingSpec(true);
    try {
      const plantUmlText = await generateUmlFromSpec(key, specText);
      await applyAiPlantUml(plantUmlText);
      close();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setGeneratingSpec(false);
    }
  };

  const handleRunCopilot = () => executeCopilot(copilotAction);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[86vh] flex flex-col overflow-hidden">
        {/* AI SETTINGS MODAL */}
        {activeModal === 'ai_settings' && (
          <>
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-bold text-white">
                  Paramètres → Intelligence Artificielle (Google AI Studio)
                </h2>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-lg bg-indigo-950/50 border border-indigo-500/30 text-indigo-200 flex items-center justify-between">
                <span>Moteur IA exclusif configuré :</span>
                <span className="font-mono font-bold px-2 py-0.5 rounded bg-indigo-600/40 text-white">
                  {GEMINI_MODEL}
                </span>
              </div>

              <label className="block space-y-1.5">
                <span className="text-slate-300 font-medium">
                  Clé API Google AI Studio (stockée dans le trousseau sécurisé système)
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-xs text-white focus:border-indigo-500 outline-none"
                />
              </label>

              {testResult && (
                <div
                  className={`p-3 rounded-lg border text-xs ${
                    testResult.ok
                      ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                      : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                  }`}
                >
                  {testResult.message}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={handleTestKey}
                  disabled={testing || !apiKey.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium cursor-pointer disabled:opacity-40"
                >
                  {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Tester la connexion
                </button>
                <button
                  onClick={async () => {
                    await handleSaveKey();
                    close();
                  }}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold cursor-pointer"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </>
        )}

        {/* SPEC TO UML WIZARD MODAL */}
        {activeModal === 'spec_wizard' && (
          <>
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-fuchsia-400" />
                <h2 className="text-sm font-bold text-white">
                  Générer depuis un Cahier des Charges ({GEMINI_MODEL})
                </h2>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs overflow-y-auto">
              <div className="flex items-center justify-between gap-2">
                <p className="text-slate-300">
                  Collez votre cahier des charges ou importez un fichier <code>.md</code>, <code>.txt</code> ou <code>.pdf</code>.{' '}
                  <strong>{GEMINI_MODEL}</strong> générera le modèle UML complet (classes, attributs, méthodes, cardinalités, cas d'utilisation et séquences).
                </p>
                <label className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-indigo-400" />
                  Importer fichier
                  <input
                    type="file"
                    accept=".md,.txt,.pdf"
                    onChange={handleSpecFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <textarea
                rows={11}
                value={specText}
                onChange={(e) => setSpecText(e.target.value)}
                placeholder="Ex: Nous voulons une application de gestion de bibliothèque permettant aux adhérents d'emprunter des livres, réserver des exemplaires, recevoir des notifications de retard..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-100 outline-none focus:border-indigo-500 leading-relaxed"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={close}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleRunSpecToUml}
                  disabled={generatingSpec}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {generatingSpec ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Modélisation en cours...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Générer les Diagrammes UML
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {/* CONTEXTUAL COPILOT MODAL */}
        {activeModal === 'copilot' && (
          <>
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-fuchsia-400" />
                <h2 className="text-sm font-bold text-white">
                  Copilote Gemini 3.5 Flash Lite
                  {copilotContext?.elementId && project.elements[copilotContext.elementId]
                    ? ` — ${project.elements[copilotContext.elementId].name}`
                    : ''}
                </h2>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs overflow-y-auto">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['complete_bodies', 'Compléter les corps de méthodes'],
                    ['audit_solid', 'Audit SOLID & Refactoring'],
                    ['generate_tests', 'Générer les tests unitaires'],
                    ['custom', 'Demande libre'],
                  ] as Array<[CopilotAction, string]>
                ).map(([act, label]) => (
                  <button
                    key={act}
                    onClick={() => setCopilotAction(act)}
                    className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer ${
                      copilotAction === act
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {copilotAction === 'custom' && (
                <textarea
                  rows={3}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Posez votre question d'architecture ou demandez une évolution du diagramme..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100"
                />
              )}

              <button
                onClick={handleRunCopilot}
                disabled={copilotLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                {copilotLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Analyse {GEMINI_MODEL}...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Exécuter avec {GEMINI_MODEL}
                  </>
                )}
              </button>

              {copilotAnswer && (
                <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-200 whitespace-pre-wrap max-h-80 overflow-y-auto">
                  {copilotAnswer}
                </pre>
              )}
            </div>
          </>
        )}

        {/* VALIDATION MODAL */}
        {activeModal === 'validation' && (
          <>
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-white">
                  Vérification de Cohérence UML & SOLID ({issues.length})
                </h2>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-2 overflow-y-auto max-h-[65vh] text-xs">
              {issues.length === 0 ? (
                <div className="py-8 text-center text-emerald-300 flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8" />
                  <p className="font-semibold">Aucune incohérence détectée dans le modèle !</p>
                </div>
              ) : (
                issues.map((issue) => (
                  <div
                    key={issue.id}
                    onClick={() => {
                      if (issue.elementId) {
                        selectElement(issue.elementId);
                        close();
                      }
                    }}
                    className={`p-3 rounded-lg border cursor-pointer ${
                      issue.severity === 'error'
                        ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                        : issue.severity === 'warning'
                          ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                          : 'bg-sky-950/40 border-sky-500/40 text-sky-200'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-2">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-950/70">
                        {issue.code}
                      </span>
                      <span>{issue.message}</span>
                    </div>
                    {issue.suggestion && (
                      <div className="mt-1 text-[11px] opacity-80">{issue.suggestion}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* EXPORT MODAL */}
        {activeModal === 'export' && (
          <>
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-bold text-white">Exporter le Projet & Générer le Code</h2>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 grid grid-cols-2 gap-3 text-xs">
              <button
                onClick={() => {
                  const files = generateProjectCode(project, targetLanguage);
                  const bundle = files
                    .map((f) => `// ===== FILE: ${f.filename} =====\n${f.content}`)
                    .join('\n\n');
                  downloadText(`${project.name}-${targetLanguage}.txt`, bundle);
                  showToast(`${files.length} fichiers générés (${LANGUAGE_LABELS[targetLanguage]}).`, 'success');
                }}
                className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left space-y-1 cursor-pointer"
              >
                <div className="font-bold text-cyan-300">Code Source ({LANGUAGE_LABELS[targetLanguage]})</div>
                <div className="text-slate-400">Exporte toutes les classes avec marqueurs BouML preserved body.</div>
              </button>

              <button
                onClick={() => {
                  downloadText(`${project.name}.puml`, generatePlantUml(project, activeDiagramId));
                  showToast('Diagramme PlantUML (.puml) exporté.', 'success');
                }}
                className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left space-y-1 cursor-pointer"
              >
                <div className="font-bold text-emerald-300">PlantUML (.puml)</div>
                <div className="text-slate-400">Format standardisé 100 % compatible PlantUML.</div>
              </button>

              <button
                onClick={() => {
                  downloadText(`${project.name}-doc.html`, exportHtmlDocumentation(project), 'text/html');
                  showToast('Documentation HTML générée (parité plug-out html).', 'success');
                }}
                className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left space-y-1 cursor-pointer"
              >
                <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Documentation HTML
                </div>
                <div className="text-slate-400">Site statique complet des classes et diagrammes.</div>
              </button>

              <button
                onClick={() => {
                  downloadText(`${project.name}.xmi`, exportXmi2(project), 'application/xml');
                  showToast('Export XMI 2.1 terminé (parité plug-out xmi2).', 'success');
                }}
                className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left space-y-1 cursor-pointer"
              >
                <div className="font-bold text-amber-300">UML XMI 2.1 (.xmi)</div>
                <div className="text-slate-400">Échange standard OMG compatible Enterprise Architect / Papyrus.</div>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
