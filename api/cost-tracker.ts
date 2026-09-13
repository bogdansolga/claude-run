import { sql } from "drizzle-orm";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import type { Database } from "./db/index.js";
import { listSessionFiles } from "./storage.js";

export type SubscriptionTier = "pro" | "max-5x" | "max-20x";

export interface CostSummary {
  sessionId: string | null;
  sessionCostUsd: number | null;
  todayCostUsd: number | null;
  todayInputTokens: number;
  todayOutputTokens: number;
  todayCacheReadTokens: number;
  todayKnownTurns: number;
  todayUnknownCostTurns: number;
  costTracking: "tracked" | "estimated" | "unknown";
  subscriptionTier: SubscriptionTier | null;
  contextUsedPercent: number | null;
  contextWindowTokens: number | null;
}

// Subscription plans do not publish a token-to-dollar conversion. Keep this
// null until the user supplies a documented quota/plan accounting rule.
export function estimateSubscriptionCost(
  _apiCostUsd: number,
  _tier: SubscriptionTier | null,
): number | null {
  return null;
}

interface CostRow {
  session_id: string | null;
  session_cost_usd: string | null;
  today_cost_usd: string | null;
  today_input_tokens: number;
  today_output_tokens: number;
  today_cache_read_tokens: number;
  today_known_turns: number;
  today_unknown_cost_turns: number;
}

function parseNullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

export function normalizeCostRow(row: CostRow): CostSummary {
  return {
    sessionId: row.session_id,
    sessionCostUsd: parseNullableNumber(row.session_cost_usd),
    todayCostUsd: parseNullableNumber(row.today_cost_usd),
    todayInputTokens: Number(row.today_input_tokens),
    todayOutputTokens: Number(row.today_output_tokens),
    todayCacheReadTokens: Number(row.today_cache_read_tokens),
    todayKnownTurns: Number(row.today_known_turns),
    todayUnknownCostTurns: Number(row.today_unknown_cost_turns),
    costTracking: row.today_unknown_cost_turns > 0 ? "unknown" : "tracked",
    subscriptionTier: null,
    contextUsedPercent: null,
    contextWindowTokens: null,
  };
}

export async function getCostSummary(db: Database, sessionId?: string): Promise<CostSummary> {
  const result = await db.execute(sql`
    select
      ${sessionId ? sql`${sessionId}` : sql`null::text`} as session_id,
      ${sessionId
        ? sql`(select sum(ut.cost_usd)
               from claude_run.usage_turns ut
               join claude_run.conversations c on c.id = ut.conversation_id
               where c.claude_session_id = ${sessionId})`
        : sql`null::numeric`} as session_cost_usd,
      sum(case when ut.created_at >= current_date then ut.cost_usd else null end) as today_cost_usd,
      coalesce(sum(case when ut.created_at >= current_date then ut.input_tokens else 0 end), 0)::int as today_input_tokens,
      coalesce(sum(case when ut.created_at >= current_date then ut.output_tokens else 0 end), 0)::int as today_output_tokens,
      coalesce(sum(case when ut.created_at >= current_date then ut.cache_read_tokens else 0 end), 0)::int as today_cache_read_tokens,
      count(*) filter (where ut.created_at >= current_date and ut.cost_usd is not null)::int as today_known_turns,
      count(*) filter (where ut.created_at >= current_date and ut.cost_usd is null)::int as today_unknown_cost_turns
    from claude_run.usage_turns ut
  `);
  const row = result.rows[0] as unknown as CostRow | undefined;
  return normalizeCostRow(row ?? {
    session_id: sessionId ?? null,
    session_cost_usd: null,
    today_cost_usd: null,
    today_input_tokens: 0,
    today_output_tokens: 0,
    today_cache_read_tokens: 0,
    today_known_turns: 0,
    today_unknown_cost_turns: 0,
  });
}

interface CostState {
  type: "cost-state";
  totalCostUSD?: number;
  startTime?: number;
  hasUnknownModelCost?: boolean;
  modelUsage?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
  }>;
}

