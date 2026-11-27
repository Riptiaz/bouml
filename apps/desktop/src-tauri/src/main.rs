#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use bouml_ai::{
    apply_uml_patch, refactor_with_instruction, text_to_uml, AiProviderConfig, HttpLlmClient,
    PatchApplyReport, UmlGraphPatch,
};
use bouml_codegen::{
    generate_project, preview_classifier, GenerateOptions, GeneratedFile, GenerationReport,
    TargetLanguage,
};
use bouml_core::{
    validate_project, Command, CommandHistory, Diagnostic, ElementId, Project,
};
use bouml_importers::{import_path, ImportFormat, ImportSummary};
use bouml_persistence::{import_legacy_prj, load_project, save_project};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    project: Project,
    history: CommandHistory,
    project_path: Option<PathBuf>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            project: Project::new("Untitled"),
            history: CommandHistory::new(),
            project_path: None,
        }
    }
}

#[tauri::command]
fn get_project(state: State<'_, Mutex<AppState>>) -> Result<Project, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.project.clone())
}

#[tauri::command]
fn open_project(path: String, state: State<'_, Mutex<AppState>>) -> Result<Project, String> {
    let p = PathBuf::from(path);
    let project = load_project(&p).map_err(|e| e.to_string())?;
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.project = project.clone();
    guard.history = CommandHistory::new();
    guard.project_path = Some(p);
    Ok(project)
}

#[tauri::command]
fn save_current_project(
    path: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let target = match path {
        Some(p) => {
            let pb = PathBuf::from(p);
            guard.project_path = Some(pb.clone());
            pb
        }
        None => guard
            .project_path
            .clone()
            .ok_or_else(|| "no project path configured".to_string())?,
    };
    save_project(&guard.project, &target).map_err(|e| e.to_string())
}

#[tauri::command]
fn execute_command(cmd: Command, state: State<'_, Mutex<AppState>>) -> Result<Project, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let AppState {
        ref mut project,
        ref mut history,
        ..
    } = *guard;
    history.execute(project, cmd).map_err(|e| e.to_string())?;
    Ok(project.clone())
}

#[tauri::command]
fn undo_command(state: State<'_, Mutex<AppState>>) -> Result<Project, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let AppState {
        ref mut project,
        ref mut history,
        ..
    } = *guard;
    history.undo(project).map_err(|e| e.to_string())?;
    Ok(project.clone())
}

#[tauri::command]
fn redo_command(state: State<'_, Mutex<AppState>>) -> Result<Project, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let AppState {
        ref mut project,
        ref mut history,
        ..
    } = *guard;
    history.redo(project).map_err(|e| e.to_string())?;
    Ok(project.clone())
}

#[tauri::command]
fn validate_current_project(
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<Diagnostic>, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(validate_project(&guard.project))
}

#[tauri::command]
fn preview_code(
    classifier_id: String,
    language: String,
    preserve_bodies: bool,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<GeneratedFile>, String> {
    let lang: TargetLanguage = language.parse()?;
    let guard = state.lock().map_err(|e| e.to_string())?;
    let id = ElementId::from_raw(classifier_id);
    preview_classifier(&guard.project, &id, lang, preserve_bodies).map_err(|e| e.to_string())
}

#[tauri::command]
fn generate_code_to_dir(
    language: String,
    output_dir: String,
    preserve_bodies: bool,
    state: State<'_, Mutex<AppState>>,
) -> Result<GenerationReport, String> {
    let lang: TargetLanguage = language.parse()?;
    let guard = state.lock().map_err(|e| e.to_string())?;
    generate_project(
        &guard.project,
        &GenerateOptions {
            language: lang,
            output_dir: PathBuf::from(output_dir),
            preserve_bodies,
            dry_run: false,
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn import_source_path(
    source_path: String,
    format: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<(Project, ImportSummary), String> {
    let fmt: ImportFormat = format
        .unwrap_or_else(|| "auto".to_string())
        .parse()?;
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let summary = import_path(&mut guard.project, &PathBuf::from(source_path), fmt, None)
        .map_err(|e| e.to_string())?;
    Ok((guard.project.clone(), summary))
}

#[tauri::command]
fn import_legacy_bouml_prj(
    prj_path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Project, String> {
    let report = import_legacy_prj(&PathBuf::from(prj_path)).map_err(|e| e.to_string())?;
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.project = report.project.clone();
    guard.history = CommandHistory::new();
    Ok(report.project)
}

fn build_ai_provider(
    provider: &str,
    model: &str,
    api_key: Option<String>,
    host: Option<String>,
) -> Result<AiProviderConfig, String> {
    match provider.to_ascii_lowercase().as_str() {
        "openai" => {
            let key = api_key
                .filter(|k| !k.trim().is_empty())
                .or_else(|| std::env::var("OPENAI_API_KEY").ok())
                .ok_or_else(|| "OpenAI API key is required".to_string())?;
            Ok(AiProviderConfig::openai(key, model))
        }
        "anthropic" => {
            let key = api_key
                .filter(|k| !k.trim().is_empty())
                .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
                .ok_or_else(|| "Anthropic API key is required".to_string())?;
            Ok(AiProviderConfig::anthropic(key, model))
        }
        "ollama" => Ok(AiProviderConfig::Ollama {
            host: host
                .filter(|h| !h.trim().is_empty())
                .unwrap_or_else(|| "http://127.0.0.1:11434".to_string()),
            model: model.to_string(),
        }),
        other => Err(format!("Unsupported AI provider '{other}'")),
    }
}

#[tauri::command]
fn ai_text_to_uml(
    provider: String,
    model: String,
    api_key: Option<String>,
    host: Option<String>,
    spec: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(Project, PatchApplyReport), String> {
    let cfg = build_ai_provider(&provider, &model, api_key, host)?;
    let client = HttpLlmClient::new(cfg);
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let AppState {
        ref mut project,
        ref mut history,
        ..
    } = *guard;
    let report = text_to_uml(&client, project, history, &spec).map_err(|e| e.to_string())?;
    Ok((project.clone(), report))
}

#[tauri::command]
fn ai_refactor(
    provider: String,
    model: String,
    api_key: Option<String>,
    host: Option<String>,
    prompt: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<(Project, PatchApplyReport), String> {
    let cfg = build_ai_provider(&provider, &model, api_key, host)?;
    let client = HttpLlmClient::new(cfg);
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let AppState {
        ref mut project,
        ref mut history,
        ..
    } = *guard;
    let report =
        refactor_with_instruction(&client, project, history, &prompt).map_err(|e| e.to_string())?;
    Ok((project.clone(), report))
}

#[tauri::command]
fn ai_apply_patch(
    patch: UmlGraphPatch,
    state: State<'_, Mutex<AppState>>,
) -> Result<(Project, PatchApplyReport), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    let AppState {
        ref mut project,
        ref mut history,
        ..
    } = *guard;
    let report = apply_uml_patch(project, history, &patch).map_err(|e| e.to_string())?;
    Ok((project.clone(), report))
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            get_project,
            open_project,
            save_current_project,
            execute_command,
            undo_command,
            redo_command,
            validate_current_project,
            preview_code,
            generate_code_to_dir,
            import_source_path,
            import_legacy_bouml_prj,
            ai_text_to_uml,
            ai_refactor,
            ai_apply_patch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BouML Next desktop application");
}
