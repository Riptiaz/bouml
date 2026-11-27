import { invoke } from '@tauri-apps/api/core';
import {
  BoumlProject,
  TargetLanguage,
  UmlElement,
} from '../model/schema';
import { generatePlantUml } from '../engines/plantuml/generator';
import { parsePlantUml } from '../engines/plantuml/parser';

export type ConcreteAiModelId =
  | 'gemini-4-hydrogen'
  | 'gemini-3.8-flash'
  | 'gemini-3.5-flash-lite';

export type AiModelSelection = 'auto' | ConcreteAiModelId;

export const DEFAULT_AI_SELECTION: AiModelSelection = 'auto';

/**
 * Full automatic fallback cascade:
 * 1. gemini-4-hydrogen
 * 2. gemini-3.8-flash (on 429 / 503 / quota / model error)
 * 3. gemini-3.5-flash-lite (on 429 / 503 / quota / model error)
 */
export const AUTO_FALLBACK_CHAIN: ConcreteAiModelId[] = [
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
];

/**
 * Fast-path model for quick right-click micro-edits.
 */
export const QUICK_EDIT_MODEL: ConcreteAiModelId = 'gemini-3.5-flash-lite';

export const AI_MODEL_OPTIONS: Array<{
  id: AiModelSelection;
  label: string;
  description: string;
}> = [
  {
    id: 'auto',
    label: 'Auto (Recommandé)',
    description:
      'gemini-4-hydrogen → gemini-3.8-flash → gemini-3.5-flash-lite (et 3.5-flash-lite pour retouches rapides)',
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'gemini-4-hydrogen (Forcé)',
    description: 'Modèle principal haute précision (sans bascule si forcé)',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'gemini-3.8-flash (Forcé)',
    description: 'Équilibre vitesse / qualité',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'gemini-3.5-flash-lite (Forcé)',
    description: 'Ultra rapide et très économique',
  },
];

// Backward-compatible alias
export type AiModelId = AiModelSelection;
export const DEFAULT_AI_MODEL = DEFAULT_AI_SELECTION;
export const GEMINI_MODEL = DEFAULT_AI_SELECTION;

const LOCAL_STORAGE_KEY_API = 'bouml_v2_google_ai_studio_key';
const LOCAL_STORAGE_KEY_MODEL = 'bouml_v2_selected_ai_model';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function loadSelectedModel(): AiModelSelection {
  if (typeof window === 'undefined') return DEFAULT_AI_SELECTION;
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY_MODEL);
  if (
    saved === 'auto' ||
    saved === 'gemini-4-hydrogen' ||
    saved === 'gemini-3.8-flash' ||
    saved === 'gemini-3.5-flash-lite'
  ) {
    return saved;
  }
  return DEFAULT_AI_SELECTION;
}

export function saveSelectedModel(model: AiModelSelection): void {
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
  model: ConcreteAiModelId;
  systemInstruction: string;
  prompt: string;
}

