import React, { useEffect, useRef } from 'react';
import {
  Code2,
  Cpu,
  GitBranch,
  Layers,
  LayoutGrid,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  Wrench,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { COMMON_MULTIPLICITIES, RelationKind } from '../../model/schema';
import { DesignPatternKind } from '../../model/patterns';

const RELATION_OPTIONS: Array<{ kind: RelationKind; label: string }> = [
  { kind: 'directional_association', label: 'Association directionnelle (-->)' },
  { kind: 'association', label: 'Association simple (--)' },
  { kind: 'generalization', label: 'Héritage / Généralisation (--|>)' },
  { kind: 'realization', label: 'Implémentation / Réalisation (..|>)' },
  { kind: 'aggregation', label: 'Agrégation (o--)' },
  { kind: 'composition', label: 'Composition (*--)' },
  { kind: 'dependency', label: 'Dépendance (..>)' },
];

const PATTERN_OPTIONS: Array<{ kind: DesignPatternKind; label: string }> = [
  { kind: 'singleton', label: 'Singleton' },
  { kind: 'factory', label: 'Factory' },
  { kind: 'strategy', label: 'Strategy' },
  { kind: 'observer', label: 'Observer' },
  { kind: 'builder', label: 'Builder' },
];

export const ContextMenu: React.FC = () => {
  const {
    contextMenu,
    openContextMenu,
    project,
    addElement,
    deleteElement,
    addAttribute,
    addOperation,
    generateGettersSettersFor,
    implementMissingInterfaceMethods,
    applyPatternTo,
    updateRelation,
    deleteRelation,
    runAutoLayout,
    selectElement,
    setRightPanelTab,
    openCopilot,
    addDiagram,
    deleteDiagram,
    setActiveDiagram,
  } = useProjectStore();

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        openContextMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openContextMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu, openContextMenu]);

  if (!contextMenu) return null;

  const menuWidth = 264;
  const menuHeight = 420;
  const left = Math.min(contextMenu.x, window.innerWidth - menuWidth - 12);
  const top = Math.min(contextMenu.y, window.innerHeight - menuHeight - 12);

  const close = () => openContextMenu(null);

  const itemCls =
    'w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-indigo-600/80 hover:text-white rounded transition-colors cursor-pointer';
  const sectionCls =
    'px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400';

  const targetEl =
    contextMenu.targetId && (contextMenu.targetType === 'node' || contextMenu.targetType === 'explorer-element')
      ? project.elements[contextMenu.targetId]
      : undefined;

  const targetRel =
    contextMenu.targetId && contextMenu.targetType === 'edge'
      ? project.relations[contextMenu.targetId]
      : undefined;

  return (
    <div
      ref={menuRef}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{ left: Math.max(8, left), top: Math.max(8, top), width: menuWidth }}
      className="fixed z-50 bg-slate-900/98 backdrop-blur-md border border-slate-700/90 rounded-xl shadow-2xl p-1.5 max-h-[82vh] overflow-y-auto"
    >
      {/* NODE CONTEXT MENU */}
      {(contextMenu.targetType === 'node' || contextMenu.targetType === 'explorer-element') && targetEl && (
        <>
          <div className="px-3 py-1.5 border-b border-slate-800 mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-indigo-300 truncate">{targetEl.name}</span>
            <span className="text-[10px] text-slate-400 uppercase">{targetEl.kind}</span>
          </div>

          <button
            className={itemCls}
            onClick={() => {
              addAttribute(targetEl.id);
              selectElement(targetEl.id);
              setRightPanelTab('inspector');
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            Ajouter un attribut
          </button>

          <button
            className={itemCls}
            onClick={() => {
              addOperation(targetEl.id);
              selectElement(targetEl.id);
              setRightPanelTab('inspector');
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            Ajouter une méthode
          </button>

          <button
            className={itemCls}
            onClick={() => {
              generateGettersSettersFor(targetEl.id);
              close();
            }}
          >
            <Wrench className="w-3.5 h-3.5 text-amber-400" />
            Générer Getters / Setters
          </button>

          <button
            className={itemCls}
            onClick={() => {
              implementMissingInterfaceMethods(targetEl.id);
              close();
            }}
          >
            <GitBranch className="w-3.5 h-3.5 text-violet-400" />
            Implémenter une interface
          </button>

          <div className={sectionCls}>Appliquer un Design Pattern</div>
          <div className="grid grid-cols-2 gap-1 px-1.5 pb-1">
            {PATTERN_OPTIONS.map((pat) => (
              <button
                key={pat.kind}
                onClick={() => {
                  applyPatternTo(targetEl.id, pat.kind);
                  close();
                }}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-slate-800/80 hover:bg-indigo-600 text-slate-200 rounded transition-colors cursor-pointer"
              >
                <Wand2 className="w-3 h-3 text-indigo-300" />
                {pat.label}
              </button>
            ))}
          </div>

          <div className="border-t border-slate-800 my-1" />

          <button
            className={itemCls}
            onClick={() => {
              selectElement(targetEl.id);
              setRightPanelTab('code');
              close();
            }}
          >
            <Code2 className="w-3.5 h-3.5 text-cyan-400" />
            Générer le code maintenant
          </button>

          <div className={sectionCls}>Gemini 4 Hydrogen (IA)</div>
          <button
            className={itemCls}
            onClick={() => openCopilot(targetEl.id, 'complete_bodies')}
          >
            <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
            Compléter le corps des méthodes
          </button>
          <button
            className={itemCls}
            onClick={() => openCopilot(targetEl.id, 'audit_solid')}
          >
            <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
            Vérifier les principes SOLID
          </button>
          <button
            className={itemCls}
            onClick={() => openCopilot(targetEl.id, 'generate_tests')}
          >
            <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
            Générer les tests unitaires
          </button>

          <div className="border-t border-slate-800 my-1" />

          <button
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs text-rose-400 hover:bg-rose-600/20 rounded transition-colors cursor-pointer"
            onClick={() => {
              deleteElement(targetEl.id);
              close();
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Supprimer « {targetEl.name} »
          </button>
        </>
      )}

      {/* CANVAS CONTEXT MENU */}
      {contextMenu.targetType === 'canvas' && (
        <>
          <div className={sectionCls}>Créer un élément UML ici</div>
          <button
            className={itemCls}
            onClick={() => {
              addElement('class', 'NouvelleClasse', contextMenu.canvasPosition);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-indigo-400" />
            Nouvelle Classe
          </button>
          <button
            className={itemCls}
            onClick={() => {
              addElement('interface', 'INouvelleInterface', contextMenu.canvasPosition);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            Nouvelle Interface
          </button>
          <button
            className={itemCls}
            onClick={() => {
              addElement('enum', 'NouvelleEnum', contextMenu.canvasPosition);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            Nouvelle Énumération
          </button>
          <button
            className={itemCls}
            onClick={() => {
              addElement('actor', 'Acteur', contextMenu.canvasPosition);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            Nouvel Acteur / Cas d'utilisation
          </button>
          <button
            className={itemCls}
            onClick={() => {
              addElement('state', 'NouvelEtat', contextMenu.canvasPosition);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-violet-400" />
            Nouvel État
          </button>
          <button
            className={itemCls}
            onClick={() => {
              addElement('component', 'NouveauComposant', contextMenu.canvasPosition);
              close();
            }}
          >
            <Cpu className="w-3.5 h-3.5 text-teal-400" />
            Nouveau Composant
          </button>
          <button
            className={itemCls}
            onClick={() => {
              addElement('note', 'Note', contextMenu.canvasPosition);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-yellow-400" />
            Nouvelle Note
          </button>

          <div className="border-t border-slate-800 my-1" />
          <div className={sectionCls}>Mise en page & IA</div>

          <button
            className={itemCls}
            onClick={() => {
              runAutoLayout('DOWN');
              close();
            }}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-cyan-400" />
            Auto-Layout ELK (Haut → Bas)
          </button>
          <button
            className={itemCls}
            onClick={() => {
              runAutoLayout('RIGHT');
              close();
            }}
          >
            <LayoutGrid className="w-3.5 h-3.5 text-cyan-400" />
            Auto-Layout ELK (Gauche → Droite)
          </button>
          <button
            className={itemCls}
            onClick={() => openCopilot(undefined, 'audit_solid')}
          >
            <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
            Demander à Gemini 4 Hydrogen...
          </button>
        </>
      )}

      {/* EDGE (RELATION) CONTEXT MENU */}
      {contextMenu.targetType === 'edge' && targetRel && (
        <>
          <div className={sectionCls}>Type de relation</div>
          {RELATION_OPTIONS.map((opt) => (
            <button
              key={opt.kind}
              className={`${itemCls} ${targetRel.kind === opt.kind ? 'bg-indigo-600/40 text-white' : ''}`}
              onClick={() => {
                updateRelation(targetRel.id, { kind: opt.kind });
                close();
              }}
            >
              <GitBranch className="w-3.5 h-3.5 text-indigo-300" />
              {opt.label}
            </button>
          ))}

          <div className={sectionCls}>Cardinalité cible rapide</div>
          <div className="flex flex-wrap gap-1 px-2 pb-1.5">
            {COMMON_MULTIPLICITIES.filter(Boolean).map((m) => (
              <button
                key={m}
                onClick={() => {
                  updateRelation(targetRel.id, { targetMultiplicity: m });
                  close();
                }}
                className={`px-2 py-0.5 text-[11px] rounded cursor-pointer ${
                  targetRel.targetMultiplicity === m
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="border-t border-slate-800 my-1" />
          <button
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs text-rose-400 hover:bg-rose-600/20 rounded transition-colors cursor-pointer"
            onClick={() => {
              deleteRelation(targetRel.id);
              close();
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Supprimer la relation
          </button>
        </>
      )}

      {/* EXPLORER DIAGRAM MENU */}
      {contextMenu.targetType === 'explorer-diagram' && contextMenu.targetId && (
        <>
          <button
            className={itemCls}
            onClick={() => {
              setActiveDiagram(contextMenu.targetId!);
              close();
            }}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            Ouvrir ce diagramme
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-xs text-rose-400 hover:bg-rose-600/20 rounded transition-colors cursor-pointer"
            onClick={() => {
              deleteDiagram(contextMenu.targetId!);
              close();
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Supprimer le diagramme
          </button>
        </>
      )}

      {/* EXPLORER PACKAGE MENU */}
      {contextMenu.targetType === 'explorer-package' && contextMenu.targetId && (
        <>
          <div className={sectionCls}>Nouveau diagramme dans le package</div>
          <button
            className={itemCls}
            onClick={() => {
              addDiagram('Diagramme de Classes', 'class', contextMenu.targetId);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-indigo-400" />
            Diagramme de Classes
          </button>
          <button
            className={itemCls}
            onClick={() => {
              addDiagram('Cas d\'Utilisation', 'usecase', contextMenu.targetId);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            Diagramme de Cas d'Utilisation
          </button>
          <button
            className={itemCls}
            onClick={() => {
              addDiagram('Diagramme de Séquence', 'sequence', contextMenu.targetId);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            Diagramme de Séquence
          </button>
          <button
            className={itemCls}
            onClick={() => {
              addDiagram('Diagramme d\'États', 'state', contextMenu.targetId);
              close();
            }}
          >
            <Plus className="w-3.5 h-3.5 text-violet-400" />
            Diagramme d'États
          </button>
        </>
      )}
    </div>
  );
};
