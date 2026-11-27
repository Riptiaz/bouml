use crate::ir::{ImportBundle, ImportedClassifier, ImportedRelation};
use bouml_core::{
    ClassifierKind, Multiplicity, Operation, Parameter, Property, RelationKind, TypeRef,
    Visibility,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::collections::HashMap;

/// Parses an XMI 2.1 / 2.5 XML document into an `ImportBundle`.
pub fn parse_xmi(source: &str, label: &str) -> Result<ImportBundle, String> {
    let mut reader = Reader::from_str(source);
    reader.config_mut().trim_text(true);

    let mut bundle = ImportBundle {
        source_label: label.to_string(),
        ..Default::default()
    };

    let mut xmi_id_to_name: HashMap<String, String> = HashMap::new();
    let mut pending_gens: Vec<(String, String, RelationKind)> = Vec::new();

    let mut pkg_stack: Vec<String> = Vec::new();
    let mut active_clf: Option<ImportedClassifier> = None;
    let mut active_op: Option<Operation> = None;

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                handle_xmi_element(
                    e,
                    false,
                    &mut pkg_stack,
                    &mut active_clf,
                    &mut active_op,
                    &mut xmi_id_to_name,
                    &mut pending_gens,
                );
            }
            Ok(Event::Empty(ref e)) => {
                handle_xmi_element(
                    e,
                    true,
                    &mut pkg_stack,
                    &mut active_clf,
                    &mut active_op,
                    &mut xmi_id_to_name,
                    &mut pending_gens,
                );
                // If an empty element created a classifier, flush it immediately.
                let tag = local_name(e.name().as_ref());
                if tag == "packagedElement" {
                    if let Some(clf) = active_clf.take() {
                        bundle.classifiers.push(clf);
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let tag = local_name(e.name().as_ref());
                match tag.as_str() {
                    "ownedOperation" => {
                        if let (Some(op), Some(ref mut clf)) = (active_op.take(), active_clf.as_mut())
                        {
                            clf.operations.push(op);
                        }
                    }
                    "packagedElement" => {
                        if let Some(clf) = active_clf.take() {
                            bundle.classifiers.push(clf);
                        } else {
                            pkg_stack.pop();
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XMI XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    for (src_name, target_xmi_id, kind) in pending_gens {
        if let Some(target_name) = xmi_id_to_name.get(&target_xmi_id) {
            bundle.relations.push(ImportedRelation {
                source_name: src_name,
                target_name: target_name.clone(),
                kind,
                role_name: None,
                target_multiplicity: Multiplicity::exactly_one(),
                visibility: Visibility::Public,
            });
        }
    }

    Ok(bundle)
}

#[allow(clippy::too_many_arguments)]
fn handle_xmi_element(
    e: &BytesStart,
    is_empty: bool,
    pkg_stack: &mut Vec<String>,
    active_clf: &mut Option<ImportedClassifier>,
    active_op: &mut Option<Operation>,
    xmi_id_to_name: &mut HashMap<String, String>,
    pending_gens: &mut Vec<(String, String, RelationKind)>,
) {
    let tag = local_name(e.name().as_ref());
    let attrs = collect_attrs(e);
    let xmi_type = attrs.get("type").map(|s| s.as_str()).unwrap_or("");
    let xmi_id = attrs.get("id").cloned().unwrap_or_default();
    let name = attrs.get("name").cloned().unwrap_or_default();

    match tag.as_str() {
        "packagedElement" => match xmi_type {
            "uml:Package" | "uml:Model" => {
                if !is_empty && !name.is_empty() {
                    pkg_stack.push(name);
                }
            }
            "uml:Class" | "uml:Interface" | "uml:Enumeration" | "uml:DataType" | "uml:Actor"
            | "uml:Component" => {
                let kind = match xmi_type {
                    "uml:Interface" => ClassifierKind::Interface,
                    "uml:Enumeration" => ClassifierKind::Enumeration,
                    "uml:DataType" => ClassifierKind::DataType,
                    "uml:Actor" => ClassifierKind::Actor,
                    "uml:Component" => ClassifierKind::Component,
                    _ => ClassifierKind::Class,
                };
                if !xmi_id.is_empty() && !name.is_empty() {
                    xmi_id_to_name.insert(xmi_id, name.clone());
                }
                let mut clf = ImportedClassifier::new(name, kind);
                clf.is_abstract = attrs.get("isAbstract").is_some_and(|v| v == "true")
                    || kind == ClassifierKind::Interface;
                if !pkg_stack.is_empty() {
                    clf.package_name = Some(pkg_stack.join("::"));
                }
                *active_clf = Some(clf);
            }
            _ => {}
        },
        "ownedAttribute" => {
            if let Some(ref mut clf) = active_clf {
                if !name.is_empty() {
                    let ty = attrs
                        .get("type")
                        .cloned()
                        .unwrap_or_else(|| "any".to_string());
                    let mut prop = Property::new(name, TypeRef::external(ty));
                    prop.visibility = parse_xmi_visibility(attrs.get("visibility").map(|s| s.as_str()));
                    clf.properties.push(prop);
                }
            }
        }
        "ownedOperation" => {
            if active_clf.is_some() && !name.is_empty() {
                let mut op = Operation::new(name);
                op.visibility = parse_xmi_visibility(attrs.get("visibility").map(|s| s.as_str()));
                if is_empty {
                    if let Some(ref mut clf) = active_clf {
                        clf.operations.push(op);
                    }
                } else {
                    *active_op = Some(op);
                }
            }
        }
        "ownedParameter" => {
            if let Some(ref mut op) = active_op {
                let dir = attrs.get("direction").map(|s| s.as_str()).unwrap_or("in");
                let ty = attrs
                    .get("type")
                    .cloned()
                    .unwrap_or_else(|| "any".to_string());
                if dir == "return" {
                    op.return_type = Some(TypeRef::external(ty));
                } else if !name.is_empty() {
                    op.params.push(Parameter::new(name, TypeRef::external(ty)));
                }
            }
        }
        "generalization" => {
            if let (Some(clf), Some(general_id)) = (active_clf.as_ref(), attrs.get("general")) {
                pending_gens.push((
                    clf.name.clone(),
                    general_id.clone(),
                    RelationKind::Generalization,
                ));
            }
        }
        "interfaceRealization" => {
            if let (Some(clf), Some(contract_id)) = (active_clf.as_ref(), attrs.get("contract")) {
                pending_gens.push((
                    clf.name.clone(),
                    contract_id.clone(),
                    RelationKind::InterfaceRealization,
                ));
            }
        }
        _ => {}
    }
}

fn local_name(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    s.rsplit(':').next().unwrap_or(&s).to_string()
}

fn collect_attrs(e: &BytesStart) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for attr in e.attributes().flatten() {
        let key = local_name(attr.key.as_ref());
        if let Ok(val) = attr.unescape_value() {
            map.insert(key, val.into_owned());
        }
    }
    map
}

fn parse_xmi_visibility(v: Option<&str>) -> Visibility {
    match v {
        Some("private") => Visibility::Private,
        Some("protected") => Visibility::Protected,
        Some("package") => Visibility::Package,
        _ => Visibility::Public,
    }
}
