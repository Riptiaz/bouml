use crate::macros::{format_doc_comment, CommentStyle, TemplateContext};
use crate::preserved_bodies::render_operation_body;
use crate::type_mapper::map_type;
use bouml_core::{
    Classifier, ClassifierKind, ElementId, Multiplicity, Operation, Project, RelationKind,
    TypeRef, Visibility,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

/// Supported target code generation languages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetLanguage {
    Cpp,
    Java,
    Python,
    TypeScript,
    Php,
    Rust,
    Go,
    Sql,
}

impl TargetLanguage {
    pub fn key(&self) -> &'static str {
        match self {
            TargetLanguage::Cpp => "cpp",
            TargetLanguage::Java => "java",
            TargetLanguage::Python => "python",
            TargetLanguage::TypeScript => "typescript",
            TargetLanguage::Php => "php",
            TargetLanguage::Rust => "rust",
            TargetLanguage::Go => "go",
            TargetLanguage::Sql => "sql",
        }
    }

    pub fn comment_prefix(&self) -> &'static str {
        match self {
            TargetLanguage::Python => "##",
            TargetLanguage::Sql => "--",
            _ => "//",
        }
    }

    pub fn extensions(&self) -> &'static [&'static str] {
        match self {
            TargetLanguage::Cpp => &["hpp", "cpp", "h"],
            TargetLanguage::Java => &["java"],
            TargetLanguage::Python => &["py"],
            TargetLanguage::TypeScript => &["ts"],
            TargetLanguage::Php => &["php"],
            TargetLanguage::Rust => &["rs"],
            TargetLanguage::Go => &["go"],
            TargetLanguage::Sql => &["sql"],
        }
    }
}

impl fmt::Display for TargetLanguage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.key())
    }
}

impl FromStr for TargetLanguage {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "cpp" | "c++" => Ok(TargetLanguage::Cpp),
            "java" => Ok(TargetLanguage::Java),
            "python" | "py" => Ok(TargetLanguage::Python),
            "typescript" | "ts" => Ok(TargetLanguage::TypeScript),
            "php" => Ok(TargetLanguage::Php),
            "rust" | "rs" => Ok(TargetLanguage::Rust),
            "go" | "golang" => Ok(TargetLanguage::Go),
            "sql" | "ddl" => Ok(TargetLanguage::Sql),
            other => Err(format!("unsupported target language '{other}'")),
        }
    }
}

/// A single generated source file (in-memory representation, also used for live UI code preview).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratedFile {
    pub relative_path: PathBuf,
    pub content: String,
    pub classifier_id: Option<ElementId>,
}

/// Resolved outgoing relationships for a classifier.
pub struct ClassifierRelations<'a> {
    pub parents: Vec<&'a Classifier>,
    pub interfaces: Vec<&'a Classifier>,
    pub associations: Vec<(&'a Classifier, String, Multiplicity, Visibility)>,
    pub dependencies: Vec<&'a Classifier>,
}

pub fn resolve_relations<'a>(
    project: &'a Project,
    clf: &Classifier,
) -> ClassifierRelations<'a> {
    let mut parents = Vec::new();
    let mut interfaces = Vec::new();
    let mut associations = Vec::new();
    let mut dependencies = Vec::new();

    for rel in project.relations.values() {
        if rel.source.classifier_id != clf.meta.id {
            continue;
        }
        let Some(target) = project.classifiers.get(&rel.target.classifier_id) else {
            continue;
        };
        match rel.kind {
            RelationKind::Generalization => parents.push(target),
            RelationKind::InterfaceRealization => interfaces.push(target),
            RelationKind::Association
            | RelationKind::Aggregation
            | RelationKind::Composition => {
                if rel.target.is_navigable {
                    let role = rel
                        .target
                        .role_name
                        .clone()
                        .or_else(|| rel.source.role_name.clone())
                        .unwrap_or_else(|| to_snake_case(&target.meta.name));
                    associations.push((
                        target,
                        role,
                        rel.target.multiplicity.clone(),
                        rel.source.visibility,
                    ));
                }
            }
            RelationKind::Dependency | RelationKind::Usage => dependencies.push(target),
            RelationKind::Include | RelationKind::Extend => {}
        }
    }

    ClassifierRelations {
        parents,
        interfaces,
        associations,
        dependencies,
    }
}

/// Computes the package path segments for a classifier (excluding the root package name).
pub fn package_segments(project: &Project, package_id: &ElementId) -> Vec<String> {
    let mut segs = Vec::new();
    let mut current = Some(package_id);
    while let Some(pid) = current {
        let Some(pkg) = project.packages.get(pid) else {
            break;
        };
        if pkg.parent_id.is_some() {
            segs.push(to_snake_case(&pkg.meta.name));
        }
        current = pkg.parent_id.as_ref();
    }
    segs.reverse();
    segs
}

