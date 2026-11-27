use bouml_core::{
    Classifier, ClassifierKind, Diagram, DiagramKind, ElementId, EnumLiteral, LayoutMode,
    Multiplicity, Operation, Package, Project, Property, Relation, RelationKind, TypeRef,
    Visibility,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Intermediate classifier extracted by any importer before merging into `Project`.
#[derive(Debug, Clone)]
pub struct ImportedClassifier {
    pub package_name: Option<String>,
    pub name: String,
    pub kind: ClassifierKind,
    pub is_abstract: bool,
    pub comment: String,
    pub properties: Vec<Property>,
    pub operations: Vec<Operation>,
    pub literals: Vec<EnumLiteral>,
}

impl ImportedClassifier {
    pub fn new(name: impl Into<String>, kind: ClassifierKind) -> Self {
        Self {
            package_name: None,
            name: name.into(),
            kind,
            is_abstract: matches!(kind, ClassifierKind::Interface),
            comment: String::new(),
            properties: Vec::new(),
            operations: Vec::new(),
            literals: Vec::new(),
        }
    }
}

/// Intermediate relation resolved by classifier name during merge.
#[derive(Debug, Clone)]
pub struct ImportedRelation {
    pub source_name: String,
    pub target_name: String,
    pub kind: RelationKind,
    pub role_name: Option<String>,
    pub target_multiplicity: Multiplicity,
    pub visibility: Visibility,
}

/// Normalized output of any importer (Tree-sitter, PlantUML, Mermaid, SQL, OpenAPI, JSON Schema, XMI).
#[derive(Debug, Default)]
pub struct ImportBundle {
    pub source_label: String,
    pub classifiers: Vec<ImportedClassifier>,
    pub relations: Vec<ImportedRelation>,
    pub warnings: Vec<String>,
}

/// Summary returned after merging an `ImportBundle` into a `Project` and auto-generating diagrams.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSummary {
    pub source_label: String,
    pub packages_added: usize,
    pub classifiers_added: usize,
    pub classifiers_updated: usize,
    pub relations_added: usize,
    pub diagrams_created: usize,
    pub warnings: Vec<String>,
}

