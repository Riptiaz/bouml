use crate::ir::{ImportBundle, ImportedClassifier, ImportedRelation};
use bouml_core::{
    ClassifierKind, EnumLiteral, Multiplicity, Operation, Parameter, Property, RelationKind,
    TypeRef, Visibility,
};
use std::fs;
use std::path::Path;
use tree_sitter::{Language, Node, Parser};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeLang {
    Rust,
    Python,
    TypeScript,
    Java,
    Cpp,
    Go,
    Php,
}

impl CodeLang {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "rs" => Some(Self::Rust),
            "py" => Some(Self::Python),
            "ts" | "tsx" | "js" | "jsx" => Some(Self::TypeScript),
            "java" => Some(Self::Java),
            "cpp" | "cc" | "cxx" | "hpp" | "hh" | "h" => Some(Self::Cpp),
            "go" => Some(Self::Go),
            "php" => Some(Self::Php),
            _ => None,
        }
    }

    fn ts_language(self) -> Language {
        match self {
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::Python => tree_sitter_python::LANGUAGE.into(),
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Java => tree_sitter_java::LANGUAGE.into(),
            Self::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            Self::Go => tree_sitter_go::LANGUAGE.into(),
            Self::Php => tree_sitter_php::LANGUAGE_PHP.into(),
        }
    }
}

/// Parses a single source file or recursively walks a source directory using Tree-sitter.
pub fn parse_code_path(path: &Path) -> Result<ImportBundle, std::io::Error> {
    let mut bundle = ImportBundle {
        source_label: path.display().to_string(),
        ..Default::default()
    };

    if path.is_file() {
        parse_single_file(path, None, &mut bundle)?;
    } else if path.is_dir() {
        walk_source_dir(path, path, &mut bundle)?;
    }

    Ok(bundle)
}

fn walk_source_dir(
    root: &Path,
    dir: &Path,
    bundle: &mut ImportBundle,
) -> Result<(), std::io::Error> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|e| e.path());

    for entry in entries {
        let p = entry.path();
        if p.is_dir() {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if matches!(
                name,
                ".git" | "target" | "node_modules" | "dist" | "__pycache__" | ".venv" | "vendor"
            ) {
                continue;
            }
            walk_source_dir(root, &p, bundle)?;
        } else if p.is_file() {
            let pkg_name = p
                .parent()
                .and_then(|parent| parent.strip_prefix(root).ok())
                .and_then(|rel| rel.to_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.replace('/', "::"));
            parse_single_file(&p, pkg_name, bundle)?;
        }
    }
    Ok(())
}

fn parse_single_file(
    path: &Path,
    package_name: Option<String>,
    bundle: &mut ImportBundle,
) -> Result<(), std::io::Error> {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return Ok(());
    };
    let Some(lang) = CodeLang::from_extension(ext) else {
        return Ok(());
    };
    let source = fs::read_to_string(path)?;
    parse_code_str(&source, lang, package_name, bundle);
    Ok(())
}

/// Parses an in-memory source code string for `lang` with Tree-sitter.
pub fn parse_code_str(
    source: &str,
    lang: CodeLang,
    package_name: Option<String>,
    bundle: &mut ImportBundle,
) {
    let mut parser = Parser::new();
    if parser.set_language(&lang.ts_language()).is_err() {
        bundle
            .warnings
            .push(format!("Failed to initialize Tree-sitter grammar for {lang:?}"));
        return;
    }
    let Some(tree) = parser.parse(source, None) else {
        return;
    };
    let root = tree.root_node();
    let bytes = source.as_bytes();

    match lang {
        CodeLang::Rust => extract_rust(root, bytes, &package_name, bundle),
        CodeLang::Python => extract_python(root, bytes, &package_name, bundle),
        CodeLang::TypeScript => extract_typescript(root, bytes, &package_name, bundle),
        CodeLang::Java => extract_java(root, bytes, &package_name, bundle),
        CodeLang::Cpp => extract_cpp(root, bytes, &package_name, bundle),
        CodeLang::Go => extract_go(root, bytes, &package_name, bundle),
        CodeLang::Php => extract_php(root, bytes, &package_name, bundle),
    }
}

fn node_text<'a>(node: Node<'a>, src: &'a [u8]) -> &'a str {
    node.utf8_text(src).unwrap_or("").trim()
}

fn child_text_by_field<'a>(node: Node<'a>, field: &str, src: &'a [u8]) -> Option<String> {
    node.child_by_field_name(field)
        .map(|n| node_text(n, src).to_string())
        .filter(|s| !s.is_empty())
}

// ============================================================================
// Rust Extractor
// ============================================================================

