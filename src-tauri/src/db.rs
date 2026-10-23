//! Local SQLite storage.
//!
//! The frontend owns the schema (versioned migrations in `src/db/migrations.ts`) and
//! talks to SQLite through three narrow commands: `db_select`, `db_execute` and
//! `db_batch`. Every statement is parameterised: values travel separately from SQL
//! text and are bound by SQLite, never interpolated.
//!
//! A single connection behind a mutex is used so that `db_batch` transactions are
//! genuinely atomic (a connection pool would scatter BEGIN/COMMIT across connections).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as JsonValue};

use crate::error::{AppError, AppResult};

pub const DB_FILE_NAME: &str = "platinum-hunter.db";
/// Marker written by migration 1; used to recognise our own backups on restore.
pub const APP_MARKER: &str = "platinum-hunter";

pub struct Database {
    path: PathBuf,
    conn: Mutex<Connection>,
}

#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<JsonValue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub rows_affected: usize,
    pub last_insert_id: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
}

pub fn open_connection(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

impl Database {
    pub fn open(path: PathBuf) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = open_connection(&path)?;
        Ok(Self { path, conn: Mutex::new(conn) })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| AppError::database("database lock poisoned"))
    }

    pub fn select(&self, sql: &str, params: &[JsonValue]) -> AppResult<Vec<Map<String, JsonValue>>> {
        let conn = self.lock()?;
        select_rows(&conn, sql, params)
    }

    pub fn execute(&self, sql: &str, params: &[JsonValue]) -> AppResult<ExecResult> {
        let conn = self.lock()?;
        execute_one(&conn, sql, params)
    }

    pub fn batch(&self, statements: &[Statement]) -> AppResult<()> {
        let mut conn = self.lock()?;
        run_batch(&mut conn, statements)
    }

    pub fn info(&self) -> AppResult<DbInfo> {
        // Checkpoint so the reported size reflects committed data.
        {
            let conn = self.lock()?;
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
        }
        let size_bytes = std::fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);
        Ok(DbInfo { path: self.path.to_string_lossy().to_string(), size_bytes })
    }

    /// Writes a consistent copy of the database to `dest` using `VACUUM INTO`.
    pub fn backup_to(&self, dest: &Path) -> AppResult<()> {
        if dest == self.path {
            return Err(AppError::invalid_input("Backup destination cannot be the live database."));
        }
        if dest.exists() {
            std::fs::remove_file(dest)?;
        }
        let conn = self.lock()?;
        conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().to_string()])?;
        Ok(())
    }

    /// Replaces the live database with a validated backup file.
    ///
    /// A safety copy of the current database is written to `safety_copy` first, so a
    /// restore can always be undone.
    pub fn restore_from(&self, src: &Path, safety_copy: &Path, max_schema_version: i64) -> AppResult<i64> {
        let version = validate_backup(src, max_schema_version)?;
        self.backup_to(safety_copy)?;

        let mut conn = self.lock()?;
        // Swap in a throwaway connection so the file handle on the live DB is released.
        let placeholder = Connection::open_in_memory()?;
        let old = std::mem::replace(&mut *conn, placeholder);
        old.close().map_err(|(_, e)| AppError::from(e))?;

        let wal = PathBuf::from(format!("{}-wal", self.path.display()));
        let shm = PathBuf::from(format!("{}-shm", self.path.display()));
        let _ = std::fs::remove_file(&wal);
        let _ = std::fs::remove_file(&shm);

        let copy_result = std::fs::copy(src, &self.path);
        // Reopen whichever file is now in place, even if the copy failed, so the app keeps working.
        if copy_result.is_err() {
            std::fs::copy(safety_copy, &self.path)?;
        }
        *conn = open_connection(&self.path)?;
        copy_result?;
        Ok(version)
    }
}

/// Checks that `src` is an intact Platinum Hunter database and returns its schema version.
pub fn validate_backup(src: &Path, max_schema_version: i64) -> AppResult<i64> {
    let meta = std::fs::metadata(src).map_err(|_| AppError::invalid_input("Backup file not found."))?;
    if meta.len() < 512 {
        return Err(AppError::invalid_input("The selected file is too small to be a database backup."));
    }
    let conn = Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| AppError::invalid_input("The selected file is not a SQLite database."))?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| AppError::invalid_input("The selected file is not a readable SQLite database."))?;
    if integrity != "ok" {
        return Err(AppError::invalid_input(format!(
            "The backup failed an integrity check ({integrity})."
        )));
    }
    let marker: Option<String> = conn
        .query_row("SELECT value FROM app_meta WHERE key = 'app'", [], |r| r.get(0))
        .ok();
    if marker.as_deref() != Some(APP_MARKER) {
        return Err(AppError::invalid_input("The selected file is not a Platinum Hunter backup."));
    }
    let version: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .map_err(|_| AppError::invalid_input("The backup has no migration history."))?;
    if version > max_schema_version {
        return Err(AppError::invalid_input(format!(
            "This backup was created by a newer version of Platinum Hunter (schema v{version}). Update the app first."
        )));
    }
    Ok(version)
}

pub fn json_to_sql(value: &JsonValue) -> AppResult<SqlValue> {
    Ok(match value {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(i64::from(*b)),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                return Err(AppError::invalid_input("Unsupported numeric parameter."));
            }
        }
        JsonValue::String(s) => SqlValue::Text(s.clone()),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            return Err(AppError::invalid_input(
                "SQL parameters must be scalars; serialise structured values to JSON text first.",
            ))
        }
    })
}

