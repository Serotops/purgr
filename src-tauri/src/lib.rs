mod disk;
mod registry;

use std::process::Command;
use tauri::Emitter;

#[tauri::command]
fn get_installed_apps() -> Result<Vec<registry::InstalledApp>, String> {
    registry::scan_installed_apps().map_err(|e| e.to_string())
}

#[tauri::command]
async fn uninstall_app(uninstall_string: String) -> Result<String, String> {
    if uninstall_string.is_empty() {
        return Err("No uninstall command available".into());
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        let trimmed = uninstall_string.trim();

        // Detect URL protocols (steam://, epic://, etc.)
        // These must be launched via `start` or ShellExecute, not cmd /C directly
        if is_url_protocol(trimmed) {
            return run_url_protocol(trimmed);
        }

        // Detect MsiExec — needs special handling
        if trimmed.to_lowercase().starts_with("msiexec") {
            return run_msiexec(trimmed);
        }

        // Regular executable command
        run_command(trimmed)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e)?;

    Ok(result)
}

/// Check if the uninstall string contains a URL protocol like steam://
fn is_url_protocol(s: &str) -> bool {
    // Could be: steam://uninstall/123
    // Or: "C:\...\steam.exe" steam://uninstall/123
    let lower = s.to_lowercase();
    lower.contains("://")
}

/// Launch a URL protocol via `cmd /C start` which delegates to ShellExecute
fn run_url_protocol(uninstall_string: &str) -> Result<String, String> {
    // Extract the URL part — it might be embedded in a larger command
    // e.g. "C:\...\steam.exe" steam://uninstall/12345
    let url = extract_url(uninstall_string);

    if let Some(url) = url {
        // Use `start` to open the URL via the registered protocol handler
        let output = Command::new("cmd")
            .args(["/C", "start", "", &url])
            .output()
            .map_err(|e| format!("Failed to launch protocol URL: {}", e))?;

        if output.status.success() {
            return Ok("completed".to_string());
        }
    }

    // Fallback: try running the whole string via cmd /C start
    let output = Command::new("cmd")
        .args(["/C", "start", "", uninstall_string])
        .output()
        .map_err(|e| format!("Failed to launch: {}", e))?;

    if output.status.success() {
        Ok("completed".to_string())
    } else {
        // Try the whole thing as a regular command
        run_command(uninstall_string)
    }
}

/// Extract a URL like steam://... from a potentially larger command string
fn extract_url(s: &str) -> Option<String> {
    // Find something like word://path
    for part in s.split_whitespace() {
        let clean = part.trim_matches('"');
        if clean.contains("://") && !clean.starts_with('/') && !clean.starts_with('-') {
            return Some(clean.to_string());
        }
    }
    None
}

/// Run MsiExec with proper error handling
fn run_msiexec(uninstall_string: &str) -> Result<String, String> {
    let wrapped = if uninstall_string.contains('"') {
        format!("\"{}\"", uninstall_string)
    } else {
        uninstall_string.to_string()
    };

    let output = Command::new("cmd")
        .args(["/C", &wrapped])
        .output()
        .map_err(|e| format!("Failed to execute MsiExec: {}", e))?;

    let code = output.status.code().unwrap_or(-1);
    match code {
        0 | 3010 => Ok("completed".to_string()), // 3010 = reboot needed
        1602 => Err("Uninstall was cancelled by user".to_string()),
        1605 | 1614 => Ok("completed".to_string()), // Already gone
        5 | 740 => run_elevated(uninstall_string),
        _ => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() { stderr } else { stdout };
            if detail.is_empty() {
                Ok("completed".to_string())
            } else {
                Err(format!("Uninstall failed (exit code {}): {}", code, detail))
            }
        }
    }
}

/// Run a regular uninstall command, with elevation fallback
fn run_command(uninstall_string: &str) -> Result<String, String> {
    // cmd /C requires an extra set of outer quotes when the command itself
    // contains quoted paths, e.g.: cmd /C ""C:\path\app.exe" --args"
    let wrapped = if uninstall_string.contains('"') {
        format!("\"{}\"", uninstall_string)
    } else {
        uninstall_string.to_string()
    };

    let output = Command::new("cmd")
        .args(["/C", &wrapped])
        .output();

    match output {
        Ok(o) if o.status.success() => Ok("completed".to_string()),
        Ok(o) => {
            let code = o.status.code().unwrap_or(-1);
            if code == 5 || code == 740 {
                run_elevated(uninstall_string)
            } else {
                // Capture stderr/stdout for error details
                let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
                let detail = if !stderr.is_empty() {
                    stderr
                } else if !stdout.is_empty() {
                    stdout
                } else {
                    String::new()
                };

                if detail.is_empty() {
                    // No error detail — treat as completed (many uninstallers
                    // return non-zero but still worked, e.g. spawning a GUI)
                    Ok("completed".to_string())
                } else {
                    Err(format!("Uninstall failed (exit code {}): {}", code, detail))
                }
            }
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("740") || msg.contains("elevation") {
                run_elevated(uninstall_string)
            } else {
                Err(format!("Failed to execute uninstall command: {}", e))
            }
        }
    }
}

