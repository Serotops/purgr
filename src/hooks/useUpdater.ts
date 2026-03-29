import { useState, useEffect, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { showToast } from "@/components/Toast";

interface UpdateState {
  available: boolean;
  version: string;
  downloading: boolean;
  progress: number;
}

export function useUpdater() {
  const [update, setUpdate] = useState<UpdateState>({
    available: false,
    version: "",
    downloading: false,
    progress: 0,
  });
  const [updateObj, setUpdateObj] = useState<Awaited<ReturnType<typeof check>> | null>(null);

  // Check for updates on startup (after a short delay)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const result = await check();
        if (result?.available) {
          setUpdate((prev) => ({
            ...prev,
            available: true,
            version: result.version,
          }));
          setUpdateObj(result);
        }
      } catch {
        // Silently fail — don't bother the user if update check fails
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  const installUpdate = useCallback(async () => {
    if (!updateObj) return;

    setUpdate((prev) => ({ ...prev, downloading: true, progress: 0 }));

    try {
      let downloaded = 0;
      let contentLength = 0;

      await updateObj.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength || 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setUpdate((prev) => ({
                ...prev,
                progress: Math.round((downloaded / contentLength) * 100),
              }));
            }
            break;
          case "Finished":
            setUpdate((prev) => ({ ...prev, progress: 100 }));
            break;
        }
      });

      showToast("Update installed — restarting...", "success");
      await relaunch();
    } catch (e) {
      showToast(`Update failed: ${e}`, "error");
      setUpdate((prev) => ({ ...prev, downloading: false }));
    }
  }, [updateObj]);

  const dismissUpdate = useCallback(() => {
    setUpdate((prev) => ({ ...prev, available: false }));
  }, []);

  return { update, installUpdate, dismissUpdate };
}
