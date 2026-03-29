import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toolbar } from "@/components/Toolbar";
import { SortHeader } from "@/components/SortHeader";
import { AppRow } from "@/components/AppRow";
import { DiskAnalysis } from "@/components/DiskAnalysis";
import { useApps } from "@/hooks/useApps";
import { Loader2, PackageX, Package, HardDrive, Trash2 } from "lucide-react";
import { Titlebar } from "@/components/Titlebar";
import { Button } from "@/components/ui/button";
import type { SortField } from "@/types";

type Tab = "apps" | "disk";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("apps");

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
    bulkRemoveOrphans,
    activeActions,
    stats,
  } = useApps();

  useEffect(() => {
    scan();
  }, [scan]);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen flex flex-col bg-background">
        {/* Custom titlebar */}
        <Titlebar />

        {/* Header */}
        <header className="flex-shrink-0 border-b bg-card/80 backdrop-blur-sm">
          <div className="px-5 pt-3 pb-3">
            {/* Tabs */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
                <TabButton
                  active={activeTab === "apps"}
                  onClick={() => setActiveTab("apps")}
                  icon={<Package className="w-3.5 h-3.5" />}
                >
                  Installed Apps
                </TabButton>
                <TabButton
                  active={activeTab === "disk"}
                  onClick={() => setActiveTab("disk")}
                  icon={<HardDrive className="w-3.5 h-3.5" />}
                >
                  Disk Analysis
                </TabButton>
              </div>
            </div>

            {/* Toolbar (only for apps tab) */}
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
              <div className="flex-shrink-0 border-b px-5 py-2 bg-destructive/5">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={bulkRemoveOrphans}
                >
                  <Trash2 className="w-3 h-3 mr-1.5" />
                  Remove All {stats.orphans} Orphan Entries
                </Button>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-3 py-2 space-y-1">
                {loading && apps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="w-7 h-7 animate-spin mb-3 text-primary" />
                    <p className="text-sm">Scanning Windows registry...</p>
                    <p className="text-xs mt-1 text-muted-foreground/60">This may take a few seconds</p>
                  </div>
                ) : error ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="text-destructive text-sm mb-3">{error}</div>
                    <Button variant="outline" size="sm" onClick={scan}>
                      Retry
                    </Button>
                  </div>
                ) : apps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <PackageX className="w-10 h-10 mb-3 opacity-30" />
                    <p className="text-sm">
                      {search || filterStatus !== "all"
                        ? "No apps match your filters"
                        : "No apps found"}
                    </p>
                  </div>
                ) : (
                  apps.map((app) => (
                    <AppRow
                      key={app.registry_key}
                      app={app}
                      action={activeActions.get(app.registry_key)}
                      onUninstall={uninstallApp}
                      onRemoveEntry={removeRegistryEntry}
                      onDismiss={dismissAction}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <DiskAnalysis />
        )}

        {/* Footer */}
        <footer className="flex-shrink-0 border-t bg-card/50 px-5 py-1.5 text-[11px] text-muted-foreground/70 flex items-center justify-between">
          <span>
            {loading
              ? "Scanning..."
              : stats.total > 0
              ? `${stats.total} apps \u00b7 ${stats.orphans} orphan${stats.orphans !== 1 ? "s" : ""}`
              : "Ready"}
          </span>
          <span className="text-muted-foreground/40">v0.1.0</span>
        </footer>
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
