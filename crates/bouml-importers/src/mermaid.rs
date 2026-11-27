use crate::ir::{ImportBundle, ImportedClassifier};
use crate::plantuml::{parse_uml_member_line, parse_uml_relation_line};
use bouml_core::ClassifierKind;

/// Parses a Mermaid (`.mmd`) `classDiagram` into a normalized `ImportBundle`.
pub fn parse_mermaid(source: &str, label: &str) -> ImportBundle {
    let mut bundle = ImportBundle {
        source_label: label.to_string(),
        ..Default::default()
    };

    let mut active_clf: Option<ImportedClassifier> = None;

    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty()
            || line.starts_with("%%")
            || line == "classDiagram"
            || line.starts_with("direction ")
        {
            continue;
        }

        if line == "}" {
            if let Some(clf) = active_clf.take() {
                bundle.classifiers.push(clf);
            }
            continue;
        }

        if let Some(ref mut clf) = active_clf {
            if line.starts_with("<<") && line.ends_with(">>") {
                let st = line.trim_start_matches("<<").trim_end_matches(">>").trim();
                match st.to_ascii_lowercase().as_str() {
                    "interface" => {
                        clf.kind = ClassifierKind::Interface;
                        clf.is_abstract = true;
                    }
                    "enumeration" | "enum" => clf.kind = ClassifierKind::Enumeration,
                    "abstract" => clf.is_abstract = true,
                    _ => {}
                }
            } else {
                parse_uml_member_line(line, clf);
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("class ") {
            let opens_block = rest.trim_end().ends_with('{');
            let name = rest
                .trim_end_matches('{')
                .trim()
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_string();
            if !name.is_empty() {
                let clf = ImportedClassifier::new(name, ClassifierKind::Class);
                if opens_block {
                    active_clf = Some(clf);
                } else {
                    bundle.classifiers.push(clf);
                }
            }
            continue;
        }

        if let Some(rel) = parse_uml_relation_line(line) {
            bundle.relations.push(rel);
        }
    }

    if let Some(clf) = active_clf {
        bundle.classifiers.push(clf);
    }

    bundle
}