fn extract_rust(
    node: Node,
    src: &[u8],
    pkg: &Option<String>,
    bundle: &mut ImportBundle,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "struct_item" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let mut clf = ImportedClassifier::new(name, ClassifierKind::Class);
                    clf.package_name = pkg.clone();
                    if let Some(body) = child.child_by_field_name("body") {
                        let mut bc = body.walk();
                        for field in body.children(&mut bc) {
                            if field.kind() == "field_declaration" {
                                if let Some(fname) = child_text_by_field(field, "name", src) {
                                    let ftype = child_text_by_field(field, "type", src)
                                        .unwrap_or_else(|| "any".to_string());
                                    let mut prop = Property::new(fname, TypeRef::external(ftype));
                                    prop.visibility = if node_text(field, src).starts_with("pub") {
                                        Visibility::Public
                                    } else {
                                        Visibility::Private
                                    };
                                    clf.properties.push(prop);
                                }
                            }
                        }
                    }
                    bundle.classifiers.push(clf);
                }
            }
            "trait_item" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let mut clf = ImportedClassifier::new(name, ClassifierKind::Interface);
                    clf.package_name = pkg.clone();
                    if let Some(body) = child.child_by_field_name("body") {
                        extract_rust_functions(body, src, &mut clf.operations);
                    }
                    bundle.classifiers.push(clf);
                }
            }
            "enum_item" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let mut clf = ImportedClassifier::new(name, ClassifierKind::Enumeration);
                    clf.package_name = pkg.clone();
                    if let Some(body) = child.child_by_field_name("body") {
                        let mut bc = body.walk();
                        for v in body.children(&mut bc) {
                            if v.kind() == "enum_variant" {
                                if let Some(vname) = child_text_by_field(v, "name", src) {
                                    clf.literals.push(EnumLiteral {
                                        name: vname,
                                        value: None,
                                        comment: String::new(),
                                    });
                                }
                            }
                        }
                    }
                    bundle.classifiers.push(clf);
                }
            }
            "impl_item" => {
                let target_type = child_text_by_field(child, "type", src);
                let trait_name = child_text_by_field(child, "trait", src);
                if let (Some(t), Some(tr)) = (&target_type, &trait_name) {
                    let clean_t = t.split('<').next().unwrap_or(t).trim().to_string();
                    let clean_tr = tr.split('<').next().unwrap_or(tr).trim().to_string();
                    bundle.relations.push(ImportedRelation {
                        source_name: clean_t,
                        target_name: clean_tr,
                        kind: RelationKind::InterfaceRealization,
                        role_name: None,
                        target_multiplicity: Multiplicity::exactly_one(),
                        visibility: Visibility::Public,
                    });
                }
                if let (Some(t), Some(body)) = (target_type, child.child_by_field_name("body")) {
                    let clean_t = t.split('<').next().unwrap_or(&t).trim().to_string();
                    let mut ops = Vec::new();
                    extract_rust_functions(body, src, &mut ops);
                    if let Some(existing) = bundle.classifiers.iter_mut().find(|c| c.name == clean_t)
                    {
                        existing.operations.extend(ops);
                    }
                }
            }
            "mod_item" => {
                if let Some(body) = child.child_by_field_name("body") {
                    let mod_name = child_text_by_field(child, "name", src);
                    let sub_pkg = match (pkg, mod_name) {
                        (Some(p), Some(m)) => Some(format!("{p}::{m}")),
                        (None, Some(m)) => Some(m),
                        (p, None) => p.clone(),
                    };
                    extract_rust(body, src, &sub_pkg, bundle);
                }
            }
            _ => {}
        }
    }
}

fn extract_rust_functions(body: Node, src: &[u8], out: &mut Vec<Operation>) {
    let mut bc = body.walk();
    for item in body.children(&mut bc) {
        if item.kind() == "function_item" || item.kind() == "function_signature_item" {
            if let Some(name) = child_text_by_field(item, "name", src) {
                let mut op = Operation::new(name);
                op.visibility = if node_text(item, src).starts_with("pub") {
                    Visibility::Public
                } else {
                    Visibility::Private
                };
                if let Some(rt) = child_text_by_field(item, "return_type", src) {
                    op.return_type = Some(TypeRef::external(rt));
                }
                if let Some(params) = item.child_by_field_name("parameters") {
                    let mut pc = params.walk();
                    for p in params.children(&mut pc) {
                        if p.kind() == "parameter" {
                            let pname = child_text_by_field(p, "pattern", src)
                                .unwrap_or_else(|| "arg".to_string());
                            let ptype = child_text_by_field(p, "type", src)
                                .unwrap_or_else(|| "any".to_string());
                            op.params.push(Parameter::new(pname, TypeRef::external(ptype)));
                        }
                    }
                }
                out.push(op);
            }
        }
    }
}

