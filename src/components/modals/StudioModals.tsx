import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crop,
  Download,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Moon,
  Paperclip,
  Sparkles,
  Sun,
  Wand2,
  X,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import {
  AI_MODEL_OPTIONS,
  AiModelId,
  askGeminiCopilot,
  CopilotAction,
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
import { saveAsFile } from '../../utils/fileSystem';
import { captureCanvasToPngBlob } from '../../utils/pngExport';
import { AiAttachment, readFileAsAiAttachment } from '../../utils/attachments';

const ACCEPTED_ATTACHMENT_TYPES =
  'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.doc,.txt,.md';

export const StudioModals: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    aiAssistantTab,
    setAiAssistantTab,
    aiModel,
    setAiModel,
    theme,
    project,
    activeDiagramId,
    targetLanguage,
    issues,
    selectElement,
    applyAiPlantUml,
    applyPlantUmlToActiveDiagram,
    applyMethodBodies,
    applyAiTestClass,
    fixIssue,
    fixAllIssues,
    copilotContext,
    pngCropRect,
    startPngCropMode,
    finishPngCrop,
    showToast,
  } = useProjectStore();

  // AI Settings state
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Spec Wizard & Modify Diagram state
  const [specText, setSpecText] = useState('');
  const [generatingSpec, setGeneratingSpec] = useState(false);
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);

  // Copilot / Modify Diagram state — defaults to 'custom' (Demande libre), NEVER auto-triggers on mount!
  const [copilotAction, setCopilotAction] = useState<CopilotAction>('custom');
  const [customPrompt, setCustomPrompt] = useState('');
  const [copilotAnswer, setCopilotAnswer] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);

  // PNG Export state
  const [pngTheme, setPngTheme] = useState<'dark' | 'light'>(theme);
  const [pngExporting, setPngExporting] = useState(false);

  useEffect(() => {
    loadApiKey().then(setApiKey);
  }, [activeModal]);

  useEffect(() => {
    if (activeModal === 'ai_assistant') {
      setCopilotAction(copilotContext?.initialAction ?? 'custom');
      setCopilotAnswer('');
    }
    if (activeModal === 'png_export') {
      setPngTheme(theme);
    }
  }, [activeModal, copilotContext, theme]);

  if (!activeModal) return null;

  const close = () => setActiveModal(null);

  const handleSaveKey = async () => {
    await saveApiKey(apiKey);
    showToast('Clé API et modèle IA enregistrés de manière sécurisée.', 'success');
  };

  const handleTestKey = async () => {
    setTesting(true);
    setTestResult(null);
    await saveApiKey(apiKey);
    const res = await testGeminiConnection(apiKey, aiModel);
    setTestResult(res);
    setTesting(false);
  };

  const handleAttachFiles = async (files: FileList | File[]) => {
    const added: AiAttachment[] = [];
    for (const f of Array.from(files)) {
      try {
        added.push(await readFileAsAiAttachment(f));
      } catch {
        showToast(`Impossible de lire la pièce jointe "${f.name}".`, 'error');
      }
    }
    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added]);
      showToast(`${added.length} pièce(s) jointe(s) ajoutée(s) pour l'IA.`, 'info');
    }
  };

  const handlePasteAttachment = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await handleAttachFiles(files);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleRunSpecToUml = async () => {
    if (!specText.trim() && attachments.length === 0) {
      showToast('Veuillez saisir un prompt ou joindre un fichier (image, PDF, DOCX, TXT, MD).', 'error');
      return;
    }
    const key = apiKey || (await loadApiKey());
    if (!key) {
      showToast("Configurez d'abord votre clé API Google AI Studio.", 'error');
      setActiveModal('ai_settings');
      return;
    }
    setGeneratingSpec(true);
    try {
      const res = await generateUmlFromSpec(key, specText, aiModel, attachments);
      if (res.usedFallback) {
        showToast(
          `Bascule automatique sur ${res.modelUsed} suite à une limite/erreur du modèle précédent.`,
          'info'
        );
      }
      await applyAiPlantUml(res.text);
      setAttachments([]);
      close();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setGeneratingSpec(false);
    }
  };

  const executeCopilot = async (actionToRun: CopilotAction) => {
    const key = apiKey || (await loadApiKey());
    if (!key) {
      showToast("Configurez d'abord votre clé API Google AI Studio.", 'error');
      setActiveModal('ai_settings');
      return;
    }
    if (actionToRun === 'custom' && !customPrompt.trim() && attachments.length === 0) {
      showToast("Saisissez votre demande ou joignez une image/document avant de lancer l'Assistant IA.", 'error');
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
        activeDiagramId,
        targetEl,
        targetLanguage,
        customPrompt,
        aiModel,
        attachments
      );

      if (result.usedFallback) {
        showToast(
          `Bascule automatique sur ${result.modelUsed} suite à une limite/erreur du modèle précédent.`,
          'info'
        );
      }

      if (result.kind === 'bodies' && targetEl) {
        const applied = applyMethodBodies(targetEl.id, targetLanguage, result.bodies);
        if (applied > 0) {
          setAttachments([]);
          setActiveModal(null);
          return;
        }
      } else if (result.kind === 'test_class' && targetEl) {
        await applyAiTestClass(targetEl.id, targetLanguage, result.plantUml, result.bodies);
        setAttachments([]);
        setActiveModal(null);
        return;
      } else if (result.kind === 'plantuml') {
        await applyPlantUmlToActiveDiagram(result.plantUml);
        if (result.summary) {
          showToast(`Appliqué : ${result.summary}`, 'success');
        }
        setAttachments([]);
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

  const handleExportPng = async () => {
    const container = document.getElementById('bouml-canvas-capture-root');
    if (!container) {
      showToast('Canevas introuvable pour la capture PNG.', 'error');
      return;
    }
    setPngExporting(true);
    try {
      const blob = await captureCanvasToPngBlob({
        container,
        exportTheme: pngTheme,
        cropRect: pngCropRect,
        pixelRatio: 2,
      });
      const diagName = project.diagrams[activeDiagramId]?.name ?? project.name;
      const safeName = `${diagName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'diagramme'}.png`;
      const res = await saveAsFile({
        suggestedName: safeName,
        content: blob,
        mimeType: 'image/png',
        description: 'Image PNG haute résolution',
        extensions: ['.png'],
      });
      if (res.saved) {
        showToast(`Image PNG exportée (${res.filename ?? safeName}).`, 'success');
        close();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setPngExporting(false);
    }
  };

  const contextElement = copilotContext?.elementId
    ? project.elements[copilotContext.elementId]
    : undefined;

  const renderAttachmentsBar = () => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer transition-colors">
          <Paperclip className="w-3.5 h-3.5 text-indigo-400" />
          <span>Joindre fichier (Image, PDF, DOCX, TXT, MD)</span>
          <input
            type="file"
            multiple
            accept={ACCEPTED_ATTACHMENT_TYPES}
            onChange={(e) => {
              if (e.target.files?.length) void handleAttachFiles(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
        </label>
        <span className="text-[10px] text-slate-500">
          Astuce : vous pouvez aussi coller une image (Ctrl+V)
        </span>
      </div>

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-[11px] text-slate-200"
            >
              {att.previewUrl ? (
                <img
                  src={att.previewUrl}
                  alt={att.name}
                  className="w-7 h-7 rounded object-cover border border-slate-700"
                />
              ) : (
                <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
              )}
              <div className="max-w-[160px] truncate">
                <div className="truncate font-medium">{att.name}</div>
                <div className="text-[9px] text-slate-500">
                  {att.base64Data ? 'Multimodal natif' : 'Texte extrait'} •{' '}
                  {Math.max(1, Math.round(att.size / 1024))} Ko
                </div>
              </div>
              <button
                onClick={() => removeAttachment(att.id)}
                className="text-slate-400 hover:text-rose-400 cursor-pointer"
                title="Retirer cette pièce jointe"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
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

            <div className="p-5 space-y-4 text-xs overflow-y-auto">
              <div className="space-y-1.5">
                <span className="text-slate-300 font-medium block">Modèle IA actif</span>
                <div className="grid grid-cols-2 gap-2">
                  {AI_MODEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setAiModel(opt.id)}
                      className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        aiModel === opt.id
                          ? 'bg-indigo-600/20 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="font-mono font-bold text-xs">{opt.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{opt.description}</div>
                    </button>
                  ))}
                </div>
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

        {/* UNIFIED AI ASSISTANT MODAL */}
        {activeModal === 'ai_assistant' && (
          <>
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-fuchsia-400" />
                <h2 className="text-sm font-bold text-white">Assistant IA BouML v2</h2>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value as AiModelId)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 font-mono text-[11px] text-indigo-300"
                  title="Auto : gemini-4-hydrogen → gemini-3.8-flash → gemini-3.5-flash-lite (ou choix forcé)"
                >
                  <option value="auto">Auto (4-hydrogen → 3.8-flash → 3.5-lite)</option>
                  <option value="gemini-4-hydrogen">gemini-4-hydrogen (Forcé)</option>
                  <option value="gemini-3.8-flash">gemini-3.8-flash (Forcé)</option>
                  <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Forcé)</option>
                </select>
                <button onClick={close} className="text-slate-400 hover:text-white cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Unified Mode Tabs */}
            <div className="flex border-b border-slate-800 bg-slate-950/60 px-4 pt-2 gap-2">
              <button
                onClick={() => setAiAssistantTab('modify')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors cursor-pointer ${
                  aiAssistantTab === 'modify'
                    ? 'border-indigo-500 text-indigo-300 bg-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Modifier le diagramme actuel
              </button>
              <button
                onClick={() => setAiAssistantTab('generate')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors cursor-pointer ${
                  aiAssistantTab === 'generate'
                    ? 'border-fuchsia-500 text-fuchsia-300 bg-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Générer depuis un cahier des charges
              </button>
            </div>

            {aiAssistantTab === 'modify' ? (
              <div className="p-5 space-y-3.5 text-xs overflow-y-auto" onPaste={handlePasteAttachment}>
                {contextElement && (
                  <div className="px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-indigo-200 flex items-center justify-between">
                    <span>
                      Contexte ciblé : <strong>{contextElement.name}</strong> ({contextElement.kind})
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['custom', 'Demande libre'],
                      ['audit_solid', 'Audit SOLID & Refactoring'],
                      ['complete_bodies', 'Compléter les méthodes'],
                      ['generate_tests', 'Tests unitaires'],
                    ] as Array<[CopilotAction, string]>
                  ).map(([act, label]) => (
                    <button
                      key={act}
                      onClick={() => setCopilotAction(act)}
                      className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
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
                  <>
                    <textarea
                      autoFocus
                      rows={5}
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="Ex: À partir de l'image jointe, reproduis ce diagramme et ajoute une classe Facture reliée à Commande..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-100 outline-none focus:border-indigo-500 leading-relaxed"
                    />
                    {renderAttachmentsBar()}
                  </>
                )}

                {copilotAction !== 'custom' && (
                  <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-slate-300">
                    {copilotAction === 'audit_solid' &&
                      'Analyse les principes SOLID sur le diagramme actif et applique directement le refactoring proposé.'}
                    {copilotAction === 'complete_bodies' &&
                      'Génère et injecte le corps de toutes les méthodes de la classe sélectionnée dans Code Live.'}
                    {copilotAction === 'generate_tests' &&
                      'Crée la classe de tests unitaires associée sur le diagramme avec ses méthodes de test pré-remplies.'}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={close}
                    className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                  >
                    Fermer
                  </button>
                  <button
                    onClick={() => executeCopilot(copilotAction)}
                    disabled={copilotLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {copilotLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Exécution ({aiModel})...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Appliquer ({aiModel})
                      </>
                    )}
                  </button>
                </div>

                {copilotAnswer && (
                  <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-200 whitespace-pre-wrap max-h-72 overflow-y-auto">
                    {copilotAnswer}
                  </pre>
                )}
              </div>
            ) : (
              <div className="p-5 space-y-3.5 text-xs overflow-y-auto" onPaste={handlePasteAttachment}>
                <p className="text-slate-300">
                  Saisissez votre cahier des charges et/ou joignez des <strong>images (PNG/JPG/WEBP)</strong>,{' '}
                  <strong>PDF</strong>, <strong>DOCX/DOC</strong>, <strong>TXT/MD</strong> envoyés directement à l'IA.
                </p>

                <textarea
                  autoFocus
                  rows={8}
                  value={specText}
                  onChange={(e) => setSpecText(e.target.value)}
                  placeholder="Ex: À partir du PDF ou de la capture d'écran jointe, génère les diagrammes de classes, cas d'utilisation et séquences..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-100 outline-none focus:border-indigo-500 leading-relaxed"
                />

                {renderAttachmentsBar()}

                <div className="flex items-center justify-end gap-2 pt-1">
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
                        Modélisation ({aiModel})...
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
            )}
          </>
        )}

        {/* PNG EXPORT MODAL */}
        {activeModal === 'png_export' && (
          <>
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-bold text-white">Exporter en PNG Haute Résolution</h2>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="space-y-2">
                <span className="text-slate-300 font-medium block">Zone à capturer</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => finishPngCrop(null)}
                    className={`p-3 rounded-xl border text-left cursor-pointer ${
                      !pngCropRect
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold">Tout le diagramme</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Capture complète du canevas (2x Retina)
                    </div>
                  </button>

                  <button
                    onClick={startPngCropMode}
                    className={`p-3 rounded-xl border text-left cursor-pointer ${
                      pngCropRect
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <Crop className="w-3.5 h-3.5 text-indigo-400" />
                      Sélectionner une zone
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {pngCropRect
                        ? `Zone sélectionnée : ${Math.round(pngCropRect.width)}×${Math.round(pngCropRect.height)} px (cliquer pour retracer)`
                        : 'Tracer un rectangle à la souris sur le canevas'}
                    </div>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-slate-300 font-medium block">
                  Thème de l'image exportée (indépendant de l'interface)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPngTheme('dark')}
                    className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer ${
                      pngTheme === 'dark'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <Moon className="w-4 h-4 text-indigo-400" />
                    <span className="font-semibold">Thème Sombre</span>
                  </button>
                  <button
                    onClick={() => setPngTheme('light')}
                    className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer ${
                      pngTheme === 'light'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <Sun className="w-4 h-4 text-amber-400" />
                    <span className="font-semibold">Thème Clair (Impression / Rapport)</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={close}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleExportPng}
                  disabled={pngExporting}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {pngExporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Génération PNG...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Enregistrer le PNG...
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {/* VALIDATION MODAL WITH 1-CLICK AUTO-FIX */}
        {activeModal === 'validation' && (
          <>
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-white">
                  Vérification de Cohérence UML & SOLID ({issues.length})
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {issues.length > 0 && (
                  <button
                    onClick={fixAllIssues}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    Tout corriger automatiquement
                  </button>
                )}
                <button onClick={close} className="text-slate-400 hover:text-white cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
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
                    className={`p-3 rounded-lg border flex items-start justify-between gap-3 ${
                      issue.severity === 'error'
                        ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
                        : issue.severity === 'warning'
                          ? 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                          : 'bg-sky-950/40 border-sky-500/40 text-sky-200'
                    }`}
                  >
                    <div
                      onClick={() => {
                        if (issue.elementId) {
                          selectElement(issue.elementId);
                          close();
                        }
                      }}
                      className="flex-1 cursor-pointer"
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

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        fixIssue(issue);
                      }}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold cursor-pointer"
                      title="Corriger automatiquement ce problème"
                    >
                      <Wand2 className="w-3 h-3" />
                      {issue.code === 'SOLID-SRP' ? 'Corriger (IA)' : 'Corriger'}
                    </button>
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
                <h2 className="text-sm font-bold text-white">Exporter le Projet & Diagrammes</h2>
              </div>
              <button onClick={close} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 grid grid-cols-2 gap-3 text-xs">
              <button
                onClick={() => setActiveModal('png_export')}
                className="col-span-2 p-4 rounded-xl bg-gradient-to-r from-emerald-950/70 to-indigo-950/70 hover:from-emerald-900/70 hover:to-indigo-900/70 border border-emerald-500/50 text-left space-y-1 cursor-pointer"
              >
                <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <ImageIcon className="w-4 h-4" /> Exporter en PNG Haute Résolution
                </div>
                <div className="text-slate-300">
                  Capture tout le diagramme ou une zone rectangulaire sélectionnée à la souris, en Thème Clair ou Sombre.
                </div>
              </button>

              <button
                onClick={async () => {
                  const files = generateProjectCode(project, targetLanguage);
                  const bundle = files
                    .map((f) => `// ===== FILE: ${f.filename} =====\n${f.content}`)
                    .join('\n\n');
                  const res = await saveAsFile({
                    suggestedName: `${project.name}-${targetLanguage}.txt`,
                    content: bundle,
                    mimeType: 'text/plain',
                    description: `Code source (${LANGUAGE_LABELS[targetLanguage]})`,
                    extensions: ['.txt'],
                  });
                  if (res.saved) {
                    showToast(`${files.length} fichiers exportés (${res.filename}).`, 'success');
                  }
                }}
                className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left space-y-1 cursor-pointer"
              >
                <div className="font-bold text-cyan-300">
                  Code Source ({LANGUAGE_LABELS[targetLanguage]})
                </div>
                <div className="text-slate-400">
                  Exporte toutes les classes avec marqueurs BouML preserved body.
                </div>
              </button>

              <button
                onClick={async () => {
                  const res = await saveAsFile({
                    suggestedName: `${project.name}.puml`,
                    content: generatePlantUml(project, activeDiagramId),
                    mimeType: 'text/plain',
                    description: 'Diagramme PlantUML (.puml)',
                    extensions: ['.puml'],
                  });
                  if (res.saved) showToast(`PlantUML exporté (${res.filename}).`, 'success');
                }}
                className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left space-y-1 cursor-pointer"
              >
                <div className="font-bold text-emerald-300">PlantUML (.puml)</div>
                <div className="text-slate-400">Format standardisé 100 % compatible PlantUML.</div>
              </button>

              <button
                onClick={async () => {
                  const res = await saveAsFile({
                    suggestedName: `${project.name}-doc.html`,
                    content: exportHtmlDocumentation(project),
                    mimeType: 'text/html',
                    description: 'Documentation HTML',
                    extensions: ['.html'],
                  });
                  if (res.saved) showToast(`Documentation HTML exportée (${res.filename}).`, 'success');
                }}
                className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left space-y-1 cursor-pointer"
              >
                <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Documentation HTML
                </div>
                <div className="text-slate-400">Site statique complet des classes et diagrammes.</div>
              </button>

              <button
                onClick={async () => {
                  const res = await saveAsFile({
                    suggestedName: `${project.name}.xmi`,
                    content: exportXmi2(project),
                    mimeType: 'application/xml',
                    description: 'UML XMI 2.1 (.xmi)',
                    extensions: ['.xmi'],
                  });
                  if (res.saved) showToast(`Export XMI 2.1 terminé (${res.filename}).`, 'success');
                }}
                className="p-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left space-y-1 cursor-pointer"
              >
                <div className="font-bold text-amber-300">UML XMI 2.1 (.xmi)</div>
                <div className="text-slate-400">
                  Échange standard OMG compatible Enterprise Architect / Papyrus.
                </div>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
