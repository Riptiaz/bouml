use bouml_core::{
    Activity, Classifier, Diagram, ElementId, Interaction, Package, Project, Relation, StateMachine,
    SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("YAML serialization/deserialization error at {path}: {source}")]
    Yaml {
        path: PathBuf,
        #[source]
        source: serde_yaml::Error,
    },
    #[error("invalid project directory: {0}")]
    InvalidProject(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProjectManifest {
    schema_version: u32,
    name: String,
    root_package_id: ElementId,
    #[serde(default)]
    enabled_languages: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    codegen_settings: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RelationsFile {
    relations: Vec<Relation>,
}

/// Saves a UML 2.5 `Project` into a canonical, Git-friendly multi-file `.bouml/` directory.
///
/// Layout:
/// - `project.yaml`: root metadata & language settings
/// - `model/<pkg-path>/package.yaml`: package metadata
/// - `model/<pkg-path>/<classifier-slug>.yaml`: one file per classifier
/// - `model/<pkg-path>/relations.yaml`: relations originating in that package
/// - `model/<pkg-path>/behaviors/*.yaml`: interactions, state machines, activities
/// - `diagrams/<diagram-slug>.diagram.yaml`: decoupled diagram views
pub fn save_project(project: &Project, dir: &Path) -> Result<(), PersistenceError> {
    fs::create_dir_all(dir).map_err(|source| PersistenceError::Io {
        path: dir.to_path_buf(),
        source,
    })?;

    // 1. Write project.yaml
    let manifest = ProjectManifest {
        schema_version: project.schema_version.max(SCHEMA_VERSION),
        name: project.name.clone(),
        root_package_id: project.root_package_id.clone(),
        enabled_languages: project.enabled_languages.clone(),
        codegen_settings: project.codegen_settings.clone(),
    };
    write_yaml_if_changed(&dir.join("project.yaml"), &manifest)?;

    // Track written files under model/ and diagrams/ so deleted elements are cleaned up.
    let mut written_files: BTreeSet<PathBuf> = BTreeSet::new();

    // 2. Compute deterministic directory paths for each package.
    let model_root = dir.join("model");
    fs::create_dir_all(&model_root).map_err(|source| PersistenceError::Io {
        path: model_root.clone(),
        source,
    })?;

    let mut pkg_dirs: BTreeMap<ElementId, PathBuf> = BTreeMap::new();
    compute_package_dirs(project, &project.root_package_id, &model_root, &mut pkg_dirs);

    // Group relations by source classifier's package for clean, conflict-free diffs.
    let mut rels_by_pkg: BTreeMap<ElementId, Vec<Relation>> = BTreeMap::new();
    for rel in project.relations.values() {
        let pkg_id = project
            .classifiers
            .get(&rel.source.classifier_id)
            .map(|c| c.package_id.clone())
            .unwrap_or_else(|| project.root_package_id.clone());
        rels_by_pkg.entry(pkg_id).or_default().push(rel.clone());
    }

    // 3. Write each package, its classifiers, relations, and behaviors.
    for (pkg_id, pkg_dir) in &pkg_dirs {
        let Some(pkg) = project.packages.get(pkg_id) else {
            continue;
        };
        fs::create_dir_all(pkg_dir).map_err(|source| PersistenceError::Io {
            path: pkg_dir.clone(),
            source,
        })?;

        let pkg_file = pkg_dir.join("package.yaml");
        write_yaml_if_changed(&pkg_file, pkg)?;
        written_files.insert(pkg_file);

        // Classifiers in this package (deterministic filenames, disambiguated on collision).
        let mut used_names: BTreeSet<String> = BTreeSet::new();
        used_names.insert("package".to_string());
        used_names.insert("relations".to_string());

        let mut pkg_classifiers: Vec<&Classifier> = project
            .classifiers
            .values()
            .filter(|c| &c.package_id == pkg_id)
            .collect();
        pkg_classifiers.sort_by(|a, b| {
            a.meta
                .name
                .cmp(&b.meta.name)
                .then_with(|| a.meta.id.cmp(&b.meta.id))
        });

        for clf in pkg_classifiers {
            let stem = unique_slug(&clf.meta.name, &clf.meta.id, &mut used_names);
            let clf_file = pkg_dir.join(format!("{stem}.yaml"));
            write_yaml_if_changed(&clf_file, clf)?;
            written_files.insert(clf_file);
        }

        // Relations originating from this package.
        if let Some(mut rels) = rels_by_pkg.remove(pkg_id) {
            rels.sort_by(|a, b| a.meta.id.cmp(&b.meta.id));
            if !rels.is_empty() {
                let rel_file = pkg_dir.join("relations.yaml");
                write_yaml_if_changed(&rel_file, &RelationsFile { relations: rels })?;
                written_files.insert(rel_file);
            }
        }

        // Behaviors in this package.
        let interactions: Vec<&Interaction> = project
            .interactions
            .values()
            .filter(|i| &i.package_id == pkg_id)
            .collect();
        let state_machines: Vec<&StateMachine> = project
            .state_machines
            .values()
            .filter(|s| &s.package_id == pkg_id)
            .collect();
        let activities: Vec<&Activity> = project
            .activities
            .values()
            .filter(|a| &a.package_id == pkg_id)
            .collect();

        if !interactions.is_empty() || !state_machines.is_empty() || !activities.is_empty() {
            let beh_dir = pkg_dir.join("behaviors");
            fs::create_dir_all(&beh_dir).map_err(|source| PersistenceError::Io {
                path: beh_dir.clone(),
                source,
            })?;
            let mut beh_names: BTreeSet<String> = BTreeSet::new();
            for inter in interactions {
                let stem = unique_slug(&inter.meta.name, &inter.meta.id, &mut beh_names);
                let path = beh_dir.join(format!("{stem}.interaction.yaml"));
                write_yaml_if_changed(&path, inter)?;
                written_files.insert(path);
            }
            for sm in state_machines {
                let stem = unique_slug(&sm.meta.name, &sm.meta.id, &mut beh_names);
                let path = beh_dir.join(format!("{stem}.statemachine.yaml"));
                write_yaml_if_changed(&path, sm)?;
                written_files.insert(path);
            }
            for act in activities {
                let stem = unique_slug(&act.meta.name, &act.meta.id, &mut beh_names);
                let path = beh_dir.join(format!("{stem}.activity.yaml"));
                write_yaml_if_changed(&path, act)?;
                written_files.insert(path);
            }
        }
    }

    // 4. Write diagrams.
    let diag_dir = dir.join("diagrams");
    if !project.diagrams.is_empty() {
        fs::create_dir_all(&diag_dir).map_err(|source| PersistenceError::Io {
            path: diag_dir.clone(),
            source,
        })?;
        let mut diag_names: BTreeSet<String> = BTreeSet::new();
        let mut diagrams: Vec<&Diagram> = project.diagrams.values().collect();
        diagrams.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        for diag in diagrams {
            let stem = unique_slug(&diag.name, &diag.id, &mut diag_names);
            let path = diag_dir.join(format!("{stem}.diagram.yaml"));
            write_yaml_if_changed(&path, diag)?;
            written_files.insert(path);
        }
    }

    // 5. Prune stale YAML files from removed elements.
    prune_stale_yaml(&model_root, &written_files)?;
    if diag_dir.exists() {
        prune_stale_yaml(&diag_dir, &written_files)?;
    }

    Ok(())
}

/// Loads a UML 2.5 `Project` from a canonical `.bouml/` directory.
pub fn load_project(dir: &Path) -> Result<Project, PersistenceError> {
    let manifest_path = dir.join("project.yaml");
    if !manifest_path.exists() {
        return Err(PersistenceError::InvalidProject(format!(
            "missing project.yaml in '{}'",
            dir.display()
        )));
    }

    let manifest: ProjectManifest = read_yaml(&manifest_path)?;
    let mut project = Project {
        schema_version: manifest.schema_version,
        name: manifest.name,
        root_package_id: manifest.root_package_id,
        enabled_languages: manifest.enabled_languages,
        codegen_settings: manifest.codegen_settings,
        packages: BTreeMap::new(),
        classifiers: BTreeMap::new(),
        relations: BTreeMap::new(),
        interactions: BTreeMap::new(),
        state_machines: BTreeMap::new(),
        activities: BTreeMap::new(),
        diagrams: BTreeMap::new(),
    };

    let model_root = dir.join("model");
    if model_root.exists() {
        load_model_dir(&model_root, &mut project)?;
    }

    let diag_dir = dir.join("diagrams");
    if diag_dir.exists() {
        for path in collect_yaml_files(&diag_dir)? {
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".diagram.yaml"))
            {
                let diag: Diagram = read_yaml(&path)?;
                project.diagrams.insert(diag.id.clone(), diag);
            }
        }
    }

    Ok(project)
}

