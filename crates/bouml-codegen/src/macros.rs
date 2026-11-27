use std::collections::BTreeMap;

/// Fast single-pass macro & alias expansion engine preserving BouML's template DNA.
///
/// Supports:
/// - `${var}` template variables (e.g., `${comment}`, `${name}`, `${Name}`, `${NAME}`, `${type}`, `${body}`, `${t0}`, `${p0}`)
/// - `@{key}` user-defined tagged-value / property aliases
#[derive(Debug, Default, Clone)]
pub struct TemplateContext {
    vars: BTreeMap<String, String>,
    aliases: BTreeMap<String, String>,
}

impl TemplateContext {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>) -> &mut Self {
        self.vars.insert(key.into(), value.into());
        self
    }

    /// Sets `${name}` along with BouML's standard case variants `${Name}` and `${NAME}`.
    pub fn set_name_variants(&mut self, name: &str) -> &mut Self {
        self.set("name", name);
        self.set("NAME", name.to_ascii_uppercase());
        let mut chars = name.chars();
        let capitalized = match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => String::new(),
        };
        self.set("Name", capitalized);
        self
    }

    pub fn set_alias(&mut self, key: impl Into<String>, value: impl Into<String>) -> &mut Self {
        self.aliases.insert(key.into(), value.into());
        self
    }

    pub fn extend_aliases(&mut self, map: &BTreeMap<String, String>) -> &mut Self {
        for (k, v) in map {
            self.aliases.insert(k.clone(), v.clone());
        }
        self
    }

    /// Expands all `${var}` and `@{alias}` tokens in `template` in a single linear pass.
    pub fn expand(&self, template: &str) -> String {
        let mut out = String::with_capacity(template.len());
        let bytes = template.as_bytes();
        let mut i = 0;

        while i < bytes.len() {
            let b = bytes[i];
            if (b == b'$' || b == b'@') && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
                if let Some(rel_end) = template[i + 2..].find('}') {
                    let key = &template[i + 2..i + 2 + rel_end];
                    let replacement = if b == b'$' {
                        self.vars.get(key)
                    } else {
                        self.aliases.get(key)
                    };
                    if let Some(val) = replacement {
                        out.push_str(val);
                    }
                    i = i + 2 + rel_end + 1;
                    continue;
                }
            }
            // Copy one UTF-8 char safely.
            let ch = template[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }

        out
    }
}

/// Formats a documentation comment block using the target language's comment style.
pub fn format_doc_comment(comment: &str, style: CommentStyle, indent: &str) -> String {
    let trimmed = comment.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    match style {
        CommentStyle::SlashDoc => {
            let mut out = format!("{indent}/**\n");
            for line in trimmed.lines() {
                out.push_str(&format!("{indent} * {}\n", line.trim_end()));
            }
            out.push_str(&format!("{indent} */\n"));
            out
        }
        CommentStyle::RustDoc => {
            let mut out = String::new();
            for line in trimmed.lines() {
                out.push_str(&format!("{indent}/// {}\n", line.trim_end()));
            }
            out
        }
        CommentStyle::PythonDocstring => {
            if !trimmed.contains('\n') {
                format!("{indent}\"\"\"{trimmed}\"\"\"\n")
            } else {
                let mut out = format!("{indent}\"\"\"\n");
                for line in trimmed.lines() {
                    out.push_str(&format!("{indent}{}\n", line.trim_end()));
                }
                out.push_str(&format!("{indent}\"\"\"\n"));
                out
            }
        }
        CommentStyle::LineSlash => {
            let mut out = String::new();
            for line in trimmed.lines() {
                out.push_str(&format!("{indent}// {}\n", line.trim_end()));
            }
            out
        }
        CommentStyle::SqlDash => {
            let mut out = String::new();
            for line in trimmed.lines() {
                out.push_str(&format!("{indent}-- {}\n", line.trim_end()));
            }
            out
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommentStyle {
    SlashDoc,
    RustDoc,
    PythonDocstring,
    LineSlash,
    SqlDash,
}
