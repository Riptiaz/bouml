use crate::id::ElementId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

/// UML 2.5 VisibilityKind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    #[default]
    Public,
    Protected,
    Private,
    Package,
}

impl Visibility {
    /// Returns the standard UML single-character symbol (`+`, `#`, `-`, `~`).
    pub fn symbol(&self) -> char {
        match self {
            Visibility::Public => '+',
            Visibility::Protected => '#',
            Visibility::Private => '-',
            Visibility::Package => '~',
        }
    }

    /// Parses a UML visibility symbol (`+`, `#`, `-`, `~`).
    pub fn from_symbol(ch: char) -> Option<Self> {
        match ch {
            '+' => Some(Visibility::Public),
            '#' => Some(Visibility::Protected),
            '-' => Some(Visibility::Private),
            '~' => Some(Visibility::Package),
            _ => None,
        }
    }
}

/// UML 2.5 applied stereotype (multiple stereotypes allowed per element).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppliedStereotype {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, String>,
}

impl AppliedStereotype {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            profile: None,
            properties: BTreeMap::new(),
        }
    }
}

/// UML 2.5 MultiplicityElement bounds (`lower..upper`, where `upper: None` means unbounded `*`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Multiplicity {
    pub lower: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upper: Option<u32>,
}

impl Default for Multiplicity {
    fn default() -> Self {
        Self::exactly_one()
    }
}

impl Multiplicity {
    pub fn exactly_one() -> Self {
        Self {
            lower: 1,
            upper: Some(1),
        }
    }

    pub fn optional() -> Self {
        Self {
            lower: 0,
            upper: Some(1),
        }
    }

    pub fn zero_or_more() -> Self {
        Self {
            lower: 0,
            upper: None,
        }
    }

    pub fn one_or_more() -> Self {
        Self {
            lower: 1,
            upper: None,
        }
    }

    pub fn is_valid(&self) -> bool {
        match self.upper {
            Some(u) => self.lower <= u,
            None => true,
        }
    }
}

impl fmt::Display for Multiplicity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.lower, self.upper) {
            (l, Some(u)) if l == u => write!(f, "{l}"),
            (0, None) => write!(f, "0..*"),
            (l, None) => write!(f, "{l}..*"),
            (l, Some(u)) => write!(f, "{l}..{u}"),
        }
    }
}

impl FromStr for Multiplicity {
    type Err = String;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        let s = raw.trim();
        if s.is_empty() || s == "1" {
            return Ok(Self::exactly_one());
        }
        if s == "*" {
            return Ok(Self::zero_or_more());
        }
        if let Some((l_str, u_str)) = s.split_once("..") {
            let lower: u32 = l_str
                .trim()
                .parse()
                .map_err(|_| format!("invalid lower bound '{l_str}'"))?;
            let upper = if u_str.trim() == "*" {
                None
            } else {
                Some(
                    u_str
                        .trim()
                        .parse::<u32>()
                        .map_err(|_| format!("invalid upper bound '{u_str}'"))?,
                )
            };
            let mult = Self { lower, upper };
            if !mult.is_valid() {
                return Err(format!("lower bound {lower} exceeds upper bound {upper:?}"));
            }
            return Ok(mult);
        }
        let n: u32 = s
            .parse()
            .map_err(|_| format!("invalid multiplicity '{s}'"))?;
        Ok(Self {
            lower: n,
            upper: Some(n),
        })
    }
}

/// Reference to a type: either a modeled internal `Classifier` or an external/primitive type name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum TypeRef {
    Internal(ElementId),
    External(String),
}

impl TypeRef {
    pub fn external(name: impl Into<String>) -> Self {
        Self::External(name.into())
    }

    pub fn internal(id: ElementId) -> Self {
        Self::Internal(id)
    }
}

impl Default for TypeRef {
    fn default() -> Self {
        Self::External("void".to_string())
    }
}

/// Decoupled per-language metadata overrides (e.g., `cpp`, `java`, `python`, `rust`, `sql`).
/// Replaces BouML v4's hardcoded language fields on every `*Data` class.
pub type LanguageOverrides = BTreeMap<String, BTreeMap<String, String>>;

/// Shared metadata carried by every UML 2.5 `NamedElement`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ElementMeta {
    pub id: ElementId,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub comment: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stereotypes: Vec<AppliedStereotype>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub tagged_values: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub language_overrides: LanguageOverrides,
}

impl ElementMeta {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: ElementId::new(),
            name: name.into(),
            comment: String::new(),
            stereotypes: Vec::new(),
            tagged_values: BTreeMap::new(),
            language_overrides: BTreeMap::new(),
        }
    }

    pub fn with_id(id: ElementId, name: impl Into<String>) -> Self {
        Self {
            id,
            name: name.into(),
            comment: String::new(),
            stereotypes: Vec::new(),
            tagged_values: BTreeMap::new(),
            language_overrides: BTreeMap::new(),
        }
    }

    pub fn has_stereotype(&self, name: &str) -> bool {
        self.stereotypes
            .iter()
            .any(|s| s.name.eq_ignore_ascii_case(name))
    }
}
