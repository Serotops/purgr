use serde::{Deserialize, Serialize};
use std::path::Path;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstalledApp {
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub install_location: String,
    pub install_date: String,
    pub estimated_size_kb: u64,
    pub uninstall_string: String,
    pub quiet_uninstall_string: String,
    pub registry_key: String,
    pub is_orphan: bool,
    pub icon_path: String,
}

const UNINSTALL_PATHS: &[(&str, &str)] = &[
    // 64-bit apps under HKLM
    (
        "HKLM",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ),
    // 32-bit apps under HKLM (WOW6432Node)
    (
        "HKLM",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ),
    // Per-user apps under HKCU
    (
        "HKCU",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    ),
];

pub fn scan_installed_apps() -> Result<Vec<InstalledApp>, Box<dyn std::error::Error>> {
    let mut apps: Vec<InstalledApp> = Vec::new();

    for (hive_name, path) in UNINSTALL_PATHS {
        let hive = match *hive_name {
            "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
            "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
            _ => continue,
        };

        let uninstall_key = match hive.open_subkey_with_flags(path, KEY_READ) {
            Ok(key) => key,
            Err(_) => continue,
        };

        for subkey_name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
            let subkey = match uninstall_key.open_subkey_with_flags(&subkey_name, KEY_READ) {
                Ok(k) => k,
                Err(_) => continue,
            };

            let name: String = subkey
                .get_value("DisplayName")
                .unwrap_or_default();

            // Skip entries without a display name — these are usually system components
            if name.is_empty() {
                continue;
            }

            // Skip system components and updates
            let system_component: u32 = subkey.get_value("SystemComponent").unwrap_or(0);
            if system_component == 1 {
                continue;
            }

            // Skip Windows updates (KB entries)
            let parent_key: String = subkey.get_value("ParentKeyName").unwrap_or_default();
            if !parent_key.is_empty() {
                continue;
            }

            let version: String = subkey.get_value("DisplayVersion").unwrap_or_default();
            let publisher: String = subkey.get_value("Publisher").unwrap_or_default();
            let install_location: String =
                subkey.get_value("InstallLocation").unwrap_or_default();
            let install_date: String = subkey.get_value("InstallDate").unwrap_or_default();
            let estimated_size_kb: u64 =
                subkey.get_value::<u32, _>("EstimatedSize").unwrap_or(0) as u64;
            let uninstall_string: String =
                subkey.get_value("UninstallString").unwrap_or_default();
            let quiet_uninstall_string: String =
                subkey.get_value("QuietUninstallString").unwrap_or_default();
            let icon_path: String = subkey.get_value("DisplayIcon").unwrap_or_default();

            let registry_key = format!("{}\\{}\\{}", hive_name, path, subkey_name);

            // Determine if the app is orphaned
            let is_orphan = determine_orphan_status(&install_location, &uninstall_string);

            apps.push(InstalledApp {
                name,
                version,
                publisher,
                install_location,
                install_date,
                estimated_size_kb,
                uninstall_string,
                quiet_uninstall_string,
                registry_key,
                is_orphan,
                icon_path,
            });
        }
    }

    // Sort by name case-insensitively
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // Deduplicate by name (keep first occurrence, which is usually the 64-bit entry)
    apps.dedup_by(|a, b| a.name.to_lowercase() == b.name.to_lowercase());

    Ok(apps)
}

fn determine_orphan_status(install_location: &str, uninstall_string: &str) -> bool {
    // If we have an install location, check if it exists
    if !install_location.is_empty() {
        let path = Path::new(install_location);
        if !path.exists() {
            return true;
        }
        return false;
    }

    // If no install location but we have an uninstall string, try to extract the exe path
    if !uninstall_string.is_empty() {
        let exe_path = extract_exe_path(uninstall_string);
        if !exe_path.is_empty() {
            let path = Path::new(&exe_path);
            if !path.exists() {
                return true;
            }
            return false;
        }
    }

    // Can't determine — not an orphan by default
    false
}

fn extract_exe_path(uninstall_string: &str) -> String {
    let trimmed = uninstall_string.trim();

    // Handle quoted paths
    if trimmed.starts_with('"') {
        if let Some(end) = trimmed[1..].find('"') {
            return trimmed[1..end + 1].to_string();
        }
    }

    // Handle MsiExec — can't determine path from this
    if trimmed.to_lowercase().starts_with("msiexec") {
        return String::new();
    }

    // Handle unquoted paths — take everything up to .exe
    if let Some(pos) = trimmed.to_lowercase().find(".exe") {
        return trimmed[..pos + 4].to_string();
    }

    String::new()
}

pub fn check_entry_exists(registry_key: &str) -> Result<bool, Box<dyn std::error::Error>> {
    let (hive_name, remaining) = registry_key
        .split_once('\\')
        .ok_or("Invalid registry key format")?;

    let hive = match hive_name {
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        _ => return Err("Unknown registry hive".into()),
    };

    match hive.open_subkey_with_flags(remaining, KEY_READ) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

pub fn remove_registry_entry(registry_key: &str) -> Result<String, Box<dyn std::error::Error>> {
    let (hive_name, remaining) = registry_key
        .split_once('\\')
        .ok_or("Invalid registry key format")?;

    let (parent_path, subkey_name) = remaining
        .rsplit_once('\\')
        .ok_or("Invalid registry key format")?;

    let hive = match hive_name {
        "HKLM" => RegKey::predef(HKEY_LOCAL_MACHINE),
        "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
        _ => return Err("Unknown registry hive".into()),
    };

    // Try direct deletion first
    match hive.open_subkey_with_flags(parent_path, KEY_WRITE) {
        Ok(parent) => {
            parent.delete_subkey_all(subkey_name)?;
            Ok(format!("Registry entry '{}' removed successfully", subkey_name))
        }
        Err(e) => {
            // If access denied, fall back to elevated reg.exe command
            if e.raw_os_error() == Some(5) {
                remove_registry_entry_elevated(registry_key)
            } else {
                Err(e.into())
            }
        }
    }
}

/// Uses `reg delete` via PowerShell with elevated privileges (triggers UAC prompt)
fn remove_registry_entry_elevated(registry_key: &str) -> Result<String, Box<dyn std::error::Error>> {
    use std::process::Command;

    // reg.exe expects HKLM\ or HKCU\ prefix
    let full_key = registry_key.to_string();

    let output = Command::new("powershell")
        .args([
            "-Command",
            &format!(
                "Start-Process reg.exe -ArgumentList 'delete \"{}\" /f' -Verb RunAs -Wait -WindowStyle Hidden",
                full_key
            ),
        ])
        .output()?;

    if output.status.success() {
        // Verify the key is actually gone
        if !check_entry_exists(registry_key).unwrap_or(true) {
            Ok(format!("Registry entry removed successfully (elevated)"))
        } else {
            Err("Elevation succeeded but registry entry still exists".into())
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Elevated removal failed: {}", stderr).into())
    }
}
