pub mod commands;
pub mod diagram;
pub mod id;
pub mod model;
pub mod project;
pub mod validator;

pub use commands::{Command, CommandError, CommandHistory};
pub use diagram::{Diagram, DiagramEdgeOverride, DiagramKind, DiagramNodeOverride, LayoutMode};
pub use id::ElementId;
pub use model::*;
pub use project::{Project, ProjectStats, SCHEMA_VERSION};
pub use validator::{validate_project, Diagnostic, Severity};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transactional_batch_undo_redo() {
        let mut project = Project::new("Billing");
        let root_id = project.root_package_id.clone();
        let mut history = CommandHistory::new();

        let processor = Classifier::new("PaymentProcessor", root_id.clone(), ClassifierKind::Class);
        let strategy = Classifier::new("PaymentStrategy", root_id, ClassifierKind::Interface);
        let rel = Relation::new(
            RelationKind::Dependency,
            processor.meta.id.clone(),
            strategy.meta.id.clone(),
        );

        let batch = Command::Batch(vec![
            Command::CreateClassifier(processor.clone()),
            Command::CreateClassifier(strategy.clone()),
            Command::CreateRelation(rel),
        ]);

        history.execute(&mut project, batch).unwrap();
        assert_eq!(project.classifiers.len(), 2);
        assert_eq!(project.relations.len(), 1);
        assert!(validate_project(&project).is_empty());

        history.undo(&mut project).unwrap();
        assert_eq!(project.classifiers.len(), 0);
        assert_eq!(project.relations.len(), 0);

        history.redo(&mut project).unwrap();
        assert_eq!(project.classifiers.len(), 2);
        assert_eq!(project.relations.len(), 1);
    }

    #[test]
    fn validator_detects_circular_inheritance() {
        let mut project = Project::new("CycleTest");
        let root_id = project.root_package_id.clone();
        let mut history = CommandHistory::new();

        let a = Classifier::new("A", root_id.clone(), ClassifierKind::Class);
        let b = Classifier::new("B", root_id, ClassifierKind::Class);
        let r1 = Relation::new(
            RelationKind::Generalization,
            a.meta.id.clone(),
            b.meta.id.clone(),
        );
        let r2 = Relation::new(
            RelationKind::Generalization,
            b.meta.id.clone(),
            a.meta.id.clone(),
        );

        history
            .execute(
                &mut project,
                Command::Batch(vec![
                    Command::CreateClassifier(a),
                    Command::CreateClassifier(b),
                    Command::CreateRelation(r1),
                    Command::CreateRelation(r2),
                ]),
            )
            .unwrap();

        let diags = validate_project(&project);
        assert!(diags
            .iter()
            .any(|d| d.code == "UML009" && d.severity == Severity::Error));
    }

    #[test]
    fn multiplicity_roundtrip_parsing() {
        assert_eq!("1".parse::<Multiplicity>().unwrap().to_string(), "1");
        assert_eq!("0..1".parse::<Multiplicity>().unwrap().to_string(), "0..1");
        assert_eq!("*".parse::<Multiplicity>().unwrap().to_string(), "0..*");
        assert_eq!("1..*".parse::<Multiplicity>().unwrap().to_string(), "1..*");
        assert!("5..2".parse::<Multiplicity>().is_err());
    }
}
