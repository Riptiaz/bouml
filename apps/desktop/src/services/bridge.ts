import type {
  Classifier,
  Diagnostic,
  GeneratedFile,
  Project,
  TargetLanguage,
} from "../types/uml";
import { formatTypeRef } from "../types/uml";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Starter UML 2.5 project shown immediately on launch (PaymentProcessor + Strategy pattern).
 */
export function createStarterProject(): Project {
  const rootId = "pkg_root";
  const billingId = "pkg_billing";
  const ifaceId = "clf_payment_strategy";
  const stripeId = "clf_stripe_strategy";
  const paypalId = "clf_paypal_strategy";
  const processorId = "clf_payment_processor";
  const currencyEnumId = "clf_currency";

  return {
    schema_version: 1,
    name: "BillingPlatform",
    root_package_id: rootId,
    enabled_languages: ["rust", "typescript", "cpp", "python", "java", "go", "php", "sql"],
    packages: {
      [rootId]: {
        id: rootId,
        name: "BillingPlatform",
        parent_id: null,
        subpackages: [billingId],
        classifiers: [],
      },
      [billingId]: {
        id: billingId,
        name: "billing",
        parent_id: rootId,
        subpackages: [],
        classifiers: [processorId, ifaceId, stripeId, paypalId, currencyEnumId],
      },
    },
    classifiers: {
      [ifaceId]: {
        id: ifaceId,
        name: "PaymentStrategy",
        package_id: billingId,
        kind: "interface",
        visibility: "public",
        is_abstract: true,
        properties: [],
        operations: [
          {
            id: "op_strategy_pay",
            name: "pay",
            visibility: "public",
            is_abstract: true,
            params: [
              { name: "amount", type_ref: { kind: "external", value: "f64" } },
              { name: "currency", type_ref: { kind: "internal", value: currencyEnumId } },
            ],
            return_type: { kind: "external", value: "bool" },
          },
        ],
        literals: [],
      },
      [stripeId]: {
        id: stripeId,
        name: "StripeStrategy",
        package_id: billingId,
        kind: "class",
        visibility: "public",
        properties: [
          {
            id: "prop_stripe_key",
            name: "apiKey",
            visibility: "private",
            type_ref: { kind: "external", value: "string" },
            multiplicity: { lower: 1, upper: 1 },
          },
        ],
        operations: [
          {
            id: "op_stripe_pay",
            name: "pay",
            visibility: "public",
            params: [
              { name: "amount", type_ref: { kind: "external", value: "f64" } },
              { name: "currency", type_ref: { kind: "internal", value: currencyEnumId } },
            ],
            return_type: { kind: "external", value: "bool" },
            bodies: {
              rust: "amount > 0.0 && !self.api_key.is_empty()",
              typescript: "return amount > 0 && this.apiKey.length > 0;",
              python: "return amount > 0 and bool(self.apiKey)",
            },
          },
        ],
        literals: [],
      },
      [paypalId]: {
        id: paypalId,
        name: "PayPalStrategy",
        package_id: billingId,
        kind: "class",
        visibility: "public",
        properties: [
          {
            id: "prop_paypal_client",
            name: "clientId",
            visibility: "private",
            type_ref: { kind: "external", value: "string" },
            multiplicity: { lower: 1, upper: 1 },
          },
        ],
        operations: [
          {
            id: "op_paypal_pay",
            name: "pay",
            visibility: "public",
            params: [
              { name: "amount", type_ref: { kind: "external", value: "f64" } },
              { name: "currency", type_ref: { kind: "internal", value: currencyEnumId } },
            ],
            return_type: { kind: "external", value: "bool" },
          },
        ],
        literals: [],
      },
      [processorId]: {
        id: processorId,
        name: "PaymentProcessor",
        comment: "Orchestrates checkout payments using an interchangeable PaymentStrategy.",
        package_id: billingId,
        kind: "class",
        visibility: "public",
        properties: [
          {
            id: "prop_default_curr",
            name: "defaultCurrency",
            visibility: "private",
            type_ref: { kind: "internal", value: currencyEnumId },
            multiplicity: { lower: 1, upper: 1 },
          },
        ],
        operations: [
          {
            id: "op_checkout",
            name: "checkout",
            visibility: "public",
            params: [{ name: "amount", type_ref: { kind: "external", value: "f64" } }],
            return_type: { kind: "external", value: "bool" },
          },
        ],
        literals: [],
      },
      [currencyEnumId]: {
        id: currencyEnumId,
        name: "Currency",
        package_id: billingId,
        kind: "enumeration",
        visibility: "public",
        properties: [],
        operations: [],
        literals: [{ name: "EUR" }, { name: "USD" }, { name: "GBP" }],
      },
    },
    relations: {
      rel_stripe_impl: {
        id: "rel_stripe_impl",
        kind: "interface_realization",
        source: {
          classifier_id: stripeId,
          visibility: "public",
          multiplicity: { lower: 1, upper: 1 },
          is_navigable: true,
        },
        target: {
          classifier_id: ifaceId,
          visibility: "public",
          multiplicity: { lower: 1, upper: 1 },
          is_navigable: true,
        },
      },
      rel_paypal_impl: {
        id: "rel_paypal_impl",
        kind: "interface_realization",
        source: {
          classifier_id: paypalId,
          visibility: "public",
          multiplicity: { lower: 1, upper: 1 },
          is_navigable: true,
        },
        target: {
          classifier_id: ifaceId,
          visibility: "public",
          multiplicity: { lower: 1, upper: 1 },
          is_navigable: true,
        },
      },
      rel_proc_strategy: {
        id: "rel_proc_strategy",
        kind: "aggregation",
        source: {
          classifier_id: processorId,
          visibility: "private",
          multiplicity: { lower: 1, upper: 1 },
          is_navigable: true,
        },
        target: {
          classifier_id: ifaceId,
          role_name: "strategy",
          visibility: "private",
          multiplicity: { lower: 1, upper: 1 },
          is_navigable: true,
        },
      },
      rel_proc_currency: {
        id: "rel_proc_currency",
        kind: "dependency",
        source: {
          classifier_id: processorId,
          visibility: "public",
          multiplicity: { lower: 1, upper: 1 },
          is_navigable: true,
        },
        target: {
          classifier_id: currencyEnumId,
          visibility: "public",
          multiplicity: { lower: 1, upper: 1 },
          is_navigable: true,
        },
      },
    },
    diagrams: {
      diag_billing: {
        id: "diag_billing",
        name: "Billing Strategy Class Diagram",
        kind: "class",
        package_id: billingId,
        layout_mode: "auto_elk",
        element_ids: [processorId, ifaceId, stripeId, paypalId, currencyEnumId],
      },
    },
  };
}

