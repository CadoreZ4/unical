import type { Config } from "tailwindcss";

// 颜色统一走 CSS 变量（RGB 通道），由 <html data-theme> 切换三套浅色主题。
const rgbVar = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: rgbVar("--c-brand-50"),
          100: rgbVar("--c-brand-100"),
          200: rgbVar("--c-brand-200"),
          300: rgbVar("--c-brand-300"),
          500: rgbVar("--c-brand-500"),
          600: rgbVar("--c-brand-600"),
          700: rgbVar("--c-brand-700"),
        },
        surface: rgbVar("--c-surface"),
        panel: rgbVar("--c-panel"),
        appbg: rgbVar("--c-bg"),
        ink: {
          DEFAULT: rgbVar("--c-ink"),
          soft: rgbVar("--c-ink-soft"),
          faint: rgbVar("--c-ink-faint"),
        },
        line: rgbVar("--c-line"),
      },
      boxShadow: {
        soft: "0 2px 12px -2px rgb(var(--c-shadow) / 0.10), 0 1px 3px -1px rgb(var(--c-shadow) / 0.08)",
        lift: "0 12px 40px -12px rgb(var(--c-shadow) / 0.22)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      keyframes: {
        blink: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0" } },
        riseIn: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        popIn: {
          from: { opacity: "0", transform: "scale(.96) translateY(10px)" },
          to: { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        bounceDot: {
          "0%,80%,100%": { transform: "translateY(0)", opacity: ".4" },
          "40%": { transform: "translateY(-3px)", opacity: "1" },
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        riseIn: "riseIn .28s ease-out both",
        popIn: "popIn .24s cubic-bezier(.21,1.02,.55,1) both",
        bounceDot: "bounceDot 1.2s infinite ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
