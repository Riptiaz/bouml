use crate::id::ElementId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// UML 2.5 Diagram types supported by BouML Next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagramKind {
    #[default]
    Class,
    Sequence,
    UseCase,
    StateMachine,
    Activity,
    Component,
    Deployment,
    Package,
    Object,
}

/// How the diagram canvas computes element layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayoutMode {
    #[default]
    AutoElk,
    Manual,
    Hybrid,
}

/// Optional manual geometry override for a node on a diagram.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiagramNodeOverride {
    pub element_id: ElementId,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(default)]
    pub collapsed: bool,
}

/// Optional manual routing waypoints for an edge on a diagram.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiagramEdgeOverride {
    pub relation_id: ElementId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub waypoints: Vec<(f64, f64)>,
}

/// Diagram view strictly decoupled from the semantic UML 2.5 model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagram {
    pub id: ElementId,
    pub name: String,
    pub kind: DiagramKind,
    pub package_id: ElementId,
    #[serde(default)]
    pub layout_mode: LayoutMode,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub element_ids: Vec<ElementId>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub node_overrides: BTreeMap<ElementId, DiagramNodeOverride>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub edge_overrides: BTreeMap<ElementId, DiagramEdgeOverride>,
}

impl Diagram {
    pub fn new(name: impl Into<String>, kind: DiagramKind, package_id: ElementId) -> Self {
        Self {
            id: ElementId::new(),
            name: name.into(),
            kind,
            package_id,
            layout_mode: LayoutMode::AutoElk,
            element_ids: Vec::new(),
            node_overrides: BTreeMap::new(),
            edge_overrides: BTreeMap::new(),
        }
    }
}
