import { useState, useMemo, useRef, useEffect } from "react";
import type { DirEntry } from "@/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

const PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
  "#a0cbe8", "#ffbe7d", "#8cd17d", "#b6992d", "#f1ce63",
  "#499894", "#d37295", "#86bcb6", "#d4a6c8", "#fabfd2",
];

function getColor(name: string, index: number): string {
  if (!name || name.startsWith("<files>")) return "#3a3f4b";
  return PALETTE[index % PALETTE.length];
}

// ---- Squarified treemap algorithm (pixel-based) ----

interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FlatNode {
  entry: DirEntry;
  color: string;
  rect: PxRect;
  depth: number;
  parentName: string;
}

function worstRatio(areas: number[], shortSide: number): number {
  if (areas.length === 0 || shortSide <= 0) return Infinity;
  const sum = areas.reduce((a, b) => a + b, 0);
  const maxArea = Math.max(...areas);
  const minArea = Math.min(...areas);
  const s2 = sum * sum;
  const r1 = (shortSide * shortSide * maxArea) / s2;
  const r2 = s2 / (shortSide * shortSide * minArea);
  return Math.max(r1, r2);
}

function squarifyLayout(
  entries: { entry: DirEntry; area: number; color: string }[],
  rect: PxRect,
): PxRect[] {
  const rects: PxRect[] = new Array(entries.length);
  const areas = entries.map(e => e.area);

  let cx = rect.x, cy = rect.y, cw = rect.w, ch = rect.h;
  let start = 0;

  while (start < areas.length) {
    const shortSide = Math.min(cw, ch);
    const row: number[] = [];
    let rowSum = 0;

    // Build the row
    for (let i = start; i < areas.length; i++) {
      const testRow = [...row, areas[i]];
      if (row.length === 0 || worstRatio(testRow, shortSide) <= worstRatio(row, shortSide)) {
        row.push(areas[i]);
        rowSum += areas[i];
      } else {
        break;
      }
    }

    // Lay out the row
    const rowLen = shortSide > 0 ? rowSum / shortSide : 0;
    let offset = 0;

    for (let i = 0; i < row.length; i++) {
      const itemLen = rowSum > 0 ? row[i] / rowLen : 0;
      const idx = start + i;

      if (cw <= ch) {
        // Horizontal strip at top
        rects[idx] = { x: cx + offset, y: cy, w: itemLen, h: rowLen };
      } else {
        // Vertical strip at left
        rects[idx] = { x: cx, y: cy + offset, w: rowLen, h: itemLen };
      }
      offset += itemLen;
    }

    // Shrink remaining space
    if (cw <= ch) {
      cy += rowLen;
      ch -= rowLen;
    } else {
      cx += rowLen;
      cw -= rowLen;
    }

    start += row.length;
  }

  return rects;
}

function buildFlatNodes(
  entries: DirEntry[],
  rect: PxRect,
  totalContainerArea: number,
  depth: number,
  maxDepth: number,
  parentName: string,
): FlatNode[] {
  const totalSize = entries.reduce((s, e) => s + e.size, 0);
  if (totalSize === 0 || rect.w < 2 || rect.h < 2) return [];

  // Filter out entries that would be too small to see (less than 4px area)
  const minArea = 16;
  const containerArea = rect.w * rect.h;
  let visible = entries
    .filter(e => e.size > 0)
    .map((entry, i) => ({
      entry,
      area: (entry.size / totalSize) * containerArea,
      color: getColor(entry.name, i + depth * 7),
    }))
    .filter(e => e.area >= minArea);

  // Aggregate tiny entries into "Other"
  const tinyEntries = entries.filter(e => e.size > 0).filter(e => {
    const a = (e.size / totalSize) * containerArea;
    return a < minArea && a > 0;
  });

  if (tinyEntries.length > 0) {
    const otherSize = tinyEntries.reduce((s, e) => s + e.size, 0);
    const otherArea = (otherSize / totalSize) * containerArea;
    if (otherArea >= minArea) {
      visible.push({
        entry: {
          name: `${tinyEntries.length} small items`,
          path: "",
          size: otherSize,
          is_dir: false,
          children: [],
          file_count: tinyEntries.reduce((s, e) => s + e.file_count, 0),
          dir_count: 0,
        },
        area: otherArea,
        color: "#2a2a35",
      });
    }
  }

  if (visible.length === 0) return [];

  // Sort by area descending for better layout
  visible.sort((a, b) => b.area - a.area);

  const rects = squarifyLayout(visible, rect);
  const nodes: FlatNode[] = [];

  for (let i = 0; i < visible.length; i++) {
    const r = rects[i];
    if (!r || r.w < 1 || r.h < 1) continue;

    nodes.push({
      entry: visible[i].entry,
      color: visible[i].color,
      rect: r,
      depth,
      parentName,
    });

    // Recurse into directories (with padding for header)
    if (
      visible[i].entry.is_dir &&
      depth < maxDepth &&
      visible[i].entry.children.length > 0 &&
      r.w > 30 &&
      r.h > 25
    ) {
      const headerH = 16;
      const pad = 2;
      const innerRect: PxRect = {
        x: r.x + pad,
        y: r.y + headerH,
        w: r.w - pad * 2,
        h: r.h - headerH - pad,
      };

      if (innerRect.w > 10 && innerRect.h > 10) {
        const childNodes = buildFlatNodes(
          visible[i].entry.children,
          innerRect,
          totalContainerArea,
          depth + 1,
          maxDepth,
          visible[i].entry.name,
        );
        nodes.push(...childNodes);
      }
    }
  }

  return nodes;
}

