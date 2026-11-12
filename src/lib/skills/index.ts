/**
 * src/lib/skills/index.ts — TOOL #4: Pharos SkillEngine
 * Registers the two production skills and exposes the unified engine API
 * used by the orchestrator. All state persists to .data/sentinel-state.json
 * with atomic tmp->fsync->rename writes and deterministic observation IDs.
 */
export * from "./state"
export * from "./trend-guard"
export * from "./horizon-router"

import { loadState, saveState, emptyState, type SkillState } from "./state"
import { runTrendGuard, type TrendEvaluation } from "./trend-guard"

export interface SkillEngineDescriptor {
  name: string
  version: string
  description: string
  memory: string
}

export const SKILL_REGISTRY: SkillEngineDescriptor[] = [
  {
    name: "StatefulTrendGuardSkill",
    version: "1.0.0",
    description:
      "Persistent NAV/TVL observation memory with deterministic dedup and the ≥3-observation trend rule: single noisy drops (100→93→100) are rejected (SPIKE_REJECTED, 0 txs) while ≥3 consecutive drops trigger a protective rebalance recommendation onto the Pharos T-Bill RWA vault.",
    memory: ".data/sentinel-state.json (observations[] + verdicts[])",
  },
  {
    name: "HorizonNetYieldRouterSkill",
    version: "1.0.0",
    description:
      "Exact bigint net-return projection of deposit dx over horizon T across all 3 vaults after entry/exit fees, utilization dilution, x402 audit fee and live Atlantic gas — filtered by the user's risk ceiling and the on-chain Policy Firewall.",
    memory: "stateless (pure math), consumes live Chain MCP + Policy MCP inputs",
  },
]

export interface SkillEngineRun {
  engine: "PharosSkillEngine"
  skills: SkillEngineDescriptor[]
  stateFile: string
  runs: number
}

/** SkillEngine bootstrap: load memory, bump run counter, persist atomically. */
export function openSkillEngine(): { state: SkillState; run: SkillEngineRun } {
  let state = loadState()
  if (!state.observations) state = emptyState()
  state.runs += 1
  return {
    state,
    run: { engine: "PharosSkillEngine", skills: SKILL_REGISTRY, stateFile: ".data/sentinel-state.json", runs: state.runs },
  }
}

/** Persist after a run (atomic). */
export function closeSkillEngine(state: SkillState): void {
  saveState(state)
}

export { runTrendGuard, type TrendEvaluation }
