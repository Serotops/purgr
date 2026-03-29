mod disk;
mod registry;

use std::process::Command;

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
        // Try direct execution first
        let direct = execute_uninstall(&uninstall_string);

        match direct {
            Ok(_) => Ok("completed".to_string()),
            Err(e) => {
                let msg = e.to_string();
                // If access denied or elevation required, retry elevated
                if msg.contains("740") || msg.contains("elevation") || msg.contains("Access is denied") {
                    run_elevated(&uninstall_string)
                } else {
                    Err(e)
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e)?;

    Ok(result)
}

fn execute_uninstall(uninstall_string: &str) -> Result<String, String> {
    let trimmed = uninstall_string.trim();

    // Handle MsiExec specially — it needs to be called directly, not via cmd /C
    if trimmed.to_lowercase().starts_with("msiexec") {
        let output = Command::new("cmd")
            .args(["/C", trimmed])
            .output()
            .map_err(|e| format!("Failed to execute: {}", e))?;

        // MsiExec returns 0 on success, 1602 on user cancel, 1605 if not found
        return match output.status.code() {
            Some(0) => Ok("completed".to_string()),
            Some(1602) => Err("Uninstall was cancelled by user".to_string()),
            Some(1605) => Ok("completed".to_string()), // Already uninstalled
            Some(5) | Some(740) => Err("elevation".to_string()),
            Some(code) => {
                // Many codes still mean success — the uninstaller ran
                Ok(format!("completed with code {}", code))
            }
            None => Ok("completed".to_string()),
        };
    }

    // For everything else: run via cmd /C
    // This handles quoted paths, arguments, etc.
    let output = Command::new("cmd")
        .args(["/C", trimmed])
        .output()
        .map_err(|e| {
            let msg = e.to_string();
            if e.raw_os_error() == Some(740) {
                "elevation".to_string()
            } else {
                format!("Failed to execute: {}", msg)
            }
        })?;

    match output.status.code() {
        Some(5) | Some(740) => Err("elevation".to_string()),
        _ => Ok("completed".to_string()),
    }
}

fn run_elevated(command: &str) -> Result<String, String> {
    // Use ShellExecuteW via PowerShell Start-Process -Verb RunAs
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
            // Still treat as completed — the uninstaller likely ran
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

// --- Disk analysis commands ---

#[tauri::command]
fn list_drives() -> Result<Vec<disk::DriveInfo>, String> {
    disk::list_drives().map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_directory(path: String, max_depth: u32) -> Result<disk::DirEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        disk::scan_directory(&path, max_depth)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())
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
            refresh_app_status,
            list_drives,
            scan_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
