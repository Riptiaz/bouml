use bouml_core::{
    validate_project, Classifier, ClassifierKind, Command, CommandHistory, Diagram, DiagramKind,
    Package, Project, Severity,
};
use bouml_persistence::{import_legacy_prj, load_project, save_project};
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
    }
}
