import React from 'react';
import { Plus, Trash2, Wrench } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import {
  COMMON_MULTIPLICITIES,
  COMMON_TYPES,
  ElementKind,
  RelationKind,
  Visibility,
} from '../../model/schema';

export const GuidedInspector: React.FC = () => {
  const {
    project,
    selectedElementId,
    selectedRelationId,
    updateElement,
    addAttribute,
    updateAttribute,
    deleteAttribute,
    addOperation,
    updateOperation,
    deleteOperation,
    generateGettersSettersFor,
    updateRelation,
    deleteRelation,
  } = useProjectStore();

  const el = selectedElementId ? project.elements[selectedElementId] : undefined;
  const rel = selectedRelationId ? project.relations[selectedRelationId] : undefined;

  const allTypes = [
    ...COMMON_TYPES,
    ...Object.values(project.elements)
      .filter((e) => ['class', 'interface', 'abstract_class', 'enum', 'struct', 'record'].includes(e.kind))
      .map((e) => e.name),
  ];

  const allStereotypes = project.profiles.flatMap((p) => p.stereotypes.map((s) => s.name));

  if (rel) {
    const src = project.elements[rel.sourceId];
    const tgt = project.elements[rel.targetId];
    return (
      <div className="p-3 space-y-4 text-xs overflow-y-auto h-full">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">
            Inspecteur de Relation
          </div>
          <div className="text-sm font-bold text-white mt-0.5">
            {src?.name ?? '?'} → {tgt?.name ?? '?'}
          </div>
        </div>

        <div className="space-y-2.5">
          <label className="block">
            <span className="text-slate-400 block mb-1">Type de relation</span>
            <select
              value={rel.kind}
              onChange={(e) => updateRelation(rel.id, { kind: e.target.value as RelationKind })}
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100"
            >
              <option value="directional_association">Association directionnelle (--&gt;)</option>
              <option value="association">Association simple (--)</option>
              <option value="generalization">Héritage (--|&gt;)</option>
              <option value="realization">Implémentation (..|&gt;)</option>
              <option value="aggregation">Agrégation (o--)</option>
              <option value="composition">Composition (*--)</option>
              <option value="dependency">Dépendance (..&gt;)</option>
              <option value="include">Include («include»)</option>
              <option value="extend">Extend («extend»)</option>
              <option value="transition">Transition (État)</option>
              <option value="message">Message (Séquence)</option>
            </select>
          </label>

          <label className="block">
            <span className="text-slate-400 block mb-1">Libellé / Verbe</span>
            <input
              value={rel.label ?? ''}
              onChange={(e) => updateRelation(rel.id, { label: e.target.value })}
              placeholder="ex: contains, manages..."
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-slate-400 block mb-1">Cardinalité source</span>
              <select
                value={rel.sourceMultiplicity ?? ''}
                onChange={(e) => updateRelation(rel.id, { sourceMultiplicity: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100"
              >
                {COMMON_MULTIPLICITIES.map((m) => (
                  <option key={`src_${m}`} value={m}>
                    {m || 'Aucune'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-slate-400 block mb-1">Cardinalité cible</span>
              <select
                value={rel.targetMultiplicity ?? ''}
                onChange={(e) => updateRelation(rel.id, { targetMultiplicity: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100"
              >
                {COMMON_MULTIPLICITIES.map((m) => (
                  <option key={`tgt_${m}`} value={m}>
                    {m || 'Aucune'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-slate-400 block mb-1">Rôle cible (nom de champ généré)</span>
            <input
              value={rel.targetRole ?? ''}
              onChange={(e) => updateRelation(rel.id, { targetRole: e.target.value })}
              placeholder="ex: items, orders"
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100"
            />
          </label>

          {rel.kind === 'transition' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-slate-400 block mb-1">Déclencheur (Trigger)</span>
                <input
                  value={rel.trigger ?? ''}
                  onChange={(e) => updateRelation(rel.id, { trigger: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-slate-400 block mb-1">Garde [condition]</span>
                <input
                  value={rel.guard ?? ''}
                  onChange={(e) => updateRelation(rel.id, { guard: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100"
                />
              </label>
            </div>
          )}

          <button
            onClick={() => deleteRelation(rel.id)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/40 text-rose-300 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Supprimer cette relation
          </button>
        </div>
      </div>
    );
  }

  if (!el) {
    return (
      <div className="p-6 text-center text-xs text-slate-500 space-y-2">
        <p className="font-medium text-slate-300">Aucun élément sélectionné</p>
        <p>
          Cliquez sur une classe, un état ou un lien sur le canvas pour l'éditer visuellement ici, ou faites un{' '}
          <span className="text-indigo-400 font-medium">clic droit</span> pour ouvrir le menu contextuel intelligent.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4 text-xs overflow-y-auto h-full">
      {/* Header & Basic Props */}
      <div className="space-y-2.5">
        <div className="text-[10px] uppercase tracking-wider text-indigo-400 font-semibold">
          Inspecteur Visuel Guidé
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block col-span-2">
            <span className="text-slate-400 block mb-1">Nom</span>
            <input
              value={el.name}
              onChange={(e) => updateElement(el.id, { name: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100 font-semibold"
            />
          </label>

          <label className="block">
            <span className="text-slate-400 block mb-1">Type UML</span>
            <select
              value={el.kind}
              onChange={(e) => updateElement(el.id, { kind: e.target.value as ElementKind })}
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100"
            >
              <option value="class">Classe</option>
              <option value="interface">Interface</option>
              <option value="abstract_class">Classe Abstraite</option>
              <option value="enum">Énumération</option>
              <option value="struct">Struct</option>
              <option value="record">Record / DTO</option>
              <option value="actor">Acteur</option>
              <option value="usecase">Cas d'utilisation</option>
              <option value="state">État</option>
              <option value="component">Composant</option>
              <option value="node">Nœud Déploiement</option>
              <option value="note">Note</option>
            </select>
          </label>

          <label className="block">
            <span className="text-slate-400 block mb-1">Stéréotype</span>
            <select
              value={el.stereotype ?? ''}
              onChange={(e) => updateElement(el.id, { stereotype: e.target.value || undefined })}
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-slate-100"
            >
              <option value="">Aucun</option>
              {allStereotypes.map((st) => (
                <option key={st} value={st}>
                  «{st}»
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-4 pt-0.5">
          <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(el.isAbstract)}
              onChange={(e) => updateElement(el.id, { isAbstract: e.target.checked })}
              className="accent-indigo-500"
            />
            abstract
          </label>
          <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(el.isFinal)}
              onChange={(e) => updateElement(el.id, { isFinal: e.target.checked })}
              className="accent-indigo-500"
            />
            final
          </label>
        </div>

        <label className="block">
          <span className="text-slate-400 block mb-1">Description / Documentation</span>
          <textarea
            rows={2}
            value={el.description ?? ''}
            onChange={(e) => updateElement(el.id, { description: e.target.value })}
            className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-slate-200 resize-none"
          />
        </label>
      </div>

      {/* State actions */}
      {el.kind === 'state' && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <div className="text-[11px] font-semibold text-violet-300">Actions d'état</div>
          <input
            placeholder="entry / ..."
            value={el.stateEntry ?? ''}
            onChange={(e) => updateElement(el.id, { stateEntry: e.target.value })}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
          />
          <input
            placeholder="do / ..."
            value={el.stateDo ?? ''}
            onChange={(e) => updateElement(el.id, { stateDo: e.target.value })}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
          />
          <input
            placeholder="exit / ..."
            value={el.stateExit ?? ''}
            onChange={(e) => updateElement(el.id, { stateExit: e.target.value })}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1"
          />
        </div>
      )}

      {/* Enum literals */}
      {el.kind === 'enum' && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <div className="text-[11px] font-semibold text-amber-300">Valeurs d'énumération (une par ligne)</div>
          <textarea
            rows={5}
            value={(el.enumLiterals ?? []).join('\n')}
            onChange={(e) =>
              updateElement(el.id, {
                enumLiterals: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            className="w-full bg-slate-950 border border-slate-700 rounded p-2 font-mono text-xs text-amber-200"
          />
        </div>
      )}

      {/* Attributes */}
      {['class', 'interface', 'abstract_class', 'struct', 'record'].includes(el.kind) && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-300">
              Attributs ({el.attributes.length})
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => generateGettersSettersFor(el.id)}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-amber-300 cursor-pointer"
                title="Générer Getters/Setters"
              >
                <Wrench className="w-3 h-3" />
                Get/Set
              </button>
              <button
                onClick={() => addAttribute(el.id)}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/40 text-[10px] text-emerald-300 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                Ajouter
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {el.attributes.map((att) => (
              <div key={att.id} className="p-2 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <select
                    value={att.visibility}
                    onChange={(e) => updateAttribute(el.id, att.id, { visibility: e.target.value as Visibility })}
                    className="bg-slate-900 border border-slate-700 rounded px-1 py-1 text-[11px]"
                  >
                    <option value="private">- priv</option>
                    <option value="public">+ pub</option>
                    <option value="protected"># prot</option>
                    <option value="package">~ pkg</option>
                  </select>
                  <input
                    value={att.name}
                    onChange={(e) => updateAttribute(el.id, att.id, { name: e.target.value })}
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-[11px]"
                  />
                  <button
                    onClick={() => deleteAttribute(el.id, att.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={allTypes.includes(att.type) ? att.type : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') {
                        updateAttribute(el.id, att.id, { type: e.target.value });
                      }
                    }}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] font-mono text-indigo-300"
                  >
                    {!allTypes.includes(att.type) && (
                      <option value="__custom__">{att.type}</option>
                    )}
                    {Array.from(new Set(allTypes)).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>

                  <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(att.isStatic)}
                      onChange={(e) => updateAttribute(el.id, att.id, { isStatic: e.target.checked })}
                      className="accent-indigo-500"
                    />
                    static
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(att.isReadOnly)}
                      onChange={(e) => updateAttribute(el.id, att.id, { isReadOnly: e.target.checked })}
                      className="accent-indigo-500"
                    />
                    const
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operations */}
      {['class', 'interface', 'abstract_class', 'struct', 'record'].includes(el.kind) && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-sky-300">
              Méthodes ({el.operations.length})
            </span>
            <button
              onClick={() => addOperation(el.id)}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-sky-600/20 hover:bg-sky-600/40 text-[10px] text-sky-300 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              Ajouter
            </button>
          </div>

          <div className="space-y-2">
            {el.operations.map((op) => (
              <div key={op.id} className="p-2 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <select
                    value={op.visibility}
                    onChange={(e) => updateOperation(el.id, op.id, { visibility: e.target.value as Visibility })}
                    className="bg-slate-900 border border-slate-700 rounded px-1 py-1 text-[11px]"
                  >
                    <option value="public">+ pub</option>
                    <option value="private">- priv</option>
                    <option value="protected"># prot</option>
                    <option value="package">~ pkg</option>
                  </select>
                  <input
                    value={op.name}
                    onChange={(e) => updateOperation(el.id, op.id, { name: e.target.value })}
                    className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 font-mono text-[11px]"
                  />
                  <button
                    onClick={() => deleteOperation(el.id, op.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500">Retour :</span>
                  <select
                    value={allTypes.includes(op.returnType) ? op.returnType : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') {
                        updateOperation(el.id, op.id, { returnType: e.target.value });
                      }
                    }}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono text-sky-300"
                  >
                    {!allTypes.includes(op.returnType) && (
                      <option value="__custom__">{op.returnType}</option>
                    )}
                    {Array.from(new Set(allTypes)).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(op.isStatic)}
                      onChange={(e) => updateOperation(el.id, op.id, { isStatic: e.target.checked })}
                      className="accent-indigo-500"
                    />
                    static
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(op.isAbstract)}
                      onChange={(e) => updateOperation(el.id, op.id, { isAbstract: e.target.checked })}
                      className="accent-indigo-500"
                    />
                    abstract
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(op.isVirtual)}
                      onChange={(e) => updateOperation(el.id, op.id, { isVirtual: e.target.checked })}
                      className="accent-indigo-500"
                    />
                    virtual
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(op.isConst)}
                      onChange={(e) => updateOperation(el.id, op.id, { isConst: e.target.checked })}
                      className="accent-indigo-500"
                    />
                    const
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(op.isAsync)}
                      onChange={(e) => updateOperation(el.id, op.id, { isAsync: e.target.checked })}
                      className="accent-indigo-500"
                    />
                    async
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