/// Generates source file(s) for a single UML `Classifier` in `lang`.
pub fn generate_classifier_files(
    project: &Project,
    clf: &Classifier,
    lang: TargetLanguage,
    preserve_bodies: bool,
    disk_bodies: &BTreeMap<String, String>,
) -> Vec<GeneratedFile> {
    let segs = package_segments(project, &clf.package_id);
    let mut dir = PathBuf::new();
    for s in &segs {
        dir.push(s);
    }

    match lang {
        TargetLanguage::Cpp => generate_cpp(project, clf, &dir, &segs, preserve_bodies, disk_bodies),
        TargetLanguage::Java => {
            generate_java(project, clf, &dir, &segs, preserve_bodies, disk_bodies)
        }
        TargetLanguage::Python => {
            generate_python(project, clf, &dir, preserve_bodies, disk_bodies)
        }
        TargetLanguage::TypeScript => {
            generate_typescript(project, clf, &dir, preserve_bodies, disk_bodies)
        }
        TargetLanguage::Php => generate_php(project, clf, &dir, &segs, preserve_bodies, disk_bodies),
        TargetLanguage::Rust => generate_rust(project, clf, &dir, preserve_bodies, disk_bodies),
        TargetLanguage::Go => generate_go(project, clf, &dir, &segs, preserve_bodies, disk_bodies),
        TargetLanguage::Sql => generate_sql(project, clf),
    }
}

fn effective_body(
    op: &Operation,
    lang: TargetLanguage,
    disk_bodies: &BTreeMap<String, String>,
    fallback: &str,
) -> String {
    if let Some(existing) = disk_bodies.get(op.meta.id.as_str()) {
        return existing.clone();
    }
    if let Some(model_body) = op.bodies.get(lang.key()) {
        if !model_body.is_empty() {
            return model_body.clone();
        }
    }
    fallback.to_string()
}

fn collect_referenced_classifiers<'a>(
    project: &'a Project,
    clf: &Classifier,
    rels: &ClassifierRelations<'a>,
) -> BTreeSet<&'a str> {
    let mut refs = BTreeSet::new();
    for c in rels
        .parents
        .iter()
        .chain(rels.interfaces.iter())
        .chain(rels.dependencies.iter())
    {
        refs.insert(c.meta.name.as_str());
    }
    for (c, _, _, _) in &rels.associations {
        refs.insert(c.meta.name.as_str());
    }
    for p in &clf.properties {
        if let TypeRef::Internal(id) = &p.type_ref {
            if let Some(c) = project.classifiers.get(id) {
                refs.insert(c.meta.name.as_str());
            }
        }
    }
    for op in &clf.operations {
        if let Some(TypeRef::Internal(id)) = &op.return_type {
            if let Some(c) = project.classifiers.get(id) {
                refs.insert(c.meta.name.as_str());
            }
        }
        for param in &op.params {
            if let TypeRef::Internal(id) = &param.type_ref {
                if let Some(c) = project.classifiers.get(id) {
                    refs.insert(c.meta.name.as_str());
                }
            }
        }
    }
    refs.remove(clf.meta.name.as_str());
    refs
}

// ============================================================================
// C++20 Generator (.hpp + .cpp)
// ============================================================================

