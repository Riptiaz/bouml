use crate::id::ElementId;
use crate::model::common::{ElementMeta, Multiplicity, TypeRef, Visibility};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// UML 2.5 Package. Directly owns packages, classifiers, and behaviors (no Rational Rose view wrappers).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Package {
    #[serde(flatten)]
    pub meta: ElementMeta,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<ElementId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subpackages: Vec<ElementId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub classifiers: Vec<ElementId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub interactions: Vec<ElementId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub state_machines: Vec<ElementId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub activities: Vec<ElementId>,
}

impl Package {
    pub fn new(name: impl Into<String>, parent_id: Option<ElementId>) -> Self {
        Self {
            meta: ElementMeta::new(name),
            parent_id,
            subpackages: Vec::new(),
            classifiers: Vec::new(),
            interactions: Vec::new(),
            state_machines: Vec::new(),
            activities: Vec::new(),
        }
    }
}

/// First-class UML 2.5 Classifier kinds (replaces BouML v4's string-stereotype overloading on Class).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClassifierKind {
    #[default]
    Class,
    Interface,
    Enumeration,
    DataType,
    PrimitiveType,
    Actor,
    Component,
    Artifact,
    DeploymentNode,
    UseCase,
    Signal,
}

/// Generic / template formal parameter on a Classifier or Operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemplateParameter {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_type: Option<TypeRef>,
}

/// Literal member of an `Enumeration` classifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnumLiteral {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub comment: String,
}

/// UML 2.5 Classifier (Class, Interface, Enumeration, Component, UseCase, etc.).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Classifier {
    #[serde(flatten)]
    pub meta: ElementMeta,
    pub package_id: ElementId,
    #[serde(default)]
    pub kind: ClassifierKind,
    #[serde(default)]
    pub visibility: Visibility,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_abstract: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_final: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_active: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub template_params: Vec<TemplateParameter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operations: Vec<Operation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub literals: Vec<EnumLiteral>,
}

impl Classifier {
    pub fn new(name: impl Into<String>, package_id: ElementId, kind: ClassifierKind) -> Self {
        Self {
            meta: ElementMeta::new(name),
            package_id,
            kind,
            visibility: Visibility::Public,
            is_abstract: matches!(kind, ClassifierKind::Interface),
            is_final: false,
            is_active: false,
            template_params: Vec::new(),
            properties: Vec::new(),
            operations: Vec::new(),
            literals: Vec::new(),
        }
    }
}

/// UML 2.5 Property (attribute owned by a Classifier).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Property {
    #[serde(flatten)]
    pub meta: ElementMeta,
    #[serde(default)]
    pub visibility: Visibility,
    pub type_ref: TypeRef,
    #[serde(default)]
    pub multiplicity: Multiplicity,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_static: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_readonly: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
}

impl Property {
    pub fn new(name: impl Into<String>, type_ref: TypeRef) -> Self {
        Self {
            meta: ElementMeta::new(name),
            visibility: Visibility::Private,
            type_ref,
            multiplicity: Multiplicity::exactly_one(),
            is_static: false,
            is_readonly: false,
            default_value: None,
        }
    }
}

/// UML 2.5 ParameterDirectionKind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParamDirection {
    #[default]
    In,
    Out,
    InOut,
    Return,
}

/// UML 2.5 Operation parameter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Parameter {
    pub name: String,
    #[serde(default)]
    pub direction: ParamDirection,
    pub type_ref: TypeRef,
    #[serde(default)]
    pub multiplicity: Multiplicity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
}

impl Parameter {
    pub fn new(name: impl Into<String>, type_ref: TypeRef) -> Self {
        Self {
            name: name.into(),
            direction: ParamDirection::In,
            type_ref,
            multiplicity: Multiplicity::exactly_one(),
            default_value: None,
        }
    }
}

/// UML 2.5 Operation (method owned by a Classifier).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Operation {
    #[serde(flatten)]
    pub meta: ElementMeta,
    #[serde(default)]
    pub visibility: Visibility,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<Parameter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_type: Option<TypeRef>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_static: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_abstract: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_final: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_const: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_async: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exceptions: Vec<TypeRef>,
    /// Method bodies keyed by language identifier (e.g. "cpp", "java", "python", "rust").
    /// Stored directly by language name instead of fragile byte offsets.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub bodies: BTreeMap<String, String>,
}

impl Operation {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            meta: ElementMeta::new(name),
            visibility: Visibility::Public,
            params: Vec::new(),
            return_type: None,
            is_static: false,
            is_abstract: false,
            is_final: false,
            is_const: false,
            is_async: false,
            exceptions: Vec::new(),
            bodies: BTreeMap::new(),
        }
    }
}

/// UML 2.5 Relationship kinds between classifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationKind {
    Generalization,
    InterfaceRealization,
    Association,
    Aggregation,
    Composition,
    Dependency,
    Usage,
    Include,
    Extend,
}

/// Endpoint of a UML 2.5 relationship.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelationEnd {
    pub classifier_id: ElementId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_name: Option<String>,
    #[serde(default)]
    pub visibility: Visibility,
    #[serde(default)]
    pub multiplicity: Multiplicity,
    #[serde(default = "default_true")]
    pub is_navigable: bool,
}

impl RelationEnd {
    pub fn new(classifier_id: ElementId) -> Self {
        Self {
            classifier_id,
            role_name: None,
            visibility: Visibility::Public,
            multiplicity: Multiplicity::exactly_one(),
            is_navigable: true,
        }
    }
}

/// UML 2.5 Relationship connecting a source and target classifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Relation {
    #[serde(flatten)]
    pub meta: ElementMeta,
    pub kind: RelationKind,
    pub source: RelationEnd,
    pub target: RelationEnd,
}

impl Relation {
    pub fn new(kind: RelationKind, source_id: ElementId, target_id: ElementId) -> Self {
        Self {
            meta: ElementMeta::new(""),
            kind,
            source: RelationEnd::new(source_id),
            target: RelationEnd::new(target_id),
        }
    }
}

fn is_false(v: &bool) -> bool {
    !*v
}

fn default_true() -> bool {
    true
}
