export type Visibility = "public" | "protected" | "private" | "package";

export type ClassifierKind =
  | "class"
  | "interface"
  | "enumeration"
  | "data_type"
  | "primitive_type"
  | "actor"
  | "component"
  | "artifact"
  | "deployment_node"
  | "use_case"
  | "signal";

export type RelationKind =
  | "generalization"
  | "interface_realization"
  | "association"
  | "aggregation"
  | "composition"
  | "dependency"
  | "usage"
  | "include"
  | "extend";

export type TargetLanguage =
  | "rust"
  | "typescript"
  | "cpp"
  | "python"
  | "java"
  | "go"
  | "php"
  | "sql";

export interface Multiplicity {
  lower: number;
  upper?: number | null;
}

export type TypeRef =
  | { kind: "internal"; value: string }
  | { kind: "external"; value: string };

export interface AppliedStereotype {
  name: string;
  profile?: string;
}

export interface Property {
  id: string;
  name: string;
  comment?: string;
  visibility: Visibility;
  type_ref: TypeRef;
  multiplicity: Multiplicity;
  is_static?: boolean;
  is_readonly?: boolean;
  default_value?: string;
}

export interface Parameter {
  name: string;
  direction?: "in" | "out" | "in_out" | "return";
  type_ref: TypeRef;
  multiplicity?: Multiplicity;
}

export interface Operation {
  id: string;
  name: string;
  comment?: string;
  visibility: Visibility;
  params: Parameter[];
  return_type?: TypeRef | null;
  is_static?: boolean;
  is_abstract?: boolean;
  is_const?: boolean;
  is_async?: boolean;
  bodies?: Record<string, string>;
}

export interface EnumLiteral {
  name: string;
  value?: string;
}

export interface Classifier {
  id: string;
  name: string;
  comment?: string;
  stereotypes?: AppliedStereotype[];
  package_id: string;
  kind: ClassifierKind;
  visibility: Visibility;
  is_abstract?: boolean;
  is_final?: boolean;
  properties: Property[];
  operations: Operation[];
  literals: EnumLiteral[];
}

export interface Package {
  id: string;
  name: string;
  comment?: string;
  parent_id?: string | null;
  subpackages: string[];
  classifiers: string[];
}

export interface RelationEnd {
  classifier_id: string;
  role_name?: string;
  visibility: Visibility;
  multiplicity: Multiplicity;
  is_navigable: boolean;
}

export interface Relation {
  id: string;
  name?: string;
  kind: RelationKind;
  source: RelationEnd;
  target: RelationEnd;
}

export interface Diagram {
  id: string;
  name: string;
  kind: string;
  package_id: string;
  layout_mode: "auto_elk" | "manual" | "hybrid";
  element_ids: string[];
}

export interface Project {
  schema_version: number;
  name: string;
  root_package_id: string;
  enabled_languages: string[];
  packages: Record<string, Package>;
  classifiers: Record<string, Classifier>;
  relations: Record<string, Relation>;
  diagrams: Record<string, Diagram>;
}

export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  element_id?: string;
}

export interface GeneratedFile {
  relative_path: string;
  content: string;
  classifier_id?: string;
}

export function visibilitySymbol(v: Visibility): string {
  switch (v) {
    case "public":
      return "+";
    case "protected":
      return "#";
    case "private":
      return "-";
    case "package":
      return "~";
  }
}

export function formatTypeRef(tr: TypeRef, project: Project): string {
  if (tr.kind === "internal") {
    return project.classifiers[tr.value]?.name ?? tr.value;
  }
  return tr.value;
}

export function formatMultiplicity(m?: Multiplicity): string {
  if (!m) return "1";
  if (m.upper === undefined || m.upper === null) {
    return m.lower === 0 ? "0..*" : `${m.lower}..*`;
  }
  if (m.lower === m.upper) return `${m.lower}`;
  return `${m.lower}..${m.upper}`;
}

/**
 * Parses an inline UML member string typed by the user directly on a diagram box:
 * - `-currency: string` -> Property (private, currency, string)
 * - `+charge(amount: f64): bool` -> Operation (public, charge, [amount: f64], return bool)
 */
export function parseInlineMember(
  input: string
): { kind: "property"; property: Property } | { kind: "operation"; operation: Operation } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let visibility: Visibility = "public";
  let rest = trimmed;
  const first = trimmed[0];
  if (first === "+") {
    visibility = "public";
    rest = trimmed.slice(1).trim();
  } else if (first === "-") {
    visibility = "private";
    rest = trimmed.slice(1).trim();
  } else if (first === "#") {
    visibility = "protected";
    rest = trimmed.slice(1).trim();
  } else if (first === "~") {
    visibility = "package";
    rest = trimmed.slice(1).trim();
  }

  const id = `el_${Math.random().toString(36).slice(2, 10)}`;
  const openParen = rest.indexOf("(");
  if (openParen !== -1) {
    const name = rest.slice(0, openParen).trim();
    if (!name) return null;
    const closeParen = rest.indexOf(")", openParen);
    const paramsRaw =
      closeParen !== -1 ? rest.slice(openParen + 1, closeParen) : rest.slice(openParen + 1);
    const retRaw =
      closeParen !== -1 ? rest.slice(closeParen + 1).replace(/^:/, "").trim() : "";

    const params: Parameter[] = paramsRaw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [pn, pt] = p.split(":").map((s) => s.trim());
        return {
          name: pn || "arg",
          type_ref: { kind: "external", value: pt || "any" },
        };
      });

    return {
      kind: "operation",
      operation: {
        id,
        name,
        visibility,
        params,
        return_type: retRaw ? { kind: "external", value: retRaw } : null,
      },
    };
  }

  const [namePart, typePart] = rest.split(":").map((s) => s.trim());
  if (!namePart) return null;
  return {
    kind: "property",
    property: {
      id,
      name: namePart,
      visibility,
      type_ref: { kind: "external", value: typePart || "string" },
      multiplicity: { lower: 1, upper: 1 },
    },
  };
}
