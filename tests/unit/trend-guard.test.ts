/**
 * tests/unit/trend-guard.test.ts — Skill A: StatefulTrendGuardSkill.
 * Proves: single noisy drop (100→93→100) => SPIKE_REJECTED (no trade),
 * ≥3 consecutive drops => TREND_CONFIRMED (protective rebalance),
 * deterministic observationId dedup, INSUFFICIENT_DATA, persistence.
 */
import { describe, it, expect, beforeEach } from "vitest"
import {
  emptyState,
  loadState,
  saveState,
  observationIdOf,
  recordObservation,
  type SkillState,
} from "@/lib/skills/state"
import {
  evaluateTrend,
  runTrendGuard,
  TREND_MIN_OBSERVATIONS,
  TREND_DROP_THRESHOLD_BPS,
} from "@/lib/skills/trend-guard"

let state: SkillState
let clock = 1_700_000_000_000

function nextTs() {
  clock += 60_000
  return clock
}

function observe(vaultId: string, navMicro: bigint, ts?: number) {
  return runTrendGuard(state, { vaultId, navMicro, source: "test", now: ts ?? nextTs() })
}

beforeEach(() => {
  state = emptyState()
  clock = 1_700_000_000_000
})

describe("constants", () => {
  it("requires at least 3 observations", () => {
    expect(TREND_MIN_OBSERVATIONS).toBe(3)
  })
  it("uses a 1% (100 bps) drop threshold", () => {
    expect(TREND_DROP_THRESHOLD_BPS).toBe(100n)
  })
})

describe("INSUFFICIENT_DATA", () => {
  it("returns INSUFFICIENT_DATA with 0 observations", () => {
    expect(observe("harbor", 100_000_000n).evaluation.verdict).toBe("INSUFFICIENT_DATA")
  })
  it("returns INSUFFICIENT_DATA with 2 observations", () => {
    observe("harbor", 100_000_000n)
    const r = observe("harbor", 95_000_000n)
    expect(r.evaluation.verdict).toBe("INSUFFICIENT_DATA")
    expect(r.evaluation.reason).toContain("2/3")
  })
  it("tracks observations per vault independently", () => {
    observe("harbor", 100_000_000n)
    observe("tbill", 100_000_000n)
    observe("harbor", 100_000_000n)
    const r = observe("tbill", 99_000_000n)
    expect(r.evaluation.verdict).toBe("INSUFFICIENT_DATA") // tbill has only 2
  })
})

describe("single noisy drop => SPIKE_REJECTED (the 100→93→100 rule)", () => {
  it("rejects 100 → 93 → 100 with 0 recommendation", () => {
    observe("harbor", 100_000_000n)
    observe("harbor", 93_000_000n)
    const r = observe("harbor", 100_000_000n)
    expect(r.evaluation.verdict).toBe("SPIKE_REJECTED")
    expect(r.evaluation.reason).toContain("ignores one-off spikes")
    expect(r.evaluation.recommendation).toBeUndefined()
  })
  it("SPIKE_REJECTED implies no protective rebalance is prepared", () => {
    observe("credit", 100_000_000n)
    observe("credit", 92_000_000n)
    const r = observe("credit", 100_500_000n)
    expect(r.evaluation.verdict).toBe("SPIKE_REJECTED")
    expect(r.record.recommendation).toBeUndefined()
  })
  it("rejects a single drop within a longer stable window", () => {
    for (const nav of [100n, 100n, 93n, 100n, 100n]) observe("harbor", nav * 1_000_000n)
    expect(evaluateTrend(state, "harbor").verdict).toBe("SPIKE_REJECTED")
  })
})

