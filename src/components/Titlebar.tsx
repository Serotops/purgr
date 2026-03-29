import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Settings } from "lucide-react";
import logoImg from "@/assets/logo-32.png";

const appWindow = getCurrentWindow();

interface TitlebarProps {
  onSettingsClick?: () => void;
}

export function Titlebar({ onSettingsClick }: TitlebarProps) {
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
      className="flex-shrink-0 flex items-center h-8 bg-[var(--titlebar-bg,#1e1e2a)] select-none"
      data-tauri-drag-region
    >
      {/* App icon + title */}
      <div className="flex items-center gap-2 px-3 pointer-events-none" data-tauri-drag-region>
        <img src={logoImg} alt="" className="w-4 h-4" />
        <span className="text-[11px] font-medium text-[var(--titlebar-fg,rgba(255,255,255,0.5))]">Purgr</span>
      </div>

      {/* Spacer — draggable */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Settings */}
      <button
        className="h-full w-9 flex items-center justify-center text-[var(--titlebar-fg,rgba(255,255,255,0.4))] hover:text-[var(--titlebar-fg-hover,rgba(255,255,255,0.8))] hover:bg-[var(--titlebar-hover,rgba(255,255,255,0.05))] transition-colors duration-150"
        onClick={onSettingsClick}
      >
        <Settings className="w-3.5 h-3.5" />
      </button>

      {/* Window controls */}
      <div className="flex items-center h-full">
        <button
          className="h-full w-11 flex items-center justify-center text-[var(--titlebar-fg,rgba(255,255,255,0.4))] hover:text-[var(--titlebar-fg-hover,rgba(255,255,255,0.8))] hover:bg-[var(--titlebar-hover,rgba(255,255,255,0.05))] transition-colors duration-150"
          onClick={() => appWindow.minimize()}
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          className="h-full w-11 flex items-center justify-center text-[var(--titlebar-fg,rgba(255,255,255,0.4))] hover:text-[var(--titlebar-fg-hover,rgba(255,255,255,0.8))] hover:bg-[var(--titlebar-hover,rgba(255,255,255,0.05))] transition-colors duration-150"
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
          className="h-full w-11 flex items-center justify-center text-[var(--titlebar-fg,rgba(255,255,255,0.4))] hover:text-[var(--titlebar-fg-hover,rgba(255,255,255,0.8))] hover:bg-red-500 hover:!text-white transition-colors duration-150"
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
