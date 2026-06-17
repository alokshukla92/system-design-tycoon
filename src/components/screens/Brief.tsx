"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGame } from "@/state/store";
import { Badge, Button, Modal } from "@/components/ui";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1000) return `${n / 1000}k`;
  return `${n}`;
}

/** Renders **bold** markdown-lite in brief text */
function rich(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") ? (
      <strong key={i} className="text-ink-100">
        {p.slice(2, -2)}
      </strong>
    ) : (
      p
    )
  );
}

export function Brief() {
  const level = useGame((s) => s.level);
  const incident = useGame((s) => s.incident);
  const interview = useGame((s) => s.interview);
  const tick = useGame((s) => s.tick);
  const phase = useGame((s) => s.phase);
  const exitToMenu = useGame((s) => s.exitToMenu);
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);

  // Closing the brief (✕ / Esc / backdrop) means "back out" → return to the
  // menu. Entering the level is the explicit "Take the helm →" action.
  const backToMenu = () => {
    exitToMenu();
    router.push("/");
  };

  const open = !dismissed && tick === 0 && phase === "design";
  if (!open) return null;

  if (level) {
    return (
      <Modal open wide onClose={backToMenu}>
        <div className="mb-1 flex items-center gap-2">
          <Badge tone="accent">Level {level.number}</Badge>
          <Badge>{fmt(level.users)} → {fmt(level.usersEnd)} users</Badge>
        </div>
        <h2 className="text-xl font-bold text-ink-100">{level.title}</h2>
        <p className="mb-3 text-sm text-accent">{level.project}</p>
        <div className="space-y-2 text-sm leading-relaxed text-ink-300">
          {level.brief.map((p, i) => (
            <p key={i}>{rich(p)}</p>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-md border border-ink-700 bg-ink-900 p-3 text-xs sm:grid-cols-4">
          <SloItem label="p95 latency" value={`≤ ${level.slo.maxP95Ms}ms`} />
          <SloItem label="Availability" value={`≥ ${level.slo.minAvailabilityPct}%`} />
          <SloItem label="Error rate" value={`≤ ${(level.slo.maxErrorRate * 100).toFixed(1)}%`} />
          <SloItem label="Budget" value={`$${level.slo.maxMonthlyBudget.toLocaleString()}/mo`} />
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => setDismissed(true)}>
            Take the helm →
          </Button>
        </div>
      </Modal>
    );
  }

  if (incident) {
    return (
      <Modal open wide onClose={backToMenu}>
        <div className="mb-1 flex items-center gap-2">
          <Badge tone="crit">⚠ ACTIVE INCIDENT</Badge>
          <Badge>{fmt(incident.users)} users</Badge>
          <Badge tone="warn">-${incident.revenuePerTick.toLocaleString()}/min while down</Badge>
        </div>
        <h2 className="text-xl font-bold text-ink-100">{incident.title}</h2>
        <p className="mb-3 text-sm text-accent">{incident.company}</p>
        <div className="space-y-2 text-sm leading-relaxed text-ink-300">
          {incident.brief.map((p, i) => (
            <p key={i}>{rich(p)}</p>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="danger" onClick={() => setDismissed(true)}>
            Join the war room →
          </Button>
        </div>
      </Modal>
    );
  }

  if (interview) {
    return (
      <Modal open wide onClose={backToMenu}>
        <div className="mb-1 flex items-center gap-2">
          <Badge tone="accent">Architecture Interview</Badge>
        </div>
        <h2 className="mb-3 text-xl font-bold text-ink-100">{interview.title}</h2>
        <div className="space-y-2 text-sm leading-relaxed text-ink-300">
          {interview.prompt.map((p, i) => (
            <p key={i}>{rich(p)}</p>
          ))}
        </div>
        <div className="mt-4 rounded-md border border-ink-700 bg-ink-900 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Requirements</div>
          <ul className="space-y-1 text-sm text-ink-300">
            {interview.requirements.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-xs text-ink-400">
          Design on the canvas, then submit. Your design will be stress-tested at{" "}
          {interview.tiers.map((t) => t.label.split(": ")[1]).join(", ")} — including viral hot-key events.
        </p>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={() => setDismissed(true)}>
            Start designing →
          </Button>
        </div>
      </Modal>
    );
  }

  return null;
}

function SloItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="font-mono font-semibold text-ink-100">{value}</div>
    </div>
  );
}
