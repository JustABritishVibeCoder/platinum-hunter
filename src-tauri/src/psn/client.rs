//! Authenticated, rate-limited access to the PSN trophy endpoints.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::Mutex;

use super::auth::{self, SecretStore, StoredCredential};
use super::limiter::{Admission, RateLimiter};
use crate::error::{AppError, AppResult};

pub const TROPHY_BASE_URL: &str = "https://m.np.playstation.com/api/trophy";
const MAX_PAGES: usize = 25;
const PAGE_LIMIT: u32 = 800;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub connected: bool,
    pub needs_reauth: bool,
    pub connected_at: Option<i64>,
    pub refresh_expires_at: Option<i64>,
}

struct AccessToken {
    token: String,
    expires_at: Instant,
}

pub struct PsnClient {
    http: reqwest::Client,
    store: Box<dyn SecretStore>,
    access: Mutex<Option<AccessToken>>,
    limiter: StdMutex<RateLimiter>,
    base_url: String,
    /// User opt-in. Off by default; every network path checks it.
    enabled: AtomicBool,
}

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        // The OAuth authorize step answers with a redirect to a custom URL scheme that
        // carries the code; we must read that Location header rather than follow it.
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .user_agent("PlatinumHunter/1.0 (Windows desktop trophy tracker)")
        .build()
        .expect("http client")
}

pub fn is_valid_np_communication_id(id: &str) -> bool {
    // e.g. NPWR12345_00
    id.len() == 12
        && id.starts_with("NPWR")
        && id[4..9].chars().all(|c| c.is_ascii_digit())
        && &id[9..] == "_00"
}

pub const PROFILE_BASE_URL: &str = "https://m.np.playstation.com/api/userProfile/v1/internal/users";

/// PSN account IDs are numeric strings (up to 20 digits).
pub fn is_valid_account_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.chars().all(|c| c.is_ascii_digit())
}

pub fn is_valid_title_id(id: &str) -> bool {
    // e.g. PPSA01721_00 (PS5) or CUSA00419_00 (PS4)
    id.len() == 12
        && id[..4].chars().all(|c| c.is_ascii_uppercase())
        && id[4..9].chars().all(|c| c.is_ascii_digit())
        && &id[9..] == "_00"
}

pub fn validate_service_name(name: &str) -> AppResult<&'static str> {
    match name {
        "trophy" => Ok("trophy"),
        "trophy2" => Ok("trophy2"),
        _ => Err(AppError::invalid_input("npServiceName must be 'trophy' (PS3/PS4/Vita) or 'trophy2' (PS5).")),
    }
}

impl PsnClient {
    pub fn new(store: Box<dyn SecretStore>) -> Self {
        Self::with_base_url(store, TROPHY_BASE_URL.to_string())
    }