/**
 * Generates instant live code preview: delegates to Tauri Rust `bouml-codegen` when running
 * in desktop mode, or uses a fast local preview generator in browser dev mode.
 */
export async function fetchCodePreview(
  project: Project,
  classifierId: string,
  language: TargetLanguage,
  preserveBodies: boolean
): Promise<GeneratedFile[]> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GeneratedFile[]>("preview_code", {
      classifierId,
      language,
      preserveBodies,
    });
  }

  const clf = project.classifiers[classifierId];
  if (!clf) return [];
  return [renderBrowserPreview(project, clf, language, preserveBodies)];
}

/**
 * Validates the active UML 2.5 project (via Tauri Rust validator or browser mirror).
 */
export async function validateProjectModel(project: Project): Promise<Diagnostic[]> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Diagnostic[]>("validate_current_project");
  }

  const diags: Diagnostic[] = [];
  for (const clf of Object.values(project.classifiers)) {
    if (clf.kind === "class" && (clf.properties.length > 20 || clf.operations.length > 25)) {
      diags.push({
        code: "SOLID001",
        severity: "warning",
        message: `Class '${clf.name}' has ${clf.properties.length} properties and ${clf.operations.length} operations`,
        element_id: clf.id,
      });
    }
  }
  for (const rel of Object.values(project.relations)) {
    if (
      (rel.kind === "generalization" || rel.kind === "interface_realization") &&
      rel.source.classifier_id === rel.target.classifier_id
    ) {
      diags.push({
        code: "UML009",
        severity: "error",
        message: `Classifier '${rel.source.classifier_id}' cannot inherit from itself`,
        element_id: rel.id,
      });
    }
  }
  return diags;
}

