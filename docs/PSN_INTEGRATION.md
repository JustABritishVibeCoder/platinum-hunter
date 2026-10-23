# PlayStation Network integration: investigation and design

> **Status: opt-in and rate-limited.** My account got locked the morning after I first synced with this (Oct 2026). No idea if it was the cause, Sony never says. Sync is now off by default and you have to tick a box to turn it on. When it is on: one sync an hour max (failed attempts count too), nothing in the background, a hard limit of 20 requests an hour in the Rust code, and the profile only refreshes once a day. Turning it off deletes the stored token.

This document records what was investigated before building the PSN integration, what was chosen, and what is (and is not) verified.

## 1. Is there an official, public trophy API?

**No.** Sony does not publish a public API for reading a user's trophies. Trophy services for licensed developers exist through Sony's partner programmes, but they are for games running on PlayStation hardware, not for third-party desktop tools reading a player's account. No sanctioned OAuth programme for third-party trophy readers was found (searches in October 2026).

## 2. What community options exist?

| Option | What it is | Notes |
| --- | --- | --- |
| [andshrew/PlayStation-Trophies](https://github.com/andshrew/PlayStation-Trophies) | Community documentation of the trophy endpoints, built by observing the official PlayStation website/app | The reference source most libraries follow |
| [psn-api](https://github.com/achievements-app/psn-api) (npm, v2.18.1) | TypeScript wrapper over those endpoints | Actively maintained; used here as the reference for exact constants |
| [psnawp](https://psnawp.readthedocs.io/) (Python) | Similar wrapper | Same auth model |

All of them use the same mechanism: the **NPSSO** session cookie from a signed-in playstation.com session is exchanged for OAuth tokens using the public client of the PlayStation mobile app.

## 3. Chosen approach

The app does the sign-in in Rust (`src-tauri/src/psn/`), mirroring psn-api's constants (verified against its source in `src/authenticate/*.ts` and `src/trophy/**`):

1. The user signs in at playstation.com **in their own browser** and copies the 64-character `npsso` value from `https://ca.account.sony.com/api/v1/ssocookie`. The app never asks for the PlayStation password.
2. `GET https://ca.account.sony.com/api/authz/v3/oauth/authorize?access_type=offline&client_id=09515159-7237-4370-9b40-3806e67c0891&redirect_uri=com.scee.psxandroid.scecompcall://redirect&response_type=code&scope=psn:mobile.v2.core psn:clientapp` with `Cookie: npsso=…`; the code is read from the `Location` header of the redirect (redirects are not followed).
3. `POST https://ca.account.sony.com/api/authz/v3/oauth/token` (`grant_type=authorization_code`, `token_format=jwt`, Basic auth with the public app client) → access token + refresh token.
4. Refresh with `grant_type=refresh_token` when the access token expires; on HTTP 401 the request is retried once with a fresh token.

Trophy endpoints used (base `https://m.np.playstation.com/api/trophy`):

| Purpose | Endpoint |
| --- | --- |
| List the account's trophy lists | `GET /v1/users/me/trophyTitles?limit&offset` |
| Trophy definitions for a list | `GET /v1/npCommunicationIds/{id}/trophyGroups/all/trophies?npServiceName=` |
| Group names | `GET /v1/npCommunicationIds/{id}/trophyGroups?npServiceName=` |
| Earned status for the account | `GET /v1/users/me/npCommunicationIds/{id}/trophyGroups/all/trophies?npServiceName=` |
| Title ID → trophy list (optional) | `GET /v1/users/me/titles/trophyTitles?npTitleIds=` |
| Own trophy level + numeric account ID | `GET /v1/users/me/trophySummary` |
| Own profile (online ID, avatar, PS Plus) | `GET https://m.np.playstation.com/api/userProfile/v1/internal/users/{accountId}/profiles` |

All requests are read-only (`GET`). Platinum Hunter never changes anything on your PSN account. The profile is cached in the local `app_meta` table so it shows offline; it is excluded from exports and deleted on disconnect.

## 4. Can it read *my* earned trophies, and tell PS5 from PS4?

- **Yes, for games on your account.** The user endpoints return `earned` and `earnedDateTime` per trophy. Sony only returns lists for titles the account has played, so a game must have been launched at least once.
- **PS5 vs PS4:** every trophy list has an `npServiceName` (`trophy` for PS3/PS4/Vita, `trophy2` for PS5) and a `trophyTitlePlatform`. GTA V's PS4 and PS5 lists have **identical names and identical trophy counts** (1P/3G/15S/59B), so Platinum Hunter never binds by name alone: `src/psn/binding.ts` requires the platform **and** the service to match, and `bindSet` re-checks this before writing. Tests in `src/psn/sync.test.ts` cover this.

## 5. Rate limits, availability, maintenance risk

- Sony documents no limits. Community reports suggest roughly 300 requests per 15 minutes. The client enforces a 400 ms minimum gap and at most 40 requests per minute, and honours `Retry-After` on HTTP 429 (`src-tauri/src/psn/limiter.rs`).
- A full sync of one game makes 3 requests (definitions, groups, earned) plus a token refresh when needed. Nothing polls in the background unless you enable auto-sync during sessions.
- **Risk:** these endpoints are unofficial. Sony can change or block them without notice, and using the PlayStation app's client may not be sanctioned by Sony's terms of service. If that happens, sync fails cleanly (shown as SYNC ERROR), previously verified data is kept, and the app continues as a manual tracker.
- Refresh tokens currently last about 60 days (`refresh_token_expires_in`); after that the app shows "Sign-in expired" and asks you to reconnect.

## 6. Security properties

- The NPSSO value is used once in memory and dropped; it is never written to disk or logs.
- The refresh token is stored only in **Windows Credential Manager** (`keyring` crate, service `com.platinumhunter.desktop`).
- Access tokens live only in the Rust process; the webview never receives them. The frontend calls narrow commands (`psn_user_titles`, `psn_user_earned`, …) that return trophy JSON only.
- Identifiers are validated in Rust (`NPWR#####_00`, `trophy|trophy2`) before any request; responses are validated with Zod in the frontend before any write.
- Database exports contain no credentials because none are stored in the database.

## 7. What has and has not been verified

| Item | Status |
| --- | --- |
| Request construction, token storage, rate limiting, identifier validation | Unit-tested in Rust (`cargo test`) |
| Sync logic: binding, ID reconciliation, verified/locked writes, failure preservation, stale data | Tested against **mock** responses shaped per the community docs (`npm test`) |
| Live round trip against real PSN | **Not verified during development** (no account credentials were available). Run `PSN_NPSSO=<value> cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_psn` to check it with your own account |
| GTA V PS5 `npCommunicationId` | **Unknown until you connect.** It could not be confirmed from a reliable public source, so the app resolves it from your own trophy list (service `trophy2`, platform PS5, counts 1/3/15/59) instead of hard-coding a guess |

## 8. If PSN cannot be used

Platinum Hunter works fully as a manual tracker. Manual marks are always labelled **MANUAL**, and no status is ever shown as verified unless a real sync succeeded.
