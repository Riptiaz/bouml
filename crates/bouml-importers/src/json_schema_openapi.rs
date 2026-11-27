use crate::ir::{ImportBundle, ImportedClassifier, ImportedRelation};
use bouml_core::{
    ClassifierKind, EnumLiteral, Multiplicity, Property, RelationKind, TypeRef, Visibility,
};
use serde_json::Value;
use std::collections::BTreeSet;

/// Parses a JSON Schema or OpenAPI 3.x / Swagger 2.0 document (JSON or YAML) into an `ImportBundle`.
pub fn parse_json_schema_or_openapi(source: &str, label: &str) -> Result<ImportBundle, String> {
    let root: Value = serde_json::from_str(source)
        .or_else(|_| serde_yaml::from_str(source))
        .map_err(|e| format!("failed to parse JSON/YAML schema: {e}"))?;

    let mut bundle = ImportBundle {
        source_label: label.to_string(),
        ..Default::default()
    };

    // OpenAPI 3.x: `components.schemas`
    if let Some(schemas) = root
        .get("components")
        .and_then(|c| c.get("schemas"))
        .and_then(|s| s.as_object())
    {
        for (name, schema) in schemas {
            extract_schema_object(name, schema, &mut bundle);
        }
        return Ok(bundle);
    }

    // Swagger 2.0 / JSON Schema `$defs` / `definitions`
    if let Some(defs) = root
        .get("$defs")
        .or_else(|| root.get("definitions"))
        .and_then(|d| d.as_object())
    {
        for (name, schema) in defs {
            extract_schema_object(name, schema, &mut bundle);
        }
    }

    // Root JSON Schema object itself (if it has `properties`)
    if root.get("properties").is_some() {
        let title = root
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("RootSchema");
        extract_schema_object(title, &root, &mut bundle);
    }

    Ok(bundle)
}

fn extract_schema_object(name: &str, schema: &Value, bundle: &mut ImportBundle) {
    // Enum schema
    if let Some(enum_vals) = schema.get("enum").and_then(|e| e.as_array()) {
        let mut clf = ImportedClassifier::new(name, ClassifierKind::Enumeration);
        for v in enum_vals {
            let lit = v
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| v.to_string());
            clf.literals.push(EnumLiteral {
                name: lit,
                value: None,
                comment: String::new(),
            });
        }
        bundle.classifiers.push(clf);
        return;
    }

    let mut clf = ImportedClassifier::new(name, ClassifierKind::Class);
    if let Some(desc) = schema.get("description").and_then(|d| d.as_str()) {
        clf.comment = desc.to_string();
    }

    let required: BTreeSet<&str> = schema
        .get("required")
        .and_then(|r| r.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    if let Some(props) = schema.get("properties").and_then(|p| p.as_object()) {
        for (prop_name, prop_schema) in props {
            let is_req = required.contains(prop_name.as_str());
            let (ty_name, mult, ref_target) = resolve_schema_prop_type(prop_schema, is_req);

            if let Some(target) = ref_target {
                bundle.relations.push(ImportedRelation {
                    source_name: name.to_string(),
                    target_name: target.clone(),
                    kind: RelationKind::Association,
                    role_name: Some(prop_name.clone()),
                    target_multiplicity: mult.clone(),
                    visibility: Visibility::Public,
                });
            }

            let mut prop = Property::new(prop_name, TypeRef::external(ty_name));
            prop.visibility = Visibility::Public;
            prop.multiplicity = mult;
            clf.properties.push(prop);
        }
    }

    bundle.classifiers.push(clf);
}

fn resolve_schema_prop_type(schema: &Value, is_req: bool) -> (String, Multiplicity, Option<String>) {
    let base_mult = if is_req {
        Multiplicity::exactly_one()
    } else {
        Multiplicity::optional()
    };

    if let Some(ref_str) = schema.get("$ref").and_then(|r| r.as_str()) {
        let target = ref_str.rsplit('/').next().unwrap_or(ref_str).to_string();
        return (target.clone(), base_mult, Some(target));
    }

    let schema_type = schema.get("type").and_then(|t| t.as_str()).unwrap_or("any");
    if schema_type == "array" {
        let arr_mult = if is_req {
            Multiplicity::one_or_more()
        } else {
            Multiplicity::zero_or_more()
        };
        if let Some(items) = schema.get("items") {
            let (inner_ty, _, ref_tgt) = resolve_schema_prop_type(items, true);
            return (inner_ty, arr_mult, ref_tgt);
        }
        return ("any".to_string(), arr_mult, None);
    }

    let mapped = match schema_type {
        "integer" => "int",
        "number" => "f64",
        "boolean" => "bool",
        "string" => match schema.get("format").and_then(|f| f.as_str()) {
            Some("date-time") => "datetime",
            Some("uuid") => "uuid",
            _ => "string",
        },
        other => other,
    };

    (mapped.to_string(), base_mult, None)
}
