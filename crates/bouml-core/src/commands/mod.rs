use crate::diagram::Diagram;
use crate::id::ElementId;
use crate::model::{Classifier, Operation, Package, Property, Relation};
use crate::project::Project;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("package not found: {0}")]
    PackageNotFound(ElementId),
    #[error("classifier not found: {0}")]
    ClassifierNotFound(ElementId),
    #[error("relation not found: {0}")]
    RelationNotFound(ElementId),
    #[error("element already exists: {0}")]
    DuplicateId(ElementId),
    #[error("nothing to undo")]
    NothingToUndo,
    #[error("nothing to redo")]
    NothingToRedo,
}

/// Transactional mutations applied to a `Project`.
/// All UI edits, JSON-RPC plug-out calls, and AI patches flow through `Command`
/// to guarantee referential integrity and atomic Undo/Redo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Command {
    CreatePackage(Package),
    CreateClassifier(Classifier),
    DeleteClassifier {
        classifier_id: ElementId,
    },
    AddProperty {
        classifier_id: ElementId,
        property: Property,
    },
    AddOperation {
        classifier_id: ElementId,
        operation: Operation,
    },
    CreateRelation(Relation),
    DeleteRelation {
        relation_id: ElementId,
    },
    CreateDiagram(Diagram),
    /// Executes multiple commands as a single atomic transaction (all-or-nothing).
    Batch(Vec<Command>),
}

/// Inverse record stored on the undo stack.
#[derive(Debug, Clone)]
enum UndoEntry {
    RemovePackage {
        package_id: ElementId,
        parent_id: Option<ElementId>,
    },
    RemoveClassifier {
        classifier_id: ElementId,
        package_id: ElementId,
    },
    RestoreClassifier {
        classifier: Classifier,
        detached_relations: Vec<Relation>,
    },
    RemoveProperty {
        classifier_id: ElementId,
        property_id: ElementId,
    },
    RemoveOperation {
        classifier_id: ElementId,
        operation_id: ElementId,
    },
    RemoveRelation {
        relation_id: ElementId,
    },
    RestoreRelation {
        relation: Relation,
    },
    RemoveDiagram {
        diagram_id: ElementId,
    },
    Batch(Vec<UndoEntry>),
}

/// Manages transactional execution, Undo, and Redo over a `Project`.
#[derive(Debug, Default)]
pub struct CommandHistory {
    undo_stack: Vec<(Command, UndoEntry)>,
    redo_stack: Vec<Command>,
}

impl CommandHistory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn execute(&mut self, project: &mut Project, cmd: Command) -> Result<(), CommandError> {
        let undo = apply_command(project, &cmd)?;
        self.undo_stack.push((cmd, undo));
        self.redo_stack.clear();
        Ok(())
    }

    pub fn undo(&mut self, project: &mut Project) -> Result<(), CommandError> {
        let (cmd, undo_entry) = self.undo_stack.pop().ok_or(CommandError::NothingToUndo)?;
        apply_undo(project, undo_entry);
        self.redo_stack.push(cmd);
        Ok(())
    }

    pub fn redo(&mut self, project: &mut Project) -> Result<(), CommandError> {
        let cmd = self.redo_stack.pop().ok_or(CommandError::NothingToRedo)?;
        let undo = apply_command(project, &cmd)?;
        self.undo_stack.push((cmd, undo));
        Ok(())
    }
}