describe("3 consecutive drops => TREND_CONFIRMED + protective rebalance", () => {
  it("confirms 100 → 98 → 95 → 92 and recommends T-Bill rebalance", () => {
    observe("harbor", 100_000_000n)
    observe("harbor", 98_000_000n)
    observe("harbor", 95_000_000n)
    const r = observe("harbor", 92_000_000n)
    expect(r.evaluation.verdict).toBe("TREND_CONFIRMED")
    expect(r.evaluation.consecutiveDrops).toBe(3)
    expect(r.evaluation.recommendation).toEqual({
      action: "REBALANCE_TO_TBILL",
      fromVault: "harbor",
      toVault: "tbill",
      rationale: expect.stringContaining("riskScore 12"),
    })
  })
  it("computes totalDropBps for the confirmed window", () => {
    for (const nav of [100n, 98n, 95n, 92n]) observe("credit", nav * 1_000_000n)
    const e = evaluateTrend(state, "credit")
    expect(e.totalDropBps).toBe(800n) // -8%
  })
  it("does NOT confirm on only 2 consecutive drops", () => {
    for (const nav of [100n, 98n, 95n]) observe("harbor", nav * 1_000_000n)
    expect(evaluateTrend(state, "harbor").verdict).not.toBe("TREND_CONFIRMED")
  })
  it("ignores sub-threshold consecutive dips (0.5% each)", () => {
    const navs = [100, 99.5, 99, 98.5].map((x) => BigInt(Math.round(x * 1_000_000)))
    for (const nav of navs) {
      observe("harbor", nav)
    }
    // each drop is 0.5% = 50 bps < 100 bps threshold => not a qualifying drop
    expect(evaluateTrend(state, "harbor").verdict).toBe("STABLE")
  })
  it("recovery after 2 drops resets the counter", () => {
    for (const nav of [100n, 97n, 94n, 100n, 97n, 94n, 100n]) observe("harbor", nav * 1_000_000n)
    const e = evaluateTrend(state, "harbor")
    expect(e.verdict).not.toBe("TREND_CONFIRMED")
  })
})

describe("STABLE", () => {
  it("reports STABLE for flat observations", () => {
    for (let i = 0; i < 4; i++) observe("tbill", 100_000_000n)
    const e = evaluateTrend(state, "tbill")
    expect(e.verdict).toBe("STABLE")
    expect(e.reason).toContain("no actionable trend")
  })
  it("reports STABLE for a single large drop at the end (awaiting confirmation)", () => {
    for (const nav of [100n, 100n, 100n, 90n]) observe("harbor", nav * 1_000_000n)
    expect(evaluateTrend(state, "harbor").verdict).toBe("STABLE")
  })
})

describe("deterministic observationId & dedup", () => {
  it("same semantic observation yields the same id", () => {
    expect(observationIdOf("tbill", 100_000_000n, "chain-mcp", 1_700_000_000)).toBe(
      observationIdOf("tbill", 100_000_000n, "chain-mcp", 1_700_000_000),
    )
  })
  it("different nav yields a different id", () => {
    expect(observationIdOf("tbill", 100n, "s", 1)).not.toBe(observationIdOf("tbill", 101n, "s", 1))
  })
  it("different vault yields a different id", () => {
    expect(observationIdOf("tbill", 100n, "s", 1)).not.toBe(observationIdOf("credit", 100n, "s", 1))
  })
  it("recordObservation dedupes identical ids", () => {
    const s = emptyState()
    const obs = { observationId: "abc", vaultId: "tbill", nav: "1", source: "t", bucketTs: 1, ts: 1 }
    expect(recordObservation(s, obs)).toBe(true)
    expect(recordObservation(s, obs)).toBe(false)
    expect(s.observations).toHaveLength(1)
  })
  it("runTrendGuard dedupes same-second replays of the same NAV", () => {
    const now = 1_700_000_000_123
    const r1 = runTrendGuard(state, { vaultId: "tbill", navMicro: 100n, now })
    const r2 = runTrendGuard(state, { vaultId: "tbill", navMicro: 100n, now })
    expect(r1.observationRecorded).toBe(true)
    expect(r2.observationRecorded).toBe(false)
    expect(r2.observationId).toBe(r1.observationId)
  })
  it("new observations after 1s bucket change are recorded", () => {
    const r1 = runTrendGuard(state, { vaultId: "tbill", navMicro: 100n, now: 1_700_000_000_000 })
    const r2 = runTrendGuard(state, { vaultId: "tbill", navMicro: 100n, now: 1_700_000_001_500 })
    expect(r1.observationId).not.toBe(r2.observationId)
    expect(r2.observationRecorded).toBe(true)
  })
})

