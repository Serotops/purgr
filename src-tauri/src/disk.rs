use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DriveInfo {
    pub letter: String,
    pub label: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
    pub is_ntfs: bool,
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

// ── Helpers ──────────────────────────────────────────────────────────────────

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn wide_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

// ── Drive listing ────────────────────────────────────────────────────────────

pub fn list_drives() -> Result<Vec<DriveInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let mut drives = Vec::new();

    for letter in b'A'..=b'Z' {
        let drive_path = format!("{}:\\", letter as char);
        let path = Path::new(&drive_path);
        if !path.exists() {
            continue;
        }

        let (total, free) = get_disk_space(&drive_path);
        if total == 0 {
            continue;
        }

        let (label, fs_name) = get_volume_info(&drive_path);

        drives.push(DriveInfo {
            letter: format!("{}:", letter as char),
            label,
            total_bytes: total,
            free_bytes: free,
            used_bytes: total.saturating_sub(free),
            is_ntfs: fs_name.eq_ignore_ascii_case("NTFS"),
        });
    }

    Ok(drives)
}

fn get_disk_space(drive: &str) -> (u64, u64) {
    let wide = to_wide(drive);
    let mut free_avail: u64 = 0;
    let mut total: u64 = 0;
    let mut _total_free: u64 = 0;
    unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_avail,
            &mut total,
            &mut _total_free,
        );
    }
    (total, free_avail)
}

fn get_volume_info(drive: &str) -> (String, String) {
    let wide = to_wide(drive);
    let mut label_buf = [0u16; 256];
    let mut fs_buf = [0u16; 64];
    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetVolumeInformationW(
            wide.as_ptr(),
            label_buf.as_mut_ptr(),
            label_buf.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            fs_buf.as_mut_ptr(),
            fs_buf.len() as u32,
        )
    };
    if ok != 0 {
        (wide_to_string(&label_buf), wide_to_string(&fs_buf))
    } else {
        (String::new(), String::new())
    }
}

// ── Fast scan using FindFirstFileExW + rayon ─────────────────────────────────
//
// Optimization 1: FindFirstFileExW with FindExInfoBasic + FIND_FIRST_EX_LARGE_FETCH
//   avoids the double syscall of fs::read_dir + fs::metadata
// Optimization 2: rayon parallel iteration over subdirectories

const FIND_FIRST_EX_LARGE_FETCH: u32 = 0x00000002;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;

struct RawEntry {
    name: String,
    size: u64,
    is_dir: bool,
}

/// List immediate children of a directory using FindFirstFileExW.
/// Returns all entries with name, size, and directory flag in a single syscall per entry.
fn list_dir_fast(path: &Path) -> Vec<RawEntry> {
    let search = format!("{}\\*", path.to_string_lossy());
    let wide = to_wide(&search);

    let mut fd: windows_sys::Win32::Storage::FileSystem::WIN32_FIND_DATAW =
        unsafe { std::mem::zeroed() };

    let handle = unsafe {
        windows_sys::Win32::Storage::FileSystem::FindFirstFileExW(
            wide.as_ptr(),
            windows_sys::Win32::Storage::FileSystem::FindExInfoBasic,
            &mut fd as *mut _ as *mut _,
            windows_sys::Win32::Storage::FileSystem::FindExSearchNameMatch,
            std::ptr::null(),
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };

    if handle == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
        return Vec::new();
    }

    let mut results = Vec::new();

    // Reparse tag constants
    const IO_REPARSE_TAG_SYMLINK: u32 = 0xA000000C;
    const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA0000003;

    loop {
        let name = wide_to_string(&fd.cFileName);
        if name != "." && name != ".." {
            let is_dir = fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
            let size = ((fd.nFileSizeHigh as u64) << 32) | fd.nFileSizeLow as u64;
            let is_reparse = fd.dwFileAttributes & 0x400 != 0;

            // Only skip symlinks and junctions (mount points) to avoid loops.
            // Keep other reparse points (OneDrive, dedup, etc.)
            let skip = is_reparse && (fd.dwReserved0 == IO_REPARSE_TAG_SYMLINK || fd.dwReserved0 == IO_REPARSE_TAG_MOUNT_POINT);

            if !skip {
                results.push(RawEntry { name, size, is_dir });
            }
        }
        if unsafe { windows_sys::Win32::Storage::FileSystem::FindNextFileW(handle, &mut fd) } == 0 {
            break;
        }
    }

    unsafe { windows_sys::Win32::Storage::FileSystem::FindClose(handle) };
    results
}

