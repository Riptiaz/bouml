pub mod patch_applier;
pub mod pipeline;
pub mod providers;
pub mod schema;

pub use patch_applier::{apply_uml_patch, PatchApplyError, PatchApplyReport};
pub use pipeline::{refactor_with_instruction, summarize_project_for_ai, text_to_uml, PipelineError};
pub use providers::{AiProviderConfig, HttpLlmClient, LlmClient, ProviderError};
pub use schema::{uml_graph_patch_json_schema, UmlGraphPatch};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{
        PatchClassifier, PatchDiagram, PatchInteraction, PatchMessage, PatchOperation,
        PatchParameter, PatchProperty, PatchRelation,
    };
    use bouml_core::{Classifier, ClassifierKind, Command, CommandHistory, Project};
    use std::collections::BTreeMap;

    struct MockClient(UmlGraphPatch);

    impl LlmClient for MockClient {
        fn complete_uml_patch(
            &self,
            _system: &str,
            _user: &str,
        ) -> Result<UmlGraphPatch, ProviderError> {
            Ok(self.0.clone())
        }
    }

    #[test]
    fn json_schema_contains_uml_graph_patch_properties() {
        let schema = uml_graph_patch_json_schema();
        assert_eq!(schema["title"], "UmlGraphPatch");
        assert!(schema["properties"]["classifiers"].is_object());
        assert!(schema["properties"]["interactions"].is_object());
        assert!(schema["properties"]["state_machines"].is_object());
    }

    #[test]
    fn conversational_strategy_refactoring_is_atomic_and_undoable() {
        let mut project = Project::new("Payments");
        let root_id = project.root_package_id.clone();
        let mut history = CommandHistory::new();
        history
            .execute(
                &mut project,
                Command::CreateClassifier(Classifier::new(
                    "PaymentProcessor",
                    root_id,
                    ClassifierKind::Class,
                )),
            )
            .unwrap();

        let mut bodies = BTreeMap::new();
        bodies.insert("rust".to_string(), "amount > 0.0".to_string());

        let mock_patch = UmlGraphPatch {
            summary: "Added Strategy pattern on PaymentProcessor with sequence diagram".to_string(),
            packages: vec![],
            classifiers: vec![
                PatchClassifier {
                    name: "PaymentStrategy".to_string(),
                    package: None,
                    kind: "interface".to_string(),
                    is_abstract: true,
                    comment: "Strategy contract".to_string(),
                    properties: vec![],
                    operations: vec![PatchOperation {
                        name: "pay".to_string(),
                        visibility: "public".to_string(),
                        params: vec![PatchParameter {
                            name: "amount".to_string(),
                            type_name: "f64".to_string(),
                        }],
                        return_type: Some("bool".to_string()),
                        is_abstract: true,
                        is_static: false,
                        bodies: BTreeMap::new(),
                    }],
                    literals: vec![],
                },
                PatchClassifier {
                    name: "StripeStrategy".to_string(),
                    package: None,
                    kind: "class".to_string(),
                    is_abstract: false,
                    comment: String::new(),
                    properties: vec![PatchProperty {
                        name: "api_key".to_string(),
                        type_name: "string".to_string(),
                        visibility: "private".to_string(),
                        multiplicity: "1".to_string(),
                    }],
                    operations: vec![PatchOperation {
                        name: "pay".to_string(),
                        visibility: "public".to_string(),
                        params: vec![PatchParameter {
                            name: "amount".to_string(),
                            type_name: "f64".to_string(),
                        }],
                        return_type: Some("bool".to_string()),
                        is_abstract: false,
                        is_static: false,
                        bodies,
                    }],
                    literals: vec![],
                },
            ],
            relations: vec![
                PatchRelation {
                    source: "StripeStrategy".to_string(),
                    target: "PaymentStrategy".to_string(),
                    kind: "interface_realization".to_string(),
                    role_name: None,
                    multiplicity: "1".to_string(),
                },
                PatchRelation {
                    source: "PaymentProcessor".to_string(),
                    target: "PaymentStrategy".to_string(),
                    kind: "aggregation".to_string(),
                    role_name: Some("strategy".to_string()),
                    multiplicity: "1".to_string(),
                },
            ],
            interactions: vec![PatchInteraction {
                name: "CheckoutSequence".to_string(),
                package: None,
                lifelines: vec![
                    "PaymentProcessor".to_string(),
                    "PaymentStrategy".to_string(),
                ],
                messages: vec![PatchMessage {
                    from: "PaymentProcessor".to_string(),
                    to: "PaymentStrategy".to_string(),
                    label: "pay(amount)".to_string(),
                    sort: "sync_call".to_string(),
                }],
            }],
            state_machines: vec![],
            diagrams: vec![PatchDiagram {
                name: "Payment Strategy".to_string(),
                kind: "class".to_string(),
                elements: vec![
                    "PaymentProcessor".to_string(),
                    "PaymentStrategy".to_string(),
                    "StripeStrategy".to_string(),
                ],
            }],
        };

        let client = MockClient(mock_patch);
        let report = refactor_with_instruction(
            &client,
            &mut project,
            &mut history,
            "Ajoute un pattern Strategy sur PaymentProcessor et mets à jour le diagramme de séquence",
        )
        .unwrap();

        assert_eq!(report.classifiers_created, 2);
        assert_eq!(report.relations_created, 2);
        assert_eq!(report.interactions_created, 1);
        assert_eq!(report.diagrams_created, 1);
        assert!(report.diagnostics.is_empty());
        assert_eq!(project.classifiers.len(), 3);

        // Single Undo reverts the entire AI structural batch atomically!
        history.undo(&mut project).unwrap();
        assert_eq!(project.classifiers.len(), 1);
        assert_eq!(project.relations.len(), 0);
    }
}