interface UsageRecord {
  type?: string;
  timestamp?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

// Claude Code's local cost-state is authoritative when present. For JSONL
// sessions without it, use the published Opus API rates as an estimate and
// label the result accordingly rather than showing a misleading zero.
const OPUS_PRICE = { input: 15, output: 75, cacheRead: 1.5 };

function estimateUsageCost(usage: NonNullable<NonNullable<UsageRecord["message"]>["usage"]>): number {
  return (
    ((usage.input_tokens ?? 0) * OPUS_PRICE.input +
      (usage.output_tokens ?? 0) * OPUS_PRICE.output +
      (usage.cache_read_input_tokens ?? 0) * OPUS_PRICE.cacheRead) /
    1_000_000
  );
}

function emptyFileSummary(sessionId: string | null): CostSummary {
  return {
    sessionId,
    sessionCostUsd: null,
    todayCostUsd: null,
    todayInputTokens: 0,
    todayOutputTokens: 0,
    todayCacheReadTokens: 0,
    todayKnownTurns: 0,
    todayUnknownCostTurns: 0,
    costTracking: "unknown",
    subscriptionTier: null,
    contextUsedPercent: null,
    contextWindowTokens: null,
  };
}

export async function getFileCostSummary(sessionId?: string): Promise<CostSummary> {
  const summary = emptyFileSummary(sessionId ?? null);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const files = await listSessionFiles();
  // Scan both account roots, then narrow selected-session totals by file ID.
  const matchingFiles = sessionId
    ? files.filter((file) => basename(file, ".jsonl") === sessionId)
    : files;
  let dailyCost = 0;
  let dailyHasUsage = false;
  let dailyUsedEstimate = false;
  let sessionCost = 0;
  let sessionHasUsage = false;
  let latestContextPercent: number | null = null;
  let latestContextTokens: number | null = null;

  for (const file of matchingFiles) {
    let lines: string[];
    try {
      lines = (await readFile(file, "utf8")).split(/\r?\n/);
    } catch {
      continue;
    }

    let latestState: CostState | null = null;
    const usageRecords: UsageRecord[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as UsageRecord & CostState;
        if (record.type === "cost-state") latestState = record;
        if (record.message?.usage) usageRecords.push(record);
      } catch {
        // Ignore incomplete JSONL lines.
      }
    }

    if (latestState?.totalCostUSD !== undefined) {
      sessionCost = latestState.totalCostUSD;
      sessionHasUsage = true;
      if (!sessionId) {
        const date = latestState.startTime ? new Date(latestState.startTime) : null;
        const isToday = date !== null && `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` === todayKey;
        if (isToday) {
          dailyCost += latestState.totalCostUSD;
          dailyHasUsage = true;
        }
      }
    } else if (usageRecords.length > 0) {
      // Some Claude Code sessions have token usage records but no cost-state
      // record. Estimate those sessions from the same usage data for both
      // scopes; otherwise the daily total silently omits them.
      const estimatedSessionCost = usageRecords.reduce(
        (sum, record) => sum + estimateUsageCost(record.message!.usage!),
        0,
      );
      if (sessionId) {
        sessionCost = estimatedSessionCost;
        sessionHasUsage = true;
      }
      dailyUsedEstimate = true;
    }

    if (!latestState) {
      for (const record of usageRecords) {
        const date = record.timestamp ? new Date(record.timestamp) : null;
        const isToday = date !== null && `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` === todayKey;
        if (!isToday) continue;
        const usage = record.message!.usage!;
        const cost = estimateUsageCost(usage);
        dailyCost += cost;
        dailyHasUsage = true;
        dailyUsedEstimate = true;
        summary.todayInputTokens += usage.input_tokens ?? 0;
        summary.todayOutputTokens += usage.output_tokens ?? 0;
        summary.todayCacheReadTokens += usage.cache_read_input_tokens ?? 0;
      }
    }

    if (latestState) {
      for (const record of usageRecords) {
        const date = record.timestamp ? new Date(record.timestamp) : null;
        const isToday = date !== null && `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` === todayKey;
        if (!isToday) continue;
        summary.todayInputTokens += record.message!.usage!.input_tokens ?? 0;
        summary.todayOutputTokens += record.message!.usage!.output_tokens ?? 0;
        summary.todayCacheReadTokens += record.message!.usage!.cache_read_input_tokens ?? 0;
      }
    }
  }

  summary.sessionCostUsd = sessionHasUsage ? sessionCost : null;
  summary.todayCostUsd = dailyHasUsage ? dailyCost : null;
  summary.todayKnownTurns = dailyHasUsage ? 1 : 0;
  summary.todayUnknownCostTurns = 0;
  summary.costTracking = dailyUsedEstimate ? "estimated" : sessionHasUsage ? "tracked" : "unknown";
  summary.contextUsedPercent = latestContextPercent;
  summary.contextWindowTokens = latestContextTokens;
  return summary;
}