/// Fast recursive size calculation using FindFirstFileExW (no tree building).
/// Uses an iterative stack to avoid stack overflow on deep hierarchies.
fn fast_dir_size(path: &Path) -> (u64, u64) {
    let mut total = 0u64;
    let mut count = 0u64;
    let mut stack = vec![path.to_path_buf()];

    while let Some(dir) = stack.pop() {
        for entry in list_dir_fast(&dir) {
            if entry.is_dir {
                stack.push(dir.join(&entry.name));
            } else {
                total += entry.size;
                count += 1;
            }
        }
    }
    (total, count)
}

/// Scan a directory using FindFirstFileExW + rayon.
/// `max_depth` controls how deep we build the tree; beyond that we just compute sizes.
pub fn scan_fast(
    path: &str,
    max_depth: u32,
) -> Result<DirEntry, Box<dyn std::error::Error + Send + Sync>> {
    scan_fast_with_progress(path, max_depth, |_, _| {})
}

pub fn scan_fast_with_progress(
    path: &str,
    max_depth: u32,
    on_progress: impl Fn(f64, &str) + Send + Sync,
) -> Result<DirEntry, Box<dyn std::error::Error + Send + Sync>> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path).into());
    }
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    // First list top-level to get count for progress
    let items = list_dir_fast(p);
    let total_dirs = items.iter().filter(|i| i.is_dir).count();
    let completed = std::sync::atomic::AtomicUsize::new(0);

    let mut files: Vec<RawEntry> = Vec::new();
    let mut dirs: Vec<RawEntry> = Vec::new();

    for item in items {
        if item.is_dir {
            dirs.push(item);
        } else {
            files.push(item);
        }
    }

    on_progress(0.0, &format!("scan_folders:{}", total_dirs));

    // Scan subdirectories in parallel, reporting progress
    let mut children: Vec<DirEntry> = dirs
        .par_iter()
        .map(|d| {
            let child_path = p.join(&d.name);
            let result = scan_fast_recursive(&child_path, &d.name, max_depth.saturating_sub(1));
            let done = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            let pct = (done as f64 / total_dirs.max(1) as f64) * 100.0;
            on_progress(pct, &format!("scanned_folders:{}/{}", done, total_dirs));
            result
        })
        .collect();

    // Add individual file entries
    for file in files {
        children.push(DirEntry {
            name: file.name.clone(),
            path: p.join(&file.name).to_string_lossy().to_string(),
            size: file.size,
            is_dir: false,
            children: Vec::new(),
            file_count: 1,
            dir_count: 0,
        });
    }

    children.sort_by(|a, b| b.size.cmp(&a.size));

    let total_size: u64 = children.iter().map(|c| c.size).sum();
    let total_files: u64 = children.iter().map(|c| c.file_count).sum();
    let total_dir_count: u64 = children.iter().filter(|c| c.is_dir).count() as u64;

    Ok(DirEntry {
        name: name.to_string(),
        path: path.to_string(),
        size: total_size,
        is_dir: true,
        children,
        file_count: total_files,
        dir_count: total_dir_count,
    })
}