function renderBrowserPreview(
  project: Project,
  clf: Classifier,
  lang: TargetLanguage,
  preserveBodies: boolean
): GeneratedFile {
  const commentPrefix = lang === "python" ? "##" : lang === "sql" ? "--" : "//";
  const bodyBlock = (opId: string, body: string, indent: string) =>
    preserveBodies
      ? `${indent}${commentPrefix} Bouml preserved body begin ${opId}\n${indent}${body}\n${indent}${commentPrefix} Bouml preserved body end ${opId}`
      : `${indent}${body}`;

  if (lang === "rust") {
    if (clf.kind === "enumeration") {
      const lits = clf.literals.map((l) => `    ${l.name},`).join("\n");
      return {
        relative_path: `${clf.name.toLowerCase()}.rs`,
        content: `#[derive(Debug, Clone, PartialEq, Eq)]\npub enum ${clf.name} {\n${lits}\n}\n`,
        classifier_id: clf.id,
      };
    }
    if (clf.kind === "interface") {
      const ops = clf.operations
        .map((o) => {
          const ps = o.params
            .map((p) => `${p.name}: ${formatTypeRef(p.type_ref, project)}`)
            .join(", ");
          const rt = o.return_type ? ` -> ${formatTypeRef(o.return_type, project)}` : "";
          return `    fn ${o.name}(&self${ps ? ", " + ps : ""})${rt};`;
        })
        .join("\n");
      return {
        relative_path: `${clf.name.toLowerCase()}.rs`,
        content: `pub trait ${clf.name} {\n${ops}\n}\n`,
        classifier_id: clf.id,
      };
    }
    const fields = clf.properties
      .map(
        (p) =>
          `    ${p.visibility === "public" ? "pub " : ""}${p.name}: ${formatTypeRef(p.type_ref, project)},`
      )
      .join("\n");
    const ops = clf.operations
      .map((o) => {
        const ps = o.params
          .map((p) => `${p.name}: ${formatTypeRef(p.type_ref, project)}`)
          .join(", ");
        const rt = o.return_type ? ` -> ${formatTypeRef(o.return_type, project)}` : "";
        const b = o.bodies?.rust ?? "todo!()";
        return `    pub fn ${o.name}(&mut self${ps ? ", " + ps : ""})${rt} {\n${bodyBlock(o.id, b, "        ")}\n    }`;
      })
      .join("\n\n");
    return {
      relative_path: `${clf.name.toLowerCase()}.rs`,
      content: `#[derive(Debug, Clone)]\npub struct ${clf.name} {\n${fields}\n}\n\nimpl ${clf.name} {\n${ops}\n}\n`,
      classifier_id: clf.id,
    };
  }

  if (lang === "python") {
    const base = clf.kind === "enumeration" ? "(Enum)" : clf.kind === "interface" ? "(ABC)" : "";
    const props = clf.properties
      .map((p) => `    ${p.name}: ${formatTypeRef(p.type_ref, project)}`)
      .join("\n");
    const ops = clf.operations
      .map((o) => {
        const ps = ["self", ...o.params.map((p) => `${p.name}: ${formatTypeRef(p.type_ref, project)}`)].join(", ");
        const rt = o.return_type ? formatTypeRef(o.return_type, project) : "None";
        const b = o.bodies?.python ?? "pass";
        return `    def ${o.name}(${ps}) -> ${rt}:\n${bodyBlock(o.id, b, "        ")}`;
      })
      .join("\n\n");
    return {
      relative_path: `${clf.name.toLowerCase()}.py`,
      content: `from __future__ import annotations\n\nclass ${clf.name}${base}:\n${props || ""}\n\n${ops || "    pass"}\n`,
      classifier_id: clf.id,
    };
  }

  if (lang === "sql") {
    const cols = [
      "    id BIGINT PRIMARY KEY",
      ...clf.properties.map(
        (p) => `    ${p.name.toLowerCase()} VARCHAR(255) NOT NULL`
      ),
    ].join(",\n");
    return {
      relative_path: `${clf.name.toLowerCase()}.sql`,
      content: `CREATE TABLE ${clf.name.toLowerCase()} (\n${cols}\n);\n`,
      classifier_id: clf.id,
    };
  }

  // Default TypeScript / C++ / Java / Go / PHP clean preview
  const kw = clf.kind === "interface" ? "interface" : clf.kind === "enumeration" ? "enum" : "class";
  const props = clf.properties
    .map((p) => `  ${p.visibility} ${p.name}: ${formatTypeRef(p.type_ref, project)};`)
    .join("\n");
  const ops = clf.operations
    .map((o) => {
      const ps = o.params
        .map((p) => `${p.name}: ${formatTypeRef(p.type_ref, project)}`)
        .join(", ");
      const rt = o.return_type ? formatTypeRef(o.return_type, project) : "void";
      if (clf.kind === "interface") return `  ${o.name}(${ps}): ${rt};`;
      const b = o.bodies?.typescript ?? "throw new Error('Not implemented');";
      return `  ${o.visibility} ${o.name}(${ps}): ${rt} {\n${bodyBlock(o.id, b, "    ")}\n  }`;
    })
    .join("\n\n");
  const lits = clf.literals.map((l) => `  ${l.name} = '${l.name}',`).join("\n");

  return {
    relative_path: `${clf.name}.${lang === "cpp" ? "hpp" : lang === "java" ? "java" : lang === "go" ? "go" : lang === "php" ? "php" : "ts"}`,
    content: `export ${kw} ${clf.name} {\n${clf.kind === "enumeration" ? lits : [props, ops].filter(Boolean).join("\n\n")}\n}\n`,
    classifier_id: clf.id,
  };
}
