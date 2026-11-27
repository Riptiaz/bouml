import React, { useState } from 'react';
import { Handle, NodeProps, Position } from '@xyflow/react';
import { UmlElement, VISIBILITY_SYMBOLS } from '../../model/schema';
import { useProjectStore } from '../../store/useProjectStore';

export interface UmlNodeData extends Record<string, unknown> {
  element: UmlElement;
  diagramKind?: string;
  lifelineHeight?: number;
}

const KIND_ACCENT: Record<string, string> = {
  class: 'from-indigo-600/90 to-indigo-700/90 border-indigo-400/50',
  interface: 'from-emerald-600/90 to-teal-700/90 border-emerald-400/50',
  abstract_class: 'from-violet-600/90 to-purple-700/90 border-violet-400/50',
  enum: 'from-amber-600/90 to-orange-700/90 border-amber-400/50',
  struct: 'from-slate-600/90 to-slate-700/90 border-slate-400/50',
  record: 'from-cyan-600/90 to-sky-700/90 border-cyan-400/50',
  component: 'from-teal-600/90 to-cyan-700/90 border-teal-400/50',
  node: 'from-sky-600/90 to-blue-700/90 border-sky-400/50',
  artifact: 'from-slate-600/90 to-slate-700/90 border-slate-400/50',
  lifeline: 'from-blue-600/90 to-indigo-700/90 border-blue-400/50',
  object_instance: 'from-fuchsia-600/90 to-purple-700/90 border-fuchsia-400/50',
};

const handleStyle = '!w-2.5 !h-2.5 !bg-indigo-400 !border-2 !border-slate-950 hover:!bg-white transition-colors';