fn scan_fast_recursive(path: &Path, name: &str, depth: u32) -> DirEntry {
    let items = list_dir_fast(path);

    let mut files: Vec<RawEntry> = Vec::new();
    let mut dirs: Vec<RawEntry> = Vec::new();

    for item in items {
        if item.is_dir {
            dirs.push(item);
        } else {
            files.push(item);
        }
    }


    // Scan subdirectories — in parallel at depth 0 and 1, sequential deeper
    let mut children: Vec<DirEntry> = if depth > 0 {
        if depth >= 2 {
            // Top levels: parallel
            dirs.par_iter()
                .map(|d| {
                    let child_path = path.join(&d.name);
                    scan_fast_recursive(&child_path, &d.name, depth - 1)
                })
                .collect()
        } else {
            // Deeper levels: sequential to avoid thread explosion
            dirs.iter()
                .map(|d| {
                    let child_path = path.join(&d.name);
                    scan_fast_recursive(&child_path, &d.name, depth - 1)
                })
                .collect()
        }
    } else {
        // At depth limit: just compute sizes (parallel for large dirs)
        if dirs.len() > 20 {
            dirs.par_iter()
                .map(|d| {
                    let child_path = path.join(&d.name);
                    let (sz, fc) = fast_dir_size(&child_path);
                    DirEntry {
                        name: d.name.clone(),
                        path: child_path.to_string_lossy().to_string(),
                        size: sz,
                        is_dir: true,
                        children: Vec::new(),
                        file_count: fc,
                        dir_count: 0,
                    }
                })
                .collect()
        } else {
            dirs.iter()
                .map(|d| {
                    let child_path = path.join(&d.name);
                    let (sz, fc) = fast_dir_size(&child_path);
                    DirEntry {
                        name: d.name.clone(),
                        path: child_path.to_string_lossy().to_string(),
                        size: sz,
                        is_dir: true,
                        children: Vec::new(),
                        file_count: fc,
                        dir_count: 0,
                    }
                })
                .collect()
        }
    };

    // Add individual file entries
    for file in files {
        children.push(DirEntry {
            name: file.name.clone(),
            path: path.join(&file.name).to_string_lossy().to_string(),
            size: file.size,
            is_dir: false,
            children: Vec::new(),
            file_count: 1,
            dir_count: 0,
        });
    }

    children.sort_by(|a, b| b.size.cmp(&a.size));

    let total_size: u64 = children.iter().map(|c| c.size).sum();
    let total_files: u64 = children.iter().map(|c| c.file_count).sum();
    let total_dirs: u64 = children.iter().filter(|c| c.is_dir).count() as u64;

    DirEntry {
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
        size: total_size,
        is_dir: true,
        children,
        file_count: total_files,
        dir_count: total_dirs,
    }
}

/// Quick depth-1 scan for progressive loading. Returns almost instantly.
pub fn scan_shallow(path: &str) -> Result<DirEntry, Box<dyn std::error::Error + Send + Sync>> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path).into());
    }
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let items = list_dir_fast(p);
    let mut children: Vec<DirEntry> = Vec::new();
    let mut files_size = 0u64;
    let mut files_count = 0u64;

    for item in items {
        if item.is_dir {
            // Just record the directory, size will be 0 for now
            children.push(DirEntry {
                name: item.name.clone(),
                path: p.join(&item.name).to_string_lossy().to_string(),
                size: 0,
                is_dir: true,
                children: Vec::new(),
                file_count: 0,
                dir_count: 0,
            });
        } else {
            files_size += item.size;
            files_count += 1;
        }
    }

    if files_size > 0 {
        children.push(DirEntry {
            name: format!("<files> ({} files)", files_count),
            path: p.to_string_lossy().to_string(),
            size: files_size,
            is_dir: false,
            children: Vec::new(),
            file_count: files_count,
            dir_count: 0,
        });
    }

    let dir_count = children.iter().filter(|c| c.is_dir).count() as u64;
    Ok(DirEntry {
        name: name.to_string(),
        path: path.to_string(),
        size: files_size,
        is_dir: true,
        children,
        file_count: files_count,
        dir_count,
    })
}

// ── MFT Scanner ──────────────────────────────────────────────────────────────
//
// Optimization 4: Read the NTFS Master File Table directly for near-instant
// full-drive scanning. Requires admin privileges and NTFS volume.
//
// Flow:
//   1. Open \\.\X: volume raw
//   2. FSCTL_GET_NTFS_VOLUME_DATA → MFT location, record size
//   3. Read MFT records sequentially
//   4. Parse $FILE_NAME (name, parent ref) and $DATA (size) attributes
//   5. Build directory tree from parent references

const FSCTL_GET_NTFS_VOLUME_DATA: u32 = 0x00090064;

#[repr(C)]
#[allow(non_snake_case)]
struct NtfsVolumeData {
    VolumeSerialNumber: i64,
    NumberSectors: i64,
    TotalClusters: i64,
    FreeClusters: i64,
    TotalReserved: i64,
    BytesPerSector: u32,
    BytesPerCluster: u32,
    BytesPerFileRecordSegment: u32,
    ClustersPerFileRecordSegment: u32,
    MftValidDataLength: i64,
    MftStartLcn: i64,
    Mft2StartLcn: i64,
    MftZoneStart: i64,
    MftZoneEnd: i64,
}