fn load_model_dir(dir: &Path, project: &mut Project) -> Result<(), PersistenceError> {
    for path in collect_yaml_files(dir)? {
        let Some(fname) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if fname == "package.yaml" {
            let pkg: Package = read_yaml(&path)?;
            project.packages.insert(pkg.meta.id.clone(), pkg);
        } else if fname == "relations.yaml" {
            let rf: RelationsFile = read_yaml(&path)?;
            for rel in rf.relations {
                project.relations.insert(rel.meta.id.clone(), rel);
            }
        } else if fname.ends_with(".interaction.yaml") {
            let inter: Interaction = read_yaml(&path)?;
            project.interactions.insert(inter.meta.id.clone(), inter);
        } else if fname.ends_with(".statemachine.yaml") {
            let sm: StateMachine = read_yaml(&path)?;
            project.state_machines.insert(sm.meta.id.clone(), sm);
        } else if fname.ends_with(".activity.yaml") {
            let act: Activity = read_yaml(&path)?;
            project.activities.insert(act.meta.id.clone(), act);
        } else if fname.ends_with(".yaml") {
            let clf: Classifier = read_yaml(&path)?;
            project.classifiers.insert(clf.meta.id.clone(), clf);
        }
    }
    Ok(())
}

fn compute_package_dirs(
    project: &Project,
    pkg_id: &ElementId,
    current_dir: &Path,
    out: &mut BTreeMap<ElementId, PathBuf>,
) {
    if out.contains_key(pkg_id) {
        return;
    }
    out.insert(pkg_id.clone(), current_dir.to_path_buf());
    let Some(pkg) = project.packages.get(pkg_id) else {
        return;
    };
    let mut used: BTreeSet<String> = BTreeSet::new();
    used.insert("behaviors".to_string());
    let mut children: Vec<&Package> = pkg
        .subpackages
        .iter()
        .filter_map(|id| project.packages.get(id))
        .collect();
    children.sort_by(|a, b| {
        a.meta
            .name
            .cmp(&b.meta.name)
            .then_with(|| a.meta.id.cmp(&b.meta.id))
    });
    for child in children {
        let slug = unique_slug(&child.meta.name, &child.meta.id, &mut used);
        compute_package_dirs(project, &child.meta.id, &current_dir.join(slug), out);
    }
}

