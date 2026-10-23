//! NPSSO → OAuth token exchange and secure refresh-token storage.

#[cfg(test)]
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const AUTH_BASE_URL: &str = "https://ca.account.sony.com/api/authz/v3/oauth";
/// Public OAuth client used by the PlayStation App (documented by andshrew/psn-api).
/// It is a public client identifier, not a user secret.
const CLIENT_ID: &str = "09515159-7237-4370-9b40-3806e67c0891";
const REDIRECT_URI: &str = "com.scee.psxandroid.scecompcall://redirect";
const SCOPE: &str = "psn:mobile.v2.core psn:clientapp";
/// Base64 of `client_id:client_secret` for the public PlayStation App client.
const CLIENT_BASIC_AUTH: &str =
    "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";

pub const KEYRING_SERVICE: &str = "com.platinumhunter.desktop";
pub const KEYRING_ACCOUNT: &str = "psn-refresh-token";

/// What we persist in the OS credential store. Contains no personal profile data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCredential {
    pub refresh_token: String,
    /// Unix seconds.
    pub refresh_expires_at: i64,
    /// Unix seconds.
    pub connected_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: i64,
    pub refresh_token: Option<String>,
    pub refresh_token_expires_in: Option<i64>,
}

/// Abstraction over the credential store so tests never touch the real keychain.
pub trait SecretStore: Send + Sync {
    fn load(&self) -> AppResult<Option<StoredCredential>>;
    fn save(&self, cred: &StoredCredential) -> AppResult<()>;
    fn clear(&self) -> AppResult<()>;
}

pub struct KeyringStore;

impl KeyringStore {
    fn entry() -> AppResult<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| AppError::Storage {
            message: format!("Windows Credential Manager is unavailable: {e}"),
        })
    }
}

impl SecretStore for KeyringStore {
    fn load(&self) -> AppResult<Option<StoredCredential>> {
        match Self::entry()?.get_password() {
            Ok(raw) => serde_json::from_str(&raw).map(Some).map_err(|_| AppError::Storage {
                message: "Stored PSN credential is unreadable; please reconnect.".into(),
            }),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Storage { message: format!("Could not read the credential store: {e}") }),
        }
    }

    fn save(&self, cred: &StoredCredential) -> AppResult<()> {
        let raw = serde_json::to_string(cred).map_err(|e| AppError::Storage { message: e.to_string() })?;
        Self::entry()?
            .set_password(&raw)
            .map_err(|e| AppError::Storage { message: format!("Could not write to the credential store: {e}") })
    }

    fn clear(&self) -> AppResult<()> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Storage { message: format!("Could not remove the stored credential: {e}") }),
        }
    }
}

/// In-memory store for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(pub Mutex<Option<StoredCredential>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn load(&self) -> AppResult<Option<StoredCredential>> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn save(&self, cred: &StoredCredential) -> AppResult<()> {
        *self.0.lock().unwrap() = Some(cred.clone());
        Ok(())
    }
    fn clear(&self) -> AppResult<()> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}

/// NPSSO values are 64 alphanumeric characters. Users sometimes paste the whole JSON
/// body from the ssocookie page, so accept that too and extract the value.
pub fn normalise_npsso(input: &str) -> AppResult<String> {
    let trimmed = input.trim();
    let candidate = if trimmed.starts_with('{') {
        serde_json::from_str::<serde_json::Value>(trimmed)
            .ok()
            .and_then(|v| v.get("npsso").and_then(|s| s.as_str()).map(|s| s.to_string()))
            .unwrap_or_default()
    } else {
        trimmed.trim_matches('"').to_string()
    };
    if candidate.len() == 64 && candidate.chars().all(|c| c.is_ascii_alphanumeric()) {
        Ok(candidate)
    } else {
        Err(AppError::invalid_input(
            "That doesn't look like an NPSSO value. It should be 64 letters and digits copied from the ssocookie page.",
        ))
    }
}

pub fn authorize_url() -> String {
    let mut url = url::Url::parse(&format!("{AUTH_BASE_URL}/authorize")).expect("static url");
    url.query_pairs_mut()
        .append_pair("access_type", "offline")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE);
    url.to_string()
}

/// Extracts `code` from the redirect `Location` header Sony returns on success.
pub fn extract_code(location: &str) -> Option<String> {
    let query = location.split_once('?')?.1;
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.to_string())
        .filter(|v| !v.is_empty())
}

