//! Submit / cancel per-edge Flink jobs and restore them from real checkpoints.
//!
//! Docker: Flink REST against the central JobManager, jobs pinned with
//! `--pin-resource pin-{edge}`.
//! Host: standalone `java -jar` with `--sidecar 127.0.0.1:{grpc}`.

use crate::runtime::SharedRuntime;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[derive(Debug, Clone)]
pub enum FlinkIntent {
    ArmShadow { savepoint: String },
    EnsureAuthority,
    Cancel,
}

struct RunningJob {
    job_id: Option<String>,
    child: Option<Child>,
}

fn registry() -> &'static Mutex<HashMap<String, RunningJob>> {
    static REG: OnceLock<Mutex<HashMap<String, RunningJob>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn rest_url() -> Option<String> {
    std::env::var("PREVAIL_FLINK_REST")
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
}

fn jar_path() -> Option<PathBuf> {
    std::env::var("PREVAIL_FLINK_JAR")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())
}

fn sidecar_for(edge_id: &str) -> String {
    if let Ok(explicit) = std::env::var("PREVAIL_FLINK_SIDECAR") {
        if !explicit.is_empty() {
            return explicit;
        }
    }
    if let Ok(urls) = std::env::var("PREVAIL_SIDECAR_GRPC_URLS") {
        for entry in urls.split(',') {
            let mut parts = entry.splitn(2, '=');
            if let (Some(id), Some(target)) = (parts.next(), parts.next()) {
                if id.trim() == edge_id {
                    return target.trim().to_string();
                }
            }
        }
    }
    if let Ok(port) = std::env::var("PREVAIL_SIDECAR_GRPC_PORT") {
        return format!("127.0.0.1:{port}");
    }
    "127.0.0.1:50051".into()
}

fn sink_path(edge_id: &str) -> String {
    let root = std::env::var("PREVAIL_FLINK_SINK").unwrap_or_else(|_| "/var/prevail/sink".into());
    format!("{root}/{edge_id}.jsonl")
}

pub fn checkpoint_dir(edge_id: &str) -> PathBuf {
    if let Ok(dir) = std::env::var("PREVAIL_CHECKPOINT_DIR") {
        let path = PathBuf::from(&dir);
        if path.file_name().and_then(|s| s.to_str()) == Some(edge_id) {
            return path;
        }
        let parent = path.parent().unwrap_or(Path::new("/var/prevail/checkpoints"));
        return parent.join(edge_id);
    }
    PathBuf::from("/var/prevail/checkpoints").join(edge_id)
}

/// Newest `chk-*` directory under the edge checkpoint root, as a `file://` URI.
///
/// Flink writes either `$dir/chk-N` or `$dir/<job-id>/chk-N`. Both are accepted
/// only when `_metadata` is present so empty folders are ignored.
pub fn latest_savepoint_for(edge_id: &str) -> Option<String> {
    let dir = checkpoint_dir(edge_id);
    let mut best: Option<(u64, PathBuf)> = None;
    consider_chk_dir(&dir, &mut best);
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                consider_chk_dir(&path, &mut best);
            }
        }
    }
    best.map(|(_, path)| format!("file://{}", path.display()))
}

fn consider_chk_dir(dir: &Path, best: &mut Option<(u64, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(rest) = name.strip_prefix("chk-") else {
            continue;
        };
        let Ok(n) = rest.parse::<u64>() else {
            continue;
        };
        if !entry.path().join("_metadata").exists() {
            continue;
        }
        let extra = std::fs::read_dir(entry.path())
            .ok()
            .map(|it| it.filter_map(|e| e.ok()).count())
            .unwrap_or(0);
        if extra < 1 {
            continue;
        }
        if best.as_ref().map(|(cur, _)| n > *cur).unwrap_or(true) {
            *best = Some((n, entry.path()));
        }
    }
}

