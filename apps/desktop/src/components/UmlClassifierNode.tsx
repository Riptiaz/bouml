import React, { useState } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { Classifier, Project } from "../types/uml";
import { formatTypeRef, visibilitySymbol } from "../types/uml";

export interface UmlClassifierNodeData extends Record<string, unknown> {
  classifier: Classifier;
  project: Project;
  onAddInlineMember: (classifierId: string, rawInput: string) => void;
}

export type UmlClassifierFlowNode = Node<UmlClassifierNodeData, "umlClassifier">;

export const UmlClassifierNode: React.FC<NodeProps<UmlClassifierFlowNode>> = ({
  data,
  selected,
}) => {
  const { classifier, project, onAddInlineMember } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const stereotypeLabel =
    classifier.kind === "interface"
      ? "«interface»"
      : classifier.kind === "enumeration"
        ? "«enumeration»"
        : classifier.is_abstract
          ? "«abstract»"
          : classifier.stereotypes?.[0]
            ? `«${classifier.stereotypes[0].name}»`
            : null;

  const commitInline = () => {
    if (draft.trim()) {
      onAddInlineMember(classifier.id, draft.trim());
    }
    setDraft("");
    setEditing(false);
  };

  return (
    <div
      className={`uml-node uml-kind-${classifier.kind} ${selected ? "selected" : ""}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="Double-click to add attribute or operation (e.g. -email: string or +save(): bool)"
    >
      <Handle type="target" position={Position.Top} className="uml-handle" />

      <div className="uml-node-header">
        {stereotypeLabel && <div className="uml-stereotype">{stereotypeLabel}</div>}
        <div className={`uml-name ${classifier.is_abstract ? "italic" : ""}`}>
          {classifier.name}
        </div>
      </div>

      {classifier.kind === "enumeration" ? (
        <div className="uml-compartment">
          {classifier.literals.length === 0 ? (
            <div className="uml-empty">No literals</div>
          ) : (
            classifier.literals.map((lit) => (
              <div key={lit.name} className="uml-member">
                <span className="uml-vis">•</span>
                <span>{lit.name}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="uml-compartment">
            {classifier.properties.length === 0 ? (
              <div className="uml-empty">—</div>
            ) : (
              classifier.properties.map((p) => (
                <div key={p.id} className="uml-member">
                  <span className={`uml-vis vis-${p.visibility}`}>
                    {visibilitySymbol(p.visibility)}
                  </span>
                  <span className="uml-member-name">{p.name}</span>
                  <span className="uml-member-type">: {formatTypeRef(p.type_ref, project)}</span>
                </div>
              ))
            )}
          </div>

          <div className="uml-compartment">
            {classifier.operations.length === 0 ? (
              <div className="uml-empty">—</div>
            ) : (
              classifier.operations.map((op) => {
                const params = op.params
                  .map((p) => `${p.name}: ${formatTypeRef(p.type_ref, project)}`)
                  .join(", ");
                const ret = op.return_type ? `: ${formatTypeRef(op.return_type, project)}` : "";
                return (
                  <div key={op.id} className="uml-member">
                    <span className={`uml-vis vis-${op.visibility}`}>
                      {visibilitySymbol(op.visibility)}
                    </span>
                    <span className={`uml-member-name ${op.is_abstract ? "italic" : ""}`}>
                      {op.name}({params})
                    </span>
                    <span className="uml-member-type">{ret}</span>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {editing && (
        <div className="uml-inline-editor nodrag" onClick={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={draft}
            placeholder="+method(x: i32): bool or -field: string"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitInline();
              if (e.key === "Escape") {
                setDraft("");
                setEditing(false);
              }
            }}
            onBlur={commitInline}
          />
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="uml-handle" />
    </div>
  );
};
