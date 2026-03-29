import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { InstalledApp } from "@/types";
import type { AppAction } from "@/hooks/useApps";
import { useAppIcon } from "@/hooks/useAppIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Trash2,
  FolderX,
  FolderOpen,
  Package,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
  X,
  RefreshCw,
} from "lucide-react";

function formatSize(kb: number): string {
  if (kb === 0) return "—";
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

// Highlight matching text in search results
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-primary/20 text-primary rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

interface AppRowProps {
  app: InstalledApp;
  action: AppAction | undefined;
  onUninstall: (app: InstalledApp) => void;
  onRemoveEntry: (app: InstalledApp) => void;
  onDismiss: (registryKey: string) => void;
  onRecheck?: (app: InstalledApp) => void;
  selected?: boolean;
  searchQuery?: string;
  maxSize?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function AppRow({ app, action, onUninstall, onRemoveEntry, onDismiss, onRecheck, selected, searchQuery = "", maxSize = 0, expanded: expandedProp, onToggleExpand }: AppRowProps) {
  const appIcon = useAppIcon(app.icon_path);

  // Support both controlled (from parent) and uncontrolled (internal) expand state
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = expandedProp ?? internalExpanded;
  const toggleExpand = onToggleExpand ?? (() => setInternalExpanded((v) => !v));
  const [confirmDialog, setConfirmDialog] = useState<"uninstall" | "remove" | null>(null);

  const isBusy = action?.status === "uninstalling" || action?.status === "verifying";

  const handleConfirm = () => {
    if (confirmDialog === "uninstall") {
      onUninstall(app);
    } else {
      onRemoveEntry(app);
    }
    setConfirmDialog(null);
  };

  return (
    <>
      <div
        className={`group rounded-lg transition-all duration-200 relative overflow-hidden ${
          isBusy
            ? "bg-yellow-500/5 ring-1 ring-yellow-500/20"
            : action?.status === "done"
            ? "bg-green-500/5 ring-1 ring-green-500/20"
            : action?.status === "error"
            ? "bg-destructive/5 ring-1 ring-destructive/30"
            : action?.status === "pending"
            ? "bg-yellow-500/5 ring-1 ring-yellow-500/20"
            : app.is_orphan
            ? "bg-destructive/5 ring-1 ring-destructive/20"
            : selected
            ? "bg-primary/10 ring-1 ring-primary/30"
            : "hover:bg-muted/40"
        }`}
        onContextMenu={(e) => {
          e.preventDefault();
          if (app.uninstall_string && !app.is_orphan) {
            setConfirmDialog("uninstall");
          } else if (app.is_orphan) {
            setConfirmDialog("remove");
          }
        }}
      >
        {/* Size bar background */}
        {!action && maxSize > 0 && app.estimated_size_kb > 0 && (
          <div
            className="absolute inset-y-0 left-0 bg-primary/[0.04] pointer-events-none"
            style={{ width: `${Math.min((app.estimated_size_kb / maxSize) * 100, 100)}%` }}
          />
        )}
        {/* Main row */}
        <div
          className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none"
          onClick={() => !isBusy && toggleExpand()}
        >
          {/* Icon / Status indicator */}
          <div className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors duration-200 overflow-hidden ${
            isBusy
              ? "bg-yellow-500/10 text-yellow-500"
              : action?.status === "done"
              ? "bg-green-500/10 text-green-500"
              : action?.status === "error"
              ? "bg-destructive/10 text-destructive"
              : action?.status === "pending"
              ? "bg-yellow-500/10 text-yellow-500"
              : app.is_orphan
              ? "bg-destructive/10 text-destructive/70"
              : appIcon
              ? "bg-transparent"
              : "bg-muted/60 text-muted-foreground/60"
          }`}>
            {isBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : action?.status === "done" ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : action?.status === "error" ? (
              <XCircle className="w-4 h-4" />
            ) : action?.status === "pending" ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : app.is_orphan ? (
              <FolderX className="w-4 h-4" />
            ) : appIcon ? (
              <img src={`data:image/png;base64,${appIcon}`} className="w-6 h-6" alt="" />
            ) : (
              <Package className="w-4 h-4" />
            )}
          </div>

          {/* Name + publisher / action status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">
                <HighlightText text={app.name} query={searchQuery} />
              </span>
              {app.is_orphan && !action && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                  Orphan
                </Badge>
              )}
              {isBusy && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-yellow-500/50 text-yellow-600">
                  {action?.status === "verifying" ? "Verifying" : "Uninstalling"}
                </Badge>
              )}
              {action?.status === "done" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-green-500/50 text-green-600">
                  Removed
                </Badge>
              )}
              {action?.status === "error" && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                  Failed
                </Badge>
              )}
              {action?.status === "pending" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-yellow-500/50 text-yellow-500">
                  Pending
                </Badge>
              )}
            </div>
            {action ? (
              <p className={`text-xs truncate ${
                action.status === "error" ? "text-destructive" : "text-muted-foreground"
              }`}>
                {action.message}
              </p>
            ) : app.publisher ? (
              <p className="text-xs text-muted-foreground truncate">
                <HighlightText text={app.publisher} query={searchQuery} />
              </p>
            ) : null}
          </div>

          {/* Version */}
          {!action && (
            <div className="hidden sm:block w-24 text-xs text-muted-foreground text-right truncate">
              {app.version || "—"}
            </div>
          )}

          {/* Size */}
          {!action && (
            <div className="hidden md:block w-20 text-xs text-muted-foreground text-right">
              {formatSize(app.estimated_size_kb)}
            </div>
          )}

          {/* Error action: offer registry cleanup */}
          {action?.status === "error" && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDialog("remove");
                }}
              >
                <FolderX className="w-3 h-3 mr-1.5" />
                Remove Entry
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(app.registry_key);
                }}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          )}

          {/* Pending action: recheck or remove */}
          {action?.status === "pending" && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onRecheck?.(app);
                }}
              >
                <RefreshCw className="w-3 h-3 mr-1.5" />
                Recheck
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDialog("remove");
                }}
              >
                <FolderX className="w-3 h-3 mr-1.5" />
                Remove Entry
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(app.registry_key);
                }}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </>
          )}

          {/* Actions */}
          {!isBusy && !action && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {app.is_orphan ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDialog("remove");
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove registry entry</TooltipContent>
                </Tooltip>
              ) : app.uninstall_string ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDialog("uninstall");
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Uninstall</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          )}

          {/* Expand chevron */}
          {!action && (
            <div className="text-muted-foreground/40 transition-transform duration-200" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
              <ChevronDown className="w-3.5 h-3.5" />
            </div>
          )}
        </div>

        {/* Progress bar for busy state */}
        {isBusy && (
          <div className="px-4 pb-2">
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-yellow-500 rounded-full animate-pulse w-full" />
            </div>
          </div>
        )}

        {/* Expanded details */}
        {expanded && !action && (
          <div className="px-3 pb-3 pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-2 text-xs">
              <Detail label="Version" value={app.version} />
              <Detail label="Publisher" value={app.publisher} />
              <Detail label="Install Location" value={app.install_location} />
              <Detail label="Install Date" value={formatDate(app.install_date)} />
              <Detail label="Size" value={formatSize(app.estimated_size_kb)} />
              <Detail label="Registry Key" value={app.registry_key} mono />
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              {app.install_location && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => revealItemInDir(app.install_location)}
                >
                  <FolderOpen className="w-3 h-3 mr-1.5" />
                  Open Location
                </Button>
              )}
              {app.uninstall_string && !app.is_orphan && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setConfirmDialog("uninstall")}
                >
                  <Trash2 className="w-3 h-3 mr-1.5" />
                  Uninstall
                </Button>
              )}
              {app.is_orphan && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setConfirmDialog("remove")}
                >
                  <FolderX className="w-3 h-3 mr-1.5" />
                  Remove Registry Entry
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmDialog !== null} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog === "uninstall" ? "Uninstall" : "Remove Registry Entry"}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog === "uninstall"
                ? `Are you sure you want to uninstall "${app.name}"? This will run the application's uninstaller and may take a moment.`
                : `Are you sure you want to remove the registry entry for "${app.name}"? This only removes the entry from Windows — it does not delete any files.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              {confirmDialog === "uninstall" ? "Uninstall" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground whitespace-nowrap">{label}:</span>
      <span className={`truncate ${mono ? "font-mono text-[11px]" : ""}`} title={value}>
        {value}
      </span>
    </div>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length !== 8) return dateStr || "—";
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  return `${year}-${month}-${day}`;
}
