use crate::ir::{ImportBundle, ImportedClassifier, ImportedRelation};
use bouml_core::{ClassifierKind, Multiplicity, Property, RelationKind, TypeRef, Visibility};

/// Parses SQL DDL (`CREATE TABLE ...`) into UML 2.5 classes, typed columns, and foreign-key associations.
pub fn parse_sql_ddl(source: &str, label: &str) -> ImportBundle {
    let mut bundle = ImportBundle {
        source_label: label.to_string(),
        ..Default::default()
    };

    // Strip `--` line comments.
    let cleaned: String = source
        .lines()
        .map(|l| match l.find("--") {
            Some(idx) => &l[..idx],
            None => l,
        })
        .collect::<Vec<_>>()
        .join("\n");

    let upper = cleaned.to_ascii_uppercase();
    let mut search_from = 0usize;

    while let Some(rel_idx) = upper[search_from..].find("CREATE TABLE") {
        let start = search_from + rel_idx + "CREATE TABLE".len();
        let after_kw = cleaned[start..].trim_start();
        let after_if = if after_kw.to_ascii_uppercase().starts_with("IF NOT EXISTS") {
            after_kw["IF NOT EXISTS".len()..].trim_start()
        } else {
            after_kw
        };

        let Some(open_paren) = after_if.find('(') else {
            break;
        };
        let raw_table = after_if[..open_paren]
            .trim()
            .trim_matches(|c| c == '"' || c == '`' || c == '[' || c == ']');
        let table_name = to_pascal_case(raw_table.rsplit('.').next().unwrap_or(raw_table));

        // Find matching closing paren for the CREATE TABLE body.
        let body_start = open_paren + 1;
        let mut depth = 1usize;
        let mut body_end = body_start;
        for (i, ch) in after_if[body_start..].char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        body_end = body_start + i;
                        break;
                    }
                }
                _ => {}
            }
        }
        let body = &after_if[body_start..body_end];
        let mut clf = ImportedClassifier::new(&table_name, ClassifierKind::Class);

        for item in split_top_level_commas(body) {
            let trimmed = item.trim();
            if trimmed.is_empty() {
                continue;
            }
            let item_upper = trimmed.to_ascii_uppercase();

            // Table-level FOREIGN KEY (col) REFERENCES target(id)
            if item_upper.starts_with("FOREIGN KEY") || item_upper.starts_with("CONSTRAINT") {
                if let Some(ref_pos) = item_upper.find("REFERENCES") {
                    let after_ref = trimmed[ref_pos + "REFERENCES".len()..].trim_start();
                    let target_raw = after_ref
                        .split(|c: char| c.is_whitespace() || c == '(')
                        .next()
                        .unwrap_or("")
                        .trim_matches(|c| c == '"' || c == '`');
                    if !target_raw.is_empty() {
                        bundle.relations.push(ImportedRelation {
                            source_name: table_name.clone(),
                            target_name: to_pascal_case(target_raw),
                            kind: RelationKind::Association,
                            role_name: Some(target_raw.to_ascii_lowercase()),
                            target_multiplicity: Multiplicity::exactly_one(),
                            visibility: Visibility::Public,
                        });
                    }
                }
                continue;
            }
            if item_upper.starts_with("PRIMARY KEY")
                || item_upper.starts_with("UNIQUE")
                || item_upper.starts_with("CHECK")
            {
                continue;
            }

            // Column definition: `<name> <TYPE> [NOT NULL] [REFERENCES target(col)]`
            let mut parts = trimmed.split_whitespace();
            let Some(col_raw) = parts.next() else {
                continue;
            };
            let Some(type_raw) = parts.next() else {
                continue;
            };
            let col_name = col_raw.trim_matches(|c| c == '"' || c == '`');
            let base_type = type_raw.split('(').next().unwrap_or(type_raw);
            let uml_type = sql_type_to_uml(base_type);

            let mut prop = Property::new(col_name, TypeRef::external(uml_type));
            prop.visibility = Visibility::Public;
            prop.multiplicity = if item_upper.contains("NOT NULL") || item_upper.contains("PRIMARY KEY")
            {
                Multiplicity::exactly_one()
            } else {
                Multiplicity::optional()
            };
            clf.properties.push(prop);

            // Inline REFERENCES target(col)
            if let Some(ref_pos) = item_upper.find("REFERENCES") {
                let after_ref = trimmed[ref_pos + "REFERENCES".len()..].trim_start();
                let target_raw = after_ref
                    .split(|c: char| c.is_whitespace() || c == '(')
                    .next()
                    .unwrap_or("")
                    .trim_matches(|c| c == '"' || c == '`');
                if !target_raw.is_empty() {
                    let mult = if item_upper.contains("NOT NULL") {
                        Multiplicity::exactly_one()
                    } else {
                        Multiplicity::optional()
                    };
                    bundle.relations.push(ImportedRelation {
                        source_name: table_name.clone(),
                        target_name: to_pascal_case(target_raw),
                        kind: RelationKind::Association,
                        role_name: Some(col_name.trim_end_matches("_id").to_string()),
                        target_multiplicity: mult,
                        visibility: Visibility::Public,
                    });
                }
            }
        }

        bundle.classifiers.push(clf);
        search_from = start + body_end.min(cleaned.len().saturating_sub(start));
    }

    bundle
}

fn split_top_level_commas(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (i, ch) in s.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                parts.push(&s[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    if start < s.len() {
        parts.push(&s[start..]);
    }
    parts
}

fn sql_type_to_uml(sql_ty: &str) -> &'static str {
    match sql_ty.to_ascii_uppercase().as_str() {
        "INT" | "INTEGER" | "SMALLINT" | "SERIAL" => "int",
        "BIGINT" | "BIGSERIAL" => "i64",
        "FLOAT" | "DOUBLE" | "REAL" | "NUMERIC" | "DECIMAL" => "f64",
        "BOOL" | "BOOLEAN" => "bool",
        "UUID" => "uuid",
        "TIMESTAMP" | "TIMESTAMPTZ" | "DATE" | "DATETIME" => "datetime",
        _ => "string",
    }
}

fn to_pascal_case(raw: &str) -> String {
    raw.split('_')
        .filter(|s| !s.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}
