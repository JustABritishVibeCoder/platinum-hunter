//! Offline cache for trophy icons and game art served by PlayStation's image CDNs.
//!
//! Images are fetched once, stored under the app cache directory keyed by a hash of
//! the URL, and returned to the webview as data URLs so they keep working offline.
//! Only HTTPS URLs on PlayStation-owned hosts are accepted.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

const MAX_IMAGE_BYTES: usize = 3 * 1024 * 1024;
const ALLOWED_SUFFIXES: &[&str] = &[".playstation.net", ".playstation.com"];

pub fn is_allowed_image_url(raw: &str) -> bool {
    let Ok(u) = url::Url::parse(raw) else { return false };
    if u.scheme() != "https" {
        return false;
    }
    let Some(host) = u.host_str() else { return false };
    ALLOWED_SUFFIXES.iter().any(|s| host.ends_with(s))
}

fn cache_key(url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn mime_for(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn to_data_url(bytes: &[u8]) -> Option<String> {
    let mime = mime_for(bytes)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

pub fn read_cached(dir: &Path, url: &str) -> Option<String> {
    let path = dir.join(cache_key(url));
    let bytes = std::fs::read(path).ok()?;
    to_data_url(&bytes)
}

pub async fn fetch_and_cache(dir: &Path, url: &str) -> AppResult<Option<String>> {
    if !is_allowed_image_url(url) {
        return Err(AppError::invalid_input("Image URL is not on an allowed PlayStation host."));
    }
    if let Some(hit) = read_cached(dir, url) {
        return Ok(Some(hit));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Network { message: e.to_string() })?;
    let res = match client.get(url).send().await {
        Ok(r) if r.status().is_success() => r,
        // Offline or missing: the UI falls back to a grade glyph.
        _ => return Ok(None),
    };
    let bytes = res.bytes().await.map_err(|_| AppError::Network { message: "Image download failed.".into() })?;
    if bytes.len() > MAX_IMAGE_BYTES || mime_for(&bytes).is_none() {
        return Ok(None);
    }
    std::fs::create_dir_all(dir)?;
    let path: PathBuf = dir.join(cache_key(url));
    std::fs::write(&path, &bytes)?;
    Ok(to_data_url(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_allowlist() {
        assert!(is_allowed_image_url("https://image.api.playstation.com/trophy/np/NPWR1_00/x.PNG"));
        assert!(is_allowed_image_url("https://psnobj.prod.dl.playstation.net/psnobj/x.png"));
        assert!(!is_allowed_image_url("http://image.api.playstation.com/x.png"));
        assert!(!is_allowed_image_url("https://evil.example.com/x.png"));
        assert!(!is_allowed_image_url("https://playstation.com.evil.example/x.png"));
        assert!(!is_allowed_image_url("file:///C:/Windows/win.ini"));
    }

    #[test]
    fn sniffs_mime() {
        assert_eq!(mime_for(&[0x89, b'P', b'N', b'G', 0, 0]), Some("image/png"));
        assert_eq!(mime_for(b"<svg></svg>"), None);
    }
}
