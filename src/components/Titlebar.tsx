import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Shield } from "lucide-react";

const appWindow = getCurrentWindow();

export function Titlebar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      setMaximized(await appWindow.isMaximized());
    };
    checkMaximized();

    const unlisten = appWindow.onResized(async () => {
      setMaximized(await appWindow.isMaximized());
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      className="flex-shrink-0 flex items-center h-8 bg-[#1e1e2a] select-none"
      data-tauri-drag-region
    >
      {/* App icon + title */}
      <div className="flex items-center gap-2 px-3 pointer-events-none" data-tauri-drag-region>
        <div className="w-4 h-4 rounded-sm bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
          <Shield className="w-2.5 h-2.5 text-white" />
        </div>
        <span className="text-[11px] font-medium text-white/50">Purgr</span>
      </div>

      {/* Spacer — draggable */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Window controls */}
      <div className="flex items-center h-full">
        <button
          className="h-full w-11 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors duration-150"
          onClick={() => appWindow.minimize()}
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          className="h-full w-11 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors duration-150"
          onClick={() => appWindow.toggleMaximize()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M3 1h6v6h-1M1 3h6v6H1z" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="1" y="1" width="8" height="8" />
            </svg>
          )}
        </button>
        <button
          className="h-full w-11 flex items-center justify-center text-white/40 hover:text-white hover:bg-red-500 transition-colors duration-150"
          onClick={() => appWindow.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
