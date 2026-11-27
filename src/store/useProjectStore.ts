import { create } from 'zustand';
import {
  BoumlProject,
  createId,
  DiagramKind,
  ElementKind,
  RelationKind,
  TargetLanguage,
  UmlAttribute,
  UmlDiagram,
  UmlElement,
  UmlOperation,
  UmlRelation,
  ValidationIssue,
} from '../model/schema';
import { createDemoProject } from '../model/defaults';
import { validateProject } from '../model/validator';
import { applyDesignPattern, DesignPatternKind, generateGettersSetters } from '../model/patterns';
import { computeElkLayout } from '../engines/layout/elkLayout';
import { parsePlantUml, parsePlantUmlBlocks } from '../engines/plantuml/parser';
import { importUniversalFile } from '../engines/importers';

export interface ContextMenuState {
  x: number;
  y: number;
  targetType: 'canvas' | 'node' | 'edge' | 'explorer-package' | 'explorer-diagram' | 'explorer-element';
  targetId?: string;
  canvasPosition?: { x: number; y: number };
}

export type ActiveModal =
  | null
  | 'ai_settings'
  | 'spec_wizard'
  | 'copilot'
  | 'validation'
  | 'profiles'
  | 'export';

interface ProjectStore {
  project: BoumlProject;
  past: BoumlProject[];
  future: BoumlProject[];
  activeDiagramId: string;
  selectedElementId: string | null;
  selectedRelationId: string | null;
  targetLanguage: TargetLanguage;
  rightPanelTab: 'inspector' | 'code' | 'plantuml';
  splitCodeOpen: boolean;
  contextMenu: ContextMenuState | null;
  activeModal: ActiveModal;
  copilotContext: { elementId?: string; initialAction?: 'complete_bodies' | 'audit_solid' | 'generate_tests' | 'custom' } | null;
  issues: ValidationIssue[];
  toast: { message: string; kind: 'info' | 'success' | 'error' } | null;

  // Navigation & UI
  setActiveDiagram: (id: string) => void;
  selectElement: (id: string | null) => void;
  selectRelation: (id: string | null) => void;
  setTargetLanguage: (lang: TargetLanguage) => void;
  setRightPanelTab: (tab: 'inspector' | 'code' | 'plantuml') => void;
  toggleSplitCode: () => void;
  openContextMenu: (menu: ContextMenuState | null) => void;
  setActiveModal: (modal: ActiveModal) => void;
  openCopilot: (elementId?: string, initialAction?: 'complete_bodies' | 'audit_solid' | 'generate_tests' | 'custom') => void;
  showToast: (message: string, kind?: 'info' | 'success' | 'error') => void;

  // Undo / Redo
  undo: () => void;
  redo: () => void;

  // Project mutations
  loadProject: (project: BoumlProject) => void;
  newProject: (name?: string) => void;
  addPackage: (name: string, parentId?: string | null) => void;
  addDiagram: (name: string, kind: DiagramKind, packageId?: string) => void;
  deleteDiagram: (diagramId: string) => void;

  // Element mutations
  addElement: (kind: ElementKind, name: string, pos?: { x: number; y: number }, packageId?: string) => string;
  updateElement: (id: string, patch: Partial<UmlElement>) => void;
  deleteElement: (id: string) => void;
  addAttribute: (elementId: string, att?: Partial<UmlAttribute>) => void;
  updateAttribute: (elementId: string, attId: string, patch: Partial<UmlAttribute>) => void;
  deleteAttribute: (elementId: string, attId: string) => void;
  addOperation: (elementId: string, op?: Partial<UmlOperation>) => void;
  updateOperation: (elementId: string, opId: string, patch: Partial<UmlOperation>) => void;
  deleteOperation: (elementId: string, opId: string) => void;

  // Smart actions (BouML plugouts parity)
  generateGettersSettersFor: (elementId: string) => void;
  implementMissingInterfaceMethods: (elementId: string) => void;
  applyPatternTo: (elementId: string, pattern: DesignPatternKind) => void;

