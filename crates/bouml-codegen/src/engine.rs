use crate::languages::{generate_classifier_files, GeneratedFile, TargetLanguage};
use crate::preserved_bodies::{scan_preserved_bodies, PreservedBodyError};
use bouml_core::{ElementId, Project};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CodegenError {
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("preserved body error in {path}: {source}")]
    PreservedBody {
        path: PathBuf,
        #[source]
        source: PreservedBodyError,
    },
    #[error("classifier not found: {0}")]
    ClassifierNotFound(ElementId),
}

#[derive(Debug, Clone)]
pub struct GenerateOptions {
    pub language: TargetLanguage,
    pub output_dir: PathBuf,
    pub preserve_bodies: bool,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationReport {
    pub language: TargetLanguage,
    pub files_written: usize,
    pub files_unchanged: usize,
    pub preserved_bodies_reused: usize,
    pub generated_files: Vec<GeneratedFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundtripReport {
    pub language: TargetLanguage,
    pub files_scanned: usize,
    pub bodies_updated: usize,
    pub bodies_unchanged: usize,
}

/// Generates code for all classifiers in `project`.
/// Preserves BouML's signature behaviors:
/// 1. Pre-scans existing files on disk to preserve developer-edited method bodies (`preserve_bodies`).
/// 2. Writes files to disk **only when content actually differs** (`must_be_saved`), avoiding build churn.
pub fn generate_project(
    project: &Project,
    opts: &GenerateOptions,
) -> Result<GenerationReport, CodegenError> {
    let mut disk_bodies: BTreeMap<String, String> = BTreeMap::new();
    if opts.preserve_bodies && opts.output_dir.exists() {
        scan_dir_bodies(&opts.output_dir, opts.language, &mut disk_bodies)?;
    }

    let mut all_files = Vec::new();
    let mut files_written = 0usize;
    let mut files_unchanged = 0usize;

    for clf in project.classifiers.values() {
        let generated = generate_classifier_files(
            project,
            clf,
            opts.language,
            opts.preserve_bodies,
            &disk_bodies,
        );

        for file in generated {
            let full_path = opts.output_dir.join(&file.relative_path);
            let unchanged = fs::read_to_string(&full_path)
                .map(|existing| existing == file.content)
                .unwrap_or(false);

            if unchanged {
                files_unchanged += 1;
            } else {
                if !opts.dry_run {
                    if let Some(parent) = full_path.parent() {
                        fs::create_dir_all(parent).map_err(|source| CodegenError::Io {
                            path: parent.to_path_buf(),
                            source,
                        })?;
                    }
                    fs::write(&full_path, &file.content).map_err(|source| CodegenError::Io {
                        path: full_path,
                        source,
                    })?;
                }
                files_written += 1;
            }
            all_files.push(file);
        }
    }

    Ok(GenerationReport {
        language: opts.language,
        files_written,
        files_unchanged,
        preserved_bodies_reused: disk_bodies.len(),
        generated_files: all_files,
    })
}

/// Generates an in-memory live code preview for a single classifier (used by UI side panel).
pub fn preview_classifier(
    project: &Project,
    classifier_id: &ElementId,
    lang: TargetLanguage,
    preserve_bodies: bool,
) -> Result<Vec<GeneratedFile>, CodegenError> {
    let clf = project
        .classifiers
        .get(classifier_id)
        .ok_or_else(|| CodegenError::ClassifierNotFound(classifier_id.clone()))?;
    Ok(generate_classifier_files(
        project,
        clf,
        lang,
        preserve_bodies,
        &BTreeMap::new(),
    ))
}

/// Bidirectional round-trip: scans `source_dir` for BouML preserved-body markers and syncs
/// modified method bodies back into `project`'s UML 2.5 operations.
pub fn roundtrip_bodies_from_dir(
    project: &mut Project,
    source_dir: &Path,
    lang: TargetLanguage,
) -> Result<RoundtripReport, CodegenError> {
    let mut disk_bodies = BTreeMap::new();
    let files_scanned = scan_dir_bodies(source_dir, lang, &mut disk_bodies)?;

    let mut bodies_updated = 0usize;
    let mut bodies_unchanged = 0usize;
    let lang_key = lang.key().to_string();

    for clf in project.classifiers.values_mut() {
        for op in &mut clf.operations {
            if let Some(new_body) = disk_bodies.get(op.meta.id.as_str()) {
                let current = op.bodies.get(&lang_key);
                if current.map(|s| s.as_str()) != Some(new_body.as_str()) {
                    op.bodies.insert(lang_key.clone(), new_body.clone());
                    bodies_updated += 1;
                } else {
                    bodies_unchanged += 1;
                }
            }
        }
    }

    Ok(RoundtripReport {
        language: lang,
        files_scanned,
        bodies_updated,
        bodies_unchanged,
    })
}

fn scan_dir_bodies(
    dir: &Path,
    lang: TargetLanguage,
    out: &mut BTreeMap<String, String>,
) -> Result<usize, CodegenError> {
    let mut count = 0usize;
    let exts = lang.extensions();
    let entries = fs::read_dir(dir).map_err(|source| CodegenError::Io {
        path: dir.to_path_buf(),
        source,
    })?;

    for entry in entries {
        let entry = entry.map_err(|source| CodegenError::Io {
            path: dir.to_path_buf(),
            source,
        })?;
        let path = entry.path();
        if path.is_dir() {
            count += scan_dir_bodies(&path, lang, out)?;
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| exts.contains(&e))
        {
            let content = fs::read_to_string(&path).map_err(|source| CodegenError::Io {
                path: path.clone(),
                source,
            })?;
            let found = scan_preserved_bodies(&content, lang.comment_prefix()).map_err(
                |source| CodegenError::PreservedBody {
                    path: path.clone(),
                    source,
                },
            )?;
            out.extend(found);
            count += 1;
        }
    }
    Ok(count)
}
