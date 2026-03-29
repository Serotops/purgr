import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Sun, Moon, Monitor, ExternalLink, Shield, Globe, Search, ArrowUpDown, ChevronDown } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "@/hooks/useI18n";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
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
  useEffect(() => { applyTheme(theme); }, [theme]);
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

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function SettingsDialog({ open, onOpenChange, theme, onThemeChange }: SettingsDialogProps) {
  const { t, locale, setLocale, availableLocales } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        {/* Header — About */}
        <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-primary/5 to-transparent">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold">Purgr</h2>
              <p className="text-[11px] text-muted-foreground">v0.1.0</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            {t("settings.about")}
          </p>
        </div>

        <div className="px-6 pb-5 space-y-5">
          {/* Appearance */}
          <Section label={t("settings.appearance")}>
            {/* Theme */}
            <label className="text-xs text-muted-foreground mb-1.5 block">{t("settings.theme")}</label>
            <div className="grid grid-cols-3 gap-2">
              <ThemeCard
                active={theme === "light"}
                onClick={() => onThemeChange("light")}
                icon={<Sun className="w-4 h-4" />}
                label={t("settings.light")}
                preview="light"
              />
              <ThemeCard
                active={theme === "dark"}
                onClick={() => onThemeChange("dark")}
                icon={<Moon className="w-4 h-4" />}
                label={t("settings.dark")}
                preview="dark"
              />
              <ThemeCard
                active={theme === "system"}
                onClick={() => onThemeChange("system")}
                icon={<Monitor className="w-4 h-4" />}
                label={t("settings.system")}
                preview="system"
              />
            </div>

            {/* Language */}
            <label className="text-xs text-muted-foreground mb-1.5 mt-3 block">{t("settings.language")}</label>
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
          </Section>

          {/* Keyboard shortcuts */}
          <Section label={t("settings.shortcuts")}>
            <div className="space-y-1.5">
              <ShortcutRow icon={<Search className="w-3 h-3" />} label={t("settings.shortcutSearch")} keys={["Ctrl", "F"]} />
              <ShortcutRow icon={<ArrowUpDown className="w-3 h-3" />} label={t("settings.shortcutNavigate")} keys={["↑", "↓"]} />
              <ShortcutRow icon={<ChevronDown className="w-3 h-3" />} label={t("settings.shortcutExpand")} keys={["Click"]} />
            </div>
          </Section>

          {/* Links */}
          <Section label="Links">
            <div className="flex flex-col gap-0.5">
              <LinkButton
                icon={<GithubIcon className="w-3.5 h-3.5" />}
                label={t("settings.sourceCode")}
                href="https://github.com/Serotops/purgr"
              />
              <LinkButton
                icon={<GithubIcon className="w-3.5 h-3.5" />}
                label={t("settings.reportIssue")}
                href="https://github.com/Serotops/purgr/issues"
              />
            </div>
          </Section>

          {/* Footer */}
          <div className="pt-2 border-t flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground/40">
              {t("settings.madeBy")}{" "}
              <button
                onClick={() => openUrl("https://github.com/Serotops")}
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                Serotops
              </button>
            </p>
            <p className="text-[10px] text-muted-foreground/30">
              {t("settings.builtWith")}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">{label}</h3>
      {children}
    </div>
  );
}

function ThemeCard({
  active, onClick, icon, label, preview,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
  preview: "light" | "dark" | "system";
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-all duration-200 ${
        active
          ? "border-primary bg-primary/10 shadow-sm"
          : "border-border hover:border-muted-foreground/20 hover:bg-muted/30"
      }`}
    >
      {/* Mini preview */}
      <div className={`w-full h-10 rounded-md overflow-hidden border ${
        active ? "border-primary/30" : "border-border/50"
      }`}>
        <div className={`h-2.5 ${preview === "light" ? "bg-gray-100" : preview === "dark" ? "bg-zinc-800" : "bg-gradient-to-r from-gray-100 to-zinc-800"}`} />
        <div className={`flex gap-0.5 p-1 ${preview === "light" ? "bg-gray-50" : preview === "dark" ? "bg-zinc-900" : "bg-gradient-to-r from-gray-50 to-zinc-900"}`}>
          <div className={`h-1.5 flex-1 rounded-sm ${preview === "light" ? "bg-gray-200" : preview === "dark" ? "bg-zinc-700" : "bg-zinc-500"}`} />
          <div className={`h-1.5 w-3 rounded-sm ${preview === "light" ? "bg-gray-200" : preview === "dark" ? "bg-zinc-700" : "bg-zinc-500"}`} />
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        {icon}
        {label}
      </div>
    </button>
  );
}

function ShortcutRow({ icon, label, keys }: { icon: React.ReactNode; label: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="flex gap-1">
        {keys.map((key, i) => (
          <span key={i}>
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground border border-border/50 shadow-sm">
              {key}
            </kbd>
            {i < keys.length - 1 && <span className="text-muted-foreground/30 mx-0.5 text-[10px]">+</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function LinkButton({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  return (
    <button
      onClick={() => openUrl(href)}
      className="flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <ExternalLink className="w-3 h-3 opacity-40" />
    </button>
  );
}