fn generate_cpp(
    project: &Project,
    clf: &Classifier,
    dir: &PathBuf,
    segs: &[String],
    preserve_bodies: bool,
    disk_bodies: &BTreeMap<String, String>,
) -> Vec<GeneratedFile> {
    let rels = resolve_relations(project, clf);
    let refs = collect_referenced_classifiers(project, clf, &rels);
    let mut ctx = TemplateContext::new();
    ctx.set_name_variants(&clf.meta.name);
    ctx.extend_aliases(&clf.meta.tagged_values);

    let mut includes = String::from("#pragma once\n\n#include <cstdint>\n#include <optional>\n#include <string>\n#include <vector>\n");
    for r in &refs {
        includes.push_str(&format!("#include \"{r}.hpp\"\n"));
    }

    let ns_open = if segs.is_empty() {
        String::new()
    } else {
        format!("\nnamespace {} {{\n", segs.join("::"))
    };
    let ns_close = if segs.is_empty() {
        String::new()
    } else {
        format!("\n}} // namespace {}\n", segs.join("::"))
    };

    let doc = format_doc_comment(&clf.meta.comment, CommentStyle::SlashDoc, "");
    let mut header = format!("{includes}{ns_open}\n{doc}");

    if clf.kind == ClassifierKind::Enumeration {
        header.push_str(&format!("enum class {} {{\n", clf.meta.name));
        for lit in &clf.literals {
            match &lit.value {
                Some(v) => header.push_str(&format!("    {} = {},\n", lit.name, v)),
                None => header.push_str(&format!("    {},\n", lit.name)),
            }
        }
        header.push_str("};\n");
        header.push_str(&ns_close);
        return vec![GeneratedFile {
            relative_path: dir.join(format!("{}.hpp", clf.meta.name)),
            content: ctx.expand(&header),
            classifier_id: Some(clf.meta.id.clone()),
        }];
    }

    let mut bases: Vec<String> = rels
        .parents
        .iter()
        .chain(rels.interfaces.iter())
        .map(|b| format!("public {}", b.meta.name))
        .collect();
    bases.dedup();
    let inherit = if bases.is_empty() {
        String::new()
    } else {
        format!(" : {}", bases.join(", "))
    };

    header.push_str(&format!("class {}{inherit} {{\npublic:\n", clf.meta.name));
    if clf.kind == ClassifierKind::Interface || clf.is_abstract {
        header.push_str(&format!("    virtual ~{}() = default;\n", clf.meta.name));
    }

    // Operations declarations in header
    for op in &clf.operations {
        let op_doc = format_doc_comment(&op.meta.comment, CommentStyle::SlashDoc, "    ");
        let ret = op
            .return_type
            .as_ref()
            .map(|t| map_type(project, t, &Multiplicity::exactly_one(), TargetLanguage::Cpp))
            .unwrap_or_else(|| "void".to_string());
        let params: Vec<String> = op
            .params
            .iter()
            .map(|p| {
                let pt = map_type(project, &p.type_ref, &p.multiplicity, TargetLanguage::Cpp);
                format!("{pt} {}", p.name)
            })
            .collect();
        let vis_label = cpp_visibility(op.visibility);
        let prefix = if op.is_static {
            "static "
        } else if op.is_abstract || clf.kind == ClassifierKind::Interface {
            "virtual "
        } else {
            ""
        };
        let suffix = if op.is_const { " const" } else { "" };
        let pure = if op.is_abstract || clf.kind == ClassifierKind::Interface {
            " = 0"
        } else {
            ""
        };
        header.push_str(&format!(
            "{vis_label}:\n{op_doc}    {prefix}{ret} {}({}){suffix}{pure};\n",
            op.meta.name,
            params.join(", ")
        ));
    }

    // Properties & navigable associations
    for prop in &clf.properties {
        let ptype = map_type(project, &prop.type_ref, &prop.multiplicity, TargetLanguage::Cpp);
        let vis_label = cpp_visibility(prop.visibility);
        let st = if prop.is_static { "static " } else { "" };
        header.push_str(&format!("{vis_label}:\n    {st}{ptype} {};\n", prop.meta.name));
    }
    for (target, role, mult, vis) in &rels.associations {
        let ptype = map_type(
            project,
            &TypeRef::Internal(target.meta.id.clone()),
            mult,
            TargetLanguage::Cpp,
        );
        header.push_str(&format!(
            "{}:\n    {ptype} {role};\n",
            cpp_visibility(*vis)
        ));
    }

    header.push_str("};\n");
    header.push_str(&ns_close);

    let mut files = vec![GeneratedFile {
        relative_path: dir.join(format!("{}.hpp", clf.meta.name)),
        content: ctx.expand(&header),
        classifier_id: Some(clf.meta.id.clone()),
    }];

    // Generate `.cpp` implementation for non-interface classifiers with concrete operations
    let concrete_ops: Vec<&Operation> = clf
        .operations
        .iter()
        .filter(|op| !op.is_abstract && clf.kind != ClassifierKind::Interface)
        .collect();
    if !concrete_ops.is_empty() {
        let mut src = format!("#include \"{}.hpp\"\n{ns_open}\n", clf.meta.name);
        for op in concrete_ops {
            let ret = op
                .return_type
                .as_ref()
                .map(|t| map_type(project, t, &Multiplicity::exactly_one(), TargetLanguage::Cpp))
                .unwrap_or_else(|| "void".to_string());
            let params: Vec<String> = op
                .params
                .iter()
                .map(|p| {
                    let pt = map_type(project, &p.type_ref, &p.multiplicity, TargetLanguage::Cpp);
                    format!("{pt} {}", p.name)
                })
                .collect();
            let suffix = if op.is_const { " const" } else { "" };
            let body = effective_body(op, TargetLanguage::Cpp, disk_bodies, "// TODO: implement");
            let rendered_body = render_operation_body(&op.meta.id, &body, preserve_bodies, "//", "    ");
            src.push_str(&format!(
                "{ret} {}::{}({}){suffix} {{\n{rendered_body}}}\n\n",
                clf.meta.name,
                op.meta.name,
                params.join(", ")
            ));
        }
        src.push_str(&ns_close);
        files.push(GeneratedFile {
            relative_path: dir.join(format!("{}.cpp", clf.meta.name)),
            content: ctx.expand(&src),
            classifier_id: Some(clf.meta.id.clone()),
        });
    }

    files
}

fn cpp_visibility(v: Visibility) -> &'static str {
    match v {
        Visibility::Public | Visibility::Package => "public",
        Visibility::Protected => "protected",
        Visibility::Private => "private",
    }
}

// ============================================================================
// Java Generator
// ============================================================================

