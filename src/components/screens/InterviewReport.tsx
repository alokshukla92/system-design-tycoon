"use client";

import { useRouter } from "next/navigation";
import { useGame } from "@/state/store";
import { Badge, Button, Modal, cn } from "@/components/ui";

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

export function InterviewReportModal() {
  const router = useRouter();
  const phase = useGame((s) => s.phase);
  const mode = useGame((s) => s.mode);
  const report = useGame((s) => s.report);
  const interview = useGame((s) => s.interview);
  const exitToMenu = useGame((s) => s.exitToMenu);
  const dismissResult = useGame((s) => s.dismissResult);
  const startInterview = useGame((s) => s.startInterview);

  if (phase !== "debrief" || mode !== "interview" || !report || !interview) return null;

  const hire = report.verdict.startsWith("Strong Hire") || report.verdict.startsWith("Hire");

  return (
    <Modal open wide>
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={hire ? "ok" : "warn"}>Interview feedback</Badge>
        <Badge tone="accent">{report.overall}/100</Badge>
      </div>
      <h2 className="text-xl font-bold text-ink-100">{interview.title}</h2>
      <p className={cn("mt-1 text-sm font-semibold", hire ? "text-ok" : "text-warn")}>{report.verdict}</p>

      <div className="mt-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          Stress test results
        </div>
        <div className="overflow-hidden rounded-md border border-ink-700">
          <table className="w-full text-xs">
            <thead className="bg-ink-900 text-left text-[10px] uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-2 py-1.5">Tier</th>
                <th className="px-2 py-1.5">p95</th>
                <th className="px-2 py-1.5">Errors</th>
                <th className="px-2 py-1.5">Cost/mo</th>
                <th className="px-2 py-1.5">Steady</th>
                <th className="px-2 py-1.5">Viral spike</th>
              </tr>
            </thead>
            <tbody>
              {report.tierResults.map((t) => (
                <tr key={t.label} className="border-t border-ink-700 text-ink-200">
                  <td className="px-2 py-1.5">{t.label}</td>
                  <td className="px-2 py-1.5 font-mono">{t.p95Ms}ms</td>
                  <td className="px-2 py-1.5 font-mono">{(t.errorRate * 100).toFixed(1)}%</td>
                  <td className="px-2 py-1.5 font-mono">${fmt(t.costPerMonth)}</td>
                  <td className="px-2 py-1.5">{t.passed ? "✅" : "❌"}</td>
                  <td className="px-2 py-1.5">
                    {t.underStress.passed ? "✅" : `❌ ${(t.underStress.errorRate * 100).toFixed(0)}% err`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-ok/30 bg-ok/5 p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ok">Strengths</div>
          <ul className="space-y-1.5 text-xs leading-snug text-ink-300">
            {report.strengths.length ? report.strengths.map((s, i) => <li key={i}>+ {s}</li>) : <li>—</li>}
          </ul>
        </div>
        <div className="rounded-md border border-crit/30 bg-crit/5 p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-crit">Gaps the interviewer noticed</div>
          <ul className="space-y-1.5 text-xs leading-snug text-ink-300">
            {report.gaps.length ? report.gaps.map((g, i) => <li key={i}>− {g}</li>) : <li>—</li>}
          </ul>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => { exitToMenu(); router.push("/"); }}>
          Menu
        </Button>
        <Button variant="secondary" onClick={dismissResult}>
          Revise design
        </Button>
        <Button variant="primary" onClick={() => startInterview(interview.id)}>
          ↺ Fresh attempt
        </Button>
      </div>
    </Modal>
  );
}
