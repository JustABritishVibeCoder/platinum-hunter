//! PlayStation Network trophy integration.
//!
//! Sony does not publish a public trophy API. This module uses the same OAuth flow and
//! trophy endpoints as the official PlayStation App, as documented by the community
//! project <https://github.com/andshrew/PlayStation-Trophies> and implemented by the
//! `psn-api` library <https://github.com/achievements-app/psn-api>. See
//! `docs/PSN_INTEGRATION.md` for the investigation, risks and limitations.
//!
//! Security properties:
//! * The user's PlayStation password is never requested. The user signs in on Sony's
//!   own website and pastes the short-lived NPSSO cookie value, which is exchanged once
//!   and then discarded (never persisted, never logged).
//! * The long-lived refresh token is stored only in the Windows Credential Manager.
//! * Access tokens live only in process memory and are never sent to the webview.
//! * Responses are returned to the frontend as untrusted JSON and validated there.

pub mod auth;
pub mod client;
pub mod commands;
pub mod limiter;

pub use client::PsnClient;

/// PSN access is OFF unless the user explicitly opts in (Settings / PSN page). A user's
/// account was locked after earlier use of this unofficial sign-in, so the opt-in is a
/// runtime flag held here in Rust: while it is off, no request reaches Sony.

pub fn disabled_error() -> crate::error::AppError {
    crate::error::AppError::NotConnected {
        message: "PSN sync is turned off. Turn it on from the PSN Connection page to use it.".into(),
    }
}
