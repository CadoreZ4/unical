"use client";

import { useEffect, useState } from "react";

export type ThemeKey = "sky" | "mint" | "peach";

export const THEMES: { key: ThemeKey; name: string; dot: string; ring: string }[] = [
  { key: "sky", name: "晴空蓝", dot: "linear-gradient(135deg,#5b8bff,#2f58d8)", ring: "#2f58d8" },
  { key: "mint", name: "薄荷绿", dot: "linear-gradient(135deg,#2dd4bf,#0d9488)", ring: "#0d9488" },
  { key: "peach", name: "蜜桃橙", dot: "linear-gradient(135deg,#fb9a7d,#e8573d)", ring: "#e8573d" },
];

const STORAGE_KEY = "unical-theme";

export function applyTheme(theme: ThemeKey) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeKey>("sky");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as ThemeKey) || "sky";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  const choose = (key: ThemeKey) => {
    setTheme(key);
    applyTheme(key);
    localStorage.setItem(STORAGE_KEY, key);
    setOpen(false);
  };

  const current = THEMES.find((t) => t.key === theme)!;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs text-ink-soft shadow-sm transition hover:bg-surface"
        title="切换主题配色"
      >
        <span
          className="h-3.5 w-3.5 rounded-full ring-2 ring-white"
          style={{ background: current.dot }}
        />
        <span className="hidden sm:inline">{current.name}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-40 animate-popIn rounded-2xl border border-line bg-surface p-2 shadow-lift">
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-ink-faint">选择配色（浅色）</p>
          {THEMES.map((t) => (
            <button
              key={t.key}
              onClick={() => choose(t.key)}
              className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-xs transition hover:bg-brand-50 ${
                theme === t.key ? "text-ink" : "text-ink-soft"
              }`}
            >
              <span
                className="h-4 w-4 rounded-full"
                style={{
                  background: t.dot,
                  boxShadow: theme === t.key ? `0 0 0 2px #fff, 0 0 0 4px ${t.ring}` : "none",
                }}
              />
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