pub async fn wait_for_savepoint(edge_id: &str, timeout: Duration) -> Option<String> {
    let start = std::time::Instant::now();
    loop {
        if let Some(path) = rest_latest_checkpoint_for(edge_id).await {
            return Some(path);
        }
        if let Some(path) = latest_savepoint_for(edge_id) {
            return Some(path);
        }
        if start.elapsed() >= timeout {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}

fn file_uri_exists(uri: &str) -> bool {
    let path = uri
        .strip_prefix("file://")
        .or_else(|| uri.strip_prefix("file:"))
        .unwrap_or(uri);
    let path = Path::new(path);
    if path.join("_metadata").exists() {
        return true;
    }
    path.is_dir()
        && std::fs::read_dir(path)
            .ok()
            .map(|it| it.filter_map(|e| e.ok()).count())
            .unwrap_or(0)
            >= 2
}

async fn rest_has_running_job(edge: &str) -> bool {
    let Some(rest) = rest_url() else {
        return false;
    };
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(3)).build() else {
        return false;
    };
    let Ok(resp) = client.get(format!("{rest}/jobs/overview")).send().await else {
        return false;
    };
    let Ok(overview) = resp.json::<JobsOverview>().await else {
        return false;
    };
    overview.jobs.iter().any(|j| j.state == "RUNNING" && job_belongs_to_edge(&j.name, edge))
}

async fn rest_running_job_id(edge: &str) -> Option<String> {
    let rest = rest_url()?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(3)).build().ok()?;
    let overview: JobsOverview = client
        .get(format!("{rest}/jobs/overview"))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    overview
        .jobs
        .into_iter()
        .find(|j| j.state == "RUNNING" && job_belongs_to_edge(&j.name, edge))
        .map(|j| j.jid)
}

fn normalize_file_uri(path: &str) -> String {
    if path.starts_with("file:") {
        path.to_string()
    } else {
        format!("file://{path}")
    }
}

fn usable_checkpoint_path(value: &serde_json::Value) -> Option<String> {
    if value.get("discarded").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }
    let path = value
        .get("external_path")
        .or_else(|| value.get("externalPath"))
        .and_then(|v| v.as_str())
        .filter(|p| !p.is_empty())?;
    let uri = normalize_file_uri(path);
    file_uri_exists(&uri).then_some(uri)
}

fn job_belongs_to_edge(name: &str, edge: &str) -> bool {
    name.split_whitespace().nth(1) == Some(edge)
}