describe("persistence (atomic save/load)", () => {
  it("saveState then loadState roundtrips observations", () => {
    observe("harbor", 100_000_000n)
    observe("harbor", 98_000_000n)
    saveState(state)
    const loaded = loadState()
    expect(loaded.observations).toHaveLength(2)
    expect(loaded.observations[0].vaultId).toBe("harbor")
  })
  it("loadState on missing file seeds the cold-start state from tracked evidence", () => {
    const fsMod = require("node:fs")
    const pathMod = require("node:path")
    const file = pathMod.join(process.env.SENTINEL_DATA_DIR!, "sentinel-state.json")
    fsMod.rmSync(file, { force: true })
    const seeded = loadState()
    expect(seeded.schemaVersion).toBe(1)
    // evidence-driven telemetry parity on first load
    expect(seeded.observations.length).toBeGreaterThan(0)
    expect(seeded.verdicts.filter((v) => v.verdict === "SPIKE_REJECTED")).toHaveLength(4)
    expect(seeded.verdicts.some((v) => v.verdict === "REBALANCE_TRIGGERED")).toBe(true)
    expect(seeded.verdicts.some((v) => v.verdict === "OPTIMAL_ROUTE_COMMITTED")).toBe(true)
    expect(seeded.x402.ledger).toHaveLength(3)
    expect(seeded.x402.sessionSpent).toBe("75000")
  })
  it("loadState on corrupt file returns fresh state (never throws)", () => {
    const fs = require("node:fs")
    const path = require("node:path")
    const file = path.join(process.env.SENTINEL_DATA_DIR!, "sentinel-state.json")
    fs.writeFileSync(file, "{corrupt json!!")
    expect(() => loadState()).not.toThrow()
    expect(loadState().schemaVersion).toBe(1)
  })
  it("atomic write leaves no tmp files behind", () => {
    observe("tbill", 1n)
    saveState(state)
    const fs = require("node:fs")
    const dir = process.env.SENTINEL_DATA_DIR!
    const leftovers = fs.readdirSync(dir).filter((f: string) => f.includes(".tmp"))
    expect(leftovers).toHaveLength(0)
  })
  it("state file is valid JSON with schemaVersion 1", () => {
    saveState(state)
    const fs = require("node:fs")
    const path = require("node:path")
    const parsed = JSON.parse(fs.readFileSync(path.join(process.env.SENTINEL_DATA_DIR!, "sentinel-state.json"), "utf8"))
    expect(parsed.schemaVersion).toBe(1)
    expect(Array.isArray(parsed.observations)).toBe(true)
    expect(Array.isArray(parsed.verdicts)).toBe(true)
  })
  it("verdict records accumulate across runs", () => {
    for (const nav of [100n, 98n, 95n, 92n]) observe("harbor", nav * 1_000_000n)
    expect(state.verdicts).toHaveLength(4)
    expect(state.verdicts[3].verdict).toBe("TREND_CONFIRMED")
  })
})

describe("observation window safety", () => {
  it("caps stored observations at 500", () => {
    for (let i = 0; i < 600; i++) {
      state.observations.push({ observationId: `x${i}`, vaultId: "tbill", nav: "1", source: "t", bucketTs: i, ts: i })
    }
    recordObservation(state, { observationId: "new", vaultId: "tbill", nav: "2", source: "t", bucketTs: 9999, ts: 9999 })
    expect(state.observations.length).toBeLessThanOrEqual(500)
  })
  it("caps stored verdicts at 200", () => {
    for (let i = 0; i < 250; i++) {
      state.observations.push({ observationId: `v${i}`, vaultId: "tbill", nav: "100", source: "t", bucketTs: i, ts: i })
    }
    for (let i = 0; i < 210; i++) {
      runTrendGuard(state, { vaultId: "credit", navMicro: BigInt(100 + i), now: 1_700_000_000_000 + i * 1000 })
    }
    expect(state.verdicts.length).toBeLessThanOrEqual(200)
  })
  it("evaluateTrend uses only the recent window (last 4)", () => {
    for (const nav of [100n, 99n, 98n, 97n, 96n, 95n, 94n]) observe("harbor", nav * 1_000_000n)
    const e = evaluateTrend(state, "harbor")
    expect(e.observationsUsed.length).toBeLessThanOrEqual(4)
    expect(e.consecutiveDrops).toBe(3)
  })
})
