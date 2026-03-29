import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { DirEntry, DriveInfo } from "@/types";
import { useDiskScan } from "@/hooks/useDiskScan";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Treemap } from "@/components/Treemap";
import {
  Loader2,
  HardDrive,
  FolderOpen,
  File,
  ChevronRight,
  Trash2,
} from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function pct(a: number, b: number): string {
  if (b === 0) return "0";
  return ((a / b) * 100).toFixed(1);
}

// ── Context Menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  entry: DirEntry;
}

function ContextMenu({
  state,
  onDelete,
  onClose,
}: {
  state: ContextMenuState;
  onDelete: (entry: DirEntry) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  // Don't allow deleting synthetic entries or root paths
  const canDelete = state.entry.path && !state.entry.name.startsWith("<files>") && state.entry.path.length > 4;

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[180px]"
      style={{ left: state.x, top: state.y }}
    >
      {state.entry.path && (
        <button
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-muted transition-colors"
          onClick={() => {
            revealItemInDir(state.entry.path);
            onClose();
          }}
        >
          <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Open in Explorer</span>
        </button>
      )}
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
        onClick={() => {
          onDelete(state.entry);
          onClose();
        }}
        disabled={!canDelete}
      >
        <Trash2 className="w-3.5 h-3.5 text-destructive" />
        <span>Delete {state.entry.is_dir ? "folder" : "file"}</span>
        <span className="ml-auto text-muted-foreground">{formatBytes(state.entry.size)}</span>
      </button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function DiskAnalysis() {
  const {
    drives,
    selectedDrive,
    currentEntry,
    breadcrumb,
    scanning,
    scanPhase,
    loadingDrives,
    error,
    fetchDrives,
    scanDrive,
    drillDown,
    navigateTo,
    progress,
    progressMsg,
    removeEntry,
    rescanCurrent,
  } = useDiskScan();

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DirEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetchDrives();
  }, [fetchDrives]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleTreemapContextMenu = useCallback((entry: DirEntry, x: number, y: number) => {
    setContextMenu({ x, y, entry });
  }, []);

  const handleDeleteRequest = useCallback((entry: DirEntry) => {
    setConfirmDelete(entry);
    setDeleteError(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await invoke<string>("delete_path", { path: confirmDelete.path });
      removeEntry(confirmDelete.path, confirmDelete.size);
      setConfirmDelete(null);
      // Rescan to get accurate disk state after deletion
      rescanCurrent();
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }, [confirmDelete, removeEntry, rescanCurrent]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Drive selector bar */}
      <div className="flex-shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          {loadingDrives ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Detecting drives...
            </div>
          ) : (
            drives.map((drive) => (
              <DriveButton
                key={drive.letter}
                drive={drive}
                selected={selectedDrive === drive.letter}
                scanning={scanning && selectedDrive === drive.letter}
                onClick={() => scanDrive(drive.letter)}
              />
            ))
          )}
        </div>
      </div>

      {/* Breadcrumb */}
      {breadcrumb.length > 1 && (
        <div className="flex-shrink-0 border-b px-4 py-2 flex items-center gap-1 overflow-x-auto text-xs">
          {breadcrumb.map((entry, i) => (
            <div key={entry.path} className="flex items-center gap-1 flex-shrink-0">
              {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
              <button
                onClick={() => navigateTo(i)}
                className={`px-1.5 py-0.5 rounded transition-colors truncate max-w-[160px] ${
                  i === breadcrumb.length - 1
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {entry.name}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main content area */}
      {!currentEntry && !scanning ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <HardDrive className="w-12 h-12 mb-4 opacity-30" />
          <h3 className="text-base font-medium text-foreground mb-1">Disk Analysis</h3>
          <p className="text-sm text-center max-w-md">
            Select a drive above to scan and visualize disk usage.
          </p>
        </div>
      ) : scanPhase !== "idle" ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground px-12">
          <Loader2 className="w-8 h-8 animate-spin mb-4" />
          <p className="text-sm mb-3">Scanning {selectedDrive}\...</p>
          <div className="w-full max-w-sm">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${Math.max(progress, scanPhase === "shallow" ? 2 : 0)}%` }}
              />
            </div>
            <p className="text-xs mt-2 text-center truncate">
              {progressMsg || (scanPhase === "shallow" ? "Reading folder structure..." : "Starting scan...")}
            </p>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-destructive text-sm mb-3">{error}</div>
          <Button variant="outline" size="sm" onClick={() => selectedDrive && scanDrive(selectedDrive)}>
            Retry
          </Button>
        </div>
      ) : currentEntry ? (
        <div className="flex-1 min-h-0 overflow-y-auto relative">
          {/* Loading overlay for drill-down scans */}
          {scanning && scanPhase === "idle" && (
            <div className="absolute inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center">
              <div className="flex items-center gap-2.5 bg-card border rounded-lg px-4 py-3 shadow-lg">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm">Scanning folder...</span>
              </div>
            </div>
          )}

          {/* Treemap */}
          <div className="p-4">
            <Treemap
              entry={currentEntry}
              onDrillDown={drillDown}
              onContextMenu={handleTreemapContextMenu}
              height={350}
            />
          </div>

          {/* Folder list */}
          <div className="border-t">
            <div className="divide-y">
              {currentEntry.children
                .filter((c) => c.size > 0)
                .map((child) => (
                  <FolderRow
                    key={child.path + child.name}
                    entry={child}
                    parentSize={currentEntry.size}
                    onDrillDown={drillDown}
                    onContextMenu={handleContextMenu}
                    onDelete={handleDeleteRequest}
                  />
                ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onDelete={handleDeleteRequest}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && !deleting && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.is_dir ? "Folder" : "File"}</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete{" "}
              <span className="font-medium text-foreground">"{confirmDelete?.name}"</span>?
              <br />
              This will free up <span className="font-medium text-foreground">{confirmDelete ? formatBytes(confirmDelete.size) : ""}</span>.
              <br /><br />
              <span className="font-mono text-[11px] break-all">{confirmDelete?.path}</span>
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="text-sm px-3 py-2 rounded-md bg-destructive/10 text-destructive">
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function DriveButton({
  drive,
  selected,
  scanning,
  onClick,
}: {
  drive: DriveInfo;
  selected: boolean;
  scanning: boolean;
  onClick: () => void;
}) {
  const usedPct = drive.total_bytes > 0 ? (drive.used_bytes / drive.total_bytes) * 100 : 0;

  return (
    <button
      onClick={onClick}
      disabled={scanning}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors min-w-[180px] ${
        selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
      }`}
    >
      <HardDrive className={`w-5 h-5 flex-shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
      <div className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{drive.letter}</span>
          {drive.label && (
            <span className="text-xs text-muted-foreground truncate">{drive.label}</span>
          )}
        </div>
        <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              usedPct > 90 ? "bg-destructive" : usedPct > 70 ? "bg-yellow-500" : "bg-primary"
            }`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>{formatBytes(drive.free_bytes)} free</span>
          <span>{formatBytes(drive.total_bytes)}</span>
        </div>
      </div>
    </button>
  );
}

function FolderRow({
  entry,
  parentSize,
  onDrillDown,
  onContextMenu,
  onDelete,
}: {
  entry: DirEntry;
  parentSize: number;
  onDrillDown: (entry: DirEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void;
  onDelete: (entry: DirEntry) => void;
}) {
  const percentage = parentSize > 0 ? (entry.size / parentSize) * 100 : 0;
  const canDelete = entry.path && !entry.name.startsWith("<files>") && entry.path.length > 4;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 transition-colors text-left group cursor-pointer"
      onClick={() => entry.is_dir && onDrillDown(entry)}
      onContextMenu={(e) => canDelete ? onContextMenu(e, entry) : undefined}
    >
      {/* Icon */}
      <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${
        entry.is_dir ? "bg-muted" : "bg-muted/50"
      }`}>
        {entry.is_dir ? (
          <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <File className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{entry.name}</p>
        {entry.is_dir && (
          <p className="text-[10px] text-muted-foreground">
            {entry.file_count} files, {entry.dir_count} folders
          </p>
        )}
      </div>

      {/* Size bar */}
      <div className="w-28 flex-shrink-0">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary/60 rounded-full"
            style={{ width: `${Math.max(percentage, 0.5)}%` }}
          />
        </div>
      </div>

      {/* Size + percentage */}
      <div className="w-24 text-right flex-shrink-0">
        <p className="text-xs">{formatBytes(entry.size)}</p>
        <p className="text-[10px] text-muted-foreground">{pct(entry.size, parentSize)}%</p>
      </div>

      {/* Actions */}
      <div className="w-14 flex-shrink-0 flex items-center justify-end gap-1">
        {canDelete && (
          <button
            className="w-7 h-7 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(entry);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        {entry.is_dir && (
          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </div>
  );
}
