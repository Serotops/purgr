use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DriveInfo {
    pub letter: String,
    pub label: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub children: Vec<DirEntry>,
    pub file_count: u64,
    pub dir_count: u64,
}

/// List all available drives with size info
pub fn list_drives() -> Result<Vec<DriveInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let mut drives = Vec::new();

    // Check drive letters A-Z
    for letter in b'A'..=b'Z' {
        let drive_path = format!("{}:\\", letter as char);
        let path = Path::new(&drive_path);

        if path.exists() {
            // Use GetDiskFreeSpaceExW via std
            match fs::metadata(path) {
                Ok(_) => {
                    let (total, free) = get_disk_space(&drive_path);
                    if total > 0 {
                        let label = get_volume_label(&drive_path);
                        drives.push(DriveInfo {
                            letter: format!("{}:", letter as char),
                            label,
                            total_bytes: total,
                            free_bytes: free,
                            used_bytes: total.saturating_sub(free),
                        });
                    }
                }
                Err(_) => continue,
            }
        }
    }

    Ok(drives)
}

fn get_disk_space(drive: &str) -> (u64, u64) {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;

    let wide: Vec<u16> = OsStr::new(drive).encode_wide().chain(std::iter::once(0)).collect();

    let mut free_bytes_available: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free_bytes: u64 = 0;

    unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_bytes_available as *mut u64,
            &mut total_bytes as *mut u64,
            &mut total_free_bytes as *mut u64,
        );
    }

    (total_bytes, free_bytes_available)
}

fn get_volume_label(drive: &str) -> String {
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;

    let wide: Vec<u16> = OsStr::new(drive).encode_wide().chain(std::iter::once(0)).collect();
    let mut label_buf: [u16; 256] = [0; 256];

    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetVolumeInformationW(
            wide.as_ptr(),
            label_buf.as_mut_ptr(),
            label_buf.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };

    if ok != 0 {
        let len = label_buf.iter().position(|&c| c == 0).unwrap_or(0);
        String::from_utf16_lossy(&label_buf[..len])
    } else {
        String::new()
    }
}

/// Scan a directory recursively up to a given depth.
/// Returns a tree of DirEntry with aggregated sizes.
pub fn scan_directory(path: &str, max_depth: u32) -> Result<DirEntry, Box<dyn std::error::Error + Send + Sync>> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path).into());
    }

    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let entry = scan_recursive(p, &name, max_depth);
    Ok(entry)
}

fn scan_recursive(path: &Path, name: &str, depth: u32) -> DirEntry {
    let mut entry = DirEntry {
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
        size: 0,
        is_dir: true,
        children: Vec::new(),
        file_count: 0,
        dir_count: 0,
    };

    let read_dir = match fs::read_dir(path) {
        Ok(rd) => rd,
        Err(_) => return entry,
    };

    let mut file_sizes = 0u64;
    let mut file_count = 0u64;

    for item in read_dir.filter_map(|e| e.ok()) {
        let meta = match item.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let item_name = item.file_name().to_string_lossy().to_string();

        if meta.is_dir() {
            if depth > 0 {
                let child = scan_recursive(&item.path(), &item_name, depth - 1);
                entry.file_count += child.file_count;
                entry.dir_count += child.dir_count + 1;
                entry.size += child.size;
                entry.children.push(child);
            } else {
                // At depth limit, just compute size without building children
                let (sz, fc) = fast_dir_size(&item.path());
                entry.size += sz;
                entry.file_count += fc;
                entry.dir_count += 1;
                entry.children.push(DirEntry {
                    name: item_name,
                    path: item.path().to_string_lossy().to_string(),
                    size: sz,
                    is_dir: true,
                    children: Vec::new(),
                    file_count: fc,
                    dir_count: 0,
                });
            }
        } else {
            file_sizes += meta.len();
            file_count += 1;
        }
    }

    entry.size += file_sizes;
    entry.file_count += file_count;

    // Add a synthetic "<files>" entry to represent loose files in this dir
    if file_sizes > 0 {
        entry.children.push(DirEntry {
            name: format!("<files> ({} files)", file_count),
            path: entry.path.clone(),
            size: file_sizes,
            is_dir: false,
            children: Vec::new(),
            file_count,
            dir_count: 0,
        });
    }

    // Sort children by size descending
    entry.children.sort_by(|a, b| b.size.cmp(&a.size));

    entry
}

/// Fast size calculation without building a tree
fn fast_dir_size(path: &Path) -> (u64, u64) {
    let mut total = 0u64;
    let mut count = 0u64;

    let mut stack = vec![path.to_path_buf()];

    while let Some(dir) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&dir) {
            for item in entries.filter_map(|e| e.ok()) {
                if let Ok(meta) = item.metadata() {
                    if meta.is_file() {
                        total += meta.len();
                        count += 1;
                    } else if meta.is_dir() {
                        stack.push(item.path());
                    }
                }
            }
        }
    }

    (total, count)
}
