use crate::diagram::Diagram;
use crate::id::ElementId;
use crate::model::{Activity, Classifier, Interaction, Package, Relation, StateMachine};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Schema version for `.bouml/` project persistence.
pub const SCHEMA_VERSION: u32 = 1;

/// Summary metrics for a UML project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectStats {
    pub packages: usize,
    pub classifiers: usize,
    pub properties: usize,
    pub operations: usize,
    pub relations: usize,
    pub interactions: usize,
    pub state_machines: usize,
    pub activities: usize,
    pub diagrams: usize,
}

/// Root container for a BouML Next UML 2.5 project.
/// Uses `BTreeMap` everywhere for deterministic iteration and Git-friendly serialization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub schema_version: u32,
    pub name: String,
    pub root_package_id: ElementId,
    #[serde(default)]
    pub enabled_languages: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub codegen_settings: BTreeMap<String, String>,
    #[serde(default)]
    pub packages: BTreeMap<ElementId, Package>,
    #[serde(default)]
    pub classifiers: BTreeMap<ElementId, Classifier>,
    #[serde(default)]
    pub relations: BTreeMap<ElementId, Relation>,
    #[serde(default)]
    pub interactions: BTreeMap<ElementId, Interaction>,
    #[serde(default)]
    pub state_machines: BTreeMap<ElementId, StateMachine>,
    #[serde(default)]
    pub activities: BTreeMap<ElementId, Activity>,
    #[serde(default)]
    pub diagrams: BTreeMap<ElementId, Diagram>,
}

impl Project {
    /// Creates a new empty UML 2.5 project with a root package named after the project.
    pub fn new(name: impl Into<String>) -> Self {
        let name = name.into();
        let root_pkg = Package::new(&name, None);
        let root_package_id = root_pkg.meta.id.clone();
        let mut packages = BTreeMap::new();
        packages.insert(root_package_id.clone(), root_pkg);

        Self {
            schema_version: SCHEMA_VERSION,
            name,
            root_package_id,
            enabled_languages: vec![
                "cpp".to_string(),
                "java".to_string(),
                "python".to_string(),
                "typescript".to_string(),
                "rust".to_string(),
            ],
            codegen_settings: BTreeMap::new(),
            packages,
            classifiers: BTreeMap::new(),
            relations: BTreeMap::new(),
            interactions: BTreeMap::new(),
            state_machines: BTreeMap::new(),
            activities: BTreeMap::new(),
            diagrams: BTreeMap::new(),
        }
    }

    pub fn root_package(&self) -> Option<&Package> {
        self.packages.get(&self.root_package_id)
    }

    pub fn find_package_by_name(&self, name: &str) -> Option<&Package> {
        self.packages.values().find(|p| p.meta.name == name)
    }

    pub fn find_classifier_by_name(&self, name: &str) -> Option<&Classifier> {
        self.classifiers.values().find(|c| c.meta.name == name)
    }

    pub fn stats(&self) -> ProjectStats {
        let properties = self.classifiers.values().map(|c| c.properties.len()).sum();
        let operations = self.classifiers.values().map(|c| c.operations.len()).sum();
        ProjectStats {
            packages: self.packages.len(),
            classifiers: self.classifiers.len(),
            properties,
            operations,
            relations: self.relations.len(),
            interactions: self.interactions.len(),
            state_machines: self.state_machines.len(),
            activities: self.activities.len(),
            diagrams: self.diagrams.len(),
        }
    }
}
