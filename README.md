# Purgr

A modern, fast alternative to the Windows "Add or Remove Programs" panel. Built with Tauri, React, and Rust.

## Why Purgr?

The built-in Windows app manager is slow, cluttered with ghost entries from apps you already deleted, and hasn't been redesigned in years. Purgr fixes all of that:

- **Detect orphan entries** — apps deleted but still lingering in the registry
- **Real app icons** — extracted from executables, not generic placeholders
- **WinDirStat-style disk analyzer** — treemap visualization of your entire drive
- **Actually works** — handles Steam games, Adobe apps, MSI packages, and everything in between

## Features

### Installed Apps

- Scans HKLM and HKCU registry (32-bit and 64-bit)
- Detects orphaned entries (install folder no longer exists)
- Uninstall apps directly, with support for:
  - Standard uninstallers
  - MsiExec packages
  - Protocol-based (Steam, Epic, etc.)
  - Automatic UAC elevation when needed
- Search and filter by name, publisher, or status
- Bulk remove all orphan registry entries in one click
- Open install location in Explorer

### Disk Analysis

- WinDirStat-style treemap visualization
- Multiple drive support
- MFT-based scanning for near-instant results on NTFS drives
- Parallel scanning with rayon for non-NTFS drives
- Progressive loading — see results while scan continues
- Delete files and folders directly from the treemap
- Right-click context menu with Open in Explorer

### General

- Custom dark and light themes
- Multi-language support (English, French — easy to contribute more)
- Keyboard shortcuts (Ctrl+F search, arrow key navigation)
- Virtualized app list — smooth with 500+ apps
- Custom titlebar with native window controls
- Admin elevation on release builds for full access

## Screenshots

<!-- TODO: Add screenshots -->

## Installation

### Download

Go to [Releases](https://github.com/Serotops/purgr/releases) and download the latest `.exe` installer.

### Build from source

**Prerequisites:**
- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/)
- Windows 10/11

```bash
# Clone
git clone https://github.com/Serotops/purgr.git
cd purgr

# Install dependencies
pnpm install

# Dev mode
pnpm tauri dev

# Release build
pnpm tauri build
```

The installer will be in `src-tauri/target/release/bundle/nsis/`.

## Contributing

### Adding a new language

1. Copy `src/locales/en.json` to `src/locales/xx.json` (where `xx` is the language code)
2. Translate all values — keep the keys in English
3. Open `src/hooks/useI18n.tsx` and add:
   ```typescript
   import xx from "@/locales/xx.json";
   ```
   Then add to the `LANGUAGES` object:
   ```typescript
   "xx": { name: "Language Name", data: xx },
   ```
4. Submit a pull request

Missing translations automatically fall back to English.

### Development

```bash
pnpm tauri dev    # Start dev server + Tauri window
pnpm build        # Build frontend only
```

The Rust backend is in `src-tauri/src/`. The React frontend is in `src/`.

## Tech Stack

- **Frontend:** React + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Rust via Tauri v2
- **Disk scanning:** FindFirstFileExW + rayon (parallel) + NTFS MFT parsing
- **Bundler:** Vite

## License

<!-- TODO: Add license -->

## Author

Made by [Serotops](https://github.com/Serotops)
