import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DriveInfo, DirEntry } from "@/types";

export function useDiskScan() {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string | null>(null);
  const [rootEntry, setRootEntry] = useState<DirEntry | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Breadcrumb path for drill-down
  const [breadcrumb, setBreadcrumb] = useState<DirEntry[]>([]);

  const fetchDrives = useCallback(async () => {
    setLoadingDrives(true);
    try {
      const result = await invoke<DriveInfo[]>("list_drives");
      setDrives(result);
      // Don't auto-select — let the user choose
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingDrives(false);
    }
  }, [selectedDrive]);

  const scanDrive = useCallback(async (driveLetter: string) => {
    setScanning(true);
    setError(null);
    setRootEntry(null);
    setBreadcrumb([]);
    setSelectedDrive(driveLetter);
    try {
      const path = driveLetter + "\\";
      // Scan with depth 3 for the initial view
      const result = await invoke<DirEntry>("scan_directory", { path, maxDepth: 3 });
      setRootEntry(result);
      setBreadcrumb([result]);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  const drillDown = useCallback(async (entry: DirEntry) => {
    if (!entry.is_dir) return;

    // If this entry already has children with their own children, just navigate
    const hasDeepChildren = entry.children.some(c => c.is_dir && c.children.length > 0);
    if (hasDeepChildren) {
      setBreadcrumb(prev => [...prev, entry]);
      return;
    }

    // Otherwise scan deeper
    setScanning(true);
    try {
      const result = await invoke<DirEntry>("scan_directory", { path: entry.path, maxDepth: 3 });
      setBreadcrumb(prev => [...prev, result]);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  const navigateTo = useCallback((index: number) => {
    setBreadcrumb(prev => prev.slice(0, index + 1));
  }, []);

  // The current view is the last item in breadcrumb
  const currentEntry = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1] : null;

  return {
    drives,
    selectedDrive,
    rootEntry,
    currentEntry,
    breadcrumb,
    scanning,
    loadingDrives,
    error,
    fetchDrives,
    scanDrive,
    drillDown,
    navigateTo,
  };
}
