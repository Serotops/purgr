import { useEffect, useState, useCallback } from "react";
import { List } from "react-window";
import AutoSizer from "./components/AutoSizer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toolbar } from "@/components/Toolbar";
import { SortHeader } from "@/components/SortHeader";
import { AppRow } from "@/components/AppRow";
import { DiskAnalysis } from "@/components/DiskAnalysis";
import { ToastContainer, showToast } from "@/components/Toast";
import { useApps } from "@/hooks/useApps";
import { Titlebar } from "@/components/Titlebar";
import { SettingsDialog, useTheme } from "@/components/Settings";
import { useI18n } from "@/hooks/useI18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, PackageX, Package, HardDrive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SortField } from "@/types";

type Tab = "apps" | "disk";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function VirtualRow(props: any) {
  const { index, style, apps, activeActions, onUninstall, onRemoveEntry, onDismiss, onRecheck, selectedIdx, searchQuery, maxSize, expandedKeys, toggleExpand } = props;
  const app = apps[index];
  if (!app) return null;
  return (
    <div style={{ ...style, padding: "2px 12px" }}>
      <AppRow
        app={app}
        action={activeActions.get(app.registry_key)}
        onUninstall={onUninstall}
        onRemoveEntry={onRemoveEntry}
        onDismiss={onDismiss}
        onRecheck={onRecheck}
        selected={selectedIdx === index}
        searchQuery={searchQuery}
        maxSize={maxSize}
        expanded={expandedKeys.has(app.registry_key)}
        onToggleExpand={() => toggleExpand(app.registry_key)}
      />
    </div>
  );
}

