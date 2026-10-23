//! Discord Rich Presence over Discord's local IPC pipe.
//!
//! Nothing is sent over the network by this app: the Discord desktop client receives
//! the activity locally and displays it on the user's profile. Requires a Discord
//! Application ID (a public identifier the user creates in the Discord developer
//! portal); no Discord credentials are involved.

use std::sync::Mutex;

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    pub details: String,
    pub state: Option<String>,
    /// Unix milliseconds the elapsed timer counts from.
    pub start_ms: Option<i64>,
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    pub small_text: Option<String>,
}

#[derive(Default)]
pub struct DiscordState {
    client: Mutex<Option<(String, DiscordIpcClient)>>,
}

pub fn is_valid_application_id(id: &str) -> bool {
    (15..=21).contains(&id.len()) && id.chars().all(|c| c.is_ascii_digit())
}

/// Discord requires 2..=128 characters for text fields.
fn clamp_text(s: &str) -> Option<String> {
    let t: String = s.trim().chars().take(128).collect();
    if t.chars().count() >= 2 {
        Some(t)
    } else {
        None
    }
}

fn https_image(url: &Option<String>) -> Option<String> {
    url.as_ref()
        .filter(|u| u.starts_with("https://") && u.len() <= 256)
        .cloned()
}

fn unavailable() -> AppError {
    AppError::Network { message: "Discord is not running, or Rich Presence could not connect to it.".into() }
}

impl DiscordState {
    pub fn update(&self, application_id: &str, p: &PresencePayload) -> AppResult<()> {
        if !is_valid_application_id(application_id) {
            return Err(AppError::invalid_input("The Discord Application ID should be the long number from the Discord developer portal."));
        }
        let details = clamp_text(&p.details).ok_or_else(|| AppError::invalid_input("Presence text is too short."))?;
        let mut guard = self.client.lock().map_err(|_| unavailable())?;

        // (Re)connect when not connected or when the Application ID changed.
        if guard.as_ref().map(|(id, _)| id != application_id).unwrap_or(true) {
            if let Some((_, mut old)) = guard.take() {
                let _ = old.close();
            }
            let mut c = DiscordIpcClient::new(application_id);
            c.connect().map_err(|_| unavailable())?;
            *guard = Some((application_id.to_string(), c));
        }

        let state = p.state.as_deref().and_then(clamp_text);
        let large_text = p.large_text.as_deref().and_then(clamp_text);
        let small_text = p.small_text.as_deref().and_then(clamp_text);
        let large_image = https_image(&p.large_image);

        let mut act = activity::Activity::new().details(details.as_str());
        if let Some(s) = state.as_deref() {
            act = act.state(s);
        }
        if let Some(start) = p.start_ms {
            act = act.timestamps(activity::Timestamps::new().start(start));
        }
        let mut assets = activity::Assets::new();
        let mut has_assets = false;
        if let Some(img) = large_image.as_deref() {
            assets = assets.large_image(img);
            has_assets = true;
            if let Some(t) = large_text.as_deref() {
                assets = assets.large_text(t);
            }
        }
        if let Some(t) = small_text.as_deref() {
            assets = assets.small_text(t);
        }
        if has_assets {
            act = act.assets(assets);
        }

        let (_, client) = guard.as_mut().expect("connected above");
        if client.set_activity(act).is_err() {
            // The pipe broke (Discord restarted/closed): drop it so the next update reconnects.
            if let Some((_, mut c)) = guard.take() {
                let _ = c.close();
            }
            return Err(unavailable());
        }
        Ok(())
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.client.lock() {
            if let Some((_, mut c)) = guard.take() {
                let _ = c.clear_activity();
                let _ = c.close();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_application_id() {
        assert!(is_valid_application_id("1234567890123456789"));
        assert!(!is_valid_application_id("12345"));
        assert!(!is_valid_application_id("12345678901234567x9"));
    }

    #[test]
    fn clamps_text_to_discord_limits() {
        assert_eq!(clamp_text("a"), None);
        assert_eq!(clamp_text("  ok "), Some("ok".into()));
        assert_eq!(clamp_text(&"x".repeat(300)).unwrap().len(), 128);
    }

    #[test]
    fn only_https_images() {
        assert!(https_image(&Some("https://image.api.playstation.com/x.png".into())).is_some());
        assert!(https_image(&Some("http://example.com/x.png".into())).is_none());
        assert!(https_image(&None).is_none());
    }

    #[test]
    fn rejects_bad_id_without_touching_discord() {
        let s = DiscordState::default();
        let p = PresencePayload { details: "Hunting".into(), state: None, start_ms: None, large_image: None, large_text: None, small_text: None };
        assert!(matches!(s.update("bad", &p), Err(AppError::InvalidInput { .. })));
    }
}
