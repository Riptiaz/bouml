import React, { useState } from "react";
import { Sparkles, Wand2, RotateCcw, Settings2, Loader2, CheckCircle2 } from "lucide-react";
import type { Project } from "../types/uml";
import {
  runAiRefactor,
  runAiTextToUml,
  type AiProviderKind,
  type AiRunResult,
} from "../services/bridge";

interface Props {
  project: Project;
  canUndo: boolean;
  onProjectUpdated: (nextProject: Project, summary: string) => void;
  onUndo: () => void;
}

const DEFAULT_MODELS: Record<AiProviderKind, string> = {
  ollama: "qwen2.5-coder:14b",
  openai: "gpt-4o",
  anthropic: "claude-3-5-sonnet-latest",
};

const QUICK_PROMPTS = [
  {
    label: "+ Pattern Repository",
    prompt: "Ajoute une interface PaymentRepository et une implémentation PostgresPaymentRepository reliées à PaymentProcessor",
  },
  {
    label: "+ AuditLogger",
    prompt: "Ajoute une classe AuditLogger avec une méthode logEvent(event: string) utilisée par PaymentProcessor",
  },
  {
    label: "+ NotificationService",
    prompt: "Ajoute un service NotificationService et une interface EmailSender pour notifier le client après paiement",
  },
];

export const AiAssistantPanel: React.FC<Props> = ({
  project,
  canUndo,
  onProjectUpdated,
  onUndo,
}) => {
  const [mode, setMode] = useState<"text_to_uml" | "refactor">("text_to_uml");
  const [provider, setProvider] = useState<AiProviderKind>("ollama");
  const [model, setModel] = useState<string>(DEFAULT_MODELS.ollama);
  const [apiKey, setApiKey] = useState<string>("");
  const [host, setHost] = useState<string>("http://127.0.0.1:11434");
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const [input, setInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AiRunResult | null>(null);

  const handleProviderChange = (next: AiProviderKind) => {
    setProvider(next);
    setModel(DEFAULT_MODELS[next]);
  };

  const handleRun = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text) return;

    setLoading(true);
    setError(null);
    try {
      const config = {
        provider,
        model,
        apiKey: apiKey.trim() || undefined,
        host: host.trim() || undefined,
      };
      const result =
        mode === "text_to_uml"
          ? await runAiTextToUml(project, text, config)
          : await runAiRefactor(project, text, config);

      setLastResult(result);
      onProjectUpdated(result.project, result.summary);
      if (!overrideText) setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-panel">
      <div className="ai-mode-tabs">
        <button
          className={`ai-tab ${mode === "text_to_uml" ? "active" : ""}`}
          onClick={() => setMode("text_to_uml")}
        >
          <Sparkles size={13} /> Cahier des Charges → UML
        </button>
        <button
          className={`ai-tab ${mode === "refactor" ? "active" : ""}`}
          onClick={() => setMode("refactor")}
        >
          <Wand2 size={13} /> Refactoring
        </button>
      </div>

      <div className="ai-provider-bar">
        <span className="ai-provider-pill">
          {provider.toUpperCase()} · {model}
        </span>
        <div className="ai-provider-actions">
          {canUndo && (
            <button className="icon-btn" onClick={onUndo} title="Annuler la dernière action IA">
              <RotateCcw size={13} />
            </button>
          )}
          <button
            className={`icon-btn ${showSettings ? "active" : ""}`}
            onClick={() => setShowSettings((s) => !s)}
            title="Configurer le fournisseur IA (Ollama / OpenAI / Anthropic)"
          >
            <Settings2 size={13} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="ai-settings-box">
          <label className="ai-field">
            <span>Fournisseur</span>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as AiProviderKind)}
            >
              <option value="ollama">Ollama (Local / Hors-ligne)</option>
              <option value="openai">OpenAI (Structured Outputs)</option>
              <option value="anthropic">Anthropic (Claude Tool Schema)</option>
            </select>
          </label>
          <label className="ai-field">
            <span>Modèle</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          {provider === "ollama" ? (
            <label className="ai-field">
              <span>Serveur Ollama</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} />
            </label>
          ) : (
            <label className="ai-field">
              <span>Clé API (optionnel si env var)</span>
              <input
                type="password"
                placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
          )}
        </div>
      )}

      <div className="ai-body">
        {mode === "refactor" && (
          <div className="ai-chips">
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.label}
                className="ai-chip"
                disabled={loading}
                onClick={() => void handleRun(qp.prompt)}
              >
                {qp.label}
              </button>
            ))}
          </div>
        )}

        <textarea
          className="ai-textarea"
          rows={6}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mode === "text_to_uml"
              ? "Colle ton cahier des charges ou tes user stories...\nEx: Un client passe une commande contenant plusieurs articles, réglée par carte ou virement avec suivi de livraison."
              : "Décris le refactoring souhaité...\nEx: Ajoute un pattern Strategy sur PaymentProcessor et mets à jour le diagramme de séquence."
          }
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void handleRun();
            }
          }}
        />

        <button
          className="ai-submit-btn"
          disabled={loading || !input.trim()}
          onClick={() => void handleRun()}
        >
          {loading ? (
            <>
              <Loader2 size={14} className="spin" /> Génération & Auto-Layout ELK...
            </>
          ) : mode === "text_to_uml" ? (
            <>
              <Sparkles size={14} /> Générer les Diagrammes UML
            </>
          ) : (
            <>
              <Wand2 size={14} /> Appliquer le Refactoring
            </>
          )}
        </button>

        {error && <div className="ai-error">{error}</div>}

        {lastResult && !error && (
          <div className="ai-result-card">
            <div className="ai-result-title">
              <CheckCircle2 size={14} /> Modèle mis à jour
            </div>
            <p className="ai-result-summary">{lastResult.summary}</p>
            <div className="ai-result-stats">
              +{lastResult.classifiersCreated} classifieurs · +{lastResult.relationsCreated}{" "}
              relations
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
