pub mod code_treesitter;
pub mod ir;
pub mod json_schema_openapi;
pub mod mermaid;
pub mod plantuml;
pub mod sql_ddl;
pub mod xmi;

pub use code_treesitter::{parse_code_path, parse_code_str, CodeLang};
pub use ir::{
    merge_bundle_into_project, ImportBundle, ImportSummary, ImportedClassifier, ImportedRelation,
};
pub use json_schema_openapi::parse_json_schema_or_openapi;
pub use mermaid::parse_mermaid;
pub use plantuml::parse_plantuml;
pub use sql_ddl::parse_sql_ddl;
pub use xmi::parse_xmi;

use bouml_core::Project;
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ImportError {
    #[error("I/O error reading {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("parse error: {0}")]
    Parse(String),
    #[error("could not auto-detect import format for '{0}'")]
    UnsupportedFormat(PathBuf),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportFormat {
    Auto,
    Code,
    PlantUml,
    Mermaid,
    Sql,
    OpenApiOrJsonSchema,
    Xmi,
}

impl FromStr for ImportFormat {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "auto" => Ok(Self::Auto),
            "code" | "source" | "treesitter" => Ok(Self::Code),
            "plantuml" | "puml" => Ok(Self::PlantUml),
            "mermaid" | "mmd" => Ok(Self::Mermaid),
            "sql" | "ddl" => Ok(Self::Sql),
            "openapi" | "swagger" | "json-schema" | "jsonschema" => {
                Ok(Self::OpenApiOrJsonSchema)
            }
            "xmi" => Ok(Self::Xmi),
            other => Err(format!("unsupported import format '{other}'")),
        }
    }
}

/// Universal entry point (Drag & Drop / CLI): imports any supported source code directory
/// or textual/standard format into `project` and automatically generates clean `AutoElk` diagrams.
pub fn import_path(
    project: &mut Project,
    path: &Path,
    format: ImportFormat,
    diagram_name: Option<&str>,
) -> Result<ImportSummary, ImportError> {
    let resolved_format = match format {
        ImportFormat::Auto => detect_format(path)?,
        explicit => explicit,
    };

    let label = path.display().to_string();
    let bundle = match resolved_format {
        ImportFormat::Code => parse_code_path(path).map_err(|source| ImportError::Io {
            path: path.to_path_buf(),
            source,
        })?,
        ImportFormat::PlantUml => {
            let content = read_text(path)?;
            parse_plantuml(&content, &label)
        }
        ImportFormat::Mermaid => {
            let content = read_text(path)?;
            parse_mermaid(&content, &label)
        }
        ImportFormat::Sql => {
            let content = read_text(path)?;
            parse_sql_ddl(&content, &label)
        }
        ImportFormat::OpenApiOrJsonSchema => {
            let content = read_text(path)?;
            parse_json_schema_or_openapi(&content, &label).map_err(ImportError::Parse)?
        }
        ImportFormat::Xmi => {
            let content = read_text(path)?;
            parse_xmi(&content, &label).map_err(ImportError::Parse)?
        }
        ImportFormat::Auto => unreachable!(),
    };

    Ok(merge_bundle_into_project(project, bundle, diagram_name))
}

fn detect_format(path: &Path) -> Result<ImportFormat, ImportError> {
    if path.is_dir() {
        return Ok(ImportFormat::Code);
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "puml" | "plantuml" | "iuml" => Ok(ImportFormat::PlantUml),
        "mmd" | "mermaid" => Ok(ImportFormat::Mermaid),
        "sql" => Ok(ImportFormat::Sql),
        "json" | "yaml" | "yml" => Ok(ImportFormat::OpenApiOrJsonSchema),
        "xmi" | "xml" => Ok(ImportFormat::Xmi),
        e if CodeLang::from_extension(e).is_some() => Ok(ImportFormat::Code),
        _ => Err(ImportError::UnsupportedFormat(path.to_path_buf())),
    }
}

