import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InstalledApp, FilterStatus, SortField, SortDirection } from "@/types";

export type AppAction = {
  registryKey: string;
  status: "uninstalling" | "verifying" | "done" | "error";
  message: string;
};

export function useApps() {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [activeActions, setActiveActions] = useState<Map<string, AppAction>>(new Map());

  const setAction = useCallback((registryKey: string, action: AppAction | null) => {
    setActiveActions((prev) => {
      const next = new Map(prev);
      if (action === null) {
        next.delete(registryKey);
      } else {
        next.set(registryKey, action);
      }
      return next;
    });
  }, []);

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<InstalledApp[]>("get_installed_apps");
      setApps(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const uninstallApp = useCallback(async (app: InstalledApp) => {
    const key = app.registry_key;
    const isProtocol = app.uninstall_string.includes("://");
    try {
      // Phase 1: Running the uninstaller
      setAction(key, {
        registryKey: key,
        status: "uninstalling",
        message: isProtocol
          ? "Waiting for external uninstaller..."
          : "Uninstaller is running...",
      });

      const uninstallCmd = app.uninstall_string || app.quiet_uninstall_string;
      await invoke<string>("uninstall_app", { uninstallString: uninstallCmd });

      // Phase 2: Poll registry to verify removal
      // Protocol-based uninstallers (Steam, Epic, etc.) are async — poll longer
      setAction(key, { registryKey: key, status: "verifying", message: "Waiting for uninstall to complete..." });

      const maxAttempts = isProtocol ? 30 : 8;
      const interval = isProtocol ? 3000 : 2000;

      let removed = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : interval));
        const stillExists = await invoke<boolean>("check_app_installed", { registryKey: key });
        if (!stillExists) {
          removed = true;
          break;
        }
        if (isProtocol) {
          setAction(key, {
            registryKey: key,
            status: "verifying",
            message: `Waiting for external uninstaller... (${attempt + 1}/${maxAttempts})`,
          });
        }
      }

      if (removed) {
        setAction(key, { registryKey: key, status: "done", message: "Successfully uninstalled" });
        setApps((prev) => prev.filter((a) => a.registry_key !== key));
        setTimeout(() => setAction(key, null), 2000);
      } else {
        // Rescan — the app might now be orphaned even if not fully removed
        setAction(key, { registryKey: key, status: "done", message: "Uninstaller finished — refreshing list..." });
        await scan();
        setTimeout(() => setAction(key, null), 3000);
      }
    } catch (e) {
      const errMsg = String(e);
      const isBrokenPath = errMsg.includes("not found") ||
        errMsg.includes("not recognized") ||
        errMsg.includes("cannot find") ||
        errMsg.includes("The system cannot find");

      if (isBrokenPath) {
        setAction(key, {
          registryKey: key,
          status: "error",
          message: "Uninstaller not found — use 'Remove Registry Entry' to clean up this entry",
        });
      } else {
        setAction(key, { registryKey: key, status: "error", message: errMsg });
      }
      // Don't auto-clear errors — let the user see them
    }
  }, [scan, setAction]);

  const removeRegistryEntry = useCallback(async (app: InstalledApp) => {
    const key = app.registry_key;
    try {
      setAction(key, { registryKey: key, status: "uninstalling", message: "Removing registry entry..." });
      await invoke<string>("remove_registry_entry", { registryKey: key });
      setAction(key, { registryKey: key, status: "done", message: "Registry entry removed" });
      setApps((prev) => prev.filter((a) => a.registry_key !== key));
      setTimeout(() => setAction(key, null), 2000);
    } catch (e) {
      setAction(key, { registryKey: key, status: "error", message: String(e) });
      setTimeout(() => setAction(key, null), 4000);
    }
  }, [setAction]);

  const dismissAction = useCallback((registryKey: string) => {
    setAction(registryKey, null);
  }, [setAction]);

  const bulkRemoveOrphans = useCallback(async () => {
    const orphans = apps.filter((a) => a.is_orphan);
    if (orphans.length === 0) return;

    const keys = orphans.map((a) => a.registry_key);

    // Show loading state on all orphans
    for (const key of keys) {
      setAction(key, { registryKey: key, status: "uninstalling", message: "Removing registry entries..." });
    }

    try {
      // Single bulk call — one UAC prompt for all HKLM keys
      const results = await invoke<(string | { Err: string })[]>("bulk_remove_registry_entries", { registryKeys: keys });

      const removed: string[] = [];
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const result = results[i];
        if (typeof result === "string" || (result && "Ok" in (result as Record<string, unknown>))) {
          setAction(key, { registryKey: key, status: "done", message: "Registry entry removed" });
          removed.push(key);
          setTimeout(() => setAction(key, null), 2000);
        } else {
          const errMsg = typeof result === "object" && result && "Err" in (result as Record<string, unknown>)
            ? String((result as Record<string, string>).Err)
            : "Unknown error";
          setAction(key, { registryKey: key, status: "error", message: errMsg });
        }
      }
      setApps((prev) => prev.filter((a) => !removed.includes(a.registry_key)));
    } catch (e) {
      // If the whole call fails, mark all as error
      for (const key of keys) {
        setAction(key, { registryKey: key, status: "error", message: String(e) });
      }
    }
  }, [apps, setAction]);

  const filteredApps = useMemo(() => {
    let result = apps;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(q) ||
          app.publisher.toLowerCase().includes(q)
      );
    }

    if (filterStatus === "orphan") {
      result = result.filter((app) => app.is_orphan);
    } else if (filterStatus === "installed") {
      result = result.filter((app) => !app.is_orphan);
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "publisher":
          cmp = a.publisher.localeCompare(b.publisher);
          break;
        case "size":
          cmp = a.estimated_size_kb - b.estimated_size_kb;
          break;
        case "status":
          cmp = Number(a.is_orphan) - Number(b.is_orphan);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return result;
  }, [apps, search, filterStatus, sortField, sortDirection]);

  const stats = useMemo(() => {
    const total = apps.length;
    const orphans = apps.filter((a) => a.is_orphan).length;
    const installed = total - orphans;
    return { total, orphans, installed };
  }, [apps]);

  return {
    apps: filteredApps,
    allApps: apps,
    loading,
    error,
    search,
    setSearch,
    filterStatus,
    setFilterStatus,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    scan,
    uninstallApp,
    removeRegistryEntry,
    dismissAction,
    bulkRemoveOrphans,
    activeActions,
    stats,
  };
}