fn write_yaml_if_changed<T: Serialize>(path: &Path, value: &T) -> Result<(), PersistenceError> {
    let serialized = serde_yaml::to_string(value).map_err(|source| PersistenceError::Yaml {
        path: path.to_path_buf(),
        source,
    })?;
    if let Ok(existing) = fs::read_to_string(path) {
        if existing == serialized {
            return Ok(());
        }
    }
    fs::write(path, serialized).map_err(|source| PersistenceError::Io {
        path: path.to_path_buf(),
        source,
    })
}

fn read_yaml<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, PersistenceError> {
    let content = fs::read_to_string(path).map_err(|source| PersistenceError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    serde_yaml::from_str(&content).map_err(|source| PersistenceError::Yaml {
        path: path.to_path_buf(),
        source,
    })
}

fn collect_yaml_files(dir: &Path) -> Result<Vec<PathBuf>, PersistenceError> {
    let mut files = Vec::new();
    collect_yaml_recursive(dir, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_yaml_recursive(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), PersistenceError> {
    let entries = fs::read_dir(dir).map_err(|source| PersistenceError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    for entry in entries {
        let entry = entry.map_err(|source| PersistenceError::Io {
            path: dir.to_path_buf(),
            source,
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_yaml_recursive(&path, out)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
            out.push(path);
        }
    }
    Ok(())
}

fn prune_stale_yaml(
    dir: &Path,
    keep: &BTreeSet<PathBuf>,
) -> Result<(), PersistenceError> {
    for path in collect_yaml_files(dir)? {
        if !keep.contains(&path) {
            fs::remove_file(&path).map_err(|source| PersistenceError::Io {
                path,
                source,
            })?;
        }
    }
    Ok(())
}

fn slugify(name: &str) -> String {
    let mut slug = String::with_capacity(name.len() + 4);
    let mut prev_is_lower_or_digit = false;
    let mut prev_underscore = false;

    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if ch.is_ascii_uppercase() && prev_is_lower_or_digit && !prev_underscore {
                slug.push('_');
            }
            slug.push(ch.to_ascii_lowercase());
            prev_is_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
            prev_underscore = false;
        } else if !prev_underscore && !slug.is_empty() {
            slug.push('_');
            prev_underscore = true;
            prev_is_lower_or_digit = false;
        }
    }
    let trimmed = slug.trim_end_matches('_');
    if trimmed.is_empty() {
        "unnamed".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_slug(name: &str, id: &ElementId, used: &mut BTreeSet<String>) -> String {
    let base = slugify(name);
    if used.insert(base.clone()) {
        return base;
    }
    let disambiguated = format!("{base}_{}", id.short().to_ascii_lowercase());
    used.insert(disambiguated.clone());
    disambiguated
}
