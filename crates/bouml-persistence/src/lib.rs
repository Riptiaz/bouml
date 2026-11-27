pub mod legacy_prj;
pub mod yaml_store;

pub use legacy_prj::{import_legacy_prj, LegacyImportError, LegacyImportReport};
pub use yaml_store::{load_project, save_project, PersistenceError};

#[cfg(test)]
mod tests {
    use super::*;
    use bouml_core::{
        Classifier, ClassifierKind, Command, CommandHistory, Diagram, DiagramKind, Operation,
        Package, Project, Property, Relation, RelationKind, TypeRef,
    };
    use std::path::Path;
    use tempfile::TempDir;

    #[test]
    fn yaml_roundtrip_is_lossless_and_deterministic() {
        let mut project = Project::new("ECommerce");
        let root_id = project.root_package_id.clone();
        let mut history = CommandHistory::new();

        let billing = Package::new("billing", Some(root_id.clone()));
        let billing_id = billing.meta.id.clone();

        let mut processor =
            Classifier::new("PaymentProcessor", billing_id.clone(), ClassifierKind::Class);
        processor
            .properties
            .push(Property::new("currency", TypeRef::external("String")));
        let mut charge = Operation::new("charge");
        charge
            .bodies
            .insert("rust".to_string(), "Ok(Receipt::default())".to_string());
        processor.operations.push(charge);

        let gateway = Classifier::new("PaymentGateway", billing_id.clone(), ClassifierKind::Interface);
        let rel = Relation::new(
            RelationKind::Dependency,
            processor.meta.id.clone(),
            gateway.meta.id.clone(),
        );

        let mut diag = Diagram::new("Billing Overview", DiagramKind::Class, billing_id);
        diag.element_ids.push(processor.meta.id.clone());
        diag.element_ids.push(gateway.meta.id.clone());

        history
            .execute(
                &mut project,
                Command::Batch(vec![
                    Command::CreatePackage(billing),
                    Command::CreateClassifier(processor),
                    Command::CreateClassifier(gateway),
                    Command::CreateRelation(rel),
                    Command::CreateDiagram(diag),
                ]),
            )
            .unwrap();

        let tmp = TempDir::new().unwrap();
        let out_dir = tmp.path().join("ecommerce.bouml");
        save_project(&project, &out_dir).unwrap();

        // Verify expected Git-friendly multi-file structure exists.
        assert!(out_dir.join("project.yaml").exists());
        assert!(out_dir.join("model/billing/payment_processor.yaml").exists());
        assert!(out_dir.join("model/billing/payment_gateway.yaml").exists());
        assert!(out_dir.join("model/billing/relations.yaml").exists());
        assert!(out_dir.join("diagrams/billing_overview.diagram.yaml").exists());

        let reloaded = load_project(&out_dir).unwrap();
        assert_eq!(project, reloaded);
    }

    #[test]
    fn imports_real_legacy_singleton_prj() {
        let prj = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../legacy/plugouts/singleton/singleton.prj");
        assert!(prj.exists(), "expected legacy fixture at {}", prj.display());

        let report = import_legacy_prj(&prj).unwrap();
        assert_eq!(report.project.name, "singleton");
        assert_eq!(report.format_version, 26);
        assert!(report.imported_packages >= 3);
        assert!(report.imported_classifiers >= 50);
        assert!(report.imported_operations >= 100);
        assert!(report.imported_bodies > 0);
        assert!(report.imported_relations > 20);
        assert!(report.imported_diagrams >= 3);

        // Ensure imported project saves and reloads cleanly in the new YAML format!
        let tmp = TempDir::new().unwrap();
        let out = tmp.path().join("singleton.bouml");
        save_project(&report.project, &out).unwrap();
        let reloaded = load_project(&out).unwrap();
        assert_eq!(report.project, reloaded);
    }
}
