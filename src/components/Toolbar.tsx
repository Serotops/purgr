import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, RefreshCw } from "lucide-react";
import type { FilterStatus } from "@/types";

interface ToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filterStatus: FilterStatus;
  onFilterChange: (status: FilterStatus) => void;
  onRefresh: () => void;
  loading: boolean;
  stats: { total: number; orphans: number; installed: number };
}

export function Toolbar({
  search,
  onSearchChange,
  filterStatus,
  onFilterChange,
  onRefresh,
  loading,
  stats,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* Search + Refresh */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <Input
            placeholder="Search by name or publisher..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-8 text-xs bg-muted/30 border-transparent focus:border-primary/30 focus:bg-muted/50 transition-all duration-200"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-1">
        <FilterButton
          active={filterStatus === "all"}
          onClick={() => onFilterChange("all")}
          count={stats.total}
        >
          All
        </FilterButton>
        <FilterButton
          active={filterStatus === "installed"}
          onClick={() => onFilterChange("installed")}
          count={stats.installed}
        >
          Installed
        </FilterButton>
        <FilterButton
          active={filterStatus === "orphan"}
          onClick={() => onFilterChange("orphan")}
          count={stats.orphans}
          variant={stats.orphans > 0 ? "warning" : "default"}
        >
          Orphans
        </FilterButton>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
  count,
  variant = "default",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count: number;
  variant?: "default" | "warning";
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      }`}
    >
      {children}
      <Badge
        variant={active ? "secondary" : variant === "warning" && count > 0 ? "destructive" : "secondary"}
        className={`text-[10px] px-1.5 py-0 h-4 min-w-[1.25rem] justify-center ${
          active ? "bg-primary-foreground/20 text-primary-foreground" : ""
        }`}
      >
        {count}
      </Badge>
    </button>
  );
}
