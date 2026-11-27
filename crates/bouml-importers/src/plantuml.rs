use crate::ir::{ImportBundle, ImportedClassifier, ImportedRelation};
use bouml_core::{
    ClassifierKind, EnumLiteral, Multiplicity, Operation, Parameter, Property, RelationKind,
    TypeRef, Visibility,
};

/// Parses a PlantUML (`.puml`) class diagram into a normalized `ImportBundle`.
pub fn parse_plantuml(source: &str, label: &str) -> ImportBundle {
    let mut bundle = ImportBundle {
        source_label: label.to_string(),
        ..Default::default()
    };

    let mut pkg_stack: Vec<String> = Vec::new();
    let mut active_clf: Option<ImportedClassifier> = None;

    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty()
            || line.starts_with('\'')
            || line.starts_with("@startuml")
            || line.starts_with("@enduml")
            || line.starts_with("skinparam")
            || line.starts_with("title ")
        {
            continue;
        }

        if line == "}" {
            if let Some(clf) = active_clf.take() {
                bundle.classifiers.push(clf);
            } else {
                pkg_stack.pop();
            }
            continue;
        }

        // Inside a classifier block `{ ... }`
        if let Some(ref mut clf) = active_clf {
            parse_uml_member_line(line, clf);
            continue;
        }

        // Package block: `package Foo {`
        if let Some(rest) = line.strip_prefix("package ") {
            let pkg_name = rest
                .trim_end_matches('{')
                .trim()
                .trim_matches('"')
                .to_string();
            pkg_stack.push(pkg_name);
            continue;
        }

        // Classifier declaration
        if let Some((clf, opens_block)) = parse_puml_classifier_header(line, &pkg_stack) {
            if opens_block {
                active_clf = Some(clf);
            } else {
                bundle.classifiers.push(clf);
            }
            continue;
        }

        // Relation line (e.g. `A <|-- B`, `A *-- B : items`, `A ..|> I`)
        if let Some(rel) = parse_uml_relation_line(line) {
            bundle.relations.push(rel);
        }
    }

    if let Some(clf) = active_clf {
        bundle.classifiers.push(clf);
    }

    bundle
}

fn parse_puml_classifier_header(
    line: &str,
    pkg_stack: &[String],
) -> Option<(ImportedClassifier, bool)> {
    let (is_abstract, rest) = if let Some(r) = line.strip_prefix("abstract class ") {
        (true, r)
    } else if let Some(r) = line.strip_prefix("abstract ") {
        (true, r)
    } else {
        (false, line)
    };

    let (kind, after_kw) = if let Some(r) = rest.strip_prefix("class ") {
        (ClassifierKind::Class, r)
    } else if let Some(r) = rest.strip_prefix("interface ") {
        (ClassifierKind::Interface, r)
    } else if let Some(r) = rest.strip_prefix("enum ") {
        (ClassifierKind::Enumeration, r)
    } else if let Some(r) = rest.strip_prefix("struct ") {
        (ClassifierKind::DataType, r)
    } else if is_abstract {
        (ClassifierKind::Class, rest)
    } else {
        return None;
    };

    let opens_block = after_kw.trim_end().ends_with('{');
    let name = after_kw
        .trim_end_matches('{')
        .trim()
        .split_whitespace()
        .next()?
        .trim_matches('"')
        .to_string();

    let mut clf = ImportedClassifier::new(name, kind);
    clf.is_abstract = is_abstract || kind == ClassifierKind::Interface;
    if !pkg_stack.is_empty() {
        clf.package_name = Some(pkg_stack.join("::"));
    }
    Some((clf, opens_block))
}

pub(crate) fn parse_uml_member_line(line: &str, clf: &mut ImportedClassifier) {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed == "--" || trimmed == "==" {
        return;
    }
    if clf.kind == ClassifierKind::Enumeration && !trimmed.contains('(') && !trimmed.contains(':') {
        clf.literals.push(EnumLiteral {
            name: trimmed.to_string(),
            value: None,
            comment: String::new(),
        });
        return;
    }

    let (vis, rest) = match trimmed.chars().next().and_then(Visibility::from_symbol) {
        Some(v) => (v, trimmed[1..].trim()),
        None => (Visibility::Public, trimmed),
    };

    if let Some(open_paren) = rest.find('(') {
        let name = rest[..open_paren].trim();
        let after_open = &rest[open_paren + 1..];
        let (params_str, after_close) = match after_open.find(')') {
            Some(idx) => (&after_open[..idx], after_open[idx + 1..].trim()),
            None => (after_open, ""),
        };
        let mut op = Operation::new(name);
        op.visibility = vis;
        for raw_p in params_str.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
            if let Some((pn, pt)) = raw_p.split_once(':') {
                op.params
                    .push(Parameter::new(pn.trim(), TypeRef::external(pt.trim())));
            } else {
                let parts: Vec<&str> = raw_p.split_whitespace().collect();
                if parts.len() >= 2 {
                    op.params
                        .push(Parameter::new(parts[1], TypeRef::external(parts[0])));
                } else {
                    op.params
                        .push(Parameter::new(raw_p, TypeRef::external("any")));
                }
            }
        }
        let ret = after_close.trim_start_matches(':').trim();
        if !ret.is_empty() {
            op.return_type = Some(TypeRef::external(ret));
        }
        clf.operations.push(op);
    } else if let Some((name, ty)) = rest.split_once(':') {
        let mut prop = Property::new(name.trim(), TypeRef::external(ty.trim()));
        prop.visibility = vis;
        clf.properties.push(prop);
    } else {
        let parts: Vec<&str> = rest.split_whitespace().collect();
        if parts.len() >= 2 {
            let mut prop = Property::new(parts[1], TypeRef::external(parts[0]));
            prop.visibility = vis;
            clf.properties.push(prop);
        }
    }
}

pub(crate) fn parse_uml_relation_line(line: &str) -> Option<ImportedRelation> {
    let (expr, label) = match line.split_once(':') {
        Some((l, r)) => (l.trim(), Some(r.trim().to_string()).filter(|s| !s.is_empty())),
        None => (line.trim(), None),
    };

    const ARROWS: &[(&str, RelationKind, bool)] = &[
        ("<|--", RelationKind::Generalization, true),
        ("--|>", RelationKind::Generalization, false),
        ("<|..", RelationKind::InterfaceRealization, true),
        ("..|>", RelationKind::InterfaceRealization, false),
        ("*--", RelationKind::Composition, false),
        ("--*", RelationKind::Composition, true),
        ("o--", RelationKind::Aggregation, false),
        ("--o", RelationKind::Aggregation, true),
        ("..>", RelationKind::Dependency, false),
        ("<..", RelationKind::Dependency, true),
        ("-->", RelationKind::Association, false),
        ("<--", RelationKind::Association, true),
        ("--", RelationKind::Association, false),
    ];

    for &(arrow, kind, reversed) in ARROWS {
        if let Some((left, right)) = expr.split_once(arrow) {
            let lhs = left
                .split_whitespace()
                .next()?
                .trim_matches('"')
                .to_string();
            let rhs = right
                .split_whitespace()
                .last()?
                .trim_matches('"')
                .to_string();
            let (source_name, target_name) = if reversed { (rhs, lhs) } else { (lhs, rhs) };
            return Some(ImportedRelation {
                source_name,
                target_name,
                kind,
                role_name: label,
                target_multiplicity: Multiplicity::exactly_one(),
                visibility: Visibility::Public,
            });
        }
    }
    None
}
