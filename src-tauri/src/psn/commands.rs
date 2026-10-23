//! Tauri commands exposing PSN data to the frontend. Tokens never cross this boundary.

use serde_json::Value;
use tauri::State;

use super::client::ConnectionStatus;
use crate::error::AppResult;
use crate::AppState;

#[tauri::command]
pub fn psn_status(state: State<'_, AppState>) -> AppResult<ConnectionStatus> {
    state.psn.status()
}

/// The user's explicit opt-in. While off, every PSN request is refused in Rust.
#[tauri::command]
pub async fn psn_set_enabled(state: State<'_, AppState>, enabled: bool) -> AppResult<()> {
    if enabled {
        state.psn.set_enabled(true);
    } else {
        state.psn.disable().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn psn_connect(state: State<'_, AppState>, npsso: String) -> AppResult<ConnectionStatus> {
    state.psn.connect(&npsso).await
}

#[tauri::command]
pub async fn psn_disconnect(state: State<'_, AppState>) -> AppResult<()> {
    state.psn.disconnect().await
}

#[tauri::command]
pub async fn psn_own_profile(state: State<'_, AppState>) -> AppResult<Value> {
    state.psn.own_profile().await
}

#[tauri::command]
pub async fn psn_user_titles(state: State<'_, AppState>) -> AppResult<Vec<Value>> {
    state.psn.user_titles().await
}

#[tauri::command]
pub async fn psn_titles_for_title_ids(state: State<'_, AppState>, title_ids: Vec<String>) -> AppResult<Value> {
    state.psn.titles_for_title_ids(&title_ids).await
}

#[tauri::command]
pub async fn psn_title_trophies(
    state: State<'_, AppState>,
    np_communication_id: String,
    np_service_name: String,
) -> AppResult<Value> {
    state.psn.title_trophies(&np_communication_id, &np_service_name).await
}

#[tauri::command]
pub async fn psn_title_trophy_groups(
    state: State<'_, AppState>,
    np_communication_id: String,
    np_service_name: String,
) -> AppResult<Value> {
    state.psn.title_trophy_groups(&np_communication_id, &np_service_name).await
}

#[tauri::command]
pub async fn psn_user_earned(
    state: State<'_, AppState>,
    np_communication_id: String,
    np_service_name: String,
) -> AppResult<Value> {
    state.psn.user_earned(&np_communication_id, &np_service_name).await
}
