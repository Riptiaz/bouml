use crate::id::ElementId;
use crate::model::{ClassifierKind, RelationKind, TypeRef};
use crate::project::Project;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub code: String,
    pub severity: Severity,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element_id: Option<ElementId>,
}

/// Validates a UML 2.5 `Project` for structural integrity, UML compliance, and SOLID heuristics.
pub fn validate_project(project: &Project) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    // 1. Root package must exist.
    if !project.packages.contains_key(&project.root_package_id) {
        diagnostics.push(Diagnostic {
            code: "UML001".to_string(),
            severity: Severity::Error,
            message: format!("Root package '{}' does not exist", project.root_package_id),
            element_id: Some(project.root_package_id.clone()),
        });
    }

    // 2. Check package references and duplicate classifier names within a package.
    for (pkg_id, pkg) in &project.packages {
        let mut seen_names: BTreeSet<&str> = BTreeSet::new();
        for clf_id in &pkg.classifiers {
            match project.classifiers.get(clf_id) {
                None => diagnostics.push(Diagnostic {
                    code: "UML002".to_string(),
                    severity: Severity::Error,
                    message: format!(
                        "Package '{}' references missing classifier '{}'",
                        pkg.meta.name, clf_id
                    ),
                    element_id: Some(pkg_id.clone()),
                }),
                Some(clf) => {
                    if !seen_names.insert(clf.meta.name.as_str()) {
                        diagnostics.push(Diagnostic {
                            code: "UML003".to_string(),
                            severity: Severity::Warning,
                            message: format!(
                                "Duplicate classifier name '{}' in package '{}'",
                                clf.meta.name, pkg.meta.name
                            ),
                            element_id: Some(clf.meta.id.clone()),
                        });
                    }
                }
            }
        }
    }

    // 3. Validate classifiers, internal type refs, multiplicity bounds, and SOLID heuristics.
    for (clf_id, clf) in &project.classifiers {
        if !project.packages.contains_key(&clf.package_id) {
            diagnostics.push(Diagnostic {
                code: "UML004".to_string(),
                severity: Severity::Error,
                message: format!(
                    "Classifier '{}' belongs to missing package '{}'",
                    clf.meta.name, clf.package_id
                ),
                element_id: Some(clf_id.clone()),
            });
        }

        for prop in &clf.properties {
            if !prop.multiplicity.is_valid() {
                diagnostics.push(Diagnostic {
                    code: "UML005".to_string(),
                    severity: Severity::Error,
                    message: format!(
                        "Invalid multiplicity '{}' on property '{}.{}'",
                        prop.multiplicity, clf.meta.name, prop.meta.name
                    ),
                    element_id: Some(prop.meta.id.clone()),
                });
            }
            if let TypeRef::Internal(target_id) = &prop.type_ref {
                if !project.classifiers.contains_key(target_id) {
                    diagnostics.push(Diagnostic {
                        code: "UML006".to_string(),
                        severity: Severity::Error,
                        message: format!(
                            "Property '{}.{}' references missing internal type '{}'",
                            clf.meta.name, prop.meta.name, target_id
                        ),
                        element_id: Some(prop.meta.id.clone()),
                    });
                }
            }
        }

        for op in &clf.operations {
            if let Some(TypeRef::Internal(ret_id)) = &op.return_type {
                if !project.classifiers.contains_key(ret_id) {
                    diagnostics.push(Diagnostic {
                        code: "UML006".to_string(),
                        severity: Severity::Error,
                        message: format!(
                            "Operation '{}.{}' return type references missing classifier '{}'",
                            clf.meta.name, op.meta.name, ret_id
                        ),
                        element_id: Some(op.meta.id.clone()),
                    });
                }
            }
            for param in &op.params {
                if let TypeRef::Internal(p_id) = &param.type_ref {
                    if !project.classifiers.contains_key(p_id) {
                        diagnostics.push(Diagnostic {
                            code: "UML006".to_string(),
                            severity: Severity::Error,
                            message: format!(
                                "Parameter '{}' of '{}.{}' references missing classifier '{}'",
                                param.name, clf.meta.name, op.meta.name, p_id
                            ),
                            element_id: Some(op.meta.id.clone()),
                        });
                    }
                }
            }
        }

        // SOLID heuristic: God Class warning.
        if clf.kind == ClassifierKind::Class
            && (clf.properties.len() > 20 || clf.operations.len() > 25)
        {
            diagnostics.push(Diagnostic {
                code: "SOLID001".to_string(),
                severity: Severity::Warning,
                message: format!(
                    "Class '{}' has {} properties and {} operations (potential SRP violation)",
                    clf.meta.name,
                    clf.properties.len(),
                    clf.operations.len()
                ),
                element_id: Some(clf_id.clone()),
            });
        }

        // UML rule: Interface should not carry non-static mutable state properties.
        if clf.kind == ClassifierKind::Interface
            && clf
                .properties
                .iter()
                .any(|p| !p.is_static && !p.is_readonly)
        {
            diagnostics.push(Diagnostic {
                code: "UML007".to_string(),
                severity: Severity::Warning,
                message: format!(
                    "Interface '{}' declares mutable instance properties",
                    clf.meta.name
                ),
                element_id: Some(clf_id.clone()),
            });
        }
    }

    // 4. Validate relations & detect circular inheritance.
    let mut inheritance_adj: BTreeMap<&ElementId, Vec<&ElementId>> = BTreeMap::new();
    for (rel_id, rel) in &project.relations {
        let src_ok = project.classifiers.contains_key(&rel.source.classifier_id);
        let tgt_ok = project.classifiers.contains_key(&rel.target.classifier_id);
        if !src_ok || !tgt_ok {
            diagnostics.push(Diagnostic {
                code: "UML008".to_string(),
                severity: Severity::Error,
                message: format!(
                    "Relation '{}' connects missing classifier(s) ({} -> {})",
                    rel_id, rel.source.classifier_id, rel.target.classifier_id
                ),
                element_id: Some(rel_id.clone()),
            });
            continue;
        }
        if matches!(
            rel.kind,
            RelationKind::Generalization | RelationKind::InterfaceRealization
        ) {
            if rel.source.classifier_id == rel.target.classifier_id {
                diagnostics.push(Diagnostic {
                    code: "UML009".to_string(),
                    severity: Severity::Error,
                    message: format!(
                        "Classifier '{}' cannot inherit from itself",
                        rel.source.classifier_id
                    ),
                    element_id: Some(rel_id.clone()),
                });
            } else {
                inheritance_adj
                    .entry(&rel.source.classifier_id)
                    .or_default()
                    .push(&rel.target.classifier_id);
            }
        }
    }

    detect_cycles(&inheritance_adj, project, &mut diagnostics);

    // 5. Validate diagram element references.
    for (diag_id, diag) in &project.diagrams {
        for elem_id in &diag.element_ids {
            let exists = project.classifiers.contains_key(elem_id)
                || project.packages.contains_key(elem_id)
                || project.interactions.contains_key(elem_id)
                || project.state_machines.contains_key(elem_id)
                || project.activities.contains_key(elem_id);
            if !exists {
                diagnostics.push(Diagnostic {
                    code: "UML010".to_string(),
                    severity: Severity::Warning,
                    message: format!(
                        "Diagram '{}' references missing element '{}'",
                        diag.name, elem_id
                    ),
                    element_id: Some(diag_id.clone()),
                });
            }
        }
    }

    diagnostics
}