// ============================================================================
// Python Extractor
// ============================================================================

fn extract_python(
    node: Node,
    src: &[u8],
    pkg: &Option<String>,
    bundle: &mut ImportBundle,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "class_definition" {
            if let Some(name) = child_text_by_field(child, "name", src) {
                let mut clf = ImportedClassifier::new(&name, ClassifierKind::Class);
                clf.package_name = pkg.clone();

                if let Some(supers) = child.child_by_field_name("superclasses") {
                    let mut sc = supers.walk();
                    for s in supers.children(&mut sc) {
                        if s.kind() == "identifier" {
                            let base = node_text(s, src);
                            if base == "Enum" {
                                clf.kind = ClassifierKind::Enumeration;
                            } else if base == "ABC" {
                                clf.is_abstract = true;
                            } else {
                                bundle.relations.push(ImportedRelation {
                                    source_name: name.clone(),
                                    target_name: base.to_string(),
                                    kind: RelationKind::Generalization,
                                    role_name: None,
                                    target_multiplicity: Multiplicity::exactly_one(),
                                    visibility: Visibility::Public,
                                });
                            }
                        }
                    }
                }

                if let Some(body) = child.child_by_field_name("body") {
                    let mut bc = body.walk();
                    for stmt in body.children(&mut bc) {
                        match stmt.kind() {
                            "function_definition" | "decorated_definition" => {
                                let func = if stmt.kind() == "decorated_definition" {
                                    stmt.child_by_field_name("definition")
                                } else {
                                    Some(stmt)
                                };
                                if let Some(f) = func.filter(|n| n.kind() == "function_definition")
                                {
                                    if let Some(fname) = child_text_by_field(f, "name", src) {
                                        let mut op = Operation::new(&fname);
                                        op.visibility = if fname.starts_with("__")
                                            && !fname.ends_with("__")
                                        {
                                            Visibility::Private
                                        } else if fname.starts_with('_') {
                                            Visibility::Protected
                                        } else {
                                            Visibility::Public
                                        };
                                        if let Some(rt) = child_text_by_field(f, "return_type", src)
                                        {
                                            op.return_type = Some(TypeRef::external(rt));
                                        }
                                        clf.operations.push(op);
                                    }
                                }
                            }
                            "expression_statement" => {
                                if let Some(assign) = stmt.child(0).filter(|n| n.kind() == "assignment") {
                                    if let Some(left) = child_text_by_field(assign, "left", src) {
                                        let ty = child_text_by_field(assign, "type", src)
                                            .unwrap_or_else(|| "any".to_string());
                                        clf.properties.push(Property::new(left, TypeRef::external(ty)));
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                bundle.classifiers.push(clf);
            }
        } else {
            extract_python(child, src, pkg, bundle);
        }
    }
}

// ============================================================================
// TypeScript / JavaScript Extractor
// ============================================================================

fn extract_typescript(
    node: Node,
    src: &[u8],
    pkg: &Option<String>,
    bundle: &mut ImportBundle,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "class_declaration" | "abstract_class_declaration" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let mut clf = ImportedClassifier::new(&name, ClassifierKind::Class);
                    clf.package_name = pkg.clone();
                    clf.is_abstract = child.kind() == "abstract_class_declaration";

                    let mut cc = child.walk();
                    for sub in child.children(&mut cc) {
                        if sub.kind() == "class_heritage" {
                            extract_ts_heritage(sub, src, &name, bundle);
                        } else if sub.kind() == "class_body" {
                            extract_ts_members(sub, src, &mut clf);
                        }
                    }
                    bundle.classifiers.push(clf);
                }
            }
            "interface_declaration" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let mut clf = ImportedClassifier::new(&name, ClassifierKind::Interface);
                    clf.package_name = pkg.clone();
                    if let Some(body) = child.child_by_field_name("body") {
                        extract_ts_members(body, src, &mut clf);
                    }
                    bundle.classifiers.push(clf);
                }
            }
            "enum_declaration" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let mut clf = ImportedClassifier::new(name, ClassifierKind::Enumeration);
                    clf.package_name = pkg.clone();
                    bundle.classifiers.push(clf);
                }
            }
            "export_statement" => {
                extract_typescript(child, src, pkg, bundle);
            }
            _ => {}
        }
    }
}

