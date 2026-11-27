import React from "react";
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  FolderTree,
  Layers,
  Plus,
} from "lucide-react";
import type { ClassifierKind, Diagnostic, Project } from "../types/uml";

interface Props {
  project: Project;
  selectedClassifierId: string | null;
  diagnostics: Diagnostic[];
  onSelectClassifier: (id: string) => void;
  onAddClassifier: (kind: ClassifierKind) => void;
}

export const Sidebar: React.FC<Props> = ({
  project,
  selectedClassifierId,
  diagnostics,
  onSelectClassifier,
  onAddClassifier,
}) => {
  const packages = Object.values(project.packages);
  const diagrams = Object.values(project.diagrams);
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;

  return (
    <aside className="sidebar">
      <div className="panel-header">
        <span className="panel-title">
          <FolderTree size={15} /> {project.name}
        </span>
        <button
          className="icon-btn"
          title="Add Class"
          onClick={() => onAddClassifier("class")}
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="sidebar-section">
        <div className="section-label">Model Explorer</div>
        {packages.map((pkg) => {
          const clfs = pkg.classifiers
            .map((id) => project.classifiers[id])
            .filter(Boolean);
          if (clfs.length === 0 && pkg.id === project.root_package_id) return null;
          return (
            <div key={pkg.id} className="pkg-group">
              <div className="pkg-name">{pkg.name}</div>
              {clfs.map((c) => (
                <button
                  key={c.id}
                  className={`tree-item ${selectedClassifierId === c.id ? "active" : ""}`}
                  onClick={() => onSelectClassifier(c.id)}
                >
                  <Box size={13} />
                  <span>{c.name}</span>
                  <span className="kind-pill">{c.kind}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="sidebar-section">
        <div className="section-label">Diagrams ({diagrams.length})</div>
        {diagrams.map((d) => (
          <div key={d.id} className="tree-item static">
            <Layers size={13} />
            <span>{d.name}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-section diagnostics-section">
        <div className="section-label">UML 2.5 & SOLID Checks</div>
        {diagnostics.length === 0 ? (
          <div className="diag-ok">
            <CheckCircle2 size={14} /> No errors or warnings
          </div>
        ) : (
          diagnostics.map((d, i) => (
            <div key={i} className={`diag-item diag-${d.severity}`}>
              <AlertTriangle size={13} />
              <span>
                <strong>{d.code}</strong> {d.message}
              </span>
            </div>
          ))
        )}
        {errorCount > 0 && <div className="diag-summary">{errorCount} error(s)</div>}
      </div>
    </aside>
  );
};
