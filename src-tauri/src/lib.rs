//! Platinum Hunter desktop backend.
//!
//! Responsibilities kept in Rust:
//! * SQLite storage (single connection, parameterised statements, backup/restore).
//! * PlayStation Network authentication and requests (tokens never reach the webview).
//! * Offline image cache and bounded file import/export.

mod db;
mod discord;
mod error;
mod images;
mod psn;

use std::path::PathBuf;

use serde_json::{Map, Value};
use tauri::{Manager, State};

use db::{Database, DbInfo, ExecResult, Statement};
use error::{AppError, AppResult};
use psn::auth::KeyringStore;
use psn::PsnClient;

pub struct AppState {
    pub db: Database,
    pub psn: PsnClient,
    pub discord: discord::DiscordState,
    pub data_dir: PathBuf,
    pub image_dir: PathBuf,
}

const MAX_IMPORT_BYTES: u64 = 25 * 1024 * 1024;

#[tauri::command]
fn db_select(state: State<'_, AppState>, sql: String, params: Vec<Value>) -> AppResult<Vec<Map<String, Value>>> {
    state.db.select(&sql, &params)
}

#[tauri::command]
fn db_execute(state: State<'_, AppState>, sql: String, params: Vec<Value>) -> AppResult<ExecResult> {
    state.db.execute(&sql, &params)
}

#[tauri::command]
fn db_batch(state: State<'_, AppState>, statements: Vec<Statement>) -> AppResult<()> {
    state.db.batch(&statements)
}

#[tauri::command]
fn db_info(state: State<'_, AppState>) -> AppResult<DbInfo> {
    state.db.info()
}

#[tauri::command]
fn db_backup(state: State<'_, AppState>, dest_path: String) -> AppResult<()> {
    state.db.backup_to(&PathBuf::from(dest_path))
}

fn timestamp_slug() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    secs.to_string()
}

/// Writes an automatic safety backup into the app data folder and returns its path.
#[tauri::command]
fn db_safety_backup(state: State<'_, AppState>, label: String) -> AppResult<String> {
    let clean: String = label.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(32).collect();
    let dir = state.data_dir.join("backups");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}-{}.db", if clean.is_empty() { "safety" } else { &clean }, timestamp_slug()));
    state.db.backup_to(&path)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn db_restore(state: State<'_, AppState>, src_path: String, max_schema_version: i64) -> AppResult<i64> {
    let dir = state.data_dir.join("backups");
    std::fs::create_dir_all(&dir)?;
    let safety = dir.join(format!("pre-restore-{}.db", timestamp_slug()));
    state.db.restore_from(&PathBuf::from(src_path), &safety, max_schema_version)
}

#[tauri::command]
fn file_write_text(path: String, contents: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        return Err(AppError::invalid_input("Choose a file, not a folder."));
    }
    std::fs::write(p, contents)?;
    Ok(())
}

#[tauri::command]
fn file_read_text(path: String) -> AppResult<String> {
    let p = PathBuf::from(&path);
    let meta = std::fs::metadata(&p).map_err(|_| AppError::invalid_input("File not found."))?;
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(AppError::invalid_input("File is too large to import (25 MB limit)."));
    }
    let bytes = std::fs::read(p)?;
    String::from_utf8(bytes).map_err(|_| AppError::invalid_input("File is not valid UTF-8 text."))
}

#[tauri::command]
async fn image_cached(state: State<'_, AppState>, url: String) -> AppResult<Option<String>> {
    images::fetch_and_cache(&state.image_dir, &url).await
}

/// The Windows account's display name, used only to greet the user on the home screen.
#[tauri::command]
fn system_user_name() -> Option<String> {
    std::env::var("USERNAME")
        .ok()
        .map(|s| s.trim().chars().take(40).collect::<String>())
        .filter(|s| !s.is_empty())
}

/// Sets the Discord Rich Presence activity (local IPC to the Discord desktop app).
#[tauri::command]
async fn discord_update(state: State<'_, AppState>, application_id: String, payload: discord::PresencePayload) -> AppResult<()> {
    state.discord.update(&application_id, &payload)
}

#[tauri::command]
async fn discord_clear(state: State<'_, AppState>) -> AppResult<()> {
    state.discord.clear();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|e| AppError::io(e.to_string()))?;
            let cache_dir = app.path().app_cache_dir().map_err(|e| AppError::io(e.to_string()))?;
            std::fs::create_dir_all(&data_dir)?;
            let db = Database::open(data_dir.join(db::DB_FILE_NAME))?;
            app.manage(AppState {
                db,
                psn: PsnClient::new(Box::new(KeyringStore)),
                discord: discord::DiscordState::default(),
                image_dir: cache_dir.join("images"),
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_select,
            db_execute,
            db_batch,
            db_info,
            db_backup,
            db_safety_backup,
            db_restore,
            file_write_text,
            file_read_text,
            image_cached,
            system_user_name,
            discord_update,
            discord_clear,
            psn::commands::psn_own_profile,
            psn::commands::psn_status,
            psn::commands::psn_set_enabled,
            psn::commands::psn_connect,
            psn::commands::psn_disconnect,
            psn::commands::psn_user_titles,
            psn::commands::psn_titles_for_title_ids,
            psn::commands::psn_title_trophies,
            psn::commands::psn_title_trophy_groups,
            psn::commands::psn_user_earned,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Platinum Hunter");
}