fn generate_java(
    project: &Project,
    clf: &Classifier,
    dir: &PathBuf,
    segs: &[String],
    preserve_bodies: bool,
    disk_bodies: &BTreeMap<String, String>,
) -> Vec<GeneratedFile> {
    let rels = resolve_relations(project, clf);
    let mut out = String::new();
    if !segs.is_empty() {
        out.push_str(&format!("package {};\n\n", segs.join(".")));
    }
    out.push_str("import java.util.List;\nimport java.util.Optional;\n\n");
    out.push_str(&format_doc_comment(&clf.meta.comment, CommentStyle::SlashDoc, ""));

    let kw = match clf.kind {
        ClassifierKind::Interface => "interface",
        ClassifierKind::Enumeration => "enum",
        _ => "class",
    };
    let abs = if clf.is_abstract && clf.kind == ClassifierKind::Class {
        "abstract "
    } else {
        ""
    };
    let ext = rels
        .parents
        .first()
        .map(|p| format!(" extends {}", p.meta.name))
        .unwrap_or_default();
    let imp = if rels.interfaces.is_empty() {
        String::new()
    } else {
        let names: Vec<&str> = rels.interfaces.iter().map(|i| i.meta.name.as_str()).collect();
        format!(" implements {}", names.join(", "))
    };

    out.push_str(&format!("public {abs}{kw} {}{ext}{imp} {{\n", clf.meta.name));

    if clf.kind == ClassifierKind::Enumeration {
        let lits: Vec<&str> = clf.literals.iter().map(|l| l.name.as_str()).collect();
        out.push_str(&format!("    {};\n", lits.join(", ")));
    }

    for prop in &clf.properties {
        let vis = java_visibility(prop.visibility);
        let st = if prop.is_static { "static " } else { "" };
        let ro = if prop.is_readonly { "final " } else { "" };
        let ty = map_type(project, &prop.type_ref, &prop.multiplicity, TargetLanguage::Java);
        out.push_str(&format!("    {vis}{st}{ro}{ty} {};\n", prop.meta.name));
    }
    for (target, role, mult, vis) in &rels.associations {
        let ty = map_type(
            project,
            &TypeRef::Internal(target.meta.id.clone()),
            mult,
            TargetLanguage::Java,
        );
        out.push_str(&format!("    {}{ty} {role};\n", java_visibility(*vis)));
    }
    if !clf.properties.is_empty() || !rels.associations.is_empty() {
        out.push('\n');
    }

    for op in &clf.operations {
        let ret = op
            .return_type
            .as_ref()
            .map(|t| map_type(project, t, &Multiplicity::exactly_one(), TargetLanguage::Java))
            .unwrap_or_else(|| "void".to_string());
        let params: Vec<String> = op
            .params
            .iter()
            .map(|p| {
                let pt = map_type(project, &p.type_ref, &p.multiplicity, TargetLanguage::Java);
                format!("{pt} {}", p.name)
            })
            .collect();
        let vis = java_visibility(op.visibility);
        let st = if op.is_static { "static " } else { "" };
        if clf.kind == ClassifierKind::Interface || op.is_abstract {
            let abs_m = if clf.kind == ClassifierKind::Class {
                "abstract "
            } else {
                ""
            };
            out.push_str(&format!(
                "    {vis}{abs_m}{ret} {}({});\n",
                op.meta.name,
                params.join(", ")
            ));
        } else {
            let body = effective_body(
                op,
                TargetLanguage::Java,
                disk_bodies,
                "throw new UnsupportedOperationException(\"TODO\");",
            );
            let rendered = render_operation_body(&op.meta.id, &body, preserve_bodies, "//", "        ");
            out.push_str(&format!(
                "    {vis}{st}{ret} {}({}) {{\n{rendered}    }}\n\n",
                op.meta.name,
                params.join(", ")
            ));
        }
    }

    out.push_str("}\n");
    vec![GeneratedFile {
        relative_path: dir.join(format!("{}.java", clf.meta.name)),
        content: out,
        classifier_id: Some(clf.meta.id.clone()),
    }]
}

fn java_visibility(v: Visibility) -> &'static str {
    match v {
        Visibility::Public => "public ",
        Visibility::Protected => "protected ",
        Visibility::Private => "private ",
        Visibility::Package => "",
    }
}

// ============================================================================
// Python 3 Generator
// ============================================================================