    pub fn with_base_url(store: Box<dyn SecretStore>, base_url: String) -> Self {
        Self {
            http: build_http_client(),
            store,
            access: Mutex::new(None),
            limiter: StdMutex::new(RateLimiter::default_psn()),
            base_url,
            enabled: AtomicBool::new(false),
        }
    }

    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::SeqCst);
    }

    /// Turning PSN off also forgets the in-memory access token immediately.
    pub async fn disable(&self) {
        self.set_enabled(false);
        *self.access.lock().await = None;
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    pub fn status(&self) -> AppResult<ConnectionStatus> {
        if !self.is_enabled() {
            return Ok(ConnectionStatus { connected: false, needs_reauth: false, connected_at: None, refresh_expires_at: None });
        }
        let cred = self.store.load()?;
        Ok(match cred {
            None => ConnectionStatus { connected: false, needs_reauth: false, connected_at: None, refresh_expires_at: None },
            Some(c) => ConnectionStatus {
                connected: c.refresh_expires_at > now_unix(),
                needs_reauth: c.refresh_expires_at <= now_unix(),
                connected_at: Some(c.connected_at),
                refresh_expires_at: Some(c.refresh_expires_at),
            },
        })
    }

    pub async fn connect(&self, npsso_input: &str) -> AppResult<ConnectionStatus> {
        if !self.is_enabled() {
            return Err(super::disabled_error());
        }
        let npsso = auth::normalise_npsso(npsso_input)?;
        let code = auth::exchange_npsso_for_code(&self.http, &npsso).await?;
        drop(npsso);
        let tokens = auth::exchange_code_for_tokens(&self.http, &code).await?;
        self.store_tokens(tokens, now_unix()).await?;
        self.status()
    }

    pub async fn disconnect(&self) -> AppResult<()> {
        *self.access.lock().await = None;
        self.store.clear()
    }

    async fn store_tokens(&self, tokens: auth::TokenResponse, connected_at: i64) -> AppResult<()> {
        if let Some(refresh) = tokens.refresh_token.clone() {
            // Sony currently issues ~60-day refresh tokens; fall back conservatively.
            let ttl = tokens.refresh_token_expires_in.unwrap_or(30 * 24 * 3600);
            self.store.save(&StoredCredential {
                refresh_token: refresh,
                refresh_expires_at: now_unix() + ttl,
                connected_at,
            })?;
        }
        let ttl = Duration::from_secs(tokens.expires_in.clamp(60, 24 * 3600) as u64);
        *self.access.lock().await = Some(AccessToken {
            token: tokens.access_token,
            expires_at: Instant::now() + ttl - Duration::from_secs(60),
        });
        Ok(())
    }

    async fn access_token(&self, force_refresh: bool) -> AppResult<String> {
        if !self.is_enabled() {
            return Err(super::disabled_error());
        }
        if !force_refresh {
            if let Some(t) = self.access.lock().await.as_ref() {
                if t.expires_at > Instant::now() {
                    return Ok(t.token.clone());
                }
            }
        }
        let cred = self.store.load()?.ok_or_else(|| AppError::NotConnected {
            message: "PlayStation Network is not connected.".into(),
        })?;
        if cred.refresh_expires_at <= now_unix() {
            return Err(AppError::AuthExpired {
                message: "Your PSN sign-in has expired. Reconnect to resume verified syncing.".into(),
            });
        }
        self.wait_for_slot().await?;
        let tokens = auth::refresh_tokens(&self.http, &cred.refresh_token).await?;
        let token = tokens.access_token.clone();
        self.store_tokens(tokens, cred.connected_at).await?;
        Ok(token)
    }

    async fn wait_for_slot(&self) -> AppResult<()> {
        let admission = self.limiter.lock().map_err(|_| AppError::Network { message: "rate limiter poisoned".into() })?.admit(Instant::now());
        match admission {
            Admission::Wait(d) => {
                if !d.is_zero() {
                    tokio::time::sleep(d).await;
                }
                Ok(())
            }
            Admission::Blocked(d) => Err(AppError::RateLimited {
                message: "Platinum Hunter's hourly PSN request limit is reached (kept low to protect your account). Try again later.".into(),
                retry_after_secs: d.as_secs().max(1),
            }),
        }
    }

    /// GET a trophy API path with bearer auth, retrying once with a fresh token on 401.
    async fn get_json(&self, path: &str, query: &[(&str, String)]) -> AppResult<Value> {
        let mut forced = false;
        loop {
            let token = self.access_token(forced).await?;
            self.wait_for_slot().await?;
            let res = self
                .http
                .get(format!("{}{}", self.base_url, path))
                .bearer_auth(&token)
                .header(reqwest::header::ACCEPT_LANGUAGE, "en-US")
                .query(query)
                .send()
                .await
                .map_err(auth::map_transport_error)?;
            let status = res.status().as_u16();
            match status {
                200..=299 => {
                    return res.json::<Value>().await.map_err(|_| AppError::InvalidResponse {
                        message: "PlayStation Network returned a response that could not be read.".into(),
                    })
                }
                401 if !forced => {
                    forced = true;
                    continue;
                }
                401 | 403 => {
                    return Err(AppError::AuthExpired {
                        message: "PlayStation Network rejected the request. Reconnect your account.".into(),
                    })
                }
                404 => {
                    return Err(AppError::NotFound {
                        message: "PlayStation Network has no trophy data for that request. The title may not be on this account yet.".into(),
                    })
                }
                429 => {
                    let retry = res
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(120);
                    if let Ok(mut l) = self.limiter.lock() {
                        l.block_for(Instant::now(), Duration::from_secs(retry));
                    }
                    return Err(AppError::RateLimited {
                        message: "PlayStation Network rate limit reached. Your previous data is unchanged.".into(),
                        retry_after_secs: retry,
                    });
                }
                _ => {
                    return Err(AppError::Server {
                        message: format!("PlayStation Network returned HTTP {status}. Your previous data is unchanged."),
                    })
                }
            }
        }
    }

    /// All trophy titles (trophy lists) on the authenticated account.
    pub async fn user_titles(&self) -> AppResult<Vec<Value>> {
        let mut out = Vec::new();
        let mut offset: u64 = 0;
        for _ in 0..MAX_PAGES {
            let page = self
                .get_json(
                    "/v1/users/me/trophyTitles",
                    &[("limit", PAGE_LIMIT.to_string()), ("offset", offset.to_string())],
                )
                .await?;
            let titles = page.get("trophyTitles").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            out.extend(titles);
            match page.get("nextOffset").and_then(|v| v.as_u64()) {
                Some(next) if next > offset => offset = next,
                _ => break,
            }
        }
        Ok(out)
    }

    /// Maps title IDs (CUSA/PPSA) to trophy lists. Only returns titles the account has played.
    pub async fn titles_for_title_ids(&self, title_ids: &[String]) -> AppResult<Value> {
        if title_ids.is_empty() || title_ids.len() > 5 || !title_ids.iter().all(|t| is_valid_title_id(t)) {
            return Err(AppError::invalid_input("Provide between 1 and 5 title IDs like PPSA01721_00."));
        }
        self.get_json("/v1/users/me/titles/trophyTitles", &[("npTitleIds", title_ids.join(","))]).await
    }

    fn check_ids(np_communication_id: &str, service: &str) -> AppResult<&'static str> {
        if !is_valid_np_communication_id(np_communication_id) {
            return Err(AppError::invalid_input("Invalid npCommunicationId."));
        }
        validate_service_name(service)
    }

    /// Trophy definitions (names, descriptions, grades, icons) for every group of a list.
    pub async fn title_trophies(&self, np_communication_id: &str, service: &str) -> AppResult<Value> {
        let svc = Self::check_ids(np_communication_id, service)?;
        self.get_paged_trophies(&format!("/v1/npCommunicationIds/{np_communication_id}/trophyGroups/all/trophies"), svc)
            .await
    }

    pub async fn title_trophy_groups(&self, np_communication_id: &str, service: &str) -> AppResult<Value> {
        let svc = Self::check_ids(np_communication_id, service)?;
        self.get_json(
            &format!("/v1/npCommunicationIds/{np_communication_id}/trophyGroups"),
            &[("npServiceName", svc.to_string())],
        )
        .await
    }

    /// Earned status for every trophy of a list on the authenticated account.
    pub async fn user_earned(&self, np_communication_id: &str, service: &str) -> AppResult<Value> {
        let svc = Self::check_ids(np_communication_id, service)?;
        self.get_paged_trophies(
            &format!("/v1/users/me/npCommunicationIds/{np_communication_id}/trophyGroups/all/trophies"),
            svc,
        )
        .await
    }

    /// The authenticated account's public profile (online ID, avatar, PS Plus) and
    /// trophy level. Read-only. The trophy summary accepts "me" and returns the
    /// numeric accountId, which the profile endpoint requires.
    pub async fn own_profile(&self) -> AppResult<Value> {
        let summary = self.get_json("/v1/users/me/trophySummary", &[]).await?;
        let account_id = summary
            .get("accountId")
            .and_then(|v| v.as_str())
            .filter(|s| is_valid_account_id(s))
            .ok_or_else(|| AppError::InvalidResponse { message: "PSN did not return a valid account ID.".into() })?
            .to_string();
        let profile = self
            .get_absolute_json(&format!("{PROFILE_BASE_URL}/{account_id}/profiles"))
            .await?;
        Ok(serde_json::json!({ "summary": summary, "profile": profile }))
    }

    async fn get_absolute_json(&self, url: &str) -> AppResult<Value> {
        // GET on a non-trophy PSN service (the profile API) with the same auth and limits.
        let token = self.access_token(false).await?;
        self.wait_for_slot().await?;
        let res = self
            .http
            .get(url)
            .bearer_auth(&token)
            .header(reqwest::header::ACCEPT_LANGUAGE, "en-US")
            .send()
            .await
            .map_err(auth::map_transport_error)?;
        let status = res.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(match status {
                401 | 403 => AppError::AuthExpired { message: "PlayStation Network rejected the request. Reconnect your account.".into() },
                404 => AppError::NotFound { message: "Profile not found or hidden by privacy settings.".into() },
                429 => AppError::RateLimited { message: "PlayStation Network rate limit reached.".into(), retry_after_secs: 120 },
                _ => AppError::Server { message: format!("PlayStation Network returned HTTP {status}.") },
            });
        }
        res.json::<Value>()
            .await
            .map_err(|_| AppError::InvalidResponse { message: "PlayStation Network returned an unreadable profile.".into() })
    }

    async fn get_paged_trophies(&self, path: &str, svc: &str) -> AppResult<Value> {
        let mut first: Option<Value> = None;
        let mut all = Vec::new();
        let mut offset: u64 = 0;
        for _ in 0..MAX_PAGES {
            let page = self
                .get_json(
                    path,
                    &[
                        ("npServiceName", svc.to_string()),
                        ("limit", PAGE_LIMIT.to_string()),
                        ("offset", offset.to_string()),
                    ],
                )
                .await?;
            all.extend(page.get("trophies").and_then(|v| v.as_array()).cloned().unwrap_or_default());
            let next = page.get("nextOffset").and_then(|v| v.as_u64());
            if first.is_none() {
                first = Some(page);
            }
            match next {
                Some(n) if n > offset => offset = n,
                _ => break,
            }
        }
        let mut merged = first.unwrap_or_else(|| serde_json::json!({}));
        if let Some(obj) = merged.as_object_mut() {
            obj.insert("trophies".into(), Value::Array(all));
            obj.remove("nextOffset");
        }
        Ok(merged)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::psn::auth::MemoryStore;

    #[test]
    fn validates_identifiers() {
        assert!(is_valid_np_communication_id("NPWR12345_00"));
        assert!(!is_valid_np_communication_id("NPWR1234_00"));
        assert!(!is_valid_np_communication_id("NPWR12345_00/../x"));
        assert!(is_valid_title_id("PPSA01721_00"));
        assert!(is_valid_title_id("CUSA00419_00"));
        assert!(!is_valid_title_id("PPSA01721"));
        assert!(is_valid_account_id("962157895908076652"));
        assert!(!is_valid_account_id("96215/../x"));
        assert!(!is_valid_account_id(""));
        assert!(validate_service_name("trophy2").is_ok());
        assert!(validate_service_name("trophy3").is_err());
    }

    fn stored(client: &PsnClient, expires_in: i64) {
        client
            .store
            .save(&StoredCredential { refresh_token: "x".into(), refresh_expires_at: now_unix() + expires_in, connected_at: 1 })
            .unwrap();
    }

    #[test]
    fn psn_is_off_by_default_even_with_a_stored_credential() {
        let client = PsnClient::new(Box::new(MemoryStore::default()));
        stored(&client, 1000);
        assert!(!client.is_enabled());
        let s = client.status().unwrap();
        assert!(!s.connected && !s.needs_reauth);
    }

    #[tokio::test]
    async fn every_network_path_is_refused_while_off() {
        let client = PsnClient::new(Box::new(MemoryStore::default()));
        stored(&client, 1000);
        assert!(matches!(client.connect(&"a".repeat(64)).await, Err(AppError::NotConnected { .. })));
        assert!(matches!(client.user_titles().await, Err(AppError::NotConnected { .. })));
        assert!(matches!(client.own_profile().await, Err(AppError::NotConnected { .. })));
    }

    #[test]
    fn status_reflects_store_once_opted_in() {
        let client = PsnClient::new(Box::new(MemoryStore::default()));
        client.set_enabled(true);
        assert!(!client.status().unwrap().connected);
        stored(&client, 1000);
        let s = client.status().unwrap();
        assert!(s.connected && !s.needs_reauth);
        stored(&client, -1);
        let s = client.status().unwrap();
        assert!(!s.connected && s.needs_reauth);
    }

    #[tokio::test]
    async fn requests_fail_cleanly_when_not_connected() {
        let client = PsnClient::new(Box::new(MemoryStore::default()));
        client.set_enabled(true);
        let err = client.user_titles().await.unwrap_err();
        assert!(matches!(err, AppError::NotConnected { .. }));
    }

    #[tokio::test]
    async fn rejects_invalid_ids_before_network() {
        let client = PsnClient::new(Box::new(MemoryStore::default()));
        assert!(matches!(client.title_trophies("bad", "trophy2").await, Err(AppError::InvalidInput { .. })));
        assert!(matches!(client.user_earned("NPWR12345_00", "nope").await, Err(AppError::InvalidInput { .. })));
    }

    /// Live integration test against the real PSN service. Requires a fresh NPSSO in
    /// the `PSN_NPSSO` environment variable and is ignored by default:
    /// `PSN_NPSSO=... cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_psn`
    #[tokio::test]
    #[ignore = "needs a real NPSSO; uses your live PSN account"]
    async fn live_psn_round_trip() {
        let npsso = std::env::var("PSN_NPSSO").expect("set PSN_NPSSO to run this test");
        let client = PsnClient::new(Box::new(MemoryStore::default()));
        client.set_enabled(true);
        client.connect(&npsso).await.expect("connect");
        let titles = client.user_titles().await.expect("titles");
        println!("account has {} trophy lists", titles.len());
    }
}