// ---- Component ----

interface TreemapProps {
  entry: DirEntry;
  onDrillDown: (entry: DirEntry) => void;
  height?: number;
}

export function Treemap({ entry, onDrillDown, height = 400 }: TreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 400 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => {
      setContainerSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const nodes = useMemo(() => {
    const children = entry.children.filter(c => c.size > 0);
    const rect: PxRect = { x: 0, y: 0, w: containerSize.w, h: containerSize.h };
    return buildFlatNodes(children, rect, containerSize.w * containerSize.h, 0, 2, entry.name);
  }, [entry, containerSize]);

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg overflow-hidden border border-border"
      style={{ height, background: "#12121c" }}
    >
      {nodes.map((node, i) => {
        const id = node.entry.path + "|" + node.entry.name + "|" + i;
        const isHovered = hoveredId === id;
        const isLeaf = node.depth > 0 || !node.entry.is_dir || node.entry.children.length === 0;
        const r = node.rect;

        if (r.w < 1 || r.h < 1) return null;

        const canShowName = r.w > 28 && r.h > 14;
        const canShowSize = r.w > 60 && r.h > 14;

        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <div
                className="absolute overflow-hidden"
                style={{
                  left: r.x,
                  top: r.y,
                  width: r.w,
                  height: r.h,
                  backgroundColor: isLeaf
                    ? node.color
                    : `color-mix(in srgb, ${node.color} 20%, #1a1a28)`,
                  border: isHovered
                    ? "2px solid rgba(255,255,255,0.8)"
                    : isLeaf
                    ? "1px solid rgba(0,0,0,0.4)"
                    : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: node.depth === 0 ? 4 : 2,
                  zIndex: isHovered ? 100 : node.depth * 10 + (isLeaf ? 5 : 0),
                  cursor: node.entry.is_dir && node.entry.path ? "pointer" : "default",
                  transition: "border-color 0.1s",
                  boxShadow: isHovered ? "0 0 12px rgba(255,255,255,0.15)" : undefined,
                }}
                onMouseEnter={(e) => {
                  e.stopPropagation();
                  setHoveredId(id);
                }}
                onMouseLeave={(e) => {
                  e.stopPropagation();
                  setHoveredId(null);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (node.entry.is_dir && node.entry.path) onDrillDown(node.entry);
                }}
              >
                {canShowName && (
                  <div
                    className="truncate select-none pointer-events-none px-1.5 py-0.5"
                    style={{
                      fontSize: node.depth === 0 ? 11 : 9,
                      fontWeight: node.depth === 0 ? 600 : 400,
                      color: "rgba(255,255,255,0.9)",
                      textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                      lineHeight: "14px",
                      background: !isLeaf
                        ? `linear-gradient(180deg, ${node.color}dd 0%, ${node.color}88 100%)`
                        : undefined,
                    }}
                  >
                    {node.entry.name}
                    {canShowSize && (
                      <span
                        style={{
                          color: "rgba(255,255,255,0.95)",
                          fontWeight: 700,
                          fontSize: node.depth === 0 ? 11 : 9,
                          marginLeft: 6,
                        }}
                      >
                        {formatBytes(node.entry.size)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs" style={{ zIndex: 200 }}>
              <div className="space-y-0.5">
                <p className="font-medium text-sm">{node.entry.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(node.entry.size)}</p>
                {node.entry.is_dir && (
                  <p className="text-xs text-muted-foreground">
                    {node.entry.file_count.toLocaleString()} files, {node.entry.dir_count.toLocaleString()} folders
                  </p>
                )}
                {node.entry.path && (
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{node.entry.path}</p>
                )}
                {node.entry.is_dir && node.entry.path && (
                  <p className="text-[10px] text-muted-foreground italic">Double-click to explore</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
