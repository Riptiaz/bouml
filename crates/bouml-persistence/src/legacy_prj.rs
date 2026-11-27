use bouml_core::{
    AppliedStereotype, Classifier, ClassifierKind, Diagram, DiagramKind, ElementId, LayoutMode,
    Multiplicity, Operation, Package, ParamDirection, Parameter, Project, Property, Relation,
    RelationKind, TypeRef, Visibility,
};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LegacyImportError {
    #[error("I/O error reading {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("parse error in {file}: {message}")]
    Parse { file: PathBuf, message: String },
}

/// Result of importing a historical BouML v4 `.prj` project.
#[derive(Debug)]
pub struct LegacyImportReport {
    pub project: Project,
    pub format_version: u32,
    pub imported_packages: usize,
    pub imported_classifiers: usize,
    pub imported_properties: usize,
    pub imported_operations: usize,
    pub imported_bodies: usize,
    pub imported_relations: usize,
    pub imported_diagrams: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
enum Token {
    Word(String),
    Str(String),
}

/// Token-based lexer compatible with BouML v4's `src/misc/myio.cpp`.
/// Handles ISO-8859-1 (Latin-1) files, `//` line comments, multiline `"..."` strings,
/// and adjacent tokens without separating whitespace (e.g. `"ClassName"cpp_decl`).
struct LegacyLexer {
    tokens: Vec<Token>,
    pos: usize,
}

impl LegacyLexer {
    fn from_bytes(bytes: &[u8]) -> Self {
        // BouML v4 persisted files in Latin-1 (`QTextStream::Latin1`).
        let text: String = bytes.iter().map(|&b| b as char).collect();
        let chars: Vec<char> = text.chars().collect();
        let mut tokens = Vec::new();
        let mut i = 0;

        while i < chars.len() {
            let c = chars[i];
            if c.is_whitespace() {
                i += 1;
                continue;
            }
            // Skip `//` line comments.
            if c == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
                i += 2;
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            // Double-quoted multiline string (`\"` and `\\` escapes).
            if c == '"' {
                i += 1;
                let mut s = String::new();
                while i < chars.len() {
                    let ch = chars[i];
                    if ch == '\\' && i + 1 < chars.len() {
                        s.push(chars[i + 1]);
                        i += 2;
                    } else if ch == '"' {
                        i += 1;
                        break;
                    } else {
                        s.push(ch);
                        i += 1;
                    }
                }
                tokens.push(Token::Str(s));
                continue;
            }
            // Keyword / identifier / number / relation symbol (`---|>`, `*---`, etc.).
            let start = i;
            while i < chars.len() && !chars[i].is_whitespace() && chars[i] != '"' {
                if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
                    break;
                }
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            if !word.is_empty() {
                tokens.push(Token::Word(word));
            }
        }

        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn next(&mut self) -> Option<Token> {
        if self.pos < self.tokens.len() {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            Some(tok)
        } else {
            None
        }
    }

    fn next_word(&mut self) -> Option<String> {
        match self.next() {
            Some(Token::Word(w)) => Some(w),
            _ => None,
        }
    }

    fn next_str(&mut self) -> Option<String> {
        match self.next() {
            Some(Token::Str(s)) => Some(s),
            _ => None,
        }
    }
}

/// Pending relation parsed during Pass 1, resolved to ULID `ElementId`s in Pass 2.
struct PendingRelation {
    source_legacy_id: u64,
    target_legacy_id: u64,
    kind: RelationKind,
    role_name: Option<String>,
    visibility: Visibility,
    multiplicity: Multiplicity,
}

/// Imports a historical BouML v4 `.prj` project directory into a modern UML 2.5 `Project`.
pub fn import_legacy_prj(prj_path: &Path) -> Result<LegacyImportReport, LegacyImportError> {
    let base_dir = prj_path.parent().unwrap_or_else(|| Path::new("."));
    let bytes = fs::read(prj_path).map_err(|source| LegacyImportError::Io {
        path: prj_path.to_path_buf(),
        source,
    })?;
    let mut lex = LegacyLexer::from_bytes(&bytes);

    // Header: `format <version> "<project_name>"`
    let mut format_version = 0u32;
    if matches!(lex.peek(), Some(Token::Word(w)) if w == "format") {
        lex.next();
        if let Some(v) = lex.next_word() {
            format_version = v.parse().unwrap_or(0);
        }
    }
    let project_name = lex.next_str().unwrap_or_else(|| {
        prj_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("imported_project")
            .to_string()
    });

    let mut project = Project::new(&project_name);
    let root_id = project.root_package_id.clone();

    let mut legacy_class_map: HashMap<u64, ElementId> = HashMap::new();
    let mut pending_relations: Vec<PendingRelation> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut imported_bodies: usize = 0;

    // Collect top-level `package_ref <id>` references from `.prj`.
    let mut child_pkg_refs = Vec::new();
    while let Some(tok) = lex.next() {
        if let Token::Word(w) = tok {
            if w == "package_ref" {
                if let Some(id_str) = lex.next_word() {
                    if let Ok(id) = id_str.parse::<u64>() {
                        child_pkg_refs.push(id);
                    }
                }
            }
        }
    }

    // Pass 1: Recursively parse every referenced package file `<id>`.
    for pkg_legacy_id in child_pkg_refs {
        parse_package_file(
            base_dir,
            pkg_legacy_id,
            &root_id,
            &mut project,
            &mut legacy_class_map,
            &mut pending_relations,
            &mut imported_bodies,
            &mut warnings,
        )?;
    }

    // Pass 2: Resolve legacy `class_ref` IDs in relations into UML 2.5 `ElementId`s.
    for prel in pending_relations {
        if let (Some(src_id), Some(tgt_id)) = (
            legacy_class_map.get(&prel.source_legacy_id),
            legacy_class_map.get(&prel.target_legacy_id),
        ) {
            let mut rel = Relation::new(prel.kind, src_id.clone(), tgt_id.clone());
            rel.source.role_name = prel.role_name;
            rel.source.visibility = prel.visibility;
            rel.target.multiplicity = prel.multiplicity;
            project.relations.insert(rel.meta.id.clone(), rel);
        }
    }

    let stats = project.stats();
    Ok(LegacyImportReport {
        project,
        format_version,
        imported_packages: stats.packages,
        imported_classifiers: stats.classifiers,
        imported_properties: stats.properties,
        imported_operations: stats.operations,
        imported_bodies,
        imported_relations: stats.relations,
        imported_diagrams: stats.diagrams,
        warnings,
    })
}

#[allow(clippy::too_many_arguments)]
fn parse_package_file(
    base_dir: &Path,
    legacy_id: u64,
    parent_pkg_id: &ElementId,
    project: &mut Project,
    legacy_class_map: &mut HashMap<u64, ElementId>,
    pending_relations: &mut Vec<PendingRelation>,
    imported_bodies: &mut usize,
    warnings: &mut Vec<String>,
) -> Result<(), LegacyImportError> {
    let pkg_path = base_dir.join(legacy_id.to_string());
    if !pkg_path.exists() {
        warnings.push(format!(
            "Referenced package file '{}' not found, skipping",
            pkg_path.display()
        ));
        return Ok(());
    }

    let bytes = fs::read(&pkg_path).map_err(|source| LegacyImportError::Io {
        path: pkg_path.clone(),
        source,
    })?;
    let mut lex = LegacyLexer::from_bytes(&bytes);

    if matches!(lex.peek(), Some(Token::Word(w)) if w == "format") {
        lex.next();
        lex.next_word();
    }
    let pkg_name = lex
        .next_str()
        .unwrap_or_else(|| format!("package_{legacy_id}"));

    let mut pkg = Package::new(&pkg_name, Some(parent_pkg_id.clone()));
    let pkg_id = pkg.meta.id.clone();

    let mut child_pkg_refs = Vec::new();
    let mut parsed_classifiers = Vec::new();
    let mut parsed_diagrams = Vec::new();

    while let Some(tok) = lex.next() {
        let Token::Word(w) = tok else {
            continue;
        };
        match w.as_str() {
            "comment" => {
                if let Some(c) = lex.next_str() {
                    if pkg.meta.comment.is_empty() {
                        pkg.meta.comment = c;
                    }
                }
            }
            "package_ref" => {
                if let Some(id_str) = lex.next_word() {
                    if let Ok(id) = id_str.parse::<u64>() {
                        child_pkg_refs.push(id);
                    }
                }
            }
            "class" => {
                if let Some((legacy_cid, clf)) = parse_class_block(
                    base_dir,
                    &mut lex,
                    &pkg_id,
                    pending_relations,
                    imported_bodies,
                ) {
                    legacy_class_map.insert(legacy_cid, clf.meta.id.clone());
                    parsed_classifiers.push(clf);
                }
            }
            "classdiagram" => {
                let _diag_legacy_id = lex.next_word();
                let diag_name = lex
                    .next_str()
                    .unwrap_or_else(|| "Class Diagram".to_string());
                skip_until_end(&mut lex);
                let mut diag = Diagram::new(diag_name, DiagramKind::Class, pkg_id.clone());
                diag.layout_mode = LayoutMode::AutoElk;
                parsed_diagrams.push(diag);
            }
            _ => {}
        }
    }

    for clf in parsed_classifiers {
        pkg.classifiers.push(clf.meta.id.clone());
        project.classifiers.insert(clf.meta.id.clone(), clf);
    }
    for diag in parsed_diagrams {
        project.diagrams.insert(diag.id.clone(), diag);
    }

    if let Some(parent) = project.packages.get_mut(parent_pkg_id) {
        parent.subpackages.push(pkg_id.clone());
    }
    project.packages.insert(pkg_id.clone(), pkg);

    for child_id in child_pkg_refs {
        parse_package_file(
            base_dir,
            child_id,
            &pkg_id,
            project,
            legacy_class_map,
            pending_relations,
            imported_bodies,
            warnings,
        )?;
    }

    Ok(())
}

fn parse_class_block(
    base_dir: &Path,
    lex: &mut LegacyLexer,
    pkg_id: &ElementId,
    pending_relations: &mut Vec<PendingRelation>,
    imported_bodies: &mut usize,
) -> Option<(u64, Classifier)> {
    let legacy_id: u64 = lex.next_word()?.parse().ok()?;
    let name = lex.next_str()?;

    let mut clf = Classifier::new(name, pkg_id.clone(), ClassifierKind::Class);

    // Load operation bodies from `<legacy_id>.bodies` if present.
    let bodies_map = load_legacy_bodies_file(&base_dir.join(format!("{legacy_id}.bodies")));

    while let Some(tok) = lex.next() {
        let Token::Word(w) = tok else {
            continue;
        };
        match w.as_str() {
            "end" => break,
            "abstract" => clf.is_abstract = true,
            "visibility" => {
                if let Some(v) = lex.next_word() {
                    clf.visibility = parse_visibility(&v);
                }
            }
            "stereotype" => {
                if let Some(st) = lex.next_str() {
                    clf.kind = stereotype_to_classifier_kind(&st);
                    if !st.is_empty() {
                        clf.meta.stereotypes.push(AppliedStereotype::new(st));
                    }
                }
            }
            "comment" => {
                if let Some(c) = lex.next_str() {
                    clf.meta.comment = c;
                }
            }
            "attribute" => {
                if let Some(prop) = parse_attribute_block(lex) {
                    clf.properties.push(prop);
                }
            }
            "operation" => {
                if let Some((op_legacy_id, mut op)) = parse_operation_block(lex) {
                    if let Some(lang_bodies) = bodies_map.get(&op_legacy_id) {
                        for (lang, body) in lang_bodies {
                            op.bodies.insert(lang.clone(), body.clone());
                            *imported_bodies += 1;
                        }
                    }
                    clf.operations.push(op);
                }
            }
            "classrelation" => {
                if let Some(rel) = parse_classrelation_block(lex, legacy_id) {
                    pending_relations.push(rel);
                }
            }
            "extra_member" | "nested" | "ncouples" => {
                if w == "extra_member" {
                    skip_until_end(lex);
                }
            }
            _ => {}
        }
    }

    Some((legacy_id, clf))
}

fn parse_attribute_block(lex: &mut LegacyLexer) -> Option<Property> {
    let _legacy_id = lex.next_word()?;
    let name = lex.next_str()?;
    let mut prop = Property::new(name, TypeRef::external("any"));

    while let Some(tok) = lex.next() {
        let Token::Word(w) = tok else {
            continue;
        };
        match w.as_str() {
            "end" => break,
            "public" | "protected" | "private" | "package" => {
                prop.visibility = parse_visibility(&w);
            }
            "class_attribute" => prop.is_static = true,
            "const_attribute" => prop.is_readonly = true,
            "explicit_type" => {
                if let Some(t) = lex.next_str() {
                    if !t.is_empty() {
                        prop.type_ref = TypeRef::external(t);
                    }
                }
            }
            "multiplicity" => {
                if let Some(m) = lex.next_str() {
                    if let Ok(parsed) = m.parse::<Multiplicity>() {
                        prop.multiplicity = parsed;
                    }
                }
            }
            "init_value" => {
                if let Some(v) = lex.next_str() {
                    if !v.is_empty() {
                        prop.default_value = Some(v);
                    }
                }
            }
            "comment" => {
                if let Some(c) = lex.next_str() {
                    prop.meta.comment = c;
                }
            }
            _ => {}
        }
    }

    Some(prop)
}

fn parse_operation_block(lex: &mut LegacyLexer) -> Option<(u64, Operation)> {
    let legacy_id: u64 = lex.next_word()?.parse().ok()?;
    let name = lex.next_str()?;
    let mut op = Operation::new(name);

    while let Some(tok) = lex.next() {
        let Token::Word(w) = tok else {
            continue;
        };
        match w.as_str() {
            "end" => break,
            "public" | "protected" | "private" | "package" => {
                op.visibility = parse_visibility(&w);
            }
            "class_operation" => op.is_static = true,
            "abstract" => op.is_abstract = true,
            "const" => op.is_const = true,
            "explicit_return_type" => {
                if let Some(rt) = lex.next_str() {
                    if !rt.is_empty() {
                        op.return_type = Some(TypeRef::external(rt));
                    }
                }
            }
            "param" => {
                // Format: `param <dir> name "<name>" explicit_type "<type>"` or `type class_ref <id>`
                let dir_word = lex.next_word().unwrap_or_default();
                let direction = match dir_word.as_str() {
                    "out" => ParamDirection::Out,
                    "inout" => ParamDirection::InOut,
                    _ => ParamDirection::In,
                };
                let mut pname = String::new();
                let mut ptype = TypeRef::external("any");
                // Peek ahead for `name "<name>"` and `explicit_type "<type>"`
                if matches!(lex.peek(), Some(Token::Word(k)) if k == "name") {
                    lex.next();
                    if let Some(n) = lex.next_str() {
                        pname = n;
                    }
                }
                if matches!(lex.peek(), Some(Token::Word(k)) if k == "explicit_type") {
                    lex.next();
                    if let Some(t) = lex.next_str() {
                        ptype = TypeRef::external(t);
                    }
                } else if matches!(lex.peek(), Some(Token::Word(k)) if k == "type") {
                    lex.next();
                    if matches!(lex.peek(), Some(Token::Word(k)) if k == "class_ref") {
                        lex.next();
                        if let Some(cid) = lex.next_word() {
                            ptype = TypeRef::external(format!("class_ref:{cid}"));
                        }
                    }
                }
                let mut param = Parameter::new(pname, ptype);
                param.direction = direction;
                op.params.push(param);
            }
            "comment" => {
                if let Some(c) = lex.next_str() {
                    op.meta.comment = c;
                }
            }
            _ => {}
        }
    }

    Some((legacy_id, op))
}

fn parse_classrelation_block(lex: &mut LegacyLexer, source_id: u64) -> Option<PendingRelation> {
    let _rel_legacy_id = lex.next_word()?;
    // Optional role name string if present (generalizations have no quoted name)
    let role_name = if matches!(lex.peek(), Some(Token::Str(_))) {
        lex.next_str().filter(|s| !s.is_empty())
    } else {
        None
    };

    let mut kind = RelationKind::Association;
    let mut target_id: Option<u64> = None;
    let mut visibility = Visibility::Public;
    let mut multiplicity = Multiplicity::exactly_one();

    while let Some(tok) = lex.next() {
        let Token::Word(w) = tok else {
            continue;
        };
        match w.as_str() {
            "end" => break,
            "relation" => {
                let _rid = lex.next_word();
                if let Some(sym) = lex.next_word() {
                    kind = parse_relation_symbol(&sym);
                }
            }
            "public" | "protected" | "private" | "package" => {
                visibility = parse_visibility(&w);
            }
            "multiplicity" => {
                if let Some(m) = lex.next_str() {
                    if let Ok(parsed) = m.parse::<Multiplicity>() {
                        multiplicity = parsed;
                    }
                }
            }
            "class_ref" => {
                if let Some(cid_str) = lex.next_word() {
                    if let Ok(cid) = cid_str.parse::<u64>() {
                        target_id = Some(cid);
                    }
                }
            }
            _ => {}
        }
    }

    target_id.map(|tgt| PendingRelation {
        source_legacy_id: source_id,
        target_legacy_id: tgt,
        kind,
        role_name,
        visibility,
        multiplicity,
    })
}

/// Parses a BouML v4 `<class_id>.bodies` file delimited by `!!!<op_id>.<lang>!!!`.
fn load_legacy_bodies_file(path: &Path) -> BTreeMap<u64, BTreeMap<String, String>> {
    let mut result: BTreeMap<u64, BTreeMap<String, String>> = BTreeMap::new();
    let Ok(bytes) = fs::read(path) else {
        return result;
    };
    let text: String = bytes.iter().map(|&b| b as char).collect();

    let mut current_key: Option<(u64, String)> = None;
    let mut current_body = String::new();

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("!!!") {
            if let Some(end_idx) = rest.find("!!!") {
                // Flush previous body
                if let Some((op_id, lang)) = current_key.take() {
                    let trimmed = current_body.trim_end().to_string();
                    if !trimmed.is_empty() {
                        result.entry(op_id).or_default().insert(lang, trimmed);
                    }
                    current_body.clear();
                }
                let header = &rest[..end_idx];
                if let Some((id_str, lang)) = header.split_once('.') {
                    if let Ok(op_id) = id_str.parse::<u64>() {
                        current_key = Some((op_id, lang.to_string()));
                    }
                }
                continue;
            }
        }
        if current_key.is_some() {
            current_body.push_str(line);
            current_body.push('\n');
        }
    }