pub async fn exchange_npsso_for_code(http: &reqwest::Client, npsso: &str) -> AppResult<String> {
    let res = http
        .get(authorize_url())
        .header(reqwest::header::COOKIE, format!("npsso={npsso}"))
        .send()
        .await
        .map_err(map_transport_error)?;
    let location = res
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    extract_code(&location).ok_or_else(|| AppError::AuthFailed {
        message: "Sony did not accept that NPSSO value. It may have expired or been copied while signed out. Sign in at playstation.com again and copy a fresh value.".into(),
    })
}

pub async fn exchange_code_for_tokens(http: &reqwest::Client, code: &str) -> AppResult<TokenResponse> {
    let form = [
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
        ("grant_type", "authorization_code"),
        ("token_format", "jwt"),
    ];
    post_token(http, &form).await
}

pub async fn refresh_tokens(http: &reqwest::Client, refresh_token: &str) -> AppResult<TokenResponse> {
    let form = [
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
        ("token_format", "jwt"),
        ("scope", SCOPE),
    ];
    post_token(http, &form).await
}

async fn post_token(http: &reqwest::Client, form: &[(&str, &str)]) -> AppResult<TokenResponse> {
    let res = http
        .post(format!("{AUTH_BASE_URL}/token"))
        .header(reqwest::header::AUTHORIZATION, CLIENT_BASIC_AUTH)
        .form(form)
        .send()
        .await
        .map_err(map_transport_error)?;
    let status = res.status();
    if status.as_u16() == 400 || status.as_u16() == 401 {
        return Err(AppError::AuthExpired {
            message: "PlayStation Network rejected the saved sign-in. Please reconnect your account.".into(),
        });
    }
    if !status.is_success() {
        return Err(AppError::Server { message: format!("Sony's sign-in service returned HTTP {}.", status.as_u16()) });
    }
    res.json::<TokenResponse>().await.map_err(|_| AppError::InvalidResponse {
        message: "Sony's sign-in service returned an unexpected response.".into(),
    })
}

pub fn map_transport_error(e: reqwest::Error) -> AppError {
    if e.is_timeout() {
        AppError::Timeout { message: "PlayStation Network did not respond in time.".into() }
    } else if e.is_connect() {
        AppError::Network { message: "Could not reach PlayStation Network. Check your internet connection.".into() }
    } else {
        AppError::Network { message: "A network error occurred while contacting PlayStation Network.".into() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_raw_and_json_npsso() {
        let raw = "a".repeat(64);
        assert_eq!(normalise_npsso(&raw).unwrap(), raw);
        assert_eq!(normalise_npsso(&format!("  {raw}\n")).unwrap(), raw);
        assert_eq!(normalise_npsso(&format!("{{\"npsso\":\"{raw}\"}}")).unwrap(), raw);
    }

    #[test]
    fn rejects_bad_npsso() {
        assert!(normalise_npsso("short").is_err());
        assert!(normalise_npsso(&"a;".repeat(32)).is_err());
        assert!(normalise_npsso("{\"npsso\": 5}").is_err());
    }

    #[test]
    fn extracts_code_from_redirect() {
        let loc = "com.scee.psxandroid.scecompcall://redirect/?code=v3.ABCdef&cid=123";
        assert_eq!(extract_code(loc).as_deref(), Some("v3.ABCdef"));
        assert_eq!(extract_code("https://example.com/?error=login_required"), None);
        assert_eq!(extract_code(""), None);
    }

    #[test]
    fn authorize_url_contains_expected_params() {
        let u = authorize_url();
        assert!(u.starts_with("https://ca.account.sony.com/api/authz/v3/oauth/authorize?"));
        assert!(u.contains("client_id=09515159-7237-4370-9b40-3806e67c0891"));
        assert!(u.contains("response_type=code"));
    }

    #[test]
    fn memory_store_round_trip() {
        let s = MemoryStore::default();
        assert!(s.load().unwrap().is_none());
        let c = StoredCredential { refresh_token: "r".into(), refresh_expires_at: 10, connected_at: 1 };
        s.save(&c).unwrap();
        assert_eq!(s.load().unwrap().unwrap().refresh_token, "r");
        s.clear().unwrap();
        assert!(s.load().unwrap().is_none());
    }
}