  // Relation mutations
  addRelation: (sourceId: string, targetId: string, kind?: RelationKind) => string;
  updateRelation: (id: string, patch: Partial<UmlRelation>) => void;
  deleteRelation: (id: string) => void;

  // Layout & Canvas
  updateNodePosition: (elementId: string, x: number, y: number) => void;
  runAutoLayout: (direction?: 'DOWN' | 'RIGHT' | 'UP' | 'LEFT') => Promise<void>;

  // Sync & Imports
  applyPlantUmlToActiveDiagram: (pumlSource: string) => Promise<void>;
  importFiles: (files: Array<{ name: string; content: string }>) => Promise<void>;
  applyAiPlantUml: (rawPlantUml: string) => Promise<void>;
}

const initialProject = createDemoProject();

function commitProject(
  state: ProjectStore,
  nextProject: BoumlProject
): Partial<ProjectStore> {
  return {
    project: nextProject,
    past: [...state.past.slice(-29), state.project],
    future: [],
    issues: validateProject(nextProject),
  };
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: initialProject,
  past: [],
  future: [],
  activeDiagramId: 'diag_classes',
  selectedElementId: 'el_order',
  selectedRelationId: null,
  targetLanguage: initialProject.defaultLanguage,
  rightPanelTab: 'inspector',
  splitCodeOpen: true,
  contextMenu: null,
  activeModal: null,
  copilotContext: null,
  issues: validateProject(initialProject),
  toast: null,

  setActiveDiagram: (id) => set({ activeDiagramId: id, selectedElementId: null, selectedRelationId: null, contextMenu: null }),
  selectElement: (id) => set({ selectedElementId: id, selectedRelationId: null }),
  selectRelation: (id) => set({ selectedRelationId: id, selectedElementId: null }),
  setTargetLanguage: (lang) =>
    set((s) => ({
      targetLanguage: lang,
      project: { ...s.project, defaultLanguage: lang },
    })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  toggleSplitCode: () => set((s) => ({ splitCodeOpen: !s.splitCodeOpen })),
  openContextMenu: (menu) => set({ contextMenu: menu }),
  setActiveModal: (modal) => set({ activeModal: modal, contextMenu: null }),
  openCopilot: (elementId, initialAction) =>
    set({
      copilotContext: { elementId, initialAction },
      activeModal: 'copilot',
      contextMenu: null,
    }),
  showToast: (message, kind = 'info') => {
    set({ toast: { message, kind } });
    setTimeout(() => {
      set((s) => (s.toast?.message === message ? { toast: null } : s));
    }, 3600);
  },

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return s;
      const previous = s.past[s.past.length - 1];
      return {
        project: previous,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future],
        issues: validateProject(previous),
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return {
        project: next,
        past: [...s.past, s.project],
        future: s.future.slice(1),
        issues: validateProject(next),
      };
    }),

  loadProject: (project) => {
    const firstDiag = Object.keys(project.diagrams)[0] ?? '';
    set({
      project,
      past: [],
      future: [],
      activeDiagramId: firstDiag,
      selectedElementId: null,
      selectedRelationId: null,
      targetLanguage: project.defaultLanguage,
      issues: validateProject(project),
    });
  },

  newProject: (name = 'Nouveau Projet UML') => {
    const pkgId = createId('pkg');
    const diagId = createId('diag');
    const fresh: BoumlProject = {
      ...createDemoProject(),
      id: createId('proj'),
      name,
      description: '',
      packages: [{ id: pkgId, parentId: null, name: 'app', namespace: 'app' }],
      elements: {},
      relations: {},
      diagrams: {
        [diagId]: {
          id: diagId,
          packageId: pkgId,
          name: 'Diagramme de Classes',
          kind: 'class',
          nodes: [],
          relationIds: [],
          layoutDirection: 'DOWN',
        },
      },
      preservedBodies: {},
    };
    get().loadProject(fresh);
  },

  addPackage: (name, parentId = null) =>
    set((s) => {
      const parent = s.project.packages.find((p) => p.id === parentId);
      const ns = parent?.namespace ? `${parent.namespace}.${name}` : name;
      const next: BoumlProject = {
        ...s.project,
        packages: [
          ...s.project.packages,
          { id: createId('pkg'), parentId, name, namespace: ns },
        ],
      };
      return commitProject(s, next);
    }),

  addDiagram: (name, kind, packageId) =>
    set((s) => {
      const pkgId = packageId ?? s.project.packages[0]?.id ?? 'pkg_root';
      const id = createId('diag');
      const diag: UmlDiagram = {
        id,
        packageId: pkgId,
        name,
        kind,
        nodes: [],
        relationIds: [],
        layoutDirection: kind === 'state' || kind === 'usecase' ? 'RIGHT' : 'DOWN',
      };
      const next: BoumlProject = {
        ...s.project,
        diagrams: { ...s.project.diagrams, [id]: diag },
      };
      return { ...commitProject(s, next), activeDiagramId: id };
    }),

  deleteDiagram: (diagramId) =>
    set((s) => {
      const entries = Object.entries(s.project.diagrams).filter(([id]) => id !== diagramId);
      if (entries.length === 0) return s;
      const nextDiags = Object.fromEntries(entries);
      const next: BoumlProject = { ...s.project, diagrams: nextDiags };
      return {
        ...commitProject(s, next),
        activeDiagramId: s.activeDiagramId === diagramId ? entries[0][0] : s.activeDiagramId,
      };
    }),

  addElement: (kind, name, pos, packageId) => {
    const id = createId('el');
    set((s) => {
      const diag = s.project.diagrams[s.activeDiagramId];
      const pkgId = packageId ?? diag?.packageId ?? s.project.packages[0]?.id ?? 'pkg_root';
      const el: UmlElement = {
        id,
        packageId: pkgId,
        kind,
        name,
        taggedValues: {},
        visibility: 'public',
        isAbstract: kind === 'interface' || kind === 'abstract_class',
        attributes:
          kind === 'class' || kind === 'abstract_class' || kind === 'struct'
            ? [{ id: createId('att'), name: 'id', type: 'UUID', visibility: 'private', isReadOnly: true }]
            : [],
        operations: [],
        enumLiterals: kind === 'enum' ? ['VALUE_A', 'VALUE_B'] : undefined,
        pseudoStateKind: kind === 'pseudostate' ? 'initial' : undefined,
      };
      const offset = (diag?.nodes.length ?? 0) * 32;
      const nodePos = pos ?? { x: 120 + (offset % 420), y: 80 + (offset % 260) };
      const updatedDiag: UmlDiagram | undefined = diag
        ? { ...diag, nodes: [...diag.nodes, { elementId: id, x: Math.round(nodePos.x), y: Math.round(nodePos.y) }] }
        : undefined;

      const next: BoumlProject = {
        ...s.project,
        elements: { ...s.project.elements, [id]: el },
        diagrams: updatedDiag ? { ...s.project.diagrams, [updatedDiag.id]: updatedDiag } : s.project.diagrams,
      };
      return { ...commitProject(s, next), selectedElementId: id, selectedRelationId: null };
    });
    return id;
  },

  updateElement: (id, patch) =>
    set((s) => {
      const existing = s.project.elements[id];
      if (!existing) return s;
      const next: BoumlProject = {
        ...s.project,
        elements: {
          ...s.project.elements,
          [id]: { ...existing, ...patch },
        },
      };
      return commitProject(s, next);
    }),

  deleteElement: (id) =>
    set((s) => {
      const { [id]: _, ...restElements } = s.project.elements;
      const removedRelIds = new Set<string>();
      const nextRelations: Record<string, UmlRelation> = {};
      for (const [rid, rel] of Object.entries(s.project.relations)) {
        if (rel.sourceId === id || rel.targetId === id) {
          removedRelIds.add(rid);
        } else {
          nextRelations[rid] = rel;
        }
      }
      const nextDiagrams: Record<string, UmlDiagram> = {};
      for (const [did, d] of Object.entries(s.project.diagrams)) {
        nextDiagrams[did] = {
          ...d,
          nodes: d.nodes.filter((n) => n.elementId !== id),
          relationIds: d.relationIds.filter((rid) => !removedRelIds.has(rid)),
        };
      }
      const next: BoumlProject = {
        ...s.project,
        elements: restElements,
        relations: nextRelations,
        diagrams: nextDiagrams,
      };
      return {
        ...commitProject(s, next),
        selectedElementId: s.selectedElementId === id ? null : s.selectedElementId,
      };
    }),

  addAttribute: (elementId, att) =>
    set((s) => {
      const el = s.project.elements[elementId];
      if (!el) return s;
      const newAtt: UmlAttribute = {
        id: createId('att'),
        name: att?.name ?? `field${el.attributes.length + 1}`,
        type: att?.type ?? 'string',
        visibility: att?.visibility ?? 'private',
        ...att,
      };
      return commitProject(s, {
        ...s.project,
        elements: {
          ...s.project.elements,
          [elementId]: { ...el, attributes: [...el.attributes, newAtt] },
        },
      });
    }),

  updateAttribute: (elementId, attId, patch) =>
    set((s) => {
      const el = s.project.elements[elementId];
      if (!el) return s;
      return commitProject(s, {
        ...s.project,
        elements: {
          ...s.project.elements,
          [elementId]: {
            ...el,
            attributes: el.attributes.map((a) => (a.id === attId ? { ...a, ...patch } : a)),
          },
        },
      });
    }),

  deleteAttribute: (elementId, attId) =>
    set((s) => {
      const el = s.project.elements[elementId];
      if (!el) return s;
      return commitProject(s, {
        ...s.project,
        elements: {
          ...s.project.elements,
          [elementId]: {
            ...el,
            attributes: el.attributes.filter((a) => a.id !== attId),
          },
        },
      });
    }),

  addOperation: (elementId, op) =>
    set((s) => {
      const el = s.project.elements[elementId];
      if (!el) return s;
      const newOp: UmlOperation = {
        id: createId('op'),
        name: op?.name ?? `method${el.operations.length + 1}`,
        returnType: op?.returnType ?? 'void',
        visibility: op?.visibility ?? 'public',
        parameters: op?.parameters ?? [],
        ...op,
      };
      return commitProject(s, {
        ...s.project,
        elements: {
          ...s.project.elements,
          [elementId]: { ...el, operations: [...el.operations, newOp] },
        },
      });
    }),

  updateOperation: (elementId, opId, patch) =>
    set((s) => {
      const el = s.project.elements[elementId];
      if (!el) return s;
      return commitProject(s, {
        ...s.project,
        elements: {
          ...s.project.elements,
          [elementId]: {
            ...el,
            operations: el.operations.map((o) => (o.id === opId ? { ...o, ...patch } : o)),
          },
        },
      });
    }),

  deleteOperation: (elementId, opId) =>
    set((s) => {
      const el = s.project.elements[elementId];
      if (!el) return s;
      return commitProject(s, {
        ...s.project,
        elements: {
          ...s.project.elements,
          [elementId]: {
            ...el,
            operations: el.operations.filter((o) => o.id !== opId),
          },
        },
      });
    }),

  generateGettersSettersFor: (elementId) => {
    set((s) => {
      const el = s.project.elements[elementId];
      if (!el) return s;
      const updated = generateGettersSetters(el);
      return commitProject(s, {
        ...s.project,
        elements: { ...s.project.elements, [elementId]: updated },
      });
    });
    get().showToast('Getters & Setters générés avec corps préservés.', 'success');
  },

  implementMissingInterfaceMethods: (elementId) => {
    set((s) => {
      const el = s.project.elements[elementId];
      if (!el) return s;
      const existingNames = new Set(el.operations.map((o) => o.name));
      const additions: UmlOperation[] = [];
      for (const rel of Object.values(s.project.relations)) {
        if (rel.sourceId === elementId && (rel.kind === 'realization' || rel.kind === 'generalization')) {
          const parent = s.project.elements[rel.targetId];
          if (!parent) continue;
          for (const op of parent.operations) {
            if ((op.isAbstract || parent.kind === 'interface') && !existingNames.has(op.name)) {
              existingNames.add(op.name);
              additions.push({
                ...op,
                id: createId('op'),
                isAbstract: false,
                parameters: op.parameters.map((p) => ({ ...p, id: createId('p') })),
              });
            }
          }
        }
      }
      if (additions.length === 0) return s;
      return commitProject(s, {
        ...s.project,
        elements: {
          ...s.project.elements,
          [elementId]: { ...el, operations: [...el.operations, ...additions] },
        },
      });
    });
    get().showToast('Méthodes d\'interface implémentées.', 'success');
  },

  applyPatternTo: (elementId, pattern) => {
    set((s) => {
      const target = s.project.elements[elementId];
      const diag = s.project.diagrams[s.activeDiagramId];
      if (!target || !diag) return s;

      const res = applyDesignPattern(pattern, target);
      const nextElements = { ...s.project.elements };
      if (res.updatedElement) nextElements[elementId] = res.updatedElement;
      const targetPos = diag.nodes.find((n) => n.elementId === elementId) ?? { x: 200, y: 120 };
      const addedNodes = res.newElements.map((ne, idx) => {
        nextElements[ne.id] = ne;
        return { elementId: ne.id, x: targetPos.x + 320 * (idx + 1), y: targetPos.y };
      });
      const nextRelations = { ...s.project.relations };
      const addedRelIds = res.newRelations.map((nr) => {
        nextRelations[nr.id] = nr;
        return nr.id;
      });
      const nextDiag: UmlDiagram = {
        ...diag,
        nodes: [...diag.nodes, ...addedNodes],
        relationIds: [...diag.relationIds, ...addedRelIds],
      };

      return commitProject(s, {
        ...s.project,
        elements: nextElements,
        relations: nextRelations,
        diagrams: { ...s.project.diagrams, [diag.id]: nextDiag },
      });
    });
    get().showToast(`Design Pattern "${pattern}" appliqué !`, 'success');
  },

  addRelation: (sourceId, targetId, kind) => {
    const id = createId('rel');
    set((s) => {
      const diag = s.project.diagrams[s.activeDiagramId];
      if (!diag) return s;
      const defaultKind: RelationKind =
        kind ??
        (diag.kind === 'state'
          ? 'transition'
          : diag.kind === 'sequence'
            ? 'message'
            : diag.kind === 'activity'
              ? 'flow'
              : 'directional_association');
      const rel: UmlRelation = {
        id,
        kind: defaultKind,
        sourceId,
        targetId,
        sourceMultiplicity: diag.kind === 'class' ? '1' : undefined,
        targetMultiplicity: diag.kind === 'class' ? '0..*' : undefined,
        sequenceOrder: defaultKind === 'message' ? diag.relationIds.length + 1 : undefined,
      };
      const next: BoumlProject = {
        ...s.project,
        relations: { ...s.project.relations, [id]: rel },
        diagrams: {
          ...s.project.diagrams,
          [diag.id]: { ...diag, relationIds: [...diag.relationIds, id] },
        },
      };
      return { ...commitProject(s, next), selectedRelationId: id, selectedElementId: null };
    });
    return id;
  },

  updateRelation: (id, patch) =>
    set((s) => {
      const existing = s.project.relations[id];
      if (!existing) return s;
      return commitProject(s, {
        ...s.project,
        relations: { ...s.project.relations, [id]: { ...existing, ...patch } },
      });
    }),

  deleteRelation: (id) =>
    set((s) => {
      const { [id]: _, ...restRels } = s.project.relations;
      const nextDiags: Record<string, UmlDiagram> = {};
      for (const [did, d] of Object.entries(s.project.diagrams)) {
        nextDiags[did] = { ...d, relationIds: d.relationIds.filter((rid) => rid !== id) };
      }
      return {
        ...commitProject(s, { ...s.project, relations: restRels, diagrams: nextDiags }),
        selectedRelationId: s.selectedRelationId === id ? null : s.selectedRelationId,
      };
    }),

  updateNodePosition: (elementId, x, y) =>
    set((s) => {
      const diag = s.project.diagrams[s.activeDiagramId];
      if (!diag) return s;
      const nextDiag: UmlDiagram = {
        ...diag,
        nodes: diag.nodes.map((n) =>
          n.elementId === elementId ? { ...n, x: Math.round(x), y: Math.round(y) } : n
        ),
      };
      return {
        project: {
          ...s.project,
          diagrams: { ...s.project.diagrams, [diag.id]: nextDiag },
        },
      };
    }),

  runAutoLayout: async (direction) => {
    const state = get();
    const diag = state.project.diagrams[state.activeDiagramId];
    if (!diag || diag.nodes.length === 0) return;
    const dir = direction ?? diag.layoutDirection ?? 'DOWN';
    const positions = await computeElkLayout(state.project, diag.id, dir);
    set((s) => {
      const d = s.project.diagrams[diag.id];
      if (!d) return s;
      return commitProject(s, {
        ...s.project,
        diagrams: {
          ...s.project.diagrams,
          [diag.id]: { ...d, nodes: positions, layoutDirection: dir },
        },
      });
    });
    get().showToast('Auto-layout ELK appliqué sans chevauchement.', 'success');
  },

  applyPlantUmlToActiveDiagram: async (pumlSource) => {
    const state = get();
    const diag = state.project.diagrams[state.activeDiagramId];
    if (!diag) return;
    const parsed = parsePlantUml(pumlSource, diag.packageId);
    if (parsed.elements.length === 0) {
      get().showToast('Aucun élément UML détecté dans le code PlantUML.', 'error');
      return;
    }

    set((s) => {
      const nextElements = { ...s.project.elements };
      const nextRelations = { ...s.project.relations };
      const nodePositions = parsed.elements.map((el, idx) => {
        nextElements[el.id] = el;
        return { elementId: el.id, x: (idx % 4) * 280, y: Math.floor(idx / 4) * 220 };
      });
      const relIds = parsed.relations.map((r) => {
        nextRelations[r.id] = r;
        return r.id;
      });
      return commitProject(s, {
        ...s.project,
        elements: nextElements,
        relations: nextRelations,
        diagrams: {
          ...s.project.diagrams,
          [diag.id]: {
            ...diag,
            kind: parsed.diagramKind,
            nodes: nodePositions,
            relationIds: relIds,
          },
        },
      });
    });
    await get().runAutoLayout();
    get().showToast('Modèle synchronisé depuis PlantUML.', 'success');
  },

  importFiles: async (files) => {
    const state = get();
    const pkgId = state.project.packages[0]?.id ?? 'pkg_root';
    const allElements: UmlElement[] = [];
    const allRelations: UmlRelation[] = [];
    const mergedPreserved = { ...state.project.preservedBodies };
    let detectedKind: DiagramKind = 'class';

    for (const file of files) {
      const res = importUniversalFile(file.name, file.content, pkgId);
      if (res.elements.length > 0) detectedKind = res.diagramKind;
      allElements.push(...res.elements);
      allRelations.push(...res.relations);
      if (res.preservedBodies) {
        for (const [opId, body] of Object.entries(res.preservedBodies)) {
          mergedPreserved[opId] = {
            ...(mergedPreserved[opId] ?? {}),
            [state.targetLanguage]: body,
          };
        }
      }
    }

    if (allElements.length === 0) {
      get().showToast('Aucun élément UML reconnu dans les fichiers déposés.', 'error');
      return;
    }

    const diagId = createId('diag');
    const title = files.length === 1 ? `Import: ${files[0].name}` : `Import (${files.length} fichiers)`;

    set((s) => {
      const nextElements = { ...s.project.elements };
      const nextRelations = { ...s.project.relations };
      const nodes = allElements.map((el, idx) => {
        nextElements[el.id] = el;
        return { elementId: el.id, x: (idx % 4) * 280, y: Math.floor(idx / 4) * 220 };
      });
      const relationIds = allRelations.map((r) => {
        nextRelations[r.id] = r;
        return r.id;
      });
      return {
        ...commitProject(s, {
          ...s.project,
          elements: nextElements,
          relations: nextRelations,
          preservedBodies: mergedPreserved,
          diagrams: {
            ...s.project.diagrams,
            [diagId]: {
              id: diagId,
              packageId: pkgId,
              name: title,
              kind: detectedKind,
              nodes,
              relationIds,
              layoutDirection: 'DOWN',
            },
          },
        }),
        activeDiagramId: diagId,
      };
    });

    await get().runAutoLayout();
    get().showToast(`${allElements.length} éléments importés et mis en page automatiquement.`, 'success');
  },

  applyAiPlantUml: async (rawPlantUml) => {
    const state = get();
    const existingRootPkg = state.project.packages[0];
    const rootPkgId = existingRootPkg?.id ?? createId('pkg');
    const blocks = parsePlantUmlBlocks(rawPlantUml, rootPkgId);

    if (blocks.length === 0) {
      throw new Error(
        'Aucun élément UML valide n\'a pu être extrait de la réponse Gemini 4 Hydrogen.'
      );
    }

    const firstTitle =
      blocks[0].title ||
      blocks[0].elements[0]?.name ||
      state.project.name ||
      'Modèle UML';

    const packages = existingRootPkg
      ? [...state.project.packages]
      : [
          {
            id: rootPkgId,
            parentId: null as string | null,
            name: firstTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'app',
            namespace: firstTitle.toLowerCase().replace(/[^a-z0-9]+/g, '.') || 'app',
          },
        ];

    const isProjectEmpty = Object.keys(state.project.elements).length === 0;
    const nextElements: Record<string, UmlElement> = isProjectEmpty ? {} : { ...state.project.elements };
    const nextRelations: Record<string, UmlRelation> = isProjectEmpty ? {} : { ...state.project.relations };
    const nextDiagrams: Record<string, UmlDiagram> = isProjectEmpty ? {} : { ...state.project.diagrams };

    let firstDiagId = '';
    let firstElementId: string | null = null;
    let totalElements = 0;

    for (let i = 0; i < blocks.length; i++) {
      const blk = blocks[i];
      const diagId = createId('diag');
      if (!firstDiagId) firstDiagId = diagId;

      const nodes = blk.elements.map((el, idx) => {
        nextElements[el.id] = el;
        if (!firstElementId) firstElementId = el.id;
        totalElements++;
        return {
          elementId: el.id,
          x: 80 + (idx % 4) * 300,
          y: 80 + Math.floor(idx / 4) * 240,
        };
      });

      const relationIds = blk.relations.map((r) => {
        nextRelations[r.id] = r;
        return r.id;
      });

      nextDiagrams[diagId] = {
        id: diagId,
        packageId: rootPkgId,
        name: blk.title || (blocks.length === 1 ? firstTitle : `${firstTitle} (${i + 1})`),
        kind: blk.diagramKind,
        layoutDirection: blk.diagramKind === 'state' || blk.diagramKind === 'usecase' ? 'RIGHT' : 'DOWN',
        nodes,
        relationIds,
      };
    }

    set((s) => ({
      ...commitProject(s, {
        ...s.project,
        name: isProjectEmpty ? firstTitle : s.project.name,
        packages,
        elements: nextElements,
        relations: nextRelations,
        diagrams: nextDiagrams,
      }),
      activeDiagramId: firstDiagId,
      selectedElementId: firstElementId,
      selectedRelationId: null,
    }));

    await get().runAutoLayout();
    get().showToast(
      `${totalElements} élément(s) modélisé(s) par Gemini 4 Hydrogen !`,
      'success'
    );
  },
}));