export const UmlNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as UmlNodeData;
  const el = nodeData.element;
  const isSequenceDiag = nodeData.diagramKind === 'sequence';
  const lifelineHeight = nodeData.lifelineHeight ?? 360;
  const { updateElement, openContextMenu, selectElement } = useProjectStore();
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(el.name);

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selectElement(el.id);
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetType: 'node',
      targetId: el.id,
    });
  };

  const commitName = () => {
    setEditingName(false);
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== el.name) {
      updateElement(el.id, { name: trimmed });
    } else {
      setDraftName(el.name);
    }
  };

  const handles = (
    <>
      <Handle type="target" position={Position.Top} id="top" className={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={handleStyle} />
      <Handle type="target" position={Position.Left} id="left" className={handleStyle} />
      <Handle type="source" position={Position.Right} id="right" className={handleStyle} />
    </>
  );

  // Sequence diagram participant / actor with vertical dashed lifeline
  if (isSequenceDiag && (el.kind === 'lifeline' || el.kind === 'actor' || el.kind === 'class')) {
    return (
      <div
        onContextMenu={handleRightClick}
        style={{ height: lifelineHeight, width: 170 }}
        className="relative flex flex-col items-center pointer-events-auto"
      >
        <Handle type="target" position={Position.Left} id="left" className="!opacity-0" />
        <Handle type="source" position={Position.Right} id="right" className="!opacity-0" />
        <Handle type="target" position={Position.Top} id="top" className="!opacity-0" />
        <Handle type="source" position={Position.Bottom} id="bottom" className="!opacity-0" />

        <div
          className={`w-full px-3 py-2 rounded-xl border-2 text-center shadow-lg z-10 ${
            el.kind === 'actor'
              ? 'bg-slate-900 border-sky-500/70'
              : 'bg-gradient-to-r from-blue-600/90 to-indigo-700/90 border-blue-400/70'
          } ${selected ? 'ring-2 ring-indigo-400' : ''}`}
        >
          {el.kind === 'actor' && (
            <div className="text-[10px] uppercase tracking-wider text-sky-300 font-semibold">«actor»</div>
          )}
          <div className="text-xs font-bold text-white truncate">{el.name}</div>
        </div>

        {/* Vertical dashed lifeline */}
        <div
          className="flex-1 w-0 border-l-2 border-dashed border-slate-500/80 my-1"
          style={{ minHeight: Math.max(220, lifelineHeight - 64) }}
        />

        {/* Foot box */}
        <div className="w-24 h-2 rounded-full bg-slate-600/60" />
      </div>
    );
  }

  // Pseudostate (Initial / Final)
  if (el.kind === 'pseudostate') {
    const isFinal = el.pseudoStateKind === 'final' || el.pseudoStateKind === 'terminate';
    return (
      <div
        onContextMenu={handleRightClick}
        className={`relative flex items-center justify-center w-10 h-10 rounded-full ${
          isFinal
            ? 'border-2 border-slate-200 bg-slate-950 p-1'
            : 'bg-indigo-400 border-2 border-indigo-200'
        } ${selected ? 'ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-950' : ''}`}
      >
        {handles}
        {isFinal && <div className="w-5 h-5 rounded-full bg-slate-200" />}
      </div>
    );
  }

  // Actor
  if (el.kind === 'actor') {
    return (
      <div
        onContextMenu={handleRightClick}
        className={`relative flex flex-col items-center px-4 py-2 rounded-xl bg-slate-900/90 border ${
          selected ? 'border-indigo-400 ring-2 ring-indigo-500/40' : 'border-slate-700'
        }`}
      >
        {handles}
        <svg width="36" height="48" viewBox="0 0 36 48" className="stroke-sky-300 fill-none" strokeWidth="2.2">
          <circle cx="18" cy="10" r="7" />
          <line x1="18" y1="17" x2="18" y2="33" />
          <line x1="5" y1="23" x2="31" y2="23" />
          <line x1="18" y1="33" x2="8" y2="46" />
          <line x1="18" y1="33" x2="28" y2="46" />
        </svg>
        <span className="mt-1 text-xs font-semibold text-slate-100">{el.name}</span>
      </div>
    );
  }

  // UseCase oval
  if (el.kind === 'usecase') {
    return (
      <div
        onContextMenu={handleRightClick}
        className={`relative flex flex-col items-center justify-center px-6 py-3.5 rounded-full bg-slate-900/95 border-2 min-w-[175px] text-center shadow-lg ${
          selected ? 'border-emerald-400 ring-2 ring-emerald-500/30' : 'border-emerald-500/60'
        }`}
      >
        {handles}
        {el.subsystem && (
          <span className="text-[9px] uppercase tracking-wider text-emerald-400/90 font-semibold mb-0.5">
            [{el.subsystem}]
          </span>
        )}
        <span className="text-xs font-semibold text-emerald-100">{el.name}</span>
      </div>
    );
  }

  // State rounded box
  if (el.kind === 'state') {
    return (
      <div
        onContextMenu={handleRightClick}
        className={`relative rounded-2xl bg-slate-900/95 border-2 min-w-[175px] shadow-lg overflow-hidden ${
          selected ? 'border-violet-400 ring-2 ring-violet-500/30' : 'border-violet-500/60'
        }`}
      >
        {handles}
        <div className="px-4 py-2 bg-violet-600/25 border-b border-violet-500/30 text-center">
          {el.stateGroup && (
            <div className="text-[9px] uppercase tracking-wider text-violet-300/90 font-semibold">
              {el.stateGroup}
            </div>
          )}
          <div className="text-xs font-bold text-violet-100">{el.name}</div>
        </div>
        {(el.stateEntry || el.stateDo || el.stateExit) && (
          <div className="px-3 py-2 text-[11px] font-mono text-slate-300 space-y-0.5">
            {el.stateEntry && <div>entry / {el.stateEntry}</div>}
            {el.stateDo && <div>do / {el.stateDo}</div>}
            {el.stateExit && <div>exit / {el.stateExit}</div>}
          </div>
        )}
      </div>
    );
  }

  // Note
  if (el.kind === 'note') {
    return (
      <div
        onContextMenu={handleRightClick}
        className={`relative rounded-md bg-amber-950/80 border min-w-[160px] max-w-[260px] p-3 shadow-md ${
          selected ? 'border-amber-300 ring-2 ring-amber-400/30' : 'border-amber-500/50'
        }`}
      >
        {handles}
        <div className="text-[11px] font-semibold text-amber-200 mb-1">{el.name}</div>
        <div className="text-[11px] text-amber-100/80 whitespace-pre-wrap">
          {el.description || 'Double-cliquez ou utilisez l\'inspecteur pour éditer cette note.'}
        </div>
      </div>
    );
  }

  // Default: Class / Interface / Enum / Struct / Component / Node / Lifeline
  const headerGradient = KIND_ACCENT[el.kind] ?? KIND_ACCENT.class;
  const stereoBadge =
    el.stereotype ||
    (el.kind === 'interface'
      ? 'interface'
      : el.kind === 'enum'
        ? 'enumeration'
        : el.kind === 'abstract_class'
          ? 'abstract'
          : el.kind === 'component'
            ? 'component'
            : el.kind === 'node'
              ? 'node'
              : undefined);

  return (
    <div
      onContextMenu={handleRightClick}
      className={`relative min-w-[220px] max-w-[360px] rounded-xl bg-slate-900/95 border shadow-xl overflow-hidden transition-shadow ${
        selected
          ? 'border-indigo-400 ring-2 ring-indigo-500/40 shadow-indigo-500/20'
          : 'border-slate-700/90 hover:border-slate-500'
      }`}
    >
      {handles}

      {/* Header */}
      <div className={`px-3 py-2 bg-gradient-to-r ${headerGradient} border-b text-center`}>
        {stereoBadge && (
          <div className="text-[10px] tracking-wide text-white/80 font-medium truncate max-w-[300px] mx-auto" title={`«${stereoBadge}»`}>
            «{stereoBadge}»
          </div>
        )}
        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setDraftName(el.name);
                setEditingName(false);
              }
            }}
            className="w-full bg-slate-950/80 text-white text-xs font-bold text-center rounded px-1.5 py-0.5 outline-none border border-white/40"
          />
        ) : (
          <div
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraftName(el.name);
              setEditingName(true);
            }}
            title="Double-clic pour renommer • Clic droit pour le menu UML"
            className={`text-xs font-bold text-white tracking-tight ${
              el.isAbstract || el.kind === 'abstract_class' ? 'italic' : ''
            }`}
          >
            {el.name}
            {el.generics && el.generics.length > 0 && (
              <span className="font-normal text-white/80">
                &lt;{el.generics.map((g) => g.name).join(', ')}&gt;
              </span>
            )}
          </div>
        )}
      </div>

      {/* Enum literals */}
      {el.kind === 'enum' && (
        <div className="px-3 py-2 text-[11px] font-mono text-amber-200/90 space-y-0.5">
          {(el.enumLiterals ?? []).map((lit, i) => (
            <div key={i}>{lit}</div>
          ))}
        </div>
      )}

      {/* Attributes compartment */}
      {el.kind !== 'enum' && (
        <div className="px-3 py-1.5 border-b border-slate-800/90 text-[11px] font-mono space-y-0.5 min-h-[24px]">
          {el.attributes.length === 0 ? (
            <div className="text-[10px] text-slate-600 italic">— aucun attribut —</div>
          ) : (
            el.attributes.map((att) => (
              <div
                key={att.id}
                className={`flex items-center justify-between gap-2 text-slate-200 ${
                  att.isStatic ? 'underline' : ''
                }`}
              >
                <span className="truncate">
                  <span className="text-indigo-400 mr-1">{VISIBILITY_SYMBOLS[att.visibility]}</span>
                  {att.name}
                </span>
                <span className="text-slate-400 shrink-0">
                  : {att.type}
                  {att.isReadOnly && <span className="text-amber-400/90 ml-1 text-[10px]">{'{ro}'}</span>}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Operations compartment */}
      {el.kind !== 'enum' && (
        <div className="px-3 py-1.5 text-[11px] font-mono space-y-0.5 min-h-[24px]">
          {el.operations.length === 0 ? (
            <div className="text-[10px] text-slate-600 italic">— aucune méthode —</div>
          ) : (
            el.operations.map((op) => (
              <div
                key={op.id}
                className={`flex items-center justify-between gap-2 text-slate-200 ${
                  op.isStatic ? 'underline' : ''
                } ${op.isAbstract ? 'italic text-violet-200' : ''}`}
              >
                <span className="truncate">
                  <span className="text-sky-400 mr-1">{VISIBILITY_SYMBOLS[op.visibility]}</span>
                  {op.name}({op.parameters.map((p) => `${p.name}: ${p.type}`).join(', ')})
                </span>
                <span className="text-slate-400 shrink-0">
                  {op.returnType ? `: ${op.returnType}` : ''}
                  {op.isConst && <span className="text-emerald-400/90 ml-1 text-[10px]">const</span>}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
