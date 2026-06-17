"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/state/store";
import { cn } from "@/components/ui";

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useGame((s) => s.theme);
  const toggleTheme = useGame((s) => s.toggleTheme);
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch: the server can't know the persisted theme.
  useEffect(() => setMounted(true), []);

  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={mounted ? `Switch to ${isLight ? "dark" : "light"} mode` : "Toggle theme"}
      aria-label="Toggle color theme"
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md border border-ink-600 bg-ink-800 text-sm text-ink-200 transition-colors hover:bg-ink-700",
        className
      )}
    >
      {mounted ? (isLight ? "🌙" : "☀️") : "◐"}
    </button>
  );
}
