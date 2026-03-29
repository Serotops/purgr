import { useRef, useEffect } from "react";
import type { DirEntry } from "@/types";

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

// ---- Squarified treemap layout (pixel-based) ----

interface PxRect { x: number; y: number; w: number; h: number }

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
  const s2 = sum * sum;
  return Math.max(
    (shortSide * shortSide * Math.max(...areas)) / s2,
    s2 / (shortSide * shortSide * Math.min(...areas))
  );
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

    for (let i = start; i < areas.length; i++) {
      const testRow = [...row, areas[i]];
      if (row.length === 0 || worstRatio(testRow, shortSide) <= worstRatio(row, shortSide)) {
        row.push(areas[i]);
        rowSum += areas[i];
      } else {
        break;
      }
    }

    const rowLen = shortSide > 0 ? rowSum / shortSide : 0;
    let offset = 0;
    for (let i = 0; i < row.length; i++) {
      const itemLen = rowSum > 0 ? row[i] / rowLen : 0;
      const idx = start + i;
      if (cw <= ch) {
        rects[idx] = { x: cx + offset, y: cy, w: itemLen, h: rowLen };
      } else {
        rects[idx] = { x: cx, y: cy + offset, w: rowLen, h: itemLen };
      }
      offset += itemLen;
    }

    if (cw <= ch) { cy += rowLen; ch -= rowLen; }
    else { cx += rowLen; cw -= rowLen; }
    start += row.length;
  }
  return rects;
}

function buildFlatNodes(
  entries: DirEntry[], rect: PxRect, totalContainerArea: number,
  depth: number, maxDepth: number, parentName: string,
): FlatNode[] {
  const totalSize = entries.reduce((s, e) => s + e.size, 0);
  if (totalSize === 0 || rect.w < 2 || rect.h < 2) return [];

  const containerArea = rect.w * rect.h;
  const minArea = 16;

  let visible = entries
    .filter(e => e.size > 0)
    .map((entry, i) => ({
      entry, area: (entry.size / totalSize) * containerArea,
      color: getColor(entry.name, i + depth * 7),
    }))
    .filter(e => e.area >= minArea);

  const tinyEntries = entries.filter(e => e.size > 0 && (e.size / totalSize) * containerArea < minArea);
  if (tinyEntries.length > 0) {
    const otherSize = tinyEntries.reduce((s, e) => s + e.size, 0);
    const otherArea = (otherSize / totalSize) * containerArea;
    if (otherArea >= minArea) {
      visible.push({
        entry: {
          name: `${tinyEntries.length} small items`, path: "", size: otherSize, is_dir: false,
          children: [], file_count: tinyEntries.reduce((s, e) => s + e.file_count, 0), dir_count: 0,
        },
        area: otherArea, color: "#2a2a35",
      });
    }
  }

  if (visible.length === 0) return [];
  visible.sort((a, b) => b.area - a.area);

  const rects = squarifyLayout(visible, rect);
  const nodes: FlatNode[] = [];

  for (let i = 0; i < visible.length; i++) {
    const r = rects[i];
    if (!r || r.w < 1 || r.h < 1) continue;
    nodes.push({ entry: visible[i].entry, color: visible[i].color, rect: r, depth, parentName });

    if (visible[i].entry.is_dir && depth < maxDepth && visible[i].entry.children.length > 0 && r.w > 30 && r.h > 25) {
      const headerH = 16, pad = 2;
      const innerRect: PxRect = { x: r.x + pad, y: r.y + headerH, w: r.w - pad * 2, h: r.h - headerH - pad };
      if (innerRect.w > 10 && innerRect.h > 10) {
        nodes.push(...buildFlatNodes(visible[i].entry.children, innerRect, totalContainerArea, depth + 1, maxDepth, visible[i].entry.name));
      }
    }
  }
  return nodes;
}

// ---- Component ----

interface TreemapProps {
  entry: DirEntry;
  onDrillDown: (entry: DirEntry) => void;
  onContextMenu?: (entry: DirEntry, x: number, y: number) => void;
  height?: number;
}

