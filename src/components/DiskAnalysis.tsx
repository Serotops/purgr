import { useEffect } from "react";
import type { DirEntry, DriveInfo } from "@/types";
import { useDiskScan } from "@/hooks/useDiskScan";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Treemap } from "@/components/Treemap";
import {
  Loader2,
  HardDrive,
  FolderOpen,
  File,
  ChevronRight,
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

export function DiskAnalysis() {
  const {
    drives,
    selectedDrive,
    currentEntry,
    breadcrumb,
    scanning,
    loadingDrives,
    error,
    fetchDrives,
    scanDrive,
    drillDown,
    navigateTo,
  } = useDiskScan();

  useEffect(() => {
    fetchDrives();
  }, [fetchDrives]);

  return (
    <div className="flex flex-col h-full">
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
      ) : scanning ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">Scanning {selectedDrive}\...</p>
          <p className="text-xs mt-1">This may take a while for large drives</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-destructive text-sm mb-3">{error}</div>
          <Button variant="outline" size="sm" onClick={() => selectedDrive && scanDrive(selectedDrive)}>
            Retry
          </Button>
        </div>
      ) : currentEntry ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Treemap */}
          <div className="flex-shrink-0 p-4">
            <Treemap
              entry={currentEntry}
              onDrillDown={drillDown}
              height={Math.max(280, 350)}
            />
          </div>

          {/* Folder list */}
          <ScrollArea className="flex-1 border-t">
            <div className="divide-y">
              {currentEntry.children
                .filter((c) => c.size > 0)
                .map((child) => (
                  <FolderRow
                    key={child.path + child.name}
                    entry={child}
                    parentSize={currentEntry.size}
                    onDrillDown={drillDown}
                  />
                ))}
            </div>
          </ScrollArea>
        </div>
      ) : null}
    </div>
  );
}

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
        selected
          ? "border-primary bg-primary/10"
          : "border-border hover:bg-muted"
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
        {/* Usage bar */}
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
}: {
  entry: DirEntry;
  parentSize: number;
  onDrillDown: (entry: DirEntry) => void;
}) {
  const percentage = parentSize > 0 ? (entry.size / parentSize) * 100 : 0;

  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/50 transition-colors text-left group"
      onClick={() => entry.is_dir && onDrillDown(entry)}
      disabled={!entry.is_dir}
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

      {/* Drill indicator */}
      {entry.is_dir && (
        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}