fn extract_ts_heritage(
    heritage: Node,
    src: &[u8],
    class_name: &str,
    bundle: &mut ImportBundle,
) {
    let mut hc = heritage.walk();
    for clause in heritage.children(&mut hc) {
        let rel_kind = match clause.kind() {
            "extends_clause" => RelationKind::Generalization,
            "implements_clause" => RelationKind::InterfaceRealization,
            _ => continue,
        };
        let mut cc = clause.walk();
        for id_node in clause.children(&mut cc) {
            if matches!(id_node.kind(), "identifier" | "type_identifier") {
                bundle.relations.push(ImportedRelation {
                    source_name: class_name.to_string(),
                    target_name: node_text(id_node, src).to_string(),
                    kind: rel_kind,
                    role_name: None,
                    target_multiplicity: Multiplicity::exactly_one(),
                    visibility: Visibility::Public,
                });
            }
        }
    }
}

fn extract_ts_members(body: Node, src: &[u8], clf: &mut ImportedClassifier) {
    let mut bc = body.walk();
    for member in body.children(&mut bc) {
        match member.kind() {
            "public_field_definition" | "property_signature" => {
                if let Some(name) = child_text_by_field(member, "name", src) {
                    let ty = child_text_by_field(member, "type", src)
                        .map(|t| t.trim_start_matches(':').trim().to_string())
                        .unwrap_or_else(|| "any".to_string());
                    clf.properties.push(Property::new(name, TypeRef::external(ty)));
                }
            }
            "method_definition" | "method_signature" | "abstract_method_signature" => {
                if let Some(name) = child_text_by_field(member, "name", src) {
                    let mut op = Operation::new(name);
                    if let Some(rt) = child_text_by_field(member, "return_type", src) {
                        op.return_type =
                            Some(TypeRef::external(rt.trim_start_matches(':').trim()));
                    }
                    clf.operations.push(op);
                }
            }
            _ => {}
        }
    }
}

// ============================================================================
// Java Extractor
// ============================================================================

fn extract_java(
    node: Node,
    src: &[u8],
    pkg: &Option<String>,
    bundle: &mut ImportBundle,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "class_declaration" | "interface_declaration" | "enum_declaration" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let kind = match child.kind() {
                        "interface_declaration" => ClassifierKind::Interface,
                        "enum_declaration" => ClassifierKind::Enumeration,
                        _ => ClassifierKind::Class,
                    };
                    let mut clf = ImportedClassifier::new(&name, kind);
                    clf.package_name = pkg.clone();

                    if let Some(sc) = child.child_by_field_name("superclass") {
                        let base = node_text(sc, src)
                            .trim_start_matches("extends")
                            .trim()
                            .to_string();
                        if !base.is_empty() {
                            bundle.relations.push(ImportedRelation {
                                source_name: name.clone(),
                                target_name: base,
                                kind: RelationKind::Generalization,
                                role_name: None,
                                target_multiplicity: Multiplicity::exactly_one(),
                                visibility: Visibility::Public,
                            });
                        }
                    }
                    if let Some(ifaces) = child.child_by_field_name("interfaces") {
                        let list = node_text(ifaces, src)
                            .trim_start_matches("implements")
                            .trim();
                        for iface in list.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
                            bundle.relations.push(ImportedRelation {
                                source_name: name.clone(),
                                target_name: iface.to_string(),
                                kind: RelationKind::InterfaceRealization,
                                role_name: None,
                                target_multiplicity: Multiplicity::exactly_one(),
                                visibility: Visibility::Public,
                            });
                        }
                    }

                    if let Some(body) = child.child_by_field_name("body") {
                        let mut bc = body.walk();
                        for member in body.children(&mut bc) {
                            match member.kind() {
                                "field_declaration" => {
                                    let ty = child_text_by_field(member, "type", src)
                                        .unwrap_or_else(|| "Object".to_string());
                                    if let Some(decl) = member.child_by_field_name("declarator") {
                                        if let Some(fname) = child_text_by_field(decl, "name", src) {
                                            clf.properties.push(Property::new(
                                                fname,
                                                TypeRef::external(ty),
                                            ));
                                        }
                                    }
                                }
                                "method_declaration" => {
                                    if let Some(mname) = child_text_by_field(member, "name", src) {
                                        let mut op = Operation::new(mname);
                                        if let Some(rt) = child_text_by_field(member, "type", src) {
                                            op.return_type = Some(TypeRef::external(rt));
                                        }
                                        clf.operations.push(op);
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    bundle.classifiers.push(clf);
                }
            }
            _ => {}
        }
    }
}

// ============================================================================
// C++ Extractor
// ============================================================================

