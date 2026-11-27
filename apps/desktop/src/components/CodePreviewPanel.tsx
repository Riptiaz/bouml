import React, { useEffect, useState } from "react";
import { Code2, Copy, Check } from "lucide-react";
import type { GeneratedFile, Project, TargetLanguage } from "../types/uml";
import { fetchCodePreview } from "../services/bridge";

const LANGUAGES: { id: TargetLanguage; label: string }[] = [
  { id: "rust", label: "Rust" },
  { id: "typescript", label: "TypeScript" },
  { id: "cpp", label: "C++20" },
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "go", label: "Go" },
  { id: "php", label: "PHP" },
  { id: "sql", label: "SQL" },
];

interface Props {
  project: Project;
  selectedClassifierId: string | null;
  language: TargetLanguage;
  onLanguageChange: (lang: TargetLanguage) => void;
}

export const CodePreviewPanel: React.FC<Props> = ({
  project,
  selectedClassifierId,
  language,
  onLanguageChange,
}) => {
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [preserveBodies, setPreserveBodies] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!selectedClassifierId) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    fetchCodePreview(project, selectedClassifierId, language, preserveBodies).then((res) => {
      if (!cancelled) setFiles(res);
    });
    return () => {
      cancelled = true;
    };
  }, [project, selectedClassifierId, language, preserveBodies]);

  const activeFile = files[0];

  const handleCopy = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside className="code-panel">
      <div className="panel-header">
        <span className="panel-title">
          <Code2 size={15} /> Live Code Preview
        </span>
        <select
          className="lang-select"
          value={language}
          onChange={(e) => onLanguageChange(e.target.value as TargetLanguage)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="code-toolbar">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={preserveBodies}
            onChange={(e) => setPreserveBodies(e.target.checked)}
          />
          Preserved body markers
        </label>
        {activeFile && (
          <button className="icon-btn" onClick={handleCopy} title="Copy generated code">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        )}
      </div>

      {!selectedClassifierId ? (
        <div className="panel-empty">
          Select a UML classifier on the canvas to preview its generated code in real time.
        </div>
      ) : activeFile ? (
        <div className="code-body">
          <div className="code-filename">{activeFile.relative_path}</div>
          <pre className="code-pre">
            <code>{activeFile.content}</code>
          </pre>
        </div>
      ) : (
        <div className="panel-empty">No output for this classifier in {language}.</div>
      )}
    </aside>
  );
};