struct MftFileEntry {
    parent_record: u64,
    name: String,
    size: u64,
    is_dir: bool,
}

pub fn scan_mft(
    drive_letter: char,
    on_progress: impl Fn(f64, &str),
) -> Result<DirEntry, Box<dyn std::error::Error + Send + Sync>> {
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Storage::FileSystem::*;
    use windows_sys::Win32::System::IO::*;

    let volume_path = format!("\\\\.\\{}:", drive_letter);
    let wide = to_wide(&volume_path);

    // 1. Open volume (needs admin)
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err("Cannot open volume — administrator privileges required".into());
    }

    // 2. Get NTFS volume data
    let mut vol_data: NtfsVolumeData = unsafe { std::mem::zeroed() };
    let mut bytes_ret: u32 = 0;

    let ok = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_GET_NTFS_VOLUME_DATA,
            std::ptr::null(),
            0,
            &mut vol_data as *mut _ as *mut _,
            std::mem::size_of::<NtfsVolumeData>() as u32,
            &mut bytes_ret,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        unsafe {
            CloseHandle(handle);
        }
        return Err("Failed to read NTFS volume data — not an NTFS volume?".into());
    }

    let record_size = vol_data.BytesPerFileRecordSegment as usize;
    if record_size == 0 || record_size > 65536 {
        unsafe {
            CloseHandle(handle);
        }
        return Err(format!("Invalid MFT record size: {}", record_size).into());
    }

    let mft_offset = vol_data.MftStartLcn * vol_data.BytesPerCluster as i64;
    let total_records = (vol_data.MftValidDataLength as usize) / record_size;

    // 3. Seek to MFT
    unsafe {
        SetFilePointerEx(handle, mft_offset, std::ptr::null_mut(), FILE_BEGIN);
    }

    // 4. Read and parse all MFT records in batches
    on_progress(0.0, "reading_mft");

    let batch_count = 4096;
    let mut buffer = vec![0u8; record_size * batch_count];
    let mut entries: HashMap<u64, MftFileEntry> = HashMap::with_capacity(total_records);
    let mut record_num = 0u64;
    let mut last_pct = 0u64;

    loop {
        if record_num >= total_records as u64 {
            break;
        }

        let to_read = std::cmp::min(batch_count, total_records - record_num as usize);
        let mut bytes_read: u32 = 0;

        let ok = unsafe {
            ReadFile(
                handle,
                buffer.as_mut_ptr() as *mut _,
                (to_read * record_size) as u32,
                &mut bytes_read,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 || bytes_read == 0 {
            break;
        }

        let records_read = bytes_read as usize / record_size;

        for i in 0..records_read {
            let offset = i * record_size;
            let record = &mut buffer[offset..offset + record_size];

            if let Some(entry) = parse_mft_record(record, record_num) {
                entries.insert(record_num, entry);
            }
            record_num += 1;
        }

        // Report progress every ~2%
        let pct = (record_num * 100) / total_records as u64;
        if pct > last_pct + 1 {
            last_pct = pct;
            let phase_pct = (pct as f64) * 0.8; // MFT read = 0-80%
            on_progress(
                phase_pct,
                &format!("reading_mft_progress:{}:{}", pct, record_num),
            );
        }
    }

    unsafe {
        CloseHandle(handle);
    }

    on_progress(80.0, "building_tree");

    // 5. Build tree from parent references
    build_tree_from_entries(entries, drive_letter)
}

fn parse_mft_record(record: &mut [u8], _record_num: u64) -> Option<MftFileEntry> {
    if record.len() < 48 {
        return None;
    }

    // Check "FILE" signature
    if &record[0..4] != b"FILE" {
        return None;
    }

    // Flags at offset 22
    let flags = u16::from_le_bytes([record[22], record[23]]);
    let in_use = flags & 0x01 != 0;
    if !in_use {
        return None;
    }
    let is_directory = flags & 0x02 != 0;

    // Apply Update Sequence Array fixup
    apply_usa_fixup(record);

    // First attribute offset
    let attr_offset = u16::from_le_bytes([record[20], record[21]]) as usize;

    // Walk attributes
    let mut best_name = String::new();
    let mut best_ns: u8 = 255;
    let mut parent_ref: u64 = 0;
    let mut data_size: u64 = 0;
    let mut found_data = false;

    let mut off = attr_offset;
    while off + 8 < record.len() {
        let attr_type = u32::from_le_bytes([
            record[off],
            record[off + 1],
            record[off + 2],
            record[off + 3],
        ]);
        if attr_type == 0xFFFFFFFF {
            break;
        }

        let attr_len = u32::from_le_bytes([
            record[off + 4],
            record[off + 5],
            record[off + 6],
            record[off + 7],
        ]) as usize;
        if attr_len == 0 || off + attr_len > record.len() {
            break;
        }

        match attr_type {
            0x30 => {
                // $FILE_NAME — resident attribute
                if off + 24 < record.len() {
                    let non_res = record[off + 8];
                    if non_res == 0 {
                        let content_off_val =
                            u16::from_le_bytes([record[off + 20], record[off + 21]]) as usize;
                        let content_start = off + content_off_val;

                        if content_start + 0x42 < record.len() {
                            let fn_data = &record[content_start..];

                            // Parent reference (lower 6 bytes)
                            let pr = u64::from_le_bytes([
                                fn_data[0], fn_data[1], fn_data[2], fn_data[3], fn_data[4],
                                fn_data[5], 0, 0,
                            ]);

                            let name_len = fn_data[0x40] as usize;
                            let namespace = fn_data[0x41];

                            // Prefer Win32 (1) or Win32+DOS (3) names
                            if namespace != 2 && name_len > 0 {
                                let name_end = 0x42 + name_len * 2;
                                if content_start + name_end <= record.len() {
                                    let name_u16: Vec<u16> = fn_data[0x42..name_end]
                                        .chunks(2)
                                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                                        .collect();
                                    let name = String::from_utf16_lossy(&name_u16);

                                    // Pick the best name (Win32 > Win32+DOS > POSIX)
                                    if namespace == 1
                                        || (namespace == 3 && best_ns != 1)
                                        || best_name.is_empty()
                                    {
                                        best_name = name;
                                        best_ns = namespace;
                                        parent_ref = pr;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            0x80 => {
                // $DATA — get authoritative file size
                if off + 8 < record.len() {
                    let non_res = record[off + 8];
                    if non_res != 0 {
                        // Non-resident: real size at attribute offset 48
                        if off + 56 <= record.len() {
                            data_size = u64::from_le_bytes([
                                record[off + 48],
                                record[off + 49],
                                record[off + 50],
                                record[off + 51],
                                record[off + 52],
                                record[off + 53],
                                record[off + 54],
                                record[off + 55],
                            ]);
                            found_data = true;
                        }
                    } else {
                        // Resident: content length at attribute offset 16
                        if off + 20 <= record.len() {
                            data_size = u32::from_le_bytes([
                                record[off + 16],
                                record[off + 17],
                                record[off + 18],
                                record[off + 19],
                            ]) as u64;
                            found_data = true;
                        }
                    }
                }
            }
            _ => {}
        }

        off += attr_len;
    }

    if best_name.is_empty() {
        return None;
    }

    // Skip NTFS metafiles ($MFT, $LogFile, etc.)
    if best_name.starts_with('$') {
        return None;
    }

    let size = if is_directory {
        0
    } else if found_data {
        data_size
    } else {
        0
    };

    Some(MftFileEntry {
        parent_record: parent_ref,
        name: best_name,
        size,
        is_dir: is_directory,
    })
}

fn apply_usa_fixup(record: &mut [u8]) {
    if record.len() < 8 {
        return;
    }

    let usa_offset = u16::from_le_bytes([record[4], record[5]]) as usize;
    let usa_count = u16::from_le_bytes([record[6], record[7]]) as usize;

    if usa_count < 2 || usa_offset + usa_count * 2 > record.len() {
        return;
    }

    for i in 1..usa_count {
        let sector_end = i * 512 - 2;
        if sector_end + 1 >= record.len() {
            break;
        }
        let saved_off = usa_offset + i * 2;
        if saved_off + 1 >= record.len() {
            break;
        }
        record[sector_end] = record[saved_off];
        record[sector_end + 1] = record[saved_off + 1];
    }
}

fn build_tree_from_entries(
    entries: HashMap<u64, MftFileEntry>,
    drive_letter: char,
) -> Result<DirEntry, Box<dyn std::error::Error + Send + Sync>> {
    // Build children map
    let mut children_map: HashMap<u64, Vec<u64>> = HashMap::new();
    for (&record_num, entry) in &entries {
        children_map
            .entry(entry.parent_record)
            .or_default()
            .push(record_num);
    }

    // Build tree from root (NTFS root directory = record 5)
    let root = build_mft_node(
        5,
        &entries,
        &children_map,
        &format!("{}:\\", drive_letter),
        4,
    );

    Ok(DirEntry {
        name: format!("{}:\\", drive_letter),
        path: format!("{}:\\", drive_letter),
        ..root
    })
}

fn build_mft_node(
    record: u64,
    entries: &HashMap<u64, MftFileEntry>,
    children_map: &HashMap<u64, Vec<u64>>,
    parent_path: &str,
    max_child_depth: u32,
) -> DirEntry {
    let entry = entries.get(&record);
    let name = entry.map(|e| e.name.clone()).unwrap_or_default();
    let is_dir = entry.map(|e| e.is_dir).unwrap_or(true);
    let own_size = entry.map(|e| e.size).unwrap_or(0);
    let current_path = if parent_path.ends_with('\\') {
        format!("{}{}", parent_path, name)
    } else {
        format!("{}\\{}", parent_path, name)
    };

    if !is_dir {
        return DirEntry {
            name,
            path: current_path,
            size: own_size,
            is_dir: false,
            children: Vec::new(),
            file_count: 1,
            dir_count: 0,
        };
    }

    let mut children = Vec::new();
    let mut total_size = 0u64;
    let mut total_files = 0u64;
    let mut total_dirs = 0u64;

    if let Some(child_ids) = children_map.get(&record) {
        for &child_id in child_ids {
            if child_id == record {
                continue; // skip self-ref
            }
            if let Some(child_entry) = entries.get(&child_id) {
                if child_entry.is_dir {
                    let child_node = if max_child_depth > 0 {
                        build_mft_node(
                            child_id,
                            entries,
                            children_map,
                            &current_path,
                            max_child_depth - 1,
                        )
                    } else {
                        let (sz, fc, dc) = aggregate_mft_size(child_id, entries, children_map);
                        DirEntry {
                            name: child_entry.name.clone(),
                            path: format!("{}\\{}", current_path, child_entry.name),
                            size: sz,
                            is_dir: true,
                            children: Vec::new(),
                            file_count: fc,
                            dir_count: dc,
                        }
                    };
                    total_size += child_node.size;
                    total_files += child_node.file_count;
                    total_dirs += child_node.dir_count + 1;
                    children.push(child_node);
                } else {
                    // Add individual file entries
                    let file_path = format!("{}\\{}", current_path, child_entry.name);
                    total_size += child_entry.size;
                    total_files += 1;
                    children.push(DirEntry {
                        name: child_entry.name.clone(),
                        path: file_path,
                        size: child_entry.size,
                        is_dir: false,
                        children: Vec::new(),
                        file_count: 1,
                        dir_count: 0,
                    });
                }
            }
        }
    }

    children.sort_by(|a, b| b.size.cmp(&a.size));

    DirEntry {
        name,
        path: current_path,
        size: total_size,
        is_dir: true,
        children,
        file_count: total_files,
        dir_count: total_dirs,
    }
}

fn aggregate_mft_size(
    record: u64,
    entries: &HashMap<u64, MftFileEntry>,
    children_map: &HashMap<u64, Vec<u64>>,
) -> (u64, u64, u64) {
    let mut size = 0u64;
    let mut files = 0u64;
    let mut dirs = 0u64;

    if let Some(child_ids) = children_map.get(&record) {
        for &child_id in child_ids {
            if child_id == record {
                continue;
            }
            if let Some(entry) = entries.get(&child_id) {
                if entry.is_dir {
                    let (s, f, d) = aggregate_mft_size(child_id, entries, children_map);
                    size += s;
                    files += f;
                    dirs += d + 1;
                } else {
                    size += entry.size;
                    files += 1;
                }
            }
        }
    }

    (size, files, dirs)
}