fn apply_command(project: &mut Project, cmd: &Command) -> Result<UndoEntry, CommandError> {
    match cmd {
        Command::CreatePackage(pkg) => {
            if project.packages.contains_key(&pkg.meta.id) {
                return Err(CommandError::DuplicateId(pkg.meta.id.clone()));
            }
            if let Some(parent_id) = &pkg.parent_id {
                let parent = project
                    .packages
                    .get_mut(parent_id)
                    .ok_or_else(|| CommandError::PackageNotFound(parent_id.clone()))?;
                parent.subpackages.push(pkg.meta.id.clone());
            }
            project.packages.insert(pkg.meta.id.clone(), pkg.clone());
            Ok(UndoEntry::RemovePackage {
                package_id: pkg.meta.id.clone(),
                parent_id: pkg.parent_id.clone(),
            })
        }
        Command::CreateClassifier(clf) => {
            if project.classifiers.contains_key(&clf.meta.id) {
                return Err(CommandError::DuplicateId(clf.meta.id.clone()));
            }
            let pkg = project
                .packages
                .get_mut(&clf.package_id)
                .ok_or_else(|| CommandError::PackageNotFound(clf.package_id.clone()))?;
            pkg.classifiers.push(clf.meta.id.clone());
            project.classifiers.insert(clf.meta.id.clone(), clf.clone());
            Ok(UndoEntry::RemoveClassifier {
                classifier_id: clf.meta.id.clone(),
                package_id: clf.package_id.clone(),
            })
        }
        Command::DeleteClassifier { classifier_id } => {
            let clf = project
                .classifiers
                .remove(classifier_id)
                .ok_or_else(|| CommandError::ClassifierNotFound(classifier_id.clone()))?;
            if let Some(pkg) = project.packages.get_mut(&clf.package_id) {
                pkg.classifiers.retain(|id| id != classifier_id);
            }
            // Cascade-remove relations referencing this classifier so the model stays consistent.
            let rel_ids: Vec<ElementId> = project
                .relations
                .iter()
                .filter(|(_, r)| {
                    &r.source.classifier_id == classifier_id
                        || &r.target.classifier_id == classifier_id
                })
                .map(|(id, _)| id.clone())
                .collect();
            let mut detached_relations = Vec::with_capacity(rel_ids.len());
            for id in rel_ids {
                if let Some(rel) = project.relations.remove(&id) {
                    detached_relations.push(rel);
                }
            }
            Ok(UndoEntry::RestoreClassifier {
                classifier: clf,
                detached_relations,
            })
        }
        Command::AddProperty {
            classifier_id,
            property,
        } => {
            let clf = project
                .classifiers
                .get_mut(classifier_id)
                .ok_or_else(|| CommandError::ClassifierNotFound(classifier_id.clone()))?;
            clf.properties.push(property.clone());
            Ok(UndoEntry::RemoveProperty {
                classifier_id: classifier_id.clone(),
                property_id: property.meta.id.clone(),
            })
        }
        Command::AddOperation {
            classifier_id,
            operation,
        } => {
            let clf = project
                .classifiers
                .get_mut(classifier_id)
                .ok_or_else(|| CommandError::ClassifierNotFound(classifier_id.clone()))?;
            clf.operations.push(operation.clone());
            Ok(UndoEntry::RemoveOperation {
                classifier_id: classifier_id.clone(),
                operation_id: operation.meta.id.clone(),
            })
        }
        Command::CreateRelation(rel) => {
            if project.relations.contains_key(&rel.meta.id) {
                return Err(CommandError::DuplicateId(rel.meta.id.clone()));
            }
            if !project.classifiers.contains_key(&rel.source.classifier_id) {
                return Err(CommandError::ClassifierNotFound(
                    rel.source.classifier_id.clone(),
                ));
            }
            if !project.classifiers.contains_key(&rel.target.classifier_id) {
                return Err(CommandError::ClassifierNotFound(
                    rel.target.classifier_id.clone(),
                ));
            }
            project.relations.insert(rel.meta.id.clone(), rel.clone());
            Ok(UndoEntry::RemoveRelation {
                relation_id: rel.meta.id.clone(),
            })
        }
        Command::DeleteRelation { relation_id } => {
            let rel = project
                .relations
                .remove(relation_id)
                .ok_or_else(|| CommandError::RelationNotFound(relation_id.clone()))?;
            Ok(UndoEntry::RestoreRelation { relation: rel })
        }
        Command::CreateDiagram(diagram) => {
            if project.diagrams.contains_key(&diagram.id) {
                return Err(CommandError::DuplicateId(diagram.id.clone()));
            }
            if !project.packages.contains_key(&diagram.package_id) {
                return Err(CommandError::PackageNotFound(diagram.package_id.clone()));
            }
            project.diagrams.insert(diagram.id.clone(), diagram.clone());
            Ok(UndoEntry::RemoveDiagram {
                diagram_id: diagram.id.clone(),
            })
        }
        Command::Batch(cmds) => {
            let mut applied = Vec::with_capacity(cmds.len());
            for sub in cmds {
                match apply_command(project, sub) {
                    Ok(undo) => applied.push(undo),
                    Err(err) => {
                        // Rollback already-applied commands in reverse order.
                        for undo in applied.into_iter().rev() {
                            apply_undo(project, undo);
                        }
                        return Err(err);
                    }
                }
            }
            Ok(UndoEntry::Batch(applied))
        }
    }
}

fn apply_undo(project: &mut Project, entry: UndoEntry) {
    match entry {
        UndoEntry::RemovePackage {
            package_id,
            parent_id,
        } => {
            project.packages.remove(&package_id);
            if let Some(pid) = parent_id {
                if let Some(parent) = project.packages.get_mut(&pid) {
                    parent.subpackages.retain(|id| id != &package_id);
                }
            }
        }
        UndoEntry::RemoveClassifier {
            classifier_id,
            package_id,
        } => {
            project.classifiers.remove(&classifier_id);
            if let Some(pkg) = project.packages.get_mut(&package_id) {
                pkg.classifiers.retain(|id| id != &classifier_id);
            }
        }
        UndoEntry::RestoreClassifier {
            classifier,
            detached_relations,
        } => {
            let pkg_id = classifier.package_id.clone();
            let clf_id = classifier.meta.id.clone();
            project.classifiers.insert(clf_id.clone(), classifier);
            if let Some(pkg) = project.packages.get_mut(&pkg_id) {
                pkg.classifiers.push(clf_id);
            }
            for rel in detached_relations {
                project.relations.insert(rel.meta.id.clone(), rel);
            }
        }
        UndoEntry::RemoveProperty {
            classifier_id,
            property_id,
        } => {
            if let Some(clf) = project.classifiers.get_mut(&classifier_id) {
                clf.properties.retain(|p| p.meta.id != property_id);
            }
        }
        UndoEntry::RemoveOperation {
            classifier_id,
            operation_id,
        } => {
            if let Some(clf) = project.classifiers.get_mut(&classifier_id) {
                clf.operations.retain(|o| o.meta.id != operation_id);
            }
        }
        UndoEntry::RemoveRelation { relation_id } => {
            project.relations.remove(&relation_id);
        }
        UndoEntry::RestoreRelation { relation } => {
            project.relations.insert(relation.meta.id.clone(), relation);
        }
        UndoEntry::RemoveDiagram { diagram_id } => {
            project.diagrams.remove(&diagram_id);
        }
        UndoEntry::Batch(entries) => {
            for sub in entries.into_iter().rev() {
                apply_undo(project, sub);
            }
        }
    }
}