/// Merges an `ImportBundle` into `project`, resolves cross-references (`TypeRef::Internal`),
/// and automatically creates clean `AutoElk` UML Class Diagrams per imported package.
pub fn merge_bundle_into_project(
    project: &mut Project,
    bundle: ImportBundle,
    custom_diagram_name: Option<&str>,
) -> ImportSummary {
    let mut packages_added = 0usize;
    let mut classifiers_added = 0usize;
    let mut classifiers_updated = 0usize;
    let mut relations_added = 0usize;
    let mut diagrams_created = 0usize;

    // Track classifiers grouped by package for automatic diagram generation.
    let mut imported_by_pkg: BTreeMap<ElementId, Vec<ElementId>> = BTreeMap::new();

    // 1. Merge classifiers (creating target packages as needed).
    for ic in bundle.classifiers {
        let pkg_id = match ic.package_name.as_deref().filter(|s| !s.is_empty()) {
            Some(pkg_name) => {
                if let Some(existing) = project.find_package_by_name(pkg_name) {
                    existing.meta.id.clone()
                } else {
                    let pkg = Package::new(pkg_name, Some(project.root_package_id.clone()));
                    let pid = pkg.meta.id.clone();
                    if let Some(root) = project.packages.get_mut(&project.root_package_id) {
                        root.subpackages.push(pid.clone());
                    }
                    project.packages.insert(pid.clone(), pkg);
                    packages_added += 1;
                    pid
                }
            }
            None => project.root_package_id.clone(),
        };

        // Check if classifier with same name already exists in this package.
        let existing_id = project
            .classifiers
            .values()
            .find(|c| c.package_id == pkg_id && c.meta.name == ic.name)
            .map(|c| c.meta.id.clone());

        let clf_id = if let Some(eid) = existing_id {
            if let Some(clf) = project.classifiers.get_mut(&eid) {
                clf.kind = ic.kind;
                clf.is_abstract = ic.is_abstract;
                if !ic.comment.is_empty() {
                    clf.meta.comment = ic.comment;
                }
                for prop in ic.properties {
                    if !clf.properties.iter().any(|p| p.meta.name == prop.meta.name) {
                        clf.properties.push(prop);
                    }
                }
                for op in ic.operations {
                    if !clf.operations.iter().any(|o| o.meta.name == op.meta.name) {
                        clf.operations.push(op);
                    }
                }
                for lit in ic.literals {
                    if !clf.literals.iter().any(|l| l.name == lit.name) {
                        clf.literals.push(lit);
                    }
                }
            }
            classifiers_updated += 1;
            eid
        } else {
            let mut clf = Classifier::new(ic.name, pkg_id.clone(), ic.kind);
            clf.is_abstract = ic.is_abstract;
            clf.meta.comment = ic.comment;
            clf.properties = ic.properties;
            clf.operations = ic.operations;
            clf.literals = ic.literals;
            let cid = clf.meta.id.clone();
            if let Some(pkg) = project.packages.get_mut(&pkg_id) {
                pkg.classifiers.push(cid.clone());
            }
            project.classifiers.insert(cid.clone(), clf);
            classifiers_added += 1;
            cid
        };

        imported_by_pkg.entry(pkg_id).or_default().push(clf_id);
    }

    // Build name -> ElementId lookup table for resolving relations & internal TypeRefs.
    let name_to_id: BTreeMap<String, ElementId> = project
        .classifiers
        .values()
        .map(|c| (c.meta.name.clone(), c.meta.id.clone()))
        .collect();

    // 2. Upgrade `TypeRef::External(name)` to `TypeRef::Internal(id)` when modeled.
    for clf in project.classifiers.values_mut() {
        for prop in &mut clf.properties {
            resolve_type_ref(&mut prop.type_ref, &name_to_id);
        }
        for op in &mut clf.operations {
            if let Some(ref mut rt) = op.return_type {
                resolve_type_ref(rt, &name_to_id);
            }
            for param in &mut op.params {
                resolve_type_ref(&mut param.type_ref, &name_to_id);
            }
        }
    }

    // 3. Merge relations (deduplicated by (kind, source, target, role)).
    let mut existing_rels: BTreeSet<(String, ElementId, ElementId)> = project
        .relations
        .values()
        .map(|r| {
            (
                format!("{:?}", r.kind),
                r.source.classifier_id.clone(),
                r.target.classifier_id.clone(),
            )
        })
        .collect();

    for irel in bundle.relations {
        let Some(src_id) = name_to_id.get(&irel.source_name).cloned() else {
            continue;
        };
        let Some(tgt_id) = name_to_id.get(&irel.target_name).cloned() else {
            continue;
        };
        let key = (format!("{:?}", irel.kind), src_id.clone(), tgt_id.clone());
        if !existing_rels.insert(key) {
            continue;
        }
        let mut rel = Relation::new(irel.kind, src_id, tgt_id);
        rel.source.visibility = irel.visibility;
        rel.target.role_name = irel.role_name;
        rel.target.multiplicity = irel.target_multiplicity;
        project.relations.insert(rel.meta.id.clone(), rel);
        relations_added += 1;
    }

    // 4. Auto-generate clean AutoElk UML Class Diagrams per imported package.
    for (pkg_id, mut elem_ids) in imported_by_pkg {
        elem_ids.sort();
        elem_ids.dedup();
        if elem_ids.is_empty() {
            continue;
        }
        let pkg_name = project
            .packages
            .get(&pkg_id)
            .map(|p| p.meta.name.clone())
            .unwrap_or_else(|| "Imported".to_string());
        let diag_name = match custom_diagram_name {
            Some(custom) => custom.to_string(),
            None => format!("{pkg_name} Class Diagram"),
        };
        let mut diag = Diagram::new(diag_name, DiagramKind::Class, pkg_id);
        diag.layout_mode = LayoutMode::AutoElk;
        diag.element_ids = elem_ids;
        project.diagrams.insert(diag.id.clone(), diag);
        diagrams_created += 1;
    }

    ImportSummary {
        source_label: bundle.source_label,
        packages_added,
        classifiers_added,
        classifiers_updated,
        relations_added,
        diagrams_created,
        warnings: bundle.warnings,
    }
}

fn resolve_type_ref(tr: &mut TypeRef, name_to_id: &BTreeMap<String, ElementId>) {
    if let TypeRef::External(name) = tr {
        let cleaned = name.trim().trim_end_matches("[]").trim_start_matches('&');
        if let Some(id) = name_to_id.get(cleaned) {
            *tr = TypeRef::Internal(id.clone());
        }
    }
}
