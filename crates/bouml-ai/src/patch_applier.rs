use crate::schema::UmlGraphPatch;
use bouml_core::{
    validate_project, Classifier, ClassifierKind, Command, CommandError, CommandHistory, Diagram,
    DiagramKind, Diagnostic, ElementId, ElementMeta, EnumLiteral, Interaction, LayoutMode,
    Lifeline, Message, MessageSort, Multiplicity, Operation, Package, Parameter, Project, Property,
    Region, Relation, RelationKind, StateMachine, StateVertex, Transition, TypeRef, Visibility,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PatchApplyError {
    #[error("command execution failed: {0}")]
    Command(#[from] CommandError),
    #[error("relation '{source_name}' -> '{target_name}' references unknown classifier '{missing}'")]
    UnknownClassifier {
        source_name: String,
        target_name: String,
        missing: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchApplyReport {
    pub summary: String,
    pub packages_created: usize,
    pub classifiers_created: usize,
    pub relations_created: usize,
    pub interactions_created: usize,
    pub state_machines_created: usize,
    pub diagrams_created: usize,
    pub diagnostics: Vec<Diagnostic>,
}

/// Validates and atomically applies an AI-generated `UmlGraphPatch` to `project` via `CommandHistory`.
/// All structural mutations execute inside a single `Command::Batch`, enabling 1-step Undo.
pub fn apply_uml_patch(
    project: &mut Project,
    history: &mut CommandHistory,
    patch: &UmlGraphPatch,
) -> Result<PatchApplyReport, PatchApplyError> {
    let mut batch: Vec<Command> = Vec::new();

    // Name -> ElementId lookup tables seeded from existing project state.
    let mut pkg_map: BTreeMap<String, ElementId> = project
        .packages
        .values()
        .map(|p| (p.meta.name.clone(), p.meta.id.clone()))
        .collect();
    let mut clf_map: BTreeMap<String, ElementId> = project
        .classifiers
        .values()
        .map(|c| (c.meta.name.clone(), c.meta.id.clone()))
        .collect();

    let mut packages_created = 0usize;
    let mut classifiers_created = 0usize;
    let mut relations_created = 0usize;

    // 1. Packages
    for pp in &patch.packages {
        if pkg_map.contains_key(&pp.name) {
            continue;
        }
        let parent_id = pp
            .parent
            .as_deref()
            .and_then(|p| pkg_map.get(p).cloned())
            .unwrap_or_else(|| project.root_package_id.clone());
        let mut pkg = Package::new(&pp.name, Some(parent_id));
        pkg.meta.comment = pp.comment.clone();
        pkg_map.insert(pp.name.clone(), pkg.meta.id.clone());
        batch.push(Command::CreatePackage(pkg));
        packages_created += 1;
    }

    // Pre-allocate ElementIds for all new classifiers so internal TypeRefs resolve cleanly.
    let mut new_clf_ids: BTreeMap<String, ElementId> = BTreeMap::new();
    for pc in &patch.classifiers {
        if !clf_map.contains_key(&pc.name) {
            let id = ElementId::new();
            clf_map.insert(pc.name.clone(), id.clone());
            new_clf_ids.insert(pc.name.clone(), id);
        }
    }

    // 2. Classifiers
    for pc in &patch.classifiers {
        let pkg_id = match pc.package.as_deref().filter(|s| !s.is_empty()) {
            Some(pname) => {
                if let Some(pid) = pkg_map.get(pname).cloned() {
                    pid
                } else {
                    let pkg = Package::new(pname, Some(project.root_package_id.clone()));
                    let pid = pkg.meta.id.clone();
                    pkg_map.insert(pname.to_string(), pid.clone());
                    batch.push(Command::CreatePackage(pkg));
                    packages_created += 1;
                    pid
                }
            }
            None => project.root_package_id.clone(),
        };

        if let Some(id) = new_clf_ids.get(&pc.name).cloned() {
            let kind = parse_classifier_kind(&pc.kind);
            let mut clf = Classifier::new(&pc.name, pkg_id, kind);
            clf.meta.id = id;
            clf.meta.comment = pc.comment.clone();
            clf.is_abstract = pc.is_abstract || kind == ClassifierKind::Interface;
            clf.literals = pc
                .literals
                .iter()
                .map(|l| EnumLiteral {
                    name: l.clone(),
                    value: None,
                    comment: String::new(),
                })
                .collect();

            for pp in &pc.properties {
                let mut prop = Property::new(&pp.name, resolve_type(&pp.type_name, &clf_map));
                prop.visibility = parse_visibility(&pp.visibility);
                if let Ok(m) = pp.multiplicity.parse::<Multiplicity>() {
                    prop.multiplicity = m;
                }
                clf.properties.push(prop);
            }

            for po in &pc.operations {
                let mut op = Operation::new(&po.name);
                op.visibility = parse_visibility(&po.visibility);
                op.is_abstract = po.is_abstract;
                op.is_static = po.is_static;
                op.return_type = po
                    .return_type
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .map(|t| resolve_type(t, &clf_map));
                op.params = po
                    .params
                    .iter()
                    .map(|p| Parameter::new(&p.name, resolve_type(&p.type_name, &clf_map)))
                    .collect();
                op.bodies = po.bodies.clone();
                clf.operations.push(op);
            }

            batch.push(Command::CreateClassifier(clf));
            classifiers_created += 1;
        } else if let Some(existing_id) = clf_map.get(&pc.name).cloned() {
            // Delta refactoring on an existing classifier: add new properties & operations.
            for pp in &pc.properties {
                let mut prop = Property::new(&pp.name, resolve_type(&pp.type_name, &clf_map));
                prop.visibility = parse_visibility(&pp.visibility);
                if let Ok(m) = pp.multiplicity.parse::<Multiplicity>() {
                    prop.multiplicity = m;
                }
                batch.push(Command::AddProperty {
                    classifier_id: existing_id.clone(),
                    property: prop,
                });
            }
            for po in &pc.operations {
                let mut op = Operation::new(&po.name);
                op.visibility = parse_visibility(&po.visibility);
                op.is_abstract = po.is_abstract;
                op.is_static = po.is_static;
                op.return_type = po
                    .return_type
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .map(|t| resolve_type(t, &clf_map));
                op.params = po
                    .params
                    .iter()
                    .map(|p| Parameter::new(&p.name, resolve_type(&p.type_name, &clf_map)))
                    .collect();
                op.bodies = po.bodies.clone();
                batch.push(Command::AddOperation {
                    classifier_id: existing_id.clone(),
                    operation: op,
                });
            }
        }
    }

    // 3. Relations
    for pr in &patch.relations {
        let Some(src_id) = clf_map.get(&pr.source).cloned() else {
            return Err(PatchApplyError::UnknownClassifier {
                source_name: pr.source.clone(),
                target_name: pr.target.clone(),
                missing: pr.source.clone(),
            });
        };
        let Some(tgt_id) = clf_map.get(&pr.target).cloned() else {
            return Err(PatchApplyError::UnknownClassifier {
                source_name: pr.source.clone(),
                target_name: pr.target.clone(),
                missing: pr.target.clone(),
            });
        };
        let mut rel = Relation::new(parse_relation_kind(&pr.kind), src_id, tgt_id);
        rel.target.role_name = pr.role_name.clone();
        if let Ok(m) = pr.multiplicity.parse::<Multiplicity>() {
            rel.target.multiplicity = m;
        }
        batch.push(Command::CreateRelation(rel));
        relations_created += 1;
    }

    // 4. Diagrams requested in patch (or auto-generate a Class diagram if classifiers were added)
    let mut diagrams_created = 0usize;
    if patch.diagrams.is_empty() && classifiers_created > 0 {
        let mut diag = Diagram::new(
            format!("{} Architecture", project.name),
            DiagramKind::Class,
            project.root_package_id.clone(),
        );
        diag.layout_mode = LayoutMode::AutoElk;
        diag.element_ids = new_clf_ids.values().cloned().collect();
        batch.push(Command::CreateDiagram(diag));
        diagrams_created += 1;
    } else {
        for pd in &patch.diagrams {
            let mut diag = Diagram::new(
                &pd.name,
                parse_diagram_kind(&pd.kind),
                project.root_package_id.clone(),
            );
            diag.layout_mode = LayoutMode::AutoElk;
            diag.element_ids = pd
                .elements
                .iter()
                .filter_map(|name| clf_map.get(name).cloned())
                .collect();
            batch.push(Command::CreateDiagram(diag));
            diagrams_created += 1;
        }
    }

    // Execute all structural commands as ONE atomic transaction!
    if !batch.is_empty() {
        history.execute(project, Command::Batch(batch))?;
    }

    // 5. Behavioral elements: Interactions (Sequence) & State Machines
    let mut interactions_created = 0usize;
    for pi in &patch.interactions {
        let pkg_id = pi
            .package
            .as_deref()
            .and_then(|p| pkg_map.get(p).cloned())
            .unwrap_or_else(|| project.root_package_id.clone());
        let mut ll_map: BTreeMap<String, ElementId> = BTreeMap::new();
        let lifelines: Vec<Lifeline> = pi
            .lifelines
            .iter()
            .map(|name| {
                let id = ElementId::new();
                ll_map.insert(name.clone(), id.clone());
                Lifeline {
                    id,
                    name: name.clone(),
                    represents_classifier_id: clf_map.get(name).cloned(),
                }
            })
            .collect();
        let messages: Vec<Message> = pi
            .messages
            .iter()
            .filter_map(|m| {
                let from_id = ll_map.get(&m.from)?.clone();
                let to_id = ll_map.get(&m.to)?.clone();
                Some(Message {
                    id: ElementId::new(),
                    name: m.label.clone(),
                    sort: parse_message_sort(&m.sort),
                    from_lifeline_id: from_id,
                    to_lifeline_id: to_id,
                    operation_id: None,
                    guard: None,
                })
            })
            .collect();
        let inter = Interaction {
            meta: ElementMeta::new(&pi.name),
            package_id: pkg_id.clone(),
            lifelines,
            messages,
            fragments: Vec::new(),
        };
        if let Some(pkg) = project.packages.get_mut(&pkg_id) {
            pkg.interactions.push(inter.meta.id.clone());
        }
        project.interactions.insert(inter.meta.id.clone(), inter);
        interactions_created += 1;
    }

    let mut state_machines_created = 0usize;
    for psm in &patch.state_machines {
        let pkg_id = psm
            .package
            .as_deref()
            .and_then(|p| pkg_map.get(p).cloned())
            .unwrap_or_else(|| project.root_package_id.clone());
        let mut st_map: BTreeMap<String, ElementId> = BTreeMap::new();
        let vertices: Vec<StateVertex> = psm
            .states
            .iter()
            .map(|name| {
                let id = ElementId::new();
                st_map.insert(name.clone(), id.clone());
                StateVertex::State {
                    id,
                    name: name.clone(),
                    entry: None,
                    do_activity: None,
                    exit: None,
                    sub_regions: Vec::new(),
                }
            })
            .collect();
        let transitions: Vec<Transition> = psm
            .transitions
            .iter()
            .filter_map(|t| {
                let src = st_map.get(&t.from)?.clone();
                let tgt = st_map.get(&t.to)?.clone();
                Some(Transition {
                    id: ElementId::new(),
                    source_id: src,
                    target_id: tgt,
                    trigger: t.trigger.clone(),
                    guard: t.guard.clone(),
                    effect: t.effect.clone(),
                })
            })
            .collect();
        let sm = StateMachine {
            meta: ElementMeta::new(&psm.name),
            package_id: pkg_id.clone(),
            context_classifier_id: None,
            regions: vec![Region {
                id: ElementId::new(),
                name: "main".to_string(),
                vertices,
                transitions,
            }],
        };
        if let Some(pkg) = project.packages.get_mut(&pkg_id) {
            pkg.state_machines.push(sm.meta.id.clone());
        }
        project.state_machines.insert(sm.meta.id.clone(), sm);
        state_machines_created += 1;
    }

    let diagnostics = validate_project(project);
    Ok(PatchApplyReport {
        summary: patch.summary.clone(),
        packages_created,
        classifiers_created,
        relations_created,
        interactions_created,
        state_machines_created,
        diagrams_created,
        diagnostics,
    })
}

fn resolve_type(name: &str, clf_map: &BTreeMap<String, ElementId>) -> TypeRef {
    if let Some(id) = clf_map.get(name.trim()) {
        TypeRef::Internal(id.clone())
    } else {
        TypeRef::External(name.trim().to_string())
    }
}

fn parse_classifier_kind(s: &str) -> ClassifierKind {
    match s.to_ascii_lowercase().as_str() {
        "interface" => ClassifierKind::Interface,
        "enum" | "enumeration" => ClassifierKind::Enumeration,
        "data_type" | "datatype" | "struct" => ClassifierKind::DataType,
        "actor" => ClassifierKind::Actor,
        "component" => ClassifierKind::Component,
        "use_case" | "usecase" => ClassifierKind::UseCase,
        _ => ClassifierKind::Class,
    }
}

fn parse_visibility(s: &str) -> Visibility {
    match s.to_ascii_lowercase().as_str() {
        "private" | "-" => Visibility::Private,
        "protected" | "#" => Visibility::Protected,
        "package" | "~" => Visibility::Package,
        _ => Visibility::Public,
    }
}

fn parse_relation_kind(s: &str) -> RelationKind {
    match s.to_ascii_lowercase().as_str() {
        "generalization" | "extends" | "inherits" => RelationKind::Generalization,
        "interface_realization" | "implements" | "realization" => {
            RelationKind::InterfaceRealization
        }
        "composition" => RelationKind::Composition,
        "aggregation" => RelationKind::Aggregation,
        "dependency" => RelationKind::Dependency,
        "include" => RelationKind::Include,
        "extend" => RelationKind::Extend,
        _ => RelationKind::Association,
    }
}

fn parse_diagram_kind(s: &str) -> DiagramKind {
    match s.to_ascii_lowercase().as_str() {
        "sequence" => DiagramKind::Sequence,
        "use_case" | "usecase" => DiagramKind::UseCase,
        "state_machine" | "state" => DiagramKind::StateMachine,
        "activity" => DiagramKind::Activity,
        "component" => DiagramKind::Component,
        "deployment" => DiagramKind::Deployment,
        _ => DiagramKind::Class,
    }
}

fn parse_message_sort(s: &str) -> MessageSort {
    match s.to_ascii_lowercase().as_str() {
        "async_call" | "async" => MessageSort::AsyncCall,
        "reply" | "return" => MessageSort::Reply,
        "create" => MessageSort::Create,
        "delete" => MessageSort::Delete,
        _ => MessageSort::SyncCall,
    }
}
