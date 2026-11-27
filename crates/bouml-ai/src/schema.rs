use schemars::{schema_for, JsonSchema};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Strictly schema-validated intermediate UML 2.5 graph produced by LLMs (Structured Outputs).
/// Supports Text-to-UML generation and conversational architecture refactoring across
/// Class, Sequence, Use Case, and State Machine diagrams.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct UmlGraphPatch {
    /// Human-readable summary of the generated or refactored architecture.
    pub summary: String,
    #[serde(default)]
    pub packages: Vec<PatchPackage>,
    #[serde(default)]
    pub classifiers: Vec<PatchClassifier>,
    #[serde(default)]
    pub relations: Vec<PatchRelation>,
    #[serde(default)]
    pub interactions: Vec<PatchInteraction>,
    #[serde(default)]
    pub state_machines: Vec<PatchStateMachine>,
    #[serde(default)]
    pub diagrams: Vec<PatchDiagram>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchPackage {
    pub name: String,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub comment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchClassifier {
    pub name: String,
    #[serde(default)]
    pub package: Option<String>,
    /// One of: class, interface, enumeration, data_type, actor, component, use_case
    #[serde(default = "default_class_kind")]
    pub kind: String,
    #[serde(default)]
    pub is_abstract: bool,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub properties: Vec<PatchProperty>,
    #[serde(default)]
    pub operations: Vec<PatchOperation>,
    #[serde(default)]
    pub literals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchProperty {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    #[serde(default = "default_private")]
    pub visibility: String,
    #[serde(default = "default_mult")]
    pub multiplicity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchParameter {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchOperation {
    pub name: String,
    #[serde(default = "default_public")]
    pub visibility: String,
    #[serde(default)]
    pub params: Vec<PatchParameter>,
    #[serde(default)]
    pub return_type: Option<String>,
    #[serde(default)]
    pub is_abstract: bool,
    #[serde(default)]
    pub is_static: bool,
    /// Optional AI-generated method bodies keyed by language (e.g. "rust", "python", "typescript", "cpp").
    #[serde(default)]
    pub bodies: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchRelation {
    pub source: String,
    pub target: String,
    /// One of: generalization, interface_realization, association, aggregation, composition, dependency, include, extend
    pub kind: String,
    #[serde(default)]
    pub role_name: Option<String>,
    #[serde(default = "default_mult")]
    pub multiplicity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchInteraction {
    pub name: String,
    #[serde(default)]
    pub package: Option<String>,
    pub lifelines: Vec<String>,
    pub messages: Vec<PatchMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchMessage {
    pub from: String,
    pub to: String,
    pub label: String,
    /// One of: sync_call, async_call, reply, create, delete
    #[serde(default = "default_sync_call")]
    pub sort: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchStateMachine {
    pub name: String,
    #[serde(default)]
    pub package: Option<String>,
    pub states: Vec<String>,
    pub transitions: Vec<PatchTransition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchTransition {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub trigger: Option<String>,
    #[serde(default)]
    pub guard: Option<String>,
    #[serde(default)]
    pub effect: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PatchDiagram {
    pub name: String,
    /// One of: class, sequence, use_case, state_machine, activity, component
    #[serde(default = "default_class_kind")]
    pub kind: String,
    #[serde(default)]
    pub elements: Vec<String>,
}

/// Generates the strict JSON Schema for `UmlGraphPatch` used by Structured Outputs.
pub fn uml_graph_patch_json_schema() -> serde_json::Value {
    serde_json::to_value(schema_for!(UmlGraphPatch)).expect("schema serialization cannot fail")
}

fn default_class_kind() -> String {
    "class".to_string()
}

fn default_public() -> String {
    "public".to_string()
}

fn default_private() -> String {
    "private".to_string()
}

fn default_mult() -> String {
    "1".to_string()
}

fn default_sync_call() -> String {
    "sync_call".to_string()
}