    if let Some((op_id, lang)) = current_key {
        let trimmed = current_body.trim_end().to_string();
        if !trimmed.is_empty() {
            result.entry(op_id).or_default().insert(lang, trimmed);
        }
    }

    result
}

fn skip_until_end(lex: &mut LegacyLexer) {
    let mut depth = 1usize;
    while let Some(tok) = lex.next() {
        if let Token::Word(w) = tok {
            if w == "end" {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            } else if matches!(
                w.as_str(),
                "class"
                    | "attribute"
                    | "operation"
                    | "classrelation"
                    | "extra_member"
                    | "classdiagram"
            ) {
                depth += 1;
            }
        }
    }
}

fn parse_visibility(word: &str) -> Visibility {
    match word {
        "public" => Visibility::Public,
        "protected" => Visibility::Protected,
        "private" => Visibility::Private,
        "package" => Visibility::Package,
        _ => Visibility::Public,
    }
}

fn stereotype_to_classifier_kind(st: &str) -> ClassifierKind {
    match st.to_ascii_lowercase().as_str() {
        "interface" => ClassifierKind::Interface,
        "enum" | "enumeration" => ClassifierKind::Enumeration,
        "actor" => ClassifierKind::Actor,
        "struct" | "datatype" | "typedef" => ClassifierKind::DataType,
        _ => ClassifierKind::Class,
    }
}

fn parse_relation_symbol(sym: &str) -> RelationKind {
    match sym {
        "---|>" | "<|---" => RelationKind::Generalization,
        "..|>" | "<|.." => RelationKind::InterfaceRealization,
        "*---" | "---*" | "*-->" | "<--*" => RelationKind::Composition,
        "o---" | "---o" | "o-->" | "<--o" => RelationKind::Aggregation,
        "..>" | "<.." | ".." => RelationKind::Dependency,
        _ => RelationKind::Association,
    }
}
