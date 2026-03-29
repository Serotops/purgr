import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// Import all locale files
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

// ── Registry of available languages ──────────────────────────────────────────
// To add a new language:
//   1. Copy src/locales/en.json to src/locales/xx.json
//   2. Translate all values (keep the keys in English)
//   3. Import it above: import xx from "@/locales/xx.json"
//   4. Add it to this object: "xx": { name: "Language Name", data: xx }

const LANGUAGES: Record<string, { name: string; data: Record<string, unknown> }> = {
  en: { name: "English", data: en },
  fr: { name: "Français", data: fr },
};

// ── Types ────────────────────────────────────────────────────────────────────

type TranslationFn = (key: string, vars?: Record<string, string | number>) => string;

interface I18nContext {
  t: TranslationFn;
  locale: string;
  setLocale: (locale: string) => void;
  availableLocales: { code: string; name: string }[];
}

const I18nCtx = createContext<I18nContext | null>(null);

// ── Helper: resolve a dotted key like "tabs.installedApps" ───────────────────

function resolve(obj: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

// ── Detect system language ───────────────────────────────────────────────────

function detectSystemLocale(): string {
  const nav = navigator.language || "en";
  const short = nav.split("-")[0].toLowerCase();
  if (LANGUAGES[short]) return short;
  return "en";
}

function getStoredLocale(): string {
  return localStorage.getItem("purgr-locale") || detectSystemLocale();
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(getStoredLocale);

  const setLocale = useCallback((code: string) => {
    setLocaleState(code);
    localStorage.setItem("purgr-locale", code);
  }, []);

  const t: TranslationFn = useCallback(
    (key, vars) => {
      // Try current locale first, fall back to English
      let value = resolve(LANGUAGES[locale]?.data ?? {}, key);
      if (value === undefined) {
        value = resolve(LANGUAGES.en.data, key);
      }
      if (value === undefined) {
        return key; // Last resort: return the key itself
      }

      // Replace {variables}
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }

      return value;
    },
    [locale]
  );

  const availableLocales = Object.entries(LANGUAGES).map(([code, { name }]) => ({
    code,
    name,
  }));

  return (
    <I18nCtx.Provider value={{ t, locale, setLocale, availableLocales }}>
      {children}
    </I18nCtx.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