fn run_elevated(command: &str) -> Result<String, String> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Start-Process cmd.exe -ArgumentList '/C {}' -Verb RunAs -Wait",
                command.replace('\'', "''").replace('"', "'\\\"'")
            ),
        ])
        .output()
        .map_err(|e| format!("Failed to launch elevated process: {}", e))?;

    if output.status.success() {
        Ok("completed".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("canceled") || stderr.contains("cancelled") || stderr.contains("The operation was canceled") {
            Err("User cancelled the elevation prompt".to_string())
        } else {
            Ok("completed".to_string())
        }
    }
}

#[tauri::command]
fn check_app_installed(registry_key: String) -> Result<bool, String> {
    registry::check_entry_exists(&registry_key).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_registry_entry(registry_key: String) -> Result<String, String> {
    registry::remove_registry_entry(&registry_key).map_err(|e| e.to_string())
}

#[tauri::command]
fn refresh_app_status(install_location: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&install_location).exists())
}

#[tauri::command]
fn bulk_remove_registry_entries(registry_keys: Vec<String>) -> Vec<Result<String, String>> {
    registry::bulk_remove_registry_entries(&registry_keys)
}

// ── File operations ──────────────────────────────────────────────────────────

#[tauri::command]
async fn delete_path(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = std::path::Path::new(&path);
        if !target.exists() {
            return Ok("Already deleted".to_string());
        }

        let result = if target.is_dir() {
            std::fs::remove_dir_all(target)
        } else {
            std::fs::remove_file(target)
        };

        match result {
            Ok(()) => Ok(format!("Deleted: {}", path)),
            Err(e) if e.raw_os_error() == Some(5) => {
                // Access denied — in dev mode we're not elevated, so give a clear message.
                // In release builds the app runs as admin so this shouldn't happen.
                Err("Access denied — this file is protected or in use by another program. Close any programs using it and try again.".to_string())
            }
            Err(e) => Err(format!("Failed to delete: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

// ── Disk analysis commands ───────────────────────────────────────────────────

#[tauri::command]
fn list_drives() -> Result<Vec<disk::DriveInfo>, String> {
    disk::list_drives().map_err(|e| e.to_string())
}

/// Scan a specific directory with the fast parallel scanner.
#[tauri::command]
async fn scan_directory(path: String, max_depth: u32) -> Result<disk::DirEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        disk::scan_fast(&path, max_depth)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())
}

/// Progressive drive scan:
///   1. Emits "scan-shallow" instantly with folder names (no sizes)
///   2. Tries MFT scan (instant full results if admin + NTFS)
///   3. Falls back to parallel FindFirstFileExW scan
///   4. Emits "scan-complete" with full results
#[tauri::command]
async fn scan_drive_progressive(
    drive_letter: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let letter = drive_letter.chars().next().unwrap_or('C');
    let path = format!("{}:\\", letter);

    // Phase 1: Instant shallow scan (just folder names, no sizes)
    let shallow_path = path.clone();
    let shallow = tauri::async_runtime::spawn_blocking(move || {
        disk::scan_shallow(&shallow_path)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let _ = app.emit("scan-shallow", &shallow);

    // Phase 2: Try MFT scan first (needs admin, NTFS)
    let app_handle = app.clone();
    let mft_result = tauri::async_runtime::spawn_blocking(move || {
        let progress_emitter = |pct: f64, msg: &str| {
            let _ = app_handle.emit("scan-progress", serde_json::json!({
                "percent": pct,
                "message": msg,
            }));
        };

        // Try MFT
        match disk::scan_mft(letter, &progress_emitter) {
            Ok(result) => Ok(result),
            Err(_mft_err) => {
                // MFT failed — fall back to parallel fast scan with progress
                disk::scan_fast_with_progress(&path, 4, &progress_emitter)
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())?;

    let _ = app.emit("scan-complete", &mft_result);

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_installed_apps,
            uninstall_app,
            check_app_installed,
            remove_registry_entry,
            bulk_remove_registry_entries,
            refresh_app_status,
            delete_path,
            list_drives,
            scan_directory,
            scan_drive_progressive,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