export function Treemap({ entry, onDrillDown, onContextMenu, height = 400 }: TreemapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Store everything in refs so callbacks are never stale
  const stateRef = useRef({
    entry,
    onDrillDown,
    onContextMenu,
    nodes: [] as FlatNode[],
    hoveredIdx: null as number | null,
    size: { w: 800, h: 400 },
  });

  // Keep refs in sync with props on every render
  stateRef.current.entry = entry;
  stateRef.current.onDrillDown = onDrillDown;
  stateRef.current.onContextMenu = onContextMenu;

  // Rebuild DOM nodes from current state
  function rebuild() {
    const container = containerRef.current;
    if (!container) return;
    const { entry: e, size: { w, h } } = stateRef.current;

    const children = e.children.filter(c => c.size > 0);
    const nodes = buildFlatNodes(children, { x: 0, y: 0, w, h }, w * h, 0, 2, e.name);
    stateRef.current.nodes = nodes;
    stateRef.current.hoveredIdx = null;

    container.innerHTML = "";

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const r = node.rect;
      if (r.w < 1 || r.h < 1) continue;

      const isLeaf = node.depth > 0 || !node.entry.is_dir || node.entry.children.length === 0;
      const el = document.createElement("div");
      el.dataset.idx = String(i);
      el.style.cssText = `
        position:absolute;overflow:hidden;pointer-events:none;
        left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;
        background:${isLeaf ? node.color : `color-mix(in srgb, ${node.color} 20%, #24243a)`};
        border:1px solid ${isLeaf ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.08)"};
        border-radius:${node.depth === 0 ? 4 : 2}px;
        z-index:${node.depth * 10 + (isLeaf ? 5 : 0)};
        transition:filter .12s,border-color .12s,box-shadow .12s;
      `;

      if (r.w > 28 && r.h > 14) {
        const label = document.createElement("div");
        label.style.cssText = `
          padding:1px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          user-select:none;font-size:${node.depth === 0 ? 11 : 9}px;
          font-weight:${node.depth === 0 ? 600 : 400};
          color:rgba(255,255,255,0.9);text-shadow:0 1px 3px rgba(0,0,0,0.9);
          line-height:14px;
          ${!isLeaf ? `background:linear-gradient(180deg,${node.color}dd,${node.color}88)` : ""}
        `;
        label.textContent = node.entry.name + (r.w > 60 ? `  ${formatBytes(node.entry.size)}` : "");
        el.appendChild(label);
      }

      container.appendChild(el);
    }

    const tip = tooltipRef.current;
    if (tip) tip.style.display = "none";
  }

  // Rebuild when entry changes
  useEffect(() => {
    rebuild();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  // ResizeObserver — rebuild reads from stateRef so always has latest entry
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => {
      stateRef.current.size = { w: e.contentRect.width, h: e.contentRect.height };
      rebuild();
    });
    obs.observe(el);
    return () => obs.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mouse interaction — all reads go through stateRef, never stale
  useEffect(() => {
    const container = containerRef.current;
    const tip = tooltipRef.current;
    if (!container || !tip) return;

    let prevIdx: number | null = null;
    let prevEl: HTMLElement | null = null;

    function hitTest(clientX: number, clientY: number): number {
      const cr = container!.getBoundingClientRect();
      const mx = clientX - cr.left;
      const my = clientY - cr.top;
      const nodes = stateRef.current.nodes;
      let best = -1, bestDepth = -1;
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].rect;
        if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h && nodes[i].depth > bestDepth) {
          best = i; bestDepth = nodes[i].depth;
        }
      }
      return best;
    }

    function unhover() {
      if (prevEl) {
        prevEl.style.filter = "";
        prevEl.style.borderColor = "";
        prevEl.style.borderWidth = "1px";
        prevEl.style.boxShadow = "";
        prevEl.style.zIndex = "";
        prevEl = null;
      }
      prevIdx = null;
      stateRef.current.hoveredIdx = null;
      tip!.style.display = "none";
      container!.style.cursor = "default";
    }

    function positionTip(cx: number, cy: number) {
      const tw = tip!.offsetWidth || 200;
      const th = tip!.offsetHeight || 80;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const left = cx + 14 + tw > vw ? cx - tw - 10 : cx + 14;
      const top = cy - 10 + th > vh ? cy - th - 10 : cy - 10;

      tip!.style.left = `${Math.max(4, left)}px`;
      tip!.style.top = `${Math.max(4, top)}px`;
    }

    const onMove = (e: MouseEvent) => {
      const best = hitTest(e.clientX, e.clientY);

      if (best === prevIdx) {
        if (best >= 0) {
          positionTip(e.clientX, e.clientY);
        }
        return;
      }

      unhover();
      prevIdx = best;
      stateRef.current.hoveredIdx = best;

      if (best >= 0) {
        const node = stateRef.current.nodes[best];
        const el = container!.querySelector(`[data-idx="${best}"]`) as HTMLElement | null;
        if (el) {
          prevEl = el;
          el.style.filter = "brightness(1.3)";
          el.style.borderColor = "rgba(255,255,255,0.85)";
          el.style.borderWidth = "2px";
          el.style.boxShadow = "0 0 16px rgba(255,255,255,0.2)";
          el.style.zIndex = "100";
        }

        let html = `<p style="font-weight:600;font-size:13px;margin:0 0 2px">${esc(node.entry.name)}</p>`;
        html += `<p style="font-size:12px;color:#a1a1aa;margin:0">${formatBytes(node.entry.size)}</p>`;
        if (node.entry.is_dir) {
          html += `<p style="font-size:11px;color:#a1a1aa;margin:0">${node.entry.file_count.toLocaleString()} files, ${node.entry.dir_count.toLocaleString()} folders</p>`;
        }
        if (node.entry.path) {
          html += `<p style="font-size:10px;color:#71717a;margin:2px 0 0;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px">${esc(node.entry.path)}</p>`;
        }
        if (node.entry.is_dir && node.entry.path) {
          html += `<p style="font-size:10px;color:#71717a;margin:2px 0 0;font-style:italic">Double-click to explore</p>`;
        }
        tip.innerHTML = html;
        tip.style.display = "block";
        positionTip(e.clientX, e.clientY);
        container!.style.cursor = node.entry.is_dir && node.entry.path ? "pointer" : "default";
      }
    };

    const onLeave = () => unhover();

    const onDblClick = (e: MouseEvent) => {
      const best = hitTest(e.clientX, e.clientY);
      if (best < 0) return;
      const node = stateRef.current.nodes[best];
      if (node?.entry.is_dir && node.entry.path) {
        stateRef.current.onDrillDown(node.entry);
      }
    };

    const onRightClick = (e: MouseEvent) => {
      const best = hitTest(e.clientX, e.clientY);
      if (best < 0) return;
      const node = stateRef.current.nodes[best];
      if (!node?.entry.path || node.entry.name.startsWith("<files>") || node.entry.path.length <= 4) return;
      e.preventDefault();
      tip.style.display = "none";
      stateRef.current.onContextMenu?.(node.entry, e.clientX, e.clientY);
    };

    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    container.addEventListener("dblclick", onDblClick);
    container.addEventListener("contextmenu", onRightClick);

    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      container.removeEventListener("dblclick", onDblClick);
      container.removeEventListener("contextmenu", onRightClick);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        className="relative rounded-lg overflow-hidden border border-border"
        style={{ height, background: "#1c1c28" }}
      />
      <div
        ref={tooltipRef}
        style={{
          display: "none", position: "fixed", zIndex: 9999, pointerEvents: "none",
          background: "hsl(250 15% 16%)", border: "1px solid hsl(250 10% 25%)",
          borderRadius: 6, padding: "8px 12px", maxWidth: 320,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}
      />
    </>
  );
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
