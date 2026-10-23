//! Error type shared by every Tauri command.
//!
//! Errors are serialised as `{ kind, message, retryAfterSecs? }` so the frontend can
//! render specific recovery actions. Messages never contain tokens or NPSSO values.

use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppError {
    #[error("{message}")]
    Database { message: String },
    #[error("{message}")]
    InvalidInput { message: String },
    #[error("{message}")]
    Io { message: String },
    #[error("{message}")]
    NotConnected { message: String },
    #[error("{message}")]
    AuthExpired { message: String },
    #[error("{message}")]
    AuthFailed { message: String },
    #[error("{message}")]
    Network { message: String },
    #[error("{message}")]
    Timeout { message: String },
    #[error("{message}")]
    RateLimited {
        message: String,
        #[serde(rename = "retryAfterSecs")]
        retry_after_secs: u64,
    },
    #[error("{message}")]
    NotFound { message: String },
    #[error("{message}")]
    Server { message: String },
    #[error("{message}")]
    InvalidResponse { message: String },
    #[error("{message}")]
    Storage { message: String },
}

impl AppError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput { message: message.into() }
    }
    pub fn io(message: impl Into<String>) -> Self {
        Self::Io { message: message.into() }
    }
    pub fn database(message: impl Into<String>) -> Self {
        Self::Database { message: message.into() }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database { message: e.to_string() }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io { message: e.to_string() }
    }
}

pub type AppResult<T> = Result<T, AppError>;
