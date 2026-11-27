import { invoke } from '@tauri-apps/api/core';
import {
  BoumlProject,
  TargetLanguage,
  UmlElement,
} from '../model/schema';
import { generatePlantUml } from '../engines/plantuml/generator';

export type AiModelId = 'gemini-3.5-flash-lite' | 'gemini-4-hydrogen';

export const DEFAULT_AI_MODEL: AiModelId = 'gemini-3.5-flash-lite';
export const FALLBACK_AI_MODEL: AiModelId = 'gemini-3.5-flash-lite';

export const AI_MODEL_OPTIONS: Array<{ id: AiModelId; label: string; description: string }> = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'gemini-3.5-flash-lite (Recommandé)',
    description: 'Rapide, fiable et économique — modèle par défaut',
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'gemini-4-hydrogen',
    description: 'Raisonnement avancé (bascule auto sur gemini-3.5-flash-lite si indisponible)',
  },
];

// Kept for backward compatibility with tests and references
export const GEMINI_MODEL = DEFAULT_AI_MODEL;

const LOCAL_STORAGE_KEY_API = 'bouml_v2_google_ai_studio_key';
const LOCAL_STORAGE_KEY_MODEL = 'bouml_v2_selected_ai_model';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function loadSelectedModel(): AiModelId {
  if (typeof window === 'undefined') return DEFAULT_AI_MODEL;
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY_MODEL);
  if (saved === 'gemini-4-hydrogen' || saved === 'gemini-3.5-flash-lite') return saved;
  return DEFAULT_AI_MODEL;
}

export function saveSelectedModel(model: AiModelId): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_STORAGE_KEY_MODEL, model);
  }
}

export async function saveApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (isTauriRuntime()) {
    await invoke('save_api_key', { apiKey: trimmed });
  } else {
    localStorage.setItem(LOCAL_STORAGE_KEY_API, trimmed);
  }
}

export async function loadApiKey(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      return await invoke<string>('load_api_key');
    } catch {
      return '';
    }
  }
  return localStorage.getItem(LOCAL_STORAGE_KEY_API) ?? '';
}

interface RawGeminiCallOptions {
  apiKey: string;
  model: AiModelId;
  systemInstruction: string;
  prompt: string;
}

export interface GeminiCallMeta {
  text: string;
  modelUsed: AiModelId;
  usedFallback: boolean;
  fallbackReason?: string;
}

