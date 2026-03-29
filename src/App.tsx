import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toolbar } from "@/components/Toolbar";
import { SortHeader } from "@/components/SortHeader";
import { AppRow } from "@/components/AppRow";
import { DiskAnalysis } from "@/components/DiskAnalysis";
import { useApps } from "@/hooks/useApps";
import { Loader2, PackageX, Zap, Package, HardDrive } from "lucide-react";
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
    <TooltipProvider delayDuration={300}>
      <div className="h-screen flex flex-col bg-background">
        {/* Header */}
        <header className="flex-shrink-0 border-b bg-card">
          <div className="px-6 pt-4 pb-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <h1 className="text-lg font-semibold tracking-tight">Purgr</h1>
                <p className="text-xs text-muted-foreground">
                  Clean up your Windows apps
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-3">
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
            <ScrollArea className="flex-1">
              <div className="px-4 py-2 space-y-1.5">
                {loading && apps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin mb-3" />
                    <p className="text-sm">Scanning Windows registry...</p>
                  </div>
                ) : error ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <div className="text-destructive text-sm mb-3">{error}</div>
                    <Button variant="outline" size="sm" onClick={scan}>
                      Retry
                    </Button>
                  </div>
                ) : apps.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <PackageX className="w-10 h-10 mb-3 opacity-40" />
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
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </>
        ) : (
          <DiskAnalysis />
        )}

        {/* Footer */}
        <footer className="flex-shrink-0 border-t px-6 py-2 text-[11px] text-muted-foreground flex items-center justify-between">
          <span>
            {stats.total > 0
              ? `${stats.total} apps found — ${stats.orphans} orphan${stats.orphans !== 1 ? "s" : ""} detected`
              : "Ready"}
          </span>
          <span>Purgr v0.1.0</span>
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
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export default App;
