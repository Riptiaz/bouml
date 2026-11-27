use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "org.bouml.studio.v2";
const KEYRING_USER: &str = "google_ai_studio_api_key";

fn fallback_key_path() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|h| PathBuf::from(h).join(".bouml-v2").join("ai_key.dat"))
}

#[tauri::command]
fn save_api_key(api_key: String) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        if entry.set_password(&api_key).is_ok() {
            return Ok(());
        }
    }
    if let Some(path) = fallback_key_path() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, api_key.as_bytes()).map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("Impossible de stocker la clé API dans le trousseau système.".into())
}

#[tauri::command]
fn load_api_key() -> Result<String, String> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        if let Ok(secret) = entry.get_password() {
            return Ok(secret);
        }
    }
    if let Some(path) = fallback_key_path() {
        if path.exists() {
            return fs::read_to_string(path).map_err(|e| e.to_string());
        }
    }
    Ok(String::new())
}

#[derive(Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}

#[derive(Deserialize)]
struct GeminiContent {
    parts: Option<Vec<GeminiPart>>,
}

#[derive(Deserialize)]
struct GeminiPart {
    text: Option<String>,
}

#[tauri::command]
async fn ai_generate_content(
    model: String,
    api_key: String,
    payload_json: String,
) -> Result<String, String> {
    // Enforce exclusive gemini-4-hydrogen model policy
    if model != "gemini-4-hydrogen" {
        return Err(format!(
            "Modèle non autorisé: {}. Seul gemini-4-hydrogen via Google AI Studio est autorisé.",
            model
        ));
    }

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key={}",
        api_key.trim()
    );

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(payload_json)
        .send()
        .await
        .map_err(|e| format!("Erreur réseau Google AI Studio: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Erreur Google AI Studio ({}): {}", status, body_text));
    }

    let parsed: GeminiResponse =
        serde_json::from_str(&body_text).map_err(|e| format!("Réponse JSON invalide: {}", e))?;

    let text = parsed
        .candidates
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.content)
        .and_then(|c| c.parts)
        .and_then(|p| p.into_iter().next())
        .and_then(|p| p.text)
        .ok_or_else(|| "Réponse vide renvoyée par gemini-4-hydrogen.".to_string())?;

    Ok(text)
}

#[derive(Serialize, Deserialize)]
struct GeneratedFileInput {
    filename: String,
    content: String,
}

#[tauri::command]
fn write_generated_files(output_dir: String, files: Vec<GeneratedFileInput>) -> Result<usize, String> {
    let dir = PathBuf::from(&output_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut written = 0usize;
    for f in files {
        let target = dir.join(&f.filename);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, f.content.as_bytes()).map_err(|e| e.to_string())?;
        written += 1;
    }
    Ok(written)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            save_api_key,
            load_api_key,
            ai_generate_content,
            write_generated_files
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors du démarrage de BouML v2");
}
