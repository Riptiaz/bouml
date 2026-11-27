import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Code2,
  Command as CommandIcon,
  Grid,
  LayoutGrid,
  Moon,
  Plus,
  Sparkles,
  Sun,
  Upload,
} from "lucide-react";
import {
  UmlClassifierNode,
  type UmlClassifierFlowNode,
} from "./components/UmlClassifierNode";
import { AiAssistantPanel } from "./components/AiAssistantPanel";
import { CodePreviewPanel } from "./components/CodePreviewPanel";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { Sidebar } from "./components/Sidebar";
import { applyElkAutoLayout } from "./layout/elkLayout";
import { createStarterProject, validateProjectModel } from "./services/bridge";
import {
  formatMultiplicity,
  parseInlineMember,
  type Classifier,
  type ClassifierKind,
  type Diagnostic,
  type Project,
  type Relation,
  type TargetLanguage,
} from "./types/uml";

const nodeTypes: NodeTypes = {
  umlClassifier: UmlClassifierNode,
};

function relationToEdge(rel: Relation): Edge {
  const isDashed =
    rel.kind === "interface_realization" ||
    rel.kind === "dependency" ||
    rel.kind === "usage";
  const labelParts: string[] = [];
  if (rel.target.role_name) labelParts.push(rel.target.role_name);
  if (rel.kind === "association" || rel.kind === "aggregation" || rel.kind === "composition") {
    labelParts.push(formatMultiplicity(rel.target.multiplicity));
  }

  return {
    id: rel.id,
    source: rel.source.classifier_id,
    target: rel.target.classifier_id,
    type: "smoothstep",
    animated: rel.kind === "dependency",
    label: labelParts.join(" "),
    style: {
      strokeDasharray: isDashed ? "6 4" : undefined,
      strokeWidth: 1.75,
    },
    markerEnd: {
      type:
        rel.kind === "generalization" || rel.kind === "interface_realization"
          ? MarkerType.ArrowClosed
          : MarkerType.Arrow,
      width: 18,
      height: 18,
    },
  };
}