function formatSizeKb(kb: number): string {
  if (kb === 0) return "0 KB";
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("apps");
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  const {
    apps,
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
    recheckApp,
    bulkRemoveOrphans,
    activeActions,
    stats,
  } = useApps();

  useEffect(() => {
    scan();
  }, [scan]);

  // Reset selection when list changes
  useEffect(() => {
    setSelectedIdx(-1);
  }, [apps.length, search, filterStatus]);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (activeTab !== "apps" || apps.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((prev) => Math.min(prev + 1, apps.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((prev) => Math.max(prev - 1, 0));
      }
    },
    [activeTab, apps.length]
  );

  // Global keyboard shortcut for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
        input?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const ROW_HEIGHT = 52;
  const ACTION_HEIGHT = 68;
  const EXPANDED_HEIGHT = 180;

  const getRowHeight = useCallback(
    (index: number) => {
      const app = apps[index];
      if (!app) return ROW_HEIGHT;
      if (expandedKeys.has(app.registry_key)) return EXPANDED_HEIGHT;
      const action = activeActions.get(app.registry_key);
      if (action) return ACTION_HEIGHT;
      return ROW_HEIGHT;
    },
    [apps, expandedKeys, activeActions]
  );

  const handleBulkRemove = async () => {
    setBulkConfirm(false);
    await bulkRemoveOrphans();
    showToast(t("bulkRemove.success", { count: String(stats.orphans) }), "success");
  };

  const showingFiltered = stats.filteredCount !== stats.total;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen flex flex-col bg-background" onKeyDown={handleKeyDown} tabIndex={-1}>
        <Titlebar onSettingsClick={() => setSettingsOpen(true)} />

        {/* Header */}
        <header className="flex-shrink-0 border-b bg-card/80 backdrop-blur-sm">
          <div className="px-5 pt-3 pb-3">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
                <TabButton
                  active={activeTab === "apps"}
                  onClick={() => setActiveTab("apps")}
                  icon={<Package className="w-3.5 h-3.5" />}
                >
                  {t("tabs.installedApps")}
                </TabButton>
                <TabButton
                  active={activeTab === "disk"}
                  onClick={() => setActiveTab("disk")}
                  icon={<HardDrive className="w-3.5 h-3.5" />}
                >
                  {t("tabs.diskAnalysis")}
                </TabButton>
              </div>

              {/* Total size badge */}
              {activeTab === "apps" && stats.totalSizeKb > 0 && (
                <span className="text-[11px] text-muted-foreground/60 ml-auto">
                  {formatSizeKb(stats.totalSizeKb)} {t("toolbar.total")}
                </span>
              )}
            </div>

            {activeTab === "apps" && (
              <Toolbar
                search={search}
                onSearchChange={setSearch}
                filterStatus={filterStatus}
                onFilterChange={setFilterStatus}
                onRefresh={scan}
                loading={loading}
                stats={stats}
              />
            )}
          </div>
        </header>

        {/* Content */}
        {activeTab === "apps" ? (
          <>
            {apps.length > 0 && (
              <SortHeader
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
            )}
            {stats.orphans > 0 && filterStatus === "orphan" && (
              <div className="flex-shrink-0 border-b px-5 py-2 bg-destructive/5 flex items-center justify-between">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setBulkConfirm(true)}
                >
                  <Trash2 className="w-3 h-3 mr-1.5" />
                  {t("apps.removeAllOrphans", { count: String(stats.orphans) })}
                </Button>
              </div>
            )}

            {/* Showing X of Y indicator */}
            {showingFiltered && apps.length > 0 && (
              <div className="flex-shrink-0 px-5 py-1 text-[11px] text-muted-foreground/50 border-b">
                {t("apps.showingOf", { filtered: String(stats.filteredCount), total: String(stats.total) })}
              </div>
            )}

            {loading && apps.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="w-7 h-7 animate-spin mb-3 text-primary" />
                <p className="text-sm">{t("apps.scanning")}</p>
                <p className="text-xs mt-1 text-muted-foreground/60">{t("apps.scanningHint")}</p>
              </div>
            ) : error ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="text-destructive text-sm mb-3">{error}</div>
                <Button variant="outline" size="sm" onClick={scan}>{t("errors.retry")}</Button>
              </div>
            ) : apps.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <PackageX className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm">
                  {search || filterStatus !== "all"
                    ? t("apps.noMatch")
                    : t("apps.noApps")}
                </p>
              </div>
            ) : (
              <AutoSizer className="flex-1 min-h-0">
                {({ width, height }) => (
                  <List
                    style={{ width, height }}
                    rowCount={apps.length}
                    rowHeight={getRowHeight}
                    overscanCount={5}
                    rowComponent={VirtualRow}
                    rowProps={{
                      apps,
                      activeActions,
                      onUninstall: uninstallApp,
                      onRemoveEntry: removeRegistryEntry,
                      onDismiss: dismissAction,
                      onRecheck: recheckApp,
                      selectedIdx,
                      searchQuery: search,
                      maxSize: stats.totalSizeKb,
                      expandedKeys,
                      toggleExpand,
                    }}
                  />
                )}
              </AutoSizer>
            )}
          </>
        ) : (
          <DiskAnalysis />
        )}

        {/* Footer */}
        <footer className="flex-shrink-0 border-t bg-card/50 px-5 py-1.5 text-[11px] text-muted-foreground/70 flex items-center justify-between">
          <span>
            {loading
              ? t("footer.scanning")
              : stats.total > 0
              ? `${stats.total} ${t("footer.apps")} \u00b7 ${stats.orphans} ${stats.orphans !== 1 ? t("footer.orphans") : t("footer.orphan")}`
              : t("footer.ready")}
          </span>
          <span className="text-muted-foreground/40">v0.1.0</span>
        </footer>

        {/* Bulk removal confirmation */}
        <Dialog open={bulkConfirm} onOpenChange={setBulkConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("bulkRemove.title")}</DialogTitle>
              <DialogDescription>
                {t("bulkRemove.confirm", { count: String(stats.orphans) })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkConfirm(false)}>{t("delete.cancel")}</Button>
              <Button variant="destructive" onClick={handleBulkRemove}>
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                {t("bulkRemove.button", { count: String(stats.orphans) })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          theme={theme}
          onThemeChange={setTheme}
        />
        <ToastContainer />
      </div>
    </TooltipProvider>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export default App;