fn generate_python(
    project: &Project,
    clf: &Classifier,
    dir: &PathBuf,
    preserve_bodies: bool,
    disk_bodies: &BTreeMap<String, String>,
) -> Vec<GeneratedFile> {
    let rels = resolve_relations(project, clf);
    let mut out = String::from("from __future__ import annotations\nfrom typing import Optional\n");
    if clf.kind == ClassifierKind::Enumeration {
        out.push_str("from enum import Enum\n");
    } else if clf.kind == ClassifierKind::Interface || clf.is_abstract {
        out.push_str("from abc import ABC, abstractmethod\n");
    }
    out.push('\n');

    let mut bases: Vec<String> = rels
        .parents
        .iter()
        .chain(rels.interfaces.iter())
        .map(|b| b.meta.name.clone())
        .collect();
    if clf.kind == ClassifierKind::Enumeration {
        bases.push("Enum".to_string());
    } else if (clf.kind == ClassifierKind::Interface || clf.is_abstract) && bases.is_empty() {
        bases.push("ABC".to_string());
    }
    let inherit = if bases.is_empty() {
        String::new()
    } else {
        format!("({})", bases.join(", "))
    };

    out.push_str(&format!("class {}{inherit}:\n", clf.meta.name));
    let doc = format_doc_comment(&clf.meta.comment, CommentStyle::PythonDocstring, "    ");
    out.push_str(&doc);

    let mut has_member = !doc.is_empty();
    if clf.kind == ClassifierKind::Enumeration {
        for lit in &clf.literals {
            let val = lit
                .value
                .clone()
                .unwrap_or_else(|| format!("\"{}\"", lit.name));
            out.push_str(&format!("    {} = {val}\n", lit.name));
            has_member = true;
        }
    }
    for prop in &clf.properties {
        let ty = map_type(project, &prop.type_ref, &prop.multiplicity, TargetLanguage::Python);
        out.push_str(&format!("    {}: {ty}\n", prop.meta.name));
        has_member = true;
    }
    for (target, role, mult, _) in &rels.associations {
        let ty = map_type(
            project,
            &TypeRef::Internal(target.meta.id.clone()),
            mult,
            TargetLanguage::Python,
        );
        out.push_str(&format!("    {role}: {ty}\n"));
        has_member = true;
    }

    for op in &clf.operations {
        out.push('\n');
        if op.is_static {
            out.push_str("    @staticmethod\n");
        }
        if op.is_abstract || clf.kind == ClassifierKind::Interface {
            out.push_str("    @abstractmethod\n");
        }
        let mut params = Vec::new();
        if !op.is_static {
            params.push("self".to_string());
        }
        for p in &op.params {
            let pt = map_type(project, &p.type_ref, &p.multiplicity, TargetLanguage::Python);
            params.push(format!("{}: {pt}", p.name));
        }
        let ret = op
            .return_type
            .as_ref()
            .map(|t| map_type(project, t, &Multiplicity::exactly_one(), TargetLanguage::Python))
            .unwrap_or_else(|| "None".to_string());
        let async_kw = if op.is_async { "async " } else { "" };
        let body = effective_body(op, TargetLanguage::Python, disk_bodies, "pass");
        let rendered = render_operation_body(&op.meta.id, &body, preserve_bodies, "##", "        ");
        out.push_str(&format!(
            "    {async_kw}def {}({}) -> {ret}:\n{rendered}",
            op.meta.name,
            params.join(", ")
        ));
        has_member = true;
    }

    if !has_member {
        out.push_str("    pass\n");
    }

    vec![GeneratedFile {
        relative_path: dir.join(format!("{}.py", to_snake_case(&clf.meta.name))),
        content: out,
        classifier_id: Some(clf.meta.id.clone()),
    }]
}

// ============================================================================
// TypeScript Generator
// ============================================================================

fn generate_typescript(
    project: &Project,
    clf: &Classifier,
    dir: &PathBuf,
    preserve_bodies: bool,
    disk_bodies: &BTreeMap<String, String>,
) -> Vec<GeneratedFile> {
    let rels = resolve_relations(project, clf);
    let refs = collect_referenced_classifiers(project, clf, &rels);
    let mut out = String::new();
    for r in &refs {
        out.push_str(&format!("import type {{ {r} }} from './{r}';\n"));
    }
    if !refs.is_empty() {
        out.push('\n');
    }
    out.push_str(&format_doc_comment(&clf.meta.comment, CommentStyle::SlashDoc, ""));

    if clf.kind == ClassifierKind::Enumeration {
        out.push_str(&format!("export enum {} {{\n", clf.meta.name));
        for lit in &clf.literals {
            match &lit.value {
                Some(v) => out.push_str(&format!("  {} = {v},\n", lit.name)),
                None => out.push_str(&format!("  {} = '{}',\n", lit.name, lit.name)),
            }
        }
        out.push_str("}\n");
        return vec![GeneratedFile {
            relative_path: dir.join(format!("{}.ts", clf.meta.name)),
            content: out,
            classifier_id: Some(clf.meta.id.clone()),
        }];
    }

    let kw = if clf.kind == ClassifierKind::Interface {
        "interface"
    } else if clf.is_abstract {
        "abstract class"
    } else {
        "class"
    };
    let ext = rels
        .parents
        .first()
        .map(|p| format!(" extends {}", p.meta.name))
        .unwrap_or_default();
    let imp = if rels.interfaces.is_empty() || clf.kind == ClassifierKind::Interface {
        String::new()
    } else {
        let names: Vec<&str> = rels.interfaces.iter().map(|i| i.meta.name.as_str()).collect();
        format!(" implements {}", names.join(", "))
    };

    out.push_str(&format!("export {kw} {}{ext}{imp} {{\n", clf.meta.name));

    for prop in &clf.properties {
        let vis = if clf.kind == ClassifierKind::Interface {
            ""
        } else {
            ts_visibility(prop.visibility)
        };
        let ro = if prop.is_readonly { "readonly " } else { "" };
        let ty = map_type(
            project,
            &prop.type_ref,
            &prop.multiplicity,
            TargetLanguage::TypeScript,
        );
        out.push_str(&format!("  {vis}{ro}{}: {ty};\n", prop.meta.name));
    }
    for (target, role, mult, vis) in &rels.associations {
        let vis_str = if clf.kind == ClassifierKind::Interface {
            ""
        } else {
            ts_visibility(*vis)
        };
        let ty = map_type(
            project,
            &TypeRef::Internal(target.meta.id.clone()),
            mult,
            TargetLanguage::TypeScript,
        );
        out.push_str(&format!("  {vis_str}{role}: {ty};\n"));
    }

    for op in &clf.operations {
        let params: Vec<String> = op
            .params
            .iter()
            .map(|p| {
                let pt = map_type(
                    project,
                    &p.type_ref,
                    &p.multiplicity,
                    TargetLanguage::TypeScript,
                );
                format!("{}: {pt}", p.name)
            })
            .collect();
        let ret = op
            .return_type
            .as_ref()
            .map(|t| {
                map_type(
                    project,
                    t,
                    &Multiplicity::exactly_one(),
                    TargetLanguage::TypeScript,
                )
            })
            .unwrap_or_else(|| "void".to_string());
        if clf.kind == ClassifierKind::Interface || op.is_abstract {
            let abs = if clf.kind == ClassifierKind::Class {
                "abstract "
            } else {
                ""
            };
            out.push_str(&format!(
                "  {abs}{}({}): {ret};\n",
                op.meta.name,
                params.join(", ")
            ));
        } else {
            let vis = ts_visibility(op.visibility);
            let async_kw = if op.is_async { "async " } else { "" };
            let body = effective_body(
                op,
                TargetLanguage::TypeScript,
                disk_bodies,
                "throw new Error('Not implemented');",
            );
            let rendered = render_operation_body(&op.meta.id, &body, preserve_bodies, "//", "    ");
            out.push_str(&format!(
                "\n  {vis}{async_kw}{}({}): {ret} {{\n{rendered}  }}\n",
                op.meta.name,
                params.join(", ")
            ));
        }
    }

    out.push_str("}\n");
    vec![GeneratedFile {
        relative_path: dir.join(format!("{}.ts", clf.meta.name)),
        content: out,
        classifier_id: Some(clf.meta.id.clone()),
    }]
}

