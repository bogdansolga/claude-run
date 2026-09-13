import { useEffect, useState } from "react";
import { AlertTriangle, DollarSign } from "lucide-react";

interface CostSummary {
  sessionId: string | null;
  sessionCostUsd: number | null;
  todayCostUsd: number | null;
  todayInputTokens: number;
  todayOutputTokens: number;
  todayCacheReadTokens: number;
  todayKnownTurns: number;
  todayUnknownCostTurns: number;
  costTracking: "tracked" | "estimated" | "unknown";
}

function formatCost(value: number | null): string {
  return value === null ? "Unknown" : `$${value.toFixed(4)}`;
}

function formatSessionLabel(sessionId: string | null): string {
  return sessionId ? `${sessionId.slice(0, 8)}…` : "All sessions";
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function CostTracker({ sessionId }: { sessionId: string | null }) {
  const [summary, setSummary] = useState<CostSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      try {
        const response = await fetch(`/api/costs${query}`);
        if (!response.ok) return;
        const data = (await response.json()) as CostSummary;
        if (!cancelled) setSummary(data);
      } catch {
        // Cost display is best effort; the API remains the source of truth.
      }
    };

    void load();
    const interval = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionId]);

  return (
    <div className="border-b border-zinc-800/60 px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            API Cost
          </span>
        </div>
        {summary?.costTracking === "unknown" && (
          <span className="flex items-center gap-1 text-[10px] text-amber-400" title="No usage pricing is available">
            <AlertTriangle className="w-3 h-3" />
            Unknown pricing
          </span>
        )}
        {summary?.costTracking === "estimated" && (
          <span className="flex items-center gap-1 text-[10px] text-amber-400" title="Estimated from Opus API token rates">
            <AlertTriangle className="w-3 h-3" />
            Estimated pricing
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded bg-zinc-900/70 px-2 py-1.5">
          <div className="text-zinc-600">{sessionId ? `Session ${formatSessionLabel(sessionId)}` : "Selected session"}</div>
          <div className="text-zinc-200 font-mono">{formatCost(summary?.sessionCostUsd ?? null)}</div>
        </div>
        <div className="rounded bg-zinc-900/70 px-2 py-1.5">
          <div className="text-zinc-600">Today</div>
          <div className="text-zinc-200 font-mono">{formatCost(summary?.todayCostUsd ?? null)}</div>
        </div>
      </div>
      {summary && (
        <div className="mt-1 text-[10px] text-zinc-600">
          {formatTokens(summary.todayInputTokens + summary.todayOutputTokens)} tokens today
          {summary.todayUnknownCostTurns > 0 && ` · ${summary.todayUnknownCostTurns} unpriced turn${summary.todayUnknownCostTurns === 1 ? "" : "s"}`}
        </div>
      )}
    </div>
  );
}
