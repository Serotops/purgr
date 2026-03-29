use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::UI::Shell::ExtractIconExW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetIconInfo, HICON, ICONINFO,
};

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

pub fn extract_icon_base64(icon_path: &str) -> Option<String> {
    let trimmed = icon_path.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }

    let (file_path, _index) = if let Some(comma_pos) = trimmed.rfind(',') {
        let path_part = &trimmed[..comma_pos];
        let idx_part = trimmed[comma_pos + 1..].trim();
        let idx = idx_part.parse::<i32>().unwrap_or(0);
        (path_part.to_string(), idx)
    } else {
        (trimmed.to_string(), 0)
    };

    if !Path::new(&file_path).exists() {
        return None;
    }

    let wide_path = to_wide(&file_path);
    let mut large_icon: HICON = std::ptr::null_mut();

    let count = unsafe {
        ExtractIconExW(
            wide_path.as_ptr(),
            0,
            &mut large_icon,
            std::ptr::null_mut(),
            1,
        )
    };

    if count == 0 || large_icon.is_null() {
        return None;
    }

    let result = hicon_to_png_base64(large_icon);
    unsafe { DestroyIcon(large_icon) };
    result
}

fn hicon_to_png_base64(icon: HICON) -> Option<String> {
    unsafe {
        let mut icon_info: ICONINFO = std::mem::zeroed();
        if GetIconInfo(icon, &mut icon_info) == 0 {
            return None;
        }

        let hbm_color = icon_info.hbmColor;
        if hbm_color.is_null() {
            if !icon_info.hbmMask.is_null() { DeleteObject(icon_info.hbmMask as *mut _); }
            return None;
        }

        let mut bm: BITMAP = std::mem::zeroed();
        if GetObjectW(hbm_color as *mut _, std::mem::size_of::<BITMAP>() as i32, &mut bm as *mut _ as *mut _) == 0 {
            DeleteObject(hbm_color as *mut _);
            if !icon_info.hbmMask.is_null() { DeleteObject(icon_info.hbmMask as *mut _); }
            return None;
        }

        let width = bm.bmWidth as u32;
        let height = bm.bmHeight as u32;
        if width == 0 || height == 0 || width > 256 || height > 256 {
            DeleteObject(hbm_color as *mut _);
            if !icon_info.hbmMask.is_null() { DeleteObject(icon_info.hbmMask as *mut _); }
            return None;
        }

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width as i32;
        bmi.bmiHeader.biHeight = -(height as i32); // top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        let pixel_count = (width * height) as usize;
        let mut pixels = vec![0u8; pixel_count * 4]; // BGRA

        let hdc = CreateCompatibleDC(std::ptr::null_mut());
        if hdc.is_null() {
            DeleteObject(hbm_color as *mut _);
            if !icon_info.hbmMask.is_null() { DeleteObject(icon_info.hbmMask as *mut _); }
            return None;
        }

        let lines = GetDIBits(
            hdc, hbm_color, 0, height,
            pixels.as_mut_ptr() as *mut _,
            &mut bmi, DIB_RGB_COLORS,
        );

        DeleteDC(hdc);
        DeleteObject(hbm_color as *mut _);
        if !icon_info.hbmMask.is_null() { DeleteObject(icon_info.hbmMask as *mut _); }

        if lines == 0 {
            return None;
        }

        // Convert BGRA → RGBA
        for i in 0..pixel_count {
            let off = i * 4;
            pixels.swap(off, off + 2); // B ↔ R
        }

        // Check if all alpha values are 0 (icon has no alpha channel)
        let all_alpha_zero = pixels.iter().skip(3).step_by(4).all(|&a| a == 0);
        if all_alpha_zero {
            // Set all alpha to 255 (fully opaque)
            for i in 0..pixel_count {
                pixels[i * 4 + 3] = 255;
            }
        }

        let png = encode_png(&pixels, width, height);
        Some(base64_encode(&png))
    }
}

// ── Minimal PNG encoder ──────────────────────────────────────────────────────

fn encode_png(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut png = Vec::new();

    // PNG signature
    png.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.push(8); // bit depth
    ihdr.push(6); // color type: RGBA
    ihdr.push(0); // compression
    ihdr.push(0); // filter
    ihdr.push(0); // interlace
    write_chunk(&mut png, b"IHDR", &ihdr);

    // IDAT chunk — raw (uncompressed) deflate
    let row_len = (width as usize) * 4;
    // Build the raw image data with filter byte (0 = None) per row
    let mut raw = Vec::with_capacity((row_len + 1) * height as usize);
    for y in 0..height as usize {
        raw.push(0); // filter: None
        raw.extend_from_slice(&rgba[y * row_len..(y + 1) * row_len]);
    }

    // Wrap in zlib: header + uncompressed deflate blocks + adler32
    let deflated = zlib_compress_store(&raw);
    write_chunk(&mut png, b"IDAT", &deflated);

    // IEND chunk
    write_chunk(&mut png, b"IEND", &[]);

    png
}

fn write_chunk(png: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    let len = data.len() as u32;
    png.extend_from_slice(&len.to_be_bytes());
    png.extend_from_slice(chunk_type);
    png.extend_from_slice(data);
    let mut crc_data = Vec::with_capacity(4 + data.len());
    crc_data.extend_from_slice(chunk_type);
    crc_data.extend_from_slice(data);
    let crc = crc32(&crc_data);
    png.extend_from_slice(&crc.to_be_bytes());
}

fn zlib_compress_store(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    // Zlib header: CMF=0x78 (deflate, window 32K), FLG=0x01 (no dict, check bits)
    out.push(0x78);
    out.push(0x01);

    // Deflate: split into blocks of max 65535 bytes
    let max_block = 65535;
    let mut offset = 0;
    while offset < data.len() {
        let remaining = data.len() - offset;
        let block_len = remaining.min(max_block);
        let is_last = offset + block_len >= data.len();

        out.push(if is_last { 0x01 } else { 0x00 }); // BFINAL + BTYPE=00 (stored)
        let len = block_len as u16;
        let nlen = !len;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&nlen.to_le_bytes());
        out.extend_from_slice(&data[offset..offset + block_len]);
        offset += block_len;
    }

    // Adler-32 checksum
    let adler = adler32(data);
    out.extend_from_slice(&adler.to_be_bytes());

    out
}

fn adler32(data: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((n >> 18) & 63) as usize] as char);
        result.push(CHARS[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[((n >> 6) & 63) as usize] as char); }
        else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(n & 63) as usize] as char); }
        else { result.push('='); }
    }
    result
}
