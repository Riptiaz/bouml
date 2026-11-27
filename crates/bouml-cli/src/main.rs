use bouml_ai::{
    apply_uml_patch, refactor_with_instruction, text_to_uml, uml_graph_patch_json_schema,
    AiProviderConfig, HttpLlmClient, UmlGraphPatch,
};
use bouml_codegen::{
    generate_project, roundtrip_bodies_from_dir, GenerateOptions, TargetLanguage,
};
use bouml_core::{
    validate_project, Classifier, ClassifierKind, Command, CommandHistory, Diagram, DiagramKind,
    Package, Project, Severity,
};
use bouml_importers::{import_path, ImportFormat};
use bouml_persistence::{import_legacy_prj, load_project, save_project};
use bouml_rpc::RpcServer;
use clap::{Parser, Subcommand, ValueEnum};
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "bouml",
    version,
    about = "BouML Next — Modern UML 2.5 Core Engine & CI/CD CLI"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Clone, Copy, ValueEnum)]
enum KindArg {
    Class,
    Interface,
    Enum,
    Datatype,
    Actor,
    Component,
}

impl From<KindArg> for ClassifierKind {
    fn from(k: KindArg) -> Self {
        match k {
            KindArg::Class => ClassifierKind::Class,
            KindArg::Interface => ClassifierKind::Interface,
            KindArg::Enum => ClassifierKind::Enumeration,
            KindArg::Datatype => ClassifierKind::DataType,
            KindArg::Actor => ClassifierKind::Actor,
            KindArg::Component => ClassifierKind::Component,
        }
    }
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new Git-friendly `.bouml/` UML 2.5 project directory
    Init {
        /// Target `.bouml/` project directory
        dir: PathBuf,
        /// Project name
        #[arg(short, long)]
        name: String,
    },
    /// Display project statistics and structure summary
    Info {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
    },
    /// Validate UML 2.5 structural integrity, inheritance cycles, and SOLID heuristics
    Validate {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
        /// Output diagnostics as JSON (for CI/CD integration)
        #[arg(long)]
        json: bool,
    },
    /// Migrate a historical BouML v4 `.prj` project into canonical `.bouml/` YAML format
    ImportPrj {
        /// Path to the legacy `.prj` file
        prj_file: PathBuf,
        /// Output `.bouml/` project directory
        #[arg(short, long)]
        out: PathBuf,
    },
    /// Add a new UML classifier (class, interface, enum, etc.) to a project
    AddClass {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
        /// Classifier name
        #[arg(short, long)]
        name: String,
        /// Target package name (created under root if missing; defaults to root package)
        #[arg(short, long)]
        package: Option<String>,
        /// Classifier kind
        #[arg(short, long, value_enum, default_value_t = KindArg::Class)]
        kind: KindArg,
    },
    /// Export the full UML 2.5 project model as normalized JSON
    ExportJson {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
        /// Optional output file (prints to stdout if omitted)
        #[arg(short, long)]
        out: Option<PathBuf>,
    },
    /// Generate source code from a `.bouml/` project with BouML preserved-body support
    Generate {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
        /// Target language (cpp, java, python, typescript, php, rust, go, sql)
        #[arg(short, long)]
        lang: String,
        /// Output directory for generated source files
        #[arg(short, long)]
        out: PathBuf,
        /// Disable preserved-body markers and disk body reuse
        #[arg(long)]
        no_preserve_bodies: bool,
        /// Compute files without writing to disk
        #[arg(long)]
        dry_run: bool,
    },
    /// Sync developer-edited preserved method bodies from source files back into `.bouml/`
    RoundtripBodies {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
        /// Source language (cpp, java, python, typescript, php, rust, go)
        #[arg(short, long)]
        lang: String,
        /// Source directory containing files with BouML preserved-body markers
        #[arg(short, long)]
        src: PathBuf,
    },
    /// Universal importer (Tree-sitter code, PlantUML, Mermaid, SQL DDL, OpenAPI, JSON Schema, XMI)
    Import {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
        /// Source file or directory to import
        source: PathBuf,
        /// Format override (auto, code, plantuml, mermaid, sql, openapi, json-schema, xmi)
        #[arg(short, long, default_value = "auto")]
        format: String,
        /// Optional custom name for the auto-generated diagram
        #[arg(long)]
        diagram_name: Option<String>,
    },
    /// Export the strict JSON Schema for AI Structured Outputs (`UmlGraphPatch`)
    AiSchema {
        /// Optional output file (prints to stdout if omitted)
        #[arg(short, long)]
        out: Option<PathBuf>,
    },
    /// Validate and atomically apply a `UmlGraphPatch` JSON file to a `.bouml/` project
    AiApply {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
        /// Path to the JSON patch file
        patch_file: PathBuf,
    },
    /// Text-to-UML: generate UML 2.5 diagrams & model from a natural-language specification
    AiGenerate {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
        /// LLM provider: openai, anthropic, or ollama
        #[arg(long, default_value = "ollama")]
        provider: String,
        /// Model name (e.g. gpt-4o, claude-3-5-sonnet-latest, qwen2.5-coder:14b)
        #[arg(long)]
        model: String,
        /// Specification text or path to a markdown/text spec file
        #[arg(long)]
        spec: String,
    },
    /// Conversational architecture refactoring on an existing `.bouml/` project
    AiRefactor {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
        /// LLM provider: openai, anthropic, or ollama
        #[arg(long, default_value = "ollama")]
        provider: String,
        /// Model name
        #[arg(long)]
        model: String,
        /// Refactoring instruction (e.g. "Add Strategy pattern on PaymentProcessor")
        #[arg(long)]
        prompt: String,
    },
    /// Start the JSON-RPC 2.0 / MCP stdio server on a `.bouml/` project
    Rpc {
        /// Path to the `.bouml/` project directory
        dir: PathBuf,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<ExitCode, Box<dyn std::error::Error>> {
    match cli.command {
        Commands::Init { dir, name } => {
            let mut project = Project::new(&name);
            let root_id = project.root_package_id.clone();
            let diag = Diagram::new(format!("{name} Overview"), DiagramKind::Class, root_id);
            let mut history = CommandHistory::new();
            history.execute(&mut project, Command::CreateDiagram(diag))?;
            save_project(&project, &dir)?;
            println!(
                "Initialized BouML Next project '{}' in {}",
                name,
                dir.display()
            );
            Ok(ExitCode::SUCCESS)
        }
        Commands::Info { dir } => {
            let project = load_project(&dir)?;
            let stats = project.stats();
            println!("Project:      {} (schema v{})", project.name, project.schema_version);
            println!("Languages:    {}", project.enabled_languages.join(", "));
            println!("Packages:     {}", stats.packages);
            println!("Classifiers:  {}", stats.classifiers);
            println!("Properties:   {}", stats.properties);
            println!("Operations:   {}", stats.operations);
            println!("Relations:    {}", stats.relations);
            println!("Interactions: {}", stats.interactions);
            println!("StateMachines:{}", stats.state_machines);
            println!("Activities:   {}", stats.activities);
            println!("Diagrams:     {}", stats.diagrams);
            Ok(ExitCode::SUCCESS)
        }
        Commands::Validate { dir, json } => {
            let project = load_project(&dir)?;
            let diagnostics = validate_project(&project);
            let error_count = diagnostics
                .iter()
                .filter(|d| d.severity == Severity::Error)
                .count();
            let warning_count = diagnostics
                .iter()
                .filter(|d| d.severity == Severity::Warning)
                .count();

            if json {
                println!("{}", serde_json::to_string_pretty(&diagnostics)?);
            } else if diagnostics.is_empty() {
                println!("OK: '{}' passed all UML 2.5 & SOLID checks.", project.name);
            } else {
                for d in &diagnostics {
                    let level = match d.severity {
                        Severity::Error => "ERROR",
                        Severity::Warning => "WARN ",
                        Severity::Info => "INFO ",
                    };
                    println!("[{level}] {} {}", d.code, d.message);
                }
                println!("Summary: {error_count} error(s), {warning_count} warning(s).");
            }

            if error_count > 0 {
                Ok(ExitCode::from(2))
            } else {
                Ok(ExitCode::SUCCESS)
            }
        }
        Commands::ImportPrj { prj_file, out } => {
            let report = import_legacy_prj(&prj_file)?;
            save_project(&report.project, &out)?;
            println!(
                "Imported legacy BouML v{} project '{}' -> {}",
                report.format_version,
                report.project.name,
                out.display()
            );
            println!(
                "  packages: {}, classifiers: {}, properties: {}, operations: {}, bodies: {}, relations: {}, diagrams: {}",
                report.imported_packages,
                report.imported_classifiers,
                report.imported_properties,
                report.imported_operations,
                report.imported_bodies,
                report.imported_relations,
                report.imported_diagrams
            );
            for w in &report.warnings {
                eprintln!("  warning: {w}");
            }
            Ok(ExitCode::SUCCESS)
        }
        Commands::AddClass {
            dir,
            name,
            package,
            kind,
        } => {
            let mut project = load_project(&dir)?;
            let mut history = CommandHistory::new();

            let pkg_id = match package {
                Some(pkg_name) => {
                    if let Some(existing) = project.find_package_by_name(&pkg_name) {
                        existing.meta.id.clone()
                    } else {
                        let new_pkg =
                            Package::new(pkg_name, Some(project.root_package_id.clone()));
                        let id = new_pkg.meta.id.clone();
                        history.execute(&mut project, Command::CreatePackage(new_pkg))?;
                        id
                    }
                }
                None => project.root_package_id.clone(),
            };

            let clf = Classifier::new(&name, pkg_id, kind.into());
            let clf_id = clf.meta.id.clone();
            history.execute(&mut project, Command::CreateClassifier(clf))?;
            save_project(&project, &dir)?;
            println!("Added classifier '{}' ({})", name, clf_id);
            Ok(ExitCode::SUCCESS)
        }
        Commands::ExportJson { dir, out } => {
            let project = load_project(&dir)?;
            let json = serde_json::to_string_pretty(&project)?;
            match out {
                Some(path) => {
                    fs::write(&path, json)?;
                    println!("Exported JSON model to {}", path.display());
                }
                None => println!("{json}"),
            }
            Ok(ExitCode::SUCCESS)
        }
        Commands::Generate {
            dir,
            lang,
            out,
            no_preserve_bodies,
            dry_run,
        } => {
            let language: TargetLanguage = lang.parse()?;
            let project = load_project(&dir)?;
            let report = generate_project(
                &project,
                &GenerateOptions {
                    language,
                    output_dir: out.clone(),
                    preserve_bodies: !no_preserve_bodies,
                    dry_run,
                },
            )?;
            println!(
                "Generated {} code for '{}' -> {} (written: {}, unchanged: {}, bodies preserved: {})",
                report.language,
                project.name,
                out.display(),
                report.files_written,
                report.files_unchanged,
                report.preserved_bodies_reused
            );
            Ok(ExitCode::SUCCESS)
        }
        Commands::RoundtripBodies { dir, lang, src } => {
            let language: TargetLanguage = lang.parse()?;
            let mut project = load_project(&dir)?;
            let report = roundtrip_bodies_from_dir(&mut project, &src, language)?;
            if report.bodies_updated > 0 {
                save_project(&project, &dir)?;
            }
            println!(
                "Round-tripped {} bodies from {} (files scanned: {}, updated: {}, unchanged: {})",
                report.language,
                src.display(),
                report.files_scanned,
                report.bodies_updated,
                report.bodies_unchanged
            );
            Ok(ExitCode::SUCCESS)
        }
        Commands::Import {
            dir,
            source,
            format,
            diagram_name,
        } => {
            let fmt: ImportFormat = format.parse()?;
            let mut project = load_project(&dir)?;
            let summary = import_path(&mut project, &source, fmt, diagram_name.as_deref())?;
            save_project(&project, &dir)?;
            println!(
                "Imported '{}' into '{}': +{} packages, +{} classifiers ({} updated), +{} relations, +{} auto-layout diagram(s)",
                summary.source_label,
                project.name,
                summary.packages_added,
                summary.classifiers_added,
                summary.classifiers_updated,
                summary.relations_added,
                summary.diagrams_created
            );
            for w in &summary.warnings {
                eprintln!("  warning: {w}");
            }
            Ok(ExitCode::SUCCESS)
        }
        Commands::AiSchema { out } => {
            let schema_json = serde_json::to_string_pretty(&uml_graph_patch_json_schema())?;
            match out {
                Some(path) => {
                    if let Some(parent) = path.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::write(&path, schema_json)?;
                    println!("Exported UmlGraphPatch JSON Schema to {}", path.display());
                }
                None => println!("{schema_json}"),
            }
            Ok(ExitCode::SUCCESS)
        }
        Commands::AiApply { dir, patch_file } => {
            let raw = fs::read_to_string(&patch_file)?;
            let patch: UmlGraphPatch = serde_json::from_str(&raw)?;
            let mut project = load_project(&dir)?;
            let mut history = CommandHistory::new();
            let report = apply_uml_patch(&mut project, &mut history, &patch)?;
            save_project(&project, &dir)?;
            println!(
                "Applied AI patch: {} (+{} classifiers, +{} relations, +{} interactions, +{} state machines, +{} diagrams)",
                report.summary,
                report.classifiers_created,
                report.relations_created,
                report.interactions_created,
                report.state_machines_created,
                report.diagrams_created
            );
            Ok(ExitCode::SUCCESS)
        }
        Commands::AiGenerate {
            dir,
            provider,
            model,
            spec,
        } => {
            let client = HttpLlmClient::new(build_provider(&provider, &model)?);
            let spec_text = if PathBuf::from(&spec).is_file() {
                fs::read_to_string(&spec)?
            } else {
                spec
            };
            let mut project = load_project(&dir)?;
            let mut history = CommandHistory::new();
            let report = text_to_uml(&client, &mut project, &mut history, &spec_text)?;
            save_project(&project, &dir)?;
            println!(
                "AI Text-to-UML complete: {} (+{} classifiers, +{} relations, +{} diagrams)",
                report.summary,
                report.classifiers_created,
                report.relations_created,
                report.diagrams_created
            );
            Ok(ExitCode::SUCCESS)
        }
        Commands::AiRefactor {
            dir,
            provider,
            model,
            prompt,
        } => {
            let client = HttpLlmClient::new(build_provider(&provider, &model)?);
            let mut project = load_project(&dir)?;
            let mut history = CommandHistory::new();
            let report = refactor_with_instruction(&client, &mut project, &mut history, &prompt)?;
            save_project(&project, &dir)?;
            println!(
                "AI Refactoring applied: {} (+{} classifiers, +{} relations, +{} diagrams)",
                report.summary,
                report.classifiers_created,
                report.relations_created,
                report.diagrams_created
            );
            Ok(ExitCode::SUCCESS)
        }
        Commands::Rpc { dir } => {
            let project = load_project(&dir)?;
            let mut server = RpcServer::new(project, Some(dir));
            server.serve_stdio()?;
            Ok(ExitCode::SUCCESS)
        }
    }
}

fn build_provider(provider: &str, model: &str) -> Result<AiProviderConfig, Box<dyn std::error::Error>> {
    match provider.to_ascii_lowercase().as_str() {
        "openai" => {
            let key = std::env::var("OPENAI_API_KEY")
                .map_err(|_| "OPENAI_API_KEY environment variable is required for openai provider")?;
            Ok(AiProviderConfig::openai(key, model))
        }
        "anthropic" => {
            let key = std::env::var("ANTHROPIC_API_KEY")
                .map_err(|_| "ANTHROPIC_API_KEY environment variable is required for anthropic provider")?;
            Ok(AiProviderConfig::anthropic(key, model))
        }
        "ollama" => Ok(AiProviderConfig::ollama(model)),
        other => Err(format!("unsupported provider '{other}' (use openai, anthropic, or ollama)").into()),
    }
}