async fn rest_latest_checkpoint_for(source_edge: &str) -> Option<String> {
    let rest = rest_url()?;
    let client = reqwest::Client::new();
    let overview: JobsOverview = client
        .get(format!("{rest}/jobs/overview"))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let jobs: Vec<JobRow> = overview
        .jobs
        .into_iter()
        .filter(|j| j.state == "RUNNING" && job_belongs_to_edge(&j.name, source_edge))
        .collect();
    for job in jobs {
        let body: serde_json::Value = client
            .get(format!("{rest}/jobs/{}/checkpoints", job.jid))
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .ok()?
            .json()
            .await
            .ok()?;
        if let Some(path) = body
            .pointer("/latest/completed")
            .and_then(usable_checkpoint_path)
        {
            return Some(path);
        }
        if let Some(history) = body.get("history").and_then(|v| v.as_array()) {
            for item in history.iter().rev() {
                if item.get("status").and_then(|v| v.as_str()) != Some("COMPLETED") {
                    continue;
                }
                if let Some(path) = usable_checkpoint_path(item) {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn is_restore_race(err: &str) -> bool {
    err.contains("FileNotFound")
        || err.contains("Cannot find checkpoint")
        || err.contains("does not exist")
        || err.contains("No valid checkpoint")
        || err.contains("Checkpoint directory")
}

async fn select_source_checkpoint(source: &str, hinted: &str) -> Option<String> {
    if !hinted.is_empty() && file_uri_exists(hinted) {
        return Some(hinted.to_string());
    }
    if let Some(path) = rest_latest_checkpoint_for(source).await {
        if file_uri_exists(&path) {
            return Some(path);
        }
    }
    latest_savepoint_for(source).filter(|path| file_uri_exists(path))
}

pub async fn apply_intent(runtime: SharedRuntime, intent: FlinkIntent) {
    match intent {
        FlinkIntent::ArmShadow { savepoint } => {
            if let Err(e) = ensure_job(runtime, JobKind::Shadow, savepoint).await {
                tracing::error!("shadow Flink submit failed: {e}");
            }
        }
        FlinkIntent::EnsureAuthority => {
            if let Err(e) = ensure_job(runtime, JobKind::Authority, String::new()).await {
                tracing::error!("authority Flink submit failed: {e}");
            }
        }
        FlinkIntent::Cancel => {
            if let Err(e) = cancel_local_job(runtime).await {
                tracing::error!("Flink cancel failed: {e}");
            }
        }
    }
}

enum JobKind {
    Authority,
    Shadow,
}

async fn ensure_job(
    runtime: SharedRuntime,
    kind: JobKind,
    savepoint: String,
) -> Result<(), String> {
    let (edge, source) = {
        let rt = runtime.read().await;
        (rt.local_edge_id().to_string(), rt.authority_holder())
    };
    {
        let reg = registry().lock().map_err(|e| e.to_string())?;
        if let Some(existing) = reg.get(&edge) {
            if existing.job_id.is_some() || existing.child.is_some() {
                if let Some(id) = existing.job_id.clone() {
                    persist_job_id(&edge, &id);
                }
                tracing::info!(edge = %edge, "Flink job already running");
                return Ok(());
            }
        }
    }
    if let Some(job_id) = rest_running_job_id(&edge).await {
        remember_job(&edge, Some(job_id.clone()), None);
        persist_job_id(&edge, &job_id);
        tracing::info!(edge = %edge, job_id = %job_id, "Flink REST already has a running job for this edge");
        return Ok(());
    }

    let mut last_err = String::new();
    for attempt in 0..4 {
        let mut restore = savepoint.clone();
        if matches!(kind, JobKind::Shadow) {
            restore = select_source_checkpoint(&source, &restore)
                .await
                .unwrap_or_default();
            if restore.is_empty() {
                restore = wait_for_savepoint(&source, Duration::from_secs(4))
                    .await
                    .unwrap_or_default();
            }
            if restore.is_empty() || !file_uri_exists(&restore) {
                last_err = format!(
                    "no Flink checkpoint available for source job {source}; refusing to start a cold shadow"
                );
                tokio::time::sleep(Duration::from_millis(400)).await;
                continue;
            }
            if !file_uri_exists(&restore) {
                last_err = format!("selected checkpoint vanished before submit: {restore}");
                continue;
            }
        }

        if rest_url().is_some() && jar_path().is_some() {
            match submit_via_rest(&edge, &restore).await {
                Ok(job_id) => {
                    remember_job(&edge, Some(job_id.clone()), None);
                    persist_job_id(&edge, &job_id);
                    emit_armed(runtime, &edge, &restore, Some(&job_id)).await;
                    return Ok(());
                }
                Err(e) if matches!(kind, JobKind::Shadow) && is_restore_race(&e) => {
                    tracing::warn!(attempt, source = %source, "source checkpoint vanished; retrying newest");
                    last_err = e;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        if let Some(jar) = jar_path() {
            let child = spawn_standalone(&edge, &jar, &restore)?;
            remember_job(&edge, None, Some(child));
            if let Some(job_id) = rest_running_job_id(&edge).await {
                persist_job_id(&edge, &job_id);
                if let Ok(mut reg) = registry().lock() {
                    if let Some(job) = reg.get_mut(&edge) {
                        job.job_id = Some(job_id.clone());
                    }
                }
                emit_armed(runtime, &edge, &restore, Some(&job_id)).await;
            } else {
                emit_armed(runtime, &edge, &restore, None).await;
            }
            return Ok(());
        }

        let _ = attempt;
        return Err("PREVAIL_FLINK_JAR / PREVAIL_FLINK_REST unset; cannot start Flink job".into());
    }
    Err(last_err)
}

async fn emit_armed(
    runtime: SharedRuntime,
    edge: &str,
    restore: &str,
    job_id: Option<&str>,
) {
    let mut rt = runtime.write().await;
    rt.record_flink_job(job_id.unwrap_or("standalone"), restore);
    tracing::info!(edge = %edge, restore = %restore, "Flink job armed");
}

fn remember_job(edge: &str, job_id: Option<String>, child: Option<Child>) {
    if let Ok(mut reg) = registry().lock() {
        reg.insert(edge.to_string(), RunningJob { job_id, child });
    }
}

fn persist_job_id(edge: &str, job_id: &str) {
    let path = checkpoint_dir(edge).join(".prevail-flink-job-id");
    let _ = std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")));
    let _ = std::fs::write(path, job_id);
}

fn load_persisted_job_id(edge: &str) -> Option<String> {
    let path = checkpoint_dir(edge).join(".prevail-flink-job-id");
    let raw = std::fs::read_to_string(path).ok()?;
    let id = raw.trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

fn clear_persisted_job_id(edge: &str) {
    let path = checkpoint_dir(edge).join(".prevail-flink-job-id");
    let _ = std::fs::remove_file(path);
}

async fn rest_running_job_ids(edge: &str) -> Vec<String> {
    let Some(rest) = rest_url() else {
        return Vec::new();
    };
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(3)).build() else {
        return Vec::new();
    };
    let Ok(resp) = client.get(format!("{rest}/jobs/overview")).send().await else {
        return Vec::new();
    };
    let Ok(overview) = resp.json::<JobsOverview>().await else {
        return Vec::new();
    };
    overview
        .jobs
        .into_iter()
        .filter(|j| j.state == "RUNNING" && job_belongs_to_edge(&j.name, edge))
        .map(|j| j.jid)
        .collect()
}

async fn cancel_via_rest(job_id: &str) {
    let Some(rest) = rest_url() else {
        return;
    };
    let client = reqwest::Client::new();
    let _ = client
        .patch(format!("{rest}/jobs/{job_id}?mode=cancel"))
        .timeout(Duration::from_secs(8))
        .send()
        .await;
}

async fn cancel_local_job(runtime: SharedRuntime) -> Result<(), String> {
    let edge = runtime.read().await.local_edge_id().to_string();
    let job = registry()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&edge);
    let mut ids = Vec::new();
    if let Some(id) = job.as_ref().and_then(|j| j.job_id.clone()) {
        ids.push(id);
    }
    if let Some(id) = load_persisted_job_id(&edge) {
        ids.push(id);
    }
    ids.extend(rest_running_job_ids(&edge).await);
    ids.sort();
    ids.dedup();
    for id in &ids {
        cancel_via_rest(id).await;
    }
    if let Some(mut job) = job {
        if let Some(child) = job.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    clear_persisted_job_id(&edge);
    runtime.write().await.record_flink_cancelled();
    Ok(())
}

fn spawn_standalone(edge: &str, jar: &Path, savepoint: &str) -> Result<Child, String> {
    let sidecar = sidecar_for(edge);
    let mut cmd = Command::new("java");
    cmd.args([
        "-Xms128m",
        "-Xmx384m",
        "-jar",
        &jar.display().to_string(),
        "--edge-id",
        edge,
        "--ingress",
        "sidecar",
        "--sidecar",
        &sidecar,
        "--sink",
        &sink_path(edge),
        "--checkpoint-dir",
        &checkpoint_dir(edge).display().to_string(),
        "--mode",
        "prevail",
    ])
    .env("PREVAIL_SIDECAR_GRPC", &sidecar)
    .env("PREVAIL_EDGE_ID", edge)
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    if !savepoint.is_empty() {
        cmd.args(["--from-savepoint", savepoint]);
    }
    cmd.spawn().map_err(|e| format!("java -jar failed: {e}"))
}

async fn submit_via_rest(edge: &str, savepoint: &str) -> Result<String, String> {
    let rest = rest_url().ok_or("no Flink REST")?;
    let jar = jar_path().ok_or("no Flink jar")?;
    let client = reqwest::Client::new();
    let jar_id = upload_jar(&client, &rest, &jar).await?;

    let sidecar = sidecar_for(edge);
    let mut args = vec![
        "--edge-id".into(),
        edge.to_string(),
        "--ingress".into(),
        "sidecar".into(),
        "--sidecar".into(),
        sidecar,
        "--sink".into(),
        sink_path(edge),
        "--checkpoint-dir".into(),
        checkpoint_dir(edge).display().to_string(),
        "--pin-resource".into(),
        format!("pin-{edge}"),
        "--mode".into(),
        "prevail".into(),
    ];
    if !savepoint.is_empty() {
        args.push("--from-savepoint".into());
        args.push(savepoint.to_string());
    }

    let mut body = serde_json::json!({
        "entryClass": "dev.prevail.job.PrevailStreamJob",
        "programArgsList": args,
        "parallelism": 1,
        "allowNonRestoredState": false,
    });
    if !savepoint.is_empty() {
        body["savepointPath"] = serde_json::Value::String(savepoint.to_string());
    }

    let resp = client
        .post(format!("{rest}/jars/{jar_id}/run"))
        .json(&body)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("jar run: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if body.contains("Job has been submitted")
            || body.contains("Job was submitted")
            || body.contains("submitted in detached mode")
        {
            if let Some(job_id) = rest_running_job_id(edge).await {
                return Ok(job_id);
            }
        }
        return Err(format!("jar run HTTP {status}: {body}"));
    }
    let run: JarRun = resp.json().await.map_err(|e| format!("jar run json: {e}"))?;
    if run.jobid.is_empty() {
        return Err("Flink REST returned empty jobid".into());
    }
    Ok(run.jobid)
}

async fn upload_jar(client: &reqwest::Client, rest: &str, jar: &Path) -> Result<String, String> {
    if let Ok(existing) = client
        .get(format!("{rest}/jars"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
    {
        if let Ok(list) = existing.json::<JarList>().await {
            if let Some(file) = list.files.into_iter().rev().find(|f| f.name.contains("prevail-job"))
            {
                return Ok(file.id);
            }
        }
    }
    let status = std::process::Command::new("curl")
        .args([
            "-sf",
            "-X",
            "POST",
            "-F",
            &format!("jarfile=@{}", jar.display()),
            &format!("{rest}/jars/upload"),
        ])
        .output()
        .map_err(|e| format!("curl upload: {e}"))?;
    if !status.status.success() {
        return Err(format!(
            "jar upload failed: {}",
            String::from_utf8_lossy(&status.stderr)
        ));
    }
    let uploaded: JarUpload =
        serde_json::from_slice(&status.stdout).map_err(|e| format!("upload json: {e}"))?;
    let name = uploaded
        .filename
        .rsplit('/')
        .next()
        .unwrap_or(&uploaded.filename)
        .to_string();
    Ok(name)
}

#[derive(Debug, Deserialize)]
struct JobsOverview {
    #[serde(default)]
    jobs: Vec<JobRow>,
}

#[derive(Debug, Deserialize)]
struct JobRow {
    jid: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct JarRun {
    #[serde(default)]
    jobid: String,
}

#[derive(Debug, Deserialize)]
struct JarList {
    #[serde(default)]
    files: Vec<JarFile>,
}

#[derive(Debug, Deserialize)]
struct JarFile {
    id: String,
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct JarUpload {
    #[serde(default)]
    filename: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_defaults_to_loopback() {
        let target = sidecar_for("edge-z");
        assert!(target.contains(':'));
    }

    #[test]
    fn source_job_name_does_not_match_other_edge() {
        assert!(job_belongs_to_edge("PREVAIL edge-a (prevail)", "edge-a"));
        assert!(!job_belongs_to_edge("PREVAIL edge-b (prevail)", "edge-a"));
        assert!(!job_belongs_to_edge("PREVAIL edge-ab (prevail)", "edge-a"));
    }

    #[test]
    fn finds_nested_flink_chk() {
        let root = std::env::temp_dir().join(format!("prevail-chk-{}", std::process::id()));
        let nested = root.join("jobid").join("chk-7");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("_metadata"), b"ok").unwrap();
        std::env::set_var("PREVAIL_CHECKPOINT_DIR", root.join("edge-z"));
        // checkpoint_dir uses PREVAIL_CHECKPOINT_DIR and appends sibling edge
        std::fs::create_dir_all(root.join("edge-z")).unwrap();
        let job = root.join("edge-z").join("abc").join("chk-3");
        std::fs::create_dir_all(&job).unwrap();
        std::fs::write(job.join("_metadata"), b"ok").unwrap();
        let found = latest_savepoint_for("edge-z").expect("nested chk");
        assert!(found.contains("chk-3"), "{found}");
        let _ = std::fs::remove_dir_all(root);
    }
}
