use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use ulid::Ulid;

/// Globally unique, chronologically sortable identifier for any UML 2.5 element or diagram.
/// Uses ULID strings to prevent ID collisions across concurrent Git branches.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ElementId(String);

impl ElementId {
    /// Generates a new ULID-based `ElementId`.
    pub fn new() -> Self {
        Self(Ulid::new().to_string())
    }

    /// Creates an `ElementId` from a deterministic or imported string identifier.
    pub fn from_raw(raw: impl Into<String>) -> Self {
        Self(raw.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns a short 8-char suffix suitable for disambiguating filenames or preserved-body markers.
    pub fn short(&self) -> &str {
        let len = self.0.len();
        if len >= 8 {
            &self.0[len - 8..]
        } else {
            &self.0
        }
    }
}

impl Default for ElementId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for ElementId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for ElementId {
    type Err = std::convert::Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self(s.to_string()))
    }
}
