use bouml_core::ElementId;
use std::collections::BTreeMap;
use thiserror::Error;

pub const BEGIN_MARKER: &str = "Bouml preserved body begin ";
pub const END_MARKER: &str = "Bouml preserved body end ";

#[derive(Debug, Error)]
pub enum PreservedBodyError {
    #[error("unclosed preserved body block for operation '{0}'")]
    UnclosedBlock(String),
    #[error("unexpected end marker for operation '{found}' (expected '{expected}')")]
    MismatchedEnd { expected: String, found: String },
    #[error("duplicate preserved body block for operation '{0}'")]
    DuplicateBlock(String),
}

/// Scans a source file and extracts all preserved operation bodies keyed by their operation ID.
/// Mirrors BouML's `UmlOperation::read_bodies()` with strict balance and uniqueness checks.
pub fn scan_preserved_bodies(
    source: &str,
    comment_prefix: &str,
) -> Result<BTreeMap<String, String>, PreservedBodyError> {
    let begin_tag = format!("{comment_prefix} {BEGIN_MARKER}");
    let end_tag = format!("{comment_prefix} {END_MARKER}");

    let mut bodies = BTreeMap::new();
    let mut active: Option<(String, String)> = None;

    for line in source.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix(&begin_tag) {
            let id = rest.trim().to_string();
            if let Some((prev_id, _)) = active {
                return Err(PreservedBodyError::UnclosedBlock(prev_id));
            }
            if bodies.contains_key(&id) {
                return Err(PreservedBodyError::DuplicateBlock(id));
            }
            active = Some((id, String::new()));
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix(&end_tag) {
            let found = rest.trim().to_string();
            let Some((expected, content)) = active.take() else {
                return Err(PreservedBodyError::MismatchedEnd {
                    expected: "<none>".to_string(),
                    found,
                });
            };
            if expected != found {
                return Err(PreservedBodyError::MismatchedEnd { expected, found });
            }
            bodies.insert(found, dedent_common(content.trim_end_matches('\n')));
            continue;
        }
        if let Some((_, ref mut buf)) = active {
            buf.push_str(line);
            buf.push('\n');
        }
    }

    if let Some((unclosed, _)) = active {
        return Err(PreservedBodyError::UnclosedBlock(unclosed));
    }

    Ok(bodies)
}

/// Renders an operation body, optionally wrapped in BouML preserved-body markers.
pub fn render_operation_body(
    op_id: &ElementId,
    body: &str,
    preserve_bodies: bool,
    comment_prefix: &str,
    indent: &str,
) -> String {
    let mut out = String::new();
    if preserve_bodies {
        out.push_str(&format!(
            "{indent}{comment_prefix} {BEGIN_MARKER}{}\n",
            op_id.as_str()
        ));
    }
    if !body.is_empty() {
        for line in body.lines() {
            if line.trim().is_empty() {
                out.push('\n');
            } else {
                out.push_str(indent);
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    if preserve_bodies {
        out.push_str(&format!(
            "{indent}{comment_prefix} {END_MARKER}{}\n",
            op_id.as_str()
        ));
    }
    out
}

fn dedent_common(text: &str) -> String {
    let min_indent = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);

    if min_indent == 0 {
        return text.to_string();
    }

    text.lines()
        .map(|l| {
            if l.len() >= min_indent {
                &l[min_indent..]
            } else {
                l.trim_start()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
