import { useEffect, useState } from "react";
import { Select, SelectItem } from "@/components/base/select/select";
import { cx } from "@/utils/cx";

export const THEMES = [
  { id: "dark", name: "Graphite", hint: "Dark, the default", swatch: ["#121212", "#262626", "#3b82f6"] },
  { id: "light", name: "Daylight", hint: "Light", swatch: ["#ffffff", "#ebebeb", "#3b82f6"] },
  { id: "midnight", name: "Midnight", hint: "Navy and violet", swatch: ["#0b1124", "#1d2541", "#8b5cf6"] },
  { id: "ember", name: "Ember", hint: "Warm brown and orange", swatch: ["#17110d", "#30251c", "#f97316"] },
  { id: "matrix", name: "Matrix", hint: "High contrast green", swatch: ["#000000", "#07391a", "#00ff41"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
const KEY = "rainmaker:theme";

function stored(): ThemeId {
  try {
    const value = localStorage.getItem(KEY);
    if (THEMES.some((t) => t.id === value)) return value as ThemeId;
  } catch {
    // storage can be blocked; fall back to the default
  }
  return "dark";
}

export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  root.dataset.theme = id;
  root.classList.toggle("dark", id !== "light");
  root.style.colorScheme = id === "light" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // the choice just won't survive a reload
  }
  window.dispatchEvent(new CustomEvent("rainmaker:theme", { detail: id }));
}

export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>(stored);
  useEffect(() => {
    const onChange = (e: Event) => setTheme((e as CustomEvent<ThemeId>).detail);
    window.addEventListener("rainmaker:theme", onChange);
    return () => window.removeEventListener("rainmaker:theme", onChange);
  }, []);
  return [theme, applyTheme];
}

function Swatch({ colors, className }: { colors: readonly string[]; className?: string }) {
  return (
    <span className={cx("flex size-5 shrink-0 overflow-hidden rounded-full border border-border-button-default", className)} aria-hidden>
      {colors.map((c) => (
        <span key={c} className="h-full flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

export function ThemePicker({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <Select
      aria-label="Theme"
      className={cx("w-full", className)}
      triggerClassName="w-full"
      selectedKey={theme}
      onSelectionChange={(key) => setTheme(String(key) as ThemeId)}
    >
      {THEMES.map((t) => (
        <SelectItem key={t.id} id={t.id} textValue={t.name}>
          <span className="flex items-center gap-2">
            <Swatch colors={t.swatch} />
            <span className="flex flex-col">
              <span>{t.name}</span>
            </span>
          </span>
        </SelectItem>
      ))}
    </Select>
  );
}

/** Big preview tiles for the Settings page. */
export function ThemeGallery() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {THEMES.map((t) => {
        const [ground, surface, accent] = t.swatch;
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            aria-pressed={active}
            className={cx(
              "flex cursor-pointer flex-col gap-2 rounded-2xl border p-2 text-start transition-colors outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
              active ? "border-accent-500 bg-background-secondary-hover" : "border-border-button-default hover:bg-background-secondary-hover",
            )}
          >
            <span className="flex h-20 w-full flex-col gap-1.5 rounded-xl p-2" style={{ background: ground }}>
              <span className="h-2 w-2/3 rounded-full" style={{ background: accent }} />
              <span className="h-full w-full rounded-lg" style={{ background: surface }} />
            </span>
            <span className="px-1 text-body-medium text-text-primary">{t.name}</span>
            <span className="-mt-2 px-1 pb-1 text-body-2-medium text-text-tertiary">{t.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