fn read_text(path: &Path) -> Result<String, ImportError> {
    fs::read_to_string(path).map_err(|source| ImportError::Io {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bouml_core::{ClassifierKind, LayoutMode, RelationKind};

    #[test]
    fn treesitter_reverses_rust_and_typescript_and_generates_diagram() {
        let mut project = Project::new("ReverseTest");
        let rust_src = r#"
            pub trait PaymentStrategy {
                fn pay(&self, amount: f64) -> bool;
            }
            pub struct StripeStrategy {
                pub api_key: String,
            }
            impl PaymentStrategy for StripeStrategy {
                fn pay(&self, amount: f64) -> bool { amount > 0.0 }
            }
        "#;

        let mut bundle = ImportBundle {
            source_label: "billing.rs".to_string(),
            ..Default::default()
        };
        parse_code_str(rust_src, CodeLang::Rust, Some("billing".to_string()), &mut bundle);
        let summary = merge_bundle_into_project(&mut project, bundle, None);

        assert_eq!(summary.classifiers_added, 2);
        assert_eq!(summary.relations_added, 1);
        assert_eq!(summary.diagrams_created, 1);
        let diag = project.diagrams.values().next().unwrap();
        assert_eq!(diag.layout_mode, LayoutMode::AutoElk);
        assert_eq!(diag.element_ids.len(), 2);
    }

    #[test]
    fn imports_plantuml_and_mermaid() {
        let puml = r#"
            @startuml
            package core {
                interface Repository {
                    +findById(id: string): Order
                }
                class Order {
                    -id: string
                    +total: f64
                }
            }
            Order ..> Repository
            @enduml
        "#;
        let mut project = Project::new("TextFormats");
        let s1 = merge_bundle_into_project(&mut project, parse_plantuml(puml, "test.puml"), None);
        assert_eq!(s1.classifiers_added, 2);
        assert_eq!(s1.relations_added, 1);

        let mmd = r#"
            classDiagram
            class Customer {
                +string email
            }
            Customer --> Order
        "#;
        let s2 = merge_bundle_into_project(&mut project, parse_mermaid(mmd, "test.mmd"), None);
        assert_eq!(s2.classifiers_added, 1);
        assert_eq!(s2.relations_added, 1);
    }

    #[test]
    fn imports_sql_ddl_openapi_and_xmi() {
        let sql = r#"
            CREATE TABLE users (
                id BIGINT PRIMARY KEY,
                email VARCHAR(255) NOT NULL
            );
            CREATE TABLE orders (
                id BIGINT PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id)
            );
        "#;
        let mut project = Project::new("Standards");
        let s_sql = merge_bundle_into_project(&mut project, parse_sql_ddl(sql, "schema.sql"), None);
        assert_eq!(s_sql.classifiers_added, 2);
        assert_eq!(s_sql.relations_added, 1);

        let openapi = r#"
            openapi: 3.0.3
            components:
              schemas:
                Product:
                  type: object
                  required: [sku]
                  properties:
                    sku: { type: string }
                    price: { type: number }
        "#;
        let s_oa = merge_bundle_into_project(
            &mut project,
            parse_json_schema_or_openapi(openapi, "api.yaml").unwrap(),
            None,
        );
        assert_eq!(s_oa.classifiers_added, 1);

        let xmi = r#"
            <xmi:XMI xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001">
              <uml:Model name="Demo">
                <packagedElement xmi:type="uml:Class" xmi:id="c1" name="BaseEntity">
                  <ownedAttribute name="id" type="string" visibility="private"/>
                </packagedElement>
                <packagedElement xmi:type="uml:Class" xmi:id="c2" name="Invoice">
                  <generalization general="c1"/>
                </packagedElement>
              </uml:Model>
            </xmi:XMI>
        "#;
        let s_xmi = merge_bundle_into_project(&mut project, parse_xmi(xmi, "model.xmi").unwrap(), None);
        assert_eq!(s_xmi.classifiers_added, 2);
        assert_eq!(s_xmi.relations_added, 1);
        assert!(project
            .relations
            .values()
            .any(|r| r.kind == RelationKind::Generalization));
        assert_eq!(
            project.find_classifier_by_name("Invoice").unwrap().kind,
            ClassifierKind::Class
        );
    }
}