fn ts_visibility(v: Visibility) -> &'static str {
    match v {
        Visibility::Public | Visibility::Package => "public ",
        Visibility::Protected => "protected ",
        Visibility::Private => "private ",
    }
}

// ============================================================================
// PHP 8 Generator
// ============================================================================

fn generate_php(
    project: &Project,
    clf: &Classifier,
    dir: &PathBuf,
    segs: &[String],
    preserve_bodies: bool,
    disk_bodies: &BTreeMap<String, String>,
) -> Vec<GeneratedFile> {
    let rels = resolve_relations(project, clf);
    let mut out = String::from("<?php\n\ndeclare(strict_types=1);\n\n");
    if !segs.is_empty() {
        out.push_str(&format!("namespace {};\n\n", segs.join("\\")));
    }
    out.push_str(&format_doc_comment(&clf.meta.comment, CommentStyle::SlashDoc, ""));

    let kw = match clf.kind {
        ClassifierKind::Interface => "interface",
        ClassifierKind::Enumeration => "enum",
        _ => {
            if clf.is_abstract {
                "abstract class"
            } else {
                "class"
            }
        }
    };
    let ext = rels
        .parents
        .first()
        .map(|p| format!(" extends {}", p.meta.name))
        .unwrap_or_default();
    let imp = if rels.interfaces.is_empty() {
        String::new()
    } else {
        let names: Vec<&str> = rels.interfaces.iter().map(|i| i.meta.name.as_str()).collect();
        format!(" implements {}", names.join(", "))
    };
    out.push_str(&format!("{kw} {}{ext}{imp}\n{{\n", clf.meta.name));

    for prop in &clf.properties {
        let ty = map_type(project, &prop.type_ref, &prop.multiplicity, TargetLanguage::Php);
        out.push_str(&format!(
            "    {} {ty} ${};\n",
            php_visibility(prop.visibility),
            prop.meta.name
        ));
    }
    for op in &clf.operations {
        let params: Vec<String> = op
            .params
            .iter()
            .map(|p| {
                let pt = map_type(project, &p.type_ref, &p.multiplicity, TargetLanguage::Php);
                format!("{pt} ${}", p.name)
            })
            .collect();
        let ret = op
            .return_type
            .as_ref()
            .map(|t| map_type(project, t, &Multiplicity::exactly_one(), TargetLanguage::Php))
            .unwrap_or_else(|| "void".to_string());
        if clf.kind == ClassifierKind::Interface || op.is_abstract {
            out.push_str(&format!(
                "    {} function {}({}): {ret};\n",
                php_visibility(op.visibility),
                op.meta.name,
                params.join(", ")
            ));
        } else {
            let body = effective_body(
                op,
                TargetLanguage::Php,
                disk_bodies,
                "throw new \\RuntimeException('Not implemented');",
            );
            let rendered = render_operation_body(&op.meta.id, &body, preserve_bodies, "//", "        ");
            out.push_str(&format!(
                "\n    {} function {}({}): {ret}\n    {{\n{rendered}    }}\n",
                php_visibility(op.visibility),
                op.meta.name,
                params.join(", ")
            ));
        }
    }
    out.push_str("}\n");

    vec![GeneratedFile {
        relative_path: dir.join(format!("{}.php", clf.meta.name)),
        content: out,
        classifier_id: Some(clf.meta.id.clone()),
    }]
}

fn php_visibility(v: Visibility) -> &'static str {
    match v {
        Visibility::Public | Visibility::Package => "public",
        Visibility::Protected => "protected",
        Visibility::Private => "private",
    }
}

// ============================================================================
// Rust Generator
// ============================================================================