export const App: React.FC = () => {
  const [project, setProject] = useState<Project>(() => createStarterProject());
  const [undoStack, setUndoStack] = useState<Project[]>([]);
  const [rightTab, setRightTab] = useState<"ai" | "code">("ai");
  const [selectedId, setSelectedId] = useState<string | null>("clf_payment_processor");
  const [language, setLanguage] = useState<TargetLanguage>("rust");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>("Ready — ELK Auto-Layout & AI Copilot active");

  const [nodes, setNodes, onNodesChange] = useNodesState<UmlClassifierFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Global Ctrl+K / Cmd+K shortcut for Command Palette
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const commitProject = useCallback((next: Project, msg: string) => {
    setProject((prev) => {
      setUndoStack((stack) => [...stack.slice(-19), prev]);
      return next;
    });
    setStatusMsg(msg);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setProject(previous);
      setStatusMsg("Undid last change");
      return stack.slice(0, -1);
    });
  }, []);

  const handleAddInlineMember = useCallback((classifierId: string, rawInput: string) => {
    const parsed = parseInlineMember(rawInput);
    if (!parsed) return;

    setProject((prev) => {
      const target = prev.classifiers[classifierId];
      if (!target) return prev;
      setUndoStack((stack) => [...stack.slice(-19), prev]);
      const updated: Classifier =
        parsed.kind === "property"
          ? { ...target, properties: [...target.properties, parsed.property] }
          : { ...target, operations: [...target.operations, parsed.operation] };
      return {
        ...prev,
        classifiers: { ...prev.classifiers, [classifierId]: updated },
      };
    });
    setStatusMsg(`Added inline member '${rawInput}'`);
  }, []);

  const handleAddClassifier = useCallback(
    (kind: ClassifierKind = "class") => {
      const count = Object.keys(project.classifiers).length + 1;
      const id = `clf_${Date.now().toString(36)}`;
      const pkgId =
        Object.values(project.packages).find((p) => p.parent_id !== null)?.id ??
        project.root_package_id;
      const prefix =
        kind === "interface" ? "IContract" : kind === "enumeration" ? "Status" : "NewClass";
      const clf: Classifier = {
        id,
        name: `${prefix}${count}`,
        package_id: pkgId,
        kind,
        visibility: "public",
        is_abstract: kind === "interface",
        properties: [],
        operations: [],
        literals: kind === "enumeration" ? [{ name: "VALUE_1" }] : [],
      };

      const pkg = project.packages[pkgId];
      const next: Project = {
        ...project,
        packages: pkg
          ? {
              ...project.packages,
              [pkgId]: { ...pkg, classifiers: [...pkg.classifiers, id] },
            }
          : project.packages,
        classifiers: { ...project.classifiers, [id]: clf },
      };
      commitProject(next, `Created ${kind} '${clf.name}'`);
      setSelectedId(id);
    },
    [commitProject, project]
  );

  // Sync Project -> XYFlow Nodes & Edges + run ELKjs Auto-Layout
  const rebuildAndLayout = useCallback(
    async (proj: Project) => {
      const rawNodes: UmlClassifierFlowNode[] = Object.values(proj.classifiers).map((clf) => ({
        id: clf.id,
        type: "umlClassifier",
        position: { x: 0, y: 0 },
        data: {
          classifier: clf,
          project: proj,
          onAddInlineMember: handleAddInlineMember,
        },
      }));
      const rawEdges: Edge[] = Object.values(proj.relations).map(relationToEdge);
      const laidOut = await applyElkAutoLayout(rawNodes, rawEdges, proj.classifiers);
      setNodes(laidOut);
      setEdges(rawEdges);
    },
    [handleAddInlineMember, setEdges, setNodes]
  );

  useEffect(() => {
    void rebuildAndLayout(project);
    void validateProjectModel(project).then(setDiagnostics);
  }, [project, rebuildAndLayout]);

  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: "open-ai",
        category: "AI",
        label: "Open AI Copilot (Text-to-UML & Refactoring)",
        run: () => setRightTab("ai"),
      },
      {
        id: "open-code",
        category: "Codegen",
        label: "Open Live Code Preview Panel",
        run: () => setRightTab("code"),
      },
      {
        id: "add-class",
        category: "Model",
        label: "Add UML Class",
        run: () => handleAddClassifier("class"),
      },
      {
        id: "add-interface",
        category: "Model",
        label: "Add UML Interface",
        run: () => handleAddClassifier("interface"),
      },
      {
        id: "add-enum",
        category: "Model",
        label: "Add UML Enumeration",
        run: () => handleAddClassifier("enumeration"),
      },
      {
        id: "elk-layout",
        category: "Layout",
        label: "Run ELK Sugiyama Auto-Layout",
        shortcut: "Auto",
        run: () => {
          void rebuildAndLayout(project);
          setStatusMsg("Applied ELK Sugiyama Auto-Layout");
        },
      },
      {
        id: "undo",
        category: "Edit",
        label: "Undo Last Change",
        run: handleUndo,
      },
      {
        id: "toggle-theme",
        category: "View",
        label: `Switch to ${theme === "dark" ? "Light" : "Dark"} Theme`,
        run: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
      },
      {
        id: "toggle-grid",
        category: "View",
        label: snapToGrid ? "Disable Magnetic Snap Grid" : "Enable Magnetic Snap Grid",
        run: () => setSnapToGrid((s) => !s),
      },
      ...(
        ["rust", "typescript", "cpp", "python", "java", "go", "php", "sql"] as TargetLanguage[]
      ).map((lang) => ({
        id: `lang-${lang}`,
        category: "Codegen",
        label: `Preview Code in ${lang.toUpperCase()}`,
        run: () => {
          setLanguage(lang);
          setRightTab("code");
        },
      })),
    ],
    [handleAddClassifier, handleUndo, project, rebuildAndLayout, snapToGrid, theme]
  );

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setStatusMsg(`Dropped '${file.name}' — ready for universal importer`);
  };

  return (
    <div
      className="app-shell"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropFiles}
    >
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand">BouML Next</span>
          <span className="badge">UML 2.5</span>
        </div>

        <div className="topbar-center">
          <button
            className="toolbar-btn"
            onClick={() => handleAddClassifier("class")}
            title="Add UML Class"
          >
            <Plus size={14} /> Class
          </button>
          <button
            className="toolbar-btn"
            onClick={() => handleAddClassifier("interface")}
            title="Add UML Interface"
          >
            <Plus size={14} /> Interface
          </button>
          <button
            className="toolbar-btn primary"
            onClick={() => {
              void rebuildAndLayout(project);
              setStatusMsg("Applied ELK Auto-Layout");
            }}
            title="Run ELK Auto-Layout"
          >
            <LayoutGrid size={14} /> Auto-Layout
          </button>
          <button
            className={`toolbar-btn ${snapToGrid ? "active" : ""}`}
            onClick={() => setSnapToGrid((s) => !s)}
            title="Toggle Magnetic Snap Grid"
          >
            <Grid size={14} /> Grid
          </button>
          <button
            className={`toolbar-btn ${rightTab === "ai" ? "active" : ""}`}
            onClick={() => setRightTab(rightTab === "ai" ? "code" : "ai")}
            title="Toggle AI Copilot"
          >
            <Sparkles size={14} /> AI Copilot
          </button>
        </div>

        <div className="topbar-right">
          <button
            className="palette-trigger"
            onClick={() => setPaletteOpen(true)}
            title="Open Command Palette (Ctrl+K)"
          >
            <CommandIcon size={13} /> Commands <kbd>Ctrl+K</kbd>
          </button>
          <button
            className="icon-btn"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title="Toggle Dark/Light Theme"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <div className="workspace-body">
        <Sidebar
          project={project}
          selectedClassifierId={selectedId}
          diagnostics={diagnostics}
          onSelectClassifier={setSelectedId}
          onAddClassifier={handleAddClassifier}
        />

        <main className="canvas-container">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            snapToGrid={snapToGrid}
            snapGrid={[16, 16]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color="var(--grid-dot)"
            />
            <Controls />
            <MiniMap zoomable pannable />
          </ReactFlow>

          <div className="canvas-statusbar">
            <span>{statusMsg}</span>
            <span className="drop-hint">
              <Upload size={12} /> Drag & drop .puml / .mmd / .sql / OpenAPI / code
            </span>
          </div>
        </main>

        <div className="right-drawer">
          <div className="drawer-tabs">
            <button
              className={`drawer-tab ${rightTab === "ai" ? "active" : ""}`}
              onClick={() => setRightTab("ai")}
            >
              <Sparkles size={14} /> AI Copilot
            </button>
            <button
              className={`drawer-tab ${rightTab === "code" ? "active" : ""}`}
              onClick={() => setRightTab("code")}
            >
              <Code2 size={14} /> Live Code
            </button>
          </div>
          {rightTab === "ai" ? (
            <AiAssistantPanel
              project={project}
              canUndo={undoStack.length > 0}
              onProjectUpdated={(next, summary) => commitProject(next, `AI: ${summary}`)}
              onUndo={handleUndo}
            />
          ) : (
            <CodePreviewPanel
              project={project}
              selectedClassifierId={selectedId}
              language={language}
              onLanguageChange={setLanguage}
            />
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
    </div>
  );
};
