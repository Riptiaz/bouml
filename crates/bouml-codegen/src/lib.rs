pub mod engine;
pub mod languages;
pub mod macros;
pub mod preserved_bodies;
pub mod type_mapper;

pub use engine::{
    generate_project, preview_classifier, roundtrip_bodies_from_dir, CodegenError, GenerateOptions,
    GenerationReport, RoundtripReport,
};
pub use languages::{GeneratedFile, TargetLanguage};
pub use macros::{format_doc_comment, CommentStyle, TemplateContext};
pub use preserved_bodies::{render_operation_body, scan_preserved_bodies, PreservedBodyError};
pub use type_mapper::map_type;

#[cfg(test)]
mod tests {
    use super::*;
    use bouml_core::{
        Classifier, ClassifierKind, Command, CommandHistory, Multiplicity, Operation, Package,
        Parameter, Project, Property, Relation, RelationKind, TypeRef,
    };
    use std::fs;
    use tempfile::TempDir;

    fn sample_project() -> (Project, bouml_core::ElementId) {
        let mut project = Project::new("Shop");
        let root_id = project.root_package_id.clone();
        let mut history = CommandHistory::new();

        let billing = Package::new("billing", Some(root_id));
        let billing_id = billing.meta.id.clone();

        let mut gateway = Classifier::new("PaymentGateway", billing_id.clone(), ClassifierKind::Interface);
        let mut pay_iface = Operation::new("pay");
        pay_iface
            .params
            .push(Parameter::new("amount", TypeRef::external("f64")));
        pay_iface.return_type = Some(TypeRef::external("bool"));
        gateway.operations.push(pay_iface);

        let mut processor =
            Classifier::new("PaymentProcessor", billing_id, ClassifierKind::Class);
        processor.meta.comment = "Processes customer payments.".to_string();
        let mut currency = Property::new("currency", TypeRef::external("string"));
        currency.multiplicity = Multiplicity::exactly_one();
        processor.properties.push(currency);

        let mut charge = Operation::new("charge");
        charge
            .params
            .push(Parameter::new("amount", TypeRef::external("f64")));
        charge.return_type = Some(TypeRef::external("bool"));
        charge.bodies.insert(
            "rust".to_string(),
            "amount > 0.0".to_string(),
        );
        let op_id = charge.meta.id.clone();
        processor.operations.push(charge);

        let rel = Relation::new(
            RelationKind::Association,
            processor.meta.id.clone(),
            gateway.meta.id.clone(),
        );

        history
            .execute(
                &mut project,
                Command::Batch(vec![
                    Command::CreatePackage(billing),
                    Command::CreateClassifier(gateway),
                    Command::CreateClassifier(processor),
                    Command::CreateRelation(rel),
                ]),
            )
            .unwrap();

        (project, op_id)
    }

    #[test]
    fn macro_expansion_supports_bouml_vars_and_aliases() {
        let mut ctx = TemplateContext::new();
        ctx.set_name_variants("paymentProcessor")
            .set("type", "bool")
            .set_alias("author", "BouML");

        let rendered = ctx.expand("// @{author}\nclass ${Name} (${NAME}): ${type} ${name}");
        assert_eq!(
            rendered,
            "// BouML\nclass PaymentProcessor (PAYMENTPROCESSOR): bool paymentProcessor"
        );
    }

    #[test]
    fn generates_all_eight_languages_cleanly() {
        let (project, _) = sample_project();
        let tmp = TempDir::new().unwrap();

        for lang in [
            TargetLanguage::Cpp,
            TargetLanguage::Java,
            TargetLanguage::Python,
            TargetLanguage::TypeScript,
            TargetLanguage::Php,
            TargetLanguage::Rust,
            TargetLanguage::Go,
            TargetLanguage::Sql,
        ] {
            let out_dir = tmp.path().join(lang.key());
            let opts = GenerateOptions {
                language: lang,
                output_dir: out_dir.clone(),
                preserve_bodies: true,
                dry_run: false,
            };
            let report = generate_project(&project, &opts).unwrap();
            assert!(report.files_written > 0, "expected files for {lang}");

            // Second run with unchanged model must write 0 files (must_be_saved).
            let second = generate_project(&project, &opts).unwrap();
            assert_eq!(second.files_written, 0, "second run should not rewrite {lang}");
            assert_eq!(second.files_unchanged, report.files_written);
        }
    }

    #[test]
    fn roundtrip_preserves_and_syncs_developer_edited_body() {
        let (mut project, op_id) = sample_project();
        let tmp = TempDir::new().unwrap();
        let out_dir = tmp.path().join("rust_src");

        let opts = GenerateOptions {
            language: TargetLanguage::Rust,
            output_dir: out_dir.clone(),
            preserve_bodies: true,
            dry_run: false,
        };
        generate_project(&project, &opts).unwrap();

        // Simulate developer editing the method body on disk inside preserved-body markers.
        let rs_file = out_dir.join("billing/payment_processor.rs");
        let original = fs::read_to_string(&rs_file).unwrap();
        let edited = original.replace("amount > 0.0", "let ok = amount > 0.0;\n        ok");
        fs::write(&rs_file, edited).unwrap();

        // Regenerate: preserved body from disk must survive untouched!
        let regen = generate_project(&project, &opts).unwrap();
        assert_eq!(regen.preserved_bodies_reused, 1);
        let after_regen = fs::read_to_string(&rs_file).unwrap();
        assert!(after_regen.contains("let ok = amount > 0.0;"));

        // Roundtrip back into the UML model!
        let rt = roundtrip_bodies_from_dir(&mut project, &out_dir, TargetLanguage::Rust).unwrap();
        assert_eq!(rt.bodies_updated, 1);

        let proc_clf = project.find_classifier_by_name("PaymentProcessor").unwrap();
        let op = proc_clf
            .operations
            .iter()
            .find(|o| o.meta.id == op_id)
            .unwrap();
        assert_eq!(
            op.bodies.get("rust").map(|s| s.as_str()),
            Some("let ok = amount > 0.0;\nok")
        );
    }
}
