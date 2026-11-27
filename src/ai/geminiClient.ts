import { invoke } from '@tauri-apps/api/core';
import {
  BoumlProject,
  TargetLanguage,
  UmlElement,
} from '../model/schema';
import { generatePlantUml } from '../engines/plantuml/generator';

/**
 * Exclusive Google AI Studio model required by specification.
 */
export const GEMINI_MODEL = 'gemini-4-hydrogen';
const GOOGLE_AI_STUDIO_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const LOCAL_STORAGE_FALLBACK_KEY = 'bouml_v2_google_ai_studio_key';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function saveApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (isTauriRuntime()) {
    await invoke('save_api_key', { apiKey: trimmed });
  } else {
    localStorage.setItem(LOCAL_STORAGE_FALLBACK_KEY, trimmed);
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
  return localStorage.getItem(LOCAL_STORAGE_FALLBACK_KEY) ?? '';
}

interface GeminiRequestOptions {
  apiKey: string;
  systemInstruction: string;
  prompt: string;
}

async function callGemini4Hydrogen(opts: GeminiRequestOptions): Promise<string> {
  if (!opts.apiKey.trim()) {
    throw new Error(
      'Clé API Google AI Studio manquante. Configurez-la dans Paramètres → Intelligence Artificielle.'
    );
  }

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
      model: GEMINI_MODEL,
      apiKey: opts.apiKey.trim(),
      payloadJson: JSON.stringify(body),
    });
  }

  const res = await fetch(
    `${GOOGLE_AI_STUDIO_ENDPOINT}?key=${encodeURIComponent(opts.apiKey.trim())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erreur Google AI Studio (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Réponse vide renvoyée par gemini-4-hydrogen.');
  }
  return text;
}

export async function testGeminiConnection(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const text = await callGemini4Hydrogen({
      apiKey,
      systemInstruction: 'Réponds uniquement par "OK".',
      prompt: 'Ping de vérification BouML v2.',
    });
    return {
      ok: true,
      message: `Connexion réussie à Google AI Studio (${GEMINI_MODEL}) : ${text.trim().slice(0, 60)}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ultra-low-token Spec-to-UML generator:
 * Asks gemini-4-hydrogen to emit ONLY compact, lossless PlantUML (@startuml...@enduml).
 * BouML v2 transparently parses and lays it out on the canvas without exposing raw syntax to the user.
 */
export async function generateUmlFromSpec(
  apiKey: string,
  specText: string
): Promise<string> {
  const systemInstruction = [
    'Tu es un compilateur de spécifications UML 2.5 pour BouML v2.',
    'RÈGLE ABSOLUE : Réponds UNIQUEMENT par un ou plusieurs blocs PlantUML valides (@startuml ... @enduml). Zéro texte explicatif, zéro markdown, zéro tutoriel, même si le cahier des charges en demande.',
    'Format compact obligatoire pour consommer un minimum de tokens tout en préservant 100 % des détails :',
    '- Ajoute "title <NomCourt>" en début de chaque bloc.',
    '- Utilise des stéréotypes courts uniquement si pertinents (ex: <<Entity>>, <<Service>>, <<DTO>>). Ne jamais inventer de longs stéréotypes.',
    '- Syntaxe attributs : -nom : type {readOnly} {static}',
    '- Syntaxe méthodes : +nom(param1 : type1, param2 : type2) : typeRetour {const} {static} {abstract}',
    '- Constructeurs : +NomClasse(param1 : type1)',
    '- Relations avec cardinalités : ClasseA "1" *-- "0..*" ClasseB : label',
    '- Inclus TOUS les attributs, constructeurs, getters, setters, méthodes métier, modificateurs ({const}, {readOnly}, {static}, {abstract}) et relations demandés.',
  ].join('\n');

  return await callGemini4Hydrogen({
    apiKey,
    systemInstruction,
    prompt: specText,
  });
}

export type CopilotAction =
  | 'complete_bodies'
  | 'audit_solid'
  | 'generate_tests'
  | 'custom';

export async function askGeminiCopilot(
  apiKey: string,
  action: CopilotAction,
  project: BoumlProject,
  targetElement: UmlElement | null,
  language: TargetLanguage,
  customPrompt?: string
): Promise<string> {
  const pumlContext = generatePlantUml(project);
  const focus = targetElement
    ? `Élément ciblé : ${targetElement.kind} ${targetElement.name}\nAttributs: ${JSON.stringify(targetElement.attributes)}\nOpérations: ${JSON.stringify(targetElement.operations)}`
    : 'Contexte global du diagramme actif.';

  const actionInstruction: Record<CopilotAction, string> = {
    complete_bodies: `Complète le corps des méthodes de la classe ciblée en ${language}, avec un code propre, idiomatique et prêt pour la production.`,
    audit_solid: `Effectue un audit strict des principes SOLID (SRP, OCP, LSP, ISP, DIP) sur ce modèle UML. Liste les violations concrètes et propose le refactoring PlantUML corrigé.`,
    generate_tests: `Génère une suite complète de tests unitaires en ${language} couvrant tous les cas nominaux et cas limites de la classe ciblée.`,
    custom: customPrompt || 'Analyse ce modèle UML et propose des améliorations architecturales.',
  };

  return await callGemini4Hydrogen({
    apiKey,
    systemInstruction:
      'Tu es l\'assistant UML & Architecture intégré à BouML v2 (propulsé par gemini-4-hydrogen). Réponds en français de manière concise, structurée et directement exploitable.',
    prompt: `${actionInstruction[action]}\n\n${focus}\n\nModèle PlantUML courant :\n\`\`\`plantuml\n${pumlContext}\n\`\`\``,
  });
}
