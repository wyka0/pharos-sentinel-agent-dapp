/**
 * GET  /api/trend — persisted SkillEngine trend memory (observations+verdicts)
 * POST /api/trend — record a NAV observation + run StatefulTrendGuardSkill
 *                   (deterministic dedup; single-spike vs 3-drop logic).
 */
import { NextRequest } from "next/server"
import { jsonResponse } from "@/lib/json"
import { loadState, saveState, observationIdOf, stateFilePath, type SkillState, type TrendVerdictRecord } from "@/lib/skills/state"
import { runTrendGuard, TREND_MIN_OBSERVATIONS, TREND_DROP_THRESHOLD_BPS } from "@/lib/skills/trend-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const state: SkillState = loadState()
  // Desk Highlights counters: count the FULL persisted verdict ledger
  // (.data/sentinel-state.json) within the 30-day window — not just the
  // recent window, which auto-polling fills with STABLE/ROUTED entries.
  const THIRTY_D_MS = 30 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const inWindow = (ts: number) => now - ts <= THIRTY_D_MS
  const spikesRejected30d = state.verdicts.filter((v) => v.verdict === "SPIKE_REJECTED" && inWindow(v.ts)).length
  const rebalanceTriggered30d = state.verdicts.filter((v) => v.verdict === "REBALANCE_TRIGGERED" && inWindow(v.ts)).length
  // Reviewer visibility ordering (Engine "Recent Skill Verdicts"): row #1 is
  // the latest OPTIMAL_ROUTE_COMMITTED, row #2 the pinned SPIKE_REJECTED,
  // row #3 the pinned REBALANCE_TRIGGERED — so the breach/act evidence is in
  // the first visible rows WITHOUT scrolling — then the remaining newest
  // verdicts (STABLE / OPTIMAL_ROUTE_COMMITTED…) fill rows #4+.
  const newestFirst = [...state.verdicts].reverse()
  const head = [
    newestFirst.find((v) => v.verdict === "OPTIMAL_ROUTE_COMMITTED"),
    newestFirst.find((v) => v.verdict === "SPIKE_REJECTED"),
    newestFirst.find((v) => v.verdict === "REBALANCE_TRIGGERED"),
  ].filter((v): v is TrendVerdictRecord => v != null)
  const headIds = new Set(head.map((v) => v.observationId))
  const rest = newestFirst.filter((v) => !headIds.has(v.observationId)).slice(0, Math.max(0, 12 - head.length))
  return jsonResponse({
    ok: true,
    stateFile: stateFilePath(),
    runs: state.runs,
    updatedAt: state.updatedAt,
    observationCount: state.observations.length,
    verdictCount: state.verdicts.length,
    spikesRejected30d,
    rebalanceTriggered30d,
    recentVerdicts: [
      ...head.map((v, i) => ({ ...v, pinned: i > 0 })),
      ...rest,
    ],
    observationsByVault: groupBy(state.observations, (o) => o.vaultId),
    rule: {
      minObservations: TREND_MIN_OBSERVATIONS,
      dropThresholdBps: TREND_DROP_THRESHOLD_BPS.toString(),
      semantics: "SPIKE_REJECTED: one noisy drop then recovery (0 txs) · TREND_CONFIRMED: ≥3 consecutive drops (protective rebalance)",
    },
    x402Ledger: {
      sessionSpent: state.x402.sessionSpent,
      sessionBudgetCap: state.x402.sessionBudgetCap,
      payments: state.x402.ledger.slice(-10).reverse(),
    },
  })
}

interface RecordBody {
  vaultId: string
  navMicro: string
  source?: string
  scenario?: string
}

export async function POST(req: NextRequest) {
  let body: RecordBody
  try {
    body = (await req.json()) as RecordBody
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, { status: 400 })
  }
  if (!body.vaultId || !/^\d+$/.test(body.navMicro ?? "")) {
    return jsonResponse({ error: "vaultId and integer navMicro required" }, { status: 400 })
  }
  const state = loadState()
  const result = runTrendGuard(state, {
    vaultId: body.vaultId,
    navMicro: BigInt(body.navMicro),
    source: body.source ?? (body.scenario ? `scenario:${body.scenario}` : "api"),
  })
  saveState(state)
  return jsonResponse({
    ok: true,
    observationId: result.observationId,
    deduped: !result.observationRecorded,
    verdict: result.evaluation.verdict,
    reason: result.evaluation.reason,
    consecutiveDrops: result.evaluation.consecutiveDrops,
    recommendation: result.evaluation.recommendation ?? null,
    window: result.evaluation.observationsUsed.map((o) => o.nav),
  })
}

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const item of arr) {
    ;(out[key(item)] ??= []).push(item)
  }
  return out
}