export interface GeminiCallMeta {
  text: string;
  modelUsed: ConcreteAiModelId;
  usedFallback: boolean;
  attemptedModels: ConcreteAiModelId[];
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
      throw new Error(`Erreur Google AI Studio (${opts.model} - ${res.status}): ${errText}`);
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
 * Resolves the ordered list of models to try for a given selection and task tier.
 * - In 'auto' mode:
 *     - quickEdit = true  => ['gemini-3.5-flash-lite']
 *     - quickEdit = false => ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']
 * - In forced manual mode => [preferredModel]
 */
export function resolveModelChain(
  selection: AiModelSelection,
  quickEdit = false
): ConcreteAiModelId[] {
  if (selection === 'auto') {
    return quickEdit ? [QUICK_EDIT_MODEL] : [...AUTO_FALLBACK_CHAIN];
  }
  return [selection];
}

export async function callGeminiWithFallback(opts: {
  apiKey: string;
  preferredModel?: AiModelSelection;
  quickEdit?: boolean;
  systemInstruction: string;
  prompt: string;
  caller?: (o: RawGeminiCallOptions) => Promise<string>;
}): Promise<GeminiCallMeta> {
  if (!opts.apiKey.trim()) {
    throw new Error(
      'Clé API Google AI Studio manquante. Configurez-la dans Paramètres → Intelligence Artificielle.'
    );
  }

  const selection = opts.preferredModel ?? loadSelectedModel();
  const chain = resolveModelChain(selection, Boolean(opts.quickEdit));
  const invokeFn = opts.caller ?? callSingleModel;
  const attempted: ConcreteAiModelId[] = [];
  let lastError: unknown;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    attempted.push(model);
    try {
      const text = await invokeFn({
        apiKey: opts.apiKey,
        model,
        systemInstruction: opts.systemInstruction,
        prompt: opts.prompt,
      });
      return {
        text,
        modelUsed: model,
        usedFallback: i > 0,
        attemptedModels: attempted,
        fallbackReason: i > 0 && lastError instanceof Error ? lastError.message : undefined,
      };
    } catch (err) {
      lastError = err;
      // If invalid API key (401/403), don't waste fallback calls
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|403|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
        throw err;
      }
      // Otherwise continue to next model in the automatic fallback chain
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Tous les modèles IA configurés ont échoué.');
}

export async function testGeminiConnection(
  apiKey: string,
  preferredModel?: AiModelSelection
): Promise<{ ok: boolean; message: string; usedFallback?: boolean }> {
  try {
    const res = await callGeminiWithFallback({
      apiKey,
      preferredModel,
      systemInstruction: 'Réponds uniquement par "OK".',
      prompt: 'Ping de vérification BouML v2.',
    });
    const fb = res.usedFallback
      ? ` (bascule automatique après ${res.attemptedModels.slice(0, -1).join(' → ')})`
      : '';
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

export async function generateUmlFromSpec(
  apiKey: string,
  specText: string,
  preferredModel?: AiModelSelection
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
    quickEdit: false,
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
) & { modelUsed: ConcreteAiModelId; usedFallback: boolean };

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

/**
 * Extracts valid PlantUML even if the LLM omitted @startuml/@enduml wrappers.
 */
function extractApplicablePlantUml(raw: string, fallbackPackageId: string): string | null {
  if (/@startuml[\s\S]*@enduml/i.test(raw)) {
    return raw;
  }
  const stripped = raw.replace(/```(?:plantuml|puml|uml)?\r?\n?/gi, '').replace(/```/g, '').trim();
  const testParsed = parsePlantUml(stripped, fallbackPackageId);
  if (testParsed.elements.length > 0) {
    return `@startuml\n${stripped}\n@enduml`;
  }
  return null;
}

export async function askGeminiCopilot(
  apiKey: string,
  action: CopilotAction,
  project: BoumlProject,
  activeDiagramId: string,
  targetElement: UmlElement | null,
  language: TargetLanguage,
  customPrompt?: string,
  preferredModel?: AiModelSelection
): Promise<CopilotResult> {
  const pkgId = project.packages[0]?.id ?? 'pkg_root';

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
      quickEdit: true, // Uses gemini-3.5-flash-lite in Auto mode for fast right-click edits
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
      quickEdit: false,
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
    const puml = extractApplicablePlantUml(res.text, pkgId);
    if (puml) {
      return {
        kind: 'plantuml',
        plantUml: puml,
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
      quickEdit: true,
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
    const puml = extractApplicablePlantUml(res.text, pkgId);
    if (puml) {
      return {
        kind: 'test_class',
        plantUml: puml,
        bodies,
        modelUsed: res.modelUsed,
        usedFallback: res.usedFallback,
      };
    }
    return { kind: 'text', text: res.text, modelUsed: res.modelUsed, usedFallback: res.usedFallback };
  }

  // Custom prompt ("Demande libre" in Modify Diagram tab):
  // ALWAYS emits updated PlantUML so the diagram is modified directly on the canvas!
  const pumlContext = generatePlantUml(project, activeDiagramId);
  const focus = targetElement ? `Élément ciblé : ${targetElement.name}` : 'Diagramme actif complet';
  const isSmallSingleNodeEdit = Boolean(targetElement && (customPrompt?.length ?? 0) < 120);

  const res = await callGeminiWithFallback({
    apiKey,
    preferredModel,
    quickEdit: isSmallSingleNodeEdit,
    systemInstruction: [
      'Tu es l\'éditeur UML 2.5 automatique de BouML v2.',
      'RÈGLE ABSOLUE : Tu dois APPLIQUER la modification demandée au diagramme actif et répondre UNIQUEMENT par le bloc PlantUML complet et mis à jour commençant par @startuml et finissant par @enduml.',
      'INTERDICTION d\'écrire des phrases d\'explication ou de la prose.',
      'Conserve TOUS les éléments et relations existants qui ne doivent pas être supprimés.',
      'Syntaxe stricte : {static} (jamais {statique}), {abstract}, {const}, {readOnly}, alt/else/opt/loop pour les séquences, rectangle "..." pour les sous-systèmes, state "NomClasse" { ... } pour les états, Extension ..> CasDeBase : <<extend>>.',
    ].join('\n'),
    prompt: `Modification demandée : ${customPrompt || 'Améliore ce modèle UML.'}\n${focus}\n\nDiagramme PlantUML actuel à modifier :\n${pumlContext}`,
  });

  const puml = extractApplicablePlantUml(res.text, pkgId);
  if (puml) {
    return {
      kind: 'plantuml',
      plantUml: puml,
      modelUsed: res.modelUsed,
      usedFallback: res.usedFallback,
    };
  }
  return { kind: 'text', text: res.text, modelUsed: res.modelUsed, usedFallback: res.usedFallback };
}
