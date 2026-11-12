/**
 * src/lib/skills/trend-guard.ts — Skill A: StatefulTrendGuardSkill
 * =====================================================================
 * Persistent NAV trend memory with a strict ≥3-observation rule:
 *
 *   - fewer than 3 observations for a vault           -> INSUFFICIENT_DATA
 *   - exactly one isolated noisy drop then recovery   -> SPIKE_REJECTED
 *     (e.g. 100 -> 93 -> 100 — the agent does NOT trade on noise)
 *   - 3 consecutive drops beyond the drop threshold    -> TREND_CONFIRMED
 *     -> protective rebalance recommendation onto the low-risk
 *        Pharos T-Bill RWA vault
 *
 * All math is integer (NAV stored in micro-units) => deterministic.
 */
import type { NavObservation, SkillState, TrendVerdictRecord } from "./state"
import { observationIdOf } from "./state"

export const TREND_MIN_OBSERVATIONS = 3
/** NAV drop threshold: 100 bps = 1% */
export const TREND_DROP_THRESHOLD_BPS = 100n

export type TrendVerdict = "SPIKE_REJECTED" | "TREND_CONFIRMED" | "INSUFFICIENT_DATA" | "STABLE"

export interface TrendEvaluation {
  vaultId: string
  verdict: TrendVerdict
  observationsUsed: NavObservation[]
  consecutiveDrops: number
  totalDropBps: bigint | null
  reason: string
  recommendation?: {
    action: "REBALANCE_TO_TBILL"
    fromVault: string
    toVault: "tbill"
    rationale: string
  }
}

/**
 * Evaluate the persisted observation window for one vault.
 * Reads from `state` (persistent memory across runs/processes).
 */
export function evaluateTrend(state: SkillState, vaultId: string): TrendEvaluation {
  const window = state.observations
    .filter((o) => o.vaultId === vaultId)
    .sort((a, b) => a.ts - b.ts)

  if (window.length < TREND_MIN_OBSERVATIONS) {
    return {
      vaultId,
      verdict: "INSUFFICIENT_DATA",
      observationsUsed: window,
      consecutiveDrops: 0,
      totalDropBps: null,
      reason: `only ${window.length}/${TREND_MIN_OBSERVATIONS} observations persisted for ${vaultId}`,
    }
  }

  const recent = window.slice(-4)
  const navs = recent.map((o) => BigInt(o.nav))

  // count trailing consecutive drops (each > threshold bps)
  let consecutiveDrops = 0
  for (let i = navs.length - 1; i > 0; i--) {
    const prev = navs[i - 1]
    const cur = navs[i]
    if (prev === 0n) break
    const dropBps = ((prev - cur) * 10_000n) / prev
    if (dropBps > TREND_DROP_THRESHOLD_BPS) consecutiveDrops++
    else break
  }

  const last = navs[navs.length - 1]
  const first = navs[0]

  if (consecutiveDrops >= 3) {
    const peak = navs.slice(0, navs.length - consecutiveDrops).reduce((a, b) => (b > a ? b : a), first)
    const totalDropBps = ((peak - last) * 10_000n) / peak
    return {
      vaultId,
      verdict: "TREND_CONFIRMED",
      observationsUsed: recent,
      consecutiveDrops,
      totalDropBps,
      reason: `${consecutiveDrops} consecutive drops > 1% persisted across separate observations (peak ${peak} -> last ${last}, -${totalDropBps} bps)`,
      recommendation: {
        action: "REBALANCE_TO_TBILL",
        fromVault: vaultId,
        toVault: "tbill",
        rationale:
          "Confirmed ≥3-check downtrend on a stateful observation window; protective policy routes capital to the KYA-compliant, zero-fee Pharos T-Bill RWA vault (riskScore 12) pending manual review.",
      },
    }
  }

  // single noisy drop then recovery: 100 -> 93 -> 100 pattern
  // (the LAST observation recovered above the pre-drop level, with exactly 1 drop in window)
  const drops = countDrops(navs)
  if (drops === 1 && navs.length >= 3 && last >= navs[0]) {
    return {
      vaultId,
      verdict: "SPIKE_REJECTED",
      observationsUsed: recent,
      consecutiveDrops,
      totalDropBps: null,
      reason:
        "single noisy drop detected then fully recovered within the ≥3-observation window — stateful rule ignores one-off spikes and does NOT trade",
    }
  }

  return {
    vaultId,
    verdict: "STABLE",
    observationsUsed: recent,
    consecutiveDrops,
    totalDropBps: null,
    reason: `no actionable trend (${drops} qualifying drops in window of ${navs.length})`,
  }
}

function countDrops(navs: bigint[]): number {
  let n = 0
  for (let i = 1; i < navs.length; i++) {
    const prev = navs[i - 1]
    const cur = navs[i]
    if (prev === 0n) continue
    if (((prev - cur) * 10_000n) / prev > TREND_DROP_THRESHOLD_BPS) n++
  }
  return n
}

/** Observe + evaluate + persist a verdict record (full skill cycle). */
export function runTrendGuard(
  state: SkillState,
  input: { vaultId: string; navMicro: bigint; source?: string; now?: number },
): { observationRecorded: boolean; observationId: string; evaluation: TrendEvaluation; record: TrendVerdictRecord } {
  const now = input.now ?? Date.now()
  // 1-second bucket makes the deterministic id stable for replays
  const bucketTs = Math.floor(now / 1000)
  const id = observationIdOf(input.vaultId, input.navMicro, input.source ?? "chain-mcp", bucketTs)
  const obs: NavObservation = {
    observationId: id,
    vaultId: input.vaultId,
    nav: input.navMicro.toString(),
    source: input.source ?? "chain-mcp",
    bucketTs,
    ts: now,
  }
  const observationRecorded = requireRecord(state, obs)
  const evaluation = evaluateTrend(state, input.vaultId)
  const record: TrendVerdictRecord = {
    observationId: id,
    vaultId: input.vaultId,
    verdict: evaluation.verdict,
    window: evaluation.observationsUsed.map((o) => ({ observationId: o.observationId, nav: o.nav, ts: o.ts })),
    recommendation: evaluation.recommendation?.action,
    ts: now,
  }
  state.verdicts.push(record)
  if (state.verdicts.length > 200) state.verdicts.splice(0, state.verdicts.length - 200)
  return { observationRecorded, observationId: id, evaluation, record }
}

// avoid circular import: recordObservation lives in state.ts
import { recordObservation } from "./state"
function requireRecord(state: SkillState, obs: NavObservation): boolean {
  return recordObservation(state, obs)
}