fn generate_rust(
    project: &Project,
    clf: &Classifier,
    dir: &PathBuf,
    preserve_bodies: bool,
    disk_bodies: &BTreeMap<String, String>,
) -> Vec<GeneratedFile> {
    let rels = resolve_relations(project, clf);
    let mut out = format_doc_comment(&clf.meta.comment, CommentStyle::RustDoc, "");

    if clf.kind == ClassifierKind::Enumeration {
        out.push_str("#[derive(Debug, Clone, PartialEq, Eq)]\n");
        out.push_str(&format!("pub enum {} {{\n", clf.meta.name));
        for lit in &clf.literals {
            out.push_str(&format!("    {},\n", lit.name));
        }
        out.push_str("}\n");
        return vec![GeneratedFile {
            relative_path: dir.join(format!("{}.rs", to_snake_case(&clf.meta.name))),
            content: out,
            classifier_id: Some(clf.meta.id.clone()),
        }];
    }

    if clf.kind == ClassifierKind::Interface {
        out.push_str(&format!("pub trait {} {{\n", clf.meta.name));
        for op in &clf.operations {
            let sig = rust_fn_signature(project, op, false);
            out.push_str(&format!("    {sig};\n"));
        }
        out.push_str("}\n");
        return vec![GeneratedFile {
            relative_path: dir.join(format!("{}.rs", to_snake_case(&clf.meta.name))),
            content: out,
            classifier_id: Some(clf.meta.id.clone()),
        }];
    }

    out.push_str("#[derive(Debug, Clone)]\n");
    out.push_str(&format!("pub struct {} {{\n", clf.meta.name));
    for prop in &clf.properties {
        let vis = if prop.visibility == Visibility::Public {
            "pub "
        } else {
            ""
        };
        let ty = map_type(project, &prop.type_ref, &prop.multiplicity, TargetLanguage::Rust);
        out.push_str(&format!("    {vis}{}: {ty},\n", to_snake_case(&prop.meta.name)));
    }
    for (target, role, mult, vis) in &rels.associations {
        let vis_str = if *vis == Visibility::Public { "pub " } else { "" };
        let ty = map_type(
            project,
            &TypeRef::Internal(target.meta.id.clone()),
            mult,
            TargetLanguage::Rust,
        );
        out.push_str(&format!("    {vis_str}{}: {ty},\n", to_snake_case(role)));
    }
    out.push_str("}\n");

    if !clf.operations.is_empty() {
        out.push_str(&format!("\nimpl {} {{\n", clf.meta.name));
        for op in &clf.operations {
            let vis = if op.visibility == Visibility::Public {
                "pub "
            } else {
                ""
            };
            let sig = rust_fn_signature(project, op, true);
            let body = effective_body(op, TargetLanguage::Rust, disk_bodies, "todo!()");
            let rendered = render_operation_body(&op.meta.id, &body, preserve_bodies, "//", "        ");
            out.push_str(&format!("    {vis}{sig} {{\n{rendered}    }}\n\n"));
        }
        out.push_str("}\n");
    }

    vec![GeneratedFile {
        relative_path: dir.join(format!("{}.rs", to_snake_case(&clf.meta.name))),
        content: out,
        classifier_id: Some(clf.meta.id.clone()),
    }]
}

fn rust_fn_signature(project: &Project, op: &Operation, include_self_ref: bool) -> String {
    let mut params = Vec::new();
    if !op.is_static {
        params.push(if op.is_const || !include_self_ref {
            "&self".to_string()
        } else {
            "&mut self".to_string()
        });
    }
    for p in &op.params {
        let pt = map_type(project, &p.type_ref, &p.multiplicity, TargetLanguage::Rust);
        params.push(format!("{}: {pt}", to_snake_case(&p.name)));
    }
    let ret = op
        .return_type
        .as_ref()
        .map(|t| map_type(project, t, &Multiplicity::exactly_one(), TargetLanguage::Rust))
        .filter(|r| r != "()")
        .map(|r| format!(" -> {r}"))
        .unwrap_or_default();
    let async_kw = if op.is_async { "async " } else { "" };
    format!(
        "{async_kw}fn {}({}){ret}",
        to_snake_case(&op.meta.name),
        params.join(", ")
    )
}

// ============================================================================
// Go Generator
// ============================================================================

