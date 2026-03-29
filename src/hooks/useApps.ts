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
    try {
      // Phase 1: Running the uninstaller
      setAction(key, { registryKey: key, status: "uninstalling", message: "Uninstaller is running..." });

      const uninstallCmd = app.quiet_uninstall_string || app.uninstall_string;
      await invoke<string>("uninstall_app", { uninstallString: uninstallCmd });

      // Phase 2: Poll registry to verify removal (uninstaller may still be finishing)
      setAction(key, { registryKey: key, status: "verifying", message: "Verifying removal..." });

      let removed = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        // Wait a bit before checking — give the uninstaller time to clean up
        await new Promise((r) => setTimeout(r, attempt === 0 ? 1000 : 2000));
        const stillExists = await invoke<boolean>("check_app_installed", { registryKey: key });
        if (!stillExists) {
          removed = true;
          break;
        }
      }

      if (removed) {
        setAction(key, { registryKey: key, status: "done", message: "Successfully uninstalled" });
        setApps((prev) => prev.filter((a) => a.registry_key !== key));
        setTimeout(() => setAction(key, null), 2000);
      } else {
        // App still in registry — rescan to update orphan status
        setAction(key, { registryKey: key, status: "done", message: "Uninstaller finished — app may need manual cleanup" });
        await scan();
        setTimeout(() => setAction(key, null), 3000);
      }
    } catch (e) {
      setAction(key, { registryKey: key, status: "error", message: String(e) });
      setTimeout(() => setAction(key, null), 4000);
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
    activeActions,
    stats,
  };
}
