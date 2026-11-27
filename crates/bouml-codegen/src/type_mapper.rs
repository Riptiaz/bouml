use crate::languages::TargetLanguage;
use bouml_core::{Multiplicity, Project, TypeRef};

/// Maps a UML `TypeRef` and `Multiplicity` to an idiomatic type expression in `lang`.
pub fn map_type(
    project: &Project,
    type_ref: &TypeRef,
    multiplicity: &Multiplicity,
    lang: TargetLanguage,
) -> String {
    let base = match type_ref {
        TypeRef::Internal(id) => project
            .classifiers
            .get(id)
            .map(|c| c.meta.name.clone())
            .unwrap_or_else(|| "Unknown".to_string()),
        TypeRef::External(raw) => map_builtin(raw.trim(), lang),
    };

    wrap_multiplicity(&base, multiplicity, lang)
}

fn map_builtin(raw: &str, lang: TargetLanguage) -> String {
    let lower = raw.to_ascii_lowercase();
    match (lower.as_str(), lang) {
        // String
        ("string" | "str" | "text", TargetLanguage::Cpp) => "std::string".into(),
        ("string" | "str" | "text", TargetLanguage::Java) => "String".into(),
        ("string" | "str" | "text", TargetLanguage::Python) => "str".into(),
        ("string" | "str" | "text", TargetLanguage::TypeScript) => "string".into(),
        ("string" | "str" | "text", TargetLanguage::Php) => "string".into(),
        ("string" | "str" | "text", TargetLanguage::Rust) => "String".into(),
        ("string" | "str" | "text", TargetLanguage::Go) => "string".into(),
        ("string" | "str" | "text", TargetLanguage::Sql) => "VARCHAR(255)".into(),

        // Integer
        ("int" | "integer" | "i32", TargetLanguage::Cpp) => "int32_t".into(),
        ("int" | "integer" | "i32", TargetLanguage::Java) => "int".into(),
        ("int" | "integer" | "i32", TargetLanguage::Python) => "int".into(),
        ("int" | "integer" | "i32", TargetLanguage::TypeScript) => "number".into(),
        ("int" | "integer" | "i32", TargetLanguage::Php) => "int".into(),
        ("int" | "integer" | "i32", TargetLanguage::Rust) => "i32".into(),
        ("int" | "integer" | "i32", TargetLanguage::Go) => "int32".into(),
        ("int" | "integer" | "i32", TargetLanguage::Sql) => "INTEGER".into(),

        // 64-bit Integer
        ("long" | "i64" | "bigint", TargetLanguage::Cpp) => "int64_t".into(),
        ("long" | "i64" | "bigint", TargetLanguage::Java) => "long".into(),
        ("long" | "i64" | "bigint", TargetLanguage::Python) => "int".into(),
        ("long" | "i64" | "bigint", TargetLanguage::TypeScript) => "number".into(),
        ("long" | "i64" | "bigint", TargetLanguage::Php) => "int".into(),
        ("long" | "i64" | "bigint", TargetLanguage::Rust) => "i64".into(),
        ("long" | "i64" | "bigint", TargetLanguage::Go) => "int64".into(),
        ("long" | "i64" | "bigint", TargetLanguage::Sql) => "BIGINT".into(),

        // Float / Double
        ("float" | "double" | "f64" | "decimal", TargetLanguage::Cpp) => "double".into(),
        ("float" | "double" | "f64" | "decimal", TargetLanguage::Java) => "double".into(),
        ("float" | "double" | "f64" | "decimal", TargetLanguage::Python) => "float".into(),
        ("float" | "double" | "f64" | "decimal", TargetLanguage::TypeScript) => "number".into(),
        ("float" | "double" | "f64" | "decimal", TargetLanguage::Php) => "float".into(),
        ("float" | "double" | "f64" | "decimal", TargetLanguage::Rust) => "f64".into(),
        ("float" | "double" | "f64" | "decimal", TargetLanguage::Go) => "float64".into(),
        ("float" | "double" | "f64" | "decimal", TargetLanguage::Sql) => "DOUBLE PRECISION".into(),

        // Boolean
        ("bool" | "boolean", TargetLanguage::Cpp) => "bool".into(),
        ("bool" | "boolean", TargetLanguage::Java) => "boolean".into(),
        ("bool" | "boolean", TargetLanguage::Python) => "bool".into(),
        ("bool" | "boolean", TargetLanguage::TypeScript) => "boolean".into(),
        ("bool" | "boolean", TargetLanguage::Php) => "bool".into(),
        ("bool" | "boolean", TargetLanguage::Rust) => "bool".into(),
        ("bool" | "boolean", TargetLanguage::Go) => "bool".into(),
        ("bool" | "boolean", TargetLanguage::Sql) => "BOOLEAN".into(),

        // Void
        ("void" | "", TargetLanguage::Python) => "None".into(),
        ("void" | "", TargetLanguage::Rust) => "()".into(),
        ("void" | "", TargetLanguage::Go) => String::new(),
        ("void" | "", _) => "void".into(),

        // Timestamp / DateTime
        ("datetime" | "timestamp", TargetLanguage::Sql) => "TIMESTAMP".into(),
        ("uuid", TargetLanguage::Sql) => "UUID".into(),

        _ => raw.to_string(),
    }
}

fn wrap_multiplicity(base: &str, mult: &Multiplicity, lang: TargetLanguage) -> String {
    let is_collection = mult.upper.is_none() || mult.upper.is_some_and(|u| u > 1);
    let is_optional = mult.lower == 0 && mult.upper == Some(1);

    if is_collection {
        return match lang {
            TargetLanguage::Cpp => format!("std::vector<{base}>"),
            TargetLanguage::Java => format!("List<{base}>"),
            TargetLanguage::Python => format!("list[{base}]"),
            TargetLanguage::TypeScript => format!("{base}[]"),
            TargetLanguage::Php => "array".to_string(),
            TargetLanguage::Rust => format!("Vec<{base}>"),
            TargetLanguage::Go => format!("[]{base}"),
            TargetLanguage::Sql => "JSONB".to_string(),
        };
    }

    if is_optional {
        return match lang {
            TargetLanguage::Cpp => format!("std::optional<{base}>"),
            TargetLanguage::Java => format!("Optional<{base}>"),
            TargetLanguage::Python => format!("Optional[{base}]"),
            TargetLanguage::TypeScript => format!("{base} | null"),
            TargetLanguage::Php => format!("?{base}"),
            TargetLanguage::Rust => format!("Option<{base}>"),
            TargetLanguage::Go => format!("*{base}"),
            TargetLanguage::Sql => base.to_string(),
        };
    }

    base.to_string()
}
