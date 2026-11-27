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

export type CopilotResult =
  | { kind: 'bodies'; bodies: Record<string, string>; count: number }
  | { kind: 'plantuml'; plantUml: string; summary?: string }
  | { kind: 'test_class'; plantUml: string; bodies: Record<string, string> }
  | { kind: 'text'; text: string };

/**
 * Parses compact ===OP:<id_or_name>=== ... ===END=== blocks returned by Gemini 4 Hydrogen.
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
  targetElement: UmlElement | null,
  language: TargetLanguage,
  customPrompt?: string
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

    const raw = await callGemini4Hydrogen({
      apiKey,
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

    const bodies = parseMethodBodyBlocks(raw);
    const count = Object.keys(bodies).length;
    if (count === 0) {
      return { kind: 'text', text: raw };
    }
    return { kind: 'bodies', bodies, count };
  }

  if (action === 'audit_solid') {
    const pumlContext = generatePlantUml(project);
    const focus = targetElement ? `Cible prioritaire : ${targetElement.name}.` : 'Tout le diagramme.';
    const raw = await callGemini4Hydrogen({
      apiKey,
      systemInstruction: [
        'Tu es un architecte UML 2.5 expert SOLID pour BouML v2.',
        'Analyse et corrige les violations SOLID directement dans le modèle.',
        'Réponds de manière ultra-compacte :',
        '1. Une ligne commençant par "SUMMARY: " résumant en 1-2 phrases les corrections SOLID appliquées.',
        '2. Un bloc PlantUML complet et corrigé (@startuml ... @enduml) prêt à être importé tel quel (conserve les attributs, méthodes, types, {const}, {readOnly}, cardinalités et stéréotypes courts).',
        'Zéro autre texte.',
      ].join('\n'),
      prompt: `${focus}\n\nModèle courant :\n${pumlContext}`,
    });

    const summaryMatch = raw.match(/^SUMMARY:\s*(.+)$/im);
    if (/@startuml[\s\S]*@enduml/i.test(raw)) {
      return {
        kind: 'plantuml',
        plantUml: raw,
        summary: summaryMatch?.[1]?.trim(),
      };
    }
    return { kind: 'text', text: raw };
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

    const raw = await callGemini4Hydrogen({
      apiKey,
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

    const bodies = parseMethodBodyBlocks(raw);
    if (/@startuml[\s\S]*@enduml/i.test(raw)) {
      return { kind: 'test_class', plantUml: raw, bodies };
    }
    return { kind: 'text', text: raw };
  }

  // Custom prompt: if it asks to modify/add UML, return compact PlantUML to auto-import
  const pumlContext = generatePlantUml(project);
  const focus = targetElement ? `Classe sélectionnée : ${targetElement.name}` : 'Diagramme actif';
  const raw = await callGemini4Hydrogen({
    apiKey,
    systemInstruction: [
      'Tu es l\'assistant UML 2.5 intégré à BouML v2.',
      'Si la demande implique de créer, modifier ou compléter le diagramme, réponds UNIQUEMENT par un bloc PlantUML complet et mis à jour (@startuml ... @enduml) sans texte superflu.',
      'Sinon, réponds en français de manière concise.',
    ].join('\n'),
    prompt: `${customPrompt || 'Améliore ce modèle UML.'}\n\n${focus}\n\nModèle courant :\n${pumlContext}`,
  });

  if (/@startuml[\s\S]*@enduml/i.test(raw)) {
    return { kind: 'plantuml', plantUml: raw };
  }
  return { kind: 'text', text: raw };
}
