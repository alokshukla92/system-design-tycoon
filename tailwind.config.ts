import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dark ops-dashboard palette
        ink: {
          950: "#07090f",
          900: "#0b0e17",
          850: "#101524",
          800: "#151b2e",
          700: "#1e2742",
          600: "#2a3558",
          500: "#3d4a75",
          400: "#5b6b9e",
          300: "#8b98c2",
          200: "#b9c2dd",
          100: "#e2e6f2",
        },
        ok: "#34d399",
        warn: "#fbbf24",
        crit: "#f87171",
        accent: "#60a5fa",
        violet: "#a78bfa",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      animation: {
        "pulse-fast": "pulse 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