fn sql_to_json(value: ValueRef<'_>) -> JsonValue {
    match value {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(i) => JsonValue::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(JsonValue::Number).unwrap_or(JsonValue::Null),
        ValueRef::Text(t) => JsonValue::String(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => JsonValue::Array(b.iter().map(|x| JsonValue::Number((*x).into())).collect()),
    }
}

fn bind(params: &[JsonValue]) -> AppResult<Vec<SqlValue>> {
    params.iter().map(json_to_sql).collect()
}

pub fn select_rows(conn: &Connection, sql: &str, params: &[JsonValue]) -> AppResult<Vec<Map<String, JsonValue>>> {
    let values = bind(params)?;
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(values.iter()))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), sql_to_json(row.get_ref(i)?));
        }
        out.push(obj);
    }
    Ok(out)
}

pub fn execute_one(conn: &Connection, sql: &str, params: &[JsonValue]) -> AppResult<ExecResult> {
    let values = bind(params)?;
    let rows_affected = if values.is_empty() && sql.trim_end().trim_end_matches(';').contains(';') {
        // Multi-statement scripts (used by migrations) cannot take parameters.
        conn.execute_batch(sql)?;
        0
    } else {
        conn.execute(sql, params_from_iter(values.iter()))?
    };
    Ok(ExecResult { rows_affected, last_insert_id: conn.last_insert_rowid() })
}

pub fn run_batch(conn: &mut Connection, statements: &[Statement]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for st in statements {
        let values = bind(&st.params)?;
        if values.is_empty() && st.sql.trim_end().trim_end_matches(';').contains(';') {
            tx.execute_batch(&st.sql)?;
        } else {
            tx.execute(&st.sql, params_from_iter(values.iter()))?;
        }
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn seeded(dir: &Path) -> Database {
        let db = Database::open(dir.join(DB_FILE_NAME)).unwrap();
        db.batch(&[
            Statement { sql: "CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT); CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score REAL, flag INTEGER);".into(), params: vec![] },
            Statement { sql: "INSERT INTO app_meta (key, value) VALUES ('app', ?1)".into(), params: vec![json!(APP_MARKER)] },
            Statement { sql: "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'init', 'now')".into(), params: vec![] },
        ])
        .unwrap();
        db
    }

    #[test]
    fn parameters_are_bound_not_interpolated() {
        let dir = tempfile::tempdir().unwrap();
        let db = seeded(dir.path());
        let hostile = "x'); DROP TABLE t; --";
        db.execute("INSERT INTO t (name, score, flag) VALUES (?1, ?2, ?3)", &[json!(hostile), json!(1.5), json!(true)])
            .unwrap();
        let rows = db.select("SELECT name, score, flag FROM t WHERE name = ?1", &[json!(hostile)]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], json!(hostile));
        assert_eq!(rows[0]["score"], json!(1.5));
        assert_eq!(rows[0]["flag"], json!(1));
    }

    #[test]
    fn batch_is_atomic() {
        let dir = tempfile::tempdir().unwrap();
        let db = seeded(dir.path());
        let result = db.batch(&[
            Statement { sql: "INSERT INTO t (id, name) VALUES (1, 'a')".into(), params: vec![] },
            Statement { sql: "INSERT INTO t (id, name) VALUES (1, 'duplicate')".into(), params: vec![] },
        ]);
        assert!(result.is_err());
        let rows = db.select("SELECT COUNT(*) AS n FROM t", &[]).unwrap();
        assert_eq!(rows[0]["n"], json!(0));
    }

    #[test]
    fn rejects_structured_params() {
        let dir = tempfile::tempdir().unwrap();
        let db = seeded(dir.path());
        assert!(db.execute("INSERT INTO t (name) VALUES (?1)", &[json!({"a": 1})]).is_err());
    }

    #[test]
    fn backup_and_restore_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let db = seeded(dir.path());
        db.execute("INSERT INTO t (name) VALUES ('before-backup')", &[]).unwrap();
        let backup = dir.path().join("backup.db");
        db.backup_to(&backup).unwrap();

        db.execute("INSERT INTO t (name) VALUES ('after-backup')", &[]).unwrap();
        let version = db.restore_from(&backup, &dir.path().join("safety.db"), 5).unwrap();
        assert_eq!(version, 1);
        let rows = db.select("SELECT name FROM t ORDER BY id", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], json!("before-backup"));
        // The safety copy holds the pre-restore state.
        assert!(validate_backup(&dir.path().join("safety.db"), 5).is_ok());
    }

    #[test]
    fn restore_rejects_foreign_and_corrupt_files() {
        let dir = tempfile::tempdir().unwrap();
        let db = seeded(dir.path());
        let junk = dir.path().join("junk.db");
        std::fs::write(&junk, vec![7u8; 4096]).unwrap();
        assert!(db.restore_from(&junk, &dir.path().join("s1.db"), 5).is_err());

        let foreign = dir.path().join("foreign.db");
        let c = Connection::open(&foreign).unwrap();
        c.execute_batch("CREATE TABLE app_meta (key TEXT, value TEXT); INSERT INTO app_meta VALUES ('app','other'); CREATE TABLE padding (x BLOB); INSERT INTO padding VALUES (zeroblob(2048));").unwrap();
        drop(c);
        assert!(validate_backup(&foreign, 5).is_err());
    }

    #[test]
    fn restore_rejects_newer_schema() {
        let dir = tempfile::tempdir().unwrap();
        let db = seeded(dir.path());
        db.execute("INSERT INTO schema_migrations (version, name, applied_at) VALUES (9, 'future', 'now')", &[]).unwrap();
        let backup = dir.path().join("future.db");
        db.backup_to(&backup).unwrap();
        assert!(validate_backup(&backup, 5).is_err());
    }
}