fn generate_go(
    project: &Project,
    clf: &Classifier,
    dir: &PathBuf,
    segs: &[String],
    preserve_bodies: bool,
    disk_bodies: &BTreeMap<String, String>,
) -> Vec<GeneratedFile> {
    let rels = resolve_relations(project, clf);
    let pkg = segs.last().map(|s| s.as_str()).unwrap_or("model");
    let mut out = format!("package {pkg}\n\n");
    out.push_str(&format_doc_comment(&clf.meta.comment, CommentStyle::LineSlash, ""));

    if clf.kind == ClassifierKind::Interface {
        out.push_str(&format!("type {} interface {{\n", clf.meta.name));
        for op in &clf.operations {
            let (params, ret) = go_params_and_ret(project, op);
            out.push_str(&format!("    {}({params}){ret}\n", go_export_name(&op.meta.name, op.visibility)));
        }
        out.push_str("}\n");
    } else {
        out.push_str(&format!("type {} struct {{\n", clf.meta.name));
        for prop in &clf.properties {
            let ty = map_type(project, &prop.type_ref, &prop.multiplicity, TargetLanguage::Go);
            out.push_str(&format!(
                "    {} {ty}\n",
                go_export_name(&prop.meta.name, prop.visibility)
            ));
        }
        for (target, role, mult, vis) in &rels.associations {
            let ty = map_type(
                project,
                &TypeRef::Internal(target.meta.id.clone()),
                mult,
                TargetLanguage::Go,
            );
            out.push_str(&format!("    {} {ty}\n", go_export_name(role, *vis)));
        }
        out.push_str("}\n");

        let recv = clf
            .meta
            .name
            .chars()
            .next()
            .unwrap_or('x')
            .to_ascii_lowercase();
        for op in &clf.operations {
            let (params, ret) = go_params_and_ret(project, op);
            let body = effective_body(op, TargetLanguage::Go, disk_bodies, "panic(\"TODO\")");
            let rendered = render_operation_body(&op.meta.id, &body, preserve_bodies, "//", "    ");
            out.push_str(&format!(
                "\nfunc ({recv} *{}) {}({params}){ret} {{\n{rendered}}}\n",
                clf.meta.name,
                go_export_name(&op.meta.name, op.visibility)
            ));
        }
    }

    vec![GeneratedFile {
        relative_path: dir.join(format!("{}.go", to_snake_case(&clf.meta.name))),
        content: out,
        classifier_id: Some(clf.meta.id.clone()),
    }]
}

fn go_params_and_ret(project: &Project, op: &Operation) -> (String, String) {
    let params: Vec<String> = op
        .params
        .iter()
        .map(|p| {
            let pt = map_type(project, &p.type_ref, &p.multiplicity, TargetLanguage::Go);
            format!("{} {pt}", p.name)
        })
        .collect();
    let ret = op
        .return_type
        .as_ref()
        .map(|t| map_type(project, t, &Multiplicity::exactly_one(), TargetLanguage::Go))
        .filter(|r| !r.is_empty())
        .map(|r| format!(" {r}"))
        .unwrap_or_default();
    (params.join(", "), ret)
}

fn go_export_name(name: &str, vis: Visibility) -> String {
    let mut chars = name.chars();
    match (chars.next(), vis) {
        (Some(c), Visibility::Public) => c.to_uppercase().collect::<String>() + chars.as_str(),
        (Some(c), _) => c.to_lowercase().collect::<String>() + chars.as_str(),
        (None, _) => String::new(),
    }
}

// ============================================================================
// SQL (DDL) Generator
// ============================================================================

fn generate_sql(project: &Project, clf: &Classifier) -> Vec<GeneratedFile> {
    if !matches!(clf.kind, ClassifierKind::Class | ClassifierKind::DataType) {
        return Vec::new();
    }
    let rels = resolve_relations(project, clf);
    let table = to_snake_case(&clf.meta.name);
    let mut out = format_doc_comment(&clf.meta.comment, CommentStyle::SqlDash, "");
    out.push_str(&format!("CREATE TABLE {table} (\n"));

    let mut cols: Vec<String> = Vec::new();
    let has_id = clf.properties.iter().any(|p| p.meta.name.eq_ignore_ascii_case("id"));
    if !has_id {
        cols.push("    id BIGINT PRIMARY KEY".to_string());
    }

    for prop in &clf.properties {
        let col_name = to_snake_case(&prop.meta.name);
        let col_type = map_type(project, &prop.type_ref, &prop.multiplicity, TargetLanguage::Sql);
        let not_null = if prop.multiplicity.lower >= 1 {
            " NOT NULL"
        } else {
            ""
        };
        let pk = if prop.meta.name.eq_ignore_ascii_case("id") {
            " PRIMARY KEY"
        } else {
            ""
        };
        cols.push(format!("    {col_name} {col_type}{pk}{not_null}"));
    }

    for (target, role, mult, _) in &rels.associations {
        let is_single = mult.upper == Some(1);
        if is_single {
            let fk_col = format!("{}_id", to_snake_case(role));
            let target_table = to_snake_case(&target.meta.name);
            let not_null = if mult.lower >= 1 { " NOT NULL" } else { "" };
            cols.push(format!(
                "    {fk_col} BIGINT{not_null} REFERENCES {target_table}(id)"
            ));
        }
    }

    out.push_str(&cols.join(",\n"));
    out.push_str("\n);\n");

    vec![GeneratedFile {
        relative_path: PathBuf::from(format!("{table}.sql")),
        content: out,
        classifier_id: Some(clf.meta.id.clone()),
    }]
}

pub fn to_snake_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    let mut prev_lower_or_digit = false;
    let mut prev_underscore = false;

    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if ch.is_ascii_uppercase() && prev_lower_or_digit && !prev_underscore {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
            prev_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
            prev_underscore = false;
        } else if !prev_underscore && !out.is_empty() {
            out.push('_');
            prev_underscore = true;
            prev_lower_or_digit = false;
        }
    }
    out.trim_end_matches('_').to_string()
}