fn extract_cpp(node: Node, src: &[u8], pkg: &Option<String>, bundle: &mut ImportBundle) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "class_specifier" | "struct_specifier" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let mut clf = ImportedClassifier::new(&name, ClassifierKind::Class);
                    clf.package_name = pkg.clone();
                    let mut cc = child.walk();
                    for sub in child.children(&mut cc) {
                        if sub.kind() == "base_class_clause" {
                            let raw = node_text(sub, src).trim_start_matches(':');
                            for part in raw.split(',') {
                                if let Some(base) = part.split_whitespace().last() {
                                    bundle.relations.push(ImportedRelation {
                                        source_name: name.clone(),
                                        target_name: base.to_string(),
                                        kind: RelationKind::Generalization,
                                        role_name: None,
                                        target_multiplicity: Multiplicity::exactly_one(),
                                        visibility: Visibility::Public,
                                    });
                                }
                            }
                        } else if sub.kind() == "field_declaration_list" {
                            let mut fc = sub.walk();
                            for item in sub.children(&mut fc) {
                                if item.kind() == "field_declaration" {
                                    let ty = child_text_by_field(item, "type", src)
                                        .unwrap_or_else(|| "auto".to_string());
                                    if let Some(decl) = item.child_by_field_name("declarator") {
                                        let dtext = node_text(decl, src);
                                        if decl.kind() == "function_declarator" {
                                            let fn_name = child_text_by_field(decl, "declarator", src)
                                                .unwrap_or_else(|| dtext.to_string());
                                            let mut op = Operation::new(fn_name);
                                            op.return_type = Some(TypeRef::external(ty));
                                            clf.operations.push(op);
                                        } else {
                                            clf.properties.push(Property::new(
                                                dtext.trim_start_matches('*').trim_start_matches('&'),
                                                TypeRef::external(ty),
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    bundle.classifiers.push(clf);
                }
            }
            "enum_specifier" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let mut clf = ImportedClassifier::new(name, ClassifierKind::Enumeration);
                    clf.package_name = pkg.clone();
                    bundle.classifiers.push(clf);
                }
            }
            "namespace_definition" => {
                let ns = child_text_by_field(child, "name", src);
                let sub_pkg = match (pkg, ns) {
                    (Some(p), Some(n)) => Some(format!("{p}::{n}")),
                    (None, Some(n)) => Some(n),
                    (p, None) => p.clone(),
                };
                if let Some(body) = child.child_by_field_name("body") {
                    extract_cpp(body, src, &sub_pkg, bundle);
                }
            }
            _ => {}
        }
    }
}

// ============================================================================
// Go Extractor
// ============================================================================

fn extract_go(node: Node, src: &[u8], pkg: &Option<String>, bundle: &mut ImportBundle) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "type_declaration" => {
                let mut tc = child.walk();
                for spec in child.children(&mut tc) {
                    if spec.kind() == "type_spec" {
                        if let (Some(name), Some(ty_node)) = (
                            child_text_by_field(spec, "name", src),
                            spec.child_by_field_name("type"),
                        ) {
                            let kind = match ty_node.kind() {
                                "interface_type" => ClassifierKind::Interface,
                                _ => ClassifierKind::Class,
                            };
                            let mut clf = ImportedClassifier::new(name, kind);
                            clf.package_name = pkg.clone();
                            bundle.classifiers.push(clf);
                        }
                    }
                }
            }
            "method_declaration" => {
                if let (Some(name), Some(recv)) = (
                    child_text_by_field(child, "name", src),
                    child.child_by_field_name("receiver"),
                ) {
                    let recv_txt = node_text(recv, src);
                    if let Some(owner) = recv_txt
                        .trim_matches(|c| c == '(' || c == ')')
                        .split_whitespace()
                        .last()
                        .map(|s| s.trim_start_matches('*'))
                    {
                        if let Some(clf) = bundle.classifiers.iter_mut().find(|c| c.name == owner) {
                            clf.operations.push(Operation::new(name));
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

// ============================================================================
// PHP Extractor
// ============================================================================

fn extract_php(node: Node, src: &[u8], pkg: &Option<String>, bundle: &mut ImportBundle) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "class_declaration" | "interface_declaration" | "enum_declaration" => {
                if let Some(name) = child_text_by_field(child, "name", src) {
                    let kind = match child.kind() {
                        "interface_declaration" => ClassifierKind::Interface,
                        "enum_declaration" => ClassifierKind::Enumeration,
                        _ => ClassifierKind::Class,
                    };
                    let mut clf = ImportedClassifier::new(name, kind);
                    clf.package_name = pkg.clone();
                    bundle.classifiers.push(clf);
                }
            }
            _ => extract_php(child, src, pkg, bundle),
        }
    }
}
