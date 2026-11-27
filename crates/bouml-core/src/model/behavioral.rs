use crate::id::ElementId;
use crate::model::common::ElementMeta;
use serde::{Deserialize, Serialize};

// ============================================================================
// UML 2.5 Interactions (Sequence / Communication Diagrams — first-class model)
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Interaction {
    #[serde(flatten)]
    pub meta: ElementMeta,
    pub package_id: ElementId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lifelines: Vec<Lifeline>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub messages: Vec<Message>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fragments: Vec<CombinedFragment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lifeline {
    pub id: ElementId,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub represents_classifier_id: Option<ElementId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageSort {
    #[default]
    SyncCall,
    AsyncCall,
    Reply,
    Create,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub id: ElementId,
    pub name: String,
    pub sort: MessageSort,
    pub from_lifeline_id: ElementId,
    pub to_lifeline_id: ElementId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<ElementId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guard: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionOperator {
    Alt,
    Opt,
    Loop,
    Par,
    Break,
    Ref,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CombinedFragment {
    pub id: ElementId,
    pub operator: InteractionOperator,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operands: Vec<InteractionOperand>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InteractionOperand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guard: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub message_ids: Vec<ElementId>,
}

// ============================================================================
// UML 2.5 State Machines
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StateMachine {
    #[serde(flatten)]
    pub meta: ElementMeta,
    pub package_id: ElementId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_classifier_id: Option<ElementId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub regions: Vec<Region>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Region {
    pub id: ElementId,
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub vertices: Vec<StateVertex>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transitions: Vec<Transition>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PseudostateKind {
    Initial,
    Choice,
    Junction,
    Fork,
    Join,
    ShallowHistory,
    DeepHistory,
    EntryPoint,
    ExitPoint,
    Terminate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "vertex_kind", rename_all = "snake_case")]
pub enum StateVertex {
    State {
        id: ElementId,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        entry: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        do_activity: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        sub_regions: Vec<Region>,
    },
    Pseudostate {
        id: ElementId,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        name: String,
        kind: PseudostateKind,
    },
    FinalState {
        id: ElementId,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transition {
    pub id: ElementId,
    pub source_id: ElementId,
    pub target_id: ElementId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guard: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect: Option<String>,
}

// ============================================================================
// UML 2.5 Activities
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Activity {
    #[serde(flatten)]
    pub meta: ElementMeta,
    pub package_id: ElementId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<ActivityNode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edges: Vec<ActivityEdge>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityNodeKind {
    Initial,
    ActivityFinal,
    FlowFinal,
    Decision,
    Merge,
    Fork,
    Join,
    Action,
    ObjectNode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivityNode {
    pub id: ElementId,
    pub name: String,
    pub kind: ActivityNodeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partition: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivityEdge {
    pub id: ElementId,
    pub source_id: ElementId,
    pub target_id: ElementId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guard: Option<String>,
}
