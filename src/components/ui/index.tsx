"use client";

import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, useState } from "react";

// Minimal shadcn-style primitives, hand-rolled for full control.

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-accent/90 hover:bg-accent text-ink-950 font-semibold",
    secondary: "bg-ink-700 hover:bg-ink-600 text-ink-100 border border-ink-600",
    ghost: "bg-transparent hover:bg-ink-700/60 text-ink-300",
    danger: "bg-crit/80 hover:bg-crit text-ink-950 font-semibold",
    success: "bg-ok/80 hover:bg-ok text-ink-950 font-semibold",
  };
  return (
    <button
      className={cn(
        "rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-40 disabled:pointer-events-none",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-ink-700 bg-ink-850/90 backdrop-blur", className)}
      {...props}
    />
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────

export function Badge({
  tone = "default",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "default" | "ok" | "warn" | "crit" | "accent" }) {
  const tones = {
    default: "bg-ink-700 text-ink-200",
    ok: "bg-ok/15 text-ok border border-ok/30",
    warn: "bg-warn/15 text-warn border border-warn/30",
    crit: "bg-crit/15 text-crit border border-crit/30",
    accent: "bg-accent/15 text-accent border border-accent/30",
  };
  return (
    <span
      className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", tones[tone], className)}
      {...props}
    />
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

export function Tabs({
  tabs,
  initial,
  className,
  active: controlled,
  onChange,
}: {
  tabs: { id: string; label: ReactNode; content: ReactNode; badge?: number }[];
  initial?: string;
  className?: string;
  active?: string;
  onChange?: (id: string) => void;
}) {
  const [internal, setInternal] = useState(initial ?? tabs[0]?.id);
  const active = controlled ?? internal;
  const setActive = (id: string) => {
    setInternal(id);
    onChange?.(id);
  };
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex shrink-0 gap-1 border-b border-ink-700 px-2 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "relative rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors",
              active === t.id ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-200"
            )}
          >
            {t.label}
            {t.badge ? (
              <span className="ml-1.5 rounded-full bg-accent/20 px-1.5 text-[10px] text-accent">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tabs.find((t) => t.id === active)?.content}
      </div>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

export function Modal({
  open,
  children,
  wide,
}: {
  open: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur-sm">
      <Card className={cn("max-h-[88vh] w-full overflow-y-auto p-6 shadow-2xl", wide ? "max-w-3xl" : "max-w-xl")}>
        {children}
      </Card>
    </div>
  );
}

// ── Form controls ───────────────────────────────────────────────────────────

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-ink-100 focus:border-accent focus:outline-none",
        className
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  max = 99,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        className="h-6 w-6 rounded bg-ink-700 text-sm text-ink-200 hover:bg-ink-600 disabled:opacity-30"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="w-8 text-center font-mono text-sm text-ink-100">{value}</span>
      <button
        className="h-6 w-6 rounded bg-ink-700 text-sm text-ink-200 hover:bg-ink-600 disabled:opacity-30"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-full transition-colors",
        checked ? "bg-accent" : "bg-ink-600"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

// ── Progress / meter bar ────────────────────────────────────────────────────

export function Meter({
  value,
  tone,
  className,
}: {
  value: number; // 0..1+
  tone?: "auto" | "ok" | "warn" | "crit" | "accent";
  className?: string;
}) {
  const pct = Math.min(1, Math.max(0, value));
  const auto = value > 0.95 ? "bg-crit" : value > 0.75 ? "bg-warn" : "bg-ok";
  const fixed = { ok: "bg-ok", warn: "bg-warn", crit: "bg-crit", accent: "bg-accent", auto } as const;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink-700", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-300", fixed[tone ?? "auto"])}
        style={{ width: `${pct * 100}%` }}
      />
    </div>
  );
}

// ── Sparkline (inline SVG) ──────────────────────────────────────────────────

export function Sparkline({
  data,
  width = 120,
  height = 28,
  stroke = "#60a5fa",
  max,
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  max?: number;
}) {
  if (data.length < 2) return <svg width={width} height={height} />;
  const m = max ?? Math.max(...data, 1);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - Math.min(1, v / m) * (height - 2) - 1}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

// ── Stat ────────────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "ok" | "warn" | "crit";
  sub?: ReactNode;
}) {
  const tones = { default: "text-ink-100", ok: "text-ok", warn: "text-warn", crit: "text-crit" };
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={cn("truncate font-mono text-sm font-semibold", tones[tone])}>{value}</div>
      {sub ? <div className="text-[10px] text-ink-400">{sub}</div> : null}
    </div>
  );
}