async function callSingleModel(opts: RawGeminiCallOptions): Promise<string> {
  const body: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: opts.systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: opts.prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
    },
  };

  if (isTauriRuntime()) {
    return await invoke<string>('ai_generate_content', {
      model: opts.model,
      apiKey: opts.apiKey.trim(),
      payloadJson: JSON.stringify(body),
    });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch(`${endpoint}?key=${encodeURIComponent(opts.apiKey.trim())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur Google AI Studio (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error(`Réponse vide renvoyée par ${opts.model}.`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the chosen AI model with automatic fallback:
 * If `hydrogen-4` fails (API error, timeout, quota, 503, unavailable),
 * automatically retries on `gemini-3.5-flash` and flags `usedFallback: true`.
 */
export async function callGeminiWithFallback(opts: {
  apiKey: string;
  preferredModel?: AiModelId;
  systemInstruction: string;
  prompt: string;
  caller?: (o: RawGeminiCallOptions) => Promise<string>;
}): Promise<GeminiCallMeta> {
  if (!opts.apiKey.trim()) {
    throw new Error(
      'Clé API Google AI Studio manquante. Configurez-la dans Paramètres → Intelligence Artificielle.'
    );
  }

  const primary = opts.preferredModel ?? loadSelectedModel();
  const invokeFn = opts.caller ?? callSingleModel;

  try {
    const text = await invokeFn({
      apiKey: opts.apiKey,
      model: primary,
      systemInstruction: opts.systemInstruction,
      prompt: opts.prompt,
    });
    return { text, modelUsed: primary, usedFallback: false };
  } catch (err) {
    if (primary === 'gemini-4-hydrogen') {
      const reason = err instanceof Error ? err.message : String(err);
      const fallbackText = await invokeFn({
        apiKey: opts.apiKey,
        model: FALLBACK_AI_MODEL,
        systemInstruction: opts.systemInstruction,
        prompt: opts.prompt,
      });
      return {
        text: fallbackText,
        modelUsed: FALLBACK_AI_MODEL,
        usedFallback: true,
        fallbackReason: reason,
      };
    }
    throw err;
  }
}

export async function testGeminiConnection(
  apiKey: string,
  preferredModel?: AiModelId
): Promise<{ ok: boolean; message: string; usedFallback?: boolean }> {
  try {
    const res = await callGeminiWithFallback({
      apiKey,
      preferredModel,
      systemInstruction: 'Réponds uniquement par "OK".',
      prompt: 'Ping de vérification BouML v2.',
    });
    const fb = res.usedFallback ? ' (bascule automatique depuis gemini-4-hydrogen)' : '';
    return {
      ok: true,
      usedFallback: res.usedFallback,
      message: `Connexion réussie à Google AI Studio (${res.modelUsed})${fb} : ${res.text.trim().slice(0, 60)}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ultra-low-token Spec-to-UML generator with strict cross-diagram coherence rules:
 * - Classes generated first with explicit public methods
 * - Sequence diagrams strictly reference existing classes/methods and use alt/else, opt, loop fragments
 * - UseCase diagrams group use cases in rectangle "Sous-Système" { ... } and enforce Extension ..> Base : <<extend>>
 * - State diagrams encapsulate each class state machine in state "ClassName" { ... } (never isolated class state node)
 * - Strictly English PlantUML modifiers: {static} (never {statique}), {abstract} (never {, })
 */
export async function generateUmlFromSpec(
  apiKey: string,
  specText: string,
  preferredModel?: AiModelId
): Promise<GeminiCallMeta> {
  const systemInstruction = [
    'Tu es un compilateur de spécifications UML 2.5 pour BouML v2.',
    'RÈGLE ABSOLUE : Réponds UNIQUEMENT par un ou plusieurs blocs PlantUML valides (@startuml ... @enduml). Zéro texte explicatif, zéro markdown, zéro tutoriel.',
    'RÈGLES STRICTES DE COHÉRENCE INTER-DIAGRAMMES ET SYNTAXE :',
    '1. Commence TOUJOURS par le bloc Diagramme de Classes (title Classes) contenant toutes les classes, attributs et méthodes publiques.',
    '2. Utilise STRICTEMENT {static} (JAMAIS {statique}) et {abstract} (JAMAIS {, }). Syntaxe : {static} +methode(p : type) : ret {const}. Constructeurs : +NomClasse(p : type).',
    '3. Dans les diagrammes de SÉQUENCE (title Séquence ...), INTERDICTION absolue d\'appeler une méthode ou un participant qui n\'existe pas dans le diagramme de classes. Utilise systématiquement les fragments combinés "alt <cond> ... else <cond> ... end", "opt <cond> ... end" et "loop <cond> ... end" dès qu\'il y a une condition ou une boucle.',
    '4. Dans les diagrammes de CAS D\'UTILISATION (title Cas d\'utilisation), regroupe les cas dans des conteneurs rectangle "Sous-Système" { ... } et impose STRICTEMENT le sens : Extension ..> CasDeBase : <<extend>> et CasDeBase ..> CasInclus : <<include>>.',
    '5. Dans les diagrammes d\'ÉTATS-TRANSITIONS (title États ...), encapsule chaque machine à états dans son propre conteneur state "NomClasse" { [*] --> Etat1 ... } ou dans un bloc @startuml distinct ; ne crée JAMAIS un nœud d\'état isolé portant le nom de la classe.',
    '6. Stéréotypes courts uniquement (<<Entity>>, <<Service>>, <<DTO>>).',
  ].join('\n');

  return await callGeminiWithFallback({
    apiKey,
    preferredModel,
    systemInstruction,
    prompt: specText,
  });
}

export type CopilotAction =
  | 'complete_bodies'
  | 'audit_solid'
  | 'generate_tests'
  | 'custom';

export type CopilotResult = (
  | { kind: 'bodies'; bodies: Record<string, string>; count: number }
  | { kind: 'plantuml'; plantUml: string; summary?: string }
  | { kind: 'test_class'; plantUml: string; bodies: Record<string, string> }
  | { kind: 'text'; text: string }
) & { modelUsed: AiModelId; usedFallback: boolean };

/**
 * Parses compact ===OP:<id_or_name>=== ... ===END=== blocks returned by AI.
 */
export function parseMethodBodyBlocks(raw: string): Record<string, string> {
  const cleaned = raw.replace(/```[a-zA-Z0-9_+-]*\r?\n?/g, '').replace(/```/g, '');
  const bodies: Record<string, string> = {};
  const regex = /===OP:([^\n=]+)===\s*\r?\n([\s\S]*?)\r?\n?===END===/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    const key = match[1].trim();
    const code = match[2].trim();
    if (key && code) {
      bodies[key] = code;
    }
  }
  return bodies;
}

export async function askGeminiCopilot(
  apiKey: string,
  action: CopilotAction,
  project: BoumlProject,
  activeDiagramId: string,
  targetElement: UmlElement | null,
  language: TargetLanguage,
  customPrompt?: string,
  preferredModel?: AiModelId
): Promise<CopilotResult> {
  if (action === 'complete_bodies') {
    if (!targetElement || targetElement.operations.length === 0) {
      throw new Error('Sélectionnez une classe contenant au moins une méthode.');
    }

    const attrsList = targetElement.attributes
      .map((a) => `${a.visibility} ${a.name}: ${a.type}${a.isReadOnly ? ' {readOnly}' : ''}`)
      .join('\n');
    const opsList = targetElement.operations
      .map(
        (o) =>
          `[${o.id}] ${o.name}(${o.parameters.map((p) => `${p.name}: ${p.type}`).join(', ')}) : ${o.returnType || '(ctor)'}${o.isConst ? ' const' : ''}`
      )
      .join('\n');

    const res = await callGeminiWithFallback({
      apiKey,
      preferredModel,
      systemInstruction: [
        `Tu génères UNIQUEMENT les corps de méthodes en ${language} pour BouML v2.`,
        'Zéro texte explicatif, zéro signature de classe ou de fonction, zéro markdown.',
        'Pour chaque opération [id], réponds STRICTEMENT au format :',
        '===OP:<id>===',
        '<instructions du corps uniquement>',
        '===END===',
      ].join('\n'),
      prompt: `Classe ${targetElement.name}\nAttributs:\n${attrsList || '(aucun)'}\n\nOpérations:\n${opsList}`,
    });

    const bodies = parseMethodBodyBlocks(res.text);
    const count = Object.keys(bodies).length;
    if (count === 0) {
      return { kind: 'text', text: res.text, modelUsed: res.modelUsed, usedFallback: res.usedFallback };
    }
    return { kind: 'bodies', bodies, count, modelUsed: res.modelUsed, usedFallback: res.usedFallback };
  }

  if (action === 'audit_solid') {
    const pumlContext = generatePlantUml(project, activeDiagramId);
    const focus = targetElement ? `Cible prioritaire : ${targetElement.name}.` : 'Tout le diagramme actif.';
    const res = await callGeminiWithFallback({
      apiKey,
      preferredModel,
      systemInstruction: [
        'Tu es un architecte UML 2.5 expert SOLID pour BouML v2.',
        'Analyse et corrige les violations SOLID directement dans le modèle.',
        'Réponds de manière ultra-compacte :',
        '1. Une ligne commençant par "SUMMARY: " résumant en 1-2 phrases les corrections SOLID appliquées.',
        '2. Un bloc PlantUML complet et corrigé (@startuml ... @enduml) prêt à être importé tel quel ({static}, {abstract}, {const}, {readOnly}, cardinalités).',
        'Zéro autre texte.',
      ].join('\n'),
      prompt: `${focus}\n\nModèle courant :\n${pumlContext}`,
    });

    const summaryMatch = res.text.match(/^SUMMARY:\s*(.+)$/im);
    if (/@startuml[\s\S]*@enduml/i.test(res.text)) {
      return {
        kind: 'plantuml',
        plantUml: res.text,
        summary: summaryMatch?.[1]?.trim(),
        modelUsed: res.modelUsed,
        usedFallback: res.usedFallback,
      };
    }
    return { kind: 'text', text: res.text, modelUsed: res.modelUsed, usedFallback: res.usedFallback };
  }

  if (action === 'generate_tests') {
    if (!targetElement) {
      throw new Error('Sélectionnez une classe pour générer ses tests unitaires.');
    }
    const testClassName = `${targetElement.name}Test`;
    const opsSummary = targetElement.operations
      .map(
        (o) =>
          `+${o.name}(${o.parameters.map((p) => `${p.name}: ${p.type}`).join(', ')}) : ${o.returnType || '(ctor)'}`
      )
      .join('\n');

    const res = await callGeminiWithFallback({
      apiKey,
      preferredModel,
      systemInstruction: [
        `Tu génères une classe de tests unitaires UML + corps de tests en ${language} pour BouML v2.`,
        'Réponds STRICTEMENT avec ces 2 sections compactes, sans autre texte :',
        '1. Un bloc PlantUML contenant la classe de test :',
        `@startuml\nclass ${testClassName} <<Test>> {\n  +testXxx() : void\n}\n${testClassName} ..> ${targetElement.name} : tests\n@enduml`,
        '2. Pour chaque méthode de test, son corps au format :',
        '===OP:<nomMethodeTest>===',
        '<code assertions du test>',
        '===END===',
      ].join('\n'),
      prompt: `Génère les tests unitaires nominaux et cas limites pour la classe ${targetElement.name} :\n${opsSummary}`,
    });

    const bodies = parseMethodBodyBlocks(res.text);
    if (/@startuml[\s\S]*@enduml/i.test(res.text)) {
      return {
        kind: 'test_class',
        plantUml: res.text,
        bodies,
        modelUsed: res.modelUsed,
        usedFallback: res.usedFallback,
      };
    }
    return { kind: 'text', text: res.text, modelUsed: res.modelUsed, usedFallback: res.usedFallback };
  }

  // Custom prompt: modify current diagram cleanly without losing untouched elements
  const pumlContext = generatePlantUml(project, activeDiagramId);
  const focus = targetElement ? `Élément sélectionné : ${targetElement.name}` : 'Diagramme actif complet';
  const res = await callGeminiWithFallback({
    apiKey,
    preferredModel,
    systemInstruction: [
      'Tu es l\'assistant UML 2.5 intégré à BouML v2.',
      'Si la demande implique d\'ajouter, modifier ou supprimer des éléments sur le diagramme actuel, renvoie le bloc PlantUML COMPLET et mis à jour (@startuml ... @enduml) en CONSERVANT tous les éléments existants non concernés par la suppression. Utilise {static}, {abstract}, alt/else/opt/loop pour les séquences, rectangle "..." pour les sous-systèmes, et state "NomClasse" { ... } pour les états.',
      'Si c\'est une pure question théorique sans modification demandée, réponds en français de manière concise.',
    ].join('\n'),
    prompt: `${customPrompt || 'Améliore ce modèle UML.'}\n\n${focus}\n\nDiagramme actif courant :\n${pumlContext}`,
  });

  if (/@startuml[\s\S]*@enduml/i.test(res.text)) {
    return {
      kind: 'plantuml',
      plantUml: res.text,
      modelUsed: res.modelUsed,
      usedFallback: res.usedFallback,
    };
  }
  return { kind: 'text', text: res.text, modelUsed: res.modelUsed, usedFallback: res.usedFallback };
}
