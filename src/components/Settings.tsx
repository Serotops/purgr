import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sun, Moon, Monitor, ExternalLink, Shield, Globe } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "@/hooks/useI18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Theme = "light" | "dark" | "system";

function getStoredTheme(): Theme {
  return (localStorage.getItem("purgr-theme") as Theme) || "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
  localStorage.setItem("purgr-theme", theme);
}

applyTheme(getStoredTheme());

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, setTheme: setThemeState };
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function SettingsDialog({ open, onOpenChange, theme, onThemeChange }: SettingsDialogProps) {
  const { t, locale, setLocale, availableLocales } = useI18n();

  const themes: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: t("settings.light"), icon: <Sun className="w-4 h-4" /> },
    { value: "dark", label: t("settings.dark"), icon: <Moon className="w-4 h-4" /> },
    { value: "system", label: t("settings.system"), icon: <Monitor className="w-4 h-4" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Theme */}
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">{t("settings.theme")}</label>
            <div className="flex gap-1.5">
              {themes.map((th) => (
                <button
                  key={th.value}
                  onClick={() => onThemeChange(th.value)}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    theme === th.value
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {th.icon}
                  {th.label}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">{t("settings.language")}</label>
            <Select value={locale} onValueChange={setLocale}>
              <SelectTrigger className="h-9 text-xs">
                <Globe className="w-3.5 h-3.5 text-muted-foreground mr-1.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableLocales.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code} className="text-xs">
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* About */}
          <div className="border-t pt-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm shadow-violet-500/20">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold">Purgr</p>
                <p className="text-[11px] text-muted-foreground">v0.1.0</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {t("settings.about")}
            </p>
            <div className="flex flex-col gap-1.5">
              <LinkButton label={t("settings.sourceCode")} href="https://github.com/Serotops/purgr" />
              <LinkButton label={t("settings.reportIssue")} href="https://github.com/Serotops/purgr/issues" />
            </div>
            <p className="text-[10px] text-muted-foreground/40 mt-3">
              {t("settings.madeBy")}{" "}
              <button
                onClick={() => openUrl("https://github.com/Serotops")}
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                Serotops
              </button>
              {" "}&middot; {t("settings.builtWith")}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinkButton({ label, href }: { label: string; href: string }) {
  return (
    <button
      onClick={() => openUrl(href)}
      className="flex items-center justify-between px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150"
    >
      {label}
      <ExternalLink className="w-3 h-3" />
    </button>
  );
}