fn detect_cycles<'a>(
    adj: &BTreeMap<&'a ElementId, Vec<&'a ElementId>>,
    project: &Project,
    diagnostics: &mut Vec<Diagnostic>,
) {
    // 0 = unvisited, 1 = visiting, 2 = visited
    let mut state: BTreeMap<&ElementId, u8> = BTreeMap::new();
    let mut reported: BTreeSet<&ElementId> = BTreeSet::new();

    for &node in adj.keys() {
        if state.get(node).copied().unwrap_or(0) == 0 {
            dfs_cycle(node, adj, &mut state, &mut reported, project, diagnostics);
        }
    }
}

fn dfs_cycle<'a>(
    node: &'a ElementId,
    adj: &BTreeMap<&'a ElementId, Vec<&'a ElementId>>,
    state: &mut BTreeMap<&'a ElementId, u8>,
    reported: &mut BTreeSet<&'a ElementId>,
    project: &Project,
    diagnostics: &mut Vec<Diagnostic>,
) {
    state.insert(node, 1);
    if let Some(neighbors) = adj.get(node) {
        for &next in neighbors {
            match state.get(next).copied().unwrap_or(0) {
                1 => {
                    if reported.insert(next) {
                        let name = project
                            .classifiers
                            .get(next)
                            .map(|c| c.meta.name.as_str())
                            .unwrap_or(next.as_str());
                        diagnostics.push(Diagnostic {
                            code: "UML009".to_string(),
                            severity: Severity::Error,
                            message: format!("Circular inheritance detected involving '{name}'"),
                            element_id: Some(next.clone()),
                        });
                    }
                }
                0 => dfs_cycle(next, adj, state, reported, project, diagnostics),
                _ => {}
            }
        }
    }
    state.insert(node, 2);
}
